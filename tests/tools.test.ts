import { ShellTool, FileReadTool, FileWriteTool, FileEditTool, ListDirectoryTool } from '@tools/registry'
import { join } from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

describe('ShellTool', () => {
  const tool = new ShellTool()
  const context = {
    sessionId: 'test',
    workingDirectory: process.cwd(),
    timeout: 10000,
    maxOutputLength: 100000
  }

  it('should execute echo command', async () => {
    const result = await tool.execute({ command: 'echo hello_world' }, context)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('hello_world')
  })

  it('should handle command errors', async () => {
    const result = await tool.execute({ command: 'nonexistent_command_xyz' }, context)
    expect(result.isError).toBe(true)
  })

  it('should block dangerous commands', async () => {
    const result = await tool.execute({ command: 'rm -rf /' }, context)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('blocked')
  })

  it('should respect timeout', async () => {
    const result = await tool.execute(
      { command: 'sleep 10', timeout: 500 },
      { ...context, timeout: 500 }
    )
    expect(result.output).toContain('timeout')
  }, 10000)

  it('should handle empty command', async () => {
    const result = await tool.execute({ command: '' }, context)
    expect(result.isError).toBe(true)
  })
})

describe('FileReadTool', () => {
  const tool = new FileReadTool()
  const context = {
    sessionId: 'test',
    workingDirectory: process.cwd(),
    timeout: 5000,
    maxOutputLength: 100000
  }
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should read file content', async () => {
    const filePath = join(tempDir, 'test.txt')
    await writeFile(filePath, 'Hello, World!')
    const result = await tool.execute({ path: filePath }, context)
    expect(result.isError).toBe(false)
    expect(result.output).toBe('Hello, World!')
  })

  it('should handle missing file', async () => {
    const result = await tool.execute({ path: join(tempDir, 'nonexistent.txt') }, context)
    expect(result.isError).toBe(true)
  })
})

describe('FileWriteTool', () => {
  const tool = new FileWriteTool()
  const context = {
    sessionId: 'test',
    workingDirectory: process.cwd(),
    timeout: 5000,
    maxOutputLength: 100000
  }
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should write file content', async () => {
    const filePath = join(tempDir, 'output.txt')
    const result = await tool.execute({ path: filePath, content: 'Test content' }, context)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Successfully wrote')
  })

  it('should create directories as needed', async () => {
    const filePath = join(tempDir, 'subdir', 'nested', 'file.txt')
    const result = await tool.execute({ path: filePath, content: 'Nested' }, context)
    expect(result.isError).toBe(false)
  })

  it('should append to file', async () => {
    const filePath = join(tempDir, 'append.txt')
    await tool.execute({ path: filePath, content: 'Line 1\n' }, context)
    const result = await tool.execute({ path: filePath, content: 'Line 2\n', append: true }, context)
    expect(result.isError).toBe(false)
  })
})

describe('FileEditTool', () => {
  const tool = new FileEditTool()
  const context = {
    sessionId: 'test',
    workingDirectory: process.cwd(),
    timeout: 5000,
    maxOutputLength: 100000
  }
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should replace text in file', async () => {
    const filePath = join(tempDir, 'edit.txt')
    await writeFile(filePath, 'Hello World\nFoo Bar')
    const result = await tool.execute({
      path: filePath,
      oldText: 'Hello World',
      newText: 'Hi Universe'
    }, context)
    expect(result.isError).toBe(false)
  })

  it('should fail when text not found', async () => {
    const filePath = join(tempDir, 'edit2.txt')
    await writeFile(filePath, 'Hello World')
    const result = await tool.execute({
      path: filePath,
      oldText: 'NonExistent',
      newText: 'Replacement'
    }, context)
    expect(result.isError).toBe(true)
  })

  it('should fail on multiple matches without replaceAll', async () => {
    const filePath = join(tempDir, 'edit3.txt')
    await writeFile(filePath, 'test test test')
    const result = await tool.execute({
      path: filePath,
      oldText: 'test',
      newText: 'replaced'
    }, context)
    expect(result.isError).toBe(true)
  })

  it('should replace all with replaceAll flag', async () => {
    const filePath = join(tempDir, 'edit4.txt')
    await writeFile(filePath, 'test test test')
    const result = await tool.execute({
      path: filePath,
      oldText: 'test',
      newText: 'replaced',
      replaceAll: true
    }, context)
    expect(result.isError).toBe(false)
  })
})

describe('ListDirectoryTool', () => {
  const tool = new ListDirectoryTool()
  const context = {
    sessionId: 'test',
    workingDirectory: process.cwd(),
    timeout: 5000,
    maxOutputLength: 100000
  }
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'))
    await writeFile(join(tempDir, 'file1.txt'), 'content')
    await writeFile(join(tempDir, 'file2.txt'), 'content')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should list directory contents', async () => {
    const result = await tool.execute({ path: tempDir }, context)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('file1.txt')
    expect(result.output).toContain('file2.txt')
  })
})
