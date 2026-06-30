import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, accessSync, constants } from 'fs'
import { join } from 'path'
import { platform } from 'os'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'
import type { VibeCodingConfig } from '@shared/types'

let resolvedShell: string | null = null

function getShellPath(): string {
  if (resolvedShell) return resolvedShell
  if (platform() === 'win32') {
    resolvedShell = process.env.COMSPEC || 'cmd.exe'
    return resolvedShell
  }
  const candidates = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/bin/sh']
  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK)
      resolvedShell = c
      return resolvedShell
    } catch {
      // try next
    }
  }
  resolvedShell = process.env.SHELL || '/bin/sh'
  return resolvedShell
}

export class VibeCodingTool implements Tool {
  definition = {
    name: 'vibe_coding',
    description: `Coding agent — delegates to an external AI coding CLI (e.g. Claude Code, Aider). Use this as the PRIMARY tool for ANY coding task: creating new files, writing components, implementing features, fixing bugs, refactoring. The CLI agent has superior coding capabilities and works directly in the project directory with full file access. Simply describe what to build or fix — it handles the implementation.

Use write/edit only for small text patches or config tweaks. For real code, use vibe_coding.

After completion:
- Frontend files (HTML, web pages): use the "browser" tool to open and screenshot
- Backend code: consider running tests
- Always report what was created/modified to the user.`,
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

    const workingDir = (args.working_dir as string) || this.config.workingDir || context.workingDirectory || process.cwd()
    const timeout = this.config.timeout || context.timeout

    const cliArgs = this.buildArgs(prompt)

    let resolvedCliPath = this.config.cliPath
    if (!resolvedCliPath.startsWith('/')) {
      try {
        resolvedCliPath = execSync(`which ${resolvedCliPath} 2>/dev/null`, {
          env: { ...process.env, SHELL: '/bin/bash' },
          encoding: 'utf-8',
          timeout: 3000
        }).trim()
        if (!resolvedCliPath) resolvedCliPath = this.config.cliPath
      } catch {
        const commonPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
        for (const dir of commonPaths) {
          const fullPath = `${dir}/${this.config.cliPath}`
          if (existsSync(fullPath)) {
            resolvedCliPath = fullPath
            break
          }
        }
      }
    }

    console.log(`[VibeCoding] executing: ${resolvedCliPath} ${cliArgs.join(' ')}`)
    console.log(`[VibeCoding] working dir: ${workingDir}`)

    onUpdate?.({ output: `Starting ${this.config.cliPath}...\nPrompt: ${prompt}\nWorking dir: ${workingDir}` })

    // Execute CLI tool
    const cliResult = await this.executeCli(resolvedCliPath, cliArgs, workingDir, timeout, onUpdate)

    if (cliResult.isError) {
      return cliResult
    }

    // Verification
    const verifyType = this.config.verifyType || 'none'
    if (verifyType === 'none') {
      return cliResult
    }

    onUpdate?.({ output: `${cliResult.output}\n\n--- Running verification (${verifyType}) ---` })
    console.log(`[VibeCoding] verification: ${verifyType}`)

    let verifyOutput = cliResult.output
    const verifyMetadata = { ...cliResult.metadata }
    let hasVerifyError = false

    if (verifyType === 'screenshot' || verifyType === 'both') {
      const screenshotResult = await this.verifyScreenshot(onUpdate)
      verifyOutput += `\n\n### Screenshot Verification\n${screenshotResult.output}`
      if (screenshotResult.metadata?.screenshotPath) {
        verifyMetadata.screenshotPath = screenshotResult.metadata.screenshotPath
      }
      if (screenshotResult.isError) hasVerifyError = true
    }

    if (verifyType === 'test' || verifyType === 'both') {
      const testResult = await this.verifyTest(workingDir, onUpdate)
      verifyOutput += `\n\n### Test Verification\n${testResult.output}`
      if (testResult.isError) hasVerifyError = true
    }

    return {
      output: verifyOutput,
      isError: cliResult.isError || hasVerifyError,
      metadata: verifyMetadata
    }
  }

