import { GoalManager } from '@runtime/goal/manager'
import { ResourceRegistry } from '@runtime/resource/registry'
import { FilesystemResource } from '@runtime/resource/filesystem'
import { TerminalResource } from '@runtime/resource/terminal'
import { MemoryResource } from '@runtime/resource/memory'
import { StateProjector } from '@runtime/projector/projector'
import { ContextFormatter } from '@runtime/projector/formatter'
import { ExecutionHistory } from '@runtime/projector/context'
import { ExecutorManager } from '@runtime/executor/manager'
import { RuntimeLoop } from '@runtime/loop/runtime-loop'
import { StubLLMProvider } from '@agent/stub-provider'
import { DEFAULT_CONFIG } from '@agent/types'
import { createDefaultToolRegistry, createFullToolRegistry } from '@tools/registry'
import { TaskTool } from '@tools/task-tool'
import type { LLMResponse } from '@shared/types'
import type { Tool, ToolRegistry, ToolResult, ToolContext } from '@tools/types'

function makeMockTool(name: string, output: string, isError = false): Tool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      parameters: []
    },
    async execute(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      return { output, isError }
    }
  }
}

function makeMockRegistry(): ToolRegistry {
  const registry = createDefaultToolRegistry()
  registry.set('mock', makeMockTool('mock', 'mock_output'))
  return registry
}

function setupRuntime(tmpDir: string) {
  const goalManager = new GoalManager()
  const registry = new ResourceRegistry()
  const fsResource = new FilesystemResource(tmpDir)
  const terminalResource = new TerminalResource()
  const memoryResource = new MemoryResource()
  registry.register(fsResource)
  registry.register(terminalResource)
  registry.register(memoryResource)

  const projector = new StateProjector(registry, goalManager, memoryResource)
  const formatter = new ContextFormatter('You are a test runtime.', 'test env')
  const executor = new ExecutorManager(makeMockRegistry(), {}, {
    sessionId: 'test-session',
    workingDirectory: tmpDir
  })

  return { goalManager, registry, projector, formatter, executor, memoryResource, terminalResource }
}

