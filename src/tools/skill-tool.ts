import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

export interface SkillInfo {
  name: string
  description: string
  location: string
  content: string
  files: string[]
}

const SKILL_DIRS = [
  '.verdant/skills',
  '.opencode/skills',
  '.claude/skills',
  '.agents/skills'
]

const GLOBAL_SKILL_DIRS = [
  join(homedir(), '.verdant/skills'),
  join(homedir(), '.config/verdant/skills'),
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

  loadAll(workingDir: string): void {
    this.skills.clear()

    // Scan project-level skill dirs
    for (const dir of SKILL_DIRS) {
      const fullPath = join(workingDir, dir)
      this.scanDir(fullPath)
    }

    // Scan global skill dirs
    for (const dir of GLOBAL_SKILL_DIRS) {
      if (existsSync(dir)) {
        this.scanDir(dir)
      }
    }

    console.log(`[SkillLoader] loaded ${this.skills.size} skills: ${Array.from(this.skills.keys()).join(', ')}`)
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

  getSkillListText(): string {
    const skills = this.getAllSkills()
    if (skills.length === 0) return ''

    const lines = skills.map(s =>
      `  - ${s.name}: ${s.description}`).join('\n')

    return `\n## Available Skills\nThe following skills are available. Use the "skill" tool to load a skill's full content when needed:\n${lines}\n`
  }
}

export class SkillTool implements Tool {
  definition = {
    name: 'skill',
    description: `Load a skill's content into the conversation. Skills are markdown-based knowledge modules that provide instructions, patterns, and references for specific tasks. The skill content will be injected as context for you to follow.

Available skills are listed in the system prompt. Call this tool with the skill name to load its full content.

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

    console.log(`[SkillTool] loading skill: ${name}`)

    // Build skill content with file listing
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
