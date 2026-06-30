import type { LLMResponse, AgentConfig } from '@shared/types'
import type { LLMProvider, PromptSegment } from './types'
import type { ToolDefinition } from '@tools/types'
import { randomUUID } from 'crypto'

function cryptoRandomId(): string {
  return randomUUID()
}

export class OpenAILLMProvider implements LLMProvider {
  private toolDefinitions: ToolDefinition[] = []

  constructor(toolDefinitions: ToolDefinition[] = []) {
    this.toolDefinitions = toolDefinitions
  }

  setToolDefinitions(tools: ToolDefinition[]): void {
    this.toolDefinitions = tools
  }

  private stripImages(prompt: PromptSegment[]): PromptSegment[] {
    return prompt.map(seg => {
      if (Array.isArray(seg.content)) {
        const textParts = seg.content.filter(p => p.type === 'text')
        const imageCount = seg.content.filter(p => p.type === 'image_url').length
        const textContent = textParts.map(p => p.text).join('\n')
        return {
          ...seg,
          content: imageCount > 0
            ? `${textContent}\n\n[Note: ${imageCount} image(s) were attached but the current model does not support image input. Use tools like browser screenshot or file read to analyze visual content.]`
            : textContent
        }
      }
      return seg
    })
  }

  private hasImageContent(prompt: PromptSegment[]): boolean {
    return prompt.some(seg => Array.isArray(seg.content) && seg.content.some(p => p.type === 'image_url'))
  }

  private buildMessages(prompt: PromptSegment[]): Array<Record<string, unknown>> {
    return prompt.map(seg => {
      const role = seg.role === 'developer' ? 'system' : seg.role

      if (role === 'tool' && seg.toolCallId) {
        return {
          role: 'tool',
          tool_call_id: seg.toolCallId,
          content: seg.content
        }
      }

      if (role === 'assistant' && seg.toolCalls && seg.toolCalls.length > 0) {
        const msg: Record<string, unknown> = {
          role: 'assistant',
          content: seg.content || null,
          tool_calls: seg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          }))
        }
        if (seg.reasoningContent) {
          msg.reasoning_content = seg.reasoningContent
        }
        return msg
      }

      if (role === 'assistant' && seg.reasoningContent) {
        return {
          role: 'assistant',
          content: seg.content,
          reasoning_content: seg.reasoningContent
        }
      }

      if (role === 'user' && Array.isArray(seg.content)) {
        return { role, content: seg.content }
      }

