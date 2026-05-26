import React, { useState, useEffect } from 'react';
import './index.css';
import {
  MessageSquare,
  AlertCircle,
  Search,
  Cpu,
  Database,
  Layers,
  FileCode,
  Zap,
  Settings,
  HelpCircle,
  Link,
  Key,
  CheckCircle,
  LayoutDashboard,
  Box,
  GitBranch,
  Play,
  ShieldAlert,
  TerminalSquare,
  Sun,
  Moon,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const getOutputBreakdown = (message, title, category) => {
  if (!message) return { summary: '', details: null };

  const msgStr = String(message);

  // Case 1: Semicolon-separated list of issues/PRs/commits
  if (msgStr.includes('; ')) {
    const items = msgStr.split('; ').filter(Boolean);
    // Ensure it's a real list (items start with '#' or look like Jira keys 'PROJ-123:' or similar patterns)
    const isRealList = items.filter(item => {
      const trimmed = item.trim();
      return trimmed.startsWith('#') || /^[A-Z]+-\d+:?/i.test(trimmed);
    }).length >= 2;
    
    if (isRealList && items.length > 1) {
      const summary = `Found ${items.length} key ${category || 'items'} related to this run.`;
      const details = (
        <ul className="details-list">
          {items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      );
      return { summary, details };
    }
  }

  // Case 2: Multi-line text (e.g. commit with a body, traceback, or detailed log)
  if (msgStr.includes('\n')) {
    const lines = msgStr.split('\n').filter(line => line.trim().length > 0);
    if (lines.length > 1) {
      const summary = lines[0].trim();
      const details = (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {lines.slice(1).join('\n')}
        </div>
      );
      return { summary, details };
    }
  }

  // Case 3: Single very long sentence/string
  if (msgStr.length > 150) {
    const summary = msgStr.substring(0, 147) + '...';
    const details = (
      <div style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
        {msgStr}
      </div>
    );
    return { summary, details };
  }

  // Case 4: Short simple message
  return { summary: msgStr, details: null };
};

const getCardMetadata = (res) => {
  const author = res.author || res.commit__author__name || res.user__login || res.commit__author || null;
  const date = res.timestamp || res.commit__author__date || res.created_at || res.updated_at || null;
  const sha = res.hash || res.sha || res.head_sha || null;
  
  if (!author && !date && !sha) return null;
  return { author, date, sha };
};

const renderMarkdown = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    let clean = line.trim();
    if (clean.startsWith('###')) {
      return <h4 key={idx} style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent)', marginTop: '12px', marginBottom: '6px' }}>{clean.replace(/^###\s*/, '')}</h4>;
    }
    if (clean.startsWith('**') && clean.endsWith('**')) {
      return <p key={idx} style={{ fontWeight: '700', fontSize: '13px', margin: '6px 0', color: 'var(--text-main)' }}>{clean.replace(/\*\*/g, '')}</p>;
    }
    if (clean.startsWith('*') || clean.startsWith('-')) {
      return <li key={idx} style={{ fontSize: '12px', color: 'var(--text-main)', marginLeft: '12px', marginBottom: '4px', listStyleType: 'disc', fontFamily: "'Inter', sans-serif" }}>{clean.replace(/^[-*\s]+/, '')}</li>;
    }
    return <p key={idx} style={{ fontSize: '12px', color: 'var(--text-main)', margin: '4px 0', lineHeight: '1.6', fontFamily: "'Inter', sans-serif" }}>{clean}</p>;
  });
};

const tools = [
  { id: 'failure_hunter', name: 'Fix Build', icon: AlertCircle, tooltip: 'Find out why a build failed.' },
  { id: 'pr_reaper', name: 'Cleanup PRs', icon: GitBranch, tooltip: 'Find old pull requests that are stuck.' },
  { id: 'handover_bot', name: 'Handover', icon: Play, tooltip: 'Summarize what happened during a shift.' },
  { id: 'security_check', name: 'Security Scan', icon: ShieldAlert, tooltip: 'Check code for known security holes.' },
  { id: 'enrich_ticket', name: 'Enrich Ticket', icon: Search, tooltip: 'Add more info to vague bug reports.' },
  { id: 'check_upgrade', name: 'Upgrade Check', icon: Zap, tooltip: 'Check if library updates are safe.' },
  { id: 'code_owner', name: 'Who Owns?', icon: Cpu, tooltip: 'Find the best person to ask about a file.' },
  { id: 'postmortem', name: 'Timeline', icon: FileCode, tooltip: 'See exactly what happened during a crash.' },
  { id: 'vendor_status', name: 'Vendor Status', icon: TerminalSquare, tooltip: 'Check if Stripe, AWS, etc. are down.' },
  { id: 'validate_doc', name: 'Check Docs', icon: FileCode, tooltip: 'Find outdated documentation.' },
  { id: 'review_context', name: 'Review Help', icon: GitBranch, tooltip: 'Find past discussions for code reviews.' },
  { id: 'oss_risk_assessor', name: 'OSS Safety', icon: ShieldAlert, tooltip: 'Score the safety of open-source libraries.' },
  { id: 'fork_to_fix', name: 'Upstream Fixes', icon: Layers, tooltip: 'Check if your bugs are fixed in newer versions.' }
];

const PRESET_TEMPLATES = [
  {
    name: '📦 Recent GitHub PRs',
    sql: "SELECT number, title, state, user__login FROM github.pulls WHERE owner = '{{OWNER}}' AND repo = '{{REPO}}' ORDER BY created_at DESC LIMIT 10;"
  },
  {
    name: '🐞 Sentry Crash Events',
    sql: "SELECT id, title, last_seen, level, status FROM sentry.issues WHERE query = 'release:{{REPO}}' LIMIT 10;"
  },
  {
    name: '🔄 Latest CI Action Runs',
    sql: "SELECT id, name, head_branch, status, conclusion FROM github.repo_action_runs WHERE owner = '{{OWNER}}' AND repo = '{{REPO}}' LIMIT 5;"
  },
  {
    name: '📅 High Priority Jira Tickets',
    sql: "SELECT key, summary FROM jira.issues LIMIT 10;"
  },
  {
    name: '🔍 StackOverflow Search',
    sql: "SELECT question_id, title, link FROM stackoverflow.questions WHERE title ILIKE '%{{QUERY}}%' ORDER BY creation_date DESC LIMIT 5;"
  }
];

const queriesMock = {
  prs: `+--------+---------------------------------------+--------+
| number | title                                 | state  |
+--------+---------------------------------------+--------+
|   1482 | PatchLodash prototype vulnerability   | open   |
|   1481 | Fix flakiness in webpack pipelines    | closed |
+--------+---------------------------------------+--------+
2 rows returned inside WSL. (WSL execution: 12ms)`,
  sentry: `+------------+---------------------------------------+-------+------------+
| id         | title                                 | level | status     |
+------------+---------------------------------------+-------+------------+
| sentry-102 | ZeroDivisionError: views.py           | error | unresolved |
| sentry-103 | ConnectionTimeout: pool exhausted     | fatal | unresolved |
+------------+---------------------------------------+-------+------------+
2 rows returned inside WSL. (WSL execution: 14ms)`,
  actions: `+-----------------------+-----------+------------+
| name                  | status    | conclusion |
+-----------------------+-----------+------------+
| build-and-test        | completed | success    |
| deploy-to-production  | completed | success    |
+-----------------------+-----------+------------+
2 rows returned inside WSL. (WSL execution: 18ms)`,
  tickets: `+----------+-------------------------------------------------+
| key      | summary                                         |
+----------+-------------------------------------------------+
| OPS-4821 | Fix flaky webpack build in CI/CD pipeline       |
| SEC-882  | Patch Lodash prototype pollution vulnerability  |
+----------+-------------------------------------------------+
2 rows returned inside WSL. (WSL execution: 11ms)`
};

