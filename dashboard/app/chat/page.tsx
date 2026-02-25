"use client";

import { useEffect, useRef, useState } from "react";

interface Agent {
  id: string;
  name: string;
  status: string;
}

interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: string;
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
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

export default function ChatPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch("/api/v1/agents")
      .then((data) => {
        const agentList = data.agents || [];
        setAgents(agentList);
        if (agentList.length > 0) setSelectedAgent(agentList[0].id);
      })
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !selectedAgent || sending) return;

    const userMsg: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const data = await apiFetch(`/api/v1/agents/${selectedAgent}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: userMsg.content }),
      });

      const agentMsg: Message = {
        role: "agent",
        content: data.response || "No response",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const selectedAgentName =
    agents.find((a) => a.id === selectedAgent)?.name || "Agent";

  return (
    <>
      <div className="page-header">
        <h1 className="section-title">Chat with Agent</h1>
        <p className="section-subtitle">
          Send messages directly to your AI agents
        </p>
      </div>

      {/* Agent Selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Select Agent</div>
            <div className="card-subtitle">Choose an agent to chat with</div>
          </div>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          {agents.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <p>No agents found. Create one first:</p>
              <pre
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: 12,
                  borderRadius: 8,
                  marginTop: 8,
                  fontSize: 13,
                }}
              >
                karen agent create --name &quot;Trader&quot; --strategy &quot;DCA
                into USDC&quot;
              </pre>
            </div>
          ) : (
            <select
              value={selectedAgent}
              onChange={(e) => {
                setSelectedAgent(e.target.value);
                setMessages([]);
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.status})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Chat Window */}
      <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 400 }}>
        <div className="card-header">
          <div>
            <div className="card-title">💬 {selectedAgentName}</div>
            <div className="card-subtitle">
              {agents.find((a) => a.id === selectedAgent)?.status === "running"
                ? "🟢 Online"
                : "🟡 Idle — responses still work"}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxHeight: 400,
          }}
        >
          {messages.length === 0 && (
            <div
              className="empty-state"
              style={{ padding: 40, opacity: 0.5 }}
            >
              <p>Send a message to start the conversation</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent:
                  msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "75%",
                  padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background:
                    msg.role === "user"
                      ? "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))"
                      : "rgba(255,255,255,0.08)",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.5,
                    marginTop: 4,
                    textAlign: msg.role === "user" ? "right" : "left",
                  }}
                >
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {sending && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "16px 16px 16px 4px",
                  background: "rgba(255,255,255,0.08)",
                  fontSize: 14,
                  opacity: 0.6,
                }}
              >
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 20px",
              color: "var(--status-error)",
              fontSize: 13,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Input */}
        <div
          style={{
            padding: "12px 20px 20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            gap: 10,
          }}
        >
          <input
            type="text"
            placeholder={
              agents.length === 0
                ? "Create an agent first..."
                : "Type a message..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={agents.length === 0 || sending}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || agents.length === 0 || sending}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background:
                !input.trim() || sending
                  ? "rgba(255,255,255,0.1)"
                  : "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor:
                !input.trim() || sending ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}
