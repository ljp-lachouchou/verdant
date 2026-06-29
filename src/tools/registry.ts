import type { Tool, ToolRegistry } from './types'
import { ShellTool, PTYTool } from './shell'
import { FileReadTool, FileWriteTool, FileEditTool, ListDirectoryTool } from './file'
import { TaskTool } from './task-tool'
import { VibeCodingTool } from './vibe-coding-tool'
import { BrowserTool } from './browser-tool'
import { AskUserTool } from './ask-user-tool'
import { SkillLoader, SkillTool } from './skill-tool'
import type { TaskToolConfig } from './task-tool'
import type { VibeCodingConfig } from '@shared/types'

export function createDefaultToolRegistry(): ToolRegistry {
  const registry: ToolRegistry = new Map()

  const tools: Tool[] = [
    new ShellTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new ListDirectoryTool()
  ]

  for (const tool of tools) {
    registry.set(tool.definition.name, tool)
  }

  return registry
}

export function createFullToolRegistry(): ToolRegistry {
  const registry = createDefaultToolRegistry()
  registry.set('pty', new PTYTool())
  registry.set('browser', new BrowserTool())
  registry.set('ask_user', new AskUserTool())
  return registry
}

export function createMultiAgentToolRegistry(taskToolConfig: TaskToolConfig, vibeCodingConfig?: VibeCodingConfig, skillLoader?: SkillLoader): ToolRegistry {
  const registry = createFullToolRegistry()
  registry.set('task', new TaskTool(taskToolConfig))
  if (vibeCodingConfig?.enabled) {
    registry.set('vibe_coding', new VibeCodingTool(vibeCodingConfig))
  }
  if (skillLoader && skillLoader.getAllSkills().length > 0) {
    registry.set('skill', new SkillTool(skillLoader))
  }
  return registry
}

export { ShellTool, PTYTool, FileReadTool, FileWriteTool, FileEditTool, ListDirectoryTool, TaskTool, VibeCodingTool, BrowserTool, AskUserTool, SkillLoader, SkillTool }
export type { Tool, ToolResult, ToolContext, ToolDefinition, ToolParameter } from './types'
export type { TaskToolConfig } from './task-tool'
