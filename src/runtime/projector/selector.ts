import type { Capability } from '../resource/types'
import type { Goal } from '../goal/types'

const KEYWORD_MAP: Record<Capability, string[]> = {
  filesystem: ['file', 'code', 'project', 'directory', 'folder', 'edit', 'write', 'read', 'path', 'src', 'source'],
  git: ['git', 'commit', 'branch', 'merge', 'diff', 'pull', 'push', 'rebase'],
  terminal: ['command', 'shell', 'bash', 'run', 'execute', 'build', 'test', 'npm', 'yarn', 'pnpm', 'make', 'docker'],
  browser: ['browser', 'web', 'url', 'page', 'screenshot', 'dom', 'click', 'navigate', 'html'],
  visual: ['screenshot', 'image', 'see', 'look', 'visual', 'ui', 'render', 'display'],
  memory: ['remember', 'recall', 'memory', 'history', 'context', 'previous', 'earlier']
}

export class CapabilitySelector {
  selectFromGoal(goal: Goal | null): Capability[] {
    if (!goal) return ['filesystem', 'git', 'terminal', 'visual', 'memory']

    const text = `${goal.title} ${goal.description}`.toLowerCase()
    const capabilities = new Set<Capability>(['memory'])

    for (const [cap, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords.some(kw => text.includes(kw))) {
        capabilities.add(cap as Capability)
      }
    }

    if (capabilities.size === 1) {
      return ['filesystem', 'git', 'terminal', 'visual', 'memory']
    }

    return Array.from(capabilities)
  }

  selectFromText(text: string): Capability[] {
    const lower = text.toLowerCase()
    const capabilities = new Set<Capability>(['memory'])

    for (const [cap, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords.some(kw => lower.includes(kw))) {
        capabilities.add(cap as Capability)
      }
    }

    if (capabilities.size === 1) {
      return ['filesystem', 'git', 'terminal', 'visual', 'memory']
    }

    return Array.from(capabilities)
  }

  merge(...capabilitySets: Capability[][]): Capability[] {
    const merged = new Set<Capability>()
    for (const set of capabilitySets) {
      for (const cap of set) {
        merged.add(cap)
      }
    }
    return Array.from(merged)
  }

  intersect(available: Capability[], required: Capability[]): Capability[] {
    return required.filter(c => available.includes(c))
  }
}
