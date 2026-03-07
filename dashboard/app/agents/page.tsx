"use client";

import { useEffect, useState } from "react";

interface Agent {
  id: string;
  name: string;
  walletId: string;
  llmProvider: string;
  llmModel: string;
  strategy: string;
  status: string;
  loopIntervalMs: number;
  createdAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "karen-dev-secret";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<{ id: string; name: string }[]>([]);

  // Form State
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentProvider, setNewAgentProvider] = useState("openai");
  const [newAgentWalletId, setNewAgentWalletId] = useState("");
  const [newAgentStrategy, setNewAgentStrategy] = useState("");

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadAgents() {
    try {
      const data = await apiFetch("/api/v1/agents");
      setAgents(data.agents || []);
    } catch { }
    setLoading(false);
  }

  async function loadWalletsForDropdown() {
    try {
      const data = await apiFetch("/api/v1/wallets");
      if (data?.wallets) {
        setAvailableWallets(data.wallets);
        if (data.wallets.length > 0 && !newAgentWalletId) {
          setNewAgentWalletId(data.wallets[0].id);
        }
      }
    } catch { }
  }

  async function openCreateModal() {
    await loadWalletsForDropdown();
    setIsCreateModalOpen(true);
  }

  async function handleCreateAgent() {
    if (!newAgentName.trim() || !newAgentStrategy.trim() || !newAgentWalletId) return;
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/v1/agents", {
        method: "POST",
        body: JSON.stringify({
          name: newAgentName,
          llmProvider: newAgentProvider,
          walletId: newAgentWalletId,
          strategy: newAgentStrategy,
        }),
      });
      if (res && res.agent) {
        setAgents((prev) => [...prev, res.agent]);
        setIsCreateModalOpen(false);
        // Reset form
        setNewAgentName("");
        setNewAgentStrategy("");
        setNewAgentProvider("openai");
      }
    } catch {
      alert("Failed to create agent");
    }
    setIsCreating(false);
  }

  async function handleStartStop(agent: Agent) {
    try {
      if (agent.status === "running") {
        await apiFetch(`/api/v1/agents/${agent.id}/stop`, { method: "POST" });
      } else {
        await apiFetch(`/api/v1/agents/${agent.id}/start`, { method: "POST" });
      }
      loadAgents();
    } catch { }
  }

  async function handleChat() {
    if (!chatInput.trim() || !chatAgentId) return;
    const message = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: message }]);
    setChatLoading(true);
    try {
      const data = await apiFetch(`/api/v1/agents/${chatAgentId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setChatMessages((prev) => [...prev, { role: "agent", text: data.response }]);
    } catch (e: any) {
      setChatMessages((prev) => [...prev, { role: "agent", text: `Error: ${e.message}` }]);
    }
    setChatLoading(false);
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="icon">🤖</div>
        <p>Loading agents...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="section-title">Agents</h1>
          <p className="section-subtitle">
            Autonomous AI agents managing Solana wallets
          </p>
        </div>
        <button className="btn btn-primary" onClick={openCreateModal}>
          + Deploy New Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">🤖</div>
            <p>
              No agents created yet. Use the CLI to create one:
              <br />
              <code className="mono" style={{ color: "var(--accent-primary)", marginTop: 8, display: "block" }}>
                karen agent create --name &quot;Trader&quot; --strategy &quot;DCA into USDC&quot;
              </code>
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>LLM</th>
                <th>Strategy</th>
                <th>Interval</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {agent.name}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {agent.id.slice(0, 8)}...
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${agent.status}`}>
                      {agent.status}
                    </span>
                  </td>
                  <td className="mono">{agent.llmProvider}/{agent.llmModel}</td>
                  <td className="truncate" style={{ maxWidth: 200 }}>
                    {agent.strategy}
                  </td>
                  <td className="mono">{(agent.loopIntervalMs / 1000).toFixed(0)}s</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className={`btn ${agent.status === "running" ? "btn-ghost" : "btn-primary"}`}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => handleStartStop(agent)}
                      >
                        {agent.status === "running" ? "⏹ Stop" : "▶ Start"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={async () => {
                          if (chatAgentId === agent.id) {
                            setChatAgentId(null);
                          } else {
                            setChatAgentId(agent.id);
                            setChatMessages([]);
                            setChatLoading(true);
                            try {
                              const data = await apiFetch(`/api/v1/agents/${agent.id}/chat/history`);
                              if (data?.history) {
                                setChatMessages(data.history.map((m: any) => ({ role: m.role, text: m.content })));
                              }
                            } catch { }
                            setChatLoading(false);
                          }
                        }}
                      >
                        💬 Chat
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chat Panel */}
      {chatAgentId && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <div className="card-title">
              💬 Chat with {agents.find((a) => a.id === chatAgentId)?.name}
            </div>
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => setChatAgentId(null)}
            >
              ✕ Close
            </button>
          </div>
          <div className="chat-container">
            <div className="chat-messages">
              {chatMessages.length === 0 && (
                <div style={{ color: "var(--text-muted)", textAlign: "center", paddingTop: 40 }}>
                  Ask the agent anything about its strategy, decisions, or wallet state.
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                  {msg.text}
                </div>
              ))}
              {chatLoading && (
                <div className="chat-message agent" style={{ opacity: 0.5 }}>
                  Thinking...
                </div>
              )}
            </div>
            <div className="chat-input-area">
              <input
                className="chat-input"
                placeholder="Ask the agent something..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
              />
              <button className="btn btn-primary" onClick={handleChat}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Agent Modal */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Deploy New Agent</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Instantiate a new autonomous AI engine.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Agent Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. DCA-Bot-01"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">AI Engine (LLM Provider)</label>
              <select
                className="form-select"
                value={newAgentProvider}
                onChange={(e) => setNewAgentProvider(e.target.value)}
              >
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="anthropic">Anthropic (Claude-3.5-Sonnet)</option>
                <option value="gemini">Google (Gemini Pro)</option>
                <option value="grok">xAI (Grok)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Assigned Core Wallet</label>
              <select
                className="form-select"
                value={newAgentWalletId}
                onChange={(e) => setNewAgentWalletId(e.target.value)}
              >
                {availableWallets.length === 0 && <option disabled value="">No wallets found</option>}
                {availableWallets.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.id.slice(0, 8)}...)</option>
                ))}
              </select>
              {availableWallets.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--status-error)", marginTop: 6 }}>
                  You must create a Wallet first before deploying an Agent.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Trading & Execution Strategy</label>
              <textarea
                className="form-textarea"
                placeholder="e.g. You are a conservative trading bot. Every cycle, check the price of SOL. If SOL drops below $120, swap 10% of your USDC for SOL."
                value={newAgentStrategy}
                onChange={(e) => setNewAgentStrategy(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setIsCreateModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateAgent}
                disabled={!newAgentName.trim() || !newAgentStrategy.trim() || !newAgentWalletId || isCreating}
              >
                {isCreating ? <span className="spinner"></span> : "Deploy Agent 🚀"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
