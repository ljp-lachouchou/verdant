import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

export class AskUserTool implements Tool {
  definition = {
    name: 'ask_user',
    description: `Pause execution and ask the user for confirmation or input. The agent stops and waits until the user responds.

Use this when:
- You need the user to log in to a website before you can continue
- You need the user to verify something visually (e.g. "Is this the right file?")
- You need the user to make a decision (e.g. "Should I delete this file?")
- You encountered a captcha or need human verification
- You need the user to provide information you can't find yourself

The message should clearly tell the user what to do and what will happen after they respond.
After the user clicks "Continue", execution resumes automatically.

Examples:
- ask_user(message="Please log in to the website in the browser, then click Continue.")
- ask_user(message="I found 3 PDF files. Should I delete them all? Click Continue to confirm.")
- ask_user(message="I need the database password. Please enter it, then click Continue.")`,
    parameters: [
      {
        name: 'message',
        type: 'string' as const,
        description: 'The question or instruction to display to the user. Be specific about what they need to do.',
        required: true
      },
      {
        name: 'screenshot',
        type: 'string' as const,
        description: 'Optional file path to a screenshot image to display alongside the message',
        required: false
      }
    ],
    executionMode: 'sequential' as const
  }

  private waitCallback?: (message: string, screenshot?: string) => Promise<void>

  setWaitCallback(cb: (message: string, screenshot?: string) => Promise<void>): void {
    this.waitCallback = cb
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const message = args.message as string
    if (!message) {
      return { output: 'Error: message is required for ask_user', isError: true }
    }

    const screenshot = args.screenshot as string | undefined

    console.log(`[AskUser] waiting for user: ${message.substring(0, 80)}`)

    if (this.waitCallback) {
      await this.waitCallback(message, screenshot)
    } else {
      // Fallback: wait 10 seconds
      console.log('[AskUser] no waitCallback, waiting 10s')
      await new Promise(r => setTimeout(r, 10000))
    }

    return {
      output: 'User confirmed. Continuing execution.',
      isError: false
    }
  }
}
