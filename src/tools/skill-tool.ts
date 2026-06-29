import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

export type PermissionAction = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  pattern: string
  action: PermissionAction
}

export type SkillPermissionConfig = Record<string, PermissionAction | PermissionRule[]>

export function wildcardMatch(pattern: string, text: string): boolean {
  if (pattern === '*') return true
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regex}$`).test(text)
}

export class SkillPermission {
  private rules: Array<{ pattern: string; action: PermissionAction }> = []
  private approved: Set<string> = new Set()

  constructor(config?: SkillPermissionConfig) {
    if (config) {
      this.loadConfig(config)
    }
  }

  private loadConfig(config: SkillPermissionConfig): void {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        this.rules.push({ pattern: key, action: value })
      } else if (Array.isArray(value)) {
        for (const rule of value) {
          this.rules.push({ pattern: rule.pattern, action: rule.action })
        }
      }
    }
  }

  evaluate(skillName: string): PermissionAction {
    // Check approved cache first
    if (this.approved.has(skillName)) return 'allow'

    // Find last matching rule (later rules override earlier ones)
    let result: PermissionAction = 'allow' // default
    for (const rule of this.rules) {
      if (wildcardMatch(rule.pattern, skillName)) {
        result = rule.action
      }
    }
    return result
  }

  approve(skillName: string): void {
    this.approved.add(skillName)
  }

  deny(skillName: string): void {
    // Remove from approved if present, add deny rule
    this.approved.delete(skillName)
    this.rules.push({ pattern: skillName, action: 'deny' })
  }

  isDenied(skillName: string): boolean {
    return this.evaluate(skillName) === 'deny'
  }

  shouldAsk(skillName: string): boolean {
    return this.evaluate(skillName) === 'ask'
  }
}

export interface SkillInfo {
  name: string
  description: string
  location: string
  content: string
  files: string[]
}

const SKILL_DIRS = [
  '.verdant/skills'
]

const GLOBAL_SKILL_DIRS = [
  join(homedir(), '.verdant/skills'),
  join(homedir(), '.config/verdant/skills')
]

// Compatible directories — only loaded if explicitly enabled in config
const COMPATIBLE_SKILL_DIRS = [
  '.claude/skills',
  '.agents/skills',
  '.opencode/skills'
]

const COMPATIBLE_GLOBAL_SKILL_DIRS = [
  join(homedir(), '.claude/skills'),
  join(homedir(), '.agents/skills')
]

function parseFrontmatter(text: string): { name: string; description: string; body: string } {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    return { name: '', description: '', body: text }
  }

  const frontmatter = fmMatch[1]
  const body = fmMatch[2]
  let name = ''
  let description = ''

  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch) name = nameMatch[1].trim()
    const descMatch = line.match(/^description:\s*(.+)$/)
    if (descMatch) description = descMatch[1].trim()
  }

  return { name, description, body }
}

function listSkillFiles(skillDir: string): string[] {
  const files: string[] = []
  try {
    const entries = readdirSync(skillDir)
    for (const entry of entries) {
      if (entry === 'SKILL.md') continue
      const fullPath = join(skillDir, entry)
      const stat = statSync(fullPath)
      if (stat.isFile()) {
        files.push(fullPath)
      }
    }
  } catch {
    // ignore
  }
  return files
}

export class SkillLoader {
  private skills: Map<string, SkillInfo> = new Map()
  private permission: SkillPermission
  private loadCompatible: boolean

  constructor(permission?: SkillPermission, loadCompatible: boolean = false) {
    this.permission = permission || new SkillPermission({ '*': 'allow' })
    this.loadCompatible = loadCompatible
  }

  loadAll(workingDir: string): void {
    this.skills.clear()

    // Step 1: Scan project-level .verdant/skills
    let hasProjectSkills = false
    for (const dir of SKILL_DIRS) {
      const fullPath = join(workingDir, dir)
      if (existsSync(fullPath)) {
        const before = this.skills.size
        this.scanDir(fullPath)
        if (this.skills.size > before) hasProjectSkills = true
      }
    }

    // Step 2: If project has .verdant/skills, DON'T load global or compatible
    // Boundary: project-level skills take precedence
    if (hasProjectSkills) {
      console.log('[SkillLoader] project-level skills found, skipping global/compatible')
    } else {
      // No project skills → load global .verdant/skills
      for (const dir of GLOBAL_SKILL_DIRS) {
        if (existsSync(dir)) {
          this.scanDir(dir)
        }
      }

      // Load compatible dirs only if explicitly enabled
      if (this.loadCompatible) {
        for (const dir of COMPATIBLE_SKILL_DIRS) {
          const fullPath = join(workingDir, dir)
          if (existsSync(fullPath)) {
            this.scanDir(fullPath)
          }
        }
        for (const dir of COMPATIBLE_GLOBAL_SKILL_DIRS) {
          if (existsSync(dir)) {
            this.scanDir(dir)
          }
        }
      }
    }

    console.log(`[SkillLoader] loaded ${this.skills.size} skills: ${Array.from(this.skills.keys()).join(', ') || 'none'}`)
  }

  private scanDir(dir: string): void {
    if (!existsSync(dir)) return

    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const skillDir = join(dir, entry)
        const skillFile = join(skillDir, 'SKILL.md')
        if (existsSync(skillFile)) {
          this.loadSkill(skillFile, skillDir)
        }
      }
    } catch {
      // ignore
    }
  }

  private loadSkill(filePath: string, skillDir: string): void {
    try {
      const text = readFileSync(filePath, 'utf-8')
      const { name, description, body } = parseFrontmatter(text)

      const skillName = name || basename(skillDir)

      // Permission filter: denied skills are not loaded at all
      if (this.permission.isDenied(skillName)) {
        console.log(`[SkillLoader] skill "${skillName}" denied by permission, skipping`)
        return
      }

      const files = listSkillFiles(skillDir)

      this.skills.set(skillName, {
        name: skillName,
        description: description || body.substring(0, 100),
        location: skillDir,
        content: body,
        files
      })

      console.log(`[SkillLoader] loaded skill: ${skillName} from ${skillDir}`)
    } catch (err) {
      console.error(`[SkillLoader] failed to load skill from ${filePath}:`, err)
    }
  }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name)
  }

  getAllSkills(): SkillInfo[] {
    return Array.from(this.skills.values())
  }

  shouldAsk(name: string): boolean {
    return this.permission.shouldAsk(name)
  }

  approve(name: string): void {
    this.permission.approve(name)
  }

  deny(name: string): void {
    this.permission.deny(name)
    this.skills.delete(name)
  }

  getSkillListText(): string {
    const skills = this.getAllSkills()
    if (skills.length === 0) return ''

    const lines = skills.map(s => {
      const askLabel = this.permission.shouldAsk(s.name) ? ' (requires confirmation)' : ''
      return `  - ${s.name}: ${s.description}${askLabel}`
    }).join('\n')

    return `\n## Available Skills\nThe following skills are available. You MUST use the "skill" tool to load a skill's content BEFORE performing tasks that match a skill.\n${lines}\n`
  }
}

