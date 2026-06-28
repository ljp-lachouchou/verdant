import { AgentLoop } from '@agent/loop'
import { StubLLMProvider } from '@agent/stub-provider'
import { DEFAULT_CONFIG } from '@agent/types'
import { createDefaultToolRegistry } from '@tools/registry'
import type { LLMResponse } from '@shared/types'

describe('AgentLoop', () => {
  it('should complete with a final text response', async () => {
    const responses: LLMResponse[] = [
      { text: 'Hello! How can I help you?', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()
    const loop = new AgentLoop('test', provider, tools, DEFAULT_CONFIG)

    const result = await loop.run('Hi')
    expect(result).toBe('Hello! How can I help you?')
  })

  it('should execute tool calls', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Let me check that for you.',
        toolCalls: [{ id: 'tc-1', name: 'bash', args: { command: 'echo test_output' } }],
        done: false
      },
      { text: 'The command output was: test_output', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()

    let toolCallName = ''
    let toolResult = ''

    const loop = new AgentLoop('test', provider, tools, DEFAULT_CONFIG, {
      onToolCall: (name) => { toolCallName = name },
      onToolResult: (_name, output) => { toolResult = output }
    })

    const result = await loop.run('Run echo test')
    expect(toolCallName).toBe('bash')
    expect(toolResult).toContain('test_output')
    expect(result).toContain('test_output')
  })

  it('should handle tool not found', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Using unknown tool',
        toolCalls: [{ id: 'tc-2', name: 'nonexistent_tool', args: {} }],
        done: false
      },
      { text: 'Sorry, that tool is not available.', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()

    let errorOutput = ''
    const loopWithCallback = new AgentLoop('test', provider, tools, DEFAULT_CONFIG, {
      onToolResult: (_name, output, isError) => {
        if (isError) errorOutput = output
      }
    })

    await loopWithCallback.run('Use unknown tool')
    expect(errorOutput).toContain('not found')
  })

  it('should handle blocked commands', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Running dangerous command',
        toolCalls: [{ id: 'tc-3', name: 'bash', args: { command: 'rm -rf /' } }],
        done: false
      },
      { text: 'OK', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()

    let result = ''
    let isError = false
    const loop = new AgentLoop('test', provider, tools, DEFAULT_CONFIG, {
      onToolResult: (_name, output, err) => {
        result = output
        isError = err
      }
    })

    await loop.run('Delete everything')
    expect(isError).toBe(true)
    expect(result).toContain('blocked')
  })

  it('should respect shouldStop callback', async () => {
    const responses: LLMResponse[] = [
      { text: 'Response 1', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()

    const loop = new AgentLoop('test', provider, tools, DEFAULT_CONFIG, {
      shouldStop: () => true
    })

    const result = await loop.run('Hi')
    expect(loop.isRunning()).toBe(false)
  })

  it('should respect max iterations', async () => {
    const infiniteToolResponse: LLMResponse = {
      text: 'Calling tool again',
      toolCalls: [{ id: 'tc-loop', name: 'bash', args: { command: 'echo loop' } }],
      done: false
    }

    const responses: LLMResponse[] = Array(100).fill(infiniteToolResponse)
    const provider = new StubLLMProvider(responses)
    const tools = createDefaultToolRegistry()

    const config = { ...DEFAULT_CONFIG, maxIterations: 3 }
    let errorMsg = ''
    const loop = new AgentLoop('test', provider, tools, config, {
      onError: (err) => { errorMsg = err.message }
    })

    await loop.run('Loop forever')
    expect(errorMsg).toContain('maximum iterations')
  })
})
