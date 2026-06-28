import type { LLMResponse, AgentConfig } from '@shared/types'
import type { LLMProvider, PromptSegment } from './types'

export class StubLLMProvider implements LLMProvider {
  private responses: LLMResponse[] = []
  private index = 0

  constructor(responses?: LLMResponse[]) {
    if (responses) {
      this.responses = responses
    }
  }

  setResponses(responses: LLMResponse[]): void {
    this.responses = responses
    this.index = 0
  }

  async query(_prompt: PromptSegment[], _config: AgentConfig): Promise<LLMResponse> {
    if (this.index < this.responses.length) {
      return this.responses[this.index++]
    }
    return {
      text: 'No more responses available.',
      done: true
    }
  }

  async streamQuery(
    prompt: PromptSegment[],
    _config: AgentConfig,
    onToken: (token: string) => void
  ): Promise<LLMResponse> {
    const response = await this.query(prompt, _config)
    const tokens = response.text.split(' ')
    for (const token of tokens) {
      onToken(token + ' ')
      await new Promise(r => setTimeout(r, 10))
    }
    return response
  }
}