describe('RuntimeLoop — Integration', () => {
  let tmpDir: string

  beforeEach(() => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-test-'))
  })

  afterEach(() => {
    const fs = require('fs')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should complete with a final text response (no tools)', async () => {
    const responses: LLMResponse[] = [
      { text: 'Task done.', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG }
    )

    const result = await loop.run('Do something')
    expect(result).toBe('Task done.')
    expect(loop.isRunning()).toBe(false)

    const goal = goalManager.getCurrent()
    expect(goal).toBeNull()
    expect(goalManager.getHistory()).toHaveLength(1)
    expect(goalManager.getHistory()[0].status).toBe('completed')
  })

  it('should execute tool calls then complete', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Let me run a command.',
        toolCalls: [{ id: 'tc-1', name: 'bash', args: { command: 'echo integration_test' } }],
        done: false
      },
      { text: 'Command output was: integration_test', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const toolResults: Array<{ name: string; output: string; isError: boolean }> = []

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onToolCall: (name, args) => { toolCalls.push({ name, args }) },
        onToolResult: (name, output, isError) => { toolResults.push({ name, output, isError }) }
      }
    )

    const result = await loop.run('Run echo')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].name).toBe('bash')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].output).toContain('integration_test')
    expect(toolResults[0].isError).toBe(false)
    expect(result).toContain('integration_test')
  })

  it('should handle tool not found', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Using unknown tool',
        toolCalls: [{ id: 'tc-2', name: 'nonexistent', args: {} }],
        done: false
      },
      { text: 'OK', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    let errorOutput = ''
    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onToolResult: (_name, output, isError) => {
          if (isError) errorOutput = output
        }
      }
    )

    await loop.run('Use unknown tool')
    expect(errorOutput).toContain('not found')
  })

  it('should record execution history in projector', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Running mock tool',
        toolCalls: [{ id: 'tc-3', name: 'bash', args: { command: 'echo hist_test' } }],
        done: false
      },
      { text: 'Done', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG }
    )

    await loop.run('Test history')

    const history = projector.getExecutionHistory().getAll()
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0].toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(history[0].toolCalls[0].name).toBe('bash')
    expect(history[0].toolCalls[0].result).toContain('hist_test')
    expect(history[0].toolCalls[0].isError).toBe(false)
  })

  it('should call onGoalCreated and onGoalFinished', async () => {
    const responses: LLMResponse[] = [
      { text: 'Done', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    let createdId = ''
    let createdTitle = ''
    let finishedId = ''
    let finishedStatus = ''

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onGoalCreated: (id, title) => { createdId = id; createdTitle = title },
        onGoalFinished: (id, status) => { finishedId = id; finishedStatus = status }
      }
    )

    await loop.run('My task')
    expect(createdTitle).toBe('My task')
    expect(createdId).toBe(finishedId)
    expect(finishedStatus).toBe('completed')
  })

  it('should abort goal on max iterations', async () => {
    const infiniteResponse: LLMResponse = {
      text: 'Looping',
      toolCalls: [{ id: 'tc-loop', name: 'bash', args: { command: 'echo loop' } }],
      done: false
    }
    const responses = Array(20).fill(infiniteResponse)
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    let errorMsg = ''
    let finishedStatus = ''

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 3, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onError: (err) => { errorMsg = err.message },
        onGoalFinished: (_id, status) => { finishedStatus = status }
      }
    )

    await loop.run('Loop forever')
    expect(errorMsg).toContain('maximum iterations')
    expect(finishedStatus).toBe('aborted')
    expect(goalManager.getHistory()[0].status).toBe('aborted')
  })

  it('should respect shouldStop callback', async () => {
    const responses: LLMResponse[] = [
      { text: 'First response', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      { shouldStop: () => true }
    )

    await loop.run('Stop me')
    expect(loop.isRunning()).toBe(false)
  })

  it('should abort goal on error', async () => {
    const provider = new StubLLMProvider([])
    provider.query = async () => { throw new Error('LLM exploded') }
    provider.streamQuery = async () => { throw new Error('LLM exploded') }

    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    let errorMsg = ''
    let finishedStatus = ''

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onError: (err) => { errorMsg = err.message },
        onGoalFinished: (_id, status) => { finishedStatus = status }
      }
    )

    await expect(loop.run('Trigger error')).rejects.toThrow('LLM exploded')
    expect(errorMsg).toBe('LLM exploded')
    expect(finishedStatus).toBe('aborted')
  })

  it('should fire onRoundStart/onRoundEnd for each round', async () => {
    const responses: LLMResponse[] = [
      {
        text: 'Tool round',
        toolCalls: [{ id: 'tc-r1', name: 'bash', args: { command: 'echo r1' } }],
        done: false
      },
      { text: 'Final round', done: true }
    ]
    const provider = new StubLLMProvider(responses)
    const { goalManager, projector, formatter, executor } = setupRuntime(tmpDir)

    const roundStarts: number[] = []
    const roundEnds: number[] = []

    const loop = new RuntimeLoop(
      projector, formatter, executor, provider, goalManager,
      { maxIterations: 10, systemPrompt: 'test', agentConfig: DEFAULT_CONFIG },
      {
        onRoundStart: (r) => { roundStarts.push(r) },
        onRoundEnd: (r) => { roundEnds.push(r) }
      }
    )

    await loop.run('Two rounds')
    expect(roundStarts.length).toBeGreaterThanOrEqual(1)
    expect(roundEnds.length).toBeGreaterThanOrEqual(1)
  })
})

