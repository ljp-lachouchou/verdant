import type { Goal } from '../goal/types'
import type { Snapshot } from '../resource/types'
import type { Observation } from '../observation/types'
import type { Normalizer, NormalizedResult } from './types'
import type { VisionResource } from '../resource/vision'

export class VisionNormalizer implements Normalizer {
  private visionResource: VisionResource

  constructor(visionResource: VisionResource) {
    this.visionResource = visionResource
  }

  id(): string {
    return 'vision'
  }

  name(): string {
    return 'Image Comparison Normalizer'
  }

  category(): string {
    return 'visual'
  }

  canNormalize(_goal: Goal, observations: Observation[], _worldState: Snapshot[]): boolean {
    const latestEval = this.visionResource.getLatestEvaluation()
    if (!latestEval) return false

    return observations.some(
      obs => obs.toolName === 'evaluate_images' || obs.toolName === 'browser'
    )
  }

  async normalize(_goal: Goal, _observations: Observation[], _worldState: Snapshot[]): Promise<NormalizedResult> {
    const latest = this.visionResource.getLatestEvaluation()

    if (!latest) {
      return {
        normalizerId: this.id(),
        normalizerName: this.name(),
        category: this.category(),
        summary: 'No image comparison performed yet.',
        data: { hasData: false },
        timestamp: Date.now()
      }
    }

    const topDiffRegions = latest.diffRegions
      .sort((a, b) => b.diffPercent - a.diffPercent)
      .slice(0, 5)
      .map(r => {
        const vPos = r.row < 3 ? 'top' : r.row < 5 ? 'middle' : 'bottom'
        const hPos = r.col < 3 ? 'left' : r.col < 5 ? 'center' : 'right'
        return { region: `${vPos}-${hPos}`, diff: r.diffPercent }
      })

    const summary = [
      `Image comparison result:`,
      `  Similarity: ${latest.similarity}%`,
      `  Dimensions: ${latest.dimensionMatch ? 'match' : 'mismatch'} (${latest.width1}x${latest.height1} vs ${latest.width2}x${latest.height2})`,
      `  Diff regions: ${latest.diffRegions.length} total, ${latest.diffRegions.filter(r => r.diffPercent > 30).length} significant`,
      topDiffRegions.length > 0
        ? `  Top diff areas: ${topDiffRegions.map(r => `${r.region}(${r.diff}%)`).join(', ')}`
        : `  No significant diff areas`
    ].join('\n')

    return {
      normalizerId: this.id(),
      normalizerName: this.name(),
      category: this.category(),
      summary,
      data: {
        similarity: latest.similarity,
        dimensionMatch: latest.dimensionMatch,
        dimensions: { target: `${latest.width1}x${latest.height1}`, actual: `${latest.width2}x${latest.height2}` },
        totalDiffRegions: latest.diffRegions.length,
        significantDiffRegions: latest.diffRegions.filter(r => r.diffPercent > 30).length,
        topDiffAreas: topDiffRegions
      },
      timestamp: Date.now()
    }
  }
}
