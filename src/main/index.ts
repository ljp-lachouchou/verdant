import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { unlink, readdir } from 'fs/promises'
import dotenv from 'dotenv'

dotenv.config()
import { AgentLoop } from '@agent/loop'
import { OpenAILLMProvider } from '@agent/llm-provider'
import { StubLLMProvider } from '@agent/stub-provider'
import { DEFAULT_CONFIG, type LLMProvider } from '@agent/types'
import { HARNESS_SYSTEM_PROMPT } from '@agent/prompts'
import { createMultiAgentToolRegistry, createFullToolRegistry, TaskTool, AskUserTool, SkillLoader, SkillPermission } from '@tools/registry'
import { ShellTool } from '@tools/shell'
import {
  DatabaseManager,
  SessionRepository,
  MessageRepository,
  CompactionService
} from '@storage/index'
import type { AgentConfig, Message } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let dbManager: DatabaseManager
let sessionRepo: SessionRepository
let messageRepo: MessageRepository
let compactionService: CompactionService
let agentLoop: AgentLoop | null = null
let activeTaskTool: TaskTool | null = null
let llmProvider: LLMProvider
let currentConfig: AgentConfig = { ...DEFAULT_CONFIG }
let currentSessionId: string | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    titleBarOverlay: process.platform === 'darwin'
      ? { height: 28 }
      : false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function loadConfig(): void {
  try {
    const stored = dbManager.prepare('SELECT value FROM app_metadata WHERE key = ?').get('config') as { value: string } | undefined
    if (stored?.value) {
      currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(stored.value) }
    }
  } catch {
    // use default
  }

  const envKey = process.env['DEEPSEEK_API_KEY'] || process.env['OPENAI_API_KEY']
  if (envKey && !currentConfig.apiKey) {
    currentConfig.apiKey = envKey
  }

  const envBaseUrl = process.env['DEEPSEEK_API_BASE_URL'] || process.env['OPENAI_API_BASE_URL']
  if (envBaseUrl) {
    currentConfig.apiBaseUrl = envBaseUrl
  }
}

