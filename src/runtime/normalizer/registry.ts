import type { Goal } from '../goal/types'
import type { Snapshot } from '../resource/types'
import type { Observation } from '../observation/types'
import type { Normalizer, NormalizedResult } from './types'

export class NormalizerRegistry {
  private normalizers: Normalizer[] = []
  private results: NormalizedResult[] = []
  private maxResults = 20

  register(normalizer: Normalizer): void {
    this.normalizers.push(normalizer)
  }

  unregister(id: string): void {
    this.normalizers = this.normalizers.filter(n => n.id() !== id)
  }

  list(): Normalizer[] {
    return [...this.normalizers]
  }

  async normalizeAll(
    goal: Goal,
    observations: Observation[],
    worldState: Snapshot[]
  ): Promise<NormalizedResult[]> {
    const applicable = this.normalizers.filter(n =>
      n.canNormalize(goal, observations, worldState)
    )

    if (applicable.length === 0) return []

    const results = await Promise.allSettled(
      applicable.map(n => n.normalize(goal, observations, worldState))
    )

    const newResults: NormalizedResult[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newResults.push(result.value)
        this.results.push(result.value)
      }
    }

    if (this.results.length > this.maxResults) {
      this.results = this.results.slice(-this.maxResults)
    }

    return newResults
  }

  getRecent(count: number = 5): NormalizedResult[] {
    return this.results.slice(-count)
  }

  getAll(): NormalizedResult[] {
    return [...this.results]
  }

  getLatestByNormalizer(normalizerId: string): NormalizedResult | null {
    for (let i = this.results.length - 1; i >= 0; i--) {
      if (this.results[i].normalizerId === normalizerId) {
        return this.results[i]
      }
    }
    return null
  }

  clear(): void {
    this.results = []
  }
}
