import type { VisionProvider } from './provider'
import { loadBase64FromPath } from './provider'

export interface OllamaConfig {
  host: string
  model: string
}

export class OllamaVisionProvider implements VisionProvider {
  private host: string
  private model: string
  private _available: boolean | null = null

  constructor(config: OllamaConfig) {
    this.host = config.host.replace(/\/$/, '')
    this.model = config.model
  }

  id(): string {
    return 'ollama'
  }

  name(): string {
    return `Ollama (${this.model})`
  }

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) })
      this._available = res.ok
    } catch {
      this._available = false
    }
    return this._available
  }

  async describeImage(imagePath: string, prompt: string): Promise<string> {
    const { base64 } = loadBase64FromPath(imagePath)

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system' as const,
          content: 'You are a UI/UX expert. You must respond with detailed natural language descriptions only. Never output coordinates, numbers, or arrays.'
        },
        {
          role: 'user' as const,
          content: prompt,
          images: [base64]
        }
      ],
      stream: false,
      options: { temperature: 0.1, num_predict: 1000 }
    }

    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      return `[Ollama error: ${res.status}]`
    }

    const data = await res.json()
    let response = data.message?.content || data.response || ''

    if (/^\[?[\d.,\s]+\]?$/.test(response.trim())) {
      response = '[Vision model returned coordinates instead of description. The model may not support detailed image description.]'
    }

    return response
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.host}/api/tags`)
      if (!res.ok) return []
      const data = await res.json()
      return (data.models || []).map((m: { name: string }) => m.name)
    } catch {
      return []
    }
  }
}
