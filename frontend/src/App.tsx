import React, { useState, useEffect, useRef } from 'react';
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
  ChevronRight, 
  Github, 
  Code,
  Info,
  Clock,
  Layers,
  X
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
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  
  // Modals & Panels
  const [showLogsRepoId, setShowLogsRepoId] = useState<number | null>(null);
  const [indexLogs, setIndexLogs] = useState<IndexLog[]>([]);
  const [activeCodeDrawer, setActiveCodeDrawer] = useState<Citation | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addingRepo, setAddingRepo] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch Repositories list
  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API_BASE}/repos`);
      const data = await res.json();
      if (data.repositories) {
        setRepositories(data.repositories);
        // Sync selected repository details if one was selected
        if (selectedRepo) {
          const updated = data.repositories.find((r: Repository) => r.id === selectedRepo.id);
          if (updated) setSelectedRepo(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load repositories:', err);
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  // Poll indexing repositories
  useEffect(() => {
    const isAnyIndexing = repositories.some(r => r.status === 'indexing');
    if (!isAnyIndexing) return;

    const timer = setInterval(() => {
      fetchRepos();
    }, 4000);

    return () => clearInterval(timer);
  }, [repositories]);

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

  // Ask RAG Assistant
  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedRepo || isStreaming) return;

    const userQuestion = chatInput.trim();
    setChatInput('');
    setIsStreaming(true);
    setActiveStreamingText('');
    setActiveCitations([]);

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
              setActiveStreamingText(prev => prev + parsed.content);
            } else if (parsed.type === 'citations') {
              setActiveCitations(parsed.citations || []);
            } else if (parsed.type === 'error') {
              setActiveStreamingText(prev => prev + `\n[Error: ${parsed.message}]`);
            }
          } catch (e) {
            console.error('JSON parse error on SSE token:', e);
          }
        },
        onclose() {
          // Finalize streaming
          setIsStreaming(false);
          setChatMessages(prev => [
            ...prev,
            { sender: 'bot', message: activeStreamingText, citations: activeCitations }
          ]);
          setActiveStreamingText('');
          setActiveCitations([]);
        },
        onerror(err) {
          console.error('SSE Error:', err);
          setIsStreaming(false);
          throw err;
        }
      });
    } catch (err) {
      console.error(err);
      setIsStreaming(false);
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      
      {/* Sidebar: Repositories list */}
      <aside className="glass-panel" style={{ width: '350px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: 0, margin: 0, background: 'var(--bg-surface)' }}>
        
        {/* Brand header */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--primary-glow)', border: '1px solid var(--primary)', borderRadius: '10px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GitBranch size={22} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>RAG Git Bot</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI Assistant & Reviewer</p>
          </div>
        </div>

        {/* Repos Ingestion form */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
          <form onSubmit={handleAddRepo} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingest Github URL</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="https://github.com/owner/repo"
                value={githubUrlInput}
                onChange={(e) => setGithubUrlInput(e.target.value)}
                disabled={addingRepo}
                className="input-field"
                style={{ padding: '10px 14px' }}
              />
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={addingRepo || !githubUrlInput}
                style={{ padding: '10px 14px' }}
              >
                {addingRepo ? <RefreshCw className="spinner" size={16} /> : 'Add'}
              </button>
            </div>
          </form>
          
          <button 
            onClick={() => setShowInstructions(true)}
            style={{ width: '100%', marginTop: '12px', background: 'transparent', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', borderRadius: '8px', fontSize: '0.85rem' }}
          >
            <Info size={16} /> Setup GitHub Webhooks
          </button>
        </div>

        {/* Repository list items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Repositories</h2>
          
          {loadingRepos && repositories.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <div className="spinner"></div>
            </div>
          ) : repositories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-disabled)', fontSize: '0.9rem' }}>
              No repositories added yet. Start by entering a public GitHub URL above.
            </div>
          ) : (
            repositories.map(repo => {
              const isSelected = selectedRepo?.id === repo.id;
              return (
                <div 
                  key={repo.id}
                  onClick={() => setSelectedRepo(repo)}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: isSelected ? 'var(--primary-glow)' : 'hsla(217, 30%, 12%, 0.4)',
                    border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.25s',
                    position: 'relative'
                  }}
                  className="glass-panel"
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
                      fontSize: '0.7rem', 
                      padding: '2px 8px', 
                      borderRadius: '12px', 
                      fontWeight: 600,
                      background: 
                        repo.status === 'completed' ? 'rgba(74, 222, 128, 0.1)' :
                        repo.status === 'indexing' ? 'rgba(96, 165, 250, 0.1)' :
                        repo.status === 'failed' ? 'rgba(248, 113, 113, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                      color:
                        repo.status === 'completed' ? 'var(--accent-success)' :
                        repo.status === 'indexing' ? 'var(--accent-info)' :
                        repo.status === 'failed' ? 'var(--accent-danger)' : 'var(--text-disabled)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {repo.status === 'indexing' && <RefreshCw size={10} className="spinner" />}
                      {repo.status}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.75rem', color: 'var(--text-disabled)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginBottom: '12px' }}>
                    {repo.github_url}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} />
                      {repo.last_indexed_at ? new Date(repo.last_indexed_at).toLocaleDateString() : 'Never'}
                    </span>
                    
                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => handleViewLogs(repo.id)} 
                        title="View Indexing Logs" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                      >
                        <FileText size={15} />
                      </button>
                      <button 
                        onClick={() => handleReindex(repo.id)} 
                        title="Force Re-index" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                        disabled={repo.status === 'indexing'}
                      >
                        <RefreshCw size={15} className={repo.status === 'indexing' ? 'spinner' : ''} />
                      </button>
                      <button 
                        onClick={() => handleDeleteRepo(repo.id, repo.name)} 
                        title="Delete Repo" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent-danger)', display: 'flex' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
        
        {selectedRepo ? (
          <>
            {/* Top Workspace Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', backdropFilter: 'blur(10px)' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Chatting with {selectedRepo.name}</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Index Status: {selectedRepo.status}</span>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <span style={{ background: 'hsla(217, 30%, 15%, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  LLM: Groq (Llama-3)
                </span>
                <span style={{ background: 'hsla(217, 30%, 15%, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Embeddings: Gemini (text-embedding-004)
                </span>
              </div>
            </div>

            {/* Chat Messages Log */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '30px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {chatMessages.length === 0 && !activeStreamingText && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)' }}>
                  <MessageSquare size={48} style={{ color: 'var(--border-color)', marginBottom: '16px' }} />
                  <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '8px', color: 'var(--text-main)' }}>Ask anything about the codebase</p>
                  <p style={{ fontSize: '0.85rem', maxWidth: '350px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Ask about logic structures, class implementations, bug detections, or where specific systems are written.
                  </p>
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
                    fontSize: '0.75rem',
                    color: 'var(--text-disabled)',
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {msg.sender === 'user' ? 'User' : 'Assistant'}
                  </div>
                  
                  {/* Message bubble */}
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    borderTopRightRadius: msg.sender === 'user' ? '4px' : '16px',
                    borderTopLeftRadius: msg.sender === 'bot' ? '4px' : '16px',
                    background: msg.sender === 'user' ? 'var(--primary)' : 'hsla(217, 30%, 15%, 0.7)',
                    color: msg.sender === 'user' ? 'hsl(224, 71%, 4%)' : 'var(--text-main)',
                    border: `1px solid ${msg.sender === 'user' ? 'transparent' : 'var(--border-color)'}`,
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.5',
                    fontSize: '0.95rem',
                    boxShadow: msg.sender === 'user' ? 'var(--shadow-glow)' : 'var(--shadow-sm)'
                  }}>
                    {msg.message}
                  </div>

                  {/* Render citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', gap: '4px', width: '100%', marginBottom: '2px' }}>
                        <Code size={12} /> Citations:
                      </span>
                      {msg.citations.map((cite, cIdx) => (
                        <button
                          key={cIdx}
                          onClick={() => setActiveCodeDrawer(cite)}
                          style={{
                            background: 'hsla(217, 30%, 20%, 0.4)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'var(--primary-glow)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border-color)';
                            e.currentTarget.style.background = 'hsla(217, 30%, 20%, 0.4)';
                          }}
                        >
                          {cite.filePath.split('/').pop()}:{cite.startLine}-{cite.endLine} {cite.symbolName ? `(${cite.symbolName})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming AI answer */}
              {activeStreamingText && (
                <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '80%', gap: '6px' }} className="animate-fade-in">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-disabled)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Assistant
                  </div>
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    borderTopLeftRadius: '4px',
                    background: 'hsla(217, 30%, 15%, 0.7)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.5',
                    fontSize: '0.95rem'
                  }}>
                    {activeStreamingText}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Bottom Chat input box */}
            <div style={{ padding: '20px 24px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-color)' }}>
              <form onSubmit={handleAsk} style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Ask a question about the code..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isStreaming || selectedRepo.status === 'indexing'}
                  className="input-field"
                  style={{ flex: 1 }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!chatInput.trim() || isStreaming || selectedRepo.status === 'indexing'}
                >
                  {isStreaming ? (
                    <RefreshCw className="spinner" size={18} />
                  ) : (
                    <>
                      <span>Ask</span>
                      <Send size={16} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty Workspace selection placeholder */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--text-disabled)' }}>
            <GitBranch size={64} style={{ color: 'var(--border-color)', marginBottom: '20px' }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>RAG Git Assistant</h2>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', maxWidth: '400px', textAlign: 'center', lineHeight: '1.6' }}>
              Select a repository from the sidebar to chat and search code segments, or insert a Github repository URL to trigger initial codebase ingestion.
            </p>
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
          animation: 'fadeIn 0.25s ease-out'
        }}>
          {/* Header */}
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code size={18} style={{ color: 'var(--primary)' }} />
                Code Citation
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {activeCodeDrawer.filePath} (Lines {activeCodeDrawer.startLine}-{activeCodeDrawer.endLine})
              </p>
            </div>
            <button 
              onClick={() => setActiveCodeDrawer(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Details metadata */}
          <div style={{ padding: '16px 20px', background: 'hsla(217, 30%, 8%, 0.4)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '20px', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text-disabled)', fontWeight: 500 }}>Symbol: </span>
              <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{activeCodeDrawer.symbolName || 'none'}</span>
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
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            lineHeight: '1.5',
            background: 'var(--bg-input)',
            color: 'hsl(210, 40%, 90%)',
            whiteSpace: 'pre',
          }}>
            <code>
              {activeCodeDrawer.content.split('\n').map((line, index) => {
                const absoluteLineNum = activeCodeDrawer.startLine + index;
                return (
                  <div key={index} style={{ display: 'flex', gap: '16px' }}>
                    <span style={{ width: '28px', color: 'var(--text-disabled)', textAlign: 'right', userSelect: 'none', display: 'inline-block' }}>
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
          WebkitBackdropFilter: 'blur(20px)'
        }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} style={{ color: 'var(--primary)' }} />
              Indexing History
            </h3>
            <button 
              onClick={() => setShowLogsRepoId(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {indexLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-disabled)' }}>
                No indexing runs recorded for this repository.
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
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={12} />
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: log.status === 'completed' ? 'var(--accent-success)' : 'var(--accent-danger)',
                      background: log.status === 'completed' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {log.status === 'completed' ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                      {log.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                    <div>Files Ingested: <strong>{log.files_updated}</strong></div>
                    <div>Duration: <strong>{(log.duration_ms / 1000).toFixed(2)}s</strong></div>
                  </div>

                  {log.error_message && (
                    <pre style={{
                      background: 'hsla(346, 84%, 61%, 0.05)',
                      border: '1px solid hsla(346, 84%, 61%, 0.2)',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: 'var(--accent-danger)',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace'
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
          backdropFilter: 'blur(5px)'
        }}>
          <div className="glass-panel animate-fade-in" style={{
            width: '600px',
            maxWidth: '90%',
            background: 'var(--bg-surface)',
            borderRadius: '16px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Github size={20} style={{ color: 'var(--primary)' }} />
                Setup GitHub App Webhooks
              </h3>
              <button 
                onClick={() => setShowInstructions(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-disabled)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '14px', lineHeight: '1.6' }}>
              <p>To enable <strong>auto-updating on push</strong> and <strong>automated PR reviews</strong>, configure a GitHub App with the following details:</p>
              
              <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <li>
                  Go to your GitHub Account Settings &rarr; <strong>Developer settings</strong> &rarr; <strong>GitHub Apps</strong> &rarr; <strong>New GitHub App</strong>.
                </li>
                <li>
                  Set the <strong>Webhook URL</strong> to your server's address:
                  <code style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '4px', fontFamily: 'monospace', display: 'block', margin: '4px 0', fontSize: '0.8rem' }}>
                    http://YOUR_DOMAIN_OR_NGROK/api/webhook
                  </code>
                </li>
                <li>
                  Configure the **Webhook secret** (matching GITHUB_WEBHOOK_SECRET in your `.env`).
                </li>
                <li>
                  Provide the following **Permissions**:
                  <ul style={{ paddingLeft: '20px', marginTop: '4px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                    <li>Repository Contents: <strong>Read-only</strong> (for reading files on push)</li>
                    <li>Pull Requests: <strong>Read & write</strong> (for leaving review comments)</li>
                  </ul>
                </li>
                <li>
                  Subscribe to the following **Events**:
                  <ul style={{ paddingLeft: '20px', marginTop: '4px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                    <li>Push</li>
                    <li>Pull request</li>
                  </ul>
                </li>
                <li>
                  Generate a **Private Key** (.pem), download it, and paste it into your backend `.env` as the <strong>GITHUB_PRIVATE_KEY</strong> value.
                </li>
              </ol>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={() => setShowInstructions(false)}
              style={{ alignSelf: 'flex-end', marginTop: '8px' }}
            >
              Done, close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
