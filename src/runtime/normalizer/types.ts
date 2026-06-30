import type { Goal } from '../goal/types'
import type { Snapshot } from '../resource/types'
import type { Observation } from '../observation/types'

export interface NormalizedResult {
  normalizerId: string
  normalizerName: string
  category: string
  summary: string
  data: Record<string, unknown>
  timestamp: number
}

export function formatNormalized(result: NormalizedResult): string {
  const parts: string[] = []

  parts.push(`[Normalized] ${result.normalizerName} (${result.category})`)
  parts.push(result.summary)

  const dataEntries = Object.entries(result.data)
  if (dataEntries.length > 0) {
    parts.push('\nStructured Data:')
    for (const [key, value] of dataEntries) {
      const formatted = typeof value === 'object' && value !== null
        ? JSON.stringify(value).substring(0, 200)
        : String(value).substring(0, 200)
      parts.push(`  ${key}: ${formatted}`)
    }
  }

  return parts.join('\n')
}

export interface Normalizer {
  id(): string
  name(): string
  category(): string
  canNormalize(goal: Goal, observations: Observation[], worldState: Snapshot[]): boolean
  normalize(goal: Goal, observations: Observation[], worldState: Snapshot[]): Promise<NormalizedResult>
}
