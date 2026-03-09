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

    const systemMessage = messages.find((m) => m.role === 'system')
    const chatMessages = messages.filter((m) => m.role !== 'system')

    // Convert messages to Gemini syntax
    const geminiMessages = chatMessages.map((m) => {
      // Handle native tool call responses injected by our AgentRuntime
      if (m.role === 'tool_result' && m.toolName) {
        return {
          role: 'user', // Gemini expects functionResponses from the 'user' side
          parts: [
            {
              functionResponse: {
                name: m.toolName,
                response: { result: m.content },
              },
            },
          ],
        }
      }

      if (m.role === 'tool_call' && m.toolName) {
        return {
          role: 'model', // Tool calls always originate from the model
          parts: [
            {
              functionCall: {
                name: m.toolName,
                args: typeof m.content === 'object' ? m.content : {},
              },
            },
          ],
        }
      }

      // Standard text messages
      return {
        role: m.role === 'assistant' ? 'model' : 'user', // Map text chats to user or model
        parts: [{ text: String(m.content) }],
      }
    })

    const response = await this.client.models.generateContent({
      model: model,
      contents: geminiMessages,
      config: {
        tools: geminiTools,
        systemInstruction: systemMessage?.content,
      },
    })

    const toolCalls: SkillInvocation[] = []
    let finalContent = ''

    // Manually parse parts to avoid the SDK's concatenation warning when both text and functionCall exist
    if (response.candidates && response.candidates.length > 0) {
      const candidateItem = response.candidates[0]
      if (candidateItem.content && Array.isArray(candidateItem.content.parts)) {
        for (const part of candidateItem.content.parts) {
          if (part.text) {
            finalContent += part.text
          }
          if (part.functionCall && part.functionCall.name) {
            toolCalls.push({
              skill: part.functionCall.name,
              params: (part.functionCall.args as Record<string, unknown>) || {},
            })
          }
        }
      }
    }

    return {
      content: finalContent || '',
      toolCalls: toolCalls,
      tokensUsed: {
        input: response.usageMetadata?.promptTokenCount || 0,
        output: response.usageMetadata?.candidatesTokenCount || 0,
      },
    }
  }
}
