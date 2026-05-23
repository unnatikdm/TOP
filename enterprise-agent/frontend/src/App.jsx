import React, { useState, useEffect } from 'react';
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
  Moon
} from 'lucide-react';

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
  const [paramValue, setParamValue] = useState('123');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState({ coral_installed: false });
  const [connections, setConnections] = useState({
    github: '',
    slack: '',
    jira: '',
    sentry: ''
  });

  const [tables, setTables] = useState([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Check backend status
    fetch('http://localhost:8000/api/status')
      .then(res => res.json())
      .then(data => setBackendStatus(data))
      .catch(() => setBackendStatus({ coral_installed: false }));

    // Fetch real tables
    fetch('http://localhost:8000/api/tables')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setTables(data);
      })
      .catch(() => { });
  }, [theme]);

  const handleConnect = async (source, token) => {
    try {
      const response = await fetch('http://localhost:8000/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, token })
      });
      const data = await response.json();
      if (response.ok) {
        alert(`${source} connected!`);
        setConnections(prev => ({ ...prev, [source.toLowerCase()]: token }));
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

  const executeTool = async () => {
    setLoading(true);
    setResults(null);
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
      <button className="theme-toggle" onClick={toggleTheme}>
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <aside className="sidebar">
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
                onClick={() => setActiveTool(tool)}
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
                <div className="card" style={{ padding: '0' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Context</th>
                        <th>Details</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(results) && results.map((res, i) => {
                        const context = res.title || res.category || res.status || 'Result';
                        const details = [res.message, res.details, res.reason, res.action].filter(Boolean).join(' | ');
                        const statusValue = res.reason || res.status || res.state || 'N/A';
                        const isOpen = statusValue.toString().toLowerCase().includes('open') || statusValue.toString().toLowerCase().includes('action');
                        return (
                          <tr key={i}>
                            <td>{context}</td>
                            <td>{details || 'No details'}</td>
                            <td>
                              <span className={`status-tag ${isOpen ? 'open' : 'closed'}`}>
                                {statusValue}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                      handleConnect(item, token);
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
