import OpenAI from 'openai'
import { SkillInvocation } from '../../core/types'
import {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMToolDefinition,
} from './provider'

// ============================================
// OpenAI LLM Provider
// ============================================

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  private client: OpenAI

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    })
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    model: string = process.env.DEFAULT_LLM_MODEL || 'gpt-4o',
  ): Promise<LLMResponse> {
    // Convert tools to OpenAI function format
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(
      (t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }),
    )

    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
    })

    const choice = response.choices[0]
    const toolCalls: SkillInvocation[] = []

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        try {
          toolCalls.push({
            skill: tc.function.name,
            params: JSON.parse(tc.function.arguments),
          })
        } catch {
          // Skip malformed tool calls
        }
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls,
      tokensUsed: {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0,
      },
    }
  }
}
