# ⚡ Karen: Autonomous Agentic Wallet Infrastructure for Solana

[![Solana](https://img.shields.io/badge/Solana-Devnet-green?style=flat-square)](https://solana.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.style=flat-square)](LICENSE)

**Karen** is an open-source, OpenClaw-inspired agentic wallet runtime built specifically for AI agents on Solana. It solves the critical bottleneck of AI autonomy: giving agents secure, non-custodial wallets that they fully control to hold funds, execute trades, and interact with dApps without human intervention.

It is built specifically for the **Solana AI Agent Wallet Bounty**, demonstrating a production-grade prototype of autonomous transaction capabilities in a secure, sandboxed devnet environment.

---

## 🎯 Bounty Requirements Complete

This functional prototype fulfills all bounty requirements:

- ✅ **Programmatic Wallet Creation**: Dynamically provisions Solana Keypairs inside isolated **Turnkey Secure Enclaves**.
- ✅ **Automatic Transaction Signing**: Non-custodial, payload-driven transaction signing (`executeTransaction` flow) without any manual user approval.
- ✅ **Hold SOL & SPL Tokens**: Agents fully control their balances, wrap/unwrap SOL, and reclaim rent.
- ✅ **dApp Interaction**: Natively integrated with Devnet Staking (delegating to validators) and SPL Token Launching.
- ✅ **Skill Discovery**: Pluggable agent architecture with an exposed [`SKILLS.md`](./SKILLS.md) for agents to read.
- ✅ **Clear Separation**: The LLM reasoning (Observation & Thinking) is completely decoupled from the Wallet Engine (Transaction Execution & Guardrails).

---

## 🏗️ Deep Dive: Architecture & Security

### Secure Key Management (Turnkey)

Traditional bots store private keys in `.env` files. Karen utilizes **Turnkey** to provision unexportable, non-custodial secure enclaves for each AI agent.
When an agent decides to swap tokens, the backend sends a serialized payload to the Turnkey enclave, which signs the message cryptographically and returns the signature. The server **never** sees the underlying private key, enabling scalable infrastructure where 1000s of agents can safely hold capital.

### Autonomous Decision Execution

Karen features a built-in agent simulation loop: `Observe → Think → Act → Remember`.

1. **Observe**: The agent reads its wallet balance and parses its prior 5 transaction receipts.
2. **Think**: Instructed by a user-defined prompt (e.g., "DCA 1 SOL into USDC every cycle"), the LLM determines the optimal skill to invoke.
3. **Act**: The agent passes structured JSON tools (`stake_sol`, `swap`) to the `TransactionEngine`.
4. **Remember**: All actions and internal reasonings are written to a persistent `MemoryStore`, creating a continuous context window that survives server restarts.

### Security Guardrails

To prevent AI hallucinations from draining funds, all programmatic transactions must pass through the rigid `TransactionEngine` guardrails before signing:

- **Max SOL Limits**: Agents are hard-capped per transaction and per day.
- **Rate Limiting**: Prevent agents from spamming RPC nodes.
- **Program Allowlists**: Only trusted, whitelisted Devnet programs are allowed to interact with the agent's signer.

---

## 🛠️ What You Can Build

Karen functions as **headless infrastructure**.

- **Autonomous Background Workers**: Run the built-in CLI loop to simulate a DCA trading bot, a liquidity provider, or an automated staking delegator.
- **Multi-Agent Harness**: The core engine supports 1-to-N agents, where every newly spawned agent gets its own sandboxed Turnkey wallet and independent spending limit.
- **External API & MCP Client**: Connect your local LangChain apps or OpenClaw assistants instantly via the Model Context Protocol (MCP) or standard HTTP REST APIs.

---

## 🚀 Quick Start (Devnet)

### Prerequisites

- Node.js ≥ 20
- OpenAI, Anthropic, Gemini, or xAI API key
- Turnkey API Credentials (for secure enclaves)

### 1. Setup

```bash
git clone https://github.com/yourusername/agentic-wallet.git
cd agentic-wallet
npm install

# Build the project
npm run build
```

### 2. Interactive Onboarding & Environment

Use the built-in interactive wizard to setup your API keys and Turnkey credentials.

```bash
npx tsx src/cli/index.ts onboard
```

### 3. Deploy an Autonomous Agent

Create a new agent, specify its LLM engine, and give it an autonomous strategy:

```bash
npx tsx src/cli/index.ts agent create \
  --name "Devnet-Staker" \
  --strategy "Every cycle, if you have > 2 SOL, stake 1 SOL to a devnet validator." \
  --llm openai
```

### 4. Start the Agent Loop

Watch your agent autonomously fund itself via airdrops, sign transactions, and interact with the blockchain in real-time:

```bash
npx tsx src/cli/index.ts agent start --name "Devnet-Staker"
```

---

## 🖥️ Live Observation Dashboard

Karen includes an optional, premium Front-end Next.js dashboard to monitor all agent decision-making, chat with active agents, and view chronological transaction logs.

```bash
# Start the Backend Server
npx tsx src/cli/index.ts server start

# Open the UI in a new terminal
cd dashboard
npm install
npm run dev
# Dashboard at http://localhost:3000
```

## 📁 Project Structure

```text
agentic-wallet/
├── src/
│   ├── core/                 # Secure Wallet Enclaves, Guardrails, Transaction Routing
│   ├── agent/                # LLM Run_Loop (Think->Act), MemoryStore, Tool/Skill definitions
│   ├── protocols/            # DeFi integrations (Staking, Token Launch, Jupiter)
│   ├── api/                  # REST API for external AI harnesses
│   ├── mcp/                  # MCP server for local Claude/OpenClaw clients
│   └── cli/                  # Interactive terminal interface
├── dashboard/                # Next.js interactive Control Panel
├── SKILLS.md                 # Agent readable tool definitions
└── data/                     # Persistent JSON Memory and Audit Logs
```

## 📄 License

MIT
