import { spawn, ChildProcess } from 'child_process'
import { platform } from 'os'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'
import { randomUUID } from 'crypto'

export class ShellTool implements Tool {
  private activeProcesses = new Map<string, ChildProcess>()

  definition = {
    name: 'bash',
    description: 'Execute a shell command. On Windows uses cmd.exe, on Unix uses bash.',
    parameters: [
      {
        name: 'command',
        type: 'string' as const,
        description: 'The shell command to execute',
        required: true
      },
      {
        name: 'cwd',
        type: 'string' as const,
        description: 'Working directory for the command (defaults to current directory)',
        required: false
      },
      {
        name: 'timeout',
        type: 'number' as const,
        description: 'Timeout in milliseconds (defaults to config value)',
        required: false
      }
    ]
  }

  async execute(args: Record<string, unknown>, context: ToolContext, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const command = args.command as string
    const cwd = (args.cwd as string) || context.workingDirectory
    const timeout = (args.timeout as number) || context.timeout

    if (!command) {
      return { output: 'Error: No command provided', isError: true }
    }

    const blockedCommands = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'shutdown', 'reboot']
    const lowerCommand = command.toLowerCase()
    for (const blocked of blockedCommands) {
      if (lowerCommand.includes(blocked)) {
        return { output: `Error: Command contains blocked pattern: "${blocked}"`, isError: true }
      }
    }

    const isWindows = platform() === 'win32'
    const shell = isWindows ? 'cmd.exe' : 'bash'
    const shellArgs = isWindows ? ['/c', command] : ['-c', command]

    return new Promise<ToolResult>((resolve) => {
      const taskId = randomUUID()
      let stdout = ''
      let stderr = ''
      let killed = false

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })

      this.activeProcesses.set(taskId, child)

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2000)
      }, timeout)

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        stdout += text
        if (stdout.length > context.maxOutputLength) {
          stdout = stdout.substring(0, context.maxOutputLength) + '\n... [output truncated]'
          child.kill('SIGTERM')
        }
        onUpdate?.({ output: stdout })
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        this.activeProcesses.delete(taskId)
        resolve({
          output: `Process error: ${err.message}\n${stderr}`,
          isError: true
        })
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        this.activeProcesses.delete(taskId)

        let output = stdout
        if (stderr) {
          output += `\n[stderr]\n${stderr}`
        }
        if (killed) {
          output += `\n[process killed due to timeout (${timeout}ms)]`
        }
        if (code !== 0 && !killed) {
          output += `\n[exit code: ${code}]`
        }

        resolve({
          output: output || '[no output]',
          isError: code !== 0 && !killed,
          metadata: { exitCode: code, killed }
        })
      })
    })
  }

  killAll(): void {
    for (const [, proc] of this.activeProcesses) {
      proc.kill('SIGTERM')
    }
    this.activeProcesses.clear()
  }
}

export class PTYTool implements Tool {
  definition = {
    name: 'pty',
    description: 'Execute a command in a pseudo-terminal for interactive shell sessions.',
    parameters: [
      {
        name: 'command',
        type: 'string' as const,
        description: 'The command to execute in PTY',
        required: true
      },
      {
        name: 'cwd',
        type: 'string' as const,
        description: 'Working directory',
        required: false
      }
    ]
  }

  async execute(args: Record<string, unknown>, context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const command = args.command as string
    const cwd = (args.cwd as string) || context.workingDirectory

    try {
      const nodePty = await import('node-pty')
      const isWindows = platform() === 'win32'
      const shell = isWindows ? 'powershell.exe' : 'bash'
      const shellArgs = isWindows ? [] : ['-c', command]

      return new Promise<ToolResult>((resolve) => {
        let output = ''
        const ptyProc = nodePty.spawn(shell, shellArgs, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd,
          env: process.env as Record<string, string>
        })

        const timer = setTimeout(() => {
          ptyProc.kill()
          resolve({
            output: output + '\n[timeout]',
            isError: true
          })
        }, context.timeout)

        ptyProc.onData((data) => {
          output += data
          if (output.length > context.maxOutputLength) {
            ptyProc.kill()
            clearTimeout(timer)
            resolve({
              output: output.substring(0, context.maxOutputLength) + '\n[truncated]',
              isError: false
            })
          }
        })

        ptyProc.onExit(({ exitCode }) => {
          clearTimeout(timer)
          resolve({
            output: output || '[no output]',
            isError: exitCode !== 0,
            metadata: { exitCode }
          })
        })
      })
    } catch {
      return {
        output: 'Error: node-pty not available. Falling back to shell tool.',
        isError: true
      }
    }
  }
}
