import type { Goal } from '../goal/types'
import type { Snapshot } from '../resource/types'
import type { Observation } from '../observation/types'
import type { Normalizer, NormalizedResult } from './types'

export class CompileNormalizer implements Normalizer {
  id(): string {
    return 'compile'
  }

  name(): string {
    return 'Compile Output Normalizer'
  }

  category(): string {
    return 'compile'
  }

  canNormalize(_goal: Goal, observations: Observation[], _worldState: Snapshot[]): boolean {
    return observations.some(obs => {
      const summary = obs.summary.toLowerCase()
      return summary.includes('npm run build') || summary.includes('vite build') ||
             summary.includes('tsc') || summary.includes('make') ||
             summary.includes('cargo build') || summary.includes('npm run dev')
    })
  }

  async normalize(_goal: Goal, observations: Observation[], _worldState: Snapshot[]): Promise<NormalizedResult> {
    const buildObs = observations.filter(obs => {
      const summary = obs.summary.toLowerCase()
      return summary.includes('npm run build') || summary.includes('vite build') ||
             summary.includes('tsc') || summary.includes('make') ||
             summary.includes('cargo build') || summary.includes('npm run dev')
    })

    if (buildObs.length === 0) {
      return {
        normalizerId: this.id(),
        normalizerName: this.name(),
        category: this.category(),
        summary: 'No build commands detected.',
        data: { hasData: false },
        timestamp: Date.now()
      }
    }

    const latest = buildObs[buildObs.length - 1]
    const output = latest.summary
    const lowerOutput = output.toLowerCase()

    const isError = lowerOutput.includes('error') || lowerOutput.includes('failed') || lowerOutput.includes('fail')
    const errorMatches = output.match(/error[:\s]+([^\n]+)/gi) || []
    const warningMatches = output.match(/warning[:\s]+([^\n]+)/gi) || []

    const summary = [
      `Compile output normalized:`,
      `  Status: ${isError ? 'FAILED' : 'SUCCESS'}`,
      `  Errors: ${isError ? errorMatches.length : 0}`,
      `  Warnings: ${warningMatches.length}`,
      isError && errorMatches.length > 0
        ? `  Top errors: ${errorMatches.slice(0, 3).map(e => e.substring(0, 100)).join('; ')}`
        : '',
      warningMatches.length > 0
        ? `  Top warnings: ${warningMatches.slice(0, 3).map(w => w.substring(0, 100)).join('; ')}`
        : ''
    ].filter(Boolean).join('\n')

    return {
      normalizerId: this.id(),
      normalizerName: this.name(),
      category: this.category(),
      summary,
      data: {
        success: !isError,
        errorCount: isError ? errorMatches.length : 0,
        warningCount: warningMatches.length,
        errors: errorMatches.slice(0, 5),
        warnings: warningMatches.slice(0, 5),
        rawCommand: latest.toolName
      },
      timestamp: Date.now()
    }
  }
}
