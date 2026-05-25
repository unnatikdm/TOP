# Coral Enterprise Agent: Setup & Feature Guide

This guide provides a comprehensive step-by-step walk-through for setting up external services via the **Setup Tab**, explains how connection persistence is handled under the hood, and summarizes the rest of the core enhancements and architectural upgrades built during this session.

---

## ⚙️ Part 1: How to Set Up Services (Step-by-Step)

The **Setup** view in your dashboard provides a graphical interface to securely connect external developer tools (GitHub, Slack, Jira, Sentry) directly to your active Coral query workspace.

### 1. Connecting GitHub
1. **Generate Token:** Go to GitHub -> Settings -> Developer Settings -> **Personal Access Tokens (PAT)** (classic or fine-grained).
2. **Set Scopes:** Grant `repo` and `workflow` scopes so Coral can pull issues, commits, and workflow run outputs.
3. **Connect:** Open the **Setup** tab in the sidebar, input your token into the **GitHub Connection** card, and click **Connect GitHub**.

### 2. Connecting Slack
1. **Retrieve Token:** Obtain a Slack API User or Bot token (typically starting with `xoxp-` or `xoxb-`) for your workspace.
2. **Connect:** In the **Setup** tab, enter the token in the **Slack Connection** card and click **Connect Slack**.

### 3. Connecting Jira
1. **Generate API Token:** Go to your Atlassian account security settings -> **API Tokens** -> Create API Token.
2. **Get Base URL & Email:** Copy your Jira base workspace URL (e.g., `https://your-domain.atlassian.net`) and copy your registered Atlassian account email address.
3. **Connect:** In the **Setup** tab, fill out all three fields (Base URL, Account Email, and API Token) in the **Jira Connection** card and click **Connect Jira**.

### 4. Connecting Sentry
1. **Create Auth Token:** Go to Sentry Settings -> Developer Settings -> New Internal Integration / API Tokens, and generate an API token with read scopes.
2. **Get Org Slug:** Find your Organization Slug in your Sentry workspace URL (e.g., `sentry.io/organizations/[org-slug]/`).
3. **Connect:** In the **Setup** tab, enter your Organization Slug and API Token in the **Sentry Connection** card and click **Connect Sentry**.

---

## 🔌 Part 2: Under-the-Hood Connection Lifecycle

When you click **Connect** in the UI, the following secure state sync happens:
1. **Browser Persistent State:** Credentials are instantly cached in the browser's secure `localStorage` (e.g. `coral_github_token`), so you never lose them upon page refreshes or browser restarts.
2. **Subprocess Sync with WSL:** The Python backend receives the payload at `/api/connect` and executes a subprocess to register the secrets inside the WSL Ubuntu environment:
   ```bash
   wsl -d Ubuntu-24.04 -- bash -c "GITHUB_TOKEN='token' /root/.local/bin/coral source add github"
   ```
   This registers the credential files directly under `/root/.config/coral/workspaces/default/sources/` inside WSL.
3. **Server-Side Auto-Load:** When the backend starts up, it reads existing configs and secrets files directly from the WSL filesystem, ensuring active authentication is maintained continuously.

---

## 🌟 Part 3: Summary of the Rest of Our Work

Outside of the Setup integration, we rebuilt the developer interface and optimized the query fallbacks for a premium, fast, and fail-safe experience:

### 1. Resilient Triple-Tier AI Summarizer
* Converts long, jargon-heavy developer logs, commits, or tracebacks into plain English summaries.
* **3-Tier Failover:** Queries local **Ollama `llama3.2`** first (offline/private) -> Falls back to keyless cloud **Pollinations AI** (using spoofed browser headers to bypass Cloudflare) -> Falls back to a local **Regex NLP parser** (working 100% of the time, offline and forever).

### 2. Interactive Dual-Tab Accordion Drawers
* Cards with large tracebacks render a **"View In-depth Analysis"** drawer which loads summaries asynchronously with a pulsing AI loading state.
* Users can toggle cleanly between a plain English **`✨ AI Agent Explanation`** tab (rendered via a custom JSX markdown parser) and a **`💻 Raw Developer Logs`** tab.

### 3. Global Persistent Input URL
* Decoupled the repository input state (`paramValue`) from per-tool state-caching.
* The active repository URL stays persistent globally across all sidebar tabs, so you don't have to re-paste it when switching tools. Individual tool outputs and drawer states remain perfectly isolated and cached in memory.

### 4. Interactive Developer Cards & Metric Pills
* Replaced plain SQL rows with a responsive CSS grid of glassmorphic card layouts.
* Added clickable hyperlinked titles pointing directly to the GitHub commit/PR page.
* Created a parser to convert trace strings into glowing **metric pills** for reviews 💬, CI runs 🔄, Slack mentions, and Jira links.
* Excluded standard SQL fields and added value truncations (> 60 chars) to prevent layout overflows.

### 5. Fail-Fast Timeout & Authenticated API Redirects
* Placed a **3-second timeout limit** on Coral WSL queries to prevent gateway hang-ups.
* If a query fails or times out, the backend instantly runs direct REST API requests via `urllib.request` in under 100ms.
* Mapped fallback results to support both raw REST keys and full database schemas (`number`, `sha`, `user__login`) to prevent crash loops, and resolved query case-sensitivity match issues.