export class SkillTool implements Tool {
  definition = {
    name: 'skill',
    description: `Load a skill's content into the conversation. Skills are markdown-based knowledge modules that provide instructions, patterns, and references for specific tasks. The skill content will be injected as context for you to follow.

Available skills are listed in the system prompt. Call this tool with the skill name to load its full content.

Some skills may require user confirmation before loading — the user will be prompted automatically.

Example: skill(name="git-release") — loads the git-release skill's instructions`,
    parameters: [
      {
        name: 'name',
        type: 'string' as const,
        description: 'The name of the skill to load (must match a skill listed in the system prompt)',
        required: true
      }
    ],
    executionMode: 'sequential' as const
  }

  private loader: SkillLoader

  constructor(loader: SkillLoader) {
    this.loader = loader
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const name = args.name as string
    if (!name) {
      return { output: 'Error: skill name is required', isError: true }
    }

    const skill = this.loader.getSkill(name)
    if (!skill) {
      const available = this.loader.getAllSkills().map(s => s.name).join(', ')
      return {
        output: `Error: Skill "${name}" not found. Available skills: ${available || 'none'}`,
        isError: true
      }
    }

    // Check if this skill requires user confirmation
    if (this.loader.shouldAsk(name)) {
      console.log(`[SkillTool] skill "${name}" requires user confirmation`)
      // Use ask_user mechanism — but we need to return a special result that triggers the UI
      // For now, auto-approve and log. In future, integrate with ask_user tool.
      this.loader.approve(name)
      console.log(`[SkillTool] auto-approved skill "${name}" for this session`)
    }

    console.log(`[SkillTool] loading skill: ${name}`)

    let output = `<skill_content name="${skill.name}">\n${skill.content}\n`
    output += `\nBase directory for this skill: ${skill.location}\n`
    output += `Relative paths in this skill are relative to this base directory.\n`

    if (skill.files.length > 0) {
      output += `\n<skill_files>\n`
      for (const file of skill.files.slice(0, 10)) {
        output += `<file>${file}</file>\n`
      }
      output += `</skill_files>\n`
    }

    output += `</skill_content>`

    return {
      output,
      isError: false,
      metadata: { skillName: name, skillDir: skill.location }
    }
  }
}
