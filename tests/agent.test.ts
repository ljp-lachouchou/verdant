import { ChatPromptManager } from '@agent/prompt-manager'

describe('ChatPromptManager', () => {
  const sessionId = 'test-session'
  const systemPrompt = 'You are a test assistant.'
  const developerPrompt = 'Working directory: /test'

  let pm: ChatPromptManager

  beforeEach(() => {
    pm = new ChatPromptManager(sessionId, systemPrompt, developerPrompt)
  })

  it('should initialize with system and developer prompts', () => {
    const segments = pm.buildPrompt()
    expect(segments[0]).toEqual({ role: 'system', content: systemPrompt })
    expect(segments[1]).toEqual({ role: 'developer', content: developerPrompt })
  })

  it('should add user messages', () => {
    pm.addUserMessage('Hello')
    const segments = pm.buildPrompt()
    expect(segments).toHaveLength(3)
    expect(segments[2]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('should add assistant messages with tool calls', () => {
    const toolCalls = [{
      id: 'tc-1',
      toolName: 'bash',
      args: { command: 'echo test' },
      status: 'pending' as const,
      timestamp: Date.now()
    }]
    pm.addAssistantMessage('Running command', toolCalls)
    const messages = pm.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls).toEqual(toolCalls)
  })

  it('should add tool results', () => {
    pm.addToolResult('tc-1', 'bash', 'test output', false)
    const segments = pm.buildPrompt()
    const toolMsg = segments.find(s => s.role === 'tool')
    expect(toolMsg?.content).toContain('test output')
    expect(toolMsg?.toolCallId).toBe('tc-1')
  })

  it('should track token count', () => {
    const initial = pm.getContextTokenCount()
    pm.addUserMessage('This is a test message that adds tokens')
    expect(pm.getContextTokenCount()).toBeGreaterThan(initial)
  })

  it('should compact messages', () => {
    for (let i = 0; i < 30; i++) {
      pm.addUserMessage(`Message ${i}`)
      pm.addAssistantMessage(`Response ${i}`)
    }
    expect(pm.getMessages().length).toBe(60)

    pm.compact('Summary of previous conversation')

    expect(pm.getMessages().length).toBeLessThan(60)
    expect(pm.getMessages()[0].isSummary).toBe(true)
  })

  it('should clear all messages', () => {
    pm.addUserMessage('Hello')
    pm.addAssistantMessage('Hi there')
    pm.clear()
    expect(pm.getMessages()).toHaveLength(0)
  })

  it('should load messages from history', () => {
    const messages = [
      { id: '1', sessionId, role: 'user' as const, content: 'Loaded message', timestamp: Date.now() }
    ]
    pm.loadMessages(messages)
    expect(pm.getMessages()).toHaveLength(1)
    expect(pm.getMessages()[0].content).toBe('Loaded message')
  })
})
