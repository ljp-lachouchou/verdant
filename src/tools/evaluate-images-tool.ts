import type { Tool, ToolResult, ToolContext } from './types'
import type { VisionResource } from '@runtime/resource/vision'

export class EvaluateImagesTool implements Tool {
  private visionResource: VisionResource

  definition = {
    name: 'evaluate_images',
    description: `Describe and/or compare images using vision AI.

TWO MODES:

1. DESCRIBE a single image (before implementation):
   evaluate_images(image1="/path/to/target.png")
   Returns a detailed text description of the image. Use this FIRST when the user uploads an image, to understand what to build.

2. COMPARE two images (after implementation):
   evaluate_images(image1="/path/to/target.png", image2="/path/to/screenshot.png")
   Returns descriptions of BOTH images, similarity score, and diff regions. Use this after vibe_coding + browser screenshot.

When the user uploads an image, its path is in the message: "[User attached N image(s), saved to: /path]"
Call evaluate_images(image1="/path") to get the description FIRST, then use vibe_coding to implement.

Do NOT use Python/PIL/bash to analyze image pixels.
Do NOT ask the user to describe the image — use this tool instead.`,
    parameters: [
      {
        name: 'image1',
        type: 'string' as const,
        description: 'Path to the target/design image',
        required: true
      },
      {
        name: 'image2',
        type: 'string' as const,
        description: 'Path to the actual/screenshot image (optional — omit to only describe image1)',
        required: false
      }
    ],
    executionMode: 'sequential' as const
  }

  constructor(visionResource: VisionResource) {
    this.visionResource = visionResource
  }

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const image1 = args.image1 as string
    const image2 = (args.image2 as string) || undefined

    if (!image1) {
      return { output: 'Error: image1 is required', isError: true }
    }

    if (image2 && image1 === image2) {
      return {
        output: 'Error: image1 and image2 are the same path. Provide different images for comparison, or omit image2 to only describe image1.',
        isError: true
      }
    }

    if (!image2) {
      const evaluation = await this.visionResource.evaluateSingle(image1)
      return {
        output: evaluation.summary,
        isError: false,
        metadata: { mode: 'describe', similarity: evaluation.similarity }
      }
    }

    const evaluation = await this.visionResource.evaluate(image1, image2)

    return {
      output: evaluation.summary,
      isError: false,
      metadata: {
        mode: 'compare',
        similarity: evaluation.similarity,
        dimensionMatch: evaluation.dimensionMatch,
        diffRegionCount: evaluation.diffRegions.length
      }
    }
  }
}
