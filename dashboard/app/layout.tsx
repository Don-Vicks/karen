import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolClaw Dashboard — Autonomous Wallet Infrastructure",
  description: "Monitor and manage AI agents with autonomous Solana wallets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-logo">
              <div className="logo-icon">⚡</div>
              <div>
                <h1>SolClaw</h1>
                <span className="version">v0.1.0</span>
              </div>
            </div>

            <nav className="sidebar-nav">
              <Link href="/" className="nav-link">
                <span className="icon">🏠</span>
                Overview
              </Link>
              <Link href="/agents" className="nav-link">
                <span className="icon">🤖</span>
                Agents
              </Link>
              <Link href="/wallets" className="nav-link">
                <span className="icon">💰</span>
                Wallets
              </Link>
              <Link href="/transactions" className="nav-link">
                <span className="icon">📋</span>
                Transactions
              </Link>
              <Link href="/api-keys" className="nav-link">
                <span className="icon">🔑</span>
                API Keys
              </Link>
            </nav>

            <div className="sidebar-footer">
              <div className="network-badge">
                <span className="dot"></span>
                Solana Devnet
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
