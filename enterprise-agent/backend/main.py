import os
import subprocess
import json
import re
import urllib.request
import urllib.parse
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from jinja2 import Template
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List

app = FastAPI(title="Enterprise Agent Backend")

# Add CORS support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SKILLS_DIR = os.path.abspath("../skills")

class SkillExecutionRequest(BaseModel):
    skill_id: str
    params: Dict[str, Any]

GITHUB_API_BASE = "https://api.github.com"


def fetch_github_api(path: str):
    url = urllib.parse.urljoin(GITHUB_API_BASE, path)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Coral-Enterprise-Agent",
        "Accept": "application/vnd.github.v3+json"
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_owner_repo(query: str):
    match = re.search(r"owner\s*=\s*'([^']+)'", query, re.IGNORECASE)
    repo = re.search(r"repo\s*=\s*'([^']+)'", query, re.IGNORECASE)
    if match and repo:
        return match.group(1), repo.group(1)
    match = re.search(r"gr\.owner\s*=\s*'([^']+)'", query, re.IGNORECASE)
    repo2 = re.search(r"gr\.name\s*=\s*'([^']+)'", query, re.IGNORECASE)
    if match and repo2:
        return match.group(1), repo2.group(1)
    return None, None


def github_fallback(query: str):
    owner, repo = extract_owner_repo(query)
    if not owner or not repo:
        return [{"status": "error", "message": "Could not extract owner/repo from query", "query": query}]

    if "FROM github.issues" in query.lower():
        items = fetch_github_api(f"/repos/{owner}/{repo}/issues?state=open&per_page=20")
        return [
            {
                "status": item.get("state", "open"),
                "message": item.get("title"),
                "created_at": item.get("created_at"),
                "url": item.get("html_url")
            }
            for item in items if "pull_request" not in item
        ]

    if "FROM github.pulls" in query.lower():
        state = "open" if "pr.state = 'open'" in query.lower() else "closed"
        items = fetch_github_api(f"/repos/{owner}/{repo}/pulls?state={state}&per_page=20")
        return [
            {
                "status": item.get("state", state),
                "message": item.get("title"),
                "created_at": item.get("created_at"),
                "url": item.get("html_url")
            }
            for item in items
        ]

    if "FROM github.commits" in query.lower():
        items = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=20")
        results = []
        for item in items:
            commit = item.get("commit", {})
            message = commit.get("message")
            if "like '%doc%'" in query.lower() and "doc" not in message.lower():
                continue
            results.append({
                "status": "commit",
                "message": message,
                "created_at": commit.get("author", {}).get("date"),
                "url": item.get("html_url")
            })
        return results[:20]

    if "FROM github.repos" in query.lower():
        item = fetch_github_api(f"/repos/{owner}/{repo}")
        return [{
            "status": item.get("private", False) and "private" or "public",
            "message": item.get("description"),
            "stars": item.get("stargazers_count"),
            "forks": item.get("forks_count"),
            "open_issues": item.get("open_issues_count"),
            "url": item.get("html_url")
        }]

    return [{"status": "error", "message": "No GitHub fallback available for this query", "query": query}]


