import { randomUUID } from 'crypto'
import type { Resource, Snapshot, SnapshotContext, SnapshotArtifact, Capability } from '../types'

export interface TerminalSession {
  id: string
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  startTime: number
  endTime?: number
  status: 'running' | 'completed' | 'error' | 'killed'
}

const MAX_SESSIONS_IN_SNAPSHOT = 10
const MAX_OUTPUT_LENGTH = 2000

export class TerminalResource implements Resource {
  private sessions: TerminalSession[] = []
  private activeSessions = new Map<string, TerminalSession>()

  id(): string {
    return 'terminal'
  }

  name(): string {
    return 'Terminal'
  }

  capabilities(): Capability[] {
    return ['terminal']
  }

  createSession(command: string, cwd: string): string {
    const session: TerminalSession = {
      id: randomUUID(),
      command,
      cwd,
      stdout: '',
      stderr: '',
      exitCode: null,
      startTime: Date.now(),
      status: 'running'
    }
    this.sessions.push(session)
    this.activeSessions.set(session.id, session)
    return session.id
  }

  updateSession(id: string, updates: Partial<TerminalSession>): void {
    const session = this.activeSessions.get(id)
    if (!session) return
    Object.assign(session, updates)
    if (updates.status && updates.status !== 'running') {
      session.endTime = Date.now()
      this.activeSessions.delete(id)
    }
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.find(s => s.id === id)
  }

  getActiveSessions(): TerminalSession[] {
    return Array.from(this.activeSessions.values())
  }

  getRecentSessions(count: number = MAX_SESSIONS_IN_SNAPSHOT): TerminalSession[] {
    return [...this.sessions]
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, count)
  }

  async snapshot(ctx?: SnapshotContext): Promise<Snapshot> {
    const recent = this.getRecentSessions(ctx?.maxArtifacts || MAX_SESSIONS_IN_SNAPSHOT)
    const artifacts: SnapshotArtifact[] = []

    if (this.activeSessions.size > 0) {
      artifacts.push({
        type: 'json',
        name: 'active_sessions',
        content: JSON.stringify(
          this.getActiveSessions().map(s => ({
            id: s.id,
            command: s.command,
            cwd: s.cwd,
            status: s.status,
            duration: Date.now() - s.startTime
          })),
          null,
          2
        )
      })
    }

    for (const session of recent) {
      const output = this.formatSessionOutput(session)
      artifacts.push({
        type: 'text',
        name: `session_${session.id.substring(0, 8)}`,
        content: output,
        metadata: {
          command: session.command,
          exitCode: session.exitCode,
          status: session.status,
          startTime: session.startTime,
          endTime: session.endTime
        }
      })
    }

    return {
      resourceId: this.id(),
      resourceName: this.name(),
      capabilities: this.capabilities(),
      timestamp: Date.now(),
      metadata: {
        totalSessions: this.sessions.length,
        activeSessions: this.activeSessions.size
      },
      artifacts
    }
  }

  private formatSessionOutput(session: TerminalSession): string {
    const parts: string[] = [
      `$ ${session.command}`,
      `cwd: ${session.cwd}`,
      `status: ${session.status}`
    ]

    if (session.stdout) {
      const truncated = session.stdout.length > MAX_OUTPUT_LENGTH
        ? session.stdout.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]'
        : session.stdout
      parts.push(`stdout:\n${truncated}`)
    }

    if (session.stderr) {
      const truncated = session.stderr.length > MAX_OUTPUT_LENGTH
        ? session.stderr.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]'
        : session.stderr
      parts.push(`stderr:\n${truncated}`)
    }

    if (session.exitCode !== null) {
      parts.push(`exit: ${session.exitCode}`)
    }

    return parts.join('\n')
  }

  clear(): void {
    this.sessions = []
    this.activeSessions.clear()
  }
}
