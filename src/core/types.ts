// ============================================
// Wallet Types
// ============================================

export interface WalletInfo {
  id: string
  name: string
  publicKey: string
  createdAt: string
  derivationIndex?: number
  tags: string[]
}

export interface WalletBalance {
  sol: number
  tokens: TokenBalance[]
}

export interface TokenBalance {
  mint: string
  symbol?: string
  balance: number
  decimals: number
  uiBalance: number
}

export interface EncryptedKeystore {
  version: 1
  id: string
  address: string
  crypto: {
    cipher: 'aes-256-gcm'
    ciphertext: string
    cipherparams: {
      iv: string
      tag: string
    }
    kdf: 'scrypt'
    kdfparams: {
      n: number
      r: number
      p: number
      dklen: number
      salt: string
    }
  }
  metadata: {
    name: string
    createdAt: string
    derivationIndex?: number
    tags: string[]
  }
}

// ============================================
// Transaction Types
// ============================================

export interface TransactionRecord {
  id: string
  walletId: string
  agentId?: string
  type: TransactionType
  status: TransactionStatus
  signature?: string
  details: TransactionDetails
  guardrailsApplied: string[]
  timestamp: string
  error?: string
}

export type TransactionType =
  | 'transfer'
  | 'swap'
  | 'airdrop'
  | 'token_transfer'
  | 'token_launch'
  | 'mint_supply'
  | 'revoke_authority'
  | 'stake'
  | 'unstake'
  | 'withdraw_stake'
  | 'burn'
  | 'close_account'
  | 'wrap_sol'
  | 'unwrap_sol'
  | 'freeze'
  | 'thaw'
  | 'other'
export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'blocked'

export interface TransactionDetails {
  from?: string
  to?: string
  amount?: number
  token?: string
  inputToken?: string
  outputToken?: string
  inputAmount?: number
  outputAmount?: number
  slippageBps?: number
  [key: string]: unknown
}

// ============================================
// Guardrail Types
// ============================================

export interface GuardrailConfig {
  maxSolPerTransaction: number
  maxTransactionsPerMinute: number
  dailySpendingLimitSol: number
  allowedPrograms: string[]
  blockedAddresses: string[]
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxSolPerTransaction: 2.0,
  maxTransactionsPerMinute: 5,
  dailySpendingLimitSol: 10.0,
  allowedPrograms: [
    '11111111111111111111111111111111', // System Program
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
    'Stake11111111111111111111111111111111111111', // Stake Program
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Token Metadata Program
  ],
  blockedAddresses: [],
}

// ============================================
// Agent Types
// ============================================

export interface AgentConfig {
  id: string
  name: string
  walletId: string
  llmProvider: 'openai' | 'anthropic'
  llmModel: string
  strategy: string
  guardrails: GuardrailConfig
  loopIntervalMs: number
  status: AgentStatus
  createdAt: string
}

export type AgentStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error'

export interface AgentDecision {
  agentId: string
  cycle: number
  observations: Record<string, unknown>
  reasoning: string
  action: SkillInvocation | null
  outcome?: string
  timestamp: string
}

export interface SkillInvocation {
  skill: string
  params: Record<string, unknown>
}

// ============================================
// API Types
// ============================================

export interface ApiKeyRecord {
  id: string
  key: string
  name: string
  walletId: string
  permissions: string[]
  rateLimit: number
  spendingLimitSol: number
  createdAt: string
  lastUsedAt?: string
}

// ============================================
// Event Types
// ============================================

export type KarenEvent =
  | { type: 'wallet:created'; data: WalletInfo }
  | { type: 'transaction:sent'; data: TransactionRecord }
  | { type: 'transaction:confirmed'; data: TransactionRecord }
  | { type: 'transaction:failed'; data: TransactionRecord }
  | { type: 'transaction:blocked'; data: TransactionRecord }
  | { type: 'agent:started'; data: { agentId: string } }
  | { type: 'agent:stopped'; data: { agentId: string } }
  | { type: 'agent:decision'; data: AgentDecision }
  | { type: 'agent:error'; data: { agentId: string; error: string } }
