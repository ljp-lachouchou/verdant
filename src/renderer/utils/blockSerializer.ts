import type { ContentBlock, Message } from '@shared/types'

export class BlockSerializer {
  static serialize(blocks: ContentBlock[]): string {
    return JSON.stringify(blocks)
  }

  static deserialize(data: string | undefined): ContentBlock[] | undefined {
    if (!data) return undefined
    try {
      const parsed = JSON.parse(data)
      if (Array.isArray(parsed)) return parsed as ContentBlock[]
    } catch {
      // ignore
    }
    return undefined
  }

  static hasRichBlocks(blocks?: ContentBlock[]): boolean {
    if (!blocks) return false
    return blocks.some(b => b.type === 'image' || b.type === 'skill')
  }

  static reconstructFromToolCalls(msg: Message): ContentBlock[] | undefined {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return undefined

    const blocks: ContentBlock[] = []

    for (const tc of msg.toolCalls) {
      blocks.push({
        type: 'tool_call',
        toolName: tc.toolName,
        command: (tc.args?.command as string) || (tc.args?.path as string) || '',
        output: tc.output,
        status: tc.status === 'error' ? 'error' : 'success'
      })

      // Reconstruct skill block from skill tool output
      if (tc.toolName === 'skill' && tc.output && tc.status !== 'error') {
        const nameMatch = tc.output.match(/name="([^"]+)"/)
        const skillName = nameMatch?.[1] || 'unknown'
        const descMatch = tc.output.match(/#\s+[^\n]+\n+([\s\S]*?)(?:\n##\s|$)/)
        const skillDesc = descMatch?.[1]?.trim() || tc.output.substring(0, 200)
        blocks.push({
          type: 'skill',
          skillName,
          skillDescription: skillDesc
        })
      }

      // Reconstruct image block from screenshot tool output
      if (tc.output && tc.status !== 'error') {
        const pathMatch = tc.output.match(/([^\s]+\.png)/i)
        const hasImage = tc.toolName === 'browser' && tc.args?.action === 'screenshot'
        if (hasImage && pathMatch) {
          // Can't restore base64 from DB, but keep the block so UI knows there was an image
          blocks.push({
            type: 'image',
            imagePath: '',
            imageAlt: 'Screenshot (expired)'
          })
        }
      }
    }

    return blocks.length > 0 ? blocks : undefined
  }

  static mergeBlocks(msg: Message): Message {
    // If message already has blocks, use them
    if (msg.blocks && msg.blocks.length > 0) {
      return msg
    }

    // Try to reconstruct from toolCalls
    const blocks = BlockSerializer.reconstructFromToolCalls(msg)
    if (blocks) {
      return { ...msg, blocks }
    }

    return msg
  }
}
