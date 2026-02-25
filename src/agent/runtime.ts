import { AuditLogger } from '../core/audit-logger'
import { TransactionEngine } from '../core/transaction/transaction-engine'
import {
  AgentConfig,
  AgentDecision,
  AgentStatus,
  SkillInvocation,
} from '../core/types'
import { WalletManager } from '../core/wallet/wallet-manager'
import { JupiterAdapter } from '../protocols/jupiter'
import { SplTokenAdapter } from '../protocols/spl-token'
import { StakingAdapter } from '../protocols/staking'
import { TokenLauncherAdapter } from '../protocols/token-launcher'
import { WrappedSolAdapter } from '../protocols/wrapped-sol'
import { AnthropicProvider } from './llm/anthropic'
import { GeminiProvider } from './llm/gemini'
import { GrokProvider } from './llm/grok'
import { OpenAIProvider } from './llm/openai'
import { LLMMessage, LLMProvider } from './llm/provider'
import { MemoryStore } from './memory/memory-store'
import {
  SkillContext,
  SkillRegistry,
  createDefaultSkillRegistry,
} from './skills'

// ============================================
// Agent Runtime
// ============================================
// The core agent loop: Observe → Think → Act → Remember

export class AgentRuntime {
  private config: AgentConfig
  private walletManager: WalletManager
  private transactionEngine: TransactionEngine
  private logger: AuditLogger
  private llm: LLMProvider
  private skills: SkillRegistry
  private memory: MemoryStore
  private jupiter: JupiterAdapter
  private splToken: SplTokenAdapter
  private tokenLauncher: TokenLauncherAdapter
  private staking: StakingAdapter
  private wrappedSol: WrappedSolAdapter
  private cycle: number = 0
  private running: boolean = false
  private loopTimer: NodeJS.Timeout | null = null

  constructor(
    config: AgentConfig,
    walletManager: WalletManager,
    transactionEngine: TransactionEngine,
    logger: AuditLogger,
    skills?: SkillRegistry,
    memory?: MemoryStore,
  ) {
    this.config = config
    this.walletManager = walletManager
    this.transactionEngine = transactionEngine
    this.logger = logger
    this.skills = skills || createDefaultSkillRegistry()
    this.memory = memory || new MemoryStore()
    this.jupiter = new JupiterAdapter()
    this.splToken = new SplTokenAdapter()
    this.tokenLauncher = new TokenLauncherAdapter()
    this.staking = new StakingAdapter()
    this.wrappedSol = new WrappedSolAdapter()

    // Initialize LLM provider
    if (config.llmProvider === 'anthropic') {
      this.llm = new AnthropicProvider()
    } else if (config.llmProvider === 'grok') {
      this.llm = new GrokProvider()
    } else if (config.llmProvider === 'gemini') {
      this.llm = new GeminiProvider()
    } else {
      this.llm = new OpenAIProvider()
    }
  }

  // ========== Lifecycle ==========

  start(): void {
    if (this.running) return
    this.running = true
    this.config.status = 'running'
    this.logger.logEvent({
      type: 'agent:started',
      data: { agentId: this.config.id },
    })
    this.runLoop()
  }

  stop(): void {
    this.running = false
    this.config.status = 'stopped'
    if (this.loopTimer) {
      clearTimeout(this.loopTimer)
      this.loopTimer = null
    }
    this.logger.logEvent({
      type: 'agent:stopped',
      data: { agentId: this.config.id },
    })
  }

  pause(): void {
    this.running = false
    this.config.status = 'paused'
    if (this.loopTimer) {
      clearTimeout(this.loopTimer)
      this.loopTimer = null
    }
  }

  getConfig(): AgentConfig {
    return { ...this.config }
  }

  getStatus(): AgentStatus {
    return this.config.status
  }

  // ========== Chat Interface ==========