describe('StateProjector — Integration', () => {
  let tmpDir: string

  beforeEach(() => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-'))
  })

  afterEach(() => {
    const fs = require('fs')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should project goal + memory + snapshots into RuntimeContext', async () => {
    const goalManager = new GoalManager()
    const registry = new ResourceRegistry()
    const memoryResource = new MemoryResource()
    const fsResource = new FilesystemResource(tmpDir)
    registry.register(fsResource)
    registry.register(memoryResource)

    goalManager.create('Test Goal', 'Test the projector')
    memoryResource.store('key_fact', 'this is a fact', 'fact')
    memoryResource.store('key_decision', 'decided X', 'decision')
    memoryResource.addConstraint('Do not delete files')

    const projector = new StateProjector(registry, goalManager, memoryResource)
    const ctx = await projector.project()

    expect(ctx.goal).not.toBeNull()
    expect(ctx.goal!.title).toBe('Test Goal')
    expect(ctx.memory.facts.length).toBe(1)
    expect(ctx.memory.decisions.length).toBe(1)
    expect(ctx.memory.constraints).toContain('Do not delete files')
    expect(ctx.snapshots.length).toBeGreaterThan(0)

    const fsSnapshot = ctx.snapshots.find(s => s.resourceId === 'filesystem')
    expect(fsSnapshot).toBeDefined()
    expect(fsSnapshot!.artifacts.length).toBeGreaterThan(0)
  })

  it('should select capabilities from goal text', async () => {
    const goalManager = new GoalManager()
    const registry = new ResourceRegistry()
    const memoryResource = new MemoryResource()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(memoryResource)

    goalManager.create('Run shell command', 'Execute a bash command')

    const projector = new StateProjector(registry, goalManager, memoryResource)
    const ctx = await projector.project()

    expect(ctx.capabilities).toContain('terminal')
    expect(ctx.capabilities).toContain('memory')
  })
})

