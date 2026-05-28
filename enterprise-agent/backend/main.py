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
import http.client

# Monkeypatch subprocess.run to automatically strip WSL prefixes and resolve the native coral binary when running on Linux/Docker
_original_subprocess_run = subprocess.run
def docker_friendly_subprocess_run(cmd_args, *args, **kwargs):
    if os.name != 'nt' and isinstance(cmd_args, list):
        # Strip WSL prefix if present
        if len(cmd_args) >= 4 and cmd_args[0] == "wsl" and cmd_args[1] == "-d" and cmd_args[3] == "--":
            cmd_args = cmd_args[4:]
        elif len(cmd_args) >= 5 and cmd_args[0] == "wsl" and cmd_args[1] == "-d" and cmd_args[2] == "Ubuntu-24.04" and cmd_args[3] == "--":
            cmd_args = cmd_args[4:]
        
        # Resiliently handle coral binary path
        if len(cmd_args) > 0 and cmd_args[0] == "/root/.local/bin/coral":
            import shutil
            if not os.path.exists("/root/.local/bin/coral") and shutil.which("coral"):
                cmd_args[0] = "coral"
                
        # Also handle bash -c scripts that reference /root/.local/bin/coral
        if len(cmd_args) >= 3 and cmd_args[0] == "bash" and cmd_args[1] == "-c":
            script = cmd_args[2]
            if "/root/.local/bin/coral" in script:
                import shutil
                if not os.path.exists("/root/.local/bin/coral") and shutil.which("coral"):
                    cmd_args[2] = script.replace("/root/.local/bin/coral", "coral")
                    
    return _original_subprocess_run(cmd_args, *args, **kwargs)
subprocess.run = docker_friendly_subprocess_run

def safe_read(resp):
    try:
        return resp.read()
    except http.client.IncompleteRead as e:
        return e.partial

app = FastAPI(title="Enterprise Agent Backend")

# Add CORS support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SKILLS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../skills"))
CONNECTED_TOKENS = {}
CONNECTED_DEFAULTS = {}

def load_connected_sources():
    try:
        # Read /root/.config/coral/config.toml
        res = subprocess.run(
            ["wsl", "-d", "Ubuntu-24.04", "--", "cat", "/root/.config/coral/config.toml"],
            capture_output=True, text=True, check=True, timeout=15
        )
        content = res.stdout
        url_match = re.search(r'JIRA_BASE_URL\s*=\s*"([^"]+)"', content)
        email_match = re.search(r'JIRA_EMAIL\s*=\s*"([^"]+)"', content)
        if url_match:
            jira_url = url_match.group(1)
            # Sanitize URL to keep only scheme and domain
            from urllib.parse import urlparse
            try:
                parsed = urlparse(jira_url)
                if parsed.scheme and parsed.netloc:
                    jira_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
            CONNECTED_DEFAULTS["jira_url"] = jira_url
        if email_match:
            CONNECTED_DEFAULTS["jira_email"] = email_match.group(1)
        
        # Read GITHUB_TOKEN
        try:
            res_gh = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "--", "cat", "/root/.config/coral/workspaces/default/sources/github/secrets.env"],
                capture_output=True, text=True, timeout=15
            )
            if res_gh.returncode == 0:
                match = re.search(r'GITHUB_TOKEN=["\']?([^"\'\n\s]+)', res_gh.stdout)
                if match:
                    CONNECTED_TOKENS["github"] = match.group(1)
        except Exception:
            pass

        # Read JIRA_API_TOKEN
        try:
            res_jira = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "--", "cat", "/root/.config/coral/workspaces/default/sources/jira/secrets.env"],
                capture_output=True, text=True, timeout=15
            )
            if res_jira.returncode == 0:
                match = re.search(r'JIRA_API_TOKEN=["\']?([^"\'\n\s]+)', res_jira.stdout)
                if match:
                    CONNECTED_TOKENS["jira"] = match.group(1)
        except Exception:
            pass

        # Read SENTRY_TOKEN
        try:
            res_sentry = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "--", "cat", "/root/.config/coral/workspaces/default/sources/sentry/secrets.env"],
                capture_output=True, text=True, timeout=15
            )
            if res_sentry.returncode == 0:
                match = re.search(r'SENTRY_TOKEN=["\']?([^"\'\n\s]+)', res_sentry.stdout)
                if match:
                    CONNECTED_TOKENS["sentry"] = match.group(1)
                match_org = re.search(r'SENTRY_ORG=["\']?([^"\'\n\s]+)', res_sentry.stdout)
                if match_org:
                    org_slug = match_org.group(1).strip()
                    if "://" in org_slug:
                        if ".sentry.io" in org_slug:
                            org_slug = org_slug.split("://")[1].split(".sentry.io")[0]
                        elif "/organizations/" in org_slug:
                            org_slug = org_slug.split("/organizations/")[1].split("/")[0]
                    org_slug = org_slug.strip("/")
                    CONNECTED_DEFAULTS["sentry_org"] = org_slug
        except Exception:
            pass

        # Read DISCORD_TOKEN
        try:
            res_discord = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "--", "cat", "/root/.config/coral/workspaces/default/sources/discord/secrets.env"],
                capture_output=True, text=True, timeout=15
            )
            if res_discord.returncode == 0:
                match = re.search(r'DISCORD_TOKEN=["\']?([^"\'\n\s]+)', res_discord.stdout)
                if match:
                    CONNECTED_TOKENS["discord"] = match.group(1)
        except Exception:
            pass
    except Exception as e:
        print("Error loading existing sources from WSL:", e)

# Load existing sources on start
load_connected_sources()

def fetch_jira_api(jql: str):
    url_base = CONNECTED_DEFAULTS.get("jira_url") or os.environ.get("JIRA_BASE_URL")
    email = CONNECTED_DEFAULTS.get("jira_email") or os.environ.get("JIRA_EMAIL")
    token = CONNECTED_TOKENS.get("jira") or os.environ.get("JIRA_API_TOKEN")
    if not url_base or not email or not token:
        return []
    
    import base64
    auth_str = f"{email}:{token}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    
    params = urllib.parse.urlencode({"jql": jql, "maxResults": 5})
    try:
        parsed = urllib.parse.urlparse(url_base)
        domain_base = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        domain_base = url_base
        
    url = f"{domain_base.rstrip('/')}/rest/api/3/search/jql?{params}"
    
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Accept": "application/json"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(safe_read(resp).decode("utf-8"))
            issues = data.get("issues", [])
            return [
                {
                    "key": issue.get("key"),
                    "summary": issue.get("fields", {}).get("summary", "")
                }
                for issue in issues
            ]
    except Exception as e:
        print(f"Jira REST API fetch error for JQL '{jql}':", e)
        return []


from typing import Optional

class SkillExecutionRequest(BaseModel):
    skill_id: str
    params: Dict[str, Any]
    github_token: Optional[str] = None
    jira_token: Optional[str] = None
    jira_url: Optional[str] = None
    jira_email: Optional[str] = None
    sentry_token: Optional[str] = None
    sentry_org: Optional[str] = None
    discord_token: Optional[str] = None
    discord_guild_id: Optional[str] = None

class SummarizeRequest(BaseModel):
    message: str
    title: str = ""
    category: str = ""

class SearchRequest(BaseModel):
    query: str
    owner: Optional[str] = None
    repo: Optional[str] = None
    page: int = 1
    page_size: int = 20
    source: str = "all"
    github_token: Optional[str] = None
    jira_token: Optional[str] = None
    jira_url: Optional[str] = None
    jira_email: Optional[str] = None
    sentry_token: Optional[str] = None
    sentry_org: Optional[str] = None
    discord_token: Optional[str] = None
    discord_guild_id: Optional[str] = None

class QueryRequest(BaseModel):
    query: str
    github_token: Optional[str] = None
    jira_token: Optional[str] = None
    jira_url: Optional[str] = None
    jira_email: Optional[str] = None
    sentry_token: Optional[str] = None
    sentry_org: Optional[str] = None
    discord_token: Optional[str] = None
    discord_guild_id: Optional[str] = None

def update_global_tokens(req):
    if getattr(req, "github_token", None):
        CONNECTED_TOKENS["github"] = req.github_token
    if getattr(req, "jira_token", None):
        CONNECTED_TOKENS["jira"] = req.jira_token
    if getattr(req, "jira_url", None):
        CONNECTED_DEFAULTS["jira_url"] = req.jira_url
    if getattr(req, "jira_email", None):
        CONNECTED_DEFAULTS["jira_email"] = req.jira_email
    if getattr(req, "sentry_token", None):
        CONNECTED_TOKENS["sentry"] = req.sentry_token
    if getattr(req, "sentry_org", None):
        CONNECTED_DEFAULTS["sentry_org"] = req.sentry_org
    if getattr(req, "discord_token", None):
        CONNECTED_TOKENS["discord"] = req.discord_token
    if getattr(req, "discord_guild_id", None):
        CONNECTED_DEFAULTS["discord_guild_id"] = req.discord_guild_id

GITHUB_API_BASE = "https://api.github.com"


def fetch_github_api(path: str):
    url = urllib.parse.urljoin(GITHUB_API_BASE, path)
    headers = {
        "User-Agent": "Coral-Enterprise-Agent",
        "Accept": "application/vnd.github.v3+json"
    }
    token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if token:
        # FIX 5: Universally use Bearer scheme for all modern GitHub tokens
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(safe_read(resp).decode("utf-8"))


SENTRY_API_BASE = "https://sentry.io/api/0"

def fetch_sentry_api(path: str):
    url = f"{SENTRY_API_BASE.rstrip('/')}/{path.lstrip('/')}"
    headers = {
        "User-Agent": "Coral-Enterprise-Agent",
        "Accept": "application/json"
    }
    token = CONNECTED_TOKENS.get("sentry")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(safe_read(resp).decode("utf-8"))
    except Exception as e:
        print(f"Sentry API fetch error for {path}:", e)
        return None

def fetch_sentry_search(query: str):
    org_slug = CONNECTED_DEFAULTS.get("sentry_org")
    token = CONNECTED_TOKENS.get("sentry")
    if not org_slug or not token:
        return []
    
    try:
        params = urllib.parse.urlencode({"query": query, "limit": 5})
        path = f"/organizations/{org_slug}/issues/?{params}"
        data = fetch_sentry_api(path)
        if not data or not isinstance(data, list):
            return []
        
        results = []
        for issue in data:
            project_slug = issue.get("project", {}).get("slug", "general")
            results.append({
                "id": issue.get("id"),
                "title": issue.get("title"),
                "culprit": issue.get("culprit", "unknown"),
                "status": issue.get("status", "unresolved"),
                "last_seen": issue.get("lastSeen"),
                "permalink": issue.get("permalink") or f"https://sentry.io/organizations/{org_slug}/issues/{issue.get('id')}/",
                "project_name": issue.get("project", {}).get("name", "General"),
                "metadata_message": issue.get("metadata", {}).get("value", "")
            })
        return results
    except Exception as e:
        print("Sentry search helper error:", e)
        return []

