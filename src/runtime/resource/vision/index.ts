import { nativeImage } from 'electron'
import { readFileSync } from 'fs'
import type { Resource, Snapshot, SnapshotContext, SnapshotArtifact, Capability } from '../types'
import type { VisionDescriber } from './describer'

export interface ImageEvaluation {
  image1Path: string
  image2Path: string
  similarity: number
  dimensionMatch: boolean
  width1: number
  height1: number
  width2: number
  height2: number
  diffRegions: Array<{ row: number; col: number; diffPercent: number }>
  description1: string
  description2: string
  summary: string
  timestamp: number
}

const GRID_SIZE = 8

function loadImageData(path: string): { width: number; height: number; data: Buffer } | null {
  try {
    let buf: Buffer
    if (path.startsWith('data:image/')) {
      const base64 = path.split(',')[1]
      buf = Buffer.from(base64, 'base64')
    } else {
      buf = readFileSync(path)
    }
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return null
    const size = img.getSize()
    const bitmap = img.toBitmap()
    return { width: size.width, height: size.height, data: bitmap }
  } catch {
    return null
  }
}

function compareImages(img1: { width: number; height: number; data: Buffer }, img2: { width: number; height: number; data: Buffer }): {
  similarity: number
  diffRegions: Array<{ row: number; col: number; diffPercent: number }>
} {
  const w = Math.min(img1.width, img2.width)
  const h = Math.min(img1.height, img2.height)
  const cellW = Math.floor(w / GRID_SIZE)
  const cellH = Math.floor(h / GRID_SIZE)

  if (cellW === 0 || cellH === 0) {
    return { similarity: 0, diffRegions: [] }
  }

  const cellDiffs: number[] = new Array(GRID_SIZE * GRID_SIZE).fill(0)
  const cellPixelCounts: number[] = new Array(GRID_SIZE * GRID_SIZE).fill(0)

  let totalDiff = 0
  let totalPixels = 0

  const step = Math.max(1, Math.floor(Math.min(w, h) / 500))

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx1 = (y * img1.width + x) * 4
      const idx2 = (y * img2.width + x) * 4

      const dr = Math.abs(img1.data[idx1] - img2.data[idx2])
      const dg = Math.abs(img1.data[idx1 + 1] - img2.data[idx1 + 1])
      const db = Math.abs(img1.data[idx1 + 2] - img2.data[idx1 + 2])
      const pixelDiff = (dr + dg + db) / 3 / 255

      totalDiff += pixelDiff
      totalPixels++

      const cellRow = Math.floor(y / cellH)
      const cellCol = Math.floor(x / cellW)
      const cellIdx = cellRow * GRID_SIZE + cellCol
      if (cellIdx < cellDiffs.length) {
        cellDiffs[cellIdx] += pixelDiff
        cellPixelCounts[cellIdx]++
      }
    }
  }

  const avgDiff = totalPixels > 0 ? totalDiff / totalPixels : 1
  let similarity = Math.round(Math.max(0, Math.min(100, (1 - avgDiff) * 100)))
  if (isNaN(similarity) || !isFinite(similarity)) similarity = 0

  const diffRegions: Array<{ row: number; col: number; diffPercent: number }> = []
  for (let i = 0; i < cellDiffs.length; i++) {
    if (cellPixelCounts[i] > 0) {
      const avgDiff = cellDiffs[i] / cellPixelCounts[i]
      if (avgDiff > 0.1) {
        diffRegions.push({
          row: Math.floor(i / GRID_SIZE),
          col: i % GRID_SIZE,
          diffPercent: Math.round(avgDiff * 100)
        })
      }
    }
  }

  return { similarity, diffRegions }
}

