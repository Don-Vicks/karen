# Karen Agent Skills Reference

This document serves two purposes:

1. **Internal agents**: The LLM reads this to understand what actions it can take
2. **External agents**: Any AI agent integrating via MCP or API can reference this

---

## Overview

Karen agents have access to the following skills. Each skill is a self-contained action that interacts with Solana. Agents invoke skills via structured tool/function calls.

**Rules:**

1. Invoke ONE skill per cycle
2. Always include reasoning for your decision
3. Check your balance before making swaps or transfers
4. Respect spending limits — exceeding them will block the transaction
5. If unsure, use `wait` — it's better to skip than make a bad trade

---

## Skills

### check_balance

Check your current wallet balances including SOL and all SPL tokens.

**Parameters:** None

**Returns:** SOL balance and all SPL token holdings

**Example:**

```json
{ "skill": "check_balance", "params": {} }
```

---

### swap

Execute a token swap via Jupiter DEX.

**Parameters:**

| Param       | Type   | Required | Description                                          |
| ----------- | ------ | -------- | ---------------------------------------------------- |
| inputToken  | string | ✅       | Token to sell (e.g., "SOL", "USDC", or mint address) |
| outputToken | string | ✅       | Token to buy                                         |
| amount      | number | ✅       | Amount of input token to swap                        |
| slippageBps | number | ❌       | Max slippage in basis points (default: 50 = 0.5%)    |

**Constraints:**

- Subject to per-transaction spending limit
- Only tokens with devnet liquidity
- Min swap: 0.01 SOL equivalent

**Example:**

```json
{
  "skill": "swap",
  "params": { "inputToken": "SOL", "outputToken": "USDC", "amount": 0.5 }
}
```

---

### transfer

Send SOL to another wallet address.

**Parameters:**

| Param  | Type   | Required | Description                       |
| ------ | ------ | -------- | --------------------------------- |
| to     | string | ✅       | Recipient wallet address (base58) |
| amount | number | ✅       | Amount of SOL to send             |

**Constraints:**

- Subject to spending limits and daily caps
- Recipient must be a valid Solana address
- Cannot transfer to blocked addresses

**Example:**

```json
{ "skill": "transfer", "params": { "to": "7xK...abc", "amount": 0.5 } }
```

---

### airdrop

Request devnet SOL from the faucet.

**Parameters:**

| Param  | Type   | Required | Description                     |
| ------ | ------ | -------- | ------------------------------- |
| amount | number | ✅       | SOL to request (max 2 per call) |

**Example:**

```json
{ "skill": "airdrop", "params": { "amount": 2 } }
```

---

### token_info

Look up information about a token.

**Parameters:**

| Param  | Type   | Required | Description                                 |
| ------ | ------ | -------- | ------------------------------------------- |
| symbol | string | ✅       | Token symbol (e.g., "USDC") or mint address |

**Returns:** Mint address, decimals, supply, initialization status

**Example:**

```json
{ "skill": "token_info", "params": { "symbol": "USDC" } }
```

---

### wait

Do nothing this cycle.

**Parameters:**

| Param  | Type   | Required | Description           |
| ------ | ------ | -------- | --------------------- |
| reason | string | ✅       | Why you chose to wait |

**Example:**

```json
{
  "skill": "wait",
  "params": { "reason": "Balance too low for any meaningful action" }
}
```

---

## DeFi Skills

### launch_token

Create a new SPL token on Solana with initial supply minted to your wallet.

**Parameters:**

| Param         | Type   | Required | Description                         |
| ------------- | ------ | -------- | ----------------------------------- |
| name          | string | ✅       | Token name                          |
| symbol        | string | ✅       | Token ticker symbol                 |
| decimals      | number | ❌       | Decimal places (default: 9)         |
| initialSupply | number | ❌       | Initial supply (default: 1,000,000) |

**Example:**

```json
{
  "skill": "launch_token",
  "params": { "name": "Agent Coin", "symbol": "AGT", "initialSupply": 1000000 }
}
```

---

### mint_supply

Mint additional tokens for a token you created (must be mint authority).

**Parameters:**

| Param    | Type   | Required | Description                 |
| -------- | ------ | -------- | --------------------------- |
| mint     | string | ✅       | Token mint address          |
| amount   | number | ✅       | Amount to mint              |
| decimals | number | ❌       | Token decimals (default: 9) |

**Example:**

```json
{ "skill": "mint_supply", "params": { "mint": "7xK...abc", "amount": 500000 } }
```

---

### revoke_mint_authority

Permanently revoke minting capability. **IRREVERSIBLE.**

**Parameters:**

| Param | Type   | Required | Description        |
| ----- | ------ | -------- | ------------------ |
| mint  | string | ✅       | Token mint address |

**Example:**

```json
{ "skill": "revoke_mint_authority", "params": { "mint": "7xK...abc" } }
```

---

### stake_sol

Stake SOL by delegating to a Solana validator.

**Parameters:**

| Param     | Type   | Required | Description                                            |
| --------- | ------ | -------- | ------------------------------------------------------ |
| amount    | number | ✅       | SOL to stake                                           |
| validator | string | ❌       | Validator vote account (uses default devnet validator) |

**Example:**

```json
{ "skill": "stake_sol", "params": { "amount": 1.0 } }
```

---

### unstake_sol

Deactivate a stake account. Withdrawal available after 1 epoch.

**Parameters:**

| Param        | Type   | Required | Description              |
| ------------ | ------ | -------- | ------------------------ |
| stakeAccount | string | ✅       | Stake account public key |

**Example:**

