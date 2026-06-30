import type { Snapshot } from '../resource/types'
import type { ResourceRegistry } from '../resource/registry'
import type { Observation, ResourceChange } from './types'

interface ToolInterpreter {
  canHandle(toolName: string): boolean
  interpret(
    args: Record<string, unknown>,
    output: string,
    isError: boolean,
    preSnapshots: Snapshot[],
    postSnapshots: Snapshot[]
  ): { summary: string; changes: ResourceChange[] }
}

class BashInterpreter implements ToolInterpreter {
  canHandle(name: string): boolean {
    return name === 'bash' || name === 'pty'
  }

  interpret(args: Record<string, unknown>, output: string, isError: boolean, pre: Snapshot[], post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    const cmd = (args.command as string) || ''
    const changes: ResourceChange[] = []

    const preFs = pre.find(s => s.resourceId === 'filesystem')
    const postFs = post.find(s => s.resourceId === 'filesystem')
    if (preFs && postFs) {
      const preGit = preFs.artifacts.find(a => a.name === 'git_status')
      const postGit = postFs.artifacts.find(a => a.name === 'git_status')
      if (preGit?.content !== postGit?.content) {
        changes.push({
          resource: 'filesystem',
          change: `Git status changed\n  Before: ${(preGit?.content || 'clean').substring(0, 200)}\n  After: ${(postGit?.content || 'clean').substring(0, 200)}`
        })
      }

      const preRecent = preFs.artifacts.find(a => a.name === 'recent_files')
      const postRecent = postFs.artifacts.find(a => a.name === 'recent_files')
      if (preRecent?.content !== postRecent?.content) {
        changes.push({
          resource: 'filesystem',
          change: `Recently modified files changed`
        })
      }
    }

    const isBackground = output.includes('Background process started')
    if (isBackground) {
      changes.push({
        resource: 'terminal',
        change: `Background process launched: ${cmd.substring(0, 100)}`
      })
    }

    const summary = isError
      ? `Command failed: ${cmd.substring(0, 80)}\nError: ${output.substring(0, 300)}`
      : isBackground
        ? `Background process started: ${cmd.substring(0, 80)}`
        : `Command executed: ${cmd.substring(0, 80)}\nOutput: ${output.substring(0, 300)}`

    return { summary, changes }
  }
}

class WriteEditInterpreter implements ToolInterpreter {
  canHandle(name: string): boolean {
    return name === 'write' || name === 'edit'
  }

  interpret(args: Record<string, unknown>, output: string, isError: boolean, _pre: Snapshot[], post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    const path = (args.path as string) || ''
    const changes: ResourceChange[] = []

    if (!isError) {
      const postFs = post.find(s => s.resourceId === 'filesystem')
      const recent = postFs?.artifacts.find(a => a.name === 'recent_files')
      if (recent) {
        changes.push({
          resource: 'filesystem',
          change: `File ${path} ${output.includes('replaced') ? 'edited' : 'written'}`
        })
      }
    }

    const summary = isError
      ? `Failed to ${this.canHandle('write') ? 'write' : 'edit'} ${path}: ${output.substring(0, 200)}`
      : `${output.substring(0, 150)}`

    return { summary, changes }
  }
}

class BrowserInterpreter implements ToolInterpreter {
  canHandle(name: string): boolean {
    return name === 'browser'
  }

  interpret(args: Record<string, unknown>, output: string, isError: boolean, _pre: Snapshot[], _post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    const action = (args.action as string) || ''
    const url = (args.url as string) || ''
    const changes: ResourceChange[] = []

    if (action === 'navigate') {
      changes.push({ resource: 'browser', change: `Navigated to ${url}` })
    } else if (action === 'screenshot') {
      changes.push({ resource: 'browser', change: `Screenshot captured` })
    } else if (action === 'click') {
      changes.push({ resource: 'browser', change: `Clicked: ${(args.selector as string) || ''}` })
    }

    const summary = isError
      ? `Browser ${action} failed: ${output.substring(0, 200)}`
      : `Browser ${action}${url ? ` ${url}` : ''}: ${output.substring(0, 200)}`

    return { summary, changes }
  }
}

