import { VibeCodingTool } from '../src/tools/vibe-coding-tool'
import type { VibeCodingConfig } from '../src/shared/types'
import * as fs from 'fs'

const mockConfig: VibeCodingConfig = {
  enabled: true,
  cliPath: '/tmp/mock_cli_tool.sh',
  argsTemplate: '{prompt}',
  workingDir: '/tmp',
  timeout: 10000
}

const context = {
  sessionId: 'test',
  workingDirectory: '/tmp',
  timeout: 10000,
  maxOutputLength: 100000
}

describe('VibeCodingTool', () => {
  let tool: VibeCodingTool

  beforeAll(() => {
    // Create mock CLI tool
    const script = `#!/bin/bash
echo "Mock CLI Tool v1.0"
echo "Received prompt: $1"
echo "---"
echo "Creating file: /tmp/mock_output.txt"
echo "Task completed: $1" > /tmp/mock_output.txt
echo "File created successfully."
`
    fs.writeFileSync('/tmp/mock_cli_tool.sh', script)
    fs.chmodSync('/tmp/mock_cli_tool.sh', 0o755)
  })

  afterAll(() => {
    try { fs.unlinkSync('/tmp/mock_cli_tool.sh') } catch {}
    try { fs.unlinkSync('/tmp/mock_output.txt') } catch {}
  })

  beforeEach(() => {
    tool = new VibeCodingTool(mockConfig)
  })

  it('should have correct tool definition', () => {
    expect(tool.definition.name).toBe('vibe_coding')
    expect(tool.definition.parameters).toHaveLength(2)
    expect(tool.definition.parameters[0].name).toBe('prompt')
    expect(tool.definition.parameters[0].required).toBe(true)
  })

  it('should execute CLI tool and return output', async () => {
    const result = await tool.execute(
      { prompt: 'Create a hello world file' },
      context
    )

    expect(result.isError).toBe(false)
    expect(result.output).toContain('Mock CLI Tool v1.0')
    expect(result.output).toContain('Create a hello world file')
    expect(result.output).toContain('File created successfully')
  })

  it('should create output file via CLI tool', async () => {
    await tool.execute(
      { prompt: 'Test file creation' },
      context
    )

    const content = fs.readFileSync('/tmp/mock_output.txt', 'utf8')
    expect(content).toContain('Test file creation')
  })

  it('should return error when not configured', async () => {
    const unconfiguredTool = new VibeCodingTool({
      enabled: false,
      cliPath: '',
      argsTemplate: '{prompt}',
      workingDir: '',
      timeout: 10000
    })

    const result = await unconfiguredTool.execute(
      { prompt: 'test' },
      context
    )

    expect(result.isError).toBe(true)
    expect(result.output).toContain('not configured')
  })

  it('should return error when prompt is missing', async () => {
    const result = await tool.execute({}, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain('prompt is required')
  })

  it('should return error when CLI path does not exist', async () => {
    const badTool = new VibeCodingTool({
      enabled: true,
      cliPath: '/nonexistent/tool',
      argsTemplate: '{prompt}',
      workingDir: '/tmp',
      timeout: 5000
    })

    const result = await badTool.execute(
      { prompt: 'test' },
      context
    )

    expect(result.isError).toBe(true)
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('should support custom args template', async () => {
    // Create a tool that echoes args
    const echoScript = `#!/bin/bash
echo "args: $@"
`
    fs.writeFileSync('/tmp/mock_echo.sh', echoScript)
    fs.chmodSync('/tmp/mock_echo.sh', 0o755)

    const echoTool = new VibeCodingTool({
      enabled: true,
      cliPath: '/tmp/mock_echo.sh',
      argsTemplate: '--message {prompt}',
      workingDir: '/tmp',
      timeout: 5000
    })

    const result = await echoTool.execute(
      { prompt: 'hello world' },
      context
    )

    expect(result.isError).toBe(false)
    expect(result.output).toContain('--message')
    expect(result.output).toContain('hello')

    try { fs.unlinkSync('/tmp/mock_echo.sh') } catch {}
  })

  it('should handle timeout', async () => {
    // Create a slow script
    const slowScript = `#!/bin/bash
sleep 10
echo "done"
`
    fs.writeFileSync('/tmp/mock_slow.sh', slowScript)
    fs.chmodSync('/tmp/mock_slow.sh', 0o755)

    const slowTool = new VibeCodingTool({
      enabled: true,
      cliPath: '/tmp/mock_slow.sh',
      argsTemplate: '{prompt}',
      workingDir: '/tmp',
      timeout: 2000
    })

    const result = await slowTool.execute(
      { prompt: 'test' },
      context
    )

    expect(result.output).toContain('timeout')

    try { fs.unlinkSync('/tmp/mock_slow.sh') } catch {}
  }, 15000)

  it('should allow updating config', () => {
    tool.setConfig({
      enabled: true,
      cliPath: '/different/path',
      argsTemplate: '--task {prompt}',
      workingDir: '/home',
      timeout: 60000
    })

    // Config update should not throw
    expect(true).toBe(true)
  })
})
