"use client";

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  walletId: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "karen-dev-secret";

async function apiFetch(path: string, options?: RequestInit) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_SECRET}`,
        ...options?.headers,
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    const data = await apiFetch("/api/v1/keys");
    if (data) setKeys(data.keys || []);
    setLoading(false);
  }

  async function handleCreateKey() {
    if (!newKeyName.trim()) return;
    const data = await apiFetch("/api/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name: newKeyName }),
    });
    if (data?.apiKey) {
      setNewKey(data.apiKey);
      setNewKeyName("");
      loadKeys();
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="icon">🔑</div>
        <p>Loading API keys...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="section-title">API Keys</h1>
        <p className="section-subtitle">
          Manage API keys for external AI agents to access Karen
        </p>
      </div>

      {/* Create Key */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>Create New API Key</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="chat-input"
            placeholder="Key name (e.g., 'my-trading-bot')"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
          />
          <button className="btn btn-primary" onClick={handleCreateKey}>
            Create Key
          </button>
        </div>

        {newKey && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: "rgba(34, 197, 94, 0.05)",
              border: "1px solid rgba(34, 197, 94, 0.2)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--status-success)", fontWeight: 600, marginBottom: 8 }}>
              ✅ API Key Created — Copy it now, it won&apos;t be shown again!
            </div>
            <code className="mono" style={{ fontSize: 14, color: "var(--text-primary)", wordBreak: "break-all" }}>
              {newKey}
            </code>
          </div>
        )}
      </div>

      {/* Integration Guide */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Integration Guide</div>
        <div className="card-subtitle" style={{ marginBottom: 16 }}>
          External agents can use Karen via REST API or MCP
        </div>
        <div className="grid-2">
          <div style={{ padding: 16, background: "var(--bg-glass)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>REST API</div>
            <pre className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
              {`curl -H "Authorization: Bearer YOUR_KEY" \\
  ${API_BASE}/api/v1/wallets`}
            </pre>
          </div>
          <div style={{ padding: 16, background: "var(--bg-glass)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>MCP Server</div>
            <pre className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
              {`{
  "mcpServers": {
    "karen": {
      "command": "npx",
      "args": ["karen-mcp"]
    }
  }
}`}
            </pre>
          </div>
        </div>
      </div>

      {/* Keys List */}
      {keys.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Permissions</th>
                <th>Wallet</th>
                <th>Created</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{key.name}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      {key.permissions.map((p) => (
                        <span key={p} className="status-badge running" style={{ fontSize: 10 }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {key.walletId ? `${key.walletId.slice(0, 8)}...` : "—"}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
