# ⚡ Karen

**Autonomous Wallet Infrastructure for Solana AI Agents**

Karen is an open-source, OpenClaw-inspired agentic wallet runtime where AI agents autonomously manage Solana wallets, sign transactions, and interact with DeFi protocols. It also serves as **infrastructure** — any external AI agent can plug in via REST API or MCP.

## ✨ Features

| Feature                 | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| **Autonomous Agents**   | LLM-powered agents (OpenAI/Claude) that observe, think, act, and remember |
| **Secure Wallets**      | AES-256-GCM encrypted keystores with HD derivation for multi-agent        |
| **Token Launch**        | Create SPL tokens, mint supply, revoke authorities                        |
| **DeFi Integration**    | Jupiter swaps, native SOL staking, wSOL wrap/unwrap on devnet             |
| **Token Management**    | Burn tokens, close accounts (reclaim rent), freeze/thaw                   |
| **Security Guardrails** | Per-agent spending limits, rate limiting, program allowlists              |
| **REST API**            | External agents create wallets and trade via HTTP                         |
| **MCP Server**          | Any MCP-compatible agent (Claude, OpenClaw) gets instant wallet skills    |
| **Agent Skills**        | 17 pluggable skills — swap, transfer, stake, launch-token, burn, and more |
| **Agent Memory**        | Persistent context so agents learn from past decisions                    |
| **Dashboard**           | Premium Next.js UI for live monitoring                                    |
| **CLI**                 | Full control from the terminal                                            |

## 🏗️ Architecture

```
External Agents (OpenClaw, LangChain, etc.)
          │
    ┌─────┴─────┐
    │ MCP Server │──── REST API
    └─────┬─────┘
          │
    ┌─────┴──────────────┐
    │    Agent Runtime    │
    │ Observe→Think→Act  │
    │    (LLM-powered)   │
    └─────┬──────────────┘
          │
    ┌─────┴──────────────┐
    │   Core Engine       │
    │ Wallet Manager      │
    │ Transaction Engine  │
    │ Security Guardrails │
    └─────┬──────────────┘
          │
    Solana Devnet RPC
```

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 20
- OpenAI or Anthropic API key

### Setup

```bash
git clone https://github.com/yourusername/agentic-wallet.git
cd agentic-wallet
npm install

# Configure
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY or ANTHROPIC_API_KEY

# Build
npm run build
```

### Create & Fund a Wallet

```bash
npx tsx src/cli/index.ts wallet create --name "my-agent-wallet"
npx tsx src/cli/index.ts wallet airdrop --name "my-agent-wallet" --amount 2
npx tsx src/cli/index.ts wallet balance --name "my-agent-wallet"
```

### Create & Start an Agent

```bash
npx tsx src/cli/index.ts agent create \
  --name "DCA-Bot" \
  --strategy "Buy USDC with 0.5 SOL every cycle when balance > 1 SOL" \
  --llm openai

npx tsx src/cli/index.ts agent start --name "DCA-Bot"
```

### Start the API Server

```bash
npx tsx src/cli/index.ts server start
# API running at http://localhost:3001
```

### Launch the Dashboard

```bash
cd dashboard
npm install
npm run dev
# Dashboard at http://localhost:3000
```

### Use as MCP Server

Add to your Claude Desktop or OpenClaw config:

```json
{
  "mcpServers": {
    "karen": {
      "command": "npx",
      "args": ["tsx", "/path/to/agentic-wallet/src/mcp/server.ts"]
    }
  }
}
```

## 📁 Project Structure

```
agentic-wallet/
├── src/
│   ├── core/                 # Wallet, transactions, guardrails
│   │   ├── wallet/           # Wallet creation, HD derivation, keystore
│   │   ├── transaction/      # Transaction engine, guardrails
│   │   └── solana/           # RPC connection
│   ├── agent/                # LLM-powered agent runtime
│   │   ├── llm/              # OpenAI + Anthropic providers
│   │   ├── skills/           # Pluggable agent skills
│   │   └── memory/           # Persistent agent memory
│   ├── protocols/            # DeFi integration (Jupiter, SPL)
│   ├── api/                  # REST API server
│   ├── mcp/                  # MCP server
│   └── cli/                  # CLI interface
├── dashboard/                # Next.js monitoring dashboard
├── SKILLS.md                 # Agent skill reference
└── data/                     # Runtime data (keystores, logs, memory)
```

## 🔒 Security

- **Encrypted keystores**: Private keys encrypted with AES-256-GCM, derived via scrypt
- **HD derivation**: Each agent gets a deterministic wallet from a master seed (BIP-44)
- **Spending limits**: Max SOL per transaction, daily caps, rate limiting
- **Program allowlists**: Agents can only interact with approved Solana programs
- **Audit logging**: Every transaction and decision is logged

## 🤖 Supported LLMs

| Provider  | Models                                   |
| --------- | ---------------------------------------- |
| OpenAI    | gpt-4o, gpt-4o-mini, gpt-3.5-turbo       |
| Anthropic | claude-sonnet-4-20250514, claude-3-haiku |

## 🔌 External Integration

### REST API

```bash
# Create a wallet
curl -X POST http://localhost:3001/api/v1/wallets \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-wallet"}'

# Swap tokens
curl -X POST http://localhost:3001/api/v1/wallets/{id}/swap \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inputToken": "SOL", "outputToken": "USDC", "amount": 0.5}'
```

### MCP Tools

| Tool                       | Description                   |
| -------------------------- | ----------------------------- |
| `karen_create_wallet`    | Provision a new Solana wallet |
| `karen_balance`          | Check wallet balances         |
| `karen_swap`             | Swap tokens via Jupiter       |
| `karen_transfer`         | Send SOL or SPL tokens        |
| `karen_airdrop`          | Request devnet SOL            |
| `karen_tx_history`       | View transaction history      |
| `karen_launch_token`     | Create a new SPL token        |
| `karen_mint_supply`      | Mint additional tokens        |
| `karen_revoke_authority` | Revoke mint/freeze authority  |
| `karen_stake`            | Stake SOL to validator        |
| `karen_unstake`          | Deactivate stake account      |
| `karen_withdraw_stake`   | Withdraw deactivated stake    |
| `karen_list_stakes`      | List stake accounts           |
| `karen_burn`             | Burn SPL tokens               |
| `karen_close_account`    | Close empty token account     |
| `karen_wrap_sol`         | Wrap SOL to wSOL              |
| `karen_unwrap_sol`       | Unwrap wSOL to SOL            |

## 📄 License

MIT
