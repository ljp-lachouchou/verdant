import type { VisionProvider } from './provider'
import { loadBase64FromPath } from './provider'

export interface RemoteVisionConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
}

export class RemoteVisionProvider implements VisionProvider {
  private config: RemoteVisionConfig

  constructor(config: RemoteVisionConfig) {
    this.config = config
  }

  id(): string {
    return 'remote-vision'
  }

  name(): string {
    return `Remote (${this.config.model})`
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey && !!this.config.apiBaseUrl
  }

  async describeImage(imagePath: string, prompt: string): Promise<string> {
    const { base64, mediaType } = loadBase64FromPath(imagePath)

    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    }

    const res = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      return `[Remote vision error: ${res.status} ${errText.substring(0, 100)}]`
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }
}