function buildSummary(
  image1Path: string,
  image2Path: string,
  similarity: number,
  dimensionMatch: boolean,
  w1: number, h1: number, w2: number, h2: number,
  diffRegions: Array<{ row: number; col: number; diffPercent: number }>,
  description1: string,
  description2: string
): string {
  const parts: string[] = []

  parts.push(`Image Evaluation Result:`)
  parts.push(`  Target: ${image1Path.substring(0, 80)}`)
  parts.push(`  Actual: ${image2Path.substring(0, 80)}`)
  parts.push(`  Similarity: ${similarity}%`)

  if (!dimensionMatch) {
    parts.push(`  Dimension Mismatch: ${w1}x${h1} vs ${w2}x${h2}`)
  } else {
    parts.push(`  Dimensions: ${w1}x${h1} (match)`)
  }

  if (description1) {
    parts.push(`\n  Target Image Description:`)
    parts.push(description1)
  }
  if (description2) {
    parts.push(`\n  Actual Image Description:`)
    parts.push(description2)
  }

  if (description1 && description2) {
    parts.push(`\n  Content Comparison:`)
    const d1Lines = description1.split('\n').filter(l => l.trim())
    const d2Lines = description2.split('\n').filter(l => l.trim())
    const d1Set = new Set(d1Lines.map(l => l.trim().toLowerCase()))
    const missing = d2Lines.filter(l => !d1Set.has(l.trim().toLowerCase()))
    const extra = d1Lines.filter(l => !new Set(d2Lines.map(l2 => l2.trim().toLowerCase())).has(l.trim().toLowerCase()))
    if (missing.length > 0) {
      parts.push(`  In actual but not in target (potential additions):`)
      for (const m of missing.slice(0, 5)) parts.push(`    + ${m.trim()}`)
    }
    if (extra.length > 0) {
      parts.push(`  In target but not in actual (potential missing elements):`)
      for (const e of extra.slice(0, 5)) parts.push(`    - ${e.trim()}`)
    }
  }

  if (diffRegions.length === 0) {
    parts.push(`  Diff Regions: None (images are nearly identical)`)
  } else {
    const topRegions = diffRegions
      .sort((a, b) => b.diffPercent - a.diffPercent)
      .slice(0, 10)
    parts.push(`  Pixel Diff Regions (${diffRegions.length} total, showing top ${topRegions.length}):`)
    for (const r of topRegions) {
      const position = describeRegion(r.row, r.col)
      parts.push(`    [${position}] ${r.diffPercent}% diff`)
    }
  }

  if (similarity >= 90) {
    parts.push(`  Verdict: PASS — Images are highly similar`)
  } else if (similarity >= 70) {
    parts.push(`  Verdict: CLOSE — Minor differences detected, review diff regions`)
  } else if (similarity >= 40) {
    parts.push(`  Verdict: PARTIAL — Significant differences detected, major rework needed`)
  } else {
    parts.push(`  Verdict: FAIL — Images are substantially different`)
  }

  return parts.join('\n')
}

function describeRegion(row: number, col: number): string {
  const vPos = row < GRID_SIZE / 3 ? 'top' : row < (GRID_SIZE * 2) / 3 ? 'middle' : 'bottom'
  const hPos = col < GRID_SIZE / 3 ? 'left' : col < (GRID_SIZE * 2) / 3 ? 'center' : 'right'
  return `${vPos}-${hPos}`
}

export class VisionResource implements Resource {
  private evaluations: ImageEvaluation[] = []
  private maxEvaluations = 10
  private describer?: VisionDescriber

  constructor(describer?: VisionDescriber) {
    this.describer = describer
  }

  setDescriber(describer: VisionDescriber): void {
    this.describer = describer
  }

  id(): string {
    return 'vision'
  }

  name(): string {
    return 'Vision Evaluation'
  }

  capabilities(): Capability[] {
    return ['visual']
  }

  async evaluate(image1Path: string, image2Path: string): Promise<ImageEvaluation> {
    let description1 = ''
    let description2 = ''

    if (this.describer?.isEnabled()) {
      try {
        const { image1, image2 } = await this.describer.describeBoth(image1Path, image2Path)
        description1 = image1.description
        description2 = image2.description
      } catch (err) {
        description1 = `[Vision API failed: ${err instanceof Error ? err.message : String(err)}]`
      }
    }

    const img1 = loadImageData(image1Path)
    const img2 = loadImageData(image2Path)

    if (!img1 || !img2) {
      const missing = !img1 ? 'image1' : 'image2'
      const eval_: ImageEvaluation = {
        image1Path,
        image2Path,
        similarity: 0,
        dimensionMatch: false,
        width1: 0, height1: 0, width2: 0, height2: 0,
        diffRegions: [],
        description1,
        description2,
        summary: `Image Evaluation Failed: Could not load ${missing} (${missing === 'image1' ? image1Path : image2Path})`,
        timestamp: Date.now()
      }
      this.evaluations.push(eval_)
      if (this.evaluations.length > this.maxEvaluations) {
        this.evaluations = this.evaluations.slice(-this.maxEvaluations)
      }
      return eval_
    }

    const dimensionMatch = img1.width === img2.width && img1.height === img2.height
    const { similarity, diffRegions } = compareImages(img1, img2)
    const summary = buildSummary(
      image1Path, image2Path, similarity, dimensionMatch,
      img1.width, img1.height, img2.width, img2.height, diffRegions,
      description1, description2
    )

    const eval_: ImageEvaluation = {
      image1Path,
      image2Path,
      similarity,
      dimensionMatch,
      width1: img1.width, height1: img1.height,
      width2: img2.width, height2: img2.height,
      diffRegions,
      description1,
      description2,
      summary,
      timestamp: Date.now()
    }

    this.evaluations.push(eval_)
    if (this.evaluations.length > this.maxEvaluations) {
      this.evaluations = this.evaluations.slice(-this.maxEvaluations)
    }

    return eval_
  }