function saveConfig(): void {
  try {
    dbManager.prepare(`
      INSERT INTO app_metadata (key, value) VALUES ('config', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(currentConfig))
  } catch {
    // ignore
  }
}

let globalSkillLoader: SkillLoader = new SkillLoader()

function createLLMProvider(): LLMProvider {
  if (currentConfig.apiKey) {
    const registry = createMultiAgentToolRegistry({
      llmProvider: llmProvider || new StubLLMProvider(),
      baseConfig: currentConfig,
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {},
      parentSessionId: ''
    }, currentConfig.vibeCoding || { enabled: false, cliPath: '', argsTemplate: '{prompt}', workingDir: '', timeout: 120000 }, globalSkillLoader)
    const provider = new OpenAILLMProvider(
      Array.from(registry.values()).map(t => t.definition)
    )
    return provider
  }
  return new StubLLMProvider()
}

function initDatabase(): void {
  dbManager = new DatabaseManager()
  sessionRepo = new SessionRepository(dbManager)
  messageRepo = new MessageRepository(dbManager)
  loadConfig()
  llmProvider = createLLMProvider()
  compactionService = new CompactionService(
    dbManager,
    messageRepo,
    sessionRepo,
    llmProvider,
    currentConfig
  )
}

function persistMessageAtomic(message: Message, sessionId?: string): void {
  const sid = sessionId || currentSessionId
  if (!sid) return
  if (messageRepo.exists(message.id)) return

  // Auto-generate blocks for messages with toolCalls (so UI can reconstruct on reload)
  let blocks = message.blocks
  if (!blocks && message.toolCalls && message.toolCalls.length > 0) {
    blocks = []
    if (message.content) {
      blocks.push({ type: 'text', text: message.content })
    }
    for (const tc of message.toolCalls) {
      blocks.push({
        type: 'tool_call',
        toolName: tc.toolName,
        command: (tc.args?.command as string) || (tc.args?.path as string) || '',
        output: tc.output,
        status: tc.status === 'error' ? 'error' : 'success'
      })
      // Skill block
      if (tc.toolName === 'skill' && tc.output && tc.status !== 'error') {
        const nameMatch = tc.output.match(/name="([^"]+)"/)
        const skillName = nameMatch?.[1] || 'unknown'
        const descMatch = tc.output.match(/#\s+[^\n]+\n+([\s\S]*?)(?:\n##\s|$)/)
        blocks.push({
          type: 'skill',
          skillName,
          skillDescription: descMatch?.[1]?.trim() || tc.output.substring(0, 200)
        })
      }
      // Sub-agent block (task tool)
      if (tc.toolName === 'task') {
        const desc = (tc.args?.description as string) || 'Sub-Agent'
        blocks.push({
          type: 'subagent',
          subAgentName: desc,
          subAgentId: tc.id,
          subAgentStatus: tc.status === 'error' ? 'error' : 'success',
          subAgentResult: tc.output
        })
      }
    }
  }

  const metadata = {
    ...message.metadata,
    ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
    ...(blocks ? { blocks } : {})
  }

  messageRepo.add({
    id: message.id,
    sessionId: sid,
    role: message.role,
    messageType: message.messageType || 'text',
    content: message.content,
    timestamp: message.timestamp,
    toolCalls: message.toolCalls,
    isSummary: message.isSummary,
    isCompacted: message.isCompacted,
    parentMessageId: message.parentMessageId,
    tokenCount: message.tokenCount,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  })
}

const INTERMEDIATE_PATTERNS = [
  /^story_\d+\.txt$/i,
  /^story_\d+\.json$/i,
  /^slide_\d+\.pptx?$/i,
  /^story_outlines\.json$/i,
  /^stories\.json$/i,
  /^create_ppt\.py$/i,
  /^gen_ppt\.py$/i,
  /^tmp_.*\.(txt|json|py|sh)$/i,
  /^~\$.*$/
]

async function cleanupIntermediateFiles(): Promise<void> {
  try {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
    if (!home) return
    const downloadsDir = join(home, 'Downloads')
    const entries = await readdir(downloadsDir)
    for (const entry of entries) {
      if (INTERMEDIATE_PATTERNS.some(p => p.test(entry))) {
        const filePath = join(downloadsDir, entry)
        unlink(filePath).then(() => console.log(`[Agent] cleaned intermediate: ${entry}`)).catch(() => {})
      }
    }
  } catch {
    // ignore
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('agent:send', async (_event: IpcMainInvokeEvent, userInput: string) => {
    console.log(`[Agent] === send: "${userInput.substring(0, 80)}" ===`)

    if (!currentConfig.apiKey) {
      return {
        success: false,
        error: 'config_required',
        text: 'No API key configured. Please open Settings to add your API key before chatting.'
      }
    }

    if (!currentSessionId) {
      const sessionName = userInput.length > 30 ? userInput.substring(0, 30) + '...' : userInput
      const session = sessionRepo.create(sessionName)
      currentSessionId = session.id
      mainWindow?.webContents.send('session:created', session)
    } else {
      // If session name is default (time-based), update it with first user input
      const existingSession = sessionRepo.getById(currentSessionId)
      if (existingSession && (existingSession.name.startsWith('Session ') || existingSession.name.startsWith('New Session'))) {
        const sessionName = userInput.length > 30 ? userInput.substring(0, 30) + '...' : userInput
        sessionRepo.update(currentSessionId, sessionName)
        mainWindow?.webContents.send('session:updated', { id: currentSessionId, name: sessionName })
      }
    }

    const activeSessionId = currentSessionId
    const tempFiles: string[] = []
    const send = (event: Record<string, unknown>) => {
      mainWindow?.webContents.send('agent:stream', { ...event, sessionId: activeSessionId })
    }
    const savedMessages = messageRepo.getActiveMessages(activeSessionId)

    llmProvider = createLLMProvider()

    // Load skills with permission config
    const skillPermission = new SkillPermission(currentConfig.skillPermissions || { '*': 'allow' })
    const skillLoader = new SkillLoader(skillPermission)
    skillLoader.loadAll(process.cwd())
    globalSkillLoader = skillLoader
    const skillsText = skillLoader.getSkillListText()
    console.log(`[Agent] skills in system prompt: ${skillsText.length > 0 ? 'YES' : 'NO'} (${skillsText.length} chars)`)
    const systemPrompt = HARNESS_SYSTEM_PROMPT + skillsText

    const agentCallbacks = {
      onToken: (token: string) => {
        send({ type: 'token', token })
      },
      onTextChunk: (text: string) => {
        console.log(`[Agent] text_chunk: ${text.substring(0, 80)}...`)
        send({ type: 'text_chunk', text })
      },
      onToolCall: (name: string, args: Record<string, unknown>) => {
        const cmd = (args?.command as string) || (args?.path as string) || (args?.description as string) || JSON.stringify(args).substring(0, 100)
        console.log(`[Agent] tool_call: ${name} → ${cmd}`)
        send({ type: 'tool_call', name, args })
      },
      onToolResult: (name: string, output: string, isError: boolean) => {
        console.log(`[Agent] tool_result: ${name} ${isError ? 'ERROR' : 'OK'} → ${(output || '').substring(0, 120)}...`)

        const pathMatch = output?.match(/([^\s]+\.png)/i)
        console.log(`[Agent] pathMatch: ${pathMatch ? pathMatch[1] : 'NONE'}`)
        if (pathMatch && !isError) {
          const imgPath = pathMatch[1]
          try {
            const buf = readFileSync(imgPath)
            const base64 = `data:image/png;base64,${buf.toString('base64')}`
            console.log(`[Agent] image base64 loaded: ${buf.length} bytes, sending to renderer`)
            send({ type: 'tool_result', name, output, isError, imageBase64: base64 })
          } catch (err) {
            console.error(`[Agent] failed to read image: ${imgPath}`, err)
            send({ type: 'tool_result', name, output, isError })
          }
        } else {
          console.log(`[Agent] no image match, sending plain tool_result`)
          send({ type: 'tool_result', name, output, isError })
        }
      },
      onComplete: (finalText: string) => {
        console.log(`[Agent] complete: ${(finalText || '').substring(0, 120)}...`)
        for (const f of tempFiles) {
          unlink(f).then(() => console.log(`[Agent] cleaned temp: ${f}`)).catch(() => {})
        }
        cleanupIntermediateFiles()
        send({ type: 'complete', text: finalText })
        sessionRepo.touch(activeSessionId)
      },
      onError: (error: Error) => {
        console.error(`[Agent] error: ${error.message}`)
        send({ type: 'error', message: error.message })
        sessionRepo.touch(activeSessionId)
      },
      onMessagePersist: (message: import('@shared/types').Message) => {
        console.log(`[Agent] persist: ${message.role}/${message.messageType} (${message.content.length} chars)`)
        persistMessageAtomic(message, activeSessionId)
      },
      onCompaction: (_result: import('@shared/types').CompactionResult) => {
        console.log(`[Agent] compaction triggered`)
        sessionRepo.touch(activeSessionId)
      },
      onEvent: (event: import('@shared/types').AgentEvent) => {
        send(event as unknown as Record<string, unknown>)
      },
      beforeToolCall: (ctx: { toolName: string; args: Record<string, unknown>; sessionId: string }) => {
        const cmd = (ctx.args?.command as string) || ''
        const path = (ctx.args?.path as string) || ''

        // === File deletion protection ===
        // Detect rm commands in bash
        if (ctx.toolName === 'bash' && cmd) {
          const rmMatch = cmd.match(/\brm\b/)
          if (rmMatch) {
            // Allow rm in /tmp/ (intermediate file cleanup)
            if (!cmd.includes('/tmp/') && !cmd.includes('/var/tmp/')) {
              console.log(`[Agent] blocking delete command for user confirmation: ${cmd.substring(0, 80)}`)
              return {
                block: true,
                reason: `This command will delete files: "${cmd.substring(0, 100)}". Use ask_user to confirm with the user before retrying this command.`
              }
            }
          }
        }

        // === Temp file tracking ===
        if (path) {
          if (path.startsWith('/tmp/') || path.startsWith('/var/tmp/')) {
            if (ctx.toolName === 'write') {
              tempFiles.push(path)
              console.log(`[Agent] tracking temp file: ${path}`)
            }
          }
          if (ctx.toolName === 'write' && (path.endsWith('.json') || path.endsWith('.txt') || path.endsWith('.py') || path.endsWith('.tmp'))) {
            if (!path.startsWith('/Users/') || path.includes('/tmp/') || path === 'story_outlines.json' || path === 'stories.json') {
              tempFiles.push(path)
              console.log(`[Agent] tracking intermediate file: ${path}`)
            }
          }
        }
        if (cmd && (cmd.includes('/tmp/') || cmd.includes('/var/tmp/'))) {
          if (cmd.includes('>') || cmd.includes('cat >') || cmd.includes('tee ')) {
            const match = cmd.match(/(?:>|tee\s+)(['"]?)(\/tmp\/[^\s'"]+|\/var\/tmp\/[^\s'"]+)\1/)
            if (match?.[2]) {
              tempFiles.push(match[2])
              console.log(`[Agent] tracking temp file from bash: ${match[2]}`)
            }
          }
        }
        if (cmd && (cmd.includes('> ') || cmd.includes('cat >') || cmd.includes('tee '))) {
          const fileMatch = cmd.match(/(?:>|tee\s+)(['"]?)([^'"\s|]+)\1/)
          if (fileMatch?.[2] && !fileMatch[2].startsWith('/dev/')) {
            const filePath = fileMatch[2]
            if (filePath.endsWith('.json') || filePath.endsWith('.txt') || filePath.endsWith('.py') || filePath.endsWith('.tmp') || filePath.endsWith('.sh')) {
              tempFiles.push(filePath)
              console.log(`[Agent] tracking intermediate file from bash: ${filePath}`)
            }
          }
        }
      }
    }

    // Build tool registry — task tool always available (harness mode)
    const taskToolConfig: import('@tools/task-tool').TaskToolConfig = {
      llmProvider,
      baseConfig: { ...currentConfig, systemPrompt: HARNESS_SYSTEM_PROMPT },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: agentCallbacks,
      parentSessionId: activeSessionId,
      skillLoader
    }
    const vibeConfig = currentConfig.vibeCoding || { enabled: false, cliPath: '', argsTemplate: '{prompt}', workingDir: '', timeout: 120000, verifyType: 'none', verifyUrl: '', verifyCommand: '' }
    const toolRegistry = createMultiAgentToolRegistry(taskToolConfig, vibeConfig, skillLoader)
    activeTaskTool = toolRegistry.get('task') as TaskTool | null

    // Set up ask_user tool callback — wait for user confirmation via IPC
    const askUserTool = toolRegistry.get('ask_user') as AskUserTool | null
    if (askUserTool) {
      askUserTool.setWaitCallback(async (message: string, screenshot: string | undefined, options: Array<{ label: string; value: string }>) => {
        let imageBase64 = ''
        if (screenshot && screenshot.startsWith('/')) {
          try {
            const buf = readFileSync(screenshot)
            imageBase64 = `data:image/png;base64,${buf.toString('base64')}`
            console.log(`[Agent] ask_user screenshot base64: ${buf.length} bytes`)
          } catch (err) {
            console.error(`[Agent] failed to read ask_user screenshot: ${screenshot}`, err)
          }
        } else if (screenshot && screenshot.startsWith('data:')) {
          imageBase64 = screenshot
        }
        send({ type: 'wait_user', message, text: imageBase64, options })
        return new Promise<string>((resolve) => {
          const handler = (_event: unknown, data: { action: string; response?: string }) => {
            if (data.action === 'continue' || data.action === 'respond') {
              ipcMain.removeHandler('browser:continue')
              resolve(data.response || 'User confirmed.')
            }
          }
          ipcMain.handleOnce('browser:continue', handler as any)
        })
      })
    }

    // Create agent loop with appropriate system prompt
    const agentConfig = { ...currentConfig, systemPrompt }
    agentLoop = new AgentLoop(
      activeSessionId,
      llmProvider,
      toolRegistry,
      agentConfig,
      agentCallbacks
    )

    if (savedMessages.length > 0) {
      agentLoop.loadHistory(savedMessages)
    }

    try {
      const finalText = await agentLoop.run(userInput)

      if (compactionService.shouldCompact(activeSessionId)) {
        const _result = await compactionService.compactSession(activeSessionId)
        if (_result) {
          send({
            type: 'complete',
            text: `[Context compacted: ${_result.compactedCount} messages summarized, ${_result.tokensBefore} → ${_result.tokensAfter} tokens]`
          })
        }
      }

      console.log(`[Agent] === done: "${(finalText || '').substring(0, 80)}..." ===`)
      return { success: true, finalText }
    } catch (err) {
      console.error(`[Agent] === failed: ${err instanceof Error ? err.message : String(err)} ===`)
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      return { success: false, error: 'agent_error' }
    } finally {
      agentLoop = null
      activeTaskTool = null
    }
  })

  ipcMain.handle('agent:stop', async () => {
    activeTaskTool?.stopAll()
    agentLoop?.stop()
    const shellTool = Array.from(createFullToolRegistry().values()).find(t => t instanceof ShellTool) as ShellTool | undefined
    shellTool?.killAll()
    return { success: true }
  })

  ipcMain.handle('agent:steer', async (_event, message: string) => {
    if (!agentLoop) return { success: false, error: 'no_active_agent' }
    agentLoop.steer({
      id: randomUUID(),
      sessionId: currentSessionId || '',
      role: 'user',
      messageType: 'steering',
      content: message,
      timestamp: Date.now()
    })
    return { success: true }
  })

  ipcMain.handle('session:list', async () => {
    return sessionRepo.list()
  })

  ipcMain.handle('session:create', async (_event, name?: string) => {
    const session = sessionRepo.create(name)
    currentSessionId = session.id
    return session
  })

  ipcMain.handle('session:delete', async (_event, id: string) => {
    messageRepo.deleteBySession(id)
    sessionRepo.delete(id)
    if (currentSessionId === id) {
      currentSessionId = null
    }
    return { success: true }
  })

  ipcMain.handle('session:load', async (_event, id: string) => {
    currentSessionId = id
    const messages = messageRepo.getActiveMessages(id)
    const session = sessionRepo.getById(id)
    return { session, messages }
  })

  ipcMain.handle('config:get', async () => {
    return currentConfig
  })

  ipcMain.handle('config:set', async (_event, config: Partial<AgentConfig>) => {
    console.log(`[Config] set: ${JSON.stringify({ ...config, apiKey: config.apiKey ? '***' : undefined })}`)
    currentConfig = { ...currentConfig, ...config }
    saveConfig()
    llmProvider = createLLMProvider()
    compactionService = new CompactionService(
      dbManager, messageRepo, sessionRepo, llmProvider, currentConfig
    )
    return currentConfig
  })

  ipcMain.handle('skills:list', async () => {
    const loader = new SkillLoader(new SkillPermission(currentConfig.skillPermissions || { '*': 'allow' }))
    loader.loadAll(process.cwd())
    return loader.getAllSkills().map(s => ({
      name: s.name,
      description: s.description,
      location: s.location
    }))
  })
}

app.whenReady().then(() => {
  initDatabase()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  dbManager?.close()
})
