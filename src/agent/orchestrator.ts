import { v4 as uuidv4 } from 'uuid'
import { AuditLogger } from '../core/audit-logger'
import { Guardrails } from '../core/transaction/guardrails'
import { TransactionEngine } from '../core/transaction/transaction-engine'
import { AgentConfig, DEFAULT_GUARDRAIL_CONFIG } from '../core/types'
import { WalletManager } from '../core/wallet/wallet-manager'
import { MemoryStore } from './memory/memory-store'
import { AgentRuntime } from './runtime'
import { createDefaultSkillRegistry } from './skills'

// ============================================
// Agent Orchestrator
// ============================================
// Manages multiple agents concurrently

export interface CreateAgentOptions {
  name: string
  strategy: string
  llmProvider?: 'openai' | 'anthropic'
  llmModel?: string
  loopIntervalMs?: number
  maxSolPerTransaction?: number
  maxTransactionsPerMinute?: number
  dailySpendingLimitSol?: number
  walletName?: string
  mnemonic?: string
  derivationIndex?: number
}

export class Orchestrator {
  private agents: Map<string, AgentRuntime> = new Map()
  private configs: Map<string, AgentConfig> = new Map()
  private walletManager: WalletManager
  private transactionEngine: TransactionEngine
  private guardrails: Guardrails
  private logger: AuditLogger
  private memory: MemoryStore

  constructor(
    walletManager: WalletManager,
    transactionEngine: TransactionEngine,
    guardrails: Guardrails,
    logger: AuditLogger,
  ) {
    this.walletManager = walletManager
    this.transactionEngine = transactionEngine
    this.guardrails = guardrails
    this.logger = logger
    this.memory = new MemoryStore()
  }

  /**
   * Create a new agent with its own wallet
   */
  async createAgent(options: CreateAgentOptions): Promise<AgentConfig> {
    const agentId = uuidv4()

    // Create a wallet for this agent
    let walletInfo
    if (options.mnemonic && options.derivationIndex !== undefined) {
      walletInfo = await this.walletManager.createDerivedWallet(
        options.walletName || `${options.name}-wallet`,
        options.mnemonic,
        options.derivationIndex,
        ['agent', agentId],
      )
    } else {
      walletInfo = await this.walletManager.createWallet(
        options.walletName || `${options.name}-wallet`,
        ['agent', agentId],
      )
    }

    const config: AgentConfig = {
      id: agentId,
      name: options.name,
      walletId: walletInfo.id,
      llmProvider:
        options.llmProvider ||
        (process.env.DEFAULT_LLM_PROVIDER as any) ||
        'openai',
      llmModel: options.llmModel || process.env.DEFAULT_LLM_MODEL || 'gpt-4o',
      strategy: options.strategy,
      guardrails: {
        ...DEFAULT_GUARDRAIL_CONFIG,
        maxSolPerTransaction:
          options.maxSolPerTransaction ??
          DEFAULT_GUARDRAIL_CONFIG.maxSolPerTransaction,
        maxTransactionsPerMinute:
          options.maxTransactionsPerMinute ??
          DEFAULT_GUARDRAIL_CONFIG.maxTransactionsPerMinute,
        dailySpendingLimitSol:
          options.dailySpendingLimitSol ??
          DEFAULT_GUARDRAIL_CONFIG.dailySpendingLimitSol,
      },
      loopIntervalMs:
        options.loopIntervalMs ||
        Number(process.env.AGENT_LOOP_INTERVAL_MS) ||
        30000,
      status: 'idle',
      createdAt: new Date().toISOString(),
    }

    // Create runtime
    const skills = createDefaultSkillRegistry()
    const runtime = new AgentRuntime(
      config,
      this.walletManager,
      this.transactionEngine,
      this.logger,
      skills,
      this.memory,
    )

    this.agents.set(agentId, runtime)
    this.configs.set(agentId, config)

    return config
  }

  /**
   * Start an agent
   */
  startAgent(agentId: string): void {
    const runtime = this.agents.get(agentId)
    if (!runtime) throw new Error(`Agent not found: ${agentId}`)
    runtime.start()
    const config = this.configs.get(agentId)!
    config.status = 'running'
  }

  /**
   * Stop an agent
   */
  stopAgent(agentId: string): void {
    const runtime = this.agents.get(agentId)
    if (!runtime) throw new Error(`Agent not found: ${agentId}`)
    runtime.stop()
    const config = this.configs.get(agentId)!
    config.status = 'stopped'
  }

  /**
   * Pause an agent
   */
  pauseAgent(agentId: string): void {
    const runtime = this.agents.get(agentId)
    if (!runtime) throw new Error(`Agent not found: ${agentId}`)
    runtime.pause()
    const config = this.configs.get(agentId)!
    config.status = 'paused'
  }

  /**
   * Chat with an agent
   */
  async chatWithAgent(agentId: string, message: string): Promise<string> {
    const runtime = this.agents.get(agentId)
    if (!runtime) throw new Error(`Agent not found: ${agentId}`)
    return runtime.chat(message)
  }

  /**
   * List all agents
   */
  listAgents(): AgentConfig[] {
    return Array.from(this.configs.values())
  }

  /**
   * Get agent config
   */
  getAgent(agentId: string): AgentConfig | null {
    return this.configs.get(agentId) || null
  }

  /**
   * Find agent by name
   */
  findAgentByName(name: string): AgentConfig | null {
    for (const config of this.configs.values()) {
      if (config.name === name) return config
    }
    return null
  }

  /**
   * Get agent runtime (for advanced access)
   */
  getRuntime(agentId: string): AgentRuntime | null {
    return this.agents.get(agentId) || null
  }

  /**
   * Stop all agents
   */
  stopAll(): void {
    for (const [id, runtime] of this.agents) {
      runtime.stop()
      const config = this.configs.get(id)!
      config.status = 'stopped'
    }
  }

  /**
   * Get global stats
   */
  getStats(): {
    totalAgents: number
    runningAgents: number
    stoppedAgents: number
    idleAgents: number
  } {
    const configs = Array.from(this.configs.values())
    return {
      totalAgents: configs.length,
      runningAgents: configs.filter((c) => c.status === 'running').length,
      stoppedAgents: configs.filter((c) => c.status === 'stopped').length,
      idleAgents: configs.filter((c) => c.status === 'idle').length,
    }
  }
}
