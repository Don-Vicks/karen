import { TransactionEngine } from '../../core/transaction/transaction-engine'
import { WalletManager } from '../../core/wallet/wallet-manager'
import { JupiterAdapter } from '../../protocols/jupiter'
import { SplTokenAdapter } from '../../protocols/spl-token'
import { StakingAdapter } from '../../protocols/staking'
import { TokenLauncherAdapter } from '../../protocols/token-launcher'
import { WrappedSolAdapter } from '../../protocols/wrapped-sol'
import { LLMToolDefinition } from '../llm/provider'

// ============================================
// Agent Skill System
// ============================================
// Each skill is a self-contained capability the LLM can invoke

export interface SkillContext {
  walletId: string
  agentId: string
  walletManager: WalletManager
  transactionEngine: TransactionEngine
  jupiter: JupiterAdapter
  splToken: SplTokenAdapter
  tokenLauncher: TokenLauncherAdapter
  staking: StakingAdapter
  wrappedSol: WrappedSolAdapter
}

export interface Skill {
  name: string
  description: string
  parameters: Record<string, any>
  execute(
    params: Record<string, unknown>,
    context: SkillContext,
  ): Promise<string>
}

// ============================================
// Skill Registry
// ============================================

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values())
  }

  /**
   * Get all skills as LLM tool definitions
   */
  getToolDefinitions(): LLMToolDefinition[] {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    }))
  }

  /**
   * Execute a skill by name
   */
  async execute(
    skillName: string,
    params: Record<string, unknown>,
    context: SkillContext,
  ): Promise<string> {
    const skill = this.skills.get(skillName)
    if (!skill) {
      return `Error: Unknown skill "${skillName}". Available skills: ${this.getAll()
        .map((s) => s.name)
        .join(', ')}`
    }

    try {
      return await skill.execute(params, context)
    } catch (error: any) {
      return `Error executing skill "${skillName}": ${error.message}`
    }
  }
}

// ============================================
// Built-in Skills
// ============================================

export const balanceSkill: Skill = {
  name: 'check_balance',
  description:
    'Check your current wallet balances including SOL and all SPL tokens',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_params, context) {
    const balances = await context.walletManager.getBalances(context.walletId)
    const wallet = context.walletManager.getWallet(context.walletId)

    let result = `Wallet: ${wallet?.name} (${wallet?.publicKey})\n`
    result += `SOL: ${balances.sol.toFixed(4)} SOL\n`

    if (balances.tokens.length > 0) {
      result += `\nTokens:\n`
      for (const t of balances.tokens) {
        result += `  ${t.mint}: ${t.uiBalance} (${t.decimals} decimals)\n`
      }
    } else {
      result += `No SPL token holdings.`
    }

    return result
  },
}

