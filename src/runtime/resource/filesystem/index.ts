import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

const execFileAsync = promisify(execFile)
import type { Resource, Snapshot, SnapshotContext, SnapshotArtifact, Capability } from '../types'

const MAX_FILE_TREE_DEPTH = 2
const MAX_DIFF_LENGTH = 5000
const MAX_RECENT_FILES = 20

export class FilesystemResource implements Resource {
  private workingDirectory: string

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory
  }

  id(): string {
    return 'filesystem'
  }

  name(): string {
    return 'Filesystem'
  }

  capabilities(): Capability[] {
    return ['filesystem', 'git']
  }

  async snapshot(ctx?: SnapshotContext): Promise<Snapshot> {
    const dir = ctx?.workingDirectory || this.workingDirectory
    const maxArtifacts = ctx?.maxArtifacts || 10

    const artifacts: SnapshotArtifact[] = []

    const treeArtifact = await this.getFileTree(dir)
    if (treeArtifact) artifacts.push(treeArtifact)

    const gitStatusArtifact = await this.getGitStatus(dir)
    if (gitStatusArtifact) artifacts.push(gitStatusArtifact)

    const gitDiffArtifact = await this.getGitDiff(dir)
    if (gitDiffArtifact) artifacts.push(gitDiffArtifact)

    const recentFilesArtifact = await this.getRecentFiles(dir)
    if (recentFilesArtifact) artifacts.push(recentFilesArtifact)

    return {
      resourceId: this.id(),
      resourceName: this.name(),
      capabilities: this.capabilities(),
      timestamp: Date.now(),
      metadata: {
        workingDirectory: dir,
        artifactCount: artifacts.length
      },
      artifacts: artifacts.slice(0, maxArtifacts)
    }
  }

  private async getFileTree(dir: string): Promise<SnapshotArtifact | null> {
    try {
      const tree = await this.buildTree(dir, '', 0)
      return {
        type: 'text',
        name: 'file_tree',
        content: tree,
        metadata: { root: dir }
      }
    } catch {
      return null
    }
  }

  private async buildTree(dir: string, prefix: string, depth: number): Promise<string> {
    if (depth >= MAX_FILE_TREE_DEPTH) return ''

    const entries = await readdir(dir, { withFileTypes: true })
    const visible = entries.filter(e =>
      !e.name.startsWith('.') &&
      e.name !== 'node_modules' &&
      e.name !== 'out' &&
      e.name !== 'dist'
    )

    const lines: string[] = []
    for (const entry of visible) {
      const icon = entry.isDirectory() ? '📁' : entry.isSymbolicLink() ? '🔗' : '📄'
      lines.push(`${prefix}${icon} ${entry.name}`)

      if (entry.isDirectory() && depth < MAX_FILE_TREE_DEPTH - 1) {
        const subtree = await this.buildTree(
          join(dir, entry.name),
          prefix + '  ',
          depth + 1
        )
        if (subtree) lines.push(subtree)
      }
    }
    return lines.join('\n')
  }

  private async getGitStatus(dir: string): Promise<SnapshotArtifact | null> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
      if (!stdout.trim()) return null
      return {
        type: 'text',
        name: 'git_status',
        content: stdout.trim(),
        metadata: { cwd: dir }
      }
    } catch {
      return null
    }
  }

  private async getGitDiff(dir: string): Promise<SnapshotArtifact | null> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
      if (!stdout.trim()) return null

      let content = stdout.trim()
      if (content.length > MAX_DIFF_LENGTH) {
        content = content.substring(0, MAX_DIFF_LENGTH) + '\n... [diff truncated]'
      }
      return {
        type: 'diff',
        name: 'git_diff',
        content,
        metadata: { cwd: dir }
      }
    } catch {
      return null
    }
  }

  private async getRecentFiles(dir: string): Promise<SnapshotArtifact | null> {
    try {
      const entries = await this.collectRecentFiles(dir, '', 0)
      entries.sort((a, b) => b.mtime - a.mtime)
      const top = entries.slice(0, MAX_RECENT_FILES)
      if (top.length === 0) return null

      const content = top
        .map(f => `${new Date(f.mtime).toISOString()} ${f.path}`)
        .join('\n')

      return {
        type: 'text',
        name: 'recent_files',
        content,
        metadata: { count: top.length, root: dir }
      }
    } catch {
      return null
    }
  }

  private async collectRecentFiles(
    dir: string,
    prefix: string,
    depth: number
  ): Promise<Array<{ path: string; mtime: number }>> {
    if (depth >= MAX_FILE_TREE_DEPTH) return []

    const entries = await readdir(dir, { withFileTypes: true })
    const results: Array<{ path: string; mtime: number }> = []

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

      const fullPath = join(dir, entry.name)
      const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isFile()) {
        try {
          const stats = await stat(fullPath)
          results.push({ path: displayPath, mtime: stats.mtimeMs })
        } catch {
          // skip
        }
      } else if (entry.isDirectory() && depth < MAX_FILE_TREE_DEPTH - 1) {
        const sub = await this.collectRecentFiles(fullPath, displayPath, depth + 1)
        results.push(...sub)
      }
    }
    return results
  }
}
