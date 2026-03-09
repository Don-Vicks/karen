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
  private llm?: LLMProvider
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

    this.staking = new StakingAdapter()
    this.wrappedSol = new WrappedSolAdapter()
  }

  // Lazy load LLM so it doesn't crash on startup if an API key is missing
  // for an idle agent.
  private getLlm(): LLMProvider {
    if (this.llm) return this.llm

    if (this.config.llmProvider === 'anthropic') {
      this.llm = new AnthropicProvider()
    } else if (this.config.llmProvider === 'grok') {
      this.llm = new GrokProvider()
    } else if (this.config.llmProvider === 'gemini') {
      this.llm = new GeminiProvider()
    } else {
      this.llm = new OpenAIProvider()
    }

    return this.llm
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
    const observations = await this.observe()

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `CURRENT WALLET STATE:\n${JSON.stringify(observations, null, 2)}\n\nRECENT BACKGROUND ACTIVITY:\n${recentMemory}\n\nUSER MESSAGE: ${message}\n\n=== CHAT OVERRIDE ===\nRead the USER MESSAGE carefully.\n1. If the user is just saying hello, asking a question, or requesting information (e.g., "what can you do?", "how's it going?"): You MUST use the "wait" tool to reply conversationally. DO NOT execute any financial or blockchain tools.\n2. Only execute financial tools (airdrop, transfer, stake, etc.) if the user EXPLICITLY commands you to perform a specific action (e.g., "airdrop me 2 sol", "stake my funds").\n3. Answering the user's question takes absolute precedence over your background strategy.`,
      },
    ]

    const tools = this.skills.getToolDefinitions()
    let response = await this.getLlm().chat(
      messages,
      tools,
      this.config.llmModel,
    )

    // If the LLM decided to execute skills based on the chat (e.g., Airdrop then Transfer)
    let loopCount = 0
    const maxLoops = 5

    console.log(`\n💬 [${this.config.name}] Chat Request Received`)
    console.log(
      `   🔸 Reasoning : ${response.content ? response.content.replace(/\n/g, ' ').substring(0, 100) : 'No explicit reasoning provided.'}...`,
    )

    // Highlight what the LLM tried to do if it hallucinated code
    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (
        response.content.includes('\`\`\`python') ||
        response.content.includes('\`\`\`javascript') ||
        response.content.includes('\`\`\`json')
      ) {
        console.warn(
          `⚠️ [${this.config.name}] LLM Hallucinated code blocks instead of using native tools in chat: \n${response.content.substring(0, 150)}...`,
        )
      } else {
        console.log(`   ⏳ Action    : Conversational Reply`)
      }
    }

    while (
      response.toolCalls &&
      response.toolCalls.length > 0 &&
      loopCount < maxLoops
    ) {
      loopCount++
      const action = response.toolCalls[0]

      console.log(
        `   ⚡ Action    : ${action.skill}(${JSON.stringify(action.params)})`,
      )

      let outcome: string
      try {
        outcome = await this.act(action)
      } catch (error: any) {
        return `❌ Agent failed to execute ${action.skill}: ${error.message}`
      }

      // Feed the tool invocation context back to the chat natively
      messages.push({
        role: 'tool_call',
        content: action.params,
        toolName: action.skill,
      })
      this.memory.addChatMessage(
        this.config.id,
        'system',
        `⚙️ Executing skill \`${action.skill}\` with params: \n\`\`\`json\n${JSON.stringify(action.params, null, 2)}\n\`\`\``,
      )

      console.log(
        `   ✅ Outcome   : ${outcome.replace(/\n/g, ' ').substring(0, 100)}...`,
      )

      // Feed the execution result back to the chat natively
      messages.push({
        role: 'tool_result',
        content: outcome,
        toolName: action.skill,
      })
      this.memory.addChatMessage(
        this.config.id,
        'system',
        `✅ Result:\n\n${outcome}`,
      )

      // Ask the LLM one more time to summarize the result.
      // We pass an empty tools array [] so it is physically forced to reply with text
      // rather than getting distracted and firing another tool infinitely.
      try {
        response = await this.getLlm().chat(messages, [], this.config.llmModel)
      } catch (error: any) {
        return `✅ Action executed successfully:\n\n${outcome}\n\n⚠️ However, the agent ran out of API resources while trying to write a response: ${error.message}`
      }
    }

    if (loopCount >= maxLoops) {
      return `⚠️ Agent reached maximum tool execution limit.\n\n${response.content || 'Please try again.'}`
    }

    return response.content || 'No response generated.'
  }

  // ========== Core Loop ==========

  private async runLoop(): Promise<void> {
    if (!this.running) return

    try {
      await this.executeCycle()
      // Auto-recover from transient errors
      if (this.config.status === 'error') {
        this.config.status = 'running'
        this.logger.logEvent({
          type: 'agent:recovered',
          data: {
            agentId: this.config.id,
            message: 'Recovered from previous error',
          },
        })
      }
    } catch (error: any) {
      if (this.config.status !== 'error') {
        this.config.status = 'error'
        this.logger.logEvent({
          type: 'agent:error',
          data: { agentId: this.config.id, error: error.message },
        })
      }
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

    // Print to terminal for a cool visual demo
    console.log(`\n🤖 [${this.config.name}] Cycle ${this.cycle} Executed`)
    console.log(
      `   🔸 Reasoning : ${reasoning.split('\n')[0].substring(0, 100)}...`,
    )
    if (action) {
      console.log(
        `   ⚡ Action    : ${action.skill}(${JSON.stringify(action.params)})`,
      )
      console.log(
        `   ✅ Outcome   : ${outcome.split('\n')[0].substring(0, 100)}...`,
      )
    } else {
      console.log(`   ⏳ Action    : Wait`)
    }
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
        timestamp: new Date().toISOString(),
      }
    } catch (error: any) {
      return {
        error: `Failed to observe: ${error.message}`,
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

    const chatMsgs = this.memory.getChatMessages(this.config.id).slice(-5)
    let chatContext = ''
    if (chatMsgs.length > 0) {
      chatContext =
        `RECENT CHAT WITH USER:\n` +
        chatMsgs.map((m: any) => `[${m.role}]: ${m.content}`).join('\n') +
        `\n\n`
    }

    const userMessage = `CURRENT STATE:\n${JSON.stringify(observations, null, 2)}\n\nRECENT MEMORY:\n${recentMemory}\n\n${chatContext}Based on your strategy, the current state, and recent chat requests, what would you like to do? Use one of your available skills or wait if no action is needed.`

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    const tools = this.skills.getToolDefinitions()
    const response = await this.getLlm().chat(
      messages,
      tools,
      this.config.llmModel,
    )

    const action =
      response.toolCalls && response.toolCalls.length > 0
        ? response.toolCalls[0]
        : null

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
3. Use EXACTLY ONE skill per action, or "wait" if no action is needed
4. Check your balance before making swaps or transfers
5. If your SOL balance is low, consider requesting an airdrop

REASONING GUIDELINES:
- You must write concise, professional execution logs that explain your plan clearly to the user.
- State exactly what you have observed, what you plan to do, and why based on your strategy.
- NEVER use technical jargon like "cycles", "loops", or "internal mechanics". The user does not know what this means.
- Do NOT write in the first-person like a diary. Instead, write like a high-grade financial engine executing a strategy.
- Example: "Previous airdrops failed. Current balance is 1.5 SOL. Based on the strategy, commencing a 0.5 SOL stake delegation."
- You MUST provide your text reasoning BEFORE using a tool.
- ENVIRONMENT LIMITATION: Do NOT write any Markdown code snippets, Python scripts, or JSON blocks in your text response.
- Execute actions EXCLUSIVELY by invoking the registered function tools natively provided by the platform.

IMPORTANT:
- Call exactly ONE tool/function per action to perform it. Do not attempt to write out the tool call manually in text.
- Include your text reasoning in the response alongside the tool call.
- You can only perform ONE action at a time`
  }
}