def run_coral_query(query: str, demo_mode=False):
    """Executes a SQL query using the Coral CLI inside WSL.
    Falls back to demo mode if Coral is not available."""
    if demo_mode:
        return json.dumps([{"status": "demo", "message": "Coral not available - demo mode", "query": query}])
    
    try:
        result = subprocess.run(
            ["wsl", "-d", "Ubuntu-24.04", "--", "/root/.local/bin/coral", "sql", "--format", "json", query],
            capture_output=True,
            text=True,
            check=True,
            timeout=120
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr if e.stderr else str(e)
        print(f"Coral Error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Coral error: {error_msg}")
    except subprocess.TimeoutExpired:
        print("Coral query timeout after 120 seconds")
        raise HTTPException(status_code=504, detail="Coral query timeout. Please check if Coral is running.")
    except FileNotFoundError as e:
        print(f"WSL/Coral not found: {e}")
        raise HTTPException(status_code=500, detail="WSL or Coral not found. Please ensure Coral is installed in WSL.")


def parse_owner_repo(params: Dict[str, Any]):
    owner = params.get("OWNER") or params.get("owner")
    repo = params.get("REPO") or params.get("repo")
    if owner and repo:
        return owner, repo

    full = params.get("REPO_NAME") or params.get("FULL_REPO") or params.get("repo_name") or ""
    if isinstance(full, str):
        full = full.strip().rstrip(".git")
        if "/" in full:
            return tuple(full.split("/", 1))
    return None, None


def query_coral_json(query: str):
    output = run_coral_query(query)
    try:
        return json.loads(output)
    except json.JSONDecodeError as e:
        print("Coral JSON parse error:", e, output)
        raise HTTPException(status_code=500, detail="Coral returned invalid JSON")


def execute_failure_hunter(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Fix Build")

    build_id = params.get("BUILD_ID") or params.get("BUILD") or params.get("BUILD_NUMBER")
    commit_hash = params.get("COMMIT_HASH")

    workflow_query = (
        f"SELECT id, name, head_sha, head_branch, status, conclusion, updated_at, url "
        f"FROM github.repo_action_workflow_runs "
        f"WHERE owner = '{owner}' AND repo = '{repo}' "
        f"ORDER BY updated_at DESC "
        f"LIMIT 5"
    )
    workflow_runs = query_coral_json(workflow_query)

    issue_query = (
        f"SELECT title, number, state, html_url, created_at "
        f"FROM github.issues "
        f"WHERE owner = '{owner}' AND repo = '{repo}' "
        f"AND title LIKE '%build%' "
        f"ORDER BY created_at DESC "
        f"LIMIT 5"
    )
    build_issues = query_coral_json(issue_query)

    pr_query = (
        f"SELECT number, title, state, html_url, updated_at, created_at, user__login as author "
        f"FROM github.pulls "
        f"WHERE owner = '{owner}' AND repo = '{repo}' "
        f"ORDER BY updated_at DESC "
        f"LIMIT 5"
    )
    pull_requests = query_coral_json(pr_query)

    failed_runs = [run for run in workflow_runs if run.get("conclusion") not in ("success", "skipped", "neutral")]
    completed_runs = [run for run in workflow_runs if run.get("status") == "completed"]

    # Correlate Sentry events by commit SHA when available
    sentry_matches = []
    if commit_hash:
        try:
            sentry_query = (
                f"SELECT id, title, culprit, first_seen, last_seen, level "
                f"FROM sentry.events "
                f"WHERE commit_sha = '{commit_hash}' "
                f"ORDER BY last_seen DESC LIMIT 5"
            )
            sentry_matches = query_coral_json(sentry_query)
        except Exception:
            sentry_matches = []

    # Slack messages that mention the commit or common build channels
    slack_matches = []
    try:
        slack_query = (
            f"SELECT channel, user, text, ts "
            f"FROM slack.messages "
            f"WHERE (channel IN ('#build-failures','#alerts') "
            f"OR text LIKE '%{commit_hash}%') "
            f"ORDER BY ts DESC LIMIT 10"
        )
        slack_matches = query_coral_json(slack_query)
    except Exception:
        slack_matches = []

    # Jira/Linear issues created near the workflow time
    ticket_matches = []
    try:
        if workflow_runs:
            anchor = workflow_runs[0].get('updated_at')
            ticket_query = (
                f"SELECT key, summary, status, created_at, url "
                f"FROM jira.issues "
                f"WHERE created_at >= TIMESTAMP('{anchor}') - INTERVAL '1 day' "
                f"AND created_at <= TIMESTAMP('{anchor}') + INTERVAL '1 day' "
                f"ORDER BY created_at DESC LIMIT 10"
            )
            ticket_matches = query_coral_json(ticket_query)
    except Exception:
        ticket_matches = []

    # StackOverflow search by issue title (best-effort)
    so_matches = []
    try:
        if build_issues:
            search_term = build_issues[0].get('message') or build_issues[0].get('title')
            if search_term:
                so_query = (
                    f"SELECT question_id, title, link, creation_date "
                    f"FROM stackoverflow.questions "
                    f"WHERE title ILIKE '%{search_term}%' OR body ILIKE '%{search_term}%' "
                    f"ORDER BY creation_date DESC LIMIT 5"
                )
                so_matches = query_coral_json(so_query)
    except Exception:
        so_matches = []

    summary = {
        "category": "Build Summary",
        "title": "Latest workflow report",
        "status": f"{len(completed_runs)} completed runs, {len(failed_runs)} failed",
        "message": (
            f"{workflow_runs[0].get('name')} ({workflow_runs[0].get('status')}/{workflow_runs[0].get('conclusion')})" if workflow_runs else "No workflow runs found."
        ),
        "action": "Inspect the failing workflow run and job output."
    }

    items = [summary]

    if build_issues:
        items.append({
            "category": "Related Issues",
            "title": f"{len(build_issues)} build-related issues",
            "message": "; ".join([f"#{issue['number']} {issue['title']}" for issue in build_issues]),
            "status": "issues",
            "action": "Review these issues for similar failures."
        })
    else:
        items.append({
            "category": "Related Issues",
            "title": "No recent build issues",
            "message": "No open issues matching 'build' were found.",
            "status": "clean",
            "action": "Search for stack traces or error logs if build fails."
        })

    if pull_requests:
        items.append({
            "category": "Recent PRs",
            "title": f"{len(pull_requests)} recent pull requests",
            "message": "; ".join([f"#{pr['number']} {pr['title']}" for pr in pull_requests[:3]]),
            "status": "context",
            "action": "Check recent PR changes for code that may have broken the build."
        })

    # Add cross-source result cards
    if sentry_matches:
        items.append({
            "category": "Sentry",
            "title": f"{len(sentry_matches)} matching Sentry events",
            "message": "; ".join([s.get('title', str(s.get('id'))) for s in sentry_matches]),
            "status": "sentry",
            "action": "Open Sentry to inspect the event and stack traces."
        })

    if slack_matches:
        items.append({
            "category": "Slack",
            "title": f"{len(slack_matches)} Slack matches",
            "message": "; ".join([m.get('text', '')[:120] for m in slack_matches]),
            "status": "chat",
            "action": "Check Slack for any ad-hoc fixes or rerun requests."
        })

    if ticket_matches:
        items.append({
            "category": "Tickets",
            "title": f"{len(ticket_matches)} related tickets",
            "message": "; ".join([t.get('key', '') + ': ' + (t.get('summary') or '') for t in ticket_matches]),
            "status": "tickets",
            "action": "Review ticket details for blockers or recent fixes."
        })

    if so_matches:
        items.append({
            "category": "StackOverflow",
            "title": f"{len(so_matches)} potential StackOverflow matches",
            "message": "; ".join([q.get('title', '') for q in so_matches]),
            "status": "external",
            "action": "Inspect public posts to see community fixes."
        })

    if commit_hash:
        items.append({
            "category": "Commit Context",
            "title": f"Commit {commit_hash}",
            "message": "Investigating this commit against build history.",
            "status": "context",
            "action": "Compare this commit to the last passing commit."
        })
    elif build_id:
        items.append({
            "category": "Build Input",
            "title": f"Build ID: {build_id}",
            "message": "Using the provided build identifier for investigation.",
            "status": "context",
            "action": "Inspect the build log and failed job details."
        })

    items.append({
        "category": "Recommended Action",
        "title": "Next step",
        "message": "Re-run the failing workflow and compare its first failing step to the closest open issue.",
        "status": "action",
        "action": "Use the workload and issue context to identify the fix."
    })

    return items


def execute_pr_reaper(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Cleanup PRs")

    stale_days = int(params.get("STALE_DAYS", 7))

    pr_query = (
        f"SELECT number, title, state, html_url, updated_at, created_at, user__login as author, head_sha "
        f"FROM github.pulls "
        f"WHERE owner = '{owner}' AND repo = '{repo}' AND state = 'open' "
        f"AND CAST(updated_at AS TIMESTAMP) < NOW() - INTERVAL '{stale_days} days' "
        f"ORDER BY updated_at ASC "
        f"LIMIT 20"
    )
    stale_prs = query_coral_json(pr_query)

    review_query = (
        f"SELECT pull_number, state "
        f"FROM github.reviews "
        f"WHERE owner = '{owner}' AND repo = '{repo}'"
    )
    reviews = query_coral_json(review_query)
    review_map: Dict[int, Dict[str, int]] = {}
    for review in reviews:
        pull_number = review.get("pull_number")
        if pull_number is None:
            continue
        bucket = review_map.setdefault(pull_number, {"count": 0, "approved": 0})
        bucket["count"] += 1
        if review.get("state", "").upper() == "APPROVED":
            bucket["approved"] += 1

    pr_shas = [pr.get("head_sha") for pr in stale_prs if pr.get("head_sha")]
    check_map: Dict[str, Dict[str, int]] = {}
    if pr_shas:
        sha_list = ",".join([f"'{sha}'" for sha in pr_shas])
        check_query = (
            f"SELECT head__sha, status, conclusion "
            f"FROM github.repo_check_runs "
            f"WHERE owner = '{owner}' AND repo = '{repo}' AND head__sha IN ({sha_list})"
        )
        checks = query_coral_json(check_query)
        for check in checks:
            sha = check.get("head__sha")
            if not sha:
                continue
            bucket = check_map.setdefault(sha, {"total": 0, "failed": 0})
            bucket["total"] += 1
            if check.get("conclusion") not in ("success", "skipped", "neutral"):
                bucket["failed"] += 1

    items = []
    counts = {"missing_approvals": 0, "failing_ci": 0, "stale": 0}
    for pr in stale_prs:
        number = pr.get("number")
        sha = pr.get("head_sha")
        review_info = review_map.get(number, {"count": 0, "approved": 0})
        check_info = check_map.get(sha, {"total": 0, "failed": 0})

        # Correlate Slack mentions for this PR
        slack_local = []
        try:
            slack_q = (
                f"SELECT channel, user, text, ts "
                f"FROM slack.messages "
                f"WHERE text LIKE '%#{number}%' OR text LIKE '%/pull/{number}%' "
                f"ORDER BY ts DESC LIMIT 5"
            )
            slack_local = query_coral_json(slack_q)
        except Exception:
            slack_local = []

        # Correlate Jira/Linear tickets referencing this PR
        jira_local = []
        try:
            jira_q = (
                f"SELECT key, summary, status, url "
                f"FROM jira.issues "
                f"WHERE description ILIKE '%#{number}%' OR summary ILIKE '%#{number}%' "
                f"ORDER BY updated_at DESC LIMIT 5"
            )
            jira_local = query_coral_json(jira_q)
        except Exception:
            jira_local = []

        # Last comment date for PR
        last_comment = None
        try:
            comment_q = (
                f"SELECT updated_at FROM github.issue_comments "
                f"WHERE pull_number = {number} OR issue_number = {number} "
                f"ORDER BY updated_at DESC LIMIT 1"
            )
            comments = query_coral_json(comment_q)
            if comments:
                last_comment = comments[0].get('updated_at')
        except Exception:
            last_comment = None

        # CI rerun detection (count workflow runs for this head SHA)
        ci_reruns = 0
        try:
            if sha:
                ci_q = (
                    f"SELECT id, name, run_attempt, status "
                    f"FROM github.repo_action_workflow_runs "
                    f"WHERE owner = '{owner}' AND repo = '{repo}' AND head_sha = '{sha}' "
                    f"ORDER BY updated_at DESC LIMIT 10"
                )
                ci_runs = query_coral_json(ci_q)
                ci_reruns = len(ci_runs) if ci_runs else 0
        except Exception:
            ci_reruns = 0

        if review_info["approved"] == 0:
            reason = "Missing approvals"
            action = "Request at least one approval before merge."
            counts["missing_approvals"] += 1
        elif check_info["failed"] > 0:
            reason = "CI failing"
            action = "Fix the failing checks or re-run CI."
            counts["failing_ci"] += 1
        else:
            reason = "No recent activity"
            action = "Ping the author or a reviewer for an update."
            counts["stale"] += 1

        items.append({
            "category": "Stale PR",
            "title": f"#{number} {pr.get('title')}",
            "message": f"Updated {pr.get('updated_at')} by {pr.get('author')}",
            "status": reason,
            "reason": reason,
            "action": action,
            "details": f"Reviews: {review_info['count']}, failed checks: {check_info['failed']}, ci_runs: {ci_reruns}, last_comment: {last_comment}",
            "slack_mentions": len(slack_local),
            "jira_links": [j.get('key') for j in jira_local]
        })

    items.insert(0, {
        "category": "Summary",
        "title": f"{len(stale_prs)} stale PRs found",
        "message": (
            f"{counts['missing_approvals']} missing approvals, "
            f"{counts['failing_ci']} failing CI, {counts['stale']} no activity"
        ),
        "status": "summary",
        "action": "Start with PRs missing approvals or failing CI."
    })

    return items

@app.get("/api/skills")
def list_skills():
    skills = []
    for filename in os.listdir(SKILLS_DIR):
        if filename.endswith(".sql"):
            skills.append(filename.replace(".sql", ""))
    return skills

@app.post("/api/execute")
def execute_skill(req: SkillExecutionRequest):
    if req.skill_id == "failure_hunter":
        return execute_failure_hunter(req.params)
    if req.skill_id == "pr_reaper":
        return execute_pr_reaper(req.params)

    file_path = os.path.join(SKILLS_DIR, f"{req.skill_id}.sql")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Skill not found")
    
    with open(file_path, "r") as f:
        template_str = f.read()
    
    # Render template with params
    template = Template(template_str)
    query = template.render(**req.params)
    
    # Execute query
    output = run_coral_query(query)
    
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"raw_output": output}

@app.get("/api/tables")
def list_tables():
    output = run_coral_query("SELECT schema_name, table_name FROM coral.tables ORDER BY 1, 2")
    return json.loads(output)

@app.get("/api/columns/{table}")
def list_columns(table: str):
    output = run_coral_query(f"SELECT column_name, data_type FROM coral.columns WHERE table_name = '{table}'")
    return json.loads(output)

@app.post("/api/connect")
def connect_source(data: Dict[str, str]):
    source = data.get("source")
    token = data.get("token")
    if not source or not token:
        raise HTTPException(status_code=400, detail="Source and token required")
    
    try:
        # For other sources, we can map them similarly
        env_key = f"{source.upper()}_TOKEN"
        
        if source.lower() == "github":
            env_key = "GITHUB_TOKEN"

        # Run env_key=xxx wsl coral source add <source>
        cmd = ["wsl", "-d", "Ubuntu-24.04", "--", "bash", "-c", f"{env_key}={token} /root/.local/bin/coral source add {source.lower()}"]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        return {"status": "success", "message": f"{source} connected successfully"}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect {source}: {e.stderr}")

@app.get("/api/status")
def get_status():
    try:
        result = subprocess.run(["wsl", "-d", "Ubuntu-24.04", "--", "/root/.local/bin/coral", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            return {"coral_installed": True, "version": result.stdout.strip()}
        else:
            return {"coral_installed": False, "message": "Coral not responding in WSL"}
    except Exception as e:
        return {"coral_installed": False, "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