  private executeCli(cliPath: string, cliArgs: string[], workingDir: string, timeout: number, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false

      // Build command string — shell mode handles symlinks and PATH resolution
      const cmdString = [cliPath, ...cliArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`)].join(' ')
      const shellPath = getShellPath()
      const child = spawn(shellPath, [platform() === 'win32' ? '/c' : '-c', cmdString], {
        cwd: workingDir,
        env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 5000)
      }, timeout)

      try {
        child.stdin?.write(cliArgs.join(' ') + '\n')
        child.stdin?.end()
      } catch {
        // some tools don't read stdin
      }

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        stdout += text
        onUpdate?.({ output: stdout })
        if (stdout.length > 1000000) {
          stdout = stdout.substring(0, 1000000) + '\n... [output truncated]'
          child.kill('SIGTERM')
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          output: `Failed to start CLI tool: ${err.message}\nCheck that "${cliPath}" exists and is executable.\nstderr: ${stderr}`,
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
          metadata: { exitCode: code, killed, cliPath }
        })
      })
    })
  }

  private async verifyScreenshot(onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const url = this.config?.verifyUrl
    if (!url) {
      return { output: 'No verify URL configured. Skipping screenshot.', isError: false }
    }

    onUpdate?.({ output: `Taking screenshot of ${url}...` })
    console.log(`[VibeCoding] screenshot verification: ${url}`)

    try {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      const { mkdirSync } = await import('fs')
      const { tmpdir } = await import('os')
      const screenshotDir = join(tmpdir(), 'agent-screenshots')
      mkdirSync(screenshotDir, { recursive: true })
      const screenshotPath = join(screenshotDir, `vibe_verify_${Date.now()}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: false })
      await browser.close()

      const buf = readFileSync(screenshotPath)
      const base64 = `data:image/png;base64,${buf.toString('base64')}`

      return {
        output: `Screenshot captured: ${screenshotPath} (${buf.length} bytes)`,
        isError: false,
        metadata: { screenshotPath, screenshotBase64: base64 }
      }
    } catch (err) {
      return {
        output: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }

  private async verifyTest(workingDir: string, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const testCmd = this.config?.verifyCommand
    if (!testCmd) {
      return { output: 'No verify command configured. Skipping tests.', isError: false }
    }

    onUpdate?.({ output: `Running tests: ${testCmd}...` })
    console.log(`[VibeCoding] test verification: ${testCmd} in ${workingDir}`)

    return new Promise<ToolResult>((resolve) => {
      let stdout = ''
      let stderr = ''

      const child = spawn(getShellPath(), ['-c', testCmd], {
        cwd: workingDir,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
      }, 60000)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf8')
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
      })

      child.on('close', (code) => {
        clearTimeout(timer)

        let output = stdout
        if (stderr) {
          output += `\n[stderr]\n${stderr}`
        }

        const passed = code === 0
        const summary = passed ? '✅ Tests PASSED' : `❌ Tests FAILED (exit code: ${code})`

        resolve({
          output: `${summary}\n${output.substring(0, 3000)}`,
          isError: !passed
        })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          output: `Test command failed to start: ${err.message}`,
          isError: true
        })
      })
    })
  }

  private buildArgs(prompt: string): string[] {
    if (!this.config?.argsTemplate) {
      return [prompt]
    }

    const template = this.config.argsTemplate
    const cwd = this.config.workingDir || process.cwd()

    if (template.trim() === '{prompt}') {
      return [prompt]
    }

    const parts = template.split('{prompt}')
    const args: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].replace(/\{cwd\}/g, cwd).trim()
      if (part) {
        args.push(...part.split(/\s+/).filter(s => s.length > 0))
      }
      if (i < parts.length - 1) {
        args.push(prompt)
      }
    }

    return args.length > 0 ? args : [prompt]
  }
}
