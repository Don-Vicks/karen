import Anthropic from '@anthropic-ai/sdk'
import { SkillInvocation } from '../../core/types'
import {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMToolDefinition,
} from './provider'

// ============================================
// Anthropic (Claude) LLM Provider
// ============================================

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    })
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    model: string = 'claude-sonnet-4-20250514',
  ): Promise<LLMResponse> {
    // Separate system message from conversation
    const systemMsg = messages.find((m) => m.role === 'system')
    const conversationMsgs: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool_call') {
          return {
            role: 'assistant',
            content: `Executing ${m.toolName}...`,
          }
        }
        if (m.role === 'tool_result') {
          return {
            role: 'user',
            content: `SKILL EXECUTION RESULT:\n${JSON.stringify(m.content)}\n\nPlease summarize this result or execute the next logical step.`,
          }
        }

        return {
          role: m.role as 'user' | 'assistant',
          content: String(m.content),
        }
      })

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }))

    const response = await this.client.messages.create({
      model,
      max_tokens: 1024,
      system: systemMsg ? String(systemMsg.content) : '',
      messages: conversationMsgs,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    const toolCalls: SkillInvocation[] = []
    let content = ''

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          skill: block.name,
          params: block.input as Record<string, unknown>,
        })
      }
    }

    return {
      content,
      toolCalls,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    }
  }
}
