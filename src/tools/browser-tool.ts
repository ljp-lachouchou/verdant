import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

type ActionType = 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'scroll' | 'wait' | 'evaluate' | 'close' | 'fill_form'

// Lazy-load playwright to avoid Electron bundling issues
let chromium: typeof import('playwright').chromium | null = null
async function getChromium() {
  if (!chromium) {
    const mod = await import('playwright')
    chromium = mod.chromium
  }
  return chromium
}

export class BrowserTool implements Tool {
  definition = {
    name: 'browser',
    description: `Control a web browser to navigate, click, type, extract content, take screenshots, and interact with web pages.

Actions:
- navigate: Go to a URL (url required)
- click: Click an element (selector required)
- type: Type text into an input field (selector + text required)
- fill_form: Fill multiple form fields (fields array required)
- screenshot: Take a screenshot (returns file path)
- extract: Extract text content from page or specific element (selector optional)
- scroll: Scroll page down/up (selector optional for scroll into element)
- wait: Wait for selector to appear (selector required)
- evaluate: Run JavaScript on the page (script required)
- close: Close the browser

Use CSS selectors for all element targeting: "#id", ".class", "tag", "[attr=value]", "text=visible text"

Typical flow for sites requiring login:
1. browser(action="navigate", url="https://example.com")
2. browser(action="screenshot") — take screenshot to show current state
3. ask_user(message="Please log in to the website, then click Continue") — wait for user
4. browser(action="screenshot") — verify logged in
5. Continue with your task

Use CSS selectors for all element targeting: "#id", ".class", "tag", "[attr=value]", "text=visible text"

Examples:
- browser(action="navigate", url="https://example.com")
- browser(action="click", selector="#submit-btn")
- browser(action="type", selector="#search", text="hello world")
- browser(action="extract", selector=".article-content")
- browser(action="screenshot")
- browser(action="evaluate", script="document.title")
- browser(action="fill_form", fields=[{"selector":"#user","value":"alice"},{"selector":"#pass","value":"123"}])`,
    parameters: [
      {
        name: 'action',
        type: 'string' as const,
        description: 'Action to perform: navigate, click, type, fill_form, screenshot, extract, scroll, wait, wait_user, evaluate, close',
        required: true
      },
      {
        name: 'url',
        type: 'string' as const,
        description: 'URL to navigate to (for navigate action)',
        required: false
      },
      {
        name: 'selector',
        type: 'string' as const,
        description: 'CSS selector for target element (for click, type, extract, wait actions)',
        required: false
      },
      {
        name: 'text',
        type: 'string' as const,
        description: 'Text to type into the field (for type action)',
        required: false
      },
      {
        name: 'fields',
        type: 'array' as const,
        description: 'Array of {selector, value} objects (for fill_form action)',
        required: false
      },
      {
        name: 'script',
        type: 'string' as const,
        description: 'JavaScript code to evaluate on page (for evaluate action)',
        required: false
      },
      {
        name: 'timeout',
        type: 'number' as const,
        description: 'Timeout in ms (default: 10000)',
        required: false,
        default: 10000
      },
      {
        name: 'waitFor',
        type: 'string' as const,
        description: 'CSS selector to wait for after action (optional)',
        required: false
      },
      {
        name: 'device',
        type: 'string' as const,
        description: 'Device preset for viewport: "desktop" (1280x800, default), "mobile" (375x667, iPhone SE), "tablet" (768x1024, iPad), "iphone" (390x844, iPhone 12), or "WxH" custom (e.g. "414x896")',
        required: false,
        default: 'desktop'
      }
    ],
    executionMode: 'sequential' as const
  }

  private browser: import('playwright').Browser | null = null
  private context: import('playwright').BrowserContext | null = null
  private page: import('playwright').Page | null = null