      return { role, content: seg.content }
    })
  }

  private buildTools(): unknown[] {
    return this.toolDefinitions.map(def => ({
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: {
          type: 'object',
          properties: def.parameters.reduce((acc, p) => {
            acc[p.name] = {
              type: p.type,
              description: p.description,
              ...(p.default !== undefined && { default: p.default })
            }
            return acc
          }, {} as Record<string, unknown>),
          required: def.parameters.filter(p => p.required).map(p => p.name)
        }
      }
    }))
  }

  async query(prompt: PromptSegment[], config: AgentConfig): Promise<LLMResponse> {
    if (!config.apiKey) {
      return {
        text: 'Error: No API key configured. Please set your API key in Settings.',
        done: true
      }
    }

    let effectivePrompt = prompt
    let body: Record<string, unknown> = {
      model: config.model,
      messages: this.buildMessages(prompt),
      max_tokens: 8192,
      temperature: 0.7
    }

    if (this.toolDefinitions.length > 0) {
      body.tools = this.buildTools()
      body.tool_choice = 'auto'
      console.log(`[LLM] tools: ${this.toolDefinitions.map(t => t.name).join(', ')}`)
    }

    let response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok && this.hasImageContent(effectivePrompt)) {
      console.log(`[LLM] API rejected image content (${response.status}), retrying with text-only`)
      effectivePrompt = this.stripImages(effectivePrompt)
      body = {
        model: config.model,
        messages: this.buildMessages(effectivePrompt),
        max_tokens: 8192,
        temperature: 0.7
      }
      if (this.toolDefinitions.length > 0) {
        body.tools = this.buildTools()
        body.tool_choice = 'auto'
      }

      response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      return {
        text: `API Error (${response.status}): ${errorText}`,
        done: true
      }
    }

    const data = await response.json()
    return this.parseResponse(data)
  }

  async streamQuery(
    prompt: PromptSegment[],
    config: AgentConfig,
    onToken: (token: string) => void
  ): Promise<LLMResponse> {
    if (!config.apiKey) {
      const errorMsg = 'Error: No API key configured. Please set your API key in Settings.'
      onToken(errorMsg)
      return { text: errorMsg, done: true }
    }

    let effectivePrompt = prompt
    let body: Record<string, unknown> = {
      model: config.model,
      messages: this.buildMessages(prompt),
      max_tokens: 8192,
      temperature: 0.7,
      stream: true
    }

    if (this.toolDefinitions.length > 0) {
      body.tools = this.buildTools()
      body.tool_choice = 'auto'
      console.log(`[LLM] tools: ${this.toolDefinitions.map(t => t.name).join(', ')}`)
    }

    let response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok && this.hasImageContent(effectivePrompt)) {
      const errorText = await response.text()
      console.log(`[LLM] API rejected image content (${response.status}), retrying with text-only`)
      console.log(`[LLM] Error: ${errorText.substring(0, 200)}`)

      effectivePrompt = this.stripImages(effectivePrompt)
      body = {
        model: config.model,
        messages: this.buildMessages(effectivePrompt),
        max_tokens: 8192,
        temperature: 0.7,
        stream: true
      }
      if (this.toolDefinitions.length > 0) {
        body.tools = this.buildTools()
        body.tool_choice = 'auto'
      }

      response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      onToken(`API Error (${response.status}): ${errorText}`)
      return {
        text: `API Error (${response.status}): ${errorText}`,
        done: true
      }
    }

    if (!response.body) {
      return { text: 'Error: No response body', done: true }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let reasoningContent = ''
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>()
    let hasToolCall = false

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          if (trimmed === 'data: [DONE]') continue

          try {
            const json = JSON.parse(trimmed.slice(6))
            const delta = json.choices?.[0]?.delta
            if (!delta) continue

            if (delta.reasoning_content) {
              reasoningContent += delta.reasoning_content
            }

            if (delta.content) {
              fullText += delta.content
              onToken(delta.content)
            }

            if (delta.tool_calls) {
              hasToolCall = true
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                const existing = toolCallMap.get(idx) || { id: '', name: '', args: '' }
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.name = tc.function.name
                if (tc.function?.arguments) existing.args += tc.function.arguments
                toolCallMap.set(idx, existing)
              }
            }
          } catch {
            // partial JSON, skip
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (hasToolCall) {
      const toolCalls = Array.from(toolCallMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => {
          let parsedArgs: Record<string, unknown> = {}
          try {
            parsedArgs = tc.args ? JSON.parse(tc.args) : {}
          } catch {
            parsedArgs = { raw: tc.args }
          }
          return {
            id: tc.id || cryptoRandomId(),
            name: tc.name,
            args: parsedArgs
          }
        })
        .filter(tc => tc.name)

      if (toolCalls.length > 0) {
        return {
          text: fullText,
          reasoningContent: reasoningContent || undefined,
          toolCalls,
          done: false
        }
      }
    }

    return {
      text: fullText,
      reasoningContent: reasoningContent || undefined,
      done: true
    }
  }

  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const choices = data.choices as Array<Record<string, unknown>> | undefined
    const choice = choices?.[0]
    if (!choice) {
      return { text: 'Error: No choices in response', done: true }
    }

    const message = choice.message as Record<string, unknown> | undefined
    const text = (message?.content as string) || ''
    const reasoning = (message?.reasoning_content as string) || undefined

    const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined
    let toolCalls: LLMResponse['toolCalls'] | undefined
    if (rawToolCalls && rawToolCalls.length > 0) {
      toolCalls = rawToolCalls.map(tc => {
        const fn = tc.function as Record<string, string>
        return {
          id: (tc.id as string) || cryptoRandomId(),
          name: fn.name,
          args: fn.arguments ? JSON.parse(fn.arguments) : {}
        }
      })
    }

    const usage = data.usage as Record<string, number> | undefined
    return {
      text,
      reasoningContent: reasoning,
      toolCalls,
      done: !toolCalls?.length,
      usage: usage ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens
      } : undefined
    }
  }
}
