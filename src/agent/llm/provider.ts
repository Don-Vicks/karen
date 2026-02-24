import { SkillInvocation } from '../../core/types'

// ============================================
// LLM Provider Interface
// ============================================
// Unified abstraction for OpenAI and Anthropic

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface LLMResponse {
  content: string
  toolCalls: SkillInvocation[]
  tokensUsed: {
    input: number
    output: number
  }
}

export interface LLMProvider {
  name: string
  chat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    model?: string,
  ): Promise<LLMResponse>
}
