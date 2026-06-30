export type Capability =
  | 'filesystem'
  | 'git'
  | 'browser'
  | 'visual'
  | 'terminal'
  | 'memory'

export type ArtifactType = 'text' | 'json' | 'image' | 'file' | 'diff' | 'dom'

export interface SnapshotArtifact {
  type: ArtifactType
  name: string
  content: string
  metadata?: Record<string, unknown>
}

export interface Snapshot {
  resourceId: string
  resourceName: string
  capabilities: Capability[]
  timestamp: number
  metadata: Record<string, unknown>
  artifacts: SnapshotArtifact[]
}

export interface SnapshotContext {
  workingDirectory?: string
  maxArtifacts?: number
  filters?: Record<string, unknown>
}

export interface Resource {
  id(): string
  name(): string
  capabilities(): Capability[]
  snapshot(ctx?: SnapshotContext): Promise<Snapshot>
}

export interface ResourceInitOptions {
  workingDirectory?: string
  config?: Record<string, unknown>
}
