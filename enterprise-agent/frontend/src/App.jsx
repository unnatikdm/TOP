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

function App() {
  const [theme, setTheme] = useState('light');
  const [view, setView] = useState('dashboard'); // 'dashboard', 'database', or 'setup'
  const [activeTool, setActiveTool] = useState(tools[0]);
  const [paramValue, setParamValue] = useState('https://github.com/open-metadata/OpenMetadata');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});
  const [summaries, setSummaries] = useState({});
  const [summarizing, setSummarizing] = useState({});
  const [activeTabs, setActiveTabs] = useState({});

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

  return (
    <div className="app-container">
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
      `}</style>

      <aside className="sidebar">
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <div className="logo" style={{ marginTop: '40px' }}>
          <Layers size={24} /> CORAL AGENT
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
            data-tooltip="Browse all data sources."
          >
            <Database size={18} />
            <span>Database</span>
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

      <main className="main-content">
        {view === 'dashboard' ? (
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
                    const isOpen = statusValue.toString().toLowerCase().includes('open') || statusValue.toString().toLowerCase().includes('action') || statusValue.toString().toLowerCase().includes('missing');

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
          <div>
            <header style={{ marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Database Explorer</h1>
              <p style={{ color: 'var(--text-dim)' }}>Browse schemas and tables connected via Coral.</p>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {tables.length > 0 ? tables.map((table, i) => (
                <div key={i} className="card">
                  <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: '700', marginBottom: '4px' }}>{table.schema_name}</div>
                  <h3 style={{ marginBottom: '12px' }}>{table.table_name}</h3>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    {/* Columns would be fetched per table in a deeper view, but for now we list the table */}
                    REAL DATA TABLE
                  </div>
                </div>
              )) : (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', border: '2px dashed var(--border)', borderRadius: '8px' }}>
                  <p>No tables found. Connect a source in Setup to begin.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <header style={{ marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: '700' }}>System Setup</h1>
              <p style={{ color: 'var(--text-dim)' }}>Manage your API connections and environment variables.</p>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {['GitHub', 'Slack', 'Jira', 'Sentry'].map((item) => (
                <div key={item} className="card">
                  <h3 style={{ marginBottom: '16px' }}>{item} Connection</h3>
                  
                  {item === 'Jira' && (
                    <>
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>BASE URL</label>
                      <input
                        type="text"
                        placeholder="https://your-domain.atlassian.net"
                        className="input"
                        style={{ marginBottom: '16px' }}
                        id="jira-url"
                        defaultValue={connections.jira_url}
                      />
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>EMAIL</label>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        className="input"
                        style={{ marginBottom: '16px' }}
                        id="jira-email"
                        defaultValue={connections.jira_email}
                      />
                    </>
                  )}

                  {item === 'Sentry' && (
                    <>
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>ORGANIZATION SLUG</label>
                      <input
                        type="text"
                        placeholder="your-org-slug"
                        className="input"
                        style={{ marginBottom: '16px' }}
                        id="sentry-org"
                        defaultValue={connections.sentry_org}
                      />
                    </>
                  )}
                  
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>API TOKEN</label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    className="input"
                    style={{ marginBottom: '16px' }}
                    id={`token-${item}`}
                    defaultValue={connections[item.toLowerCase()]}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => {
                      const token = document.getElementById(`token-${item}`).value;
                      if (item === 'Jira') {
                        const jira_url = document.getElementById('jira-url').value;
                        const jira_email = document.getElementById('jira-email').value;
                        handleConnect(item, token, { jira_url, jira_email });
                      } else if (item === 'Sentry') {
                        const sentry_org = document.getElementById('sentry-org').value;
                        handleConnect(item, token, { sentry_org });
                      } else {
                        handleConnect(item, token);
                      }
                    }}
                  >
                    Connect {item}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