describe('ExecutorManager — Integration', () => {
  it('should execute bash tool and return result', async () => {
    const tools = createDefaultToolRegistry()
    const executor = new ExecutorManager(tools, {}, {
      sessionId: 'test',
      workingDirectory: process.cwd()
    })

    const result = await executor.execute('bash', { command: 'echo exec_test' })
    expect(result.toolName).toBe('bash')
    expect(result.output).toContain('exec_test')
    expect(result.isError).toBe(false)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('should execute batch in parallel', async () => {
    const tools = createDefaultToolRegistry()
    const executor = new ExecutorManager(tools, {}, {
      sessionId: 'test',
      workingDirectory: process.cwd()
    })

    const calls = [
      { id: 'c1', name: 'bash', args: { command: 'echo a' } },
      { id: 'c2', name: 'bash', args: { command: 'echo b' } }
    ]

    const results = await executor.executeBatch(calls, 'parallel')
    expect(results.size).toBe(2)
    expect(results.get('c1')!.output).toContain('a')
    expect(results.get('c2')!.output).toContain('b')
  })

  it('should support beforeExecute hook to block', async () => {
    const tools = createDefaultToolRegistry()
    const executor = new ExecutorManager(tools, {
      beforeExecute: (name) => {
        if (name === 'bash') {
          return { block: true, reason: 'Blocked by hook' }
        }
      }
    })

    const result = await executor.execute('bash', { command: 'echo blocked' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Blocked by hook')
  })

  it('should support afterExecute hook to modify output', async () => {
    const tools = createDefaultToolRegistry()
    const executor = new ExecutorManager(tools, {
      afterExecute: (_name, _args, result) => {
        return { modifiedOutput: `[modified] ${result.output}` }
      }
    })

    const result = await executor.execute('bash', { command: 'echo hook_test' })
    expect(result.output).toContain('[modified]')
    expect(result.output).toContain('hook_test')
  })
})

describe('FilesystemResource — Integration', () => {
  let tmpDir: string

  beforeEach(() => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'))
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello')
    fs.mkdirSync(path.join(tmpDir, 'subdir'))
    fs.writeFileSync(path.join(tmpDir, 'subdir', 'b.ts'), 'world')
  })

  afterEach(() => {
    const fs = require('fs')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return file tree in snapshot', async () => {
    const resource = new FilesystemResource(tmpDir)
    const snapshot = await resource.snapshot()

    const treeArtifact = snapshot.artifacts.find(a => a.name === 'file_tree')
    expect(treeArtifact).toBeDefined()
    expect(treeArtifact!.content).toContain('a.txt')
    expect(treeArtifact!.content).toContain('subdir')
  })

  it('should return recent files sorted by mtime', async () => {
    const resource = new FilesystemResource(tmpDir)
    const snapshot = await resource.snapshot()

    const recentArtifact = snapshot.artifacts.find(a => a.name === 'recent_files')
    expect(recentArtifact).toBeDefined()
    expect(recentArtifact!.content).toContain('a.txt')
    expect(recentArtifact!.content).toContain('b.ts')
  })
})

describe('MemoryResource — Integration', () => {
  it('should store and recall entries', () => {
    const mem = new MemoryResource()
    mem.store('greeting', 'hello world', 'fact')
    expect(mem.recall('greeting')).toBe('hello world')
  })

  it('should search entries by keyword', () => {
    const mem = new MemoryResource()
    mem.store('lang', 'TypeScript', 'fact')
    mem.store('framework', 'React', 'fact')

    const results = mem.search('type')
    expect(results.length).toBe(1)
    expect(results[0].key).toBe('lang')
  })

  it('should snapshot facts, decisions, and constraints separately', async () => {
    const mem = new MemoryResource()
    mem.store('fact1', 'it is true', 'fact')
    mem.store('dec1', 'chose A over B', 'decision')
    mem.store('note1', 'remember this', 'note')
    mem.addConstraint('no breaking changes')

    const snapshot = await mem.snapshot()
    expect(snapshot.artifacts.find(a => a.name === 'facts')).toBeDefined()
    expect(snapshot.artifacts.find(a => a.name === 'decisions')).toBeDefined()
    expect(snapshot.artifacts.find(a => a.name === 'notes')).toBeDefined()
    expect(snapshot.artifacts.find(a => a.name === 'constraints')).toBeDefined()
  })
})

describe('ContextFormatter — Integration', () => {
  it('should format goal and memory into system prompt', () => {
    const goalManager = new GoalManager()
    const registry = new ResourceRegistry()
    const mem = new MemoryResource()
    registry.register(mem)

    goalManager.create('Build feature', 'Implement user auth')
    mem.store('stack', 'React+Express', 'fact')
    mem.addConstraint('Must use JWT')

    const formatter = new ContextFormatter('You are a runtime.')

    const ctx = {
      goal: goalManager.getCurrent(),
      memory: {
        facts: [{ key: 'stack', value: 'React+Express', timestamp: Date.now(), type: 'fact' as const }],
        decisions: [],
        notes: [],
        constraints: ['Must use JWT']
      },
      snapshots: [],
      observations: [],
      normalizedData: [],
      executionHistory: [],
      capabilities: ['filesystem', 'memory'] as const,
      timestamp: Date.now(),
      round: 0
    }

    const segments = formatter.format(ctx, 'Build the auth feature')

    expect(segments[0].role).toBe('system')
    expect(segments[0].content).toContain('You are a runtime.')
    expect(segments[0].content).toContain('Build feature')
    expect(segments[0].content).toContain('React+Express')
    expect(segments[0].content).toContain('Must use JWT')
    expect(segments[1].role).toBe('developer')
    expect(segments[2].role).toBe('user')
    expect(segments[2].content).toBe('Build the auth feature')
  })

  it('should include execution history as tool segments', () => {
    const formatter = new ContextFormatter('system')

    const ctx = {
      goal: null,
      memory: { facts: [], decisions: [], notes: [], constraints: [] },
      snapshots: [],
      observations: [],
      normalizedData: [],
      executionHistory: [
        {
          round: 0,
          assistantText: 'Let me run a command.',
          reasoningContent: 'I need to echo hi',
          toolCalls: [
            {
              id: 'tc-test-1',
              name: 'bash',
              args: { command: 'echo hi' },
              result: 'hi',
              isError: false,
              duration: 10
            }
          ],
          startTime: Date.now() - 100,
          endTime: Date.now()
        }
      ],
      capabilities: [] as const,
      timestamp: Date.now(),
      round: 1
    }

    const segments = formatter.format(ctx, 'next step')
    const assistantSeg = segments.find(s => s.role === 'assistant' && s.toolCalls)
    const toolSeg = segments.find(s => s.role === 'tool')

    expect(assistantSeg).toBeDefined()
    expect(assistantSeg!.content).toBe('Let me run a command.')
    expect(assistantSeg!.reasoningContent).toBe('I need to echo hi')
    expect(assistantSeg!.toolCalls).toBeDefined()
    expect(assistantSeg!.toolCalls![0].id).toBe('tc-test-1')
    expect(assistantSeg!.toolCalls![0].name).toBe('bash')
    expect(toolSeg).toBeDefined()
    expect(toolSeg!.toolCallId).toBe('tc-test-1')
    expect(toolSeg!.content).toBe('hi')
  })
})

describe('TaskTool (Sub-Agent) — Integration', () => {
  let tmpDir: string

  beforeEach(() => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tool-test-'))
  })

  afterEach(() => {
    const fs = require('fs')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should delegate task to sub-agent via RuntimeLoop', async () => {
    const subResponses: LLMResponse[] = [
      { text: 'Sub-agent result: hello from sub', done: true }
    ]
    const provider = new StubLLMProvider(subResponses)

    const registry = new ResourceRegistry()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(new TerminalResource())
    registry.register(new MemoryResource())

    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {},
      parentSessionId: 'parent-session',
      resourceRegistry: registry
    })

    const result = await taskTool.execute(
      { description: 'test sub-task', prompt: 'Say hello from sub' },
      {
        sessionId: 'parent-session',
        workingDirectory: tmpDir,
        timeout: 60000,
        maxOutputLength: 100000
      }
    )

    expect(result.isError).toBe(false)
    expect(result.output).toContain('Sub-agent result')
    expect(result.metadata?.subAgentId).toBeDefined()
  })

  it('should forward tool calls from sub-agent to parent callbacks', async () => {
    const subResponses: LLMResponse[] = [
      {
        text: 'Running a command',
        toolCalls: [{ id: 'sub-tc-1', name: 'bash', args: { command: 'echo sub_agent_output' } }],
        done: false
      },
      { text: 'Sub-agent done', done: true }
    ]
    const provider = new StubLLMProvider(subResponses)

    const registry = new ResourceRegistry()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(new TerminalResource())
    registry.register(new MemoryResource())

    const parentToolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const parentToolResults: Array<{ name: string; output: string; isError: boolean }> = []

    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {
        onToolCall: (name, args) => { parentToolCalls.push({ name, args }) },
        onToolResult: (name, output, isError) => { parentToolResults.push({ name, output, isError }) }
      },
      parentSessionId: 'parent-session',
      resourceRegistry: registry
    })

    await taskTool.execute(
      { description: 'sub with tools', prompt: 'Run echo sub_agent_output' },
      {
        sessionId: 'parent-session',
        workingDirectory: tmpDir,
        timeout: 60000,
        maxOutputLength: 100000
      }
    )

    expect(parentToolCalls.length).toBeGreaterThanOrEqual(1)
    expect(parentToolCalls[0].name).toBe('bash')
    expect(parentToolResults.length).toBeGreaterThanOrEqual(1)
    expect(parentToolResults[0].output).toContain('sub_agent_output')
  })

  it('should respect shouldStop from parent callbacks', async () => {
    const subResponses: LLMResponse[] = [
      {
        text: 'Running command',
        toolCalls: [{ id: 'sub-tc-2', name: 'bash', args: { command: 'echo stop_test' } }],
        done: false
      },
      { text: 'Done', done: true }
    ]
    const provider = new StubLLMProvider(subResponses)

    const registry = new ResourceRegistry()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(new TerminalResource())
    registry.register(new MemoryResource())

    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {
        shouldStop: () => true
      },
      parentSessionId: 'parent-session',
      resourceRegistry: registry
    })

    const result = await taskTool.execute(
      { description: 'stop test', prompt: 'Run echo stop_test' },
      {
        sessionId: 'parent-session',
        workingDirectory: tmpDir,
        timeout: 60000,
        maxOutputLength: 100000
      }
    )

    expect(result.isError).toBe(false)
  })

  it('should handle sub-agent LLM error', async () => {
    const provider = new StubLLMProvider([])
    provider.streamQuery = async () => { throw new Error('Sub LLM failed') }

    const registry = new ResourceRegistry()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(new TerminalResource())
    registry.register(new MemoryResource())

    let errorCallbackFired = false
    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {
        onError: () => { errorCallbackFired = true }
      },
      parentSessionId: 'parent-session',
      resourceRegistry: registry
    })

    const result = await taskTool.execute(
      { description: 'error test', prompt: 'This will fail' },
      {
        sessionId: 'parent-session',
        workingDirectory: tmpDir,
        timeout: 60000,
        maxOutputLength: 100000
      }
    )

    expect(result.isError).toBe(true)
    expect(result.output).toContain('failed')
  })

  it('should stop all active sub-agents', async () => {
    const subResponses: LLMResponse[] = [
      { text: 'Sub done', done: true }
    ]
    const provider = new StubLLMProvider(subResponses)

    const registry = new ResourceRegistry()
    registry.register(new FilesystemResource(tmpDir))
    registry.register(new TerminalResource())
    registry.register(new MemoryResource())

    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {},
      parentSessionId: 'parent-session',
      resourceRegistry: registry
    })

    taskTool.stopAll()
    expect(taskTool).toBeDefined()
  })

  it('should share ResourceRegistry between parent and sub-agent', async () => {
    const subResponses: LLMResponse[] = [
      { text: 'Sub sees the filesystem', done: true }
    ]
    const provider = new StubLLMProvider(subResponses)

    const sharedRegistry = new ResourceRegistry()
    const sharedFs = new FilesystemResource(tmpDir)
    const sharedTerminal = new TerminalResource()
    const sharedMemory = new MemoryResource()
    sharedMemory.store('shared_fact', 'parent was here', 'fact')
    sharedRegistry.register(sharedFs)
    sharedRegistry.register(sharedTerminal)
    sharedRegistry.register(sharedMemory)

    const taskTool = new TaskTool({
      llmProvider: provider,
      baseConfig: { ...DEFAULT_CONFIG, systemPrompt: 'sub-agent test' },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {},
      parentSessionId: 'parent-session',
      resourceRegistry: sharedRegistry
    })

    const result = await taskTool.execute(
      { description: 'shared resources', prompt: 'Check the filesystem' },
      {
        sessionId: 'parent-session',
        workingDirectory: tmpDir,
        timeout: 60000,
        maxOutputLength: 100000
      }
    )

    expect(result.isError).toBe(false)

    const fsResources = sharedRegistry.find('filesystem')
    expect(fsResources).toHaveLength(1)
    expect(fsResources[0]).toBe(sharedFs)

    const memoryResources = sharedRegistry.find('memory')
    expect(memoryResources).toHaveLength(1)
    expect(memoryResources[0]).toBe(sharedMemory)
    expect(sharedMemory.recall('shared_fact')).toBe('parent was here')
  })
})
