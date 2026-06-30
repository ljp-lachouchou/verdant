import type { Snapshot } from '../resource/types'

export interface ResourceChange {
  resource: string
  change: string
  data?: Record<string, unknown>
}

export interface Observation {
  toolCallId: string
  toolName: string
  summary: string
  resourceChanges: ResourceChange[]
  worldState: Snapshot[]
  timestamp: number
}

export function formatObservation(obs: Observation): string {
  const parts: string[] = []

  parts.push(`[Observation] Tool: ${obs.toolName}`)
  parts.push(`Summary: ${obs.summary}`)

  if (obs.resourceChanges.length > 0) {
    parts.push('\nWorld Changes:')
    for (const change of obs.resourceChanges) {
      parts.push(`  • [${change.resource}] ${change.change}`)
    }
  }

  if (obs.worldState.length > 0) {
    parts.push('\nCurrent World State:')
    for (const snap of obs.worldState) {
      const artifactNames = snap.artifacts.map(a => a.name).join(', ')
      parts.push(`  • ${snap.resourceName}: ${artifactNames}`)
    }
  }

  return parts.join('\n')
}
