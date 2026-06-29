import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'

export interface AskUserOption {
  label: string
  value: string
}

export class AskUserTool implements Tool {
  definition = {
    name: 'ask_user',
    description: `Pause execution and ask the user for confirmation, a choice, or input. The agent stops and waits until the user responds.

Use this when:
- You need the user to log in to a website before you can continue
- You need the user to verify something visually
- You need the user to make a decision between options
- You encountered a captcha or need human verification
- You need the user to provide information

If you provide "options", the UI will show buttons for each option plus a custom input field. The user's choice is returned as the result.
If you don't provide "options", the UI shows a Continue button only.

Examples:
- ask_user(message="Please log in, then click Continue")
- ask_user(message="Which version?", options=[{"label":"v0.2.1","value":"v0.2.1"},{"label":"v0.3.0","value":"v0.3.0"},{"label":"Skip","value":"skip"}])
- ask_user(message="I found 3 PDF files. What should I do?", options=[{"label":"Delete all","value":"delete_all"},{"label":"Keep them","value":"keep"}])`,
    parameters: [
      {
        name: 'message',
        type: 'string' as const,
        description: 'The question or instruction to display to the user. Be specific about what they need to do.',
        required: true
      },
      {
        name: 'options',
        type: 'array' as const,
        description: 'Array of {label, value} objects. If provided, UI shows buttons for each option. User can also type a custom response.',
        required: false
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

  private waitCallback?: (message: string, screenshot: string | undefined, options: AskUserOption[]) => Promise<string>

  setWaitCallback(cb: (message: string, screenshot: string | undefined, options: AskUserOption[]) => Promise<string>): void {
    this.waitCallback = cb
  }

  async execute(args: Record<string, unknown>, _context: ToolContext, _onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const message = args.message as string
    if (!message) {
      return { output: 'Error: message is required for ask_user', isError: true }
    }

    const screenshot = args.screenshot as string | undefined
    const rawOptions = args.options as AskUserOption[] | undefined
    const options: AskUserOption[] = Array.isArray(rawOptions) ? rawOptions : []

    console.log(`[AskUser] waiting for user: ${message.substring(0, 80)} (${options.length} options)`)

    if (this.waitCallback) {
      const response = await this.waitCallback(message, screenshot, options)
      return {
        output: response || 'User confirmed.',
        isError: false
      }
    } else {
      console.log('[AskUser] no waitCallback, waiting 10s')
      await new Promise(r => setTimeout(r, 10000))
      return { output: 'User confirmed (timeout).', isError: false }
    }
  }
}
