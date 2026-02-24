"use client";

import { useEffect, useState } from "react";

interface HealthData {
  solana: { healthy: boolean; slot: number; network: string };
  agents: { totalAgents: number; runningAgents: number; stoppedAgents: number; idleAgents: number };
}

interface Transaction {
  id: string;
  walletId: string;
  agentId?: string;
  type: string;
  status: string;
  signature?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

interface Wallet {
  id: string;
  name: string;
  publicKey: string;
  tags: string[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "solclaw-dev-secret";

async function apiFetch(path: string) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const [h, t, w] = await Promise.all([
        apiFetch("/api/v1/health"),
        apiFetch("/api/v1/transactions?limit=10"),
        apiFetch("/api/v1/wallets"),
      ]);
      if (h) setHealth(h);
      if (t) setTransactions(t.transactions || []);
      if (w) setWallets(w.wallets || []);
      setLoading(false);
    }
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const txTypeIcon: Record<string, string> = {
    swap: "🔄",
    transfer: "➡️",
    airdrop: "🪂",
    token_transfer: "🪙",
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="icon">⚡</div>
        <p>Loading SolClaw dashboard...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="section-title">Overview</h1>
        <p className="section-subtitle">
          Real-time monitoring of your autonomous wallet infrastructure
        </p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Agents</div>
          <div className="stat-value">{health?.agents.totalAgents ?? 0}</div>
          <div className="stat-change" style={{ color: "var(--status-success)" }}>
            {health?.agents.runningAgents ?? 0} running
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Wallets</div>
          <div className="stat-value">{wallets.length}</div>
          <div className="stat-change" style={{ color: "var(--text-muted)" }}>
            {wallets.filter(w => w.tags.includes("agent")).length} agent wallets
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{transactions.length}</div>
          <div className="stat-change" style={{ color: "var(--text-muted)" }}>
            Last {transactions.length} shown
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Network</div>
          <div className="stat-value success" style={{ fontSize: "20px" }}>
            {health?.solana.healthy ? "✓ Connected" : "✗ Offline"}
          </div>
          <div className="stat-change" style={{ color: "var(--text-muted)" }}>
            Slot: {health?.solana.slot?.toLocaleString() ?? "—"}
          </div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid-2">
        {/* Recent Activity */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Recent Activity</div>
              <div className="card-subtitle">Latest transactions across all agents</div>
            </div>
          </div>

          {transactions.length === 0 ? (
            <div className="empty-state" style={{ padding: "30px" }}>
              <p>No transactions yet. Start an agent or use the CLI to create one.</p>
            </div>
          ) : (
            transactions.slice(0, 8).map((tx) => (
              <div key={tx.id} className="activity-item">
                <div className={`activity-icon ${tx.type}`}>
                  {txTypeIcon[tx.type] || "📦"}
                </div>
                <div className="activity-details">
                  <div className="activity-title">
                    {tx.type.charAt(0).toUpperCase() + tx.type.slice(1).replace("_", " ")}
                    <span className={`status-badge ${tx.status}`} style={{ marginLeft: 8 }}>
                      {tx.status}
                    </span>
                  </div>
                  <div className="activity-meta">
                    {tx.signature
                      ? `${tx.signature.slice(0, 16)}...`
                      : tx.walletId.slice(0, 12) + "..."}
                    {" · "}
                    {new Date(tx.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Wallets Overview */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Wallets</div>
              <div className="card-subtitle">All managed wallets</div>
            </div>
          </div>

          {wallets.length === 0 ? (
            <div className="empty-state" style={{ padding: "30px" }}>
              <p>No wallets created yet. Use the CLI to create a wallet.</p>
            </div>
          ) : (
            wallets.slice(0, 6).map((w) => (
              <div key={w.id} className="activity-item">
                <div className="activity-icon" style={{ background: "rgba(99, 102, 241, 0.15)" }}>
                  💰
                </div>
                <div className="activity-details">
                  <div className="activity-title">{w.name}</div>
                  <div className="activity-meta">
                    <span className="address">{w.publicKey.slice(0, 8)}...{w.publicKey.slice(-4)}</span>
                    {" · "}
                    {w.tags.join(", ") || "no tags"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
