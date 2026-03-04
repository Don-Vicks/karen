import OpenAI from 'openai'
import { SkillInvocation } from '../../core/types'
import {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMToolDefinition,
} from './provider'

// ============================================
// Grok (xAI) LLM Provider
// ============================================
// Uses the OpenAI-compatible API at api.x.ai

export class GrokProvider implements LLMProvider {
  name = 'grok'
  private client: OpenAI

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    })
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    model: string = 'grok-2',
  ): Promise<LLMResponse> {
    const oaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map(
      (m) => {
        // Map tool executions back to text since Grok/OpenAI relies on prompt structure for simple integrations
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
          role: m.role as 'system' | 'user' | 'assistant',
          content: String(m.content),
        }
      },
    )

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
      messages: oaiMessages,
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
