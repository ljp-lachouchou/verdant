import type { DatabaseManager } from './database'
import type { MessageRepository } from './messages'
import type { SessionRepository } from './sessions'
import type { LLMProvider, PromptSegment } from '@agent/types'
import type { AgentConfig, CompactionResult, Message } from '@shared/types'
import { randomUUID } from 'crypto'

const CHUNK_SIZE = 20
const MAX_SUMMARY_TOKENS = 2000

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer for an AI coding agent.
Your job is to create a dense, structured summary that preserves all critical context.

Format your summary as:
<compacted_history>
## User Intent
[What the user is trying to accomplish]

## Key Decisions
[Important decisions and their rationale]

## Files & Changes
[Files read, written, or modified — include paths and what changed]

## Tool Results
[Significant tool outputs — commands run, errors encountered, key findings]

## Unresolved Questions
[Open questions or incomplete tasks]

## Current State
[Where the conversation currently stands]
</compacted_history>`

export class CompactionService {
  constructor(
    private db: DatabaseManager,
    private messageRepo: MessageRepository,
    private sessionRepo: SessionRepository,
    private llmProvider: LLMProvider,
    private config: AgentConfig
  ) {}

  shouldCompact(sessionId: string): boolean {
    const tokenCount = this.messageRepo.getTokenCount(sessionId)
    return tokenCount > this.config.compactionThreshold
  }

  async compactSession(sessionId: string): Promise<CompactionResult | null> {
    const messages = this.messageRepo.getActiveMessages(sessionId)
    if (messages.length <= 4) return null

    const tokensBefore = messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0)
    if (tokensBefore <= this.config.compactionThreshold) return null

    const { toCompact, toKeep } = this.findCompactionPoint(messages)

    if (toCompact.length === 0) return null

    const summary = await this.generateFoldingSummary(toCompact)

    const summaryMessageId = randomUUID()
    const tokensAfter = estimateTokens(summary) + toKeep.reduce((sum, m) => sum + (m.tokenCount || 0), 0)

    this.db.transaction(() => {
      const compactBeforeTimestamp = toCompact[toCompact.length - 1].timestamp

      this.messageRepo.markCompacted(sessionId, compactBeforeTimestamp + 1)

      this.messageRepo.add({
        id: summaryMessageId,
        sessionId,
        role: 'system',
        messageType: 'summary',
        content: summary,
        isSummary: true,
        tokenCount: estimateTokens(summary),
        timestamp: compactBeforeTimestamp + 1
      })

      this.sessionRepo.touch(sessionId)
    })

    return {
      summary,
      compactedCount: toCompact.length,
      tokensBefore,
      tokensAfter,
      summaryMessageId,
      filesRead: [],
      filesModified: []
    }
  }

  private findCompactionPoint(messages: Message[]): { toCompact: Message[]; toKeep: Message[] } {
    const keepBudget = this.config.compactionKeepTokens
    let keepTokens = 0
    let keepStart = messages.length

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = messages[i].tokenCount || 0
      if (keepTokens + msgTokens > keepBudget) break
      keepTokens += msgTokens
      keepStart = i
    }

    if (keepStart === 0) {
      const mid = Math.floor(messages.length / 2)
      return {
        toCompact: messages.slice(0, mid),
        toKeep: messages.slice(mid)
      }
    }

    return {
      toCompact: messages.slice(0, keepStart),
      toKeep: messages.slice(keepStart)
    }
  }

  private async generateFoldingSummary(messages: Message[]): Promise<string> {
    if (messages.length <= CHUNK_SIZE) {
      return this.summarizeChunk(messages)
    }

    const chunks: Message[][] = []
    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      chunks.push(messages.slice(i, i + CHUNK_SIZE))
    }

    const chunkSummaries: string[] = []
    for (const chunk of chunks) {
      const summary = await this.summarizeChunk(chunk)
      chunkSummaries.push(summary)
    }

    if (chunkSummaries.length <= 3) {
      return this.summarizeSummaries(chunkSummaries)
    }

    const foldedSummaries: string[] = []
    const foldSize = Math.ceil(chunkSummaries.length / 3)
    for (let i = 0; i < chunkSummaries.length; i += foldSize) {
      const batch = chunkSummaries.slice(i, i + foldSize)
      if (batch.length === 1) {
        foldedSummaries.push(batch[0])
      } else {
        foldedSummaries.push(await this.summarizeSummaries(batch))
      }
    }

    return this.summarizeSummaries(foldedSummaries)
  }

  private async summarizeChunk(messages: Message[]): Promise<string> {
    const content = messages.map(m => this.formatMessageForSummary(m)).join('\n\n')

    const prompt: PromptSegment[] = [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `Summarize this conversation segment:\n\n${content}` }
    ]

    try {
      const response = await this.llmProvider.query(prompt, this.config)
      if (response.text && response.text.length > 50) {
        return response.text
      }
    } catch {
      // fall through to fallback
    }

    return this.fallbackSummary(messages)
  }

  private async summarizeSummaries(summaries: string[]): Promise<string> {
    const combined = summaries.map((s, i) => `### Segment ${i + 1}\n${s}`).join('\n\n---\n\n')

    const prompt: PromptSegment[] = [
      {
        role: 'system',
        content: `${SUMMARY_SYSTEM_PROMPT}\n\nYou are combining multiple partial summaries into one cohesive summary. Merge overlapping information, eliminate redundancy, and preserve all unique details.`
      },
      { role: 'user', content: `Combine these summaries into one:\n\n${combined}` }
    ]

    try {
      const response = await this.llmProvider.query(prompt, this.config)
      if (response.text && response.text.length > 50) {
        return response.text
      }
    } catch {
      // fall through
    }

    return summaries.join('\n\n---\n\n')
  }

  private formatMessageForSummary(m: Message): string {
    let line = `[${m.role}]`
    if (m.messageType === 'tool_use' && m.toolCalls?.length) {
      const tc = m.toolCalls[0]
      line += ` (tool: ${tc.toolName})`
      if (tc.args && Object.keys(tc.args).length > 0) {
        line += ` args: ${JSON.stringify(tc.args).substring(0, 200)}`
      }
    } else if (m.messageType === 'tool_result') {
      line += ` (tool_result)`
    }

    const content = m.content.substring(0, MAX_SUMMARY_TOKENS * 4)
    line += `: ${content}`

    if (m.toolCalls?.[0]?.output) {
      line += `\n  Output: ${m.toolCalls[0].output.substring(0, 500)}`
    }

    return line
  }

  private fallbackSummary(messages: Message[]): string {
    const parts = messages.map(m => {
      const content = m.content.substring(0, 200)
      const tools = m.toolCalls?.map(tc => `${tc.toolName}(${JSON.stringify(tc.args).substring(0, 100)})`).join(', ')
      return `[${m.role}]${tools ? ` [${tools}]` : ''}: ${content}`
    })
    return `<compacted_history>\n[Fallback summary — LLM unavailable]\n${parts.join('\n')}\n</compacted_history>`
  }

  async backupSession(sessionId: string, backupPath: string): Promise<void> {
    const messages = this.messageRepo.getBySession(sessionId, true)
    const session = this.sessionRepo.getById(sessionId)
    if (!session) return

    const backupData = { session, messages, exportedAt: Date.now() }
    const { writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const filename = `session_${sessionId}_${Date.now()}.json`
    await writeFile(join(backupPath, filename), JSON.stringify(backupData, null, 2), 'utf8')
  }
}

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}
