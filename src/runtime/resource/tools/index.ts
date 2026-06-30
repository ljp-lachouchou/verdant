import type { Resource, Snapshot, SnapshotContext, SnapshotArtifact, Capability } from '../types'
import type { ToolRegistry } from '../../../tools/types'
import type { VibeCodingConfig } from '@shared/types'

export interface ToolDirective {
  category: string
  directive: string
}

export class ToolsResource implements Resource {
  private tools: ToolRegistry
  private vibeCodingConfig?: VibeCodingConfig

  constructor(tools: ToolRegistry, vibeCodingConfig?: VibeCodingConfig) {
    this.tools = tools
    this.vibeCodingConfig = vibeCodingConfig
  }

  setTools(tools: ToolRegistry): void {
    this.tools = tools
  }

  setVibeCodingConfig(config: VibeCodingConfig | undefined): void {
    this.vibeCodingConfig = config
  }

  id(): string {
    return 'tools'
  }

  name(): string {
    return 'Tools'
  }

  capabilities(): Capability[] {
    return ['memory']
  }

  getDirectives(): ToolDirective[] {
    const defs = Array.from(this.tools.values()).map(t => t.definition)
    const directives: ToolDirective[] = []

    const hasVibe = !!defs.find(d => d.name === 'vibe_coding')
    const hasBrowser = !!defs.find(d => d.name === 'browser')

    if (hasVibe) {
      const workingDir = this.vibeCodingConfig?.workingDir || ''

      let workspaceInfo: string
      if (workingDir) {
        workspaceInfo = `\n\nCRITICAL — WORKSPACE:\nYour coding workspace is: ${workingDir}\n- You MUST pass working_dir="${workingDir}" to vibe_coding\n- You MUST use ls/read ONLY in this directory\n- Do NOT search for or use other directories\n- Do NOT create projects in other locations\n- If the user mentions a different directory, use that instead. Otherwise, ALWAYS use ${workingDir}`
      } else {
        workspaceInfo = `\n\nCRITICAL — WORKSPACE:\nNo default workspace is configured. Ask the user which directory to use before calling vibe_coding.`
      }

      let codingDirective = `You have a dedicated coding agent (vibe_coding). For ANY coding task — creating files, writing components, implementing features, fixing bugs, refactoring — you MUST call vibe_coding. Do NOT use write or edit to write code yourself.${workspaceInfo}\n\nWorkflow:\n1. Use ls/read to check ${workingDir || 'the workspace directory'} for existing files\n2. Call vibe_coding with a detailed prompt and working_dir="${workingDir || '<workspace>'}"\n3. After vibe_coding completes, verify the result (see VERIFICATION directive below)`

      if (hasBrowser) {
        codingDirective += `\n4. Use the browser tool (Playwright) to open the created page and take a screenshot`
      }

      directives.push({
        category: 'CODING',
        directive: codingDirective
      })
    }

    const hasEvaluate = !!defs.find(d => d.name === 'evaluate_images')

    if (hasBrowser) {
      let verifyDirective = `After vibe_coding creates web/frontend files, you MUST verify using the browser tool (Playwright):\n1. Start the dev server if needed: bash(command="cd <project_dir> && nohup npm run dev > /tmp/dev.log 2>&1 & echo started")\n2. Wait a few seconds: bash(command="sleep 3")\n3. Open the page: browser(action="navigate", url="http://localhost:5173")\n4. Take screenshot: browser(action="screenshot")\n5. Report what you see to the user`

      if (hasEvaluate) {
        verifyDirective += `\n\nIMAGE UNDERSTANDING (CRITICAL):\nYou CANNOT see images. Do NOT use Python/PIL/bash to analyze image pixels.\nWhen the user attaches an image, its path is in the message: "[User attached N image(s), saved to: /path]"\n\nWORKFLOW for image-based UI tasks:\n1. Use vibe_coding to implement the UI based on the user's description\n2. Start dev server and take a browser screenshot\n3. Call evaluate_images(image1="/path/to/user/upload", image2="/path/to/screenshot") — the TWO images MUST be different\n4. Read the Normalized Data in the next round — it contains text descriptions of BOTH images plus similarity score\n5. If similarity is low or descriptions don't match, use vibe_coding to fix and re-evaluate\n\nDo NOT call evaluate_images before you have an implementation screenshot.\nDo NOT pass the same image path for both parameters.\nThis is the ONLY way you can understand what's in an image.`
      }

      directives.push({
        category: 'VERIFICATION',
        directive: verifyDirective
      })
    }

    if (defs.find(d => d.name === 'task')) {
      directives.push({
        category: 'DELEGATION',
        directive: 'For complex tasks with multiple independent parts, use the task tool to delegate sub-tasks to sub-agents in parallel.'
      })
    }

    return directives
  }

  async snapshot(_ctx?: SnapshotContext): Promise<Snapshot> {
    const defs = Array.from(this.tools.values()).map(t => t.definition)
    const artifacts: SnapshotArtifact[] = []

    const directives = this.getDirectives()
    if (directives.length > 0) {
      artifacts.push({
        type: 'text',
        name: 'tool_directives',
        content: directives.map(d => `[${d.category}]\n${d.directive}`).join('\n\n---\n\n'),
        metadata: { directiveCount: directives.length }
      })
    }

    if (this.vibeCodingConfig?.enabled) {
      artifacts.push({
        type: 'json',
        name: 'vibe_coding_config',
        content: JSON.stringify({
          enabled: this.vibeCodingConfig.enabled,
          cliPath: this.vibeCodingConfig.cliPath,
          workingDir: this.vibeCodingConfig.workingDir || '(not set)',
          timeout: this.vibeCodingConfig.timeout,
          verifyType: this.vibeCodingConfig.verifyType || 'none'
        }, null, 2),
        metadata: { tool: 'vibe_coding' }
      })
    }

    artifacts.push({
      type: 'json',
      name: 'available_tools',
      content: JSON.stringify(defs.map(d => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters.map(p => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required
        })),
        executionMode: d.executionMode || 'parallel'
      })), null, 2)
    })

    return {
      resourceId: this.id(),
      resourceName: this.name(),
      capabilities: this.capabilities(),
      timestamp: Date.now(),
      metadata: {
        toolCount: defs.length,
        directiveCount: directives.length,
        hasVibeCoding: !!this.vibeCodingConfig?.enabled
      },
      artifacts
    }
  }
}