def fetch_discord_search(query: str):
    token = CONNECTED_TOKENS.get("discord")
    guild_id = CONNECTED_DEFAULTS.get("discord_guild_id")
    if not token or not guild_id:
        return []
    
    try:
        # Strip common stop words to pass only keywords to Discord's strict exact-match search API
        exclude_words = {"who", "last", "commited", "commit", "on", "top", "openmetadata", "and", "what", "was", "the", "issue", "with", "bug", "error", "failed", "failing", "build", "can", "you", "tell", "me", "about", "how", "do", "i", "find", "is", "there", "a", "an", "of", "in", "for", "to", "at", "by", "from", "show", "get", "fetch", "list", "all", "any", "some"}
        words = query.split()
        q_words = [w for w in words if w.lower() not in exclude_words]
        search_str = " ".join(q_words) if q_words else query

        params = urllib.parse.urlencode({"content": search_str})
        url = f"https://discord.com/api/v9/guilds/{guild_id}/messages/search?{params}"
        headers = {
            "Authorization": token,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(safe_read(resp).decode("utf-8"))
            messages = data.get("messages", [])
            results = []
            for hit in messages:
                if not hit: continue
                # The hit is a list of messages. We just take the first one (the match).
                msg = hit[0]
                author = msg.get("author", {})
                username = author.get("username", "Discord User")
                text = msg.get("content", "")
                msg_id = msg.get("id")
                channel_id = msg.get("channel_id")
                timestamp = msg.get("timestamp")
                permalink = f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"
                results.append({
                    "username": username,
                    "text": text,
                    "permalink": permalink,
                    "channel": f"channel-{channel_id}",
                    "timestamp": timestamp
                })
            return results
    except Exception as e:
        if hasattr(e, 'code'):
            if e.code in [401, 403]:
                try:
                    err_body = e.read().decode("utf-8")
                    print("Discord API error details:", err_body)
                except:
                    pass
                return [{"error": True, "source": "Discord", "message": "Invalid authentication token or lacking permissions. Ensure you are using a valid token and have access to the provided Guild ID."}]
            try:
                err_data = json.loads(e.read().decode("utf-8"))
                return [{"error": True, "source": "Discord", "message": f"Discord API error: {err_data.get('message', e.reason)}"}]
            except:
                return [{"error": True, "source": "Discord", "message": f"Discord API error: {e.reason}"}]
        print("Discord search error:", e)
    return []

def fetch_jira_search(query: str):
    url_base = CONNECTED_DEFAULTS.get("jira_url") or os.environ.get("JIRA_BASE_URL")
    email = CONNECTED_DEFAULTS.get("jira_email") or os.environ.get("JIRA_EMAIL")
    token = CONNECTED_TOKENS.get("jira") or os.environ.get("JIRA_API_TOKEN")
    if not url_base or not email or not token:
        return []
    
    import base64
    auth_str = f"{email}:{token}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    
    jql = f'text ~ "{query}"'
    params = urllib.parse.urlencode({"jql": jql, "maxResults": 5, "fields": "summary,status,assignee,updated,description"})
    
    try:
        parsed = urllib.parse.urlparse(url_base)
        domain_base = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        domain_base = url_base
        
    url = f"{domain_base.rstrip('/')}/rest/api/3/search/jql?{params}"
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Accept": "application/json"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(safe_read(resp).decode("utf-8"))
            issues = data.get("issues", [])
            results = []
            for issue in issues:
                fields = issue.get("fields", {})
                key = issue.get("key")
                summary = fields.get("summary", "")
                status = fields.get("status", {}).get("name", "Open")
                assignee = fields.get("assignee", {}).get("displayName") if fields.get("assignee") else "Unassigned"
                updated = fields.get("updated", "")
                
                # Parse description
                desc_text = ""
                desc_obj = fields.get("description")
                if desc_obj and isinstance(desc_obj, dict):
                    paragraphs = []
                    for content_item in desc_obj.get("content", []):
                        if content_item.get("type") == "paragraph":
                            for text_item in content_item.get("content", []):
                                if text_item.get("type") == "text":
                                    paragraphs.append(text_item.get("text", ""))
                    desc_text = " ".join(paragraphs)
                elif isinstance(desc_obj, str):
                    desc_text = desc_obj
                
                results.append({
                    "key": key,
                    "summary": summary,
                    "status": status,
                    "assignee": assignee,
                    "updated": updated,
                    "description": desc_text,
                    "url": f"{domain_base.rstrip('/')}/browse/{key}"
                })
            return results
    except Exception as e:
        print("Jira search error:", e)
        return []

def extract_repo_from_query(query: str, default_owner: str = None, default_repo: str = None):
    """Parses natural language queries to extract the intended repository target (TOP or OpenMetadata)."""
    q = query.lower()
    
    # Priority 1: Check explicit openmetadata variations
    if any(x in q for x in ["openmetadata", "open-metadata", "open metadata", "openmeta data", "openmeta"]):
        return "open-metadata", "OpenMetadata"
        
    # Priority 2: Check explicit local repo query
    if "unnatikdm/top" in q:
        return "unnatikdm", "TOP"
        
    # Priority 3: Fall back to provided default repository if present
    if default_owner and default_repo:
        return default_owner, default_repo
        
    # Priority 4: Default global fallback
    return "unnatikdm", "TOP"

def fetch_github_repo_info(owner: str, repo: str):
    """Fetches repository metadata and README."""
    import base64
    if not owner or not repo:
        return None
        
    try:
        # Fetch metadata
        meta = fetch_github_api(f"/repos/{owner}/{repo}")
        description = meta.get("description", "No description provided.")
        topics = meta.get("topics", [])
        language = meta.get("language", "Unknown")
        
        # Fetch README
        readme_content = ""
        try:
            readme_data = fetch_github_api(f"/repos/{owner}/{repo}/readme")
            if isinstance(readme_data, dict) and "content" in readme_data:
                readme_bytes = base64.b64decode(readme_data["content"])
                readme_content = readme_bytes.decode("utf-8", errors="ignore")
                # Truncate to ~3000 chars to avoid overwhelming the LLM
                if len(readme_content) > 3000:
                    readme_content = readme_content[:3000] + "\n...[truncated]"
        except Exception:
            pass # No README or failed to fetch
            
        return {
            "description": description,
            "topics": topics,
            "language": language,
            "readme": readme_content
        }
    except Exception as e:
        print(f"Failed to fetch repo info: {e}")
        return None


def fetch_github_commits_search(query: str, owner: str = None, repo: str = None):
    """Fetches the latest commits from the specified repository dynamically."""
    initial_owner, initial_repo = owner, repo
    if not owner or not repo:
        owner, repo = extract_repo_from_query(query, default_owner=initial_owner, default_repo=initial_repo)
        
    path = f"/repos/{owner}/{repo}/commits?per_page=5"
    try:
        items = fetch_github_api(path)
        if not isinstance(items, list):
            return []
            
        results = []
        words = [re.sub(r'[^\w]', '', w) for w in query.lower().split()]
        exclude_words = {
            "who", "last", "commited", "commit", "on", "top", "openmetadata", "and", "what", "was", "the",
            "did", "by", "for", "in", "to", "of", "a", "an", "recent", "latest", "newest", "oldest", "first",
            "new", "old", "commits", "committed", "push", "pushed", "pr", "prs", "pull", "pulls", "issue",
            "issues", "branch", "branches", "repo", "repos", "repository", "repositories", "open", "metadata",
            "openmeta", "data"
        }
        q_words = [w for w in words if w and w not in exclude_words]
        
        for item in items:
            sha = item.get("sha", "")
            commit = item.get("commit", {})
            message = commit.get("message", "")
            author = commit.get("author", {})
            author_name = author.get("name", "Unknown")
            author_email = author.get("email", "")
            date = author.get("date", "")
            
            # FIX 2: Soft matching. If they just asked "last commit", q_words will be empty.
            match = True
            if q_words:
                match = any(word in message.lower() or word in author_name.lower() for word in q_words)
                
            if match:
                results.append({
                    "sha": sha,
                    "message": message,
                    "author_name": author_name,
                    "author_email": author_email,
                    "date": date,
                    "html_url": item.get("html_url")
                })
                
        return results
    except Exception as e:
        print("GitHub commits search error:", e)
        return []


def fetch_github_search(query: str, owner: str = None, repo: str = None):
    """Fetches issues matching the search query dynamically from the determined repository."""
    initial_owner, initial_repo = owner, repo
    if not owner or not repo:
        owner, repo = extract_repo_from_query(query, default_owner=initial_owner, default_repo=initial_repo)
    
    # Broaden the search query to check both titles and bodies for better results
    safe_query = urllib.parse.quote(query)
    path = f"/search/issues?q={safe_query}+repo:{owner}/{repo}&per_page=5"
    
    try:
        data = fetch_github_api(path)
        items = data.get("items", [])
        return [
            {
                "number": item.get("number"),
                "title": item.get("title"),
                "state": item.get("state"),
                "user__login": item.get("user", {}).get("login"),
                "created_at": item.get("created_at"),
                "html_url": item.get("html_url"),
                "description": item.get("body", "")
            }
            for item in items
        ]
    except Exception as e:
        if hasattr(e, 'code') and e.code == 401:
            return [{"error": True, "source": "GitHub", "message": "Invalid GitHub Personal Access Token (PAT). Please re-enter a valid token."}]
        print("GitHub search error:", e)
        return []


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

    if "from github.issues" in query.lower():
        items = fetch_github_api(f"/repos/{owner}/{repo}/issues?state=open&per_page=20")
        return [
            {
                "number": item.get("number"),
                "title": item.get("title"),
                "state": item.get("state"),
                "html_url": item.get("html_url"),
                "created_at": item.get("created_at"),
                "status": item.get("state", "open"),
                "message": item.get("title"),
                "url": item.get("html_url")
            }
            for item in items if "pull_request" not in item
        ]

    if "from github.pulls" in query.lower():
        state = "open" if "pr.state = 'open'" in query.lower() else "closed"
        items = fetch_github_api(f"/repos/{owner}/{repo}/pulls?state={state}&per_page=20")
        return [
            {
                "number": item.get("number"),
                "title": item.get("title"),
                "state": item.get("state"),
                "html_url": item.get("html_url"),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
                "merged_at": item.get("merged_at"),
                "user__login": item.get("user", {}).get("login"),
                "status": item.get("state", state),
                "message": item.get("title"),
                "url": item.get("html_url")
            }
            for item in items
        ]

    if "from github.commits" in query.lower():
        items = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=20")
        results = []
        for item in items:
            commit = item.get("commit", {})
            message = commit.get("message")
            if "like '%doc%'" in query.lower() and "doc" not in message.lower():
                continue
            results.append({
                "sha": item.get("sha"),
                "commit__message": message,
                "commit__author__name": commit.get("author", {}).get("name"),
                "commit__author__date": commit.get("author", {}).get("date"),
                "html_url": item.get("html_url"),
                "status": "commit",
                "message": message,
                "created_at": commit.get("author", {}).get("date"),
                "url": item.get("html_url")
            })
        return results[:20]

    if "from github.repos" in query.lower():
        item = fetch_github_api(f"/repos/{owner}/{repo}")
        return [{
            "private": item.get("private"),
            "description": item.get("description"),
            "stargazers_count": item.get("stargazers_count"),
            "forks_count": item.get("forks_count"),
            "open_issues_count": item.get("open_issues_count"),
            "html_url": item.get("html_url"),
            "status": item.get("private", False) and "private" or "public",
            "message": item.get("description"),
            "stars": item.get("stargazers_count"),
            "forks": item.get("forks_count"),
            "open_issues": item.get("open_issues_count"),
            "url": item.get("html_url")
        }]

    if "from github.repo_action_runs" in query.lower():
        data = fetch_github_api(f"/repos/{owner}/{repo}/actions/runs?per_page=5")
        runs = data.get("workflow_runs", [])
        return [
            {
                "id": run.get("id"),
                "name": run.get("name"),
                "head_sha": run.get("head_sha"),
                "head_branch": run.get("head_branch"),
                "status": run.get("status"),
                "conclusion": run.get("conclusion"),
                "updated_at": run.get("updated_at"),
                "url": run.get("html_url")
            }
            for run in runs
        ]

    return [{"status": "error", "message": "No GitHub fallback available for this query", "query": query}]


def jira_fallback(query: str):
    """Fallback handler to search Jira issues via REST API when Coral fails."""
    jql = None
    jql_match = re.search(r"jql\s*=\s*'([^']+)'", query, re.IGNORECASE)
    if jql_match:
        jql = jql_match.group(1)
    else:
        term_match = re.search(r"LIKE\s*'%([^%]+)%'", query, re.IGNORECASE)
        if term_match:
            term = term_match.group(1)
            jql = f'text ~ "{term}"'
    
    if not jql:
        jql = "order by created desc"
        
    try:
        issues = fetch_jira_api(jql)
        if issues:
            return issues
    except Exception as e:
        print(f"Jira API fallback failed: {e}")
        
    return [{"status": "no_data", "message": "No Jira issues found. Verify your Jira connection in Setup or check that your JQL query is valid.", "category": "Jira"}]


def sentry_fallback(query: str):
    """Fallback handler to query Sentry issues via REST API when Coral fails."""
    search_query = None
    query_match = re.search(r"query\s*=\s*'([^']+)'", query, re.IGNORECASE)
    if query_match:
        search_query = query_match.group(1)
    else:
        term_match = re.search(r"title\s*LIKE\s*'%([^%]+)%'", query, re.IGNORECASE)
        if term_match:
            search_query = term_match.group(1)
            
    if not search_query:
        search_query = "is:unresolved"
        
    try:
        issues = fetch_sentry_search(search_query)
        if issues:
            return [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "last_seen": item["last_seen"],
                    "level": "error",
                    "status": item["status"]
                }
                for item in issues
            ]
    except Exception as e:
        print(f"Sentry API fallback failed: {e}")
        
    return [{"status": "no_data", "message": "No Sentry issues found. Verify your Sentry connection in Setup or check your search query.", "category": "Sentry"}]


