import express, { Request, Response, Router } from 'express'
import twilio from 'twilio'
import { Orchestrator } from '../agent/orchestrator'

export class WhatsAppService {
  private orchestrator: Orchestrator
  private twilioClient: twilio.Twilio
  private twilioNumber: string
  private allowedNumbers: string[]

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    this.twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || ''

    if (!accountSid || !authToken) {
      console.warn(
        '[WhatsApp] Missing Twilio credentials. WhatsApp webhook not fully configured.',
      )
      // @ts-ignore: Dummy client for types if secrets are missing
      this.twilioClient = {}
    } else {
      this.twilioClient = twilio(accountSid, authToken)
    }

    // Parse allowed phone numbers (e.g. +1234567890,+1987654321)
    this.allowedNumbers = (process.env.API_ALLOWED_ORIGINS || '') // reusing general whitelist or specify one
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
  }

  /**
   * Send a WhatsApp message via Twilio
   */
  async sendMessage(to: string, message: string): Promise<boolean> {
    try {
      await this.twilioClient.messages.create({
        from: `whatsapp:${this.twilioNumber}`,
        to: `whatsapp:${to}`,
        body: message,
      })
      return true
    } catch (error: any) {
      console.error('[WhatsApp] Failed to send message:', error.message)
      return false
    }
  }

  /**
   * Express Router for Twilio Webhooks
   */
  getRouter(): Router {
    const router = express.Router()

    router.post('/', async (req: Request, res: Response) => {
      try {
        // Twilio sends form-urlencoded data to webhooks
        const { Body, From } = req.body

        if (!Body || !From) {
          return res.status(400).send('Missing Body or From parameters')
        }

        // 'From' format is usually 'whatsapp:+1234567890'
        const phoneNumber = From.replace('whatsapp:', '')
        console.log(`[WhatsApp] Received message from ${phoneNumber}: ${Body}`)

        // 1. Security Check (Optional based on your setup)
        // You could enforce strictly allowed numbers here:
        // if (this.allowedNumbers.length > 0 && !this.allowedNumbers.includes(phoneNumber)) {
        //   console.warn(`[WhatsApp] Ignored message from unlisted number: ${phoneNumber}`)
        //   return res.status(200).send('<Response></Response>') // Return empty TwiML
        // }

        // 2. Find an active agent to route the message to
        const agents = this.orchestrator.listAgents()
        const activeAgents = agents.filter((a) => a.status === 'running')

        let targetAgent = activeAgents[0]

        // 3. Fallback to newest agent if none are running
        if (!targetAgent && agents.length > 0) {
          agents.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          targetAgent = agents[0]
        }

        if (!targetAgent) {
          const reply =
            '❌ No agents found. Please create one on your Karen dashboard or CLI first.'
          await this.sendMessage(phoneNumber, reply)
          return res.status(200).send('<Response></Response>')
        }

        // 4. Send background processing to LLM (Don't block Twilio response)
        this.processLlmActivity(
          phoneNumber,
          targetAgent.id,
          targetAgent.name,
          Body,
        )

        // Return empty TwiML to Twilio immediately so the webhook doesn't timeout (15s limit)
        res.set('Content-Type', 'text/xml')
        res.status(200).send('<Response></Response>')
      } catch (error: any) {
        console.error('[WhatsApp] Webhook Error:', error)
        res.status(500).send('Internal Server Error')
      }
    })

    return router
  }

  /**
   * Async background processing calling Gemini
   */
  private async processLlmActivity(
    phoneNumber: string,
    agentId: string,
    agentName: string,
    text: string,
  ) {
    try {
      const response = await this.orchestrator.chatWithAgent(agentId, text)
      await this.sendMessage(phoneNumber, `🤖 [${agentName}]\n${response}`)
    } catch (error: any) {
      console.error(`[WhatsApp] Error talking to agent:`, error)
      await this.sendMessage(
        phoneNumber,
        `❌ Error from agent: ${error.message}`,
      )
    }
  }
}
