import type { VisionProvider } from './provider'
import { DEFAULT_VISION_PROMPT } from './provider'

export interface ImageDescription {
  path: string
  description: string
}

export class VisionDescriber {
  private providers: VisionProvider[] = []
  private activeProvider: VisionProvider | null = null

  addProvider(provider: VisionProvider): void {
    this.providers.push(provider)
  }

  getProviders(): VisionProvider[] {
    return [...this.providers]
  }

  async isEnabled(): Promise<boolean> {
    for (const p of this.providers) {
      if (await p.isAvailable()) {
        this.activeProvider = p
        return true
      }
    }
    return false
  }

  getActiveProvider(): VisionProvider | null {
    return this.activeProvider
  }

  async describeImage(imagePath: string, prompt: string = DEFAULT_VISION_PROMPT): Promise<ImageDescription> {
    if (!this.activeProvider && !(await this.isEnabled())) {
      return { path: imagePath, description: '' }
    }

    const provider = this.activeProvider!
    try {
      const description = await provider.describeImage(imagePath, prompt)
      return { path: imagePath, description }
    } catch (err) {
      return { path: imagePath, description: `[${provider.id()} error: ${err instanceof Error ? err.message : String(err)}]` }
    }
  }

  async describeBoth(image1Path: string, image2Path: string): Promise<{ image1: ImageDescription; image2: ImageDescription }> {
    const [image1, image2] = await Promise.all([
      this.describeImage(image1Path, `${DEFAULT_VISION_PROMPT}\n\nThis is the TARGET design that the user wants to implement.`),
      this.describeImage(image2Path, `${DEFAULT_VISION_PROMPT}\n\nThis is the ACTUAL implementation screenshot that needs to be compared against the target.`)
    ])

    return { image1, image2 }
  }
}
