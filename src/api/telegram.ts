import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { Orchestrator } from '../agent/orchestrator'

export class TelegramService {
  private bot: Telegraf
  private orchestrator: Orchestrator
  private allowedUsers: string[]

  constructor(token: string, orchestrator: Orchestrator) {
    this.bot = new Telegraf(token)
    this.orchestrator = orchestrator

    // Parse allowed users from .env (comma-separated usernames without @)
    this.allowedUsers = (process.env.TELEGRAM_ALLOWED_USERS || '')
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter((u) => u.length > 0)

    this.setupHandlers()
  }

  private setupHandlers() {
    this.bot.start((ctx) => {
      ctx.reply(
        '🤖 Welcome to Karen! I am your autonomous Web3 assistant.\n\n' +
          'Send me a message to chat with your active agent.',
      )
    })

    this.bot.on(message('text'), async (ctx) => {
      // 1. Security Check: Only allow whitelisted users
      const username = ctx.from.username?.toLowerCase()
      if (!username || !this.allowedUsers.includes(username)) {
        console.warn(
          `[Telegram] Blocked message from unauthorized user: @${username || 'unknown'}`,
        )
        return ctx.reply(
          '⛔ Unauthorized. Your username is not in TELEGRAM_ALLOWED_USERS.',
        )
      }

      const text = ctx.message.text
      console.log(`[Telegram] @${username}: ${text}`)

      // 2. Find an active agent to route the message to
      const agents = this.orchestrator.listAgents()
      const activeAgents = agents.filter((a) => a.status === 'running')

      let targetAgent = activeAgents[0]

      // If no running agent, route to the most recently created agent
      if (!targetAgent && agents.length > 0) {
        agents.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        targetAgent = agents[0]
      }

      if (!targetAgent) {
        return ctx.reply(
          '❌ No agents found. Please create one on your Karen dashboard or CLI first.',
        )
      }

      // 3. Send message to the agent's LLM
      try {
        await ctx.sendChatAction('typing')
        const response = await this.orchestrator.chatWithAgent(
          targetAgent.id,
          text,
        )
        ctx.reply(`🤖 [${targetAgent.name}]\n` + response)
      } catch (error: any) {
        console.error(`[Telegram] Error talking to agent:`, error)
        ctx.reply(`❌ Error from agent: ${error.message}`)
      }
    })
  }

  async start() {
    console.log('[Telegram] Starting bot service...')

    // Non-blocking launch
    this.bot.launch().catch((err) => {
      console.error('[Telegram] Failed to start bot:', err.message)
    })

    // Enable graceful stop
    process.once('SIGINT', () => {
      try {
        this.bot.stop('SIGINT')
      } catch (e) {}
    })
    process.once('SIGTERM', () => {
      try {
        this.bot.stop('SIGTERM')
      } catch (e) {}
    })
  }
}
