import type { Message, MessageRole, MessageType, CompactionResult } from '@shared/types'
import type { PromptManager, PromptSegment } from './types'
import { randomUUID } from 'crypto'

const MESSAGE_OVERHEAD_TOKENS = 4
const TOOL_DEF_OVERHEAD_TOKENS = 50

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

export class ChatPromptManager implements PromptManager {
  private messages: Message[] = []
  private systemPrompt: string
  private developerPrompt: string
  private sessionId: string
  private estimatedTokens: number = 0
  private filesRead: Set<string> = new Set()
  private filesModified: Set<string> = new Set()

  constructor(sessionId: string, systemPrompt: string, developerPrompt: string = '') {
    this.sessionId = sessionId
    this.systemPrompt = systemPrompt
    this.developerPrompt = developerPrompt
    this.recalculateTokens()
  }

  private createMessage(
    role: MessageRole,
    content: string,
    messageType: MessageType = 'text',
    extra?: Partial<Message>
  ): Message {
    const tokenCount = estimateTokens(content) + MESSAGE_OVERHEAD_TOKENS
    return {
      id: randomUUID(),
      sessionId: this.sessionId,
      role,
      messageType,
      content,
      timestamp: Date.now(),
      tokenCount,
      ...extra
    }
  }

  private recalculateTokens(): void {
    const systemTokens = estimateTokens(this.systemPrompt) + estimateTokens(this.developerPrompt) + TOOL_DEF_OVERHEAD_TOKENS
    const messageTokens = this.messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0)
    this.estimatedTokens = systemTokens + messageTokens
  }

  addSystemMessage(content: string): void {
    const msg = this.createMessage('system', content, 'text')
    this.messages.push(msg)
    this.estimatedTokens += msg.tokenCount || 0
  }

  addUserMessage(content: string): Message {
    const msg = this.createMessage('user', content, 'text')
    this.messages.push(msg)
    this.estimatedTokens += msg.tokenCount || 0
    return msg
  }

  addAssistantMessage(content: string, toolCalls?: Message['toolCalls'], reasoningContent?: string): Message {
    const msg = this.createMessage('assistant', content, toolCalls ? 'tool_use' : 'text', { toolCalls, reasoningContent })
    this.messages.push(msg)
    this.estimatedTokens += msg.tokenCount || 0
    if (toolCalls) {
      for (const tc of toolCalls) {
        this.estimatedTokens += estimateTokens(JSON.stringify(tc.args)) + MESSAGE_OVERHEAD_TOKENS
      }
    }
    return msg
  }

  addToolResult(toolCallId: string, toolName: string, output: string, isError: boolean): Message {
    const msg = this.createMessage('tool', output, 'tool_result', {
      toolCalls: [{
        id: toolCallId,
        toolName,
        args: {},
        output,
        status: isError ? 'error' : 'success',
        timestamp: Date.now()
      }],
      parentMessageId: toolCallId
    })
    this.messages.push(msg)
    this.estimatedTokens += msg.tokenCount || 0
    return msg
  }

  addSteeringMessage(content: string): Message {
    const msg = this.createMessage('user', content, 'steering', { llmVisible: true })
    this.messages.push(msg)
    this.estimatedTokens += msg.tokenCount || 0
    return msg
  }

  buildPrompt(): PromptSegment[] {
    const segments: PromptSegment[] = []

    segments.push({ role: 'system', content: this.systemPrompt })
    if (this.developerPrompt) {
      segments.push({ role: 'developer', content: this.developerPrompt })
    }

    for (const msg of this.messages) {
      if (msg.messageType === 'summary' || msg.isSummary) {
        segments.push({ role: 'system', content: msg.content })
        continue
      }

      if (msg.messageType === 'tool_result') {
        segments.push({
          role: 'tool',
          content: msg.content,
          toolCallId: msg.parentMessageId || msg.toolCalls?.[0]?.id
        })
        continue
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        segments.push({
          role: 'assistant',
          content: msg.content || '',
          reasoningContent: msg.reasoningContent,
          toolCalls: msg.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.toolName,
            args: tc.args
          }))
        })
        continue
      }

      segments.push({
        role: msg.role as PromptSegment['role'],
        content: msg.content,
        ...(msg.reasoningContent ? { reasoningContent: msg.reasoningContent } : {})
      })
    }

    return segments
  }

  convertToLlm(): PromptSegment[] {
    const segments: PromptSegment[] = []

    segments.push({ role: 'system', content: this.systemPrompt })
    if (this.developerPrompt) {
      segments.push({ role: 'developer', content: this.developerPrompt })
    }

    for (const msg of this.messages) {
      if (msg.isCompacted) continue
      if (msg.llmVisible === false) continue
      if (msg.messageType === 'notification') continue

      if (msg.messageType === 'summary' || msg.isSummary) {
        segments.push({ role: 'system', content: msg.content })
        continue
      }

      if (msg.messageType === 'tool_result') {
        segments.push({
          role: 'tool',
          content: msg.content,
          toolCallId: msg.parentMessageId || msg.toolCalls?.[0]?.id
        })
        continue
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        segments.push({
          role: 'assistant',
          content: msg.content || '',
          reasoningContent: msg.reasoningContent,
          toolCalls: msg.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.toolName,
            args: tc.args
          }))
        })
        continue
      }

      segments.push({
        role: msg.role as PromptSegment['role'],
        content: msg.content,
        ...(msg.reasoningContent ? { reasoningContent: msg.reasoningContent } : {})
      })
    }

    return segments
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getActiveMessages(): Message[] {
    return this.messages.filter(m => !m.isCompacted)
  }

  getContextTokenCount(): number {
    return this.estimatedTokens
  }

  getFilesRead(): string[] {
    return Array.from(this.filesRead)
  }

  getFilesModified(): string[] {
    return Array.from(this.filesModified)
  }

  trackFileAccess(path: string, modified: boolean): void {
    this.filesRead.add(path)
    if (modified) {
      this.filesModified.add(path)
    }
  }

  compact(summary: string): CompactionResult {
    const summaryTokens = estimateTokens(summary) + MESSAGE_OVERHEAD_TOKENS
    const oldMessages = this.messages.filter(m => !m.isSummary && !m.isCompacted)
    const recentMessages = this.messages.slice(-Math.min(20, this.messages.length))

    const tokensBefore = this.estimatedTokens

    const summaryMessage: Message = {
      id: randomUUID(),
      sessionId: this.sessionId,
      role: 'system',
      messageType: 'summary',
      content: summary,
      timestamp: Date.now(),
      isSummary: true,
      tokenCount: summaryTokens
    }

    this.messages = [summaryMessage, ...recentMessages]
    this.recalculateTokens()

    return {
      summary,
      compactedCount: oldMessages.length - recentMessages.length,
      tokensBefore,
      tokensAfter: this.estimatedTokens,
      summaryMessageId: summaryMessage.id,
      filesRead: Array.from(this.filesRead),
      filesModified: Array.from(this.filesModified)
    }
  }

  clear(): void {
    this.messages = []
    this.filesRead.clear()
    this.filesModified.clear()
    this.estimatedTokens = estimateTokens(this.systemPrompt) + estimateTokens(this.developerPrompt) + TOOL_DEF_OVERHEAD_TOKENS
  }

  loadMessages(messages: Message[]): void {
    this.messages = messages.filter(m => !m.isCompacted)
    this.recalculateTokens()
  }
}
