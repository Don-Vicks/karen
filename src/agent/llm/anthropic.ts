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
    const conversationMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }))

    const response = await this.client.messages.create({
      model,
      max_tokens: 1024,
      system: systemMsg?.content || '',
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
