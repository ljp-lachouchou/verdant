import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { dirname } from 'path'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

export class FileReadTool implements Tool {
  definition = {
    name: 'read',
    description: 'Read the contents of a file.',
    parameters: [
      {
        name: 'path',
        type: 'string' as const,
        description: 'Path to the file to read',
        required: true
      },
      {
        name: 'encoding',
        type: 'string' as const,
        description: 'File encoding (default: utf8)',
        required: false,
        default: 'utf8'
      }
    ]
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const filePath = args.path as string
    const encoding = (args.encoding as BufferEncoding) || 'utf8'

    if (!filePath) {
      return { output: 'Error: No file path provided', isError: true }
    }

    try {
      const content = await readFile(filePath, { encoding })
      const stats = await stat(filePath)
      return {
        output: content,
        isError: false,
        metadata: { size: stats.size, path: filePath }
      }
    } catch (err) {
      return {
        output: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }
}

export class FileWriteTool implements Tool {
  definition = {
    name: 'write',
    description: 'Write text content to a file. Best for small patches, config files, or simple text. For writing code (components, features, applications), prefer the vibe_coding tool if available.',
    parameters: [
      {
        name: 'path',
        type: 'string' as const,
        description: 'Path to the file to write',
        required: true
      },
      {
        name: 'content',
        type: 'string' as const,
        description: 'Content to write to the file',
        required: true
      },
      {
        name: 'append',
        type: 'boolean' as const,
        description: 'If true, append to file instead of overwriting',
        required: false,
        default: false
      }
    ]
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const filePath = args.path as string
    const content = (args.content as string) ?? ''
    const append = (args.append as boolean) || false

    if (!filePath) {
      return { output: 'Error: "path" parameter is required for write tool. Usage: write(path="/path/to/file", content="file content")', isError: true }
    }

    try {
      await mkdir(dirname(filePath), { recursive: true })

      if (append) {
        const existing = await readFile(filePath, 'utf8').catch(() => '')
        await writeFile(filePath, existing + content, 'utf8')
      } else {
        await writeFile(filePath, content, 'utf8')
      }

      return {
        output: `Successfully wrote ${content.length} bytes to ${filePath}`,
        isError: false
      }
    } catch (err) {
      return {
        output: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }
}

export class FileEditTool implements Tool {
  definition = {
    name: 'edit',
    description: 'Edit a file by replacing old text with new text. Best for small targeted patches. For larger code changes, prefer the vibe_coding tool if available.',
    parameters: [
      {
        name: 'path',
        type: 'string' as const,
        description: 'Path to the file to edit',
        required: true
      },
      {
        name: 'oldText',
        type: 'string' as const,
        description: 'Text to find and replace',
        required: true
      },
      {
        name: 'newText',
        type: 'string' as const,
        description: 'Replacement text',
        required: true
      },
      {
        name: 'replaceAll',
        type: 'boolean' as const,
        description: 'Replace all occurrences',
        required: false,
        default: false
      }
    ]
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const filePath = args.path as string
    const oldText = args.oldText as string
    const newText = args.newText as string
    const replaceAll = (args.replaceAll as boolean) || false

    if (!filePath || !oldText || newText === undefined) {
      return { output: 'Error: path, oldText, and newText are required', isError: true }
    }

    try {
      const content = await readFile(filePath, 'utf8')
      const occurrences = content.split(oldText).length - 1

      if (occurrences === 0) {
        return { output: `Error: Text not found in ${filePath}`, isError: true }
      }

      if (!replaceAll && occurrences > 1) {
        return {
          output: `Error: Found ${occurrences} occurrences. Use replaceAll=true or provide more context.`,
          isError: true
        }
      }

      const newContent = replaceAll
        ? content.split(oldText).join(newText)
        : content.replace(oldText, newText)

      await writeFile(filePath, newContent, 'utf8')

      return {
        output: `Successfully replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${filePath}`,
        isError: false
      }
    } catch (err) {
      return {
        output: `Error editing file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }
}

export class ListDirectoryTool implements Tool {
  definition = {
    name: 'ls',
    description: 'List files and directories in a given path.',
    parameters: [
      {
        name: 'path',
        type: 'string' as const,
        description: 'Directory path to list',
        required: true
      }
    ]
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const dirPath = (args.path as string) || './'

    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      const formatted = entries.map(entry => {
        const type = entry.isDirectory() ? '📁' : entry.isSymbolicLink() ? '🔗' : '📄'
        return `${type} ${entry.name}`
      })
      return {
        output: formatted.join('\n') || '[empty directory]',
        isError: false
      }
    } catch (err) {
      return {
        output: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }
}
