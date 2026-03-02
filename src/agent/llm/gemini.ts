import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai'
import { SkillInvocation } from '../../core/types'
import {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMToolDefinition,
} from './provider'

// ============================================
// Google Gemini LLM Provider
// ============================================
// Uses the official @google/genai SDK

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  private client: GoogleGenAI

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY
    if (!key) {
      throw new Error('GEMINI_API_KEY is not set in environment variables')
    }
    this.client = new GoogleGenAI({
      apiKey: key,
    })
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    model: string = process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  ): Promise<LLMResponse> {
    // Convert generic tools into Gemini Native Function Declarations
    const functionDeclarations: FunctionDeclaration[] = tools.map((t) => {
      // Gemini strict type mapping
      const transformSchema = (schema: any): any => {
        if (!schema) return undefined
        const out: any = { type: schema.type.toUpperCase() as Type }
        if (schema.description) out.description = schema.description
        if (schema.properties) {
          out.properties = {}
          for (const key of Object.keys(schema.properties)) {
            out.properties[key] = transformSchema(schema.properties[key])
          }
        }
        return out
      }

      return {
        name: t.name,
        description: t.description,
        ...(t.parameters &&
        Object.keys(t.parameters.properties || {}).length > 0
          ? { parameters: transformSchema(t.parameters) }
          : {}),
      }
    })

    const geminiTools =
      functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined

    // Convert messages to Gemini syntax
    const geminiMessages = messages.map((m) => {
      // Gemini roles are 'user', 'user', 'model', or 'system' - but system is a distinct parameter in v1
      return {
        role: m.role === 'assistant' ? 'model' : 'user', // Map everything to user or model
        parts: [{ text: m.content }],
      }
    })

    const response = await this.client.models.generateContent({
      model: model,
      contents: geminiMessages,
      config: {
        tools: geminiTools,
      },
    })

    const toolCalls: SkillInvocation[] = []

    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name) {
          toolCalls.push({
            skill: call.name,
            params: (call.args as Record<string, unknown>) || {},
          })
        }
      }
    }

    return {
      content: response.text || '',
      toolCalls: toolCalls,
      tokensUsed: {
        input: response.usageMetadata?.promptTokenCount || 0,
        output: response.usageMetadata?.candidatesTokenCount || 0,
      },
    }
  }
}