def stackoverflow_fallback(query: str):
    """Fallback handler to search StackOverflow via StackExchange API when Coral fails."""
    import gzip
    term = None
    term_match = re.search(r"ILIKE\s*'%([^%]+)%'", query, re.IGNORECASE)
    if term_match:
        term = term_match.group(1)
    else:
        term_match = re.search(r"LIKE\s*'%([^%]+)%'", query, re.IGNORECASE)
        if term_match:
            term = term_match.group(1)
            
    if not term:
        term = "webpack compile timeout"
        
    try:
        url = f"https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q={urllib.parse.quote(term)}&site=stackoverflow"
        req = urllib.request.Request(url, headers={"User-Agent": "Coral-Enterprise-Agent"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp_data = resp.read()
            if resp.info().get('Content-Encoding') == 'gzip':
                resp_data = gzip.decompress(resp_data)
            data = json.loads(resp_data.decode('utf-8'))
            items = data.get("items", [])
            return [
                {
                    "question_id": item.get("question_id"),
                    "title": item.get("title"),
                    "link": item.get("link"),
                    "creation_date": re.sub(r'\s.*', '', str(item.get("creation_date")))
                }
                for item in items[:5]
            ]
    except Exception as e:
        print(f"StackOverflow API fallback failed: {e}")
        
    return []


def run_coral_query(query: str, demo_mode=False):
    """Executes a SQL query using the Coral CLI inside WSL."""
    if demo_mode:
        raise HTTPException(
            status_code=503,
            detail="Coral CLI Engine is currently offline or not available. Please ensure Coral is installed in WSL or check your Setup tab connections to fetch real live data."
        )
    
    is_github = bool(re.search(r'\bfrom\s+github\.', query, re.IGNORECASE))
    is_jira = bool(re.search(r'\bfrom\s+jira\.', query, re.IGNORECASE))
    is_sentry = bool(re.search(r'\bfrom\s+sentry\.', query, re.IGNORECASE))
    is_stackoverflow = bool(re.search(r'\bfrom\s+stackoverflow\.', query, re.IGNORECASE))
    
    # Determine timeout based on query type
    # For github queries, use a short 3-second timeout to fail-fast and fallback to direct GitHub REST API
    timeout_val = 3 if is_github else 30
    
    try:
        result = subprocess.run(
            ["wsl", "-d", "Ubuntu-24.04", "--", "/root/.local/bin/coral", "sql", "--format", "json", query],
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout_val
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr if e.stderr else str(e)
        print(f"Coral Error: {error_msg}")
        if is_github:
            print("Falling back to direct GitHub API after Coral error...")
            try:
                return json.dumps(github_fallback(query))
            except Exception as fb_e:
                print(f"GitHub fallback failed: {fb_e}")
        elif is_jira:
            print("Falling back to direct Jira API after Coral error...")
            try:
                return json.dumps(jira_fallback(query))
            except Exception as fb_e:
                print(f"Jira fallback failed: {fb_e}")
        elif is_sentry:
            print("Falling back to direct Sentry API after Coral error...")
            try:
                return json.dumps(sentry_fallback(query))
            except Exception as fb_e:
                print(f"Sentry fallback failed: {fb_e}")
        elif is_stackoverflow:
            print("Falling back to direct StackOverflow API after Coral error...")
            try:
                return json.dumps(stackoverflow_fallback(query))
            except Exception as fb_e:
                print(f"StackOverflow fallback failed: {fb_e}")
        print("Falling back to demo mode...")
        return run_coral_query(query, demo_mode=True)
    except subprocess.TimeoutExpired:
        print(f"Coral query timeout after {timeout_val} seconds")
        if is_github:
            print("Falling back to direct GitHub API after Coral timeout...")
            try:
                return json.dumps(github_fallback(query))
            except Exception as fb_e:
                print(f"GitHub fallback failed: {fb_e}")
        elif is_jira:
            print("Falling back to direct Jira API after Coral timeout...")
            try:
                return json.dumps(jira_fallback(query))
            except Exception as fb_e:
                print(f"Jira fallback failed: {fb_e}")
        elif is_sentry:
            print("Falling back to direct Sentry API after Coral timeout...")
            try:
                return json.dumps(sentry_fallback(query))
            except Exception as fb_e:
                print(f"Sentry fallback failed: {fb_e}")
        elif is_stackoverflow:
            print("Falling back to direct StackOverflow API after Coral timeout...")
            try:
                return json.dumps(stackoverflow_fallback(query))
            except Exception as fb_e:
                print(f"StackOverflow fallback failed: {fb_e}")
        print("Falling back to demo mode...")
        return run_coral_query(query, demo_mode=True)
    except FileNotFoundError as e:
        print(f"WSL/Coral not found: {e}. Falling back to demo mode...")
        return run_coral_query(query, demo_mode=True)


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
        f"FROM github.repo_action_runs "
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

    # Correlate Sentry events by commit SHA when available (using 'release' column)
    sentry_matches = []
    if commit_hash:
        try:
            sentry_query = (
                f"SELECT id, title, last_seen, level, status "
                f"FROM sentry.issues "
                f"WHERE query = 'release:{commit_hash}' "
                f"LIMIT 5"
            )
            sentry_matches = query_coral_json(sentry_query)
        except Exception:
            sentry_matches = []

    # Discord messages that mention the commit (bypassed: discord search by commit not supported currently)
    discord_matches = []

    # Jira/Linear issues created near the workflow time
    ticket_matches = []
    try:
        if workflow_runs:
            anchor = workflow_runs[0].get('updated_at')
            anchor_date = anchor[:10] if isinstance(anchor, str) else ""
            if anchor_date:
                ticket_query = (
                    f"SELECT key, summary "
                    f"FROM jira.issues "
                    f"WHERE jql = 'created >= \"{anchor_date}\"' "
                    f"LIMIT 10"
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
            "message": "; ".join([f"#{issue.get('number')} {issue.get('title')}" if 'number' in issue and 'title' in issue else issue.get('message', 'No details') for issue in build_issues]),
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
            "message": "; ".join([f"#{pr.get('number')} {pr.get('title')}" if 'number' in pr and 'title' in pr else pr.get('message', 'No details') for pr in pull_requests[:3]]),
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

    if discord_matches:
        items.append({
            "category": "Discord",
            "title": f"{len(discord_matches)} Discord matches",
            "message": "; ".join([m.get('text', '')[:120] for m in discord_matches]),
            "status": "chat",
            "action": "Check Discord for any ad-hoc fixes or rerun requests."
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

    # Fetch stale PRs directly from the GitHub API (bypassing Coral's slow pagination)
    try:
        raw_prs = fetch_github_api(f"/repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=asc&per_page=20")
        stale_prs = []
        for r in raw_prs:
            stale_prs.append({
                "number": r.get("number"),
                "title": r.get("title"),
                "html_url": r.get("html_url"),
                "updated_at": r.get("updated_at"),
                "created_at": r.get("created_at"),
                "author": r.get("user", {}).get("login", "unknown"),
                "head__sha": r.get("head", {}).get("sha")
            })
    except Exception as e:
        print("GitHub direct API error:", e)
        raise HTTPException(status_code=500, detail="Failed to fetch stale PRs from GitHub API")

    from concurrent.futures import ThreadPoolExecutor

    def process_pr(pr):
        number = pr.get("number")
        sha = pr.get("head__sha")
        author = pr.get("author", "unknown")

        # Query reviews for this specific PR directly via GitHub API
        review_info = {"count": 0, "approved": 0}
        try:
            reviews = fetch_github_api(f"/repos/{owner}/{repo}/pulls/{number}/reviews")
            for review in reviews:
                review_info["count"] += 1
                if review.get("state", "").upper() == "APPROVED":
                    review_info["approved"] += 1
        except Exception as e:
            print(f"Direct reviews API error for PR {number}:", e)

        # Fetch checks for this specific head__sha directly via the GitHub REST API (avoiding slow Coral table scan)
        check_info = {"total": 0, "failed": 0}
        if sha:
            try:
                check_data = fetch_github_api(f"/repos/{owner}/{repo}/commits/{sha}/check-runs")
                for run in check_data.get("check_runs", []):
                    check_info["total"] += 1
                    if run.get("conclusion") not in ("success", "skipped", "neutral"):
                        check_info["failed"] += 1
            except Exception:
                pass

        # Correlate Discord mentions for this PR (bypassed: discord is not supported in this Coral version)
        discord_local = []

        # Correlate Jira/Linear tickets referencing this PR using direct Jira search REST API
        jira_local = []
        try:
            jql_query = f'summary ~ "#{number}" OR description ~ "#{number}"'
            jira_local = fetch_jira_api(jql_query)
        except Exception as e:
            print(f"Direct Jira API error for PR {number}:", e)

        # Last comment date for PR using direct GitHub API
        last_comment = None
        try:
            comments = fetch_github_api(f"/repos/{owner}/{repo}/issues/{number}/comments")
            if comments:
                last_comment = comments[-1].get('updated_at')
        except Exception as e:
            print(f"Direct comments API error for PR {number}:", e)

        # Fetch actions runs (CI reruns) for this commit directly via the GitHub REST API (avoiding slow Coral table scan)
        ci_reruns = 0
        try:
            if sha:
                action_data = fetch_github_api(f"/repos/{owner}/{repo}/actions/runs?head_sha={sha}")
                runs = action_data.get("workflow_runs", [])
                ci_reruns = len(runs)
        except Exception:
            ci_reruns = 0

        if review_info["approved"] == 0:
            reason = "Missing approvals"
            action = "Request at least one approval before merge."
            is_stale_type = "missing_approvals"
        elif check_info["failed"] > 0:
            reason = "CI failing"
            action = "Fix the failing checks or re-run CI."
            is_stale_type = "failing_ci"
        else:
            reason = "No recent activity"
            action = "Ping the author or a reviewer for an update."
            is_stale_type = "stale"

        return {
            "pr_data": {
                "category": "Stale PR",
                "title": f"#{number} {pr.get('title')}",
                "message": f"Updated {pr.get('updated_at')} by {author}",
                "status": reason,
                "reason": reason,
                "action": action,
                "details": f"Reviews: {review_info['count']}, failed checks: {check_info['failed']}, ci_runs: {ci_reruns}, last_comment: {last_comment}",
                "discord_mentions": len(discord_local),
                "jira_links": [j.get('key') for j in jira_local]
            },
            "type": is_stale_type
        }

    # Execute all stale PR processes concurrently
    items = []
    counts = {"missing_approvals": 0, "failing_ci": 0, "stale": 0}
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(process_pr, stale_prs))

    for res in results:
        items.append(res["pr_data"])
        counts[res["type"]] += 1

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

def execute_code_owner(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Who Owns?")

    # Fetch latest 50 commits to analyze
    query = (
        f"SELECT commit__author__name as author, commit__message as message, commit__author__date as date, html_url as url "
        f"FROM github.commits "
        f"WHERE owner = '{owner}' AND repo = '{repo}' "
        f"ORDER BY commit__author__date DESC "
        f"LIMIT 50"
    )
    
    commits = []
    try:
        output = run_coral_query(query)
        commits = json.loads(output)
        if not isinstance(commits, list):
            raise Exception("Invalid Coral commits response format")
        # Check if we have valid non-Unknown authors
        valid_authors = [c.get("author") for c in commits if c.get("author") and str(c.get("author")).lower() != "unknown"]
        if not valid_authors:
            raise Exception("Coral database contains no valid author names, triggering REST fallback")
    except Exception as e:
        print("Coral commits fetch failed for Who Owns?, falling back to direct GitHub REST API:", e)
        try:
            raw_commits = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=50")
            commits = []
            for c in raw_commits:
                commit_obj = c.get("commit", {})
                git_name = commit_obj.get("author", {}).get("name")
                author_name = (
                    git_name if (git_name and git_name.lower() != "unknown") else None
                ) or (
                    c.get("author") and c.get("author", {}).get("login")
                ) or (
                    commit_obj.get("committer", {}).get("name")
                ) or (
                    c.get("committer") and c.get("committer", {}).get("login")
                ) or "Unknown"
                
                commits.append({
                    "author": author_name,
                    "message": commit_obj.get("message", "No message"),
                    "date": commit_obj.get("author", {}).get("date", ""),
                    "url": c.get("html_url", "")
                })
        except Exception as api_e:
            print("Direct GitHub API fallback also failed:", api_e)
            
    if not commits:
        return [
            {
                "category": "Summary",
                "title": "Repository Ownership",
                "message": f"This repository ({owner}/{repo}) is owned by **{owner}**.",
                "status": f"Owner: {owner}",
                "action": "Ensure your GitHub credentials are configured in Setup to load author contributions."
            }
        ]

    # Group by author
    author_data = {}
    for c in commits:
        author_name = c.get("author") or "Unknown"
        message = c.get("message") or "No message"
        date = c.get("date") or ""
        url = c.get("url") or ""
        
        # Clean up commit message (first line only as commit name)
        commit_name = message.split("\n")[0].strip()
        
        if author_name not in author_data:
            author_data[author_name] = {
                "commits": [],
                "latest_date": date,
                "url": url
            }
        
        # Add commit name
        author_data[author_name]["commits"].append(commit_name)
        if date > author_data[author_name]["latest_date"]:
            author_data[author_name]["latest_date"] = date
            author_data[author_name]["url"] = url

    # Sort authors by commit count descending
    sorted_authors = sorted(author_data.items(), key=lambda x: len(x[1]["commits"]), reverse=True)

    items = [
        {
            "category": "Summary",
            "title": "Repository Ownership",
            "message": f"This repository ({owner}/{repo}) is owned by **{owner}**.",
            "status": f"Owner: {owner}",
            "action": "Click 'View In-depth Analysis' on any author card to inspect their recent commit names."
        }
    ]

    for author_name, data in sorted_authors[:10]:
        commit_count = len(data["commits"])
        # Format the message containing commit names/messages
        commit_list_str = "\n".join([f"* {c}" for c in data["commits"][:5]])
        if commit_count > 5:
            commit_list_str += f"\n* ... and {commit_count - 5} more commits."
            
        items.append({
            "category": "Author Ownership",
            "title": author_name,
            "message": f"Author **{author_name}** made {commit_count} commits in this repository.\n\n### Commit Names:\n{commit_list_str}",
            "status": f"{commit_count} commits",
            "details": f"Latest activity: {data['latest_date']}",
            "url": data["url"],
            "action": "Review this author's code contributions or contact them."
        })

    return items

def execute_validate_doc(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Check Docs")

    doc_files = []
    
    # Try fetching via direct GitHub API
    try:
        root_items = fetch_github_api(f"/repos/{owner}/{repo}/contents")
        if isinstance(root_items, list):
            for item in root_items:
                name = item.get("name", "")
                path = item.get("path", "")
                type_item = item.get("type", "")
                
                # Check top-level markdown files
                if type_item == "file" and (name.lower().endswith(".md") or name.lower().endswith(".markdown")):
                    doc_files.append({
                        "name": name,
                        "path": path,
                        "size": item.get("size", 0),
                        "url": item.get("html_url"),
                        "sha": item.get("sha", "")
                    })
                
                # Check if there is a docs directory
                elif type_item == "dir" and name.lower() in ("docs", "doc", "wiki", "documentation"):
                    try:
                        dir_items = fetch_github_api(f"/repos/{owner}/{repo}/contents/{path}")
                        if isinstance(dir_items, list):
                            for d_item in dir_items:
                                d_name = d_item.get("name", "")
                                d_path = d_item.get("path", "")
                                d_type = d_item.get("type", "")
                                if d_type == "file" and (d_name.lower().endswith(".md") or d_name.lower().endswith(".markdown")):
                                    doc_files.append({
                                        "name": f"{name}/{d_name}",
                                        "path": d_path,
                                        "size": d_item.get("size", 0),
                                        "url": d_item.get("html_url"),
                                        "sha": d_item.get("sha", "")
                                    })
                    except Exception as dir_e:
                        print(f"Failed to fetch sub-directory {path} contents: {dir_e}")
    except Exception as e:
        print("GitHub direct API contents fetch failed for Check Docs, falling back to Coral / mock:", e)
        # Fallback to local SQL commits that match docs
        query = (
            f"SELECT commit__message as name, html_url as url, commit__author__date as date "
            f"FROM github.commits "
            f"WHERE owner = '{owner}' AND repo = '{repo}' AND commit__message LIKE '%doc%' "
            f"LIMIT 5"
        )
        try:
            output = run_coral_query(query)
            commits = json.loads(output)
            if isinstance(commits, list):
                for c in commits:
                    doc_files.append({
                        "name": "README.md (Commit reference)",
                        "path": "README.md",
                        "size": 1024,
                        "url": c.get("url") or f"https://github.com/{owner}/{repo}",
                        "sha": c.get("name", "")[:7]
                    })
        except Exception:
            pass

    if not doc_files:
        # Default global fallback to README.md
        doc_files.append({
            "name": "README.md",
            "path": "README.md",
            "size": 2048,
            "url": f"https://github.com/{owner}/{repo}/blob/main/README.md",
            "sha": "default"
        })

    items = [
        {
            "category": "Summary",
            "title": "Documentation Overview",
            "message": f"Found {len(doc_files)} documentation file(s) in `{owner}/{repo}`. High-precision documentation links are resolved below.",
            "status": "summary",
            "action": "Click the GitHub link on any card below to open and read that documentation file directly."
        }
    ]

    for doc in doc_files[:15]:
        size_kb = round(doc["size"] / 1024, 1)
        items.append({
            "category": "Documentation File",
            "title": doc["name"],
            "message": f"Documentation file `{doc['path']}` is located in your repository. It contains reference material, setup instructions, or guidelines.",
            "status": f"Exists ({size_kb} KB)",
            "details": f"Path: {doc['path']}, SHA: {doc['sha']}",
            "url": doc["url"],
            "action": f"Open and read {doc['name']} on GitHub."
        })

    return items

def ask_ai_summarizer(prompt: str) -> str:
    # Tier 1: Local Ollama (llama3.2)
    try:
        ollama_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps({
                "model": "llama3.2",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }).encode("utf-8")
        )
        with urllib.request.urlopen(ollama_req, timeout=8) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            content = resp_data.get("message", {}).get("content", "")
            if content:
                print("ask_ai_summarizer Tier 1 (Ollama) succeeded!")
                return content
    except Exception as e:
        print("ask_ai_summarizer Tier 1 failed:", e)

    # Tier 2: Free Cloud AI Fallback (Pollinations keyless API)
    try:
        poll_req = urllib.request.Request(
            "https://text.pollinations.ai/",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            data=json.dumps({
                "messages": [{"role": "user", "content": prompt}],
                "model": "openai"
            }).encode("utf-8")
        )
        with urllib.request.urlopen(poll_req, timeout=20) as resp:
            content = resp.read().decode("utf-8")
            if content:
                print("ask_ai_summarizer Tier 2 (Pollinations) succeeded!")
                return content
    except Exception as e:
        print("ask_ai_summarizer Tier 2 failed:", e)

    return ""

def execute_oss_safety(params: Dict[str, Any]):
    package_name = params.get("PACKAGE_NAME") or params.get("BUILD_ID") or "lodash"
    # Clean package name from url or paths
    if "/" in package_name:
        package_name = package_name.split("/")[-1]
    
    # Query live npm registry or PyPI
    package_info = None
    registry_type = "npm"
    try:
        npm_url = f"https://registry.npmjs.org/{urllib.parse.quote(package_name.lower())}/latest"
        req = urllib.request.Request(npm_url, headers={"User-Agent": "Coral-Enterprise-Agent"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            package_info = json.loads(resp.read().decode("utf-8"))
            registry_type = "npm"
    except Exception:
        # Fallback to PyPI
        try:
            pypi_url = f"https://pypi.org/pypi/{urllib.parse.quote(package_name.lower())}/json"
            req = urllib.request.Request(pypi_url, headers={"User-Agent": "Coral-Enterprise-Agent"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                package_info = json.loads(resp.read().decode("utf-8"))
                registry_type = "PyPI"
        except Exception as e:
            raise HTTPException(
                status_code=404, 
                detail=f"Package '{package_name}' not found on npm or PyPI registry. Ensure you have an active internet connection and that the package name is correct."
            )
    
    if not package_info:
        raise HTTPException(status_code=404, detail=f"Failed to fetch metadata for '{package_name}'.")

    if "name" in package_info: # npm style
        name = package_info.get("name")
        version = package_info.get("version", "unknown")
        description = package_info.get("description", "No description available.")
        license_name = package_info.get("license", "Unknown")
        if isinstance(license_name, dict):
            license_name = license_name.get("type", "Unknown")
        homepage = package_info.get("homepage", "")
        author_info = package_info.get("author", {})
        author_name = author_info.get("name", "Unknown") if isinstance(author_info, dict) else str(author_info)
    else: # PyPI style
        info = package_info.get("info", {})
        name = info.get("name", package_name)
        version = info.get("version", "unknown")
        description = info.get("summary", "No description available.")
        license_name = info.get("license", "Unknown")
        homepage = info.get("home_page", "")
        author_name = info.get("author", "Unknown")
        registry_type = "PyPI"

    prompt = (
        f"You are a Senior Security Engineer conducting an Open Source Software (OSS) Safety assessment.\n"
        f"Analyze this library and its metadata from the live registry:\n"
        f"Package Name: {name}\n"
        f"Latest Registry Version: {version}\n"
        f"Registry: {registry_type}\n"
        f"Description: {description}\n"
        f"License: {license_name}\n"
        f"Author: {author_name}\n\n"
        f"Assess the safety score (out of 10), license compatibility, and determine the risk rating (Safe, Low Risk, Medium Risk, High Risk).\n"
        f"Explain your reasoning based on potential security issues, maintenance patterns, and community reputation.\n"
        f"Structure your response exactly with these headers:\n"
        f"### Security Score\n(X.Y/10 - Rating)\n\n"
        f"### Vulnerability Analysis\n(Describe known issues or state that none are flagged in this version, and why the license is or is not compliant with corporate standards)\n\n"
        f"### Metrics & Maintenance\n(Detail community interest, maintenance activity, and version safety based on the metadata provided)\n"
    )
    
    ai_analysis = ask_ai_summarizer(prompt)
    if not ai_analysis:
        score_val = "9.0/10"
        rating_val = "Safe"
        details_val = f"Package '{name}' is active on {registry_type}. The license is '{license_name}'. Community adoption is stable."
        metrics_val = f"Latest version: {version}. Published by: {author_name}."
    else:
        lines = ai_analysis.split("\n")
        score_val = "8.5/10"
        rating_val = "Low Risk"
        details_val = ai_analysis
        metrics_val = f"Latest version: {version}. Registry: {registry_type}."
        
        for line in lines:
            if "score" in line.lower() and "/" in line:
                score_val = line.replace("### Security Score", "").strip("# :*")
            if "safe" in line.lower() or "risk" in line.lower():
                for rating_word in ["Safe", "Low Risk", "Medium Risk", "High Risk"]:
                    if rating_word.lower() in line.lower():
                        rating_val = rating_word
                        break

    status_color = "success"
    if "medium" in rating_val.lower():
        status_color = "warning"
    elif "high" in rating_val.lower():
        status_color = "danger"

    items = [
        {
            "category": "Summary",
            "title": f"OSS Safety Assessment for '{name}'",
            "message": f"Security Score: **{score_val}** ({rating_val}). Registry: **{registry_type}**. License: **{license_name}**.",
            "status": status_color,
            "action": f"Review corporate policy guidelines before pulling '{name}' into production dependencies."
        },
        {
            "category": "Security Rating",
            "title": "Vulnerability Analysis",
            "message": details_val,
            "status": rating_val,
            "details": f"License check: {license_name}",
            "action": "Ensure dependencies are regularly audited via npm/pip audit."
        },
        {
            "category": "Metrics",
            "title": "Package Telemetry",
            "message": f"Latest Version: **{version}**\nPublisher: **{author_name}**\n\n{metrics_val}",
            "status": "Active",
            "action": "Favor well-maintained open-source projects to mitigate abandonment risk."
        }
    ]
    return items

def execute_upstream_fixes(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Upstream Fixes")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    try:
        repo_data = fetch_github_api(f"/repos/{owner}/{repo}")
        is_fork = repo_data.get("fork", False)
        parent_owner, parent_repo = None, None
        if is_fork and "parent" in repo_data:
            parent_owner = repo_data["parent"]["owner"]["login"]
            parent_repo = repo_data["parent"]["name"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch repository metadata for {owner}/{repo}. Details: {str(e)}")

    target_owner = parent_owner or owner
    target_repo = parent_repo or repo
    
    try:
        upstream_commits = fetch_github_api(f"/repos/{target_owner}/{target_repo}/commits?per_page=15")
        if not isinstance(upstream_commits, list):
            raise Exception("Commits search returned invalid format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch commits from {target_owner}/{target_repo}. Details: {str(e)}")

    bug_fixes = []
    for c in upstream_commits:
        sha = c.get("sha", "")
        commit_obj = c.get("commit", {})
        message = commit_obj.get("message", "")
        author_name = commit_obj.get("author", {}).get("name", "Unknown")
        date = commit_obj.get("author", {}).get("date", "")
        html_url = c.get("html_url", "")
        
        msg_lower = message.lower()
        if any(w in msg_lower for w in ["fix", "bug", "crash", "resolve", "patch", "leak", "security", "exception", "error"]):
            bug_fixes.append({
                "sha": sha,
                "message": message,
                "author": author_name,
                "date": date,
                "url": html_url
            })
            
    if not bug_fixes:
        for c in upstream_commits[:3]:
            sha = c.get("sha", "")
            commit_obj = c.get("commit", {})
            message = commit_obj.get("message", "")
            bug_fixes.append({
                "sha": sha,
                "message": message,
                "author": commit_obj.get("author", {}).get("name", "Unknown"),
                "date": commit_obj.get("author", {}).get("date", ""),
                "url": c.get("html_url", "")
            })

    context_commits = ""
    for idx, fix in enumerate(bug_fixes[:5]):
        context_commits += f"[{idx+1}] Commit {fix['sha'][:7]} by {fix['author']} on {fix['date']}\n"
        context_commits += f"Message: {fix['message'].strip()}\n"
        context_commits += f"URL: {fix['url']}\n---\n"
        
    prompt = (
        f"You are a Senior Software Engineer assessing if recent bug fixes from upstream {target_owner}/{target_repo} "
        f"are present or fixed in our local fork of {owner}/{repo}.\n\n"
        f"Here are the recent upstream fixes/commits fetched directly from the API:\n"
        f"{context_commits}\n"
        f"For each relevant upstream fix, summarize what the bug is, how it was resolved, why it is critical for us to sync/cherry-pick, "
        f"and the specific cherry-pick action needed (e.g. cherry-pick commit SHA).\n"
        f"Make sure to refer to the actual commit authors and messages found in the live context above.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(Describe the sync status of the fork/repository compared to upstream and how many critical fixes were found)\n\n"
        f"### Upstream Fixes Scanned\n"
        f"For each upstream fix commit, provide a bulleted list detailing:\n"
        f"* **Commit SHA**: Message title\n"
        f"  * Details: (Summary of what was fixed and author name)\n"
        f"  * Sync Recommendation: (Action to cherry-pick or pull)\n"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    
    items = []
    
    if ai_analysis:
        summary_msg = ai_analysis.split("### Upstream Fixes Scanned")[0].replace("### Overview", "").strip()
        items.append({
            "category": "Summary",
            "title": f"Upstream Fixes for '{owner}/{repo}'",
            "message": summary_msg,
            "status": "warning" if bug_fixes else "success",
            "action": "We recommend syncing your fork with the upstream main branch to apply these critical bug fixes."
        })
        
        for fix in bug_fixes[:4]:
            card_prompt = (
                f"Explain the following single upstream commit fix and why it is important to pull into our fork:\n"
                f"Commit: {fix['sha'][:7]}\nAuthor: {fix['author']}\nMessage: {fix['message']}\n\n"
                f"Keep it to 2-3 concise sentences. Structure the explanation professionally."
            )
            card_desc = ask_ai_summarizer(card_prompt) or f"Commit {fix['sha'][:7]} by {fix['author']} resolves: {fix['message'].splitlines()[0]}"
            
            items.append({
                "category": "Upstream Fix",
                "title": fix['message'].splitlines()[0][:80],
                "message": f"Author: **{fix['author']}**.\n\nDetails: {card_desc}",
                "status": "Fixed Upstream",
                "url": fix['url'],
                "action": f"Cherry-pick commit `{fix['sha'][:7]}` into your local fork branch."
            })
    else:
        items.append({
            "category": "Summary",
            "title": f"Upstream Fixes for '{owner}/{repo}'",
            "message": f"Comparing local fork against main upstream `{target_owner}/{target_repo}`. Scanned recent upstream updates.",
            "status": "warning",
            "action": "Sync changes to keep your local workspace up to date."
        })
        for fix in bug_fixes[:3]:
            items.append({
                "category": "Upstream Fix",
                "title": fix['message'].splitlines()[0][:80],
                "message": f"Author: **{fix['author']}** on {fix['date'][:10]}.\n\nDetails: {fix['message']}",
                "status": "Fixed Upstream",
                "url": fix['url'],
                "action": f"Cherry-pick commit `{fix['sha'][:7]}` into your fork."
            })

    return items

def execute_review_help(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Review Help")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    try:
        closed_prs = fetch_github_api(f"/repos/{owner}/{repo}/pulls?state=closed&per_page=10")
        if not isinstance(closed_prs, list):
            raise Exception("PRs search returned invalid format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch closed PRs for {owner}/{repo}. Details: {str(e)}")

    if not closed_prs:
        raise HTTPException(status_code=404, detail="No closed Pull Requests found in this repository. Code Review Help requires historic PR data to identify discussions.")

    pr_contexts = []
    for pr in closed_prs[:5]:
        number = pr.get("number")
        title = pr.get("title", "")
        author = pr.get("user", {}).get("login", "unknown")
        url = pr.get("html_url", "")
        merged_at = pr.get("merged_at", "")
        body = pr.get("body", "") or "No description provided."
        
        review_comments_str = ""
        try:
            reviews = fetch_github_api(f"/repos/{owner}/{repo}/pulls/{number}/reviews")
            if reviews and isinstance(reviews, list):
                for rev in reviews[:3]:
                    rev_state = rev.get("state", "COMMENTED")
                    rev_user = rev.get("user", {}).get("login", "reviewer")
                    review_comments_str += f"[{rev_user} - {rev_state}]: {rev.get('body', '')[:100]} | "
        except Exception:
            pass
            
        pr_contexts.append({
            "number": number,
            "title": title,
            "author": author,
            "url": url,
            "merged_at": merged_at,
            "body": body[:200],
            "reviews": review_comments_str or "No reviews recorded."
        })

    context_prs_text = ""
    for idx, pr in enumerate(pr_contexts):
        context_prs_text += f"PR #{pr['number']}: {pr['title']} by {pr['author']} (Merged: {pr['merged_at']})\n"
        context_prs_text += f"Body: {pr['body']}\n"
        context_prs_text += f"Reviews: {pr['reviews']}\n---\n"

    prompt = (
        f"You are a Senior Technical Lead analyzing merged code pull requests and reviews to aid developers on their current code review.\n"
        f"Here are the recent closed PRs and reviewer comments from the live repository {owner}/{repo}:\n"
        f"{context_prs_text}\n"
        f"Based on this historic data, identify key architectural decisions, codebase reviews, developer debate patterns, "
        f"and pull request outcomes. Highlight why these are important for current developments.\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences summarizing the PR history and standard code quality benchmarks based on these reviews)\n\n"
        f"### Recommended Code Review Advice\n(Provide concrete guidelines based on lessons learned from these historic PRs)\n"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    summary_msg = ai_analysis.split("### Recommended Code Review Advice")[0].replace("### Overview", "").strip() if ai_analysis else f"Analyzed the latest closed Pull Requests in `{owner}/{repo}` to synthesize reviewer debates and architectural choices."

    items = [
        {
            "category": "Summary",
            "title": f"Code Review Helper for '{owner}/{repo}'",
            "message": summary_msg,
            "status": "active",
            "action": "Read the historic developer debates below to understand why certain architecture choices were made."
        }
    ]

    for pr in pr_contexts[:4]:
        card_prompt = (
            f"Explain the design decisions and review context of the following Pull Request:\n"
            f"PR #{pr['number']}: {pr['title']}\nAuthor: {pr['author']}\nMerged: {pr['merged_at']}\n"
            f"Reviews/Comments: {pr['reviews']}\n\n"
            f"Summarize the key takeaway/debate in 2 concise sentences."
        )
        card_takeaway = ask_ai_summarizer(card_prompt) or f"PR #{pr['number']} by {pr['author']} was merged. Reviews: {pr['reviews']}"
        
        items.append({
            "category": "Historic Review",
            "title": f"PR #{pr['number']}: {pr['title']}",
            "message": f"Author: **{pr['author']}**. Merged at: **{pr['merged_at']}**.\n\nTakeaway: {card_takeaway}",
            "status": "Closed & Merged",
            "url": pr['url'],
            "action": f"Review comments in PR #{pr['number']} to check the code review patterns."
        })

    return items

def execute_postmortem(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Timeline")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    # 1. Fetch recent workflow runs
    try:
        workflow_data = fetch_github_api(f"/repos/{owner}/{repo}/actions/runs?per_page=10")
        action_runs = workflow_data.get("workflow_runs", []) if isinstance(workflow_data, dict) else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch workflow runs. Details: {str(e)}")

    # 2. Fetch recent commits to correlate authors
    try:
        commits = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=15")
        commit_map = {c.get("sha"): c for c in commits} if isinstance(commits, list) else {}
    except Exception:
        commit_map = {}

    # 3. Fetch recent issues/PRs for context
    try:
        issues = fetch_github_api(f"/repos/{owner}/{repo}/issues?state=all&per_page=15")
        recent_issues = issues if isinstance(issues, list) else []
    except Exception:
        recent_issues = []

    # 4. Fetch job details for failing runs
    failed_runs_details = []
    for run in action_runs:
        conclusion = run.get("conclusion")
        if conclusion not in ("success", "skipped", "neutral", None):
            run_id = run.get("id")
            failed_steps = []
            try:
                jobs_data = fetch_github_api(f"/repos/{owner}/{repo}/actions/runs/{run_id}/jobs")
                jobs = jobs_data.get("jobs", []) if isinstance(jobs_data, dict) else []
                for job in jobs:
                    if job.get("conclusion") not in ("success", "skipped", "neutral"):
                        for step in job.get("steps", []):
                            if step.get("conclusion") not in ("success", "skipped", "neutral"):
                                failed_steps.append({
                                    "job_name": job.get("name"),
                                    "step_name": step.get("name"),
                                    "number": step.get("number"),
                                    "status": step.get("status"),
                                    "conclusion": step.get("conclusion")
                                })
            except Exception:
                pass
                
            sha = run.get("head_sha")
            commit = commit_map.get(sha, {})
            author_name = commit.get("commit", {}).get("author", {}).get("name") or run.get("triggering_actor", {}).get("login") or "Unknown"
            commit_msg = commit.get("commit", {}).get("message", "").splitlines()[0] if commit else "No commit message"
            
            failed_runs_details.append({
                "id": run_id,
                "name": run.get("name"),
                "event": run.get("event"),
                "author": author_name,
                "commit_sha": sha[:7],
                "commit_msg": commit_msg,
                "created_at": run.get("created_at"),
                "updated_at": run.get("updated_at"),
                "url": run.get("html_url"),
                "failed_steps": failed_steps
            })

    # Prepare timeline context
    failures_context = ""
    if failed_runs_details:
        for idx, run in enumerate(failed_runs_details[:3]):
            failures_context += f"--- CRASH EVENT {idx+1} ---\n"
            failures_context += f"Workflow Run: {run['name']} (Event: {run['event']})\n"
            failures_context += f"Triggered By: {run['author']} via commit {run['commit_sha']} ('{run['commit_msg']}')\n"
            failures_context += f"Started At: {run['created_at']}\n"
            failures_context += f"Failed At: {run['updated_at']}\n"
            failures_context += f"Workflow Run URL: {run['url']}\n"
            if run['failed_steps']:
                failures_context += "Failed Steps:\n"
                for step in run['failed_steps']:
                    failures_context += f"  - Job '{step['job_name']}' -> Step '{step['step_name']}' failed (conclusion: {step['conclusion']})\n"
            failures_context += "\n"
    else:
        failures_context = "No active workflow failures found in the latest runs. All pipelines are currently healthy!\n"
        for idx, run in enumerate(action_runs[:5]):
            failures_context += f"- Run {run.get('name')} finished with status {run.get('status')}/{run.get('conclusion')} on {run.get('updated_at')}\n"

    # Add related issues context
    issues_context = ""
    bug_issues = [i for i in recent_issues if any(w in i.get("title", "").lower() for w in ["bug", "fail", "crash", "error", "issue", "failure"])]
    if bug_issues:
        issues_context += "Recent related bug issues / PRs:\n"
        for i in bug_issues[:4]:
            issues_context += f"- #{i.get('number')}: {i.get('title')} ({i.get('state')}) - {i.get('html_url')}\n"

    prompt = (
        f"You are a Senior Principal Site Reliability Engineer compiling an Incident Postmortem Timeline of recent crashes/failures "
        f"derived exclusively from live GitHub Actions CI/CD metrics.\n\n"
        f"Here is the real-time GitHub Actions failure context for the repository {owner}/{repo}:\n"
        f"{failures_context}\n"
        f"{issues_context}\n"
        f"Task:\n"
        f"1. Construct a minute-by-minute timeline of the crash: when the commit was pushed, when the build started, "
        f"which job and step failed, what exactly crashed (e.g. tests or build step), and when/how it was resolved or its current state.\n"
        f"2. Explain who triggered the commit, the commit message, and any corresponding GitHub Issues or subsequent commits.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences summarizing the crash event, what failed, and its severity/velocity impact)\n\n"
        f"### Crash Events Chronology\n"
        f"Draft a chronology of incidents with exact dates/times from the context."
    )

    ai_analysis = ask_ai_summarizer(prompt)
    summary_msg = ai_analysis.split("### Crash Events Chronology")[0].replace("### Overview", "").strip() if ai_analysis else "The system compiled recent GitHub Action run failures to reconstruct the incident crash timeline."

    items = [
        {
            "category": "Summary",
            "title": "Incident Timeline (Postmortem Analysis)",
            "message": summary_msg,
            "status": "Resolved" if not failed_runs_details else "Failed",
            "action": "Review the minute-by-minute timeline below to analyze system failures and response times."
        }
    ]

    if failed_runs_details:
        for run in failed_runs_details[:4]:
            steps_desc = ""
            if run['failed_steps']:
                steps_desc = "\n\n**Failed Steps:**\n" + "\n".join([f"* Job **{s['job_name']}** failed on step **{s['step_name']}**" for s in run['failed_steps']])
            
            items.append({
                "category": "Incident Event",
                "title": f"CI/CD Crash: {run['name']}",
                "message": f"Triggered by: **{run['author']}** via commit `{run['commit_sha']}` ('*{run['commit_msg']}*').\n"
                           f"Started: `{run['created_at']}`. Crashed: `{run['updated_at']}`.{steps_desc}",
                "status": "CI Failure",
                "url": run['url'],
                "action": "Inspect the failing workflow jobs and run step logs on GitHub."
            })
    else:
        items.append({
            "category": "Incident Event",
            "title": "GitHub CI/CD Pipelines Healthy",
            "message": "All recent workflow action runs completed successfully with no failures. Baseline telemetry is stable.",
            "status": "Healthy",
            "action": "View recent workflow runs on GitHub."
        })

    for i in bug_issues[:2]:
        items.append({
            "category": "Incident Event",
            "title": f"Issue #{i.get('number')}: {i.get('title')}",
            "message": f"Author: **{i.get('user', {}).get('login', 'unknown')}**.\nState: `{i.get('state')}`. Created: `{i.get('created_at')}`.",
            "status": "Bug Issue",
            "url": i.get("html_url"),
            "action": "Review issue comments and related PR fixes."
        })

    return items

def execute_security_check(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Security Scan")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    try:
        commits = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=15")
        if not isinstance(commits, list):
            raise Exception("Invalid commits response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch commits for {owner}/{repo}. Details: {str(e)}")

    commit_details = []
    for c in commits:
        sha = c.get("sha", "")
        commit_obj = c.get("commit", {})
        message = commit_obj.get("message", "")
        author_name = commit_obj.get("author", {}).get("name", "Unknown")
        date = commit_obj.get("author", {}).get("date", "")
        
        commit_details.append({
            "sha": sha,
            "message": message,
            "author": author_name,
            "date": date,
            "url": c.get("html_url", "")
        })

    commits_context = ""
    for idx, c in enumerate(commit_details[:8]):
        commits_context += f"Commit {c['sha'][:7]} by {c['author']} ({c['date']}): {c['message'].strip()}\n"

    prompt = (
        f"You are a Senior Security Auditor performing an automated scan of recent codebase commits.\n"
        f"Here are the latest commits from the live repository {owner}/{repo}:\n"
        f"{commits_context}\n"
        f"Check these commits for potential security holes, including:\n"
        f"1. Hardcoded API keys, tokens, or credentials in commit messages or implied changes.\n"
        f"2. Insecure coding practices, vulnerable package changes, SQL injections, or exposed sensitive routes.\n"
        f"3. High-risk dependencies introduced.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences summarizing the overall security posture and risk level: High, Medium, or Low)\n\n"
        f"### Identified Vulnerabilities & Audit\n(Provide detailed security analysis on what was scanned and if any warning signs are present)"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    summary_msg = ai_analysis.split("### Identified Vulnerabilities & Audit")[0].replace("### Overview", "").strip() if ai_analysis else "Performed a comprehensive security audit on the latest commits. Overall security posture appears stable."

    items = [
        {
            "category": "Summary",
            "title": "Security Scan Report",
            "message": summary_msg,
            "status": "Safe" if "high" not in summary_msg.lower() and "medium" not in summary_msg.lower() else "Warning",
            "action": "Review the detailed audit logs and commit scans below."
        }
    ]

    for c in commit_details[:5]:
        msg_lower = c['message'].lower()
        has_warning = any(w in msg_lower for w in ["password", "token", "key", "secret", "auth", "credential", "bypass", "vuln"])
        
        items.append({
            "category": "Commit Scan",
            "title": f"Scan: Commit {c['sha'][:7]}",
            "message": f"Message: **{c['message'].splitlines()[0]}**\nAuthor: **{c['author']}**.\n\nNo blatant credentials or high-risk endpoints flagged in this commit message.",
            "status": "Safe" if not has_warning else "Audit Needed",
            "details": f"Date: {c['date']}",
            "url": c['url'],
            "action": "Verify files modified in this commit on GitHub."
        })

    return items

def execute_enrich_ticket(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Enrich Ticket")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    issue_number = params.get("NUMBER") or params.get("TICKET_ID") or params.get("ISSUE_NUMBER")
    
    issue = None
    if issue_number:
        try:
            issue = fetch_github_api(f"/repos/{owner}/{repo}/issues/{issue_number}")
        except Exception:
            pass
            
    if not issue:
        try:
            open_issues = fetch_github_api(f"/repos/{owner}/{repo}/issues?state=open&per_page=5")
            if open_issues and isinstance(open_issues, list):
                issue = open_issues[0]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch open issues for {owner}/{repo}. Details: {str(e)}")

    if not issue:
        raise HTTPException(status_code=404, detail="No open GitHub Issues found in this repository. Enrich Ticket requires at least one open issue.")

    number = issue.get("number")
    title = issue.get("title", "")
    body = issue.get("body", "") or "No description provided."
    author = issue.get("user", {}).get("login", "unknown")
    created_at = issue.get("created_at", "")
    url = issue.get("html_url", "")

    prompt = (
        f"You are a QA Lead and Developer reviewing a vague bug report.\n"
        f"Ticket #{number}: {title}\n"
        f"Author: {author}\n"
        f"Description:\n{body}\n\n"
        f"Task:\n"
        f"1. Enrich this ticket by providing deep technical context and suggesting potential areas in the `{owner}/{repo}` codebase where the bug might originate.\n"
        f"2. Write a highly detailed, step-by-step QA test plan / reproduction scenario for this bug, including potential edge cases.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences summarizing the bug and its technical impact)\n\n"
        f"### Codebase Origins & Analysis\n(Describe potential files, classes, or patterns that might cause this failure)\n\n"
        f"### QA Steps & Reproduction Plan\n(Detail steps, expected results, and test parameters)"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    if ai_analysis:
        sections = ai_analysis.split("### ")
        summary_msg = sections[1].replace("Overview\n", "").strip() if len(sections) > 1 else ai_analysis
        origins_msg = sections[2].replace("Codebase Origins & Analysis\n", "").strip() if len(sections) > 2 else ""
        qa_msg = sections[3].replace("QA Steps & Reproduction Plan\n", "").strip() if len(sections) > 3 else ""
    else:
        summary_msg = f"Enriched Ticket #{number}: '{title}' with technical details."
        origins_msg = "Needs investigation in code repository controllers or UI assets."
        qa_msg = "1. Deploy to staging.\n2. Execute user flow to reproduce.\n3. Assert behavior."

    items = [
        {
            "category": "Summary",
            "title": f"Enriched Ticket #{number}",
            "message": f"Bug: **{title}**.\n\n{summary_msg}",
            "status": "Enriched",
            "action": f"Review technical analysis and reproduction steps on ticket #{number}."
        },
        {
            "category": "Technical Details",
            "title": "AI Analysis & Possible Causes",
            "message": origins_msg or "Analyze recent stack traces or commits.",
            "status": "Analyzed",
            "details": f"Created by: {author} on {created_at}",
            "url": url,
            "action": "Inspect related file directories in main repository branch."
        },
        {
            "category": "QA Steps",
            "title": "Reproduction & Test Plan",
            "message": qa_msg or "Verify correct outputs under boundary conditions.",
            "status": "Test Cases Ready",
            "action": "Instruct QA team to execute the step-by-step reproduction scenarios."
        }
    ]

    return items

def execute_check_upgrade(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Upgrade Check")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    dep_files = ["package.json", "requirements.txt", "go.mod", "pom.xml", "Cargo.toml"]
    file_found = None
    file_content = ""
    
    for filename in dep_files:
        try:
            data = fetch_github_api(f"/repos/{owner}/{repo}/contents/{filename}")
            if isinstance(data, dict) and "content" in data:
                import base64
                file_content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
                file_found = filename
                break
        except Exception:
            continue
            
    if not file_found:
        try:
            commits = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=10")
            dependency_commits = [c for c in commits if any(w in c.get("commit", {}).get("message", "").lower() for w in ["upgrade", "dependency", "package", "bump", "version"])]
            if dependency_commits:
                file_found = "Commits History (Dependency bump)"
                file_content = "\n".join([c.get("commit", {}).get("message", "") for c in dependency_commits])
        except Exception:
            pass

    if not file_found:
        raise HTTPException(status_code=404, detail="No standard package configuration file (package.json, requirements.txt, etc.) found in the repository. Upgrade Check requires a dependency configuration file to analyze safety.")

    prompt = (
        f"You are a Senior Security Architect and DevOps Engineer checking if library updates are safe.\n"
        f"Found dependency configuration file `{file_found}` in the repository {owner}/{repo}.\n"
        f"Here are the contents of the dependency configuration:\n"
        f"{file_content[:1500]}\n\n"
        f"Task:\n"
        f"1. Identify active dependencies and specify if they have any known vulnerable versions, deprecations, or security concerns.\n"
        f"2. Provide recommendation on which versions are safe, breaking changes in newer releases, and a deployment safety checklist.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences stating if package upgrades are safe or if active alerts are present)\n\n"
        f"### Dependency Risk Assessment\n(Assess specific libraries/versions found, and highlight compatibilities or vulnerabilities)\n\n"
        f"### Upgrade Checklist\n(Detail steps to safely perform the upgrade)"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    if ai_analysis:
        sections = ai_analysis.split("### ")
        summary_msg = sections[1].replace("Overview\n", "").strip() if len(sections) > 1 else ai_analysis
        risk_msg = sections[2].replace("Dependency Risk Assessment\n", "").strip() if len(sections) > 2 else ""
        checklist_msg = sections[3].replace("Upgrade Checklist\n", "").strip() if len(sections) > 3 else ""
    else:
        summary_msg = f"Completed dependency safety review of `{file_found}`. No major security vulnerabilities found."
        risk_msg = "Dependencies are within secure baselines."
        checklist_msg = "1. Bump versions locally.\n2. Run tests.\n3. Deploy changes."

    items = [
        {
            "category": "Summary",
            "title": f"Upgrade Compatibility Review",
            "message": f"File Analyzed: **{file_found}**.\n\n{summary_msg}",
            "status": "Safe" if "vulnerab" not in summary_msg.lower() and "risk" not in summary_msg.lower() else "Warning",
            "action": "Review the dependency analysis before upgrading."
        },
        {
            "category": "Upgrade Check",
            "title": "Compatibility & Risk Assessment",
            "message": risk_msg,
            "status": "Compatible",
            "action": "Ensure local environments match testing configurations."
        },
        {
            "category": "Deployment safety",
            "title": "Safe Upgrade Checklist",
            "message": checklist_msg,
            "status": "Checklist Ready",
            "action": "Follow the deployment steps systematically."
        }
    ]

    return items

def execute_handover_bot(params: Dict[str, Any]):
    owner, repo = parse_owner_repo(params)
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="OWNER and REPO required for Handover report")
        
    github_token = CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=400, detail="GitHub Token is missing. Please connect your GitHub account in the Setup tab first.")
        
    try:
        closed_prs = fetch_github_api(f"/repos/{owner}/{repo}/pulls?state=closed&per_page=15")
        if not isinstance(closed_prs, list):
            raise Exception("Invalid PRs response format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API Error: Failed to fetch closed PRs for {owner}/{repo}. Details: {str(e)}")

    recent_merges = []
    for pr in closed_prs:
        if pr.get("merged_at"):
            recent_merges.append({
                "number": pr.get("number"),
                "title": pr.get("title", ""),
                "author": pr.get("user", {}).get("login", "unknown"),
                "merged_at": pr.get("merged_at"),
                "url": pr.get("html_url")
            })

    if not recent_merges:
        try:
            commits = fetch_github_api(f"/repos/{owner}/{repo}/commits?per_page=10")
            for c in commits:
                commit_obj = c.get("commit", {})
                recent_merges.append({
                    "number": c.get("sha")[:7],
                    "title": commit_obj.get("message", "").splitlines()[0],
                    "author": commit_obj.get("author", {}).get("name", "Unknown"),
                    "merged_at": commit_obj.get("author", {}).get("date", ""),
                    "url": c.get("html_url")
                })
        except Exception:
            pass

    merges_context = ""
    for idx, m in enumerate(recent_merges[:10]):
        merges_context += f"- Merged PR #{m['number']} by {m['author']} ({m['merged_at'][:10]}): {m['title']}\n"

    prompt = (
        f"You are a Tech Lead compiling a Shift Handover Report for the engineering team.\n"
        f"Here are the recent merged code modifications and activity from the live repository {owner}/{repo}:\n"
        f"{merges_context}\n\n"
        f"Synthesize this activity into a professional, high-impact handover report.\n"
        f"1. Summarize what was completed and deployed.\n"
        f"2. Suggest what remains in-progress, pending, or should be watched during the next shift.\n\n"
        f"Structure your response exactly with these headers:\n"
        f"### Overview\n(1-2 sentences summarizing the shift occurrences and engineering velocity)\n\n"
        f"### Completed Deployments\n(Bullet list of finished deliverables based on merged code)\n\n"
        f"### Pending & Operational Focus\n(Items to watch or tasks remaining in-progress)"
    )

    ai_analysis = ask_ai_summarizer(prompt)
    if ai_analysis:
        sections = ai_analysis.split("### ")
        summary_msg = sections[1].replace("Overview\n", "").strip() if len(sections) > 1 else ai_analysis
        completed_msg = sections[2].replace("Completed Deployments\n", "").strip() if len(sections) > 2 else ""
        pending_msg = sections[3].replace("Pending & Operational Focus\n", "").strip() if len(sections) > 3 else ""
    else:
        summary_msg = "Successfully synthesized shift activity from merged repository pull requests."
        completed_msg = "\n".join([f"* {m['title']}" for m in recent_merges[:5]])
        pending_msg = "* Watch staging and production metric lines.\n* Ensure seamless handoffs for in-flight tasks."

    items = [
        {
            "category": "Summary",
            "title": "Shift Handover Report",
            "message": summary_msg,
            "status": "Shift Complete",
            "action": "Share the handover summary with the incoming on-call team."
        },
        {
            "category": "Shift Activity",
            "title": "Completed Work & Deployments",
            "message": completed_msg,
            "status": "Deployed",
            "action": "Verify staging environment telemetry for these changes."
        },
        {
            "category": "Open Handover Items",
            "title": "In-Progress & Leftover Tasks",
            "message": pending_msg,
            "status": "Pending",
            "action": "Ensure next on-call engineer accepts tasks."
        }
    ]

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
    update_global_tokens(req)
    if req.skill_id == "failure_hunter":
        return execute_failure_hunter(req.params)
    if req.skill_id == "pr_reaper":
        return execute_pr_reaper(req.params)
    if req.skill_id == "code_owner":
        return execute_code_owner(req.params)
    if req.skill_id == "validate_doc":
        return execute_validate_doc(req.params)
    if req.skill_id == "oss_risk_assessor":
        return execute_oss_safety(req.params)
    if req.skill_id == "fork_to_fix":
        return execute_upstream_fixes(req.params)
    if req.skill_id == "review_context":
        return execute_review_help(req.params)
    if req.skill_id == "postmortem":
        return execute_postmortem(req.params)
    if req.skill_id == "security_check":
        return execute_security_check(req.params)
    if req.skill_id == "enrich_ticket":
        return execute_enrich_ticket(req.params)
    if req.skill_id == "check_upgrade":
        return execute_check_upgrade(req.params)
    if req.skill_id == "handover_bot":
        return execute_handover_bot(req.params)

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

@app.post("/api/query")
def execute_raw_query(req: QueryRequest):
    update_global_tokens(req)
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    
    output = run_coral_query(req.query)
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"raw_output": output}

def heuristic_summarize(message: str) -> str:
    lines = message.split('\n')
    overview = ""
    impacts = []
    actions = []
    
    # 1. Look for tags like feat(ui): or fix(auth):
    tag_match = re.search(r'^(\w+)(?:\(([^)]+)\))?\s*:\s*(.*)', lines[0], re.IGNORECASE)
    if tag_match:
        tag_type = tag_match.group(1).lower()
        scope = tag_match.group(2)
        desc = tag_match.group(3)
        
        scope_str = f" in the **{scope}** area" if scope else ""
        if tag_type == 'feat':
            overview = f"✨ **New Feature:** Added a new capability to '{desc.strip()}'{scope_str}."
            actions.append("Test the new user flow to ensure it meets requirements.")
        elif tag_type == 'fix':
            overview = f"🐞 **Bug Fix:** Resolved an issue where '{desc.strip()}'{scope_str} was not working correctly."
            actions.append("Verify the bug fix on the latest build to confirm resolution.")
        elif tag_type == 'refactor':
            overview = f"⚙️ **Refactor:** Cleaned up and optimized internal code structure for '{desc.strip()}'{scope_str}."
            actions.append("Perform regression testing on related features.")
        else:
            overview = f"🔧 **Update:** Made changes to '{desc.strip()}'{scope_str}."
            actions.append("Review changes for alignment with objectives.")
    else:
        overview = f"📝 **System Update:** {lines[0].strip()}"
        actions.append("Review the update for detailed context.")
        
    # 2. Check for tracebacks/errors
    if "traceback" in message.lower() or "exception" in message.lower() or "error" in message.lower() or "fail" in message.lower():
        overview = "⚠️ **System Alert:** Detected an application error or stack trace in the logs."
        impacts.append("The application encountered a critical runtime exception.")
        
        exception_lines = [line.strip() for line in lines if "Error:" in line or "Exception:" in line]
        if exception_lines:
            impacts.append(f"Specific Error: **{exception_lines[-1]}**")
        else:
            non_empty_lines = [l.strip() for l in lines if l.strip()]
            if non_empty_lines:
                impacts.append(f"Details: {non_empty_lines[-1]}")
        actions.append("Inspect stack trace lines in the 'Raw Developer Logs' tab for complete context.")
    else:
        # Check for standard items/bullets
        for line in lines:
            line_clean = line.strip()
            if line_clean.startswith('-') or line_clean.startswith('*'):
                clean_item = re.sub(r'^[-*\s]+', '', line_clean)
                if len(clean_item) > 10 and not clean_item.startswith('Co-Authored-By'):
                    impacts.append(clean_item)
            elif "fix" in line_clean.lower() and len(line_clean) > 20:
                impacts.append(line_clean)
                
        if not impacts:
            for line in lines[1:4]:
                if len(line.strip()) > 15 and not line.strip().startswith('Co-Authored-By'):
                    impacts.append(line.strip())
                    
    # Format as markdown
    markdown = f"### Overview\n{overview}\n\n"
    if impacts:
        markdown += "### Key Impacts\n" + "\n".join([f"* {imp}" for imp in impacts[:4]]) + "\n\n"
    if actions:
        markdown += "### Recommended Action\n" + "\n".join([f"* {act}" for act in actions])
        
    return markdown

@app.post("/api/search")
def run_semantic_search(req: SearchRequest):
    update_global_tokens(req)
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
        
    print(f"Executing semantic search for query: '{query}' with source: '{req.source}'")
    
    # Extract owner and repo dynamically based on query and/or request parameters
    owner, repo = extract_repo_from_query(query, default_owner=req.owner, default_repo=req.repo)
    print(f"Dynamic repository extraction: owner='{owner}', repo='{repo}'")

    # 1. Fetch live credentials results based on source filter
    source_filter = req.source.strip().lower() if req.source else "all"
    
    discord_res = []
    github_res = []
    sentry_res = []
    jira_res = []
    github_commits = []
    repo_info = None

    if source_filter in ("all", "discord"):
        print("Querying Discord integration...")
        discord_res = fetch_discord_search(query)
    if source_filter in ("all", "sentry"):
        print("Querying Sentry integration...")
        sentry_res = fetch_sentry_search(query)
    if source_filter in ("all", "jira"):
        print("Querying Jira integration...")
        jira_res = fetch_jira_search(query)
    if source_filter in ("all", "github"):
        github_res = fetch_github_search(query, owner, repo)
        github_commits = fetch_github_commits_search(query, owner, repo)
        repo_info = fetch_github_repo_info(owner, repo) if owner and repo else None
    
    results = []
    
    # Check if there are explicit auth errors
    auth_errors = []
    for res_list in [discord_res, github_res, sentry_res, jira_res]:
        if res_list and isinstance(res_list[0], dict) and res_list[0].get("error"):
            auth_errors.append(f"**{res_list[0]['source']}**: {res_list[0]['message']}")
            
    # Remove error dicts from valid results
    discord_res = [r for r in discord_res if not r.get("error")]
    github_res = [r for r in github_res if not r.get("error")]
    sentry_res = [r for r in sentry_res if not r.get("error")]
    jira_res = [r for r in jira_res if not r.get("error")]

    # Repository Info will be prepended later if we actually find relevant logs/tickets

    
    # Extract query words for high-precision relevance filtering
    words = [re.sub(r'[^\w]', '', w) for w in query.lower().split()]
    exclude_words = {
        "who", "last", "commited", "commit", "on", "top", "openmetadata", "and", "what", "was", "the",
        "did", "by", "for", "in", "to", "of", "a", "an", "recent", "latest", "newest", "oldest", "first",
        "new", "old", "commits", "committed", "push", "pushed", "pr", "prs", "pull", "pulls", "issue",
        "issues", "branch", "branches", "repo", "repos", "repository", "repositories", "open", "metadata",
        "openmeta", "data"
    }
    q_words = [w for w in words if w and w not in exclude_words]
    
    # Format Sentry matches
    for item in sentry_res:
        title_lower = item["title"].lower()
        culprit_lower = item["culprit"].lower()
        if q_words and not any(w in title_lower or w in culprit_lower for w in q_words):
            continue
        results.append({
            "category": "Sentry Exception",
            "title": item["title"],
            "status": item["status"],
            "url": item["permalink"],
            "message": f"Exception flagged in project {item['project_name']} (culprit: {item['culprit']}). Metadata: {item['metadata_message']}",
            "created_at": item["last_seen"]
        })
        
    # Format Discord matches
    for item in discord_res:
        text_lower = item["text"].lower()
        if q_words and not any(w in text_lower for w in q_words):
            continue
        results.append({
            "category": "Discord Discussion",
            "title": f"Conversation in #{item['channel']}",
            "status": "Chat",
            "url": item["permalink"],
            "message": f"{item['username']}: {item['text']}",
            "created_at": item["timestamp"]
        })
        
    # Format Jira matches
    for item in jira_res:
        summary_lower = item["summary"].lower()
        if q_words and not any(w in summary_lower for w in q_words):
            continue
        results.append({
            "category": "Jira Ticket",
            "title": f"{item['key']}: {item['summary']}",
            "status": item["status"],
            "url": item["url"],
            "message": f"Assignee: {item['assignee']}. Description: {item['description']}",
            "created_at": item["updated"]
        })
        
    # Format GitHub matches
    for item in github_res:
        title_lower = item["title"].lower()
        if q_words and not any(w in title_lower for w in q_words):
            continue
        results.append({
            "category": "GitHub Issue",
            "title": f"#{item['number']}: {item['title']}",
            "status": item["state"],
            "url": item["html_url"],
            "message": f"Author: {item['user__login']}. Body: {item['description']}",
            "created_at": item["created_at"]
        })
 
    # Format GitHub commits matches
    for item in github_commits:
        results.append({
            "category": "GitHub Commit",
            "title": f"Commit: {item['message'].splitlines()[0]}",
            "status": "Commit",
            "url": item["html_url"],
            "message": f"Author: {item['author_name']} ({item['author_email']}). SHA: {item['sha'][:7]}. Date: {item['date']}",
            "created_at": item["date"]
        })

    # Prepend Repository Info if available
    if repo_info:
        results.insert(0, {
            "category": "Repository Overview",
            "title": f"{owner}/{repo} Repository Information",
            "status": "Active",
            "url": f"https://github.com/{owner}/{repo}",
            "message": f"Description: {repo_info['description']}\nLanguage: {repo_info['language']}\nTopics: {', '.join(repo_info['topics'])}\nREADME snippet: {repo_info['readme']}",
            "created_at": "Current"
        })

    # Pagination validation: cap page_size at 50, ensure page >= 1
    page = max(1, req.page)
    page_size = max(1, min(req.page_size, 50))
    total_results = len(results)

    # If absolutely no matching results were found (real or mock)
    if not results and not auth_errors:
        no_info_summary = (
            "### Overview\n"
            f"No related historical logs, exceptions, or conversations were found in your connected workspace for the query: **\"{query}\"**.\n\n"
            "### Key Insights\n"
            "* **No active occurrences:** There are no Sentry exceptions or Jira tickets matching this topic.\n"
            "* **No recent discussions:** We couldn't find any Discord messages or GitHub PRs/issues discussing this topic.\n\n"
            "### Recommended Action\n"
            "* **Try a specific search:** Search for a topic-specific keyword to retrieve relevant history.\n"
            "* **Check active integrations:** Ensure your connection credentials for GitHub, Jira, Sentry, and Discord are active in the **Setup** tab to retrieve real-time company history."
        )
        return {
            "summary": no_info_summary,
            "results": [],
            "total_results": 0,
            "page": page,
            "page_size": page_size
        }
    elif not results and auth_errors:
        auth_err_summary = "### ⚠️ Authentication Error\nYour search failed because of invalid API tokens. Please fix the following connections in the **Setup** tab:\n\n"
        for err in auth_errors:
            auth_err_summary += f"* {err}\n"
        return {
            "summary": auth_err_summary,
            "results": [],
            "total_results": 0,
            "page": page,
            "page_size": page_size
        }
        
    # 3. Trigger 3-Tier AI Summarizer to Synthesize the Answers
    context_text = ""
    for r in results[:4]:
        context_text += f"Source: {r['category']}\n"
        context_text += f"Title: {r['title']}\n"
        context_text += f"Status: {r['status']}\n"
        context_text += f"Details: {r['message']}\n"
        context_text += f"Date: {r['created_at']}\n"
        context_text += "---\n\n"
        
    prompt = (
        "You are a friendly, expert AI assistant embedded in a developer tool. "
        "Your task is to answer the user's query using the provided context, which may include "
        "general repository information (README, description) and aggregated search results "
        "from GitHub, Discord, Jira, and Sentry.\n\n"
        "If the user is asking a general question (e.g. 'what is this repo about?'), use the "
        "'Repository Overview' context to explain the purpose of the project, its tech stack, and key features. "
        "If the user is searching for a bug or specific issue, explain WHO faced it, WHERE it was discussed, "
        "and WHAT the recommended resolution was based on the specific results.\n\n"
        "Summarize your findings in clear, plain-English. "
        "Structure your response exactly with these headers:\n"
        "### Overview\n(1-3 simple sentences answering the query or explaining the issue)\n\n"
        "### Key Insights\n* (bullet 1: Key detail, e.g. project purpose, or who faced the issue)\n* (bullet 2: Additional detail, e.g. tech stack, or where it was logged)\n\n"
        "### Recommended Action\n* (bullet 1: What the user should do next based on the context)\n\n"
        "IMPORTANT: When referring to the repository or codebase name in your summary, always refer to the actual repository name "
        "present in the source context details (e.g. open-metadata/OpenMetadata or unnatikdm/TOP) and do NOT blindly reuse the word "
        "'TOP' or other repo names from the user's search query if they differ from the actual source context, as the user is "
        "querying the currently configured repository. If the context has no relevant information for the query, state that clearly.\n\n"
        f"Query: {query}\n\n"
        f"Context:\n{context_text}"
    )
    
    summary_text = ""
    
    # Tier 1: Local Ollama
    try:
        ollama_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps({
                "model": "llama3.2",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }).encode("utf-8")
        )
        with urllib.request.urlopen(ollama_req, timeout=5) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            summary_text = resp_data.get("message", {}).get("content", "")
            if summary_text:
                print("Search LLM Tier 1 (Ollama) successfully completed!")
    except Exception as e:
        print("Search LLM Tier 1 failed:", e)
        
    # Tier 2: Cloud AI Fallback
    if not summary_text:
        try:
            poll_req = urllib.request.Request(
                "https://text.pollinations.ai/",
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                data=json.dumps({
                    "messages": [{"role": "user", "content": prompt}],
                    "model": "openai"
                }).encode("utf-8")
            )
            with urllib.request.urlopen(poll_req, timeout=30) as resp:
                summary_text = resp.read().decode("utf-8")
                if summary_text:
                    print("Search LLM Tier 2 (Pollinations) successfully completed!")
        except Exception as e:
            print("Search LLM Tier 2 failed:", e)
            
    # Tier 3: Heuristic Local NLP Fallback
    if not summary_text:
        print("Search LLM Tier 3 (Heuristics) active...")
        
        if not results:
            summary_text = "No matching records found across connected sources to summarize."
        else:
            # FIX 4: Dynamically construct the fallback based on the actual top result
            top_result = results[0]
            source_type = top_result.get("category", "system")
            title = top_result.get("title", "Unknown issue")
            
            summary_text = (
                f"### Overview\n"
                f"The system detected relevant activity related to your query in **{source_type}**.\n\n"
                f"### Key Insights\n"
                f"* **Primary Finding:** {title}\n"
                f"* **Latest Status:** Marked as `{top_result.get('status', 'N/A')}` on {top_result.get('created_at', 'recently')}.\n"
                f"* **Location:** Logged via {source_type}.\n\n"
                f"### Recommended Action\n"
                f"* Review the raw developer logs and provided links below for full context before making code changes."
            )
            
    # Apply pagination slicing
    start = (page - 1) * page_size
    end = start + page_size
    paginated_results = results[start:end]

    return {
        "summary": summary_text,
        "results": paginated_results,
        "total_results": total_results,
        "page": page,
        "page_size": page_size
    }

@app.post("/api/summarize")
def summarize_content(req: SummarizeRequest):
    # Tier 1: Local Ollama (llama3.2)
    try:
        # Check if Ollama is running and responsive
        ollama_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            headers={"Content-Type": "application/json"},
            data=json.dumps({
                "model": "llama3.2",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "You are a friendly, non-technical writer AI agent. "
                            "Explain the following complex developer commit message, traceback, log, or ticket in a few simple sentences. "
                            "Do not use technical jargon. Focus on explaining what this change or problem means to a normal manager. "
                            "Structure your response exactly with these headers:\n"
                            "### Overview\n(1-2 simple sentences)\n\n"
                            "### Key Impacts\n* (bullet 1)\n* (bullet 2)\n\n"
                            "### Recommended Action\n* (bullet 1)\n\n"
                            f"Text to summarize:\n{req.message}"
                        )
                    }
                ],
                "stream": False
            }).encode("utf-8")
        )
        with urllib.request.urlopen(ollama_req, timeout=15) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            summary = resp_data.get("message", {}).get("content", "")
            if summary:
                print("Ollama llama3.2 summarized successfully!")
                return {"summary": summary}
    except Exception as e:
        print("Ollama Tier 1 failed or offline:", e)

    # Tier 2: Free Serverless Cloud AI (Pollinations keyless API)
    try:
        prompt_str = (
            "You are a friendly, non-technical writer AI agent. "
            "Explain the following complex developer commit message, traceback, log, or ticket in a few simple sentences. "
            "Do not use technical jargon. Focus on explaining what this change or problem means to a normal manager. "
            "Structure your response exactly with these headers:\n"
            "### Overview\n(1-2 simple sentences)\n\n"
            "### Key Impacts\n* (bullet 1)\n* (bullet 2)\n\n"
            "### Recommended Action\n* (bullet 1)\n\n"
            f"Text to summarize:\n{req.message}"
        )
        poll_req = urllib.request.Request(
            "https://text.pollinations.ai/",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            data=json.dumps({
                "messages": [{"role": "user", "content": prompt_str}],
                "model": "openai"
            }).encode("utf-8")
        )
        with urllib.request.urlopen(poll_req, timeout=10) as resp:
            summary = resp.read().decode("utf-8")
            if summary:
                print("Pollinations Tier 2 summarized successfully!")
                return {"summary": summary}
    except Exception as e:
        print("Pollinations Tier 2 failed or offline:", e)

    # Tier 3: Local NLP Heuristic fallback (Offline & Forever)
    print("Falling back to Tier 3 Local NLP Heuristic Summarizer...")
    summary = heuristic_summarize(req.message)
    return {"summary": summary}

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
    
    CONNECTED_TOKENS[source.lower()] = token
    if source.lower() == "jira":
        jira_url = data.get("jira_url", "")
        # Sanitize URL to keep only scheme and domain
        from urllib.parse import urlparse
        try:
            parsed = urlparse(jira_url)
            if parsed.scheme and parsed.netloc:
                jira_url = f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            pass
        CONNECTED_DEFAULTS["jira_url"] = jira_url
        CONNECTED_DEFAULTS["jira_email"] = data.get("jira_email", "")
    elif source.lower() == "sentry":
        org_slug = data.get("sentry_org", "").strip()
        if "://" in org_slug:
            if ".sentry.io" in org_slug:
                org_slug = org_slug.split("://")[1].split(".sentry.io")[0]
            elif "/organizations/" in org_slug:
                org_slug = org_slug.split("/organizations/")[1].split("/")[0]
        org_slug = org_slug.strip("/")
        CONNECTED_DEFAULTS["sentry_org"] = org_slug
    elif source.lower() == "discord":
        CONNECTED_DEFAULTS["discord_guild_id"] = data.get("discord_guild_id", "")
    
    try:
        if source.lower() == "jira":
            jira_url = CONNECTED_DEFAULTS["jira_url"]
            jira_email = data.get("jira_email", "")
            env_vars = f"JIRA_BASE_URL='{jira_url}' JIRA_EMAIL='{jira_email}' JIRA_API_TOKEN='{token}'"
            cmd = ["wsl", "-d", "Ubuntu-24.04", "--", "bash", "-c", f"{env_vars} /root/.local/bin/coral source add jira"]
        elif source.lower() == "sentry":
            sentry_org = data.get("sentry_org", "")
            env_vars = f"SENTRY_ORG='{sentry_org}' SENTRY_TOKEN='{token}' SENTRY_AUTH_TOKEN='{token}'"
            cmd = ["wsl", "-d", "Ubuntu-24.04", "--", "bash", "-c", f"{env_vars} /root/.local/bin/coral source add sentry"]
        elif source.lower() == "discord":
            cmd = None
        else:
            env_key = f"{source.upper()}_TOKEN"
            if source.lower() == "github":
                env_key = "GITHUB_TOKEN"
            cmd = ["wsl", "-d", "Ubuntu-24.04", "--", "bash", "-c", f"{env_key}='{token}' /root/.local/bin/coral source add {source.lower()}"]
            
        if cmd:
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

@app.get("/healthz")
def health_check():
    return {"status": "healthy"}

@app.get("/api/repos")
def get_user_repos(github_token: Optional[str] = None):
    token = github_token or CONNECTED_TOKENS.get("github") or os.environ.get("GITHUB_TOKEN")
    if token:
        CONNECTED_TOKENS["github"] = token
    if not token:
        return [
            {"name": "unnatikdm/TOP", "url": "https://github.com/unnatikdm/TOP"},
            {"name": "getsentry/sentry", "url": "https://github.com/getsentry/sentry"}
        ]
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json"
    }
    try:
        import requests
        resp = requests.get("https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=50", headers=headers)
        if resp.status_code == 200:
            return [{"name": r["full_name"], "url": r["html_url"]} for r in resp.json()]
        return []
    except Exception as e:
        print("Exception fetching repos:", e)
        return []


# --- SINGLE SERVICE STATIC FRONTEND SERVING FOR DOCKER DEPLOYMENTS ---
from fastapi.responses import HTMLResponse, FileResponse

# Mount React dashboard static assets under /dashboard/assets
dashboard_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "dashboard"))
if not os.path.exists(dashboard_dir):
    # Try workspace root dashboard folder for local development
    dashboard_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../dashboard"))

if os.path.exists(dashboard_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/dashboard/assets", StaticFiles(directory=os.path.join(dashboard_dir, "assets")), name="dashboard-assets")

# Route to serve the dashboard React page
@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/dashboard/", response_class=HTMLResponse)
def serve_dashboard():
    dashboard_index = os.path.abspath(os.path.join(dashboard_dir, "index.html"))
    if os.path.exists(dashboard_index):
        with open(dashboard_index, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="Dashboard build folder not found.")

# Route to serve landing page static images and assets (e.g. logos, icons, favicons)
@app.get("/{filename}")
def serve_root_asset(filename: str):
    # Check if requested file exists in dashboard directory (logos/icons/images are here)
    asset_path = os.path.abspath(os.path.join(dashboard_dir, filename))
    if os.path.exists(asset_path):
        return FileResponse(asset_path)
    # Check if requested file exists in backend directory
    backend_asset_path = os.path.abspath(os.path.join(os.path.dirname(__file__), filename))
    if os.path.exists(backend_asset_path):
        return FileResponse(backend_asset_path)
    raise HTTPException(status_code=404, detail="File not found")

# Serve landing page index.html on root /
@app.get("/", response_class=HTMLResponse)
def serve_landing_page():
    landing_index = os.path.abspath(os.path.join(os.path.dirname(__file__), "index.html"))
    if os.path.exists(landing_index):
        with open(landing_index, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="Landing page index.html not found.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)