  /**
   * Send a direct message to the agent and get a response
   * (Used by dashboard chat and CLI)
   */
  async chat(message: string): Promise<string> {
    const systemPrompt = this.buildSystemPrompt()
    const recentMemory = this.memory.formatForContext(this.config.id, 10)

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `RECENT ACTIVITY:\n${recentMemory}\n\nUSER MESSAGE: ${message}`,
      },
    ]

    const response = await this.llm.chat(messages, [])
    return response.content
  }

  // ========== Core Loop ==========

  private async runLoop(): Promise<void> {
    if (!this.running) return

    try {
      await this.executeCycle()
    } catch (error: any) {
      this.config.status = 'error'
      this.logger.logEvent({
        type: 'agent:error',
        data: { agentId: this.config.id, error: error.message },
      })
    }

    // Schedule next cycle
    if (this.running) {
      this.loopTimer = setTimeout(
        () => this.runLoop(),
        this.config.loopIntervalMs,
      )
    }
  }

  private async executeCycle(): Promise<void> {
    this.cycle++

    // 1. OBSERVE — gather current state
    const observations = await this.observe()

    // 2. THINK — ask the LLM what to do
    const { reasoning, action, rawResponse } = await this.think(observations)

    // 3. ACT — execute the chosen skill
    let outcome = ''
    if (action) {
      outcome = await this.act(action)
    } else {
      outcome = 'No action taken this cycle.'
    }

    // 4. REMEMBER — persist the decision
    const decision: AgentDecision = {
      agentId: this.config.id,
      cycle: this.cycle,
      observations,
      reasoning,
      action,
      outcome,
      timestamp: new Date().toISOString(),
    }

    this.logger.logDecision(decision)
    this.logger.logEvent({ type: 'agent:decision', data: decision })
    this.memory.addMemory(this.config.id, {
      cycle: this.cycle,
      reasoning,
      action: action
        ? `${action.skill}(${JSON.stringify(action.params)})`
        : null,
      outcome,
      timestamp: new Date().toISOString(),
    })
  }

  // ========== Observe ==========

  private async observe(): Promise<Record<string, unknown>> {
    try {
      const balances = await this.walletManager.getBalances(
        this.config.walletId,
      )
      const wallet = this.walletManager.getWallet(this.config.walletId)
      const recentTxs = this.transactionEngine.getTransactionHistory(
        this.config.walletId,
        5,
      )

      return {
        wallet: {
          name: wallet?.name,
          address: wallet?.publicKey,
        },
        balances: {
          sol: balances.sol,
          tokens: balances.tokens.map((t) => ({
            mint: t.mint,
            balance: t.uiBalance,
          })),
        },
        recentTransactions: recentTxs.map((tx) => ({
          type: tx.type,
          status: tx.status,
          details: tx.details,
          timestamp: tx.timestamp,
        })),
        cycle: this.cycle,
        timestamp: new Date().toISOString(),
      }
    } catch (error: any) {
      return {
        error: `Failed to observe: ${error.message}`,
        cycle: this.cycle,
        timestamp: new Date().toISOString(),
      }
    }
  }

  // ========== Think ==========

  private async think(observations: Record<string, unknown>): Promise<{
    reasoning: string
    action: SkillInvocation | null
    rawResponse: string
  }> {
    const systemPrompt = this.buildSystemPrompt()
    const recentMemory = this.memory.formatForContext(this.config.id, 10)

    const userMessage = `CURRENT STATE:\n${JSON.stringify(observations, null, 2)}\n\nRECENT MEMORY:\n${recentMemory}\n\nBased on your strategy and the current state, what would you like to do? Use one of your available skills or wait if no action is needed.`

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    const tools = this.skills.getToolDefinitions()
    const response = await this.llm.chat(messages, tools)

    const action = response.toolCalls.length > 0 ? response.toolCalls[0] : null

    return {
      reasoning: response.content || 'No explicit reasoning provided.',
      action,
      rawResponse: response.content,
    }
  }

  // ========== Act ==========

  private async act(action: SkillInvocation): Promise<string> {
    const context: SkillContext = {
      walletId: this.config.walletId,
      agentId: this.config.id,
      walletManager: this.walletManager,
      transactionEngine: this.transactionEngine,
      jupiter: this.jupiter,
      splToken: this.splToken,
      tokenLauncher: this.tokenLauncher,
      staking: this.staking,
      wrappedSol: this.wrappedSol,
    }

    return this.skills.execute(action.skill, action.params, context)
  }

  // ========== System Prompt ==========

  private buildSystemPrompt(): string {
    return `You are "${this.config.name}", an autonomous AI agent managing a Solana wallet on devnet.

YOUR STRATEGY:
${this.config.strategy}

YOUR CONSTRAINTS:
- Maximum ${this.config.guardrails.maxSolPerTransaction} SOL per transaction
- Maximum ${this.config.guardrails.maxTransactionsPerMinute} transactions per minute
- Daily spending limit: ${this.config.guardrails.dailySpendingLimitSol} SOL
- You are on Solana DEVNET — these are not real funds

YOUR BEHAVIOR:
1. Analyze your current wallet state and recent activity
2. Make a decision based on your strategy
3. Use EXACTLY ONE skill per cycle, or "wait" if no action is needed
4. Always provide clear reasoning for your decisions
5. Be conservative — it's better to wait than make a bad trade
6. Check your balance before making swaps or transfers
7. If your SOL balance is low, consider requesting an airdrop

IMPORTANT:
- You must respond with a tool/function call to execute an action
- Include your reasoning in the text response
- Each cycle you can only perform ONE action`
  }
}
