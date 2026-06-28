import { spawn } from 'child_process'
import { platform } from 'os'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'
import type { VibeCodingConfig } from '@shared/types'

export class VibeCodingTool implements Tool {
  definition = {
    name: 'vibe_coding',
    description: 'Delegate coding tasks to an external AI coding CLI tool (e.g. Claude Code, Aider, Cursor CLI). Use this for ANY programming task: writing code, fixing bugs, refactoring, creating projects. The CLI tool works directly in the project directory with full file access. Simply describe what you want to build or fix.',
    parameters: [
      {
        name: 'prompt',
        type: 'string' as const,
        description: 'The coding task description — what to build, fix, or modify. Be specific about files, languages, and requirements.',
        required: true
      },
      {
        name: 'working_dir',
        type: 'string' as const,
        description: 'Project directory path (defaults to configured working directory)',
        required: false
      }
    ],
    executionMode: 'sequential' as const
  }

  private config: VibeCodingConfig | undefined

  constructor(config?: VibeCodingConfig) {
    this.config = config
  }

  setConfig(config: VibeCodingConfig): void {
    this.config = config
  }

  async execute(args: Record<string, unknown>, context: ToolContext, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!this.config?.enabled || !this.config.cliPath) {
      return {
        output: 'Error: Vibe Coding is not configured. Please set up a CLI tool in Settings > Vibe Coding.',
        isError: true
      }
    }

    const prompt = args.prompt as string
    if (!prompt) {
      return { output: 'Error: prompt is required', isError: true }
    }

    const workingDir = (args.working_dir as string) || this.config.workingDir || context.workingDirectory
    const timeout = this.config.timeout || context.timeout

    // Build command args from template
    const cliArgs = this.buildArgs(prompt)

    const isWindows = platform() === 'win32'
    const shell = isWindows ? 'cmd.exe' : 'bash'
    const shellArgs = isWindows ? ['/c', this.config.cliPath, ...cliArgs] : ['-c', `"${this.config.cliPath} ${cliArgs.map(a => `'${a}'`).join(' ')}"`]

    console.log(`[VibeCoding] executing: ${this.config.cliPath} ${cliArgs.join(' ')}`)
    console.log(`[VibeCoding] working dir: ${workingDir}`)
    console.log(`[VibeCoding] prompt: ${prompt.substring(0, 100)}...`)

    onUpdate?.({ output: `Starting ${this.config.cliPath}...\nPrompt: ${prompt}\nWorking dir: ${workingDir}` })

    return new Promise<ToolResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 5000)
      }, timeout)

      // Send prompt via stdin if the tool reads from stdin
      try {
        child.stdin?.write(prompt + '\n')
        child.stdin?.end()
      } catch {
        // some tools don't read stdin
      }

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        stdout += text
        onUpdate?.({ output: stdout })
        if (stdout.length > context.maxOutputLength) {
          stdout = stdout.substring(0, context.maxOutputLength) + '\n... [output truncated]'
          child.kill('SIGTERM')
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          output: `Failed to start CLI tool: ${err.message}\nCheck that "${this.config!.cliPath}" exists and is executable.\nstderr: ${stderr}`,
          isError: true
        })
      })

      child.on('close', (code) => {
        clearTimeout(timer)

        let output = stdout
        if (stderr) {
          output += `\n\n[stderr]\n${stderr}`
        }
        if (killed) {
          output += `\n[process killed due to timeout (${timeout}ms)]`
        }
        if (code !== 0 && !killed) {
          output += `\n[exit code: ${code}]`
        }

        resolve({
          output: output || '[no output from CLI tool]',
          isError: code !== 0 && !killed,
          metadata: { exitCode: code, killed, cliPath: this.config!.cliPath }
        })
      })
    })
  }

  private buildArgs(prompt: string): string[] {
    if (!this.config?.argsTemplate) {
      return [prompt]
    }

    const template = this.config.argsTemplate
    const rendered = template
      .replace(/\{prompt\}/g, prompt)
      .replace(/\{cwd\}/g, this.config.workingDir || process.cwd())

    return rendered.split(/\s+/).filter(s => s.length > 0)
  }
}