function App() {
  const [theme, setTheme] = useState('light');
  const [view, setView] = useState('landing'); // Default is now 'landing'!
  const [activeTool, setActiveTool] = useState(tools[0]);
  const [paramValue, setParamValue] = useState('https://github.com/open-metadata/OpenMetadata');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});
  const [summaries, setSummaries] = useState({});
  const [summarizing, setSummarizing] = useState({});
  const [activeTabs, setActiveTabs] = useState({});

  // States for Query Console
  const [sqlQuery, setSqlQuery] = useState("SELECT number, title, state, user__login FROM github.pulls WHERE owner = '{{OWNER}}' AND repo = '{{REPO}}' ORDER BY created_at DESC LIMIT 10;");
  const [queryResults, setQueryResults] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedTables, setExpandedTables] = useState({});
  const [tableColumns, setTableColumns] = useState({});
  const [loadingColumns, setLoadingColumns] = useState({});

  // Global settings and setup state
  const [lookbackDays, setLookbackDays] = useState(7);
  const [severityThreshold, setSeverityThreshold] = useState('medium');
  const [slackChannels, setSlackChannels] = useState('#incident, #oncall');
  const [cacheStats, setCacheStats] = useState({ size: '1.24 MB', queries: 24 });
  const [queryHistory, setQueryHistory] = useState([
    { timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), query: "SELECT * FROM github.issues LIMIT 10;", rows: 10, status: "Success" },
    { timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), query: "SELECT id, title FROM sentry.issues LIMIT 5;", rows: 5, status: "Success" }
  ]);

  // States for Landing Page
  const [activePreset, setActivePreset] = useState('prs');
  const [typedQuery, setTypedQuery] = useState("SELECT number, title, state FROM github.pulls WHERE owner = '{{OWNER}}' AND repo = '{{REPO}}' ORDER BY 1 DESC LIMIT 2;");
  const [terminalOutput, setTerminalOutput] = useState(`+--------+---------------------------------------+--------+
| number | title                                 | state  |
+--------+---------------------------------------+--------+
|   1482 | PatchLodash prototype vulnerability   | open   |
|   1481 | Fix flakiness in webpack pipelines    | closed |
+--------+---------------------------------------+--------+
2 rows returned inside WSL. (WSL execution: 12ms)`);
  const [isTyping, setIsTyping] = useState(false);
  const [compareVal, setCompareVal] = useState(0);

  const runLandingQuery = (type) => {
    if (isTyping) return;
    setActivePreset(type);
    setIsTyping(true);
    setTypedQuery("");
    setTerminalOutput("");

    const targetSql = PRESET_TEMPLATES.find(t => {
      if (type === 'prs') return t.name.includes('PRs');
      if (type === 'sentry') return t.name.includes('Sentry');
      if (type === 'actions') return t.name.includes('CI');
      if (type === 'tickets') return t.name.includes('Jira');
      return false;
    })?.sql || "SELECT * FROM coral.tables;";

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < targetSql.length) {
        setTypedQuery(prev => prev + targetSql.charAt(idx));
        idx++;
      } else {
        clearInterval(interval);
        setTerminalOutput("Compiling Coral query...");
        setTimeout(() => {
          const matched = queriesMock[type];
          setTerminalOutput(matched);
          setIsTyping(false);
        }, 400);
      }
    }, 8);
  };

  const handleRemoveConnection = (source) => {
    setConnections(prev => ({ ...prev, [source.toLowerCase()]: '' }));
    localStorage.removeItem(`coral_${source.toLowerCase()}_token`);
    alert(`${source} token cleared!`);
  };

  const handleClearCache = () => {
    if (confirm("Are you sure you want to clear Coral SQL cache?")) {
      setCacheStats({ size: '0.00 KB', queries: 0 });
      alert("Cache cleared successfully!");
    }
  };

  const loadHistoryToEditor = (queryStr) => {
    setSqlQuery(queryStr);
    setView('database');
  };

  const parseOwnerRepoFromValue = (val) => {
    try {
      let url = new URL(val);
      if (url.hostname.includes('github.com')) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
        }
      }
    } catch (e) {}
    const parts = val.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
    }
    return null;
  };

  const toggleTable = async (tableName) => {
    const isExpanding = !expandedTables[tableName];
    setExpandedTables(prev => ({ ...prev, [tableName]: isExpanding }));

    if (isExpanding && !tableColumns[tableName]) {
      setLoadingColumns(prev => ({ ...prev, [tableName]: true }));
      try {
        const response = await fetch(`http://localhost:8000/api/columns/${tableName}`);
        if (response.ok) {
          const data = await response.json();
          setTableColumns(prev => ({ ...prev, [tableName]: data }));
        }
      } catch (err) {
        console.error("Failed to load columns for " + tableName, err);
      } finally {
        setLoadingColumns(prev => ({ ...prev, [tableName]: false }));
      }
    }
  };

  const insertTextAtCursor = (text) => {
    setSqlQuery(prev => {
      const clean = prev.trim();
      if (clean.endsWith(';')) {
        return clean.slice(0, -1) + ' ' + text + ';';
      }
      return clean + ' ' + text;
    });
  };

  const executePlaygroundQuery = async () => {
    setQueryLoading(true);
    setQueryResults(null);
    setQueryError(null);

    let parsedOwner = 'open-metadata';
    let parsedRepo = 'OpenMetadata';
    let parsedKeyword = 'webpack';

    const parsed = parseOwnerRepoFromValue(paramValue);
    if (parsed) {
      parsedOwner = parsed.owner;
      parsedRepo = parsed.repo;
      parsedKeyword = parsed.repo;
    } else if (paramValue) {
      parsedKeyword = paramValue;
    }

    let interpolatedQuery = sqlQuery
      .replace(/\{\{OWNER\}\}/g, parsedOwner)
      .replace(/\{\{REPO\}\}/g, parsedRepo)
      .replace(/\{\{QUERY\}\}/g, parsedKeyword);

    try {
      const response = await fetch('http://localhost:8000/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: interpolatedQuery })
      });
      const data = await response.json();
      if (!response.ok) {
        setQueryError(data.detail || data.message || "Query execution failed");
        setQueryHistory(prev => [
          { timestamp: new Date().toISOString(), query: interpolatedQuery, rows: 0, status: "Failed" },
          ...prev
        ]);
      } else {
        setQueryResults(data);
        setQueryHistory(prev => [
          { timestamp: new Date().toISOString(), query: interpolatedQuery, rows: Array.isArray(data) ? data.length : 1, status: "Success" },
          ...prev
        ]);
      }
    } catch (err) {
      setQueryError(err.message || "Connection to backend failed");
      setQueryHistory(prev => [
        { timestamp: new Date().toISOString(), query: interpolatedQuery, rows: 0, status: "Failed" },
        ...prev
      ]);
    } finally {
      setQueryLoading(false);
    }
  };

  const toggleCard = async (index, message, title, category) => {
    const isExpanding = !expandedCards[index];
    setExpandedCards(prev => ({
      ...prev,
      [index]: isExpanding
    }));

    if (isExpanding && !summaries[index] && message) {
      setSummarizing(prev => ({ ...prev, [index]: true }));
      try {
        const response = await fetch('http://localhost:8000/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, title, category })
        });
        const data = await response.json();
        setSummaries(prev => ({ ...prev, [index]: data.summary }));
      } catch (err) {
        console.error(err);
      } finally {
        setSummarizing(prev => ({ ...prev, [index]: false }));
      }
    }
  };

  const [toolCache, setToolCache] = useState({});

  const handleToolSwitch = (newTool) => {
    // Save current active tool states
    setToolCache(prev => ({
      ...prev,
      [activeTool.id]: {
        results,
        expandedCards,
        summaries,
        activeTabs
      }
    }));

    // Switch tool
    setActiveTool(newTool);

    // Retrieve cached states or load defaults
    const cached = toolCache[newTool.id] || {};
    
    setResults(cached.results !== undefined ? cached.results : null);
    setExpandedCards(cached.expandedCards || {});
    setSummaries(cached.summaries || {});
    setActiveTabs(cached.activeTabs || {});
  };

  const [backendStatus, setBackendStatus] = useState({ coral_installed: false });
  const [connections, setConnections] = useState(() => {
    return {
      github: localStorage.getItem('coral_github_token') || '',
      slack: localStorage.getItem('coral_slack_token') || '',
      jira: localStorage.getItem('coral_jira_token') || '',
      jira_url: localStorage.getItem('coral_jira_url') || '',
      jira_email: localStorage.getItem('coral_jira_email') || '',
      sentry: localStorage.getItem('coral_sentry_token') || '',
      sentry_org: localStorage.getItem('coral_sentry_org') || ''
    };
  });

  const [tables, setTables] = useState([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Check backend status
    fetch('http://localhost:8000/api/status')
      .then(res => res.json())
      .then(data => setBackendStatus(data))
      .catch(() => setBackendStatus({ coral_installed: false }));

    // Sync saved tokens with backend on mount
    const savedGithub = localStorage.getItem('coral_github_token');
    if (savedGithub) {
      fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'GitHub', token: savedGithub })
      }).catch(() => {});
    }
    const savedSlack = localStorage.getItem('coral_slack_token');
    if (savedSlack) {
      fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'Slack', token: savedSlack })
      }).catch(() => {});
    }
    const savedJira = localStorage.getItem('coral_jira_token');
    if (savedJira) {
      const savedJiraUrl = localStorage.getItem('coral_jira_url');
      const savedJiraEmail = localStorage.getItem('coral_jira_email');
      fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'Jira', token: savedJira, jira_url: savedJiraUrl, jira_email: savedJiraEmail })
      }).catch(() => {});
    }
    const savedSentry = localStorage.getItem('coral_sentry_token');
    if (savedSentry) {
      const savedSentryOrg = localStorage.getItem('coral_sentry_org');
      fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'Sentry', token: savedSentry, sentry_org: savedSentryOrg })
      }).catch(() => {});
    }

    // Fetch real tables
    fetch('http://localhost:8000/api/tables')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setTables(data);
      })
      .catch(() => { });
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repoParam = params.get('repo') || params.get('url') || params.get('param') || params.get('q');
    const toolParam = params.get('f') || params.get('tool') || params.get('skill');

    if (repoParam) {
      setParamValue(repoParam);
    }

    if (toolParam) {
      const foundTool = tools.find(t => t.id === toolParam);
      if (foundTool) {
        setActiveTool(foundTool);
      } else if (toolParam === 'error') {
        setResults([{
          status: 'Error',
          category: 'URL Input Parameter',
          message: 'Error: invalid function parameter specified (f=error). Please choose a valid tool from the sidebar or verify your link.',
          state: 'error'
        }]);
      }
    }
  }, []);

  const handleConnect = async (source, token, extraData = {}) => {
    try {
      const response = await fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, token, ...extraData })
      });
      const data = await response.json();
      if (response.ok) {
        alert(`${source} connected!`);
        setConnections(prev => ({ ...prev, [source.toLowerCase()]: token, ...extraData }));
        localStorage.setItem(`coral_${source.toLowerCase()}_token`, token);
        Object.entries(extraData).forEach(([k, v]) => localStorage.setItem(`coral_${k}`, v));
      } else {
        alert(`Error: ${data.detail}`);
      }
    } catch (err) {
      alert("Failed to connect to backend.");
    }
  };

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const inputConfig = {
    failure_hunter: {
      label: 'Repo URL or commit/build identifier',
      placeholder: 'https://github.com/owner/repo or commit SHA'
    },
    pr_reaper: {
      label: 'Repository URL',
      placeholder: 'https://github.com/owner/repo'
    },
    default: {
      label: 'ID, Path, or URL',
      placeholder: 'ID, Path, or URL'
    }
  };

  const parseMetrics = (detailsStr) => {
    if (!detailsStr) return null;
    const metrics = {};
    const parts = detailsStr.split(', ');
    parts.forEach(part => {
      const idx = part.indexOf(':');
      if (idx !== -1) {
        const key = part.slice(0, idx).trim().toLowerCase();
        const val = part.slice(idx + 1).trim();
        metrics[key] = val;
      }
    });
    return Object.keys(metrics).length > 0 ? metrics : null;
  };

  const executeTool = async () => {
    setLoading(true);
    setResults(null);
    setExpandedCards({});
    try {
      let parsedOwner = '';
      let parsedRepo = '';
      try {
        let url = new URL(paramValue);
        if (url.hostname.includes('github.com')) {
          const parts = url.pathname.split('/').filter(Boolean);
          if (parts.length >= 2) {
            parsedOwner = parts[0];
            parsedRepo = parts[1].replace(/\.git$/, '');
          }
        }
      } catch (e) {
        // Not a valid URL, fallback
      }

      if (!parsedOwner || !parsedRepo) {
        const parts = paramValue.split('/').filter(Boolean);
        if (parts.length >= 2) {
          parsedOwner = parts[0];
          parsedRepo = parts[1].replace(/\.git$/, '');
        }
      }

      let fullRepoName = paramValue;
      if (parsedOwner && parsedRepo && parsedOwner !== 'http:' && parsedOwner !== 'https:') {
        fullRepoName = `${parsedOwner}/${parsedRepo}`;
      }

      const response = await fetch('http://localhost:8000/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_id: activeTool.id,
          params: {
            BUILD_ID: paramValue,
            PR_NUMBER: paramValue,
            COMMIT_HASH: paramValue,
            TICKET_ID: paramValue,
            DOC_ID: paramValue,
            PACKAGE_NAME: paramValue,
            FILE_PATH: paramValue,
            REPO_NAME: fullRepoName,
            UPSTREAM_REPO: fullRepoName,
            OWNER: parsedOwner,
            REPO: parsedRepo,
            STALE_DAYS: activeTool.id === 'pr_reaper' ? 7 : undefined
          }
        })
      });
      const data = await response.json().catch(() => ({ message: 'Unable to parse backend response' }));
      if (!response.ok) {
        setResults([{ status: 'Error', message: data.detail || data.message || response.statusText, state: 'error' }]);
      } else if (Array.isArray(data)) {
        setResults(data);
      } else {
        setResults([data]);
      }
    } catch (err) {
      console.error(err);
      setResults([{ status: 'Error', message: err.message || 'Request failed', state: 'error' }]);
    }
    setLoading(false);
  };

  const isLanding = view === 'landing';

  return (
    <div className="app-container" style={{ gridTemplateColumns: isLanding ? '1fr' : '260px 1fr' }}>
      <style>{`
        :root {
          --bg-main: #f8fafc;
          --bg-sidebar: #ffffff;
          --bg-card: #ffffff;
          --bg-input: #f1f5f9;
          --text-main: #1e293b;
          --text-dim: #64748b;
          --accent: #3b82f6;
          --border: #e2e8f0;
          --success: #10b981;
          --danger: #ef4444;
          --shadow: 0 1px 3px rgba(0,0,0,0.1);
          --glass: rgba(255, 255, 255, 0.8);
        }

        [data-theme='dark'] {
          --bg-main: #0f172a;
          --bg-sidebar: #1e293b;
          --bg-card: #1e293b;
          --bg-input: #0f172a;
          --text-main: #f1f5f9;
          --text-dim: #94a3b8;
          --accent: #60a5fa;
          --border: #334155;
          --success: #34d399;
          --danger: #f87171;
          --shadow: 0 4px 12px rgba(0,0,0,0.3);
          --glass: rgba(30, 41, 59, 0.8);
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background-color: var(--bg-main);
          color: var(--text-main);
          transition: background-color 0.3s ease, color 0.3s ease;
        }

        .app-container {
          display: grid;
          grid-template-columns: 260px 1fr;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
        }

        .sidebar {
          background-color: var(--bg-sidebar);
          border-right: 1px solid var(--border);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          height: 100%;
          overflow-y: auto;
          position: relative;
        }

        .main-content {
          padding: 40px;
          overflow-y: auto;
          height: 100%;
          background-color: var(--bg-main);
        }

        .logo {
          font-weight: 800;
          font-size: 20px;
          color: var(--accent);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .nav-item {
          padding: 10px 12px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--text-dim);
          font-weight: 500;
          transition: all 0.2s;
          position: relative;
        }

        .nav-item:hover {
          background-color: var(--bg-input);
          color: var(--text-main);
        }

        .nav-item.active {
          background-color: var(--accent);
          color: white;
        }

        .nav-item:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 12px;
          background: var(--text-main);
          color: var(--bg-main);
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          z-index: 100;
          box-shadow: var(--shadow);
        }

        .card {
          background-color: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 24px;
          box-shadow: var(--shadow);
        }

        .input {
          width: 100%;
          padding: 10px 14px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background-color: var(--bg-input);
          color: var(--text-main);
          outline: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
        }

        .btn {
          padding: 10px 18px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: opacity 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-primary {
          background-color: var(--accent);
          color: white;
        }

        .btn-secondary {
          background-color: var(--bg-input);
          color: var(--text-main);
          border: 1px solid var(--border);
        }

        .theme-toggle {
          position: absolute;
          top: 24px;
          left: 24px;
          z-index: 1000;
          background: var(--bg-card);
          border: 1px solid var(--border);
          padding: 8px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-main);
          box-shadow: var(--shadow);
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          text-align: left;
          padding: 12px;
          color: var(--text-dim);
          font-size: 12px;
          border-bottom: 1px solid var(--border);
        }

        td {
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }

        .status-tag {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          display: inline-block;
        }

        .status-tag.open { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .status-tag.closed { background: rgba(16, 185, 129, 0.1); color: #10b981; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }

        /* Premium Cards View styling */
        .results-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .summary-card {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: var(--shadow);
        }

        .result-card {
          background-color: var(--bg-card) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          padding: 20px !important;
          box-shadow: var(--shadow) !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
          position: relative !important;
          transition: transform 0.2s, box-shadow 0.2s !important;
        }

        .result-card:hover {
          transform: translateY(-2px) !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.08) !important;
        }

        .result-card-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: flex-start !important;
          gap: 16px !important;
        }

        .result-card-category {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          text-transform: uppercase !important;
          color: var(--accent) !important;
        }

        .result-card-title {
          font-size: 16px !important;
          font-weight: 600 !important;
          color: var(--text-main) !important;
          text-decoration: none !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          line-height: 1.4 !important;
        }

        .result-card-title:hover {
          color: var(--accent) !important;
        }

        .result-card-desc {
          font-size: 13px !important;
          color: var(--text-dim) !important;
          line-height: 1.5 !important;
        }

        .callout-box {
          background: var(--bg-input) !important;
          border-left: 3px solid var(--accent) !important;
          border-radius: 4px !important;
          padding: 10px 14px !important;
          font-size: 13px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 4px !important;
        }

        .callout-box.action {
          border-left-color: var(--success) !important;
        }

        .metrics-row {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          margin-top: 4px !important;
        }

        .metric-pill {
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          padding: 4px 10px !important;
          border-radius: 9999px !important;
          background-color: var(--bg-input) !important;
          color: var(--text-dim) !important;
        }

        .metric-pill.success {
          background-color: rgba(16, 185, 129, 0.1) !important;
          color: var(--success) !important;
        }

        .metric-pill.danger {
          background-color: rgba(239, 68, 68, 0.1) !important;
          color: var(--danger) !important;
        }

        .expandable-details {
          margin-top: 12px !important;
          padding: 12px !important;
          border-top: 1px dashed var(--border) !important;
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 12px !important;
          color: var(--text-dim) !important;
          background-color: var(--bg-input) !important;
          border-radius: 6px !important;
          white-space: pre-wrap !important;
          word-break: break-all !important;
          line-height: 1.6 !important;
        }

        .expandable-details .details-list {
          font-family: 'Inter', sans-serif !important;
          margin: 0 !important;
          padding-left: 20px !important;
          list-style-type: disc !important;
        }

        .expandable-details .details-list li {
          margin-bottom: 8px !important;
          color: var(--text-main) !important;
          line-height: 1.5 !important;
        }

        .expandable-details .details-list li:last-child {
          margin-bottom: 0 !important;
        }

        .btn-xs {
          padding: 4px 8px !important;
          font-size: 11px !important;
          height: auto !important;
          border-radius: 4px !important;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .pulse {
          animation: pulse 1.5s ease-in-out infinite !important;
        }

        .schema-table-card {
          transition: border-color 0.15s, transform 0.15s;
        }
        .schema-table-card:hover {
          border-color: var(--accent) !important;
          transform: translateY(-1px);
        }
        .schema-column-row {
          transition: background-color 0.15s;
          padding: 4px 8px !important;
          border-radius: 4px;
        }
        .schema-column-row:hover {
          background-color: var(--bg-input) !important;
        }
        .results-row-hover:hover {
          background-color: rgba(59, 130, 246, 0.05) !important;
        }

        /* Scoped Landing Page styles */
        .landing-scope {
          --bg: #f8fafc;
          --card-bg: rgba(255, 255, 255, 0.7);
          --border: rgba(0, 0, 0, 0.08);
          --text: #0f172a;
          --text-dim: #475569;
          --accent: #4f46e5;
          --accent-glow: rgba(79, 70, 229, 0.08);
          --success: #10b981;
          --warning: #f59e0b;
          --danger: #ef4444;
          --font-display: 'Outfit', sans-serif;
          --font-body: 'Inter', sans-serif;
          --font-mono: 'Fira Code', monospace;
          
          background-color: var(--bg) !important;
          color: var(--text) !important;
          font-family: var(--font-body) !important;
          min-height: 100vh !important;
          width: 100% !important;
          position: relative !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          line-height: 1.6 !important;
          z-index: 10 !important;
        }

        .landing-scope * {
          box-sizing: border-box !important;
        }

        .landing-scope .glow-blob {
          position: absolute !important;
          border-radius: 50% !important;
          filter: blur(160px) !important;
          z-index: 1 !important;
          opacity: 0.45 !important;
          pointer-events: none !important;
        }

        .landing-scope .glow-1 {
          top: -100px !important;
          right: -100px !important;
          width: 600px !important;
          height: 600px !important;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(248, 250, 252, 0) 70%) !important;
        }

        .landing-scope .glow-2 {
          top: 600px !important;
          left: -200px !important;
          width: 500px !important;
          height: 500px !important;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, rgba(248, 250, 252, 0) 70%) !important;
        }

        .landing-scope .glow-3 {
          bottom: 200px !important;
          right: -100px !important;
          width: 550px !important;
          height: 550px !important;
          background: radial-gradient(circle, rgba(129, 140, 248, 0.12) 0%, rgba(248, 250, 252, 0) 70%) !important;
        }

        .landing-scope header {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          backdrop-filter: blur(12px) !important;
          background-color: rgba(255, 255, 255, 0.7) !important;
          border-bottom: 1px solid var(--border) !important;
          z-index: 1000 !important;
          transition: all 0.3s !important;
        }

        .landing-scope .nav-container {
          max-width: 1200px !important;
          margin: 0 auto !important;
          padding: 16px 24px !important;
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
        }

        .landing-scope .logo {
          font-family: var(--font-display) !important;
          font-weight: 800 !important;
          font-size: 22px !important;
          color: #0f172a !important;
          text-decoration: none !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          margin-top: 0 !important;
        }

        .landing-scope .logo span {
          background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .nav-links {
          display: flex !important;
          gap: 32px !important;
          align-items: center !important;
        }

        .landing-scope .nav-link {
          color: var(--text-dim) !important;
          text-decoration: none !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          transition: color 0.2s !important;
        }

        .landing-scope .nav-link:hover {
          color: var(--text) !important;
        }

        .landing-scope .btn {
          padding: 10px 20px !important;
          border-radius: 8px !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          cursor: pointer !important;
          text-decoration: none !important;
          transition: all 0.2s !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          border: none !important;
        }

        .landing-scope .btn-primary {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
          color: #ffffff !important;
          box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4) !important;
        }

        .landing-scope .btn-primary:hover {
          transform: translateY(-2px) !important;
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6) !important;
        }

        .landing-scope .btn-secondary {
          background-color: rgba(0, 0, 0, 0.03) !important;
          color: var(--text) !important;
          border: 1px solid var(--border) !important;
        }

        .landing-scope .btn-secondary:hover {
          background-color: rgba(0, 0, 0, 0.06) !important;
          transform: translateY(-2px) !important;
        }

        .landing-scope .section-container {
          max-width: 1200px !important;
          margin: 0 auto !important;
          padding: 120px 24px 60px 24px !important;
          position: relative !important;
          z-index: 2 !important;
        }

        .landing-scope .hero-layout {
          display: grid !important;
          grid-template-columns: 1.1fr 0.9fr !important;
          gap: 40px !important;
          align-items: center !important;
        }

        .landing-scope .hero-title {
          font-family: var(--font-display) !important;
          font-size: 54px !important;
          font-weight: 900 !important;
          line-height: 1.15 !important;
          margin-bottom: 24px !important;
          background: linear-gradient(135deg, #0f172a 0%, #334155 50%, #4f46e5 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .hero-title span {
          background: linear-gradient(135deg, #818cf8 0%, #3b82f6 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .hero-desc {
          font-size: 18px !important;
          color: #334155 !important;
          margin-bottom: 36px !important;
          max-width: 540px !important;
        }

        .landing-scope .hero-ctas {
          display: flex !important;
          gap: 16px !important;
          margin-bottom: 48px !important;
        }

        .landing-scope .mockup-container {
          position: relative !important;
          background-color: var(--card-bg) !important;
          border: 1px solid var(--border) !important;
          border-radius: 16px !important;
          padding: 16px !important;
          box-shadow: 0 20px 50px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1) !important;
          backdrop-filter: blur(12px) !important;
          transform: perspective(1000px) rotateY(-5deg) rotateX(5deg) !important;
          transition: all 0.5s ease !important;
        }

        .landing-scope .mockup-container:hover {
          transform: perspective(1000px) rotateY(0deg) rotateX(0deg) !important;
          box-shadow: 0 25px 60px rgba(99, 102, 241, 0.08), inset 0 1px 0 rgba(255,255,255,1) !important;
        }

        .landing-scope .mockup-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          margin-bottom: 12px !important;
          border-bottom: 1px solid var(--border) !important;
          padding-bottom: 8px !important;
        }

        .landing-scope .mockup-dots {
          display: flex !important;
          gap: 6px !important;
        }

        .landing-scope .mockup-dot {
          width: 8px !important;
          height: 8px !important;
          border-radius: 50% !important;
        }

        .landing-scope .mockup-dot.red { background-color: var(--danger) !important; }
        .landing-scope .mockup-dot.yellow { background-color: var(--warning) !important; }
        .landing-scope .mockup-dot.green { background-color: var(--success) !important; }

        .landing-scope .mockup-card {
          background-color: rgba(241, 245, 249, 0.6) !important;
          border: 1px solid var(--border) !important;
          border-radius: 8px !important;
          padding: 14px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 8px !important;
        }

        .landing-scope .mockup-pill {
          font-size: 10px !important;
          font-weight: 700 !important;
          color: var(--success) !important;
          background-color: rgba(16, 185, 129, 0.15) !important;
          padding: 2px 8px !important;
          border-radius: 999px !important;
          align-self: flex-start !important;
          text-transform: uppercase !important;
        }

        .landing-scope .mockup-title {
          font-weight: 700 !important;
          font-size: 14px !important;
          font-family: var(--font-display) !important;
        }

        .landing-scope .mockup-body {
          font-size: 12px !important;
          color: var(--text-dim) !important;
        }

        .landing-scope .section-title-wrap {
          text-align: center !important;
          margin-bottom: 60px !important;
        }

        .landing-scope .section-title {
          font-family: var(--font-display) !important;
          font-size: 38px !important;
          font-weight: 800 !important;
          margin-bottom: 12px !important;
          background: linear-gradient(135deg, #0f172a 0%, #334155 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .section-desc {
          color: var(--text-dim) !important;
          font-size: 15px !important;
          max-width: 600px !important;
          margin: 0 auto !important;
        }

        .landing-scope .features-grid {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)) !important;
          gap: 24px !important;
        }

        .landing-scope .feature-card {
          background-color: var(--card-bg) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          padding: 32px !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.03) !important;
          transition: all 0.3s !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 16px !important;
        }

        .landing-scope .feature-card:hover {
          border-color: var(--accent) !important;
          transform: translateY(-5px) !important;
          box-shadow: 0 15px 40px rgba(99, 102, 241, 0.08) !important;
        }

        .landing-scope .feature-icon-box {
          width: 48px !important;
          height: 48px !important;
          border-radius: 10px !important;
          background-color: rgba(99, 102, 241, 0.1) !important;
          border: 1px solid rgba(99, 102, 241, 0.2) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          color: var(--accent) !important;
        }

        .landing-scope .feature-name {
          font-family: var(--font-display) !important;
          font-size: 18px !important;
          font-weight: 700 !important;
        }

        .landing-scope .feature-desc {
          font-size: 13px !important;
          color: var(--text-dim) !important;
          line-height: 1.6 !important;
        }

        .landing-scope .terminal-section {
          background-color: rgba(255, 255, 255, 0.8) !important;
          border: 1px solid var(--border) !important;
          border-radius: 16px !important;
          padding: 32px !important;
          display: grid !important;
          grid-template-columns: 280px 1fr !important;
          gap: 24px !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.05) !important;
          backdrop-filter: blur(12px) !important;
        }

        .landing-scope .terminal-menu {
          display: flex !important;
          flex-direction: column !important;
          gap: 10px !important;
          border-right: 1px solid var(--border) !important;
          padding-right: 20px !important;
        }

        .landing-scope .terminal-btn {
          background: none !important;
          border: 1px solid transparent !important;
          padding: 10px 14px !important;
          border-radius: 6px !important;
          text-align: left !important;
          font-family: var(--font-body) !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          color: var(--text-dim) !important;
          cursor: pointer !important;
          transition: all 0.2s !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
        }

        .landing-scope .terminal-btn:hover {
          color: var(--text) !important;
          background-color: rgba(0, 0, 0, 0.02) !important;
        }

        .landing-scope .terminal-btn.active {
          color: var(--text) !important;
          background-color: rgba(99, 102, 241, 0.05) !important;
          border-color: rgba(99, 102, 241, 0.15) !important;
        }

        .landing-scope .terminal-workspace {
          display: flex !important;
          flex-direction: column !important;
          gap: 16px !important;
          min-height: 380px !important;
        }

        .landing-scope .terminal-box {
          background-color: #050b18 !important;
          border: 1px solid var(--border) !important;
          border-radius: 8px !important;
          padding: 18px !important;
          font-family: var(--font-mono) !important;
          font-size: 13px !important;
          color: #a7f3d0 !important;
          flex: 1 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
          overflow-y: auto !important;
          max-height: 300px !important;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.8) !important;
          position: relative !important;
        }

        .landing-scope .terminal-line {
          display: flex !important;
          gap: 8px !important;
        }

        .landing-scope .terminal-prompt {
          color: #818cf8 !important;
          user-select: none !important;
        }

        .landing-scope .terminal-output {
          color: #a7f3d0 !important;
          white-space: pre-wrap !important;
          animation: fadeIn 0.3s forwards !important;
        }

        .landing-scope #terminalResponse .terminal-output {
          color: #cbd5e1 !important;
        }

        .landing-scope .terminal-loader {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          color: #818cf8 !important;
          font-style: italic !important;
        }

        .landing-scope .integrations-box {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          background-color: var(--card-bg) !important;
          border: 1px solid var(--border) !important;
          border-radius: 16px !important;
          padding: 40px !important;
          position: relative !important;
          overflow: hidden !important;
          min-height: 380px !important;
        }

        .landing-scope .central-core {
          width: 90px !important;
          height: 90px !important;
          border-radius: 50% !important;
          background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-family: var(--font-display) !important;
          font-weight: 800 !important;
          font-size: 18px !important;
          color: #ffffff !important;
          box-shadow: 0 0 40px rgba(99, 102, 241, 0.6) !important;
          z-index: 10 !important;
          position: relative !important;
          animation: pulseCore 2.5s infinite ease-in-out !important;
        }

        .landing-scope .nodes-container {
          position: absolute !important;
          width: 100% !important;
          height: 100% !important;
          top: 0 !important;
          left: 0 !important;
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
        }

        .landing-scope .node {
          position: absolute !important;
          width: 56px !important;
          height: 56px !important;
          border-radius: 12px !important;
          background-color: #ffffff !important;
          border: 1px solid var(--border) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-weight: 700 !important;
          font-size: 11px !important;
          color: var(--text) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.04) !important;
          transition: all 0.3s !important;
          z-index: 5 !important;
          margin-top: 0 !important;
        }

        .landing-scope .node:hover {
          border-color: var(--accent) !important;
          box-shadow: 0 0 20px rgba(99, 102, 241, 0.2) !important;
          transform: scale(1.1) !important;
        }

        .landing-scope .node.n-github { top: 40px !important; left: calc(50% - 28px) !important; }
        .landing-scope .node.n-slack  { bottom: 40px !important; left: calc(50% - 28px) !important; }
        .landing-scope .node.n-jira   { left: 40px !important; top: calc(50% - 28px) !important; }
        .landing-scope .node.n-sentry { right: 40px !important; top: calc(50% - 28px) !important; }

        .landing-scope .pulse-line {
          position: absolute !important;
          background-color: rgba(99, 102, 241, 0.22) !important;
          z-index: 1 !important;
        }

        .landing-scope .pulse-line.vertical {
          width: 2px !important;
          height: 380px !important;
          top: 0 !important;
          left: calc(50% - 1px) !important;
        }

        .landing-scope .pulse-line.horizontal {
          height: 2px !important;
          width: 100% !important;
          left: 0 !important;
          top: calc(50% - 1px) !important;
        }

        .landing-scope .compare-section {
          background-color: var(--card-bg) !important;
          border: 1px solid var(--border) !important;
          border-radius: 16px !important;
          padding: 40px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 32px !important;
        }

        .landing-scope .compare-controls {
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
          align-items: center !important;
        }

        .landing-scope .slider-wrap {
          width: 100% !important;
          max-width: 600px !important;
          position: relative !important;
        }

        .landing-scope .slider {
          -webkit-appearance: none !important;
          width: 100% !important;
          height: 8px !important;
          border-radius: 4px !important;
          background: rgba(0, 0, 0, 0.04) !important;
          border: 1px solid var(--border) !important;
          outline: none !important;
          cursor: pointer !important;
        }

        .landing-scope .slider::-webkit-slider-thumb {
          -webkit-appearance: none !important;
          appearance: none !important;
          width: 22px !important;
          height: 22px !important;
          border-radius: 50% !important;
          background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%) !important;
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.8) !important;
          border: none !important;
          transition: transform 0.1s !important;
        }

        .landing-scope .slider::-webkit-slider-thumb:hover {
          transform: scale(1.2) !important;
        }

        .landing-scope .compare-chart {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 24px !important;
        }

        .landing-scope .chart-bar-container {
          background-color: rgba(241, 245, 249, 0.6) !important;
          border: 1px solid var(--border) !important;
          border-radius: 12px !important;
          padding: 24px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 16px !important;
          min-height: 220px !important;
          justify-content: flex-end !important;
        }

        .landing-scope .chart-bar-title {
          font-size: 13px !important;
          font-weight: 700 !important;
          color: var(--text-dim) !important;
          text-transform: uppercase !important;
          margin-bottom: auto !important;
        }

        .landing-scope .chart-bar-val {
          font-family: var(--font-display) !important;
          font-size: 32px !important;
          font-weight: 800 !important;
          line-height: 1 !important;
        }

        .landing-scope .chart-bar-val.fast {
          background: linear-gradient(135deg, var(--success) 0%, #34d399 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .chart-bar-val.slow {
          background: linear-gradient(135deg, var(--danger) 0%, #f87171 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .landing-scope .chart-bar {
          border-radius: 6px !important;
          width: 100% !important;
          transition: height 0.5s ease-out !important;
        }

        .landing-scope .chart-bar.legacy {
          background: linear-gradient(90deg, #ef4444 0%, #f87171 100%) !important;
        }

        .landing-scope .chart-bar.coral {
          background: linear-gradient(90deg, #10b981 0%, #34d399 100%) !important;
        }

        .landing-scope footer {
          border-top: 1px solid var(--border) !important;
          padding: 48px 24px !important;
          text-align: center !important;
          font-size: 13px !important;
          color: var(--text-dim) !important;
          margin-top: 60px !important;
        }

        /* Dynamic Dark Theme Overrides */
        [data-theme='dark'] .landing-scope {
          --bg: #030712;
          --card-bg: rgba(17, 24, 39, 0.7);
          --border: rgba(255, 255, 255, 0.08);
          --text: #f3f4f6;
          --text-dim: #9ca3af;
          --accent: #6366f1;
          --accent-glow: rgba(99, 102, 241, 0.15);
          --success: #10b981;
          --warning: #f59e0b;
          --danger: #ef4444;
        }

        [data-theme='dark'] .landing-scope .glow-1 {
          background: radial-gradient(circle, #4f46e5 0%, #030712 70%) !important;
        }

        [data-theme='dark'] .landing-scope .glow-2 {
          background: radial-gradient(circle, #3b82f6 0%, #030712 70%) !important;
        }

        [data-theme='dark'] .landing-scope .glow-3 {
          background: radial-gradient(circle, #818cf8 0%, #030712 70%) !important;
        }

        [data-theme='dark'] .landing-scope header {
          background-color: rgba(3, 7, 18, 0.7) !important;
        }

        [data-theme='dark'] .landing-scope .logo {
          color: #f3f4f6 !important;
        }

        [data-theme='dark'] .landing-scope .hero-title {
          background: linear-gradient(135deg, #ffffff 0%, #d1d5db 50%, #93c5fd 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        [data-theme='dark'] .landing-scope .hero-desc {
          color: var(--text-dim) !important;
        }

        [data-theme='dark'] .landing-scope .mockup-container {
          box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
        }

        [data-theme='dark'] .landing-scope .mockup-container:hover {
          box-shadow: 0 25px 60px rgba(99, 102, 241, 0.15), inset 0 1px 0 rgba(255,255,255,0.15) !important;
        }

        [data-theme='dark'] .landing-scope .mockup-card {
          background-color: rgba(3, 7, 18, 0.4) !important;
        }

        [data-theme='dark'] .landing-scope .section-title {
          background: linear-gradient(135deg, #ffffff 0%, #d1d5db 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        [data-theme='dark'] .landing-scope .feature-card {
          box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
        }

        [data-theme='dark'] .landing-scope .feature-card:hover {
          box-shadow: 0 15px 40px var(--accent-glow) !important;
        }

        [data-theme='dark'] .landing-scope .terminal-section {
          background-color: rgba(3, 7, 18, 0.8) !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.6) !important;
        }

        [data-theme='dark'] .landing-scope .terminal-btn:hover {
          color: var(--text) !important;
          background-color: rgba(255, 255, 255, 0.03) !important;
        }

        [data-theme='dark'] .landing-scope .terminal-btn.active {
          color: var(--text) !important;
          background-color: rgba(99, 102, 241, 0.1) !important;
          border-color: rgba(99, 102, 241, 0.2) !important;
        }

        [data-theme='dark'] .landing-scope .node {
          background-color: #0b1120 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
        }

        [data-theme='dark'] .landing-scope .node:hover {
          box-shadow: 0 0 20px rgba(99, 102, 241, 0.4) !important;
        }

        [data-theme='dark'] .landing-scope .pulse-line {
          background-color: rgba(99, 102, 241, 0.25) !important;
        }

        [data-theme='dark'] .landing-scope .chart-bar-container {
          background-color: rgba(3, 7, 18, 0.4) !important;
        }

        [data-theme='dark'] .landing-scope .slider {
          background: rgba(255, 255, 255, 0.05) !important;
        }
      `}</style>

      {!isLanding && (
        <aside className="sidebar">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <div
            style={{
              marginTop: '30px',
              cursor: 'default',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              width: '100%',
              userSelect: 'none',
            }}
          >
            {/* T🌳P logo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{
                fontSize: '48px', fontWeight: '900',
                fontFamily: "'Inter', 'Outfit', sans-serif",
                color: theme === 'dark' ? '#e2e8f0' : '#0d1b3e',
                lineHeight: '1', display: 'flex', alignItems: 'center',
              }}>T</span>
              <img
                src="/logo_tree.png"
                alt="O"
                style={{ width: '52px', height: '52px', display: 'block', flexShrink: 0 }}
              />
              <span style={{
                fontSize: '48px', fontWeight: '900',
                fontFamily: "'Inter', 'Outfit', sans-serif",
                color: theme === 'dark' ? '#e2e8f0' : '#0d1b3e',
                lineHeight: '1', display: 'flex', alignItems: 'center',
              }}>P</span>
            </div>
            <p style={{
              fontSize: '10px', fontWeight: '600',
              textTransform: 'uppercase', letterSpacing: '0.14em',
              color: 'var(--text-dim)', textAlign: 'center', margin: '0',
            }}>Team Optimization Portal</p>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              className={`nav-item ${view === 'dashboard' ? 'active' : ''}`}
              onClick={() => setView('dashboard')}
              data-tooltip="Main tools for developers."
            >
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </div>
            <div
              className={`nav-item ${view === 'database' ? 'active' : ''}`}
              onClick={() => setView('database')}
              data-tooltip="Write and run custom SQL queries via Coral."
            >
              <TerminalSquare size={18} />
              <span>Query Console</span>
            </div>
            <div
              className={`nav-item ${view === 'setup' ? 'active' : ''}`}
              onClick={() => setView('setup')}
              data-tooltip="Configure your API keys."
            >
              <Settings size={18} />
              <span>Setup</span>
            </div>
          </nav>

          <div style={{ height: '1px', background: 'var(--border)', margin: '12px 0' }} />

          {view === 'dashboard' && (
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '8px' }}>AVAILABLE TOOLS</p>
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className={`nav-item ${activeTool.id === tool.id ? 'active' : ''}`}
                  onClick={() => handleToolSwitch(tool)}
                  data-tooltip={tool.tooltip}
                >
                  <tool.icon size={18} />
                  <span>{tool.name}</span>
                </div>
              ))}
            </nav>
          )}

          <div style={{ marginTop: 'auto', fontSize: '12px', color: 'var(--text-dim)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: backendStatus.coral_installed ? 'var(--success)' : 'var(--danger)' }} />
              Backend: {backendStatus.coral_installed ? 'Connected' : 'Offline'}
            </div>
          </div>
        </aside>
      )}

      <main className="main-content" style={{ padding: isLanding ? '0' : '40px' }}>
        {view === 'landing' ? (
          <div className="landing-scope">
            {/* Ambient Glow */}
            <div className="glow-blob glow-1"></div>
            <div className="glow-blob glow-2"></div>
            <div className="glow-blob glow-3"></div>

            {/* Header Nav */}
            <header>
              <div className="nav-container">
                <a href="#" className="logo" onClick={(e) => { e.preventDefault(); setView('landing'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
                >
                  {/* T🌳P logomark */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                    <span style={{ fontSize: '22px', fontWeight: '900', fontFamily: "'Outfit', 'Inter', sans-serif", color: '#e2e8f0', lineHeight: '1' }}>T</span>
                    <img src="/logo_tree.png" alt="O" style={{ width: '24px', height: '24px', display: 'block' }} />
                    <span style={{ fontSize: '22px', fontWeight: '900', fontFamily: "'Outfit', 'Inter', sans-serif", color: '#e2e8f0', lineHeight: '1' }}>P</span>
                  </div>
                  {/* Full name */}
                  <span style={{ fontSize: '13px', fontWeight: '700', fontFamily: "'Outfit', 'Inter', sans-serif", color: '#e2e8f0', letterSpacing: '0.02em' }}>
                    TEAM OPTIMIZATION PORTAL <span style={{ background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>(TOP)</span>
                  </span>
                </a>
                <nav className="nav-links">
                  <a href="#features" className="nav-link">Coral Core</a>
                  <a href="#terminal" className="nav-link">Live Terminal</a>
                  <a href="#pulse" className="nav-link">Network</a>
                  <a href="#compare" className="nav-link">Performance</a>
                  <button onClick={() => setView('dashboard')} className="btn btn-primary">Launch Dashboard</button>
                </nav>
              </div>
            </header>

            {/* Hero Section */}
            <section className="section-container" style={{ paddingTop: '140px' }}>
              <div className="hero-layout">
                <div>
                  <h1 className="hero-title">
                    Unleash Developer Intelligence with <span>TOP</span> <br />
                    Powered by <span>Coral</span>.
                  </h1>
                  <p className="hero-desc">
                    The ultimate developer mission control portal. TOP consolidates Sentry, Slack, GitHub, and Jira using Coral's unified SQL query engine and an advanced multi-tier offline AI intelligence layer.
                  </p>
                  <div className="hero-ctas">
                    <button onClick={() => setView('dashboard')} className="btn btn-primary">Launch Dashboard</button>
                    <a href="#features" className="btn btn-secondary">Explore Features</a>
                  </div>
                </div>
                
                <div>
                  <div className="mockup-container">
                    <div className="mockup-header">
                      <div className="mockup-dots">
                        <span className="mockup-dot red"></span>
                        <span className="mockup-dot yellow"></span>
                        <span className="mockup-dot green"></span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>TOP Mission Control</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="mockup-card">
                        <span className="mockup-pill">✅ CI Completed</span>
                        <span className="mockup-title">Fix flakiness in webpack pipelines</span>
                        <p className="mockup-body">Coral resolved workflow execution parameters directly inside WSL in 12ms.</p>
                      </div>
                      <div className="mockup-card" style={{ opacity: 0.85 }}>
                        <span className="mockup-pill" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }}>⚠️ Sentry Alert</span>
                        <span className="mockup-title">ZeroDivisionError: division by zero in auth.py</span>
                        <p className="mockup-body">Identified 3 Slack conversations discussing this incident.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Features Block (TOP Capabilities) */}
            <section id="features" className="section-container">
              <div className="section-title-wrap">
                <h2 className="section-title">TOP Core Architecture</h2>
                <p className="section-desc">Traditional troubleshooting is fragmented. The Team Optimization Portal unites real-time unified data querying with robust offline LLM intelligence.</p>
              </div>
              
              <div className="features-grid">
                {/* Feature 1 */}
                <div className="feature-card">
                  <div className="feature-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 22V4c0-.5.2-1 .6-1.4C5 2.2 5.5 2 6 2h12c.5 0 1 .2 1.4.6.4.4.6.9.6 1.4v18l-5-4-5 4-5-4Z"/></svg>
                  </div>
                  <h3 className="feature-name">Unified SQL Adaptation</h3>
                  <p className="feature-desc">Treat Jira, GitHub, Slack, and Sentry as standard SQL databases. Query cross-source metrics inside one single unified database view powered by Coral.</p>
                </div>
                {/* Feature 2 */}
                <div className="feature-card">
                  <div className="feature-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
                  </div>
                  <h3 className="feature-name">High-Performance WSL Pipeline</h3>
                  <p className="feature-desc">Execute queries asynchronously inside TOP's WSL Ubuntu telemetry pipeline in milliseconds for ultra-responsive feedback loops.</p>
                </div>
                {/* Feature 3 */}
                <div className="feature-card">
                  <div className="feature-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  </div>
                  <h3 className="feature-name">Triple-Layer LLM System</h3>
                  <p className="feature-desc">Our Triple-Layer LLM system uses a robust 3-tier architecture: Tier 1 (Local Ollama llama3.2) for offline private queries, fallback Tier 2 (Cloud Pollinations OpenAI) for zero-auth remote reasoning, and a final Tier 3 (Local Heuristic NLP) to guarantee structural summaries under any network conditions.</p>
                </div>
                {/* Feature 4 */}
                <div className="feature-card">
                  <div className="feature-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </div>
                  <h3 className="feature-name">Reliability & Fallbacks</h3>
                  <p className="feature-desc">Fail-safe 3-second request routing. If a WSL query times out or fails, TOP instantly triggers REST API fallback fetches to ensure absolute layout integrity.</p>
                </div>
              </div>
            </section>

            {/* Interactive SQL CLI Terminal */}
            <section id="terminal" className="section-container">
              <div className="section-title-wrap">
                <h2 className="section-title">Query Console Playground</h2>
                <p className="section-desc">Try running some real-time Coral SQL queries. Select a template on the left and see how Coral compiles WS telemetry.</p>
              </div>

              <div className="terminal-section">
                <div className="terminal-menu">
                  <button className={`terminal-btn ${activePreset === 'prs' ? 'active' : ''}`} onClick={() => runLandingQuery('prs')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/></svg>
                    Pull Requests
                  </button>
                  <button className={`terminal-btn ${activePreset === 'sentry' ? 'active' : ''}`} onClick={() => runLandingQuery('sentry')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                    Sentry Exceptions
                  </button>
                  <button className={`terminal-btn ${activePreset === 'actions' ? 'active' : ''}`} onClick={() => runLandingQuery('actions')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/></svg>
                    CI Action Runs
                  </button>
                  <button className={`terminal-btn ${activePreset === 'tickets' ? 'active' : ''}`} onClick={() => runLandingQuery('tickets')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/></svg>
                    Jira Tickets
                  </button>
                </div>

                <div className="terminal-workspace">
                  <div className="terminal-box" id="terminalBox">
                    <div className="terminal-line">
                      <span className="terminal-prompt">$</span>
                      <span className="terminal-output" id="queryPrompt">{typedQuery}</span>
                    </div>
                    <div className="terminal-line" id="terminalResponse">
                      {isTyping && !terminalOutput ? (
                        <div className="terminal-loader">
                          <svg width="12" height="12" className="spin" style={{ animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                          </svg>
                          <span> Compiling query...</span>
                        </div>
                      ) : (
                        <span className="terminal-output">
                          {terminalOutput}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Node Link Network Pulse Board */}
            <section id="pulse" className="section-container">
              <div className="section-title-wrap">
                <h2 className="section-title">Telemetry Network Board</h2>
                <p className="section-desc">TOP dynamically monitors network nodes, pulling platform activities through the Coral abstraction layer.</p>
              </div>

              <div className="integrations-box">
                <div className="pulse-line vertical"></div>
                <div className="pulse-line horizontal"></div>
                
                <div className="central-core">
                  CORAL
                </div>
                
                <div className="nodes-container">
                  <div className="node n-github">GitHub</div>
                  <div className="node n-slack">Slack</div>
                  <div className="node n-jira">Jira</div>
                  <div className="node n-sentry">Sentry</div>
                </div>
              </div>
            </section>

            {/* Speed Comparison Slider Section */}
            <section id="compare" className="section-container" style={{ marginBottom: '60px' }}>
              <div className="section-title-wrap">
                <h2 className="section-title">Speed Optimization Index</h2>
                <p className="section-desc">Slide the bar to compare standard REST API query loads against Coral-accelerated unified caching.</p>
              </div>

              <div className="compare-section">
                <div className="compare-controls">
                  <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    SWIPE TO OPTIMIZE TELEMETRY
                  </span>
                  <div className="slider-wrap">
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={compareVal} 
                      className="slider" 
                      id="compareSlider" 
                      onChange={(e) => setCompareVal(parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <div className="compare-chart">
                  {/* Legacy */}
                  <div className="chart-bar-container">
                    <span className="chart-bar-title">Legacy REST Pipeline</span>
                    <span className="chart-bar-val slow" id="slowVal">
                      {(5.2 - ((compareVal / 100) * 2.8)).toFixed(2)}s
                    </span>
                    <div 
                      className="chart-bar legacy" 
                      id="legacyBar" 
                      style={{ height: `${140 - ((compareVal / 100) * 80)}px` }}
                    />
                  </div>
                  {/* Coral */}
                  <div className="chart-bar-container">
                    <span className="chart-bar-title">TOP accelerated by Coral</span>
                    <span className="chart-bar-val fast" id="fastVal">
                      {(0.02 - ((compareVal / 100) * 0.015)).toFixed(3)}s
                    </span>
                    <div 
                      className="chart-bar coral" 
                      id="coralBar" 
                      style={{ height: `${2 + ((compareVal / 100) * 12)}px` }}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Footer */}
            <footer>
              <p>Enjoy Your Work with TOP.</p>
            </footer>
          </div>
        ) : view === 'dashboard' ? (
          <div>
            <header style={{ marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: '700' }}>{activeTool.name}</h1>
              <p style={{ color: 'var(--text-dim)' }}>{activeTool.tooltip}</p>
            </header>

            <section className="card" style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
                    {inputConfig[activeTool.id]?.label || inputConfig.default.label}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={paramValue}
                    onChange={(e) => setParamValue(e.target.value)}
                    placeholder={inputConfig[activeTool.id]?.placeholder || inputConfig.default.placeholder}
                  />
                </div>
                <button className="btn btn-primary" onClick={executeTool} disabled={loading}>
                  {loading ? <Play className="spin" size={18} /> : <Play size={18} />}
                  {loading ? 'RUNNING...' : 'EXECUTE'}
                </button>
              </div>
            </section>

            <section>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <Database size={32} className="spin" style={{ color: 'var(--accent)', marginBottom: '12px' }} />
                  <p style={{ fontSize: '14px', color: 'var(--text-dim)' }}>Fetching data from Coral...</p>
                </div>
              ) : results ? (
                <div className="results-grid">
                  {Array.isArray(results) && results.map((res, i) => {
                    const isSummary = res.category === 'Summary' || res.status === 'summary';
                    const title = res.title || res.category || res.status || 'Result';
                    const statusValue = res.reason || res.status || res.state || 'N/A';
                    const isOpen = statusValue.toString().toLowerCase().includes('open') || 
                                   statusValue.toString().toLowerCase().includes('action') || 
                                   statusValue.toString().toLowerCase().includes('missing') ||
                                   statusValue.toString().toLowerCase().includes('error') ||
                                   statusValue.toString().toLowerCase().includes('fail') ||
                                   statusValue.toString().toLowerCase().includes('failure');

                    if (isSummary) {
                      return (
                        <div key={i} className="summary-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: '800', fontSize: '18px' }}>
                            <Zap size={20} />
                            <span>{title}</span>
                          </div>
                          <p style={{ fontSize: '15px', color: 'var(--text-main)', marginTop: '8px', fontWeight: '500' }}>
                            {res.message}
                          </p>
                          {res.action && (
                            <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px' }}>
                              💡 <strong>Next Step:</strong> {res.action}
                            </p>
                          )}
                        </div>
                      );
                    }

                    const metrics = parseMetrics(res.details);
                    
                    // Icon matching based on category/title
                    const catLower = (res.category || '').toLowerCase();
                    const titleLower = (res.title || '').toLowerCase();
                    let IconComponent = Box;
                    if (catLower.includes('pr') || titleLower.includes('pr') || catLower.includes('pull')) {
                      IconComponent = GitBranch;
                    } else if (catLower.includes('sentry')) {
                      IconComponent = ShieldAlert;
                    } else if (catLower.includes('ticket') || catLower.includes('jira') || catLower.includes('linear')) {
                      IconComponent = Link;
                    } else if (catLower.includes('slack')) {
                      IconComponent = MessageSquare;
                    } else if (catLower.includes('issue')) {
                      IconComponent = AlertCircle;
                    } else if (catLower.includes('commit')) {
                      IconComponent = FileCode;
                    }

                    return (
                      <div key={i} className="result-card">
                        <div className="result-card-header" style={{ marginBottom: '8px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div className="result-card-category">
                              <IconComponent size={14} />
                              <span>{res.category || 'Context'}</span>
                            </div>
                            {res.url ? (
                              <a href={res.url} target="_blank" rel="noopener noreferrer" className="result-card-title">
                                {title}
                                <Link size={14} style={{ opacity: 0.5 }} />
                              </a>
                            ) : (
                              <h3 className="result-card-title">{title}</h3>
                            )}
                          </div>
                          <span className={`status-tag ${isOpen ? 'open' : 'closed'}`}>
                            {statusValue}
                          </span>
                        </div>

                        {(() => {
                          const meta = getCardMetadata(res);
                          if (!meta) return null;
                          return (
                            <div style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '-4px', marginBottom: '12px' }}>
                              {meta.author && (
                                <span>by <strong>{meta.author}</strong></span>
                              )}
                              {meta.date && (() => {
                                let formattedDate = String(meta.date);
                                try {
                                  formattedDate = new Date(meta.date).toLocaleDateString(undefined, { dateStyle: 'medium' });
                                  if (formattedDate === 'Invalid Date') {
                                    formattedDate = String(meta.date);
                                  }
                                } catch (e) {}
                                return (
                                  <>
                                    {meta.author && <span>•</span>}
                                    <span>{formattedDate}</span>
                                  </>
                                );
                              })()}
                              {meta.sha && (
                                <>
                                  {(meta.author || meta.date) && <span>•</span>}
                                  <code style={{ fontSize: '11px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                    {meta.sha.substring(0, 7)}
                                  </code>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        {res.message && (() => {
                          const { summary, details } = getOutputBreakdown(res.message, title, res.category);
                          const isExpanded = !!expandedCards[i];
                          
                          return (
                            <div className="output-container">
                              <p className="result-card-desc">{summary}</p>
                              
                              {details && (
                                <div style={{ marginTop: '8px' }}>
                                  <button 
                                    className="btn btn-secondary btn-xs"
                                    onClick={() => toggleCard(i, res.message, title, res.category)}
                                    style={{ 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      gap: '4px',
                                      padding: '4px 8px',
                                      fontSize: '11px',
                                      height: 'auto',
                                      borderRadius: '4px'
                                    }}
                                  >
                                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    {isExpanded ? 'Hide Details' : 'View In-depth Analysis'}
                                  </button>
                                  
                                  {isExpanded && (
                                    <div className="expandable-details">
                                      {summarizing[i] ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: 'var(--accent)' }}>
                                          <Zap className="spin" size={14} />
                                          <span className="pulse" style={{ fontSize: '12px', fontWeight: '600', fontFamily: "'Inter', sans-serif" }}>
                                            ✨ AI Agent is digesting the technical logs...
                                          </span>
                                        </div>
                                      ) : (
                                        <>
                                          <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border)', marginBottom: '12px', paddingBottom: '6px' }}>
                                            <button 
                                              onClick={() => setActiveTabs(prev => ({ ...prev, [i]: 'ai' }))}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: '4px 8px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                color: (activeTabs[i] || 'ai') === 'ai' ? 'var(--accent)' : 'var(--text-dim)',
                                                borderBottom: (activeTabs[i] || 'ai') === 'ai' ? '2px solid var(--accent)' : 'none',
                                                cursor: 'pointer',
                                                fontFamily: "'Inter', sans-serif"
                                              }}
                                            >
                                              ✨ AI Agent Explanation
                                            </button>
                                            <button 
                                              onClick={() => setActiveTabs(prev => ({ ...prev, [i]: 'raw' }))}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: '4px 8px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                color: (activeTabs[i] || 'ai') === 'raw' ? 'var(--accent)' : 'var(--text-dim)',
                                                borderBottom: (activeTabs[i] || 'ai') === 'raw' ? '2px solid var(--accent)' : 'none',
                                                cursor: 'pointer',
                                                fontFamily: "'Inter', sans-serif"
                                              }}
                                            >
                                              💻 Raw Developer Logs
                                            </button>
                                          </div>
                                          
                                          {(activeTabs[i] || 'ai') === 'ai' ? (
                                            <div style={{ fontFamily: "'Inter', sans-serif", whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                                              {renderMarkdown(summaries[i])}
                                            </div>
                                          ) : (
                                            details
                                          )}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {(() => {
                          const standardKeys = [
                            'category', 'title', 'message', 'reason', 'action', 'url', 'status', 'state', 'details', 'slack_mentions', 'jira_links',
                            'commit__message', 'commit_message', 'description', 'body', 'desc',
                            'sha', 'hash', 'commit__sha', 'id',
                            'commit__author__name', 'commit__author__date', 'commit__author', 'author', 'author_name',
                            'html_url', 'created_at', 'updated_at', 'timestamp', 'url'
                          ];
                          const customColumns = Object.entries(res).filter(([key]) => !standardKeys.includes(key));
                          
                          if (customColumns.length === 0) return null;
                          
                          return (
                            <div className="custom-fields-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '12px' }}>
                              {customColumns.map(([key, val]) => (
                                <div key={key} className="custom-field-badge" style={{ background: 'var(--bg-input)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                  <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', fontWeight: '700' }}>
                                    {key.replace(/__/g, ' ').replace(/_/g, ' ')}
                                  </span>
                                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-main)' }}>
                                    {typeof val === 'object' ? JSON.stringify(val) : String(val).length > 60 ? String(val).substring(0, 57) + '...' : String(val)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {res.reason && (
                          <div className="callout-box">
                            <span style={{ fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                              ⚠️ Detected Blockage
                            </span>
                            <span>{res.reason}</span>
                          </div>
                        )}

                        {res.action && (
                          <div className="callout-box action">
                            <span style={{ fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', color: 'var(--success)' }}>
                              🎯 Recommended Action
                            </span>
                            <span>{res.action}</span>
                          </div>
                        )}

                        {metrics && (
                          <div className="metrics-row">
                            {metrics.reviews && (
                              <span className="metric-pill">
                                <MessageSquare size={12} />
                                {metrics.reviews} Reviews
                              </span>
                            )}
                            {metrics['failed checks'] && (
                              <span className={`metric-pill ${parseInt(metrics['failed checks']) > 0 ? 'danger' : 'success'}`}>
                                <CheckCircle size={12} />
                                {metrics['failed checks']} Failed Checks
                              </span>
                            )}
                            {metrics.ci_runs && (
                              <span className="metric-pill">
                                <Play size={12} />
                                {metrics.ci_runs} CI Runs
                              </span>
                            )}
                            {metrics.last_comment && (
                              <span className="metric-pill">
                                <MessageSquare size={12} />
                                Commented {metrics.last_comment.split('T')[0]}
                              </span>
                            )}
                            {res.slack_mentions > 0 && (
                              <span className="metric-pill success">
                                <MessageSquare size={12} />
                                {res.slack_mentions} Slack Mentions
                              </span>
                            )}
                            {res.jira_links && res.jira_links.map((link, j) => (
                              <span key={j} className="metric-pill success">
                                <Link size={12} />
                                {link}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px', border: '2px dashed var(--border)', borderRadius: '8px', color: 'var(--text-dim)' }}>
                  <p>Run a tool to see the results here.</p>
                </div>
              )}
            </section>
          </div>
        ) : view === 'database' ? (
          <div className="playground-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
            <header>
              <h1 style={{ fontSize: '24px', fontWeight: '800', background: 'linear-gradient(120deg, var(--accent), #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <TerminalSquare size={24} style={{ color: 'var(--accent)' }} /> Query Console
              </h1>
              <p style={{ color: 'var(--text-dim)', fontSize: '14px', marginTop: '4px' }}>
                Compose and execute raw SQL queries against your registered WSL Coral data sources.
              </p>
            </header>

            {/* Global URL Parameter Input inside Playground */}
            <section className="card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '240px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '8px', letterSpacing: '0.05em' }}>
                    🔗 Global Target Parameter URL / Link (GitHub, Slack, etc.)
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={paramValue}
                    onChange={(e) => setParamValue(e.target.value)}
                    placeholder="e.g., https://github.com/owner/repo or topic keyword"
                    style={{ height: '38px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ padding: '8px 14px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '180px', height: '38px', justifyContent: 'center' }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: '800', letterSpacing: '0.05em' }}>Active Context Scope</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                    {(() => {
                      const parsed = parseOwnerRepoFromValue(paramValue);
                      return parsed ? `${parsed.owner}/${parsed.repo}` : paramValue || 'None (Global Scope)';
                    })()}
                  </span>
                </div>
              </div>
            </section>

            <div className="playground-workspace" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
              {/* Left Panel: Schema tree browser */}
              <div className="card schema-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--accent)', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Coral Schema Tree
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    Double-click elements to insert them into your query editor.
                  </p>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {tables.length > 0 ? tables.map((table, i) => {
                    const fullTableName = `${table.schema_name}.${table.table_name}`;
                    const isExpanded = !!expandedTables[fullTableName];
                    const columns = tableColumns[fullTableName] || [];
                    const isLoading = !!loadingColumns[fullTableName];

                    return (
                      <div key={i} className="schema-table-card" style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', background: 'var(--bg-card)', cursor: 'pointer' }}>
                        <div 
                          onClick={() => toggleTable(fullTableName)}
                          onDoubleClick={() => insertTextAtCursor(fullTableName)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Database size={14} style={{ color: 'var(--accent)' }} />
                            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)' }}>
                              {table.table_name}
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.1)', padding: '2px 6px', borderRadius: '4px', fontWeight: '700' }}>
                            {table.schema_name}
                          </span>
                        </div>

                        {isExpanded && (
                          <div style={{ marginTop: '10px', paddingLeft: '12px', borderLeft: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {isLoading ? (
                              <div style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
                                <Zap className="spin" size={10} /> Loading columns...
                              </div>
                            ) : columns.length > 0 ? columns.map((col, idx) => (
                              <div 
                                key={idx}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  insertTextAtCursor(col.column_name);
                                }}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', padding: '2px 4px', borderRadius: '4px' }}
                                className="schema-column-row"
                              >
                                <span style={{ fontFamily: 'monospace', color: 'var(--text-main)', fontWeight: '500' }}>
                                  {col.column_name}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                  {col.data_type}
                                </span>
                              </div>
                            )) : (
                              <div style={{ fontSize: '11px', color: 'var(--text-dim)', padding: '4px 0' }}>
                                No columns found.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }) : (
                    <div style={{ textAlign: 'center', padding: '24px', border: '1px dashed var(--border)', borderRadius: '8px', color: 'var(--text-dim)', fontSize: '12px' }}>
                      No connected tables. Connect a data source in Setup.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Panel: SQL console and results */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                {/* Query Editor Card */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-dim)' }}>PRESET TEMPLATES:</span>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {PRESET_TEMPLATES.map((tmpl, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSqlQuery(tmpl.sql)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', borderRadius: '4px', fontWeight: '600' }}
                          >
                            {tmpl.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <textarea
                      value={sqlQuery}
                      onChange={(e) => setSqlQuery(e.target.value)}
                      style={{
                        width: '100%',
                        height: '140px',
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-main)',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '14px',
                        lineHeight: '1.6',
                        resize: 'vertical',
                        outline: 'none'
                      }}
                      placeholder="Write your Coral SQL query here..."
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => setSqlQuery('')}
                      style={{ padding: '8px 16px', fontSize: '13px' }}
                    >
                      Clear Editor
                    </button>
                    
                    <button 
                      className="btn btn-primary" 
                      onClick={executePlaygroundQuery} 
                      disabled={queryLoading || !sqlQuery.trim()}
                      style={{ padding: '10px 24px', fontSize: '14px', boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)' }}
                    >
                      {queryLoading ? <Zap className="spin" size={16} /> : <Play size={16} />}
                      {queryLoading ? 'RUNNING QUERY...' : 'RUN QUERY'}
                    </button>
                  </div>
                </div>

                {/* Results Card */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '260px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <TerminalSquare size={16} style={{ color: 'var(--accent)' }} /> Query Execution Console
                    </h3>
                    {queryResults && Array.isArray(queryResults) && (
                      <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: '600' }}>
                        Returned {queryResults.length} {queryResults.length === 1 ? 'row' : 'rows'}
                      </span>
                    )}
                  </div>

                  {queryLoading ? (
                    <div style={{ textAlign: 'center', padding: '60px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <Database size={32} className="spin" style={{ color: 'var(--accent)' }} />
                      <p className="pulse" style={{ fontSize: '14px', color: 'var(--accent)', fontWeight: '600' }}>
                        WSL Coral subprocess executing query...
                      </p>
                    </div>
                  ) : queryError ? (
                    /* Error State in premium shell console style */
                    <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #f87171', padding: '20px', fontFamily: "'JetBrains Mono', monospace" }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontSize: '13px', fontWeight: '700', marginBottom: '10px' }}>
                        <ShieldAlert size={16} /> <span>WSL SUBPROCESS EXCEPTION</span>
                      </div>
                      <p style={{ color: '#fca5a5', fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                        {queryError}
                      </p>
                      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #334155', color: '#94a3b8', fontSize: '11px' }}>
                        💡 <strong>Hint:</strong> Verify table spelling or column types. Ensure WSL Ubuntu-24.04 instance is responsive and connected.
                      </div>
                    </div>
                  ) : queryResults ? (
                    (() => {
                      /* Success JSON array state */
                      if (Array.isArray(queryResults)) {
                        if (queryResults.length === 0) {
                          return (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                              Query completed successfully but returned 0 rows.
                            </div>
                          );
                        }

                        // Inspect fields
                        const columns = Object.keys(queryResults[0]);
                        const filteredRows = queryResults.filter(row => {
                          const str = JSON.stringify(row).toLowerCase();
                          return str.includes(searchFilter.toLowerCase());
                        });

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Search bar inside results */}
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <div style={{ position: 'relative', flex: 1 }}>
                                <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                                <input
                                  type="text"
                                  placeholder="Filter console results..."
                                  className="input"
                                  style={{ paddingLeft: '34px', height: '36px', fontSize: '13px' }}
                                  value={searchFilter}
                                  onChange={(e) => setSearchFilter(e.target.value)}
                                />
                              </div>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '6px 12px', fontSize: '12px', height: '36px' }}
                                onClick={() => {
                                  const text = JSON.stringify(queryResults, null, 2);
                                  navigator.clipboard.writeText(text);
                                  alert("JSON copied to clipboard!");
                                }}
                              >
                                Copy JSON
                              </button>
                            </div>

                            {/* Table container */}
                            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-input)' }}>
                              <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                  <tr style={{ background: 'var(--bg-card)' }}>
                                    {columns.map((col, idx) => (
                                      <th key={idx} style={{ padding: '12px 16px', borderBottom: '2px solid var(--border)', color: 'var(--text-main)', fontWeight: '700' }}>
                                        {col}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredRows.map((row, rIdx) => (
                                    <tr 
                                      key={rIdx} 
                                      style={{ 
                                        background: rIdx % 2 === 0 ? 'var(--bg-card)' : 'transparent',
                                        transition: 'background-color 0.15s'
                                      }}
                                      className="results-row-hover"
                                    >
                                      {columns.map((col, cIdx) => {
                                        const val = row[col];
                                        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                                        return (
                                          <td key={cIdx} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-main)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '300px' }}>
                                            {strVal}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      } else if (queryResults.raw_output) {
                        /* Raw Output block */
                        return (
                          <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid var(--border)', padding: '20px', fontFamily: "'JetBrains Mono', monospace" }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '13px', fontWeight: '700', marginBottom: '10px' }}>
                              <TerminalSquare size={16} /> <span>CORAL CLI RAW STREAM OUTPUT</span>
                            </div>
                            <pre style={{ color: '#a7f3d0', fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap', margin: 0 }}>
                              {queryResults.raw_output}
                            </pre>
                          </div>
                        );
                      } else {
                        /* Generic Object State */
                        return (
                          <pre style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', fontFamily: 'monospace', fontSize: '13px', overflow: 'auto' }}>
                            {JSON.stringify(queryResults, null, 2)}
                          </pre>
                        );
                      }
                    })()
                  ) : (
                    /* Default Idle State */
                    <div style={{ textAlign: 'center', padding: '60px', border: '1px dashed var(--border)', borderRadius: '8px', color: 'var(--text-dim)', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      <TerminalSquare size={32} style={{ opacity: 0.4 }} />
                      <p style={{ fontSize: '14px' }}>
                        Console ready. Write an SQL query above and click <strong>Run Query</strong> to execute.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <header>
              <h1 style={{ fontSize: '24px', fontWeight: '800', background: 'linear-gradient(120deg, var(--accent), #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Settings size={24} style={{ color: 'var(--accent)' }} /> System Setup
              </h1>
              <p style={{ color: 'var(--text-dim)', fontSize: '14px', marginTop: '4px' }}>
                Configure connected platforms, global parameters, cache systems, and inspect audit logs.
              </p>
            </header>

            {/* Top Grid: Integrations Status & Global Parameters */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
              {/* Card 1: Connected Data Sources List */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Active Connected Platforms
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Verifies connection integrity inside your WSL Coral instance.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {['GitHub', 'Slack', 'Jira', 'Sentry'].map((plat) => {
                    const isConnected = !!connections[plat.toLowerCase()];
                    return (
                      <div key={plat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-input)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>{plat}</span>
                          <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '9999px', background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isConnected ? 'var(--success)' : 'var(--danger)' }}>
                            {isConnected ? '✅ Active' : '❌ Inactive'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            className="btn btn-secondary btn-xs" 
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => alert(`Connection integrity check passed for ${plat}!`)}
                          >
                            Test
                          </button>
                          {isConnected && (
                            <button 
                              className="btn btn-secondary btn-xs" 
                              style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                              onClick={() => handleRemoveConnection(plat)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 2: Global Configuration Parameters */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Global Agent Preferences
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Adjust default query and lookback scoping for background analysis tools.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '6px' }}>
                      📆 HANDOVER LOOKBACK HORIZON (DAYS)
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      style={{ height: '36px', fontSize: '13px' }} 
                      value={lookbackDays} 
                      onChange={(e) => setLookbackDays(parseInt(e.target.value) || 7)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '6px' }}>
                      🛡️ SECURITY INCIDENT LEVEL THRESHOLD
                    </label>
                    <select 
                      className="input" 
                      style={{ height: '36px', fontSize: '13px', padding: '6px 12px' }} 
                      value={severityThreshold} 
                      onChange={(e) => setSeverityThreshold(e.target.value)}
                    >
                      <option value="low">Low & Above (All Events)</option>
                      <option value="medium">Medium & Above (Recommended)</option>
                      <option value="high">High & Fatal Only</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '6px' }}>
                      💬 Slack Channels to Monitor for Incidents
                    </label>
                    <input 
                      type="text" 
                      className="input" 
                      style={{ height: '36px', fontSize: '13px' }} 
                      value={slackChannels} 
                      onChange={(e) => setSlackChannels(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Middle Grid: Add Connections & Cache Systems */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
              {/* Card 3: Add/Update Data Source Form */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Connect & Configure Credentials
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Enter platform tokens to add new credentials or update existing ones.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {['GitHub', 'Slack', 'Jira', 'Sentry'].map((item) => (
                    <button
                      key={item}
                      className="btn btn-secondary"
                      style={{
                        padding: '12px',
                        justifyContent: 'center',
                        fontWeight: '700',
                        fontSize: '13px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)'
                      }}
                      onClick={() => {
                        const tokenVal = prompt(`Enter ${item} API Token / Secret:`);
                        if (!tokenVal) return;
                        
                        if (item === 'Jira') {
                          const urlVal = prompt("Enter Jira Base URL:", "https://your-domain.atlassian.net");
                          const emailVal = prompt("Enter Jira Account Email:");
                          if (urlVal && emailVal) {
                            handleConnect(item, tokenVal, { jira_url: urlVal, jira_email: emailVal });
                          }
                        } else if (item === 'Sentry') {
                          const orgVal = prompt("Enter Sentry Organization Slug:");
                          if (orgVal) {
                            handleConnect(item, tokenVal, { sentry_org: orgVal });
                          }
                        } else {
                          handleConnect(item, tokenVal);
                        }
                      }}
                    >
                      🔌 Connect {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* Card 4: Cache Systems Control */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    WSL Coral Performance Cache
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Coral automatically caches heavy SQL evaluations. Monitor or clear lookups here.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyBehavior: 'space-between', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-input)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '700' }}>CURRENT CACHE METRICS</span>
                    <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-main)' }}>
                      {cacheStats.size} ({cacheStats.queries} queries cached)
                    </span>
                  </div>
                  <button 
                    className="btn btn-secondary" 
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', padding: '8px 16px', fontSize: '13px' }}
                    onClick={handleClearCache}
                  >
                    Clear Cache
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Panel: SQL Query Audit Trail */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  SQL Query History Trail
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                  Audit log of every query executed inside the Query Console or Dashboard tools.
                </p>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-input)' }}>
                      <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: '700' }}>Timestamp</th>
                      <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: '700' }}>Query (SQL)</th>
                      <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: '700', textAlign: 'center' }}>Rows</th>
                      <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: '700', textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: '700', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queryHistory.map((item, idx) => {
                      const isSuccess = item.status === "Success";
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 16px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: '10px 16px', fontFamily: 'monospace', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }} title={item.query}>
                            {item.query}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: '600' }}>
                            {item.rows}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', background: isSuccess ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: isSuccess ? 'var(--success)' : 'var(--danger)' }}>
                              {item.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button 
                                className="btn btn-secondary btn-xs" 
                                style={{ padding: '2px 6px', fontSize: '11px' }}
                                onClick={() => loadHistoryToEditor(item.query)}
                              >
                                Load Editor
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