export const swapSkill: Skill = {
  name: 'swap',
  description:
    'Swap one token for another using Jupiter DEX. Example: swap SOL for USDC.',
  parameters: {
    type: 'object',
    properties: {
      inputToken: {
        type: 'string',
        description: 'Token to sell (e.g., "SOL", "USDC", or a mint address)',
      },
      outputToken: {
        type: 'string',
        description: 'Token to buy (e.g., "SOL", "USDC", or a mint address)',
      },
      amount: {
        type: 'number',
        description: 'Amount of input token to swap',
      },
      slippageBps: {
        type: 'number',
        description: 'Maximum slippage in basis points (default: 50 = 0.5%)',
      },
    },
    required: ['inputToken', 'outputToken', 'amount'],
  },
  async execute(params, context) {
    const inputToken = String(params.inputToken)
    const outputToken = String(params.outputToken)
    const amount = Number(params.amount)
    const slippageBps = Number(params.slippageBps || 50)

    // First get a quote
    const quote = await context.jupiter.getQuote(
      inputToken,
      outputToken,
      amount,
      slippageBps,
    )

    // Build a swap transaction record through the transaction engine
    const result = await context.jupiter.executeSwap(
      context.walletManager,
      context.walletId,
      inputToken,
      outputToken,
      amount,
      slippageBps,
    )

    return (
      `Swap executed successfully!\n` +
      `Sold: ${result.inputAmount} ${inputToken}\n` +
      `Received: ~${result.expectedOutputAmount.toFixed(4)} ${outputToken}\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const transferSkill: Skill = {
  name: 'transfer',
  description: 'Send SOL to another wallet address',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient wallet address (base58)',
      },
      amount: {
        type: 'number',
        description: 'Amount of SOL to send',
      },
    },
    required: ['to', 'amount'],
  },
  async execute(params, context) {
    const to = String(params.to)
    const amount = Number(params.amount)

    const record = await context.transactionEngine.transferSol(
      context.walletId,
      to,
      amount,
      context.agentId,
    )

    if (record.status === 'blocked') {
      return `Transfer blocked by guardrails: ${record.error}`
    }
    if (record.status === 'failed') {
      return `Transfer failed: ${record.error}`
    }

    return `Successfully sent ${amount} SOL to ${to}\nTransaction: ${record.signature}`
  },
}

export const airdropSkill: Skill = {
  name: 'airdrop',
  description:
    'Request a devnet SOL airdrop to fund your wallet (devnet only, max 2 SOL per request)',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Amount of SOL to request (max 2)',
      },
    },
    required: ['amount'],
  },
  async execute(params, context) {
    const amount = Math.min(Number(params.amount || 1), 2)

    const record = await context.transactionEngine.airdrop(
      context.walletId,
      amount,
      context.agentId,
    )

    if (record.status === 'failed') {
      return `Airdrop failed: ${record.error}`
    }

    return `Successfully airdropped ${amount} SOL to your wallet!\nTransaction: ${record.signature}`
  },
}

export const tokenInfoSkill: Skill = {
  name: 'token_info',
  description:
    'Look up information about a token including its mint address and decimals',
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Token symbol (e.g., "USDC", "BONK") or mint address',
      },
    },
    required: ['symbol'],
  },
  async execute(params, context) {
    const symbol = String(params.symbol)
    const mint = context.jupiter.resolveMint(symbol)

    try {
      const info = await context.splToken.getMintInfo(mint)
      return (
        `Token: ${symbol}\n` +
        `Mint: ${info.address}\n` +
        `Decimals: ${info.decimals}\n` +
        `Supply: ${info.supply}\n` +
        `Initialized: ${info.isInitialized}`
      )
    } catch {
      return (
        `Token info for "${symbol}" (mint: ${mint}): Could not fetch on-chain data. ` +
        `This may be a mainnet-only token not available on devnet.`
      )
    }
  },
}

export const waitSkill: Skill = {
  name: 'wait',
  description:
    'Do nothing this cycle. Use when no action is needed based on current conditions.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why you are choosing to wait',
      },
    },
    required: ['reason'],
  },
  async execute(params, _context) {
    return `Waiting. Reason: ${params.reason || 'No action needed'}`
  },
}

// ============================================
// New DeFi Skills
// ============================================

export const launchTokenSkill: Skill = {
  name: 'launch_token',
  description:
    'Create a new SPL token on Solana with an initial supply minted to your wallet. You become the mint and freeze authority.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Token name (e.g., "My Agent Token")',
      },
      symbol: {
        type: 'string',
        description: 'Token ticker symbol (e.g., "MAT")',
      },
      decimals: {
        type: 'number',
        description: 'Number of decimal places (default: 9)',
      },
      initialSupply: {
        type: 'number',
        description: 'Initial token supply in whole units (default: 1,000,000)',
      },
    },
    required: ['name', 'symbol'],
  },
  async execute(params, context) {
    const name = String(params.name)
    const symbol = String(params.symbol)
    const decimals = Number(params.decimals || 9)
    const initialSupply = Number(params.initialSupply || 1_000_000)

    const result = await context.tokenLauncher.createToken(
      context.walletManager,
      context.walletId,
      name,
      symbol,
      decimals,
      initialSupply,
    )

    return (
      `Token launched successfully!\n` +
      `Name: ${result.name} (${result.symbol})\n` +
      `Mint: ${result.mint}\n` +
      `Decimals: ${result.decimals}\n` +
      `Initial Supply: ${result.supply.toLocaleString()}\n` +
      `Your Token Account: ${result.ata}\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const mintSupplySkill: Skill = {
  name: 'mint_supply',
  description:
    'Mint additional tokens for a token you created (you must be the mint authority).',
  parameters: {
    type: 'object',
    properties: {
      mint: {
        type: 'string',
        description: 'Mint address of the token',
      },
      amount: {
        type: 'number',
        description: 'Amount of tokens to mint (in whole units)',
      },
      decimals: {
        type: 'number',
        description: 'Token decimals (default: 9)',
      },
    },
    required: ['mint', 'amount'],
  },
  async execute(params, context) {
    const mint = String(params.mint)
    const amount = Number(params.amount)
    const decimals = Number(params.decimals || 9)

    const result = await context.tokenLauncher.mintAdditionalSupply(
      context.walletManager,
      context.walletId,
      mint,
      amount,
      decimals,
    )

    return (
      `Minted ${amount.toLocaleString()} tokens!\n` +
      `Mint: ${result.mint}\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const revokeMintAuthoritySkill: Skill = {
  name: 'revoke_mint_authority',
  description:
    'Permanently revoke minting capability for a token. This is IRREVERSIBLE — no more tokens can ever be minted.',
  parameters: {
    type: 'object',
    properties: {
      mint: {
        type: 'string',
        description: 'Mint address of the token to revoke authority on',
      },
    },
    required: ['mint'],
  },
  async execute(params, context) {
    const mint = String(params.mint)

    const signature = await context.tokenLauncher.revokeMintAuthority(
      context.walletManager,
      context.walletId,
      mint,
    )

    return (
      `Mint authority PERMANENTLY REVOKED for ${mint}.\n` +
      `No more tokens can ever be minted.\n` +
      `Transaction: ${signature}`
    )
  },
}

export const stakeSkill: Skill = {
  name: 'stake_sol',
  description:
    'Stake SOL by delegating to a Solana validator. Creates a stake account and delegates.',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Amount of SOL to stake',
      },
      validator: {
        type: 'string',
        description:
          'Validator vote account address (optional — defaults to a known devnet validator)',
      },
    },
    required: ['amount'],
  },
  async execute(params, context) {
    const amount = Number(params.amount)
    const validator = params.validator ? String(params.validator) : undefined

    const result = await context.staking.stakeSOL(
      context.walletManager,
      context.walletId,
      amount,
      validator,
    )

    return (
      `Staked ${result.amount} SOL successfully!\n` +
      `Stake Account: ${result.stakeAccount}\n` +
      `Validator: ${result.validator}\n` +
      `Note: Stake activation takes 1-2 epochs on devnet.\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const unstakeSkill: Skill = {
  name: 'unstake_sol',
  description:
    'Deactivate a stake account. After deactivation completes (1 epoch), you can withdraw the SOL.',
  parameters: {
    type: 'object',
    properties: {
      stakeAccount: {
        type: 'string',
        description: 'Public key of the stake account to deactivate',
      },
    },
    required: ['stakeAccount'],
  },
  async execute(params, context) {
    const stakeAccount = String(params.stakeAccount)

    const signature = await context.staking.unstakeSOL(
      context.walletManager,
      context.walletId,
      stakeAccount,
    )

    return (
      `Stake account ${stakeAccount} deactivation initiated.\n` +
      `Withdrawal will be available after the current epoch ends.\n` +
      `Transaction: ${signature}`
    )
  },
}

export const withdrawStakeSkill: Skill = {
  name: 'withdraw_stake',
  description:
    'Withdraw SOL from a fully deactivated stake account back to your wallet.',
  parameters: {
    type: 'object',
    properties: {
      stakeAccount: {
        type: 'string',
        description: 'Public key of the deactivated stake account',
      },
    },
    required: ['stakeAccount'],
  },
  async execute(params, context) {
    const stakeAccount = String(params.stakeAccount)

    const signature = await context.staking.withdrawStake(
      context.walletManager,
      context.walletId,
      stakeAccount,
    )

    return (
      `Successfully withdrew stake from ${stakeAccount}.\n` +
      `SOL returned to your wallet.\n` +
      `Transaction: ${signature}`
    )
  },
}

export const listStakesSkill: Skill = {
  name: 'list_stakes',
  description: 'List all your stake accounts with their status and balances.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_params, context) {
    const wallet = context.walletManager.getWallet(context.walletId)
    if (!wallet) return 'Wallet not found.'

    const stakes = await context.staking.getStakeAccounts(wallet.publicKey)

    if (stakes.length === 0) {
      return 'No stake accounts found.'
    }

    let result = `Found ${stakes.length} stake account(s):\n\n`
    for (const s of stakes) {
      result +=
        `  Address: ${s.address}\n` +
        `  Balance: ${s.solBalance.toFixed(4)} SOL\n` +
        `  State: ${s.state}\n` +
        `  Validator: ${s.voter || 'N/A'}\n\n`
    }

    return result
  },
}

export const burnTokensSkill: Skill = {
  name: 'burn_tokens',
  description: 'Burn (destroy) SPL tokens from your wallet.',
  parameters: {
    type: 'object',
    properties: {
      mint: {
        type: 'string',
        description: 'Mint address of the token to burn',
      },
      amount: {
        type: 'number',
        description: 'Amount of tokens to burn (in whole units)',
      },
    },
    required: ['mint', 'amount'],
  },
  async execute(params, context) {
    const mint = String(params.mint)
    const amount = Number(params.amount)

    const result = await context.splToken.burnTokens(
      context.walletManager,
      context.walletId,
      mint,
      amount,
    )

    return (
      `Burned ${result.burned.toLocaleString()} tokens!\n` +
      `Mint: ${mint}\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const closeTokenAccountSkill: Skill = {
  name: 'close_token_account',
  description:
    'Close an empty token account to reclaim the rent SOL. The account must have zero balance.',
  parameters: {
    type: 'object',
    properties: {
      mint: {
        type: 'string',
        description: 'Mint address of the token account to close',
      },
    },
    required: ['mint'],
  },
  async execute(params, context) {
    const mint = String(params.mint)

    const result = await context.splToken.closeTokenAccount(
      context.walletManager,
      context.walletId,
      mint,
    )

    return (
      `Token account closed!\n` +
      `Rent reclaimed: ${result.rentReclaimed.toFixed(6)} SOL\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const wrapSolSkill: Skill = {
  name: 'wrap_sol',
  description:
    'Convert SOL to Wrapped SOL (wSOL) for DeFi protocol interactions.',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Amount of SOL to wrap',
      },
    },
    required: ['amount'],
  },
  async execute(params, context) {
    const amount = Number(params.amount)

    const result = await context.wrappedSol.wrapSOL(
      context.walletManager,
      context.walletId,
      amount,
    )

    return (
      `Wrapped ${result.amount} SOL → wSOL!\n` +
      `wSOL Account: ${result.wsolAccount}\n` +
      `Transaction: ${result.signature}`
    )
  },
}

export const unwrapSolSkill: Skill = {
  name: 'unwrap_sol',
  description:
    'Convert all Wrapped SOL (wSOL) back to native SOL by closing the wSOL account.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_params, context) {
    const result = await context.wrappedSol.unwrapSOL(
      context.walletManager,
      context.walletId,
    )

    return (
      `Unwrapped ${result.amount.toFixed(4)} wSOL → SOL!\n` +
      `Transaction: ${result.signature}`
    )
  },
}

// ============================================
// Create a fully loaded skill registry
// ============================================

export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()

  // Core skills
  registry.register(balanceSkill)
  registry.register(swapSkill)
  registry.register(transferSkill)
  registry.register(airdropSkill)
  registry.register(tokenInfoSkill)
  registry.register(waitSkill)

  // Token lifecycle
  registry.register(launchTokenSkill)
  registry.register(mintSupplySkill)
  registry.register(revokeMintAuthoritySkill)

  // Staking
  registry.register(stakeSkill)
  registry.register(unstakeSkill)
  registry.register(withdrawStakeSkill)
  registry.register(listStakesSkill)

  // Token account management
  registry.register(burnTokensSkill)
  registry.register(closeTokenAccountSkill)

  // wSOL
  registry.register(wrapSolSkill)
  registry.register(unwrapSolSkill)

  return registry
}
