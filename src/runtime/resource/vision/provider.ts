import { readFileSync } from 'fs'

export interface VisionProvider {
  id(): string
  name(): string
  isAvailable(): Promise<boolean>
  describeImage(imagePath: string, prompt: string): Promise<string>
}

export function loadBase64FromPath(imagePath: string): { base64: string; mediaType: string } {
  if (imagePath.startsWith('data:image/')) {
    const parts = imagePath.split(',')
    const base64 = parts[1]
    const mediaType = imagePath.match(/data:(image\/\w+)/)?.[1] || 'image/png'
    return { base64, mediaType }
  }

  const buf = readFileSync(imagePath)
  const base64 = buf.toString('base64')
  const ext = imagePath.split('.').pop()?.toLowerCase()
  const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
              ext === 'webp' ? 'image/webp' : 'image/png'
  return { base64, mediaType }
}

export const DEFAULT_VISION_PROMPT = `You are a UI/UX expert analyzing a screenshot for pixel-perfect replication. Describe EVERYTHING you see in extreme detail:

1. LAYOUT: Describe the overall page structure. Is it a mobile app, desktop web, tablet? What's the page width/height ratio? Header? Sidebar? Footer? Main content area?

2. NAVIGATION: Describe ALL navigation elements — top bars, side menus, tabs, breadcrumbs. Include exact text labels.

3. CONTENT SECTIONS: For EACH section from top to bottom, describe:
   - Section title/heading (exact text)
   - Layout within section (grid columns, flex row, list, etc.)
   - Number of items/cards
   - Card content (image area, title text, subtitle, metadata)

4. COLORS: Give exact color descriptions for backgrounds, text, borders, buttons, accents. Use color names AND approximate hex values.

5. TYPOGRAPHY: Font sizes (large/medium/small), weights (bold/regular/light), text colors.

6. SPACING: Margins, padding, gaps between elements (tight/medium/spacious).

7. INTERACTIVE ELEMENTS: Buttons (text, color, shape), inputs (placeholder text), toggles, dropdowns.

8. ICONS: Describe each icon you see and its position.

Be exhaustive. This description will be used to write code that reproduces this UI 1:1.`