class VibeCodingInterpreter implements ToolInterpreter {
  canHandle(name: string): boolean {
    return name === 'vibe_coding'
  }

  interpret(args: Record<string, unknown>, output: string, isError: boolean, _pre: Snapshot[], post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    const prompt = (args.prompt as string) || ''
    const workingDir = (args.working_dir as string) || ''
    const changes: ResourceChange[] = []

    const postFs = post.find(s => s.resourceId === 'filesystem')
    if (postFs) {
      const recent = postFs.artifacts.find(a => a.name === 'recent_files')
      const gitStatus = postFs.artifacts.find(a => a.name === 'git_status')
      if (recent || gitStatus) {
        changes.push({
          resource: 'filesystem',
          change: `Code generated in ${workingDir}\n  Recent files: ${(recent?.content || 'none').substring(0, 200)}\n  Git: ${(gitStatus?.content || 'clean').substring(0, 200)}`
        })
      }
    }

    const summary = isError
      ? `Coding agent failed: ${output.substring(0, 300)}`
      : `Coding agent completed in ${workingDir}\nPrompt: ${prompt.substring(0, 100)}\nResult: ${output.substring(0, 300)}`

    return { summary, changes }
  }
}

class TaskInterpreter implements ToolInterpreter {
  canHandle(name: string): boolean {
    return name === 'task'
  }

  interpret(args: Record<string, unknown>, output: string, isError: boolean, _pre: Snapshot[], _post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    const desc = (args.description as string) || 'Sub-agent'
    const changes: ResourceChange[] = [
      { resource: 'memory', change: `Sub-agent "${desc}" ${isError ? 'failed' : 'completed'}` }
    ]

    const summary = isError
      ? `Sub-agent "${desc}" failed: ${output.substring(0, 300)}`
      : `Sub-agent "${desc}" completed: ${output.substring(0, 300)}`

    return { summary, changes }
  }
}

class DefaultInterpreter implements ToolInterpreter {
  canHandle(_name: string): boolean {
    return true
  }

  interpret(_args: Record<string, unknown>, output: string, isError: boolean, _pre: Snapshot[], _post: Snapshot[]): { summary: string; changes: ResourceChange[] } {
    return {
      summary: isError
        ? `Tool failed: ${output.substring(0, 300)}`
        : `Tool completed: ${output.substring(0, 300)}`,
      changes: []
    }
  }
}

const INTERPRETERS: ToolInterpreter[] = [
  new BashInterpreter(),
  new WriteEditInterpreter(),
  new BrowserInterpreter(),
  new VibeCodingInterpreter(),
  new TaskInterpreter(),
  new DefaultInterpreter()
]

export class ObservationBuilder {
  private registry: ResourceRegistry

  constructor(registry: ResourceRegistry) {
    this.registry = registry
  }

  async build(
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    toolOutput: string,
    isError: boolean,
    preSnapshots: Snapshot[]
  ): Promise<Observation> {
    const postSnapshots = await this.registry.snapshot()

    const interpreter = INTERPRETERS.find(i => i.canHandle(toolName)) || INTERPRETERS[INTERPRETERS.length - 1]
    const { summary, changes } = interpreter.interpret(toolArgs, toolOutput, isError, preSnapshots, postSnapshots)

    return {
      toolCallId,
      toolName,
      summary,
      resourceChanges: changes,
      worldState: postSnapshots,
      timestamp: Date.now()
    }
  }

  async buildBatch(
    toolCalls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
      output: string
      isError: boolean
    }>,
    preSnapshots: Snapshot[]
  ): Promise<Observation[]> {
    const observations: Observation[] = []
    for (const tc of toolCalls) {
      const obs = await this.build(tc.id, tc.name, tc.args, tc.output, tc.isError, preSnapshots)
      observations.push(obs)
    }
    return observations
  }
}
