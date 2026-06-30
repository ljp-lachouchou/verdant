import type { PromptSegment, PromptContent } from '../../agent/types'
import type { RuntimeContext } from './context'
import { formatObservation } from '../observation/types'
import { formatNormalized } from '../normalizer/types'

export interface UserInputImage {
  url: string
  alt?: string
}

export class ContextFormatter {
  private systemPrompt: string
  private baseDeveloperPrompt: string

  constructor(systemPrompt: string, baseDeveloperPrompt: string = '') {
    this.systemPrompt = systemPrompt
    this.baseDeveloperPrompt = baseDeveloperPrompt
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  format(ctx: RuntimeContext, userInput: string, images?: UserInputImage[]): PromptSegment[] {
    const segments: PromptSegment[] = []

    segments.push({
      role: 'system',
      content: this.buildSystemContent(ctx)
    })

    const developerContent = this.buildDeveloperContent(ctx)
    if (developerContent) {
      segments.push({ role: 'developer', content: developerContent })
    }

    const userContent: PromptContent = images && images.length > 0
      ? [
          { type: 'text', text: userInput },
          ...images.map(img => ({ type: 'image_url' as const, image_url: { url: img.url } }))
        ]
      : userInput

    segments.push({ role: 'user', content: userContent })

    for (const record of ctx.executionHistory) {
      segments.push({
        role: 'assistant',
        content: record.assistantText,
        reasoningContent: record.reasoningContent,
        toolCalls: record.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          args: tc.args
        }))
      })

      for (const tc of record.toolCalls) {
        const toolContent = tc.observation
          ? formatObservation(tc.observation)
          : tc.result

        segments.push({
          role: 'tool',
          content: toolContent,
          toolCallId: tc.id
        })
      }
    }

    return segments
  }

  private buildDeveloperContent(ctx: RuntimeContext): string {
    const parts: string[] = []

    if (this.baseDeveloperPrompt) {
      parts.push(this.baseDeveloperPrompt)
    }

    const toolsSnapshot = ctx.snapshots.find(s => s.resourceId === 'tools')
    if (toolsSnapshot) {
      const directivesArtifact = toolsSnapshot.artifacts.find(a => a.name === 'tool_directives')
      if (directivesArtifact) {
        parts.push('\n## Tool Directives (MUST FOLLOW)')
        parts.push(directivesArtifact.content)
        parts.push('')
      }
    }

    parts.push('\n## Goal Verification (MUST FOLLOW)')
    parts.push('You MUST verify goal completion using Normalized Data and Observations, not assumptions.')
    parts.push('Normalized Data provides structured, comparable results from noisy sources (images, compile logs).')
    parts.push('Before declaring a task complete:')
    parts.push('1. Check Normalized Data — interpret the structured results against the Goal')
    parts.push('2. If image comparison shows low similarity, fix the identified diff areas')
    parts.push('3. If compile shows errors, fix them before proceeding')
    parts.push('4. If no Normalized Data is available, use evaluate_images or run build commands to generate it')
    parts.push('Do NOT say "I think this is done" — cite specific Normalized Data that proves it.')
    parts.push('')

    return parts.join('\n')
  }

  private buildSystemContent(ctx: RuntimeContext): string {
    const parts: string[] = [this.systemPrompt]

    parts.push('\n\n## Workspace State\n')

    if (ctx.goal) {
      parts.push(`### Goal\n${ctx.goal.title}\n${ctx.goal.description}\n`)
    }

    if (ctx.memory.constraints.length > 0) {
      parts.push('### Constraints')
      for (const c of ctx.memory.constraints) {
        parts.push(`- ${c}`)
      }
      parts.push('')
    }

    if (ctx.memory.facts.length > 0) {
      parts.push('### Known Facts')
      for (const f of ctx.memory.facts) {
        parts.push(`- ${f.key}: ${f.value}`)
      }
      parts.push('')
    }

    if (ctx.memory.decisions.length > 0) {
      parts.push('### Past Decisions')
      for (const d of ctx.memory.decisions) {
        parts.push(`- ${d.key}: ${d.value}`)
      }
      parts.push('')
    }

    if (ctx.observations.length > 0) {
      parts.push('### Recent Observations')
      for (const obs of ctx.observations.slice(-5)) {
        parts.push(formatObservation(obs))
        parts.push('')
      }
    }

    if (ctx.normalizedData.length > 0) {
      parts.push('### Normalized Data (Structured Results)')
      for (const nr of ctx.normalizedData) {
        parts.push(formatNormalized(nr))
        parts.push('')
      }
    }

    for (const snapshot of ctx.snapshots) {
      if (snapshot.resourceId === 'tools') continue

      parts.push(`### ${snapshot.resourceName}`)
      for (const artifact of snapshot.artifacts) {
        parts.push(`**${artifact.name}**:`)
        parts.push(artifact.content)
        parts.push('')
      }
    }

    return parts.join('\n')
  }
}