  async execute(args: Record<string, unknown>, _context: ToolContext, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const action = args.action as ActionType
    const timeout = (args.timeout as number) || 10000

    if (!action) {
      return { output: 'Error: action is required', isError: true }
    }

    try {
      // Close action doesn't need a page
      if (action === 'close') {
        await this.closeBrowser()
        return { output: 'Browser closed.', isError: false }
      }

      // Ensure browser is running
      await this.ensureBrowser(onUpdate)

      switch (action) {
        case 'navigate':
          return await this.doNavigate(args.url as string, timeout, args.waitFor as string, onUpdate)
        case 'click':
          return await this.doClick(args.selector as string, timeout, args.waitFor as string, onUpdate)
        case 'type':
          return await this.doType(args.selector as string, args.text as string, timeout, onUpdate)
        case 'fill_form':
          return await this.doFillForm(args.fields as Array<{selector: string; value: string}>, timeout, onUpdate)
        case 'screenshot':
          return await this.doScreenshot(onUpdate)
        case 'extract':
          return await this.doExtract(args.selector as string, onUpdate)
        case 'scroll':
          return await this.doScroll(args.selector as string, onUpdate)
        case 'wait':
          return await this.doWait(args.selector as string, timeout, onUpdate)
        case 'evaluate':
          return await this.doEvaluate(args.script as string, onUpdate)
        default:
          return { output: `Error: Unknown action "${action}"`, isError: true }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[BrowserTool] error: ${msg}`)
      return { output: `Browser error: ${msg}`, isError: true }
    }
  }

  private async ensureBrowser(onUpdate?: ToolUpdateCallback): Promise<void> {
    if (this.browser?.isConnected()) {
      if (!this.page) {
        this.page = await this.context!.newPage()
      }
      return
    }

    onUpdate?.({ output: 'Launching browser...' })
    console.log('[BrowserTool] launching chromium')

    const cr = await getChromium()
    this.browser = await cr.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    })

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN'
    })

    this.page = await this.context.newPage()
    console.log('[BrowserTool] browser ready')
  }

  private async doNavigate(url: string, timeout: number, waitFor?: string, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!url) return { output: 'Error: url is required for navigate', isError: true }
    onUpdate?.({ output: `Navigating to ${url}...` })
    console.log(`[BrowserTool] navigate: ${url}`)

    await this.page!.goto(url, { timeout, waitUntil: 'domcontentloaded' })

    if (waitFor) {
      await this.page!.waitForSelector(waitFor, { timeout })
    }

    const title = await this.page!.title()
    return { output: `Navigated to: ${url}\nPage title: ${title}`, isError: false }
  }

  private async doClick(selector: string, timeout: number, waitFor?: string, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!selector) return { output: 'Error: selector is required for click', isError: true }
    onUpdate?.({ output: `Clicking: ${selector}` })
    console.log(`[BrowserTool] click: ${selector}`)

    await this.page!.click(selector, { timeout })

    if (waitFor) {
      await this.page!.waitForSelector(waitFor, { timeout })
      // Small delay for page to settle
      await this.page!.waitForTimeout(500)
    } else {
      await this.page!.waitForTimeout(500)
    }

    return { output: `Clicked: ${selector}`, isError: false }
  }

  private async doType(selector: string, text: string, timeout: number, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!selector || text === undefined) return { output: 'Error: selector and text are required for type', isError: true }
    onUpdate?.({ output: `Typing into: ${selector}` })
    console.log(`[BrowserTool] type: ${selector} → ${text.substring(0, 50)}`)

    await this.page!.fill(selector, text, { timeout })
    return { output: `Typed "${text}" into ${selector}`, isError: false }
  }

  private async doFillForm(fields: Array<{selector: string; value: string}>, timeout: number, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return { output: 'Error: fields array is required for fill_form', isError: true }
    }

    const results: string[] = []
    for (const field of fields) {
      onUpdate?.({ output: `Filling: ${field.selector}` })
      await this.page!.fill(field.selector, field.value, { timeout })
      results.push(`  ${field.selector} = ${field.value}`)
    }

    return { output: `Filled ${fields.length} fields:\n${results.join('\n')}`, isError: false }
  }

  private async doScreenshot(onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    onUpdate?.({ output: 'Taking screenshot...' })
    console.log('[BrowserTool] screenshot')

    const { mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')

    const screenshotDir = join(tmpdir(), 'agent-screenshots')
    mkdirSync(screenshotDir, { recursive: true })
    const filename = `screenshot_${Date.now()}.png`
    const filepath = join(screenshotDir, filename)

    await this.page!.screenshot({ path: filepath, fullPage: false })

    return {
      output: `Screenshot saved: ${filepath}`,
      isError: false,
      metadata: { screenshotPath: filepath }
    }
  }

  private async doExtract(selector: string | undefined, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    onUpdate?.({ output: 'Extracting content...' })
    console.log(`[BrowserTool] extract: ${selector || 'full page'}`)

    let content: string
    if (selector) {
      const element = await this.page!.$(selector)
      if (!element) {
        return { output: `Element not found: ${selector}`, isError: true }
      }
      content = await element.innerText()
    } else {
      content = await this.page!.innerText('body')
    }

    // Truncate if too long
    if (content.length > 5000) {
      content = content.substring(0, 5000) + '\n... [content truncated, 5000/?? chars]'
    }

    return { output: content, isError: false }
  }

  private async doScroll(selector: string | undefined, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (selector) {
      onUpdate?.({ output: `Scrolling to: ${selector}` })
      await this.page!.locator(selector).scrollIntoViewIfNeeded()
      return { output: `Scrolled to: ${selector}`, isError: false }
    }

    onUpdate?.({ output: 'Scrolling down...' })
    await this.page!.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
    await this.page!.waitForTimeout(500)
    return { output: 'Scrolled down', isError: false }
  }

  private async doWait(selector: string, timeout: number, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!selector) return { output: 'Error: selector is required for wait', isError: true }
    onUpdate?.({ output: `Waiting for: ${selector}` })
    console.log(`[BrowserTool] wait: ${selector}`)

    await this.page!.waitForSelector(selector, { timeout })
    return { output: `Element found: ${selector}`, isError: false }
  }

  private async doEvaluate(script: string, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    if (!script) return { output: 'Error: script is required for evaluate', isError: true }
    onUpdate?.({ output: 'Running JavaScript...' }
    )
    console.log(`[BrowserTool] evaluate: ${script.substring(0, 80)}`)

    const result = await this.page!.evaluate(script)
    const output = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
    return { output, isError: false }
  }

  async closeBrowser(): Promise<void> {
    console.log('[BrowserTool] closing browser')
    try {
      await this.page?.close()
      await this.context?.close()
      await this.browser?.close()
    } catch {
      // ignore
    }
    this.page = null
    this.context = null
    this.browser = null
  }

  killAll(): void {
    this.closeBrowser().catch(() => {})
  }
}
