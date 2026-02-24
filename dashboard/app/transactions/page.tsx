"use client";

import { useEffect, useState } from "react";

interface Transaction {
  id: string;
  walletId: string;
  agentId?: string;
  type: string;
  status: string;
  signature?: string;
  details: Record<string, unknown>;
  guardrailsApplied: string[];
  timestamp: string;
  error?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "solclaw-dev-secret";

async function apiFetch(path: string) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const data = await apiFetch("/api/v1/transactions?limit=50");
    if (data) setTransactions(data.transactions || []);
    setLoading(false);
  }

  const typeIcon: Record<string, string> = {
    swap: "🔄",
    transfer: "➡️",
    airdrop: "🪂",
    token_transfer: "🪙",
    other: "📦",
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="icon">📋</div>
        <p>Loading transactions...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="section-title">Transactions</h1>
        <p className="section-subtitle">
          Live transaction feed across all agents and wallets — refreshes every 3 seconds
        </p>
      </div>

      {transactions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📋</div>
            <p>No transactions recorded yet. Agents will create transactions when they run.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Wallet</th>
                <th>Details</th>
                <th>Guardrails</th>
                <th>Signature</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{typeIcon[tx.type] || "📦"}</span>
                    {tx.type.replace("_", " ")}
                  </td>
                  <td>
                    <span className={`status-badge ${tx.status}`}>{tx.status}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {tx.walletId.slice(0, 8)}...
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    {Boolean(tx.details.amount) && (
                      <span style={{ fontWeight: 500 }}>
                        {String(tx.details.amount)} {tx.details.token ? String(tx.details.token) : "SOL"}
                      </span>
                    )}
                    {Boolean(tx.details.inputToken) && (
                      <span style={{ fontWeight: 500 }}>
                        {String(tx.details.inputAmount || tx.details.amount)} {String(tx.details.inputToken)} → {String(tx.details.outputToken)}
                      </span>
                    )}
                    {Boolean(tx.details.to) && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        → {String(tx.details.to).slice(0, 12)}...
                      </div>
                    )}
                    {tx.error && (
                      <div style={{ fontSize: 11, color: "var(--status-error)", marginTop: 2 }}>
                        {tx.error.slice(0, 50)}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {tx.guardrailsApplied.map((g, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            background: "var(--bg-glass)",
                            borderRadius: 4,
                            color: "var(--text-muted)",
                          }}
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {tx.signature ? (
                      <a
                        href={`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono"
                        style={{ color: "var(--accent-primary)", fontSize: 12, textDecoration: "none" }}
                      >
                        {tx.signature.slice(0, 12)}... ↗
                      </a>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {new Date(tx.timestamp).toLocaleTimeString()}
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
