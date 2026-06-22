import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  GitBranch, 
  MessageSquare, 
  Send, 
  RefreshCw, 
  Trash2, 
  FileText, 
  Terminal, 
  CheckCircle, 
  AlertTriangle, 
  Github, 
  Code,
  Info,
  Clock,
  X,
  Zap,
  BookOpen,
  ArrowRight,
  Database,
  Cpu,
  Search,
  Shield,
  Sparkles
} from 'lucide-react';
import { fetchEventSource } from '@microsoft/fetch-event-source';

// Types matching backend models
interface Repository {
  id: number;
  github_url: string;
  name: string;
  status: 'idle' | 'indexing' | 'completed' | 'failed';
  last_indexed_at: string | null;
  created_at: string;
}

interface IndexLog {
  id: number;
  repo_id: number;
  files_updated: number;
  duration_ms: number;
  status: 'completed' | 'failed';
  error_message: string | null;
  created_at: string;
}

interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  symbolType: string;
  content: string;
}

interface Message {
  sender: 'user' | 'bot';
  message: string;
  citations?: Citation[];
  created_at?: string;
}

const API_BASE = 'http://localhost:3001/api';

export default function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [githubUrlInput, setGithubUrlInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeStreamingText, setActiveStreamingText] = useState('');
  const [_activeCitations, setActiveCitations] = useState<Citation[]>([]);
  
  // Modals & Panels
  const [showLogsRepoId, setShowLogsRepoId] = useState<number | null>(null);
  const [indexLogs, setIndexLogs] = useState<IndexLog[]>([]);
  const [activeCodeDrawer, setActiveCodeDrawer] = useState<Citation | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addingRepo, setAddingRepo] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Refs for stable SSE closure access
  const streamingTextRef = useRef('');
  const streamingCitationsRef = useRef<Citation[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Check backend connection on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE.replace('/api', '')}/health`);
        if (res.ok) setBackendStatus('online');
        else setBackendStatus('offline');
      } catch {
        setBackendStatus('offline');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // Show tutorial on first visit
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('rag-git-bot-tutorial-seen');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
    }
  }, []);

  const dismissTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('rag-git-bot-tutorial-seen', 'true');
  };

  // Fetch Repositories list
  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API_BASE}/repos`);
      const data = await res.json();
      if (data.repositories) {
        setRepositories(data.repositories);
      }
    } catch (err) {
      console.error('Failed to load repositories:', err);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  // Sync selected repo details when repositories list updates
  useEffect(() => {
    if (selectedRepo) {
      const updated = repositories.find((r) => r.id === selectedRepo.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedRepo)) {
        setSelectedRepo(updated);
      }
    }
  }, [repositories]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  // Poll indexing repositories
  useEffect(() => {
    const isAnyIndexing = repositories.some(r => r.status === 'indexing');
    if (!isAnyIndexing) return;

    const timer = setInterval(() => {
      fetchRepos();
    }, 4000);

    return () => clearInterval(timer);
  }, [repositories, fetchRepos]);

  // Load chat history when selected repository changes
  useEffect(() => {
    if (!selectedRepo) {
      setChatMessages([]);
      return;
    }

    const loadChatHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/chat-history/${selectedRepo.id}`);
        const data = await res.json();
        if (data.history) {
          setChatMessages(data.history);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    };

    loadChatHistory();
  }, [selectedRepo]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, activeStreamingText]);

  // Add repository
  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrlInput.trim()) return;

    setAddingRepo(true);
    try {
      const res = await fetch(`${API_BASE}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUrl: githubUrlInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setGithubUrlInput('');
        await fetchRepos();
        if (data.repository) {
          setSelectedRepo(data.repository);
        }
      } else {
        alert(data.error || 'Failed to add repository.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error adding repository.');
    } finally {
      setAddingRepo(false);
    }
  };

  // Reindex repository
  const handleReindex = async (repoId: number) => {
    try {
      await fetch(`${API_BASE}/repos/${repoId}/reindex`, { method: 'POST' });
      await fetchRepos();
    } catch (err) {
      console.error('Failed to reindex:', err);
    }
  };

  // Delete repository
  const handleDeleteRepo = async (repoId: number, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}? This will remove all indexed vector embeddings and chat histories.`)) {
      return;
    }
    try {
      await fetch(`${API_BASE}/repos/${repoId}`, { method: 'DELETE' });
      if (selectedRepo?.id === repoId) {
        setSelectedRepo(null);
      }
      await fetchRepos();
    } catch (err) {
      console.error('Failed to delete repository:', err);
    }
  };

  // Fetch indexing logs
  const handleViewLogs = async (repoId: number) => {
    setShowLogsRepoId(repoId);
    try {
      const res = await fetch(`${API_BASE}/repos/${repoId}/logs`);
      const data = await res.json();
      if (data.logs) {
        setIndexLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  // Ask RAG Assistant — uses refs for stable closure access
  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedRepo || isStreaming) return;

    const userQuestion = chatInput.trim();
    setChatInput('');
    setIsStreaming(true);
    setActiveStreamingText('');
    setActiveCitations([]);
    streamingTextRef.current = '';
    streamingCitationsRef.current = [];

    // Optimistically add user message to list
    setChatMessages(prev => [...prev, { sender: 'user', message: userQuestion }]);

    try {
      await fetchEventSource(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: selectedRepo.id,
          question: userQuestion,
          conversationHistory: chatMessages,
        }),
        onmessage(ev) {
          if (ev.data === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(ev.data);
            if (parsed.type === 'text') {
              streamingTextRef.current += parsed.content;
              setActiveStreamingText(streamingTextRef.current);
            } else if (parsed.type === 'citations') {
              streamingCitationsRef.current = parsed.citations || [];
              setActiveCitations(streamingCitationsRef.current);
            } else if (parsed.type === 'error') {
              streamingTextRef.current += `\n[Error: ${parsed.message}]`;
              setActiveStreamingText(streamingTextRef.current);
            }
          } catch (parseErr) {
            console.error('JSON parse error on SSE token:', parseErr);
          }
        },
        onclose() {
          // Use refs for stable access to accumulated values
          const finalText = streamingTextRef.current;
          const finalCitations = streamingCitationsRef.current;
          setIsStreaming(false);
          if (finalText) {
            setChatMessages(prev => [
              ...prev,
              { sender: 'bot', message: finalText, citations: finalCitations }
            ]);
          }
          setActiveStreamingText('');
          setActiveCitations([]);
          streamingTextRef.current = '';
          streamingCitationsRef.current = [];
        },
        onerror(err) {
          console.error('SSE Error:', err);
          // Commit whatever we had before error
          const finalText = streamingTextRef.current;
          const finalCitations = streamingCitationsRef.current;
          setIsStreaming(false);
          if (finalText) {
            setChatMessages(prev => [
              ...prev,
              { sender: 'bot', message: finalText + '\n\n[Stream interrupted]', citations: finalCitations }
            ]);
          }
          setActiveStreamingText('');
          setActiveCitations([]);
          streamingTextRef.current = '';
          streamingCitationsRef.current = [];
          throw err;
        }
      });
    } catch (err) {
      console.error(err);
      setIsStreaming(false);
    }
  };

  // Simple markdown-like rendering for bot messages
  const renderBotMessage = (text: string) => {
    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const inner = part.slice(3, -3);
        const firstNewline = inner.indexOf('\n');
        const lang = firstNewline > 0 ? inner.slice(0, firstNewline).trim() : '';
        const code = firstNewline > 0 ? inner.slice(firstNewline + 1) : inner;
        return (
          <pre key={i} style={{
            background: 'hsla(222, 47%, 6%, 0.9)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '14px 16px',
            margin: '8px 0',
            overflow: 'auto',
            fontSize: '0.82rem',
            lineHeight: '1.5',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          }}>
            {lang && <div style={{ fontSize: '0.7rem', color: 'var(--text-disabled)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lang}</div>}
            <code>{code}</code>
          </pre>
        );
      }
      // Handle inline code, bold, and line breaks
      return (
        <span key={i}>
          {part.split('\n').map((line, j) => (
            <React.Fragment key={j}>
              {j > 0 && <br />}
              {line.split(/(`[^`]+`)/).map((segment, k) => {
                if (segment.startsWith('`') && segment.endsWith('`')) {
                  return (
                    <code key={k} style={{
                      background: 'hsla(222, 47%, 15%, 0.8)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '0.85em',
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      color: 'var(--primary)',
                    }}>
                      {segment.slice(1, -1)}
                    </code>
                  );
                }
                // Handle **bold**
                return segment.split(/(\*\*[^*]+\*\*)/).map((s, l) => {
                  if (s.startsWith('**') && s.endsWith('**')) {
                    return <strong key={l}>{s.slice(2, -2)}</strong>;
                  }
                  return s;
                });
              })}
            </React.Fragment>
          ))}
        </span>
      );
    });
  };

  // Tutorial step content
  const tutorialSteps = [
    {
      icon: <Sparkles size={32} style={{ color: 'var(--primary)' }} />,
      title: 'Welcome to RAG Git Bot',
      description: 'Your AI-powered codebase assistant and automated code reviewer. Index any public GitHub repository and ask questions grounded in real code with citations.',
    },
    {
      icon: <Database size={32} style={{ color: 'var(--accent-info)' }} />,
      title: 'Step 1: Start Infrastructure',
      description: 'Make sure Docker Desktop is running, then execute this command in the project root to launch PostgreSQL, Redis, and Qdrant:',
      code: 'docker-compose up -d',
    },
    {
      icon: <Cpu size={32} style={{ color: 'var(--accent-success)' }} />,
      title: 'Step 2: Configure API Keys',
      description: 'Copy backend/.env.example to backend/.env and add your API keys:',
      code: '# Required Keys:\nGEMINI_API_KEY=...  # Google AI Studio (embeddings)\nGROQ_API_KEY=...    # Groq Console (chat LLM)',
    },
    {
      icon: <Zap size={32} style={{ color: 'var(--accent-warning)' }} />,
      title: 'Step 3: Start the Servers',
      description: 'Run the backend and frontend development servers in separate terminals:',
      code: '# Terminal 1 (Backend):\ncd backend && npm run dev\n\n# Terminal 2 (Frontend):\ncd frontend && npm run dev',
    },
    {
      icon: <Search size={32} style={{ color: 'var(--primary)' }} />,
      title: 'Step 4: Index & Ask',
      description: 'Paste a public GitHub repo URL in the sidebar, wait for indexing to complete, then ask any question about the code. The AI will answer using only the indexed code with file citations.',
    },
    {
      icon: <Shield size={32} style={{ color: 'var(--accent-danger)' }} />,
      title: 'Bonus: GitHub App Webhooks',
      description: 'Optionally configure a GitHub App to enable automatic push-to-index updates and AI-powered pull request code reviews. Click "Setup GitHub Webhooks" in the sidebar for details.',
    },
  ];

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      
      {/* Sidebar: Repositories list */}
      <aside style={{ 
        width: '360px', 
        borderRight: '1px solid var(--border-color)', 
        display: 'flex', 
        flexDirection: 'column', 
        flexShrink: 0, 
        background: 'var(--bg-surface)',
        position: 'relative',
      }}>
        
        {/* Brand header */}
        <div style={{ 
          padding: '24px 20px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ 
              background: 'linear-gradient(135deg, var(--primary-glow), hsla(250, 95%, 70%, 0.3))', 
              border: '1px solid var(--primary)', 
              borderRadius: '12px', 
              padding: '10px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)',
            }}>
              <GitBranch size={22} style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.2rem', fontWeight: 700, background: 'linear-gradient(135deg, var(--text-main), var(--primary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>RAG Git Bot</h1>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>AI Assistant & Code Reviewer</p>
            </div>
          </div>
          
          {/* Backend status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: backendStatus === 'online' ? 'var(--accent-success)' : backendStatus === 'offline' ? 'var(--accent-danger)' : 'var(--accent-warning)',
              boxShadow: backendStatus === 'online' ? '0 0 8px var(--accent-success)' : 'none',
              animation: backendStatus === 'checking' ? 'pulse 1.5s infinite' : backendStatus === 'online' ? 'pulse 3s infinite' : 'none',
            }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {backendStatus === 'online' ? 'Connected' : backendStatus === 'offline' ? 'Offline' : 'Checking...'}
            </span>
          </div>
        </div>

        {/* Repos Ingestion form */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
          <form onSubmit={handleAddRepo} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Index a Repository</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="github-url-input"
                type="text"
                placeholder="https://github.com/owner/repo"
                value={githubUrlInput}
                onChange={(e) => setGithubUrlInput(e.target.value)}
                disabled={addingRepo || backendStatus === 'offline'}
                className="input-field"
                style={{ padding: '10px 14px' }}
              />
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={addingRepo || !githubUrlInput || backendStatus === 'offline'}
                style={{ padding: '10px 14px' }}
              >
                {addingRepo ? <RefreshCw className="spinner" size={16} /> : <Zap size={16} />}
              </button>
            </div>
          </form>
          
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button 
              id="tutorial-button"
              onClick={() => { setShowTutorial(true); setTutorialStep(0); }}
              style={{ flex: 1, background: 'transparent', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px', borderRadius: '8px', fontSize: '0.8rem', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <BookOpen size={14} /> Getting Started
            </button>
            <button 
              id="webhook-setup-button"
              onClick={() => setShowInstructions(true)}
              style={{ flex: 1, background: 'transparent', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px', borderRadius: '8px', fontSize: '0.8rem', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-info)'; e.currentTarget.style.color = 'var(--accent-info)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Info size={14} /> Webhooks
            </button>
          </div>
        </div>

        {/* Repository list items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 4px', marginBottom: '4px' }}>Repositories</h2>
          
          {loadingRepos && repositories.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
              <div className="spinner"></div>
            </div>
          ) : repositories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-disabled)', fontSize: '0.85rem', lineHeight: '1.6' }}>
              <Github size={36} style={{ color: 'var(--border-color)', marginBottom: '12px' }} />
              <p style={{ fontWeight: 500, color: 'var(--text-muted)', marginBottom: '6px' }}>No repositories yet</p>
              <p>Paste a public GitHub URL above to start indexing a codebase.</p>
            </div>
          ) : (
            repositories.map(repo => {
              const isSelected = selectedRepo?.id === repo.id;
              return (
                <div 
                  key={repo.id}
                  id={`repo-card-${repo.id}`}
                  onClick={() => setSelectedRepo(repo)}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: isSelected ? 'var(--primary-glow)' : 'hsla(217, 30%, 12%, 0.4)',
                    border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.25s',
                    position: 'relative',
                    boxShadow: isSelected ? 'var(--shadow-glow)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <Github size={16} style={{ flexShrink: 0, color: isSelected ? 'var(--primary)' : 'var(--text-muted)' }} />
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {repo.name}
                      </span>
                    </div>
                    
                    {/* Status Badge */}
                    <span style={{ 
                      fontSize: '0.68rem', 
                      padding: '3px 8px', 
                      borderRadius: '12px', 
                      fontWeight: 600,
                      background: 
                        repo.status === 'completed' ? 'rgba(74, 222, 128, 0.12)' :
                        repo.status === 'indexing' ? 'rgba(96, 165, 250, 0.12)' :
                        repo.status === 'failed' ? 'rgba(248, 113, 113, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color:
                        repo.status === 'completed' ? 'var(--accent-success)' :
                        repo.status === 'indexing' ? 'var(--accent-info)' :
                        repo.status === 'failed' ? 'var(--accent-danger)' : 'var(--text-disabled)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {repo.status === 'indexing' && <RefreshCw size={10} className="spinner" />}
                      {repo.status === 'completed' && <CheckCircle size={10} />}
                      {repo.status === 'failed' && <AlertTriangle size={10} />}
                      {repo.status}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.72rem', color: 'var(--text-disabled)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginBottom: '12px' }}>
                    {repo.github_url}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={11} />
                      {repo.last_indexed_at ? new Date(repo.last_indexed_at).toLocaleDateString() : 'Never indexed'}
                    </span>
                    
                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                      <button 
                        id={`logs-btn-${repo.id}`}
                        onClick={() => handleViewLogs(repo.id)} 
                        title="View Indexing Logs" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '4px', borderRadius: '6px', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(217, 30%, 20%, 0.6)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <FileText size={14} />
                      </button>
                      <button 
                        id={`reindex-btn-${repo.id}`}
                        onClick={() => handleReindex(repo.id)} 
                        title="Force Re-index" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '4px', borderRadius: '6px', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(217, 30%, 20%, 0.6)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        disabled={repo.status === 'indexing'}
                      >
                        <RefreshCw size={14} className={repo.status === 'indexing' ? 'spinner' : ''} />
                      </button>
                      <button 
                        id={`delete-btn-${repo.id}`}
                        onClick={() => handleDeleteRepo(repo.id, repo.name)} 
                        title="Delete Repo" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent-danger)', display: 'flex', padding: '4px', borderRadius: '6px', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(346, 84%, 61%, 0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-disabled)' }}>
            {repositories.length} repo{repositories.length !== 1 ? 's' : ''} indexed
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Cpu size={10} /> Gemini + Groq
          </span>
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
        
        {selectedRepo ? (
          <>
            {/* Top Workspace Header */}
            <div style={{ 
              padding: '16px 24px', 
              borderBottom: '1px solid var(--border-color)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              background: 'var(--bg-surface)', 
              backdropFilter: 'blur(10px)',
            }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
                  {selectedRepo.name}
                </h2>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  {selectedRepo.status === 'completed' && <><CheckCircle size={12} style={{ color: 'var(--accent-success)' }} /> Ready to chat</>}
                  {selectedRepo.status === 'indexing' && <><RefreshCw size={12} className="spinner" style={{ color: 'var(--accent-info)' }} /> Indexing in progress...</>}
                  {selectedRepo.status === 'failed' && <><AlertTriangle size={12} style={{ color: 'var(--accent-danger)' }} /> Indexing failed</>}
                  {selectedRepo.status === 'idle' && <><Clock size={12} style={{ color: 'var(--text-disabled)' }} /> Queued for indexing</>}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ background: 'hsla(217, 30%, 15%, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '5px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Zap size={12} style={{ color: 'var(--accent-warning)' }} /> Groq Llama-3
                </span>
                <span style={{ background: 'hsla(217, 30%, 15%, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '5px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={12} style={{ color: 'var(--primary)' }} /> Gemini Embeddings
                </span>
              </div>
            </div>

            {/* Chat Messages Log */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '30px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {chatMessages.length === 0 && !activeStreamingText && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)' }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '20px',
                    background: 'linear-gradient(135deg, var(--primary-glow), hsla(250, 95%, 70%, 0.08))',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px',
                  }}>
                    <Search size={32} style={{ color: 'var(--primary)' }} />
                  </div>
                  <p style={{ fontWeight: 600, fontSize: '1.15rem', marginBottom: '8px', color: 'var(--text-main)' }}>Ask anything about the codebase</p>
                  <p style={{ fontSize: '0.85rem', maxWidth: '400px', textAlign: 'center', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    Ask about architecture, implementations, bug patterns, or where specific systems are defined. Answers cite real code with file paths and line numbers.
                  </p>
                  {selectedRepo.status !== 'completed' && (
                    <div style={{ 
                      marginTop: '20px', 
                      padding: '12px 20px', 
                      borderRadius: '10px', 
                      background: 'hsla(38, 92%, 50%, 0.08)', 
                      border: '1px solid hsla(38, 92%, 50%, 0.2)',
                      fontSize: '0.85rem',
                      color: 'var(--accent-warning)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}>
                      <AlertTriangle size={16} />
                      Repository is still {selectedRepo.status}. Chat will be available after indexing completes.
                    </div>
                  )}
                </div>
              )}

              {/* Chat history list */}
              {chatMessages.map((msg, index) => (
                <div 
                  key={index}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    gap: '6px'
                  }}
                  className="animate-fade-in"
                >
                  <div style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-disabled)',
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    {msg.sender === 'user' ? 'You' : <><Sparkles size={10} /> Assistant</>}
                  </div>
                  
                  {/* Message bubble */}
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    borderTopRightRadius: msg.sender === 'user' ? '4px' : '16px',
                    borderTopLeftRadius: msg.sender === 'bot' ? '4px' : '16px',
                    background: msg.sender === 'user' 
                      ? 'linear-gradient(135deg, var(--primary), hsl(260, 95%, 65%))' 
                      : 'hsla(217, 30%, 15%, 0.7)',
                    color: msg.sender === 'user' ? 'hsl(224, 71%, 4%)' : 'var(--text-main)',
                    border: `1px solid ${msg.sender === 'user' ? 'transparent' : 'var(--border-color)'}`,
                    lineHeight: '1.6',
                    fontSize: '0.92rem',
                    boxShadow: msg.sender === 'user' ? 'var(--shadow-glow)' : 'var(--shadow-sm)',
                    wordBreak: 'break-word',
                  }}>
                    {msg.sender === 'bot' ? renderBotMessage(msg.message) : msg.message}
                  </div>

                  {/* Render citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px', width: '100%', marginBottom: '2px' }}>
                        <Code size={11} /> Source Citations:
                      </span>
                      {msg.citations.map((cite, cIdx) => (
                        <button
                          key={cIdx}
                          id={`citation-${index}-${cIdx}`}
                          onClick={() => setActiveCodeDrawer(cite)}
                          style={{
                            background: 'hsla(217, 30%, 20%, 0.4)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '5px 10px',
                            fontSize: '0.73rem',
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            fontFamily: "'JetBrains Mono', monospace",
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'var(--primary-glow)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border-color)';
                            e.currentTarget.style.background = 'hsla(217, 30%, 20%, 0.4)';
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          <FileText size={11} />
                          {cite.filePath.split('/').pop()}:{cite.startLine}-{cite.endLine}
                          {cite.symbolName && <span style={{ color: 'var(--text-muted)' }}> ({cite.symbolName})</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming AI answer */}
              {activeStreamingText && (
                <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '80%', gap: '6px' }} className="animate-fade-in">
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-disabled)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={10} /> Assistant
                  </div>
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    borderTopLeftRadius: '4px',
                    background: 'hsla(217, 30%, 15%, 0.7)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    lineHeight: '1.6',
                    fontSize: '0.92rem',
                    wordBreak: 'break-word',
                  }}>
                    {renderBotMessage(activeStreamingText)}
                    <span style={{ 
                      display: 'inline-block', 
                      width: '8px', 
                      height: '16px', 
                      background: 'var(--primary)', 
                      marginLeft: '2px',
                      animation: 'blink 1s step-end infinite',
                      borderRadius: '1px',
                      verticalAlign: 'text-bottom',
                    }} />
                  </div>
                </div>
              )}

              {/* Streaming loading indicator (before first token) */}
              {isStreaming && !activeStreamingText && (
                <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '80%', gap: '6px' }} className="animate-fade-in">
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-disabled)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={10} /> Assistant
                  </div>
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    borderTopLeftRadius: '4px',
                    background: 'hsla(217, 30%, 15%, 0.7)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '0.85rem',
                  }}>
                    <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                    Searching code and generating answer...
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Bottom Chat input box */}
            <div style={{ padding: '18px 24px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-color)' }}>
              <form onSubmit={handleAsk} style={{ display: 'flex', gap: '12px' }}>
                <input
                  id="chat-input"
                  type="text"
                  placeholder={selectedRepo.status === 'completed' ? "Ask a question about the code..." : "Waiting for indexing to complete..."}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isStreaming || selectedRepo.status !== 'completed'}
                  className="input-field"
                  style={{ flex: 1 }}
                />
                <button
                  id="send-button"
                  type="submit"
                  className="btn btn-primary"
                  disabled={!chatInput.trim() || isStreaming || selectedRepo.status !== 'completed'}
                  style={{ minWidth: '80px' }}
                >
                  {isStreaming ? (
                    <RefreshCw className="spinner" size={18} />
                  ) : (
                    <>
                      <span>Ask</span>
                      <Send size={15} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty Workspace selection placeholder */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--text-disabled)' }}>
            <div style={{
              width: '100px',
              height: '100px',
              borderRadius: '24px',
              background: 'linear-gradient(135deg, var(--primary-glow), hsla(250, 95%, 70%, 0.08))',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
              boxShadow: 'var(--shadow-glow)',
            }}>
              <GitBranch size={40} style={{ color: 'var(--primary)' }} />
            </div>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '10px', background: 'linear-gradient(135deg, var(--text-main), var(--primary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>RAG Git Assistant</h2>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', maxWidth: '450px', textAlign: 'center', lineHeight: '1.7', marginBottom: '24px' }}>
              Select a repository from the sidebar to chat and search code segments, or paste a GitHub URL to index a new codebase.
            </p>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="btn btn-primary"
                onClick={() => { setShowTutorial(true); setTutorialStep(0); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <BookOpen size={16} /> Getting Started Guide
              </button>
            </div>

            {backendStatus === 'offline' && (
              <div style={{ 
                marginTop: '28px', 
                padding: '16px 24px', 
                borderRadius: '12px', 
                background: 'hsla(346, 84%, 61%, 0.08)', 
                border: '1px solid hsla(346, 84%, 61%, 0.2)',
                fontSize: '0.88rem',
                color: 'var(--accent-danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                maxWidth: '460px',
              }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>Backend server is not reachable.</strong>
                  <p style={{ fontSize: '0.8rem', marginTop: '4px', color: 'var(--text-muted)' }}>
                    Make sure Docker services and the backend are running. See the Getting Started guide for details.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Slide-out Code Citation Viewer Drawer */}
      {activeCodeDrawer && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '550px',
          height: '100vh',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          animation: 'slideInRight 0.25s ease-out'
        }}>
          {/* Header */}
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code size={18} style={{ color: 'var(--primary)' }} />
                Code Citation
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: "'JetBrains Mono', monospace" }}>
                {activeCodeDrawer.filePath} (L{activeCodeDrawer.startLine}-{activeCodeDrawer.endLine})
              </p>
            </div>
            <button 
              id="close-citation-drawer"
              onClick={() => setActiveCodeDrawer(null)}
              style={{ background: 'hsla(217, 30%, 20%, 0.4)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '8px', padding: '6px', display: 'flex', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Details metadata */}
          <div style={{ padding: '14px 20px', background: 'hsla(217, 30%, 8%, 0.4)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '24px', fontSize: '0.82rem' }}>
            <div>
              <span style={{ color: 'var(--text-disabled)', fontWeight: 500 }}>Symbol: </span>
              <span style={{ color: 'var(--primary)', fontFamily: "'JetBrains Mono', monospace" }}>{activeCodeDrawer.symbolName || 'N/A'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-disabled)', fontWeight: 500 }}>Type: </span>
              <span style={{ color: 'var(--text-main)' }}>{activeCodeDrawer.symbolType}</span>
            </div>
          </div>

          {/* Code text content area */}
          <pre style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px',
            margin: 0,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: '0.82rem',
            lineHeight: '1.6',
            background: 'var(--bg-input)',
            color: 'hsl(210, 40%, 90%)',
            whiteSpace: 'pre',
          }}>
            <code>
              {activeCodeDrawer.content.split('\n').map((line, index) => {
                const absoluteLineNum = activeCodeDrawer.startLine + index;
                return (
                  <div key={index} style={{ display: 'flex', gap: '16px', padding: '0 4px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(250, 95%, 70%, 0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ width: '32px', color: 'var(--text-disabled)', textAlign: 'right', userSelect: 'none', display: 'inline-block', flexShrink: 0 }}>
                      {absoluteLineNum}
                    </span>
                    <span>{line}</span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>
      )}

      {/* Index Logs Sidebar Overlay */}
      {showLogsRepoId !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '550px',
          height: '100vh',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          animation: 'slideInRight 0.25s ease-out'
        }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} style={{ color: 'var(--primary)' }} />
              Indexing History
            </h3>
            <button 
              id="close-logs-drawer"
              onClick={() => setShowLogsRepoId(null)}
              style={{ background: 'hsla(217, 30%, 20%, 0.4)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '8px', padding: '6px', display: 'flex', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            >
              <X size={18} />
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {indexLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-disabled)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <Terminal size={32} style={{ color: 'var(--border-color)' }} />
                <p>No indexing runs recorded for this repository.</p>
              </div>
            ) : (
              indexLogs.map((log) => (
                <div 
                  key={log.id}
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    background: 'hsla(217, 30%, 10%, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={12} />
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: log.status === 'completed' ? 'var(--accent-success)' : 'var(--accent-danger)',
                      background: log.status === 'completed' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                      padding: '3px 10px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {log.status === 'completed' ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                      {log.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '20px', fontSize: '0.82rem', color: 'var(--text-main)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={12} style={{ color: 'var(--text-disabled)' }} />
                      Files: <strong>{log.files_updated}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={12} style={{ color: 'var(--text-disabled)' }} />
                      Duration: <strong>{(log.duration_ms / 1000).toFixed(2)}s</strong>
                    </div>
                  </div>

                  {log.error_message && (
                    <pre style={{
                      background: 'hsla(346, 84%, 61%, 0.05)',
                      border: '1px solid hsla(346, 84%, 61%, 0.2)',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '0.73rem',
                      color: 'var(--accent-danger)',
                      whiteSpace: 'pre-wrap',
                      fontFamily: "'JetBrains Mono', monospace"
                    }}>
                      {log.error_message}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* GitHub Webhook Setup Modal Overlay */}
      {showInstructions && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.7)',
          zIndex: 110,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backdropFilter: 'blur(5px)',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowInstructions(false); }}
        >
          <div className="animate-fade-in" style={{
            width: '600px',
            maxWidth: '90%',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Github size={22} style={{ color: 'var(--primary)' }} />
                Setup GitHub App Webhooks
              </h3>
              <button 
                onClick={() => setShowInstructions(false)}
                style={{ background: 'hsla(217, 30%, 20%, 0.4)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '8px', padding: '6px', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '14px', lineHeight: '1.65' }}>
              <p>To enable <strong style={{ color: 'var(--text-main)' }}>auto-updating on push</strong> and <strong style={{ color: 'var(--text-main)' }}>automated PR reviews</strong>, configure a GitHub App:</p>
              
              <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <li>
                  Go to GitHub <strong style={{ color: 'var(--text-main)' }}>Developer Settings</strong> → <strong style={{ color: 'var(--text-main)' }}>GitHub Apps</strong> → <strong style={{ color: 'var(--text-main)' }}>New GitHub App</strong>.
                </li>
                <li>
                  Set the <strong style={{ color: 'var(--text-main)' }}>Webhook URL</strong> to:
                  <code style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--primary)', padding: '6px 12px', borderRadius: '6px', fontFamily: "'JetBrains Mono', monospace", display: 'block', margin: '6px 0', fontSize: '0.8rem' }}>
                    http://YOUR_DOMAIN_OR_NGROK/api/webhook
                  </code>
                </li>
                <li>
                  Set the <strong style={{ color: 'var(--text-main)' }}>Webhook secret</strong> (must match <code style={{ color: 'var(--primary)', fontSize: '0.82em' }}>GITHUB_WEBHOOK_SECRET</code> in your <code style={{ fontSize: '0.82em' }}>.env</code>).
                </li>
                <li>
                  Grant these <strong style={{ color: 'var(--text-main)' }}>Permissions</strong>:
                  <ul style={{ paddingLeft: '20px', marginTop: '6px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                    <li>Repository Contents: <strong>Read-only</strong></li>
                    <li>Pull Requests: <strong>Read & write</strong></li>
                  </ul>
                </li>
                <li>
                  Subscribe to <strong style={{ color: 'var(--text-main)' }}>Events</strong>:
                  <ul style={{ paddingLeft: '20px', marginTop: '6px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                    <li>Push</li>
                    <li>Pull request</li>
                  </ul>
                </li>
                <li>
                  Generate a <strong style={{ color: 'var(--text-main)' }}>Private Key</strong> (.pem) and paste it into your backend <code style={{ fontSize: '0.82em' }}>.env</code> as <code style={{ color: 'var(--primary)', fontSize: '0.82em' }}>GITHUB_PRIVATE_KEY</code>.
                </li>
              </ol>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={() => setShowInstructions(false)}
              style={{ alignSelf: 'flex-end', marginTop: '4px' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Tutorial / Onboarding Modal */}
      {showTutorial && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.75)',
          zIndex: 120,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backdropFilter: 'blur(8px)',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) dismissTutorial(); }}
        >
          <div className="animate-fade-in" style={{
            width: '560px',
            maxWidth: '92%',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '20px',
            padding: '36px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxShadow: '0 25px 60px -12px rgba(0,0,0,0.7)',
            position: 'relative',
          }}>
            {/* Close button */}
            <button 
              onClick={dismissTutorial}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--text-disabled)', cursor: 'pointer', padding: '4px' }}
            >
              <X size={18} />
            </button>

            {/* Step indicator dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
              {tutorialSteps.map((_, idx) => (
                <div 
                  key={idx}
                  onClick={() => setTutorialStep(idx)}
                  style={{ 
                    width: idx === tutorialStep ? '24px' : '8px', 
                    height: '8px', 
                    borderRadius: '4px', 
                    background: idx === tutorialStep ? 'var(--primary)' : 'var(--border-color)',
                    transition: 'all 0.3s',
                    cursor: 'pointer',
                    boxShadow: idx === tutorialStep ? 'var(--shadow-glow)' : 'none',
                  }} 
                />
              ))}
            </div>
            
            {/* Content */}
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', minHeight: '240px' }}>
              <div style={{ 
                width: '68px', 
                height: '68px', 
                borderRadius: '18px', 
                background: 'linear-gradient(135deg, var(--primary-glow), hsla(250, 95%, 70%, 0.15))', 
                border: '1px solid var(--border-color)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
              }}>
                {tutorialSteps[tutorialStep].icon}
              </div>
              
              <h3 style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                {tutorialSteps[tutorialStep].title}
              </h3>
              
              <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: '1.65', maxWidth: '420px' }}>
                {tutorialSteps[tutorialStep].description}
              </p>

              {tutorialSteps[tutorialStep].code && (
                <pre style={{
                  background: 'hsla(222, 47%, 6%, 0.95)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px 18px',
                  fontSize: '0.8rem',
                  lineHeight: '1.6',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  color: 'var(--primary)',
                  textAlign: 'left',
                  width: '100%',
                  maxWidth: '420px',
                  whiteSpace: 'pre-wrap',
                }}>
                  {tutorialSteps[tutorialStep].code}
                </pre>
              )}
            </div>

            {/* Navigation buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setTutorialStep(Math.max(0, tutorialStep - 1))}
                className="btn btn-secondary"
                style={{ visibility: tutorialStep === 0 ? 'hidden' : 'visible', fontSize: '0.88rem' }}
              >
                Back
              </button>

              {tutorialStep < tutorialSteps.length - 1 ? (
                <button 
                  onClick={() => setTutorialStep(tutorialStep + 1)}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem' }}
                >
                  Next <ArrowRight size={16} />
                </button>
              ) : (
                <button 
                  onClick={dismissTutorial}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem' }}
                >
                  <Sparkles size={16} /> Start Using
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
