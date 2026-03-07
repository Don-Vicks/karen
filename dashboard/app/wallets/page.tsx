"use client";

import { useEffect, useState } from "react";

interface Wallet {
  id: string;
  name: string;
  publicKey: string;
  createdAt: string;
  tags: string[];
}

interface Balance {
  sol: number;
  tokens: { mint: string; uiBalance: number; decimals: number }[];
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

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [loading, setLoading] = useState(true);

  // New Wallet Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWalletName, setNewWalletName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Airdrop State
  const [airdropStatus, setAirdropStatus] = useState<Record<string, "loading" | "success" | "error">>({});

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const data = await apiFetch("/api/v1/wallets");
    if (data?.wallets) {
      setWallets(data.wallets);
      // Fetch balances for each wallet
      const balMap: Record<string, Balance> = {};
      await Promise.all(
        data.wallets.map(async (w: Wallet) => {
          const bal = await apiFetch(`/api/v1/wallets/${w.id}/balance`);
          if (bal) balMap[w.id] = bal;
        })
      );
      setBalances(balMap);
    }
    setLoading(false);
  }

  async function handleCreateWallet() {
    if (!newWalletName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/v1/wallets", {
        method: "POST",
        body: JSON.stringify({ name: newWalletName }),
      });
      if (res && res.wallet) {
        setWallets((prev) => [...prev, res.wallet]);
        setIsCreateModalOpen(false);
        setNewWalletName("");
        loadData(); // refresh balances
      }
    } catch {
      alert("Failed to create wallet");
    }
    setIsCreating(false);
  }

  async function handleAirdrop(walletId: string) {
    setAirdropStatus((prev) => ({ ...prev, [walletId]: "loading" }));
    try {
      const res = await apiFetch(`/api/v1/wallets/${walletId}/airdrop`, { method: "POST" });
      if (res && res.signature) {
        setAirdropStatus((prev) => ({ ...prev, [walletId]: "success" }));
        setTimeout(() => setAirdropStatus((prev) => ({ ...prev, [walletId]: undefined as any })), 3000);
        loadData(); // refresh balances
      } else {
        setAirdropStatus((prev) => ({ ...prev, [walletId]: "error" }));
      }
    } catch {
      setAirdropStatus((prev) => ({ ...prev, [walletId]: "error" }));
    }
  }

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address);
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="icon">💰</div>
        <p>Loading wallets...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="section-title">Wallets</h1>
          <p className="section-subtitle">
            All managed wallets — internal agents and external API consumers
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          + Create Wallet
        </button>
      </div>

      {wallets.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">💰</div>
            <p>
              No wallets yet. Create one with the CLI:
              <br />
              <code className="mono" style={{ color: "var(--accent-primary)", marginTop: 8, display: "block" }}>
                karen wallet create --name &quot;my-wallet&quot;
              </code>
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
          {wallets.map((w) => {
            const bal = balances[w.id];
            return (
              <div key={w.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{w.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {w.id.slice(0, 8)}...
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {w.tags.map((tag) => (
                      <span key={tag} className={`status-badge ${tag === "agent" ? "running" : "idle"}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Address */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "var(--bg-glass)",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: 16,
                    cursor: "pointer",
                  }}
                  onClick={() => copyAddress(w.publicKey)}
                  title="Click to copy"
                >
                  <span className="mono" style={{ flex: 1, color: "var(--text-secondary)", fontSize: 12 }}>
                    {w.publicKey.slice(0, 16)}...{w.publicKey.slice(-8)}
                  </span>
                  <span style={{ fontSize: 14 }}>📋</span>
                </div>

                {/* Balance */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>SOL Balance</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: 24, fontWeight: 700 }}>
                        {bal ? bal.sol.toFixed(4) : "—"}
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "4px 8px", fontSize: "11px" }}
                        onClick={() => handleAirdrop(w.id)}
                        disabled={airdropStatus[w.id] === "loading"}
                      >
                        {airdropStatus[w.id] === "loading" ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1 }} /> : "Airdrop 🪂"}
                      </button>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Tokens</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-secondary)" }}>
                      {bal?.tokens.length ?? 0}
                    </div>
                  </div>
                </div>

                {/* Token list */}
                {bal && bal.tokens.length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                    {bal.tokens.map((t, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {t.mint.slice(0, 8)}...
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{t.uiBalance.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Explorer Link */}
                <a
                  href={`https://explorer.solana.com/address/${w.publicKey}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    textAlign: "center",
                    marginTop: 16,
                    padding: "8px",
                    background: "var(--bg-glass)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--accent-primary)",
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  View on Solana Explorer ↗
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Wallet Modal */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Wallet</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Provision a new secure Turnkey wallet enclave.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Wallet Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. trading-bot-primary"
                value={newWalletName}
                onChange={(e) => setNewWalletName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newWalletName.trim()) {
                    handleCreateWallet();
                  }
                }}
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
                onClick={handleCreateWallet}
                disabled={!newWalletName.trim() || isCreating}
              >
                {isCreating ? <span className="spinner"></span> : "Provision Wallet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