```json
{ "skill": "unstake_sol", "params": { "stakeAccount": "5xZ...def" } }
```

---

### withdraw_stake

Withdraw SOL from a fully deactivated stake account.

**Parameters:**

| Param        | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| stakeAccount | string | ✅       | Deactivated stake account public key |

---

### list_stakes

List all your stake accounts with status and balances.

**Parameters:** None

---

### burn_tokens

Burn (destroy) SPL tokens from your wallet.

**Parameters:**

| Param  | Type   | Required | Description        |
| ------ | ------ | -------- | ------------------ |
| mint   | string | ✅       | Token mint address |
| amount | number | ✅       | Amount to burn     |

**Example:**

```json
{ "skill": "burn_tokens", "params": { "mint": "7xK...abc", "amount": 100 } }
```

---

### close_token_account

Close an empty token account to reclaim rent SOL.

**Parameters:**

| Param | Type   | Required | Description                        |
| ----- | ------ | -------- | ---------------------------------- |
| mint  | string | ✅       | Token mint of the account to close |

---

### wrap_sol

Convert SOL to Wrapped SOL (wSOL) for DeFi interactions.

**Parameters:**

| Param  | Type   | Required | Description |
| ------ | ------ | -------- | ----------- |
| amount | number | ✅       | SOL to wrap |

**Example:**

```json
{ "skill": "wrap_sol", "params": { "amount": 1.0 } }
```

---

### unwrap_sol

Convert all wSOL back to native SOL.

**Parameters:** None

---

## External Agent Integration

### MCP Server

Add Karen to your MCP config:

```json
{
  "mcpServers": {
    "karen": {
      "command": "npx",
      "args": ["tsx", "path/to/agentic-wallet/src/mcp/server.ts"]
    }
  }
}
```

**Available MCP Tools:**

| Tool                       | Description                  |
| -------------------------- | ---------------------------- |
| `karen_create_wallet`    | Create a new managed wallet  |
| `karen_balance`          | Check wallet balances        |
| `karen_list_wallets`     | List all managed wallets     |
| `karen_airdrop`          | Request devnet SOL           |
| `karen_transfer`         | Send SOL to another address  |
| `karen_swap`             | Swap tokens via Jupiter      |
| `karen_tx_history`       | View transaction history     |
| `karen_launch_token`     | Create a new SPL token       |
| `karen_mint_supply`      | Mint additional tokens       |
| `karen_revoke_authority` | Revoke mint/freeze authority |
| `karen_stake`            | Stake SOL to validator       |
| `karen_unstake`          | Deactivate stake account     |
| `karen_withdraw_stake`   | Withdraw deactivated stake   |
| `karen_list_stakes`      | List stake accounts          |
| `karen_burn`             | Burn SPL tokens              |
| `karen_close_account`    | Close empty token account    |
| `karen_wrap_sol`         | Wrap SOL to wSOL             |
| `karen_unwrap_sol`       | Unwrap wSOL to SOL           |

### REST API

Base URL: `http://localhost:3001`

**Authentication:** Include `Authorization: Bearer YOUR_API_KEY` header.

**Endpoints:**

| Method | Path                                   | Description             |
| ------ | -------------------------------------- | ----------------------- |
| GET    | `/api/v1/health`                       | System health check     |
| POST   | `/api/v1/wallets`                      | Create a wallet         |
| GET    | `/api/v1/wallets`                      | List all wallets        |
| GET    | `/api/v1/wallets/:id/balance`          | Get wallet balances     |
| POST   | `/api/v1/wallets/:id/transfer`         | Send SOL                |
| POST   | `/api/v1/wallets/:id/swap`             | Swap tokens             |
| POST   | `/api/v1/wallets/:id/airdrop`          | Request airdrop         |
| GET    | `/api/v1/wallets/:id/transactions`     | Transaction history     |
| POST   | `/api/v1/wallets/:id/launch-token`     | Create a new token      |
| POST   | `/api/v1/wallets/:id/mint-supply`      | Mint additional tokens  |
| POST   | `/api/v1/wallets/:id/revoke-authority` | Revoke authority        |
| POST   | `/api/v1/wallets/:id/stake`            | Stake SOL               |
| POST   | `/api/v1/wallets/:id/unstake`          | Unstake SOL             |
| POST   | `/api/v1/wallets/:id/withdraw-stake`   | Withdraw stake          |
| GET    | `/api/v1/wallets/:id/stakes`           | List stake accounts     |
| POST   | `/api/v1/wallets/:id/burn`             | Burn tokens             |
| POST   | `/api/v1/wallets/:id/close-account`    | Close token account     |
| POST   | `/api/v1/wallets/:id/wrap-sol`         | Wrap SOL to wSOL        |
| POST   | `/api/v1/wallets/:id/unwrap-sol`       | Unwrap wSOL to SOL      |
| GET    | `/api/v1/agents`                       | List all agents         |
| POST   | `/api/v1/agents/:id/chat`              | Chat with an agent      |
| GET    | `/api/v1/transactions`                 | Global transaction feed |

---

## Security Guardrails

All transactions pass through guardrails before execution:

| Guardrail                  | Default                | Description                        |
| -------------------------- | ---------------------- | ---------------------------------- |
| `maxSolPerTransaction`     | 2 SOL                  | Maximum SOL per single transaction |
| `maxTransactionsPerMinute` | 5                      | Rate limiting                      |
| `dailySpendingLimitSol`    | 10 SOL                 | Total daily spending cap           |
| `allowedPrograms`          | System, Token, Jupiter | Only whitelisted programs          |

Blocked transactions are logged with reason and `blocked` status.