  async evaluateSingle(image1Path: string): Promise<ImageEvaluation> {
    let description1 = ''

    if (this.describer?.isEnabled()) {
      try {
        const { image1 } = await this.describer.describeBoth(image1Path, image1Path)
        description1 = image1.description
      } catch (err) {
        description1 = `[Vision API failed: ${err instanceof Error ? err.message : String(err)}]`
      }
    }

    const img1 = loadImageData(image1Path)

    if (!img1) {
      const eval_: ImageEvaluation = {
        image1Path,
        image2Path: '',
        similarity: 0,
        dimensionMatch: false,
        width1: 0, height1: 0, width2: 0, height2: 0,
        diffRegions: [],
        description1,
        description2: '',
        summary: `Image Description Failed: Could not load image (${image1Path})`,
        timestamp: Date.now()
      }
      this.evaluations.push(eval_)
      if (this.evaluations.length > this.maxEvaluations) {
        this.evaluations = this.evaluations.slice(-this.maxEvaluations)
      }
      return eval_
    }

    const summary = `Image Description:\n  Path: ${image1Path.substring(0, 80)}\n  Dimensions: ${img1.width}x${img1.height}\n\n${description1 || '[No vision provider available]'}`

    const eval_: ImageEvaluation = {
      image1Path,
      image2Path: '',
      similarity: 100,
      dimensionMatch: true,
      width1: img1.width, height1: img1.height,
      width2: img1.width, height2: img1.height,
      diffRegions: [],
      description1,
      description2: '',
      summary,
      timestamp: Date.now()
    }

    this.evaluations.push(eval_)
    if (this.evaluations.length > this.maxEvaluations) {
      this.evaluations = this.evaluations.slice(-this.maxEvaluations)
    }

    return eval_
  }

  getLatestEvaluation(): ImageEvaluation | null {
    return this.evaluations.length > 0 ? this.evaluations[this.evaluations.length - 1] : null
  }

  getEvaluations(): ImageEvaluation[] {
    return [...this.evaluations]
  }

  async snapshot(_ctx?: SnapshotContext): Promise<Snapshot> {
    const artifacts: SnapshotArtifact[] = []

    const providers = this.describer?.getProviders() || []
    const providerInfos = await Promise.all(
      providers.map(async p => ({
        id: p.id(),
        name: p.name(),
        available: await p.isAvailable()
      }))
    )
    const availableProviders = providerInfos.filter(p => p.available)
    artifacts.push({
      type: 'json',
      name: 'vision_providers',
      content: JSON.stringify(providerInfos, null, 2),
      metadata: {
        totalProviders: providerInfos.length,
        availableCount: availableProviders.length
      }
    })

    if (this.evaluations.length === 0) {
      artifacts.push({
        type: 'text',
        name: 'evaluation_status',
        content: availableProviders.length > 0
          ? `No image evaluations yet. ${availableProviders.length} vision provider(s) available: ${availableProviders.map(p => p.name).join(', ')}. Use evaluate_images tool to compare images.`
          : 'No image evaluations performed yet. No vision providers available — configure Ollama or Remote Vision in Settings.',
        metadata: { hasEvaluations: false, hasProviders: availableProviders.length > 0 }
      })
    } else {
      const latest = this.evaluations[this.evaluations.length - 1]
      artifacts.push({
        type: 'text',
        name: 'latest_evaluation',
        content: latest.summary,
        metadata: {
          similarity: latest.similarity,
          dimensionMatch: latest.dimensionMatch,
          diffRegionCount: latest.diffRegions.length
        }
      })

      if (this.evaluations.length > 1) {
        const history = this.evaluations
          .map((e, i) => `Evaluation ${i + 1}: ${e.similarity}% similarity (${e.dimensionMatch ? 'dimensions match' : 'dimension mismatch'})`)
          .join('\n')
        artifacts.push({
          type: 'text',
          name: 'evaluation_history',
          content: history,
          metadata: { count: this.evaluations.length }
        })
      }
    }

    return {
      resourceId: this.id(),
      resourceName: this.name(),
      capabilities: this.capabilities(),
      timestamp: Date.now(),
      metadata: {
        evaluationCount: this.evaluations.length,
        latestSimilarity: this.evaluations.length > 0 ? this.evaluations[this.evaluations.length - 1].similarity : null
      },
      artifacts
    }
  }

  clear(): void {
    this.evaluations = []
  }
}
