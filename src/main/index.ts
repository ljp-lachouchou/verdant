import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { unlink, readdir } from 'fs/promises'
import dotenv from 'dotenv'

dotenv.config()
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
import {
  GoalManager,
  ResourceRegistry,
  FilesystemResource,
  TerminalResource,
  MemoryResource,
  ToolsResource,
  VisionResource,
  VisionDescriber,
  OllamaVisionProvider,
  RemoteVisionProvider,
  StateProjector,
  ContextFormatter,
  ExecutorManager,
  RuntimeLoop,
  ObservationBuilder,
  NormalizerRegistry,
  VisionNormalizer,
  CompileNormalizer,
  type RuntimeLoopCallbacks
} from '@runtime/index'

let mainWindow: BrowserWindow | null = null
let dbManager: DatabaseManager
let sessionRepo: SessionRepository
let messageRepo: MessageRepository
let compactionService: CompactionService
let runtimeLoop: RuntimeLoop | null = null
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
    title: 'Verdant',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    titleBarOverlay: process.platform === 'darwin'
      ? { height: 28 }
      : false,
    icon: join(__dirname, '../../resources/icon.png'),
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
    const home = homedir()
    const bootRegistry = new ResourceRegistry()
    bootRegistry.register(new FilesystemResource(home))
    bootRegistry.register(new TerminalResource())
    bootRegistry.register(new MemoryResource())
    const bootTools = createFullToolRegistry()
    bootRegistry.register(new ToolsResource(bootTools))
    const registry = createMultiAgentToolRegistry({
      llmProvider: llmProvider || new StubLLMProvider(),
      baseConfig: currentConfig,
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: {},
      parentSessionId: '',
      resourceRegistry: bootRegistry
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
  ipcMain.handle('agent:send', async (_event: IpcMainInvokeEvent, userInput: string, options?: { images?: Array<{ data: string; mediaType: string }> }) => {
    console.log(`[Runtime] === send: "${userInput.substring(0, 80)}" ===`)

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
      const enriched = { ...event, sessionId: activeSessionId }
      try {
        mainWindow?.webContents.send('agent:stream', enriched)
      } catch (sendErr) {
        console.error(`[Runtime] IPC send failed for event type=${event.type}:`, sendErr instanceof Error ? sendErr.message : String(sendErr))
        console.error(`[Runtime] event keys: ${Object.keys(enriched).join(', ')}`)
        for (const [k, v] of Object.entries(enriched)) {
          if (v !== null && typeof v === 'object') {
            console.error(`[Runtime] event.${k} type: ${typeof v}, keys: ${Object.keys(v as object).slice(0, 10).join(',')}`)
          }
        }
      }
    }

    llmProvider = createLLMProvider()

    const skillPermission = new SkillPermission(currentConfig.skillPermissions || { '*': 'allow' })
    const skillLoader = new SkillLoader(skillPermission)
    skillLoader.loadAll(process.cwd())
    globalSkillLoader = skillLoader
    const skillsText = skillLoader.getSkillListText()
    console.log(`[Runtime] skills in system prompt: ${skillsText.length > 0 ? 'YES' : 'NO'} (${skillsText.length} chars)`)
    const systemPrompt = HARNESS_SYSTEM_PROMPT + skillsText

    const agentCallbacks = {
      onToken: (token: string) => {
        send({ type: 'token', token })
      },
      onTextChunk: (text: string) => {
        console.log(`[Runtime] text_chunk: ${text.substring(0, 80)}...`)
        send({ type: 'text_chunk', text })
      },
      onToolCall: (name: string, args: Record<string, unknown>) => {
        const cmd = (args?.command as string) || (args?.path as string) || (args?.description as string) || JSON.stringify(args).substring(0, 100)
        console.log(`[Runtime] tool_call: ${name} → ${cmd}`)
        send({ type: 'tool_call', name, args })

        const toolMsg: Message = {
          id: randomUUID(),
          sessionId: activeSessionId,
          role: 'assistant',
          messageType: 'tool_use',
          content: '',
          toolCalls: [{
            id: randomUUID(),
            toolName: name,
            args,
            status: 'pending',
            timestamp: Date.now()
          }],
          timestamp: Date.now()
        }
        persistMessageAtomic(toolMsg, activeSessionId)
      },
      onToolResult: (name: string, output: string, isError: boolean) => {
        console.log(`[Runtime] tool_result: ${name} ${isError ? 'ERROR' : 'OK'} → ${(output || '').substring(0, 120)}...`)

        const toolResultMsg: Message = {
          id: randomUUID(),
          sessionId: activeSessionId,
          role: 'tool',
          messageType: 'tool_result',
          content: output,
          toolCalls: [{
            id: randomUUID(),
            toolName: name,
            args: {},
            output,
            status: isError ? 'error' : 'success',
            timestamp: Date.now()
          }],
          timestamp: Date.now()
        }
        persistMessageAtomic(toolResultMsg, activeSessionId)

        const pathMatch = output?.match(/([^\s]+\.png)/i)
        if (pathMatch && !isError && name !== 'evaluate_images') {
          const imgPath = pathMatch[1]
          try {
            const buf = readFileSync(imgPath)
            const base64 = `data:image/png;base64,${buf.toString('base64')}`
            send({ type: 'tool_result', name, output, isError, imageBase64: base64 })
          } catch (err) {
            console.error(`[Runtime] failed to read image: ${imgPath}`, err)
            send({ type: 'tool_result', name, output, isError })
          }
        } else {
          send({ type: 'tool_result', name, output, isError })
        }
      },
      onComplete: (finalText: string) => {
        console.log(`[Runtime] complete: ${(finalText || '').substring(0, 120)}...`)

        if (finalText && finalText.startsWith('API Error')) {
          send({ type: 'error', message: finalText })
          sessionRepo.touch(activeSessionId)
          return
        }

        const assistantMsg: Message = {
          id: randomUUID(),
          sessionId: activeSessionId,
          role: 'assistant',
          messageType: 'text',
          content: finalText,
          timestamp: Date.now()
        }
        persistMessageAtomic(assistantMsg, activeSessionId)
        for (const f of tempFiles) {
          unlink(f).then(() => console.log(`[Runtime] cleaned temp: ${f}`)).catch(() => {})
        }
        cleanupIntermediateFiles()
        send({ type: 'complete', text: finalText })
        sessionRepo.touch(activeSessionId)
      },
      onError: (error: Error) => {
        console.error(`[Runtime] error: ${error.message}`)
        send({ type: 'error', message: error.message })
        sessionRepo.touch(activeSessionId)
      },
      onGoalCreated: (goalId: string, title: string) => {
        console.log(`[Runtime] goal created: ${goalId} — ${title}`)
      },
      onGoalFinished: (goalId: string, status: string) => {
        console.log(`[Runtime] goal finished: ${goalId} — ${status}`)
      },
      onRoundStart: (round: number) => {
        console.log(`[Runtime] round ${round} start`)
      },
      onRoundEnd: (round: number) => {
        console.log(`[Runtime] round ${round} end`)
      },
      onTurnText: (text: string, reasoningContent?: string) => {
        if (!text || !text.trim()) return
        console.log(`[Runtime] turn_text: ${text.substring(0, 80)}...`)
        const turnMsg: Message = {
          id: randomUUID(),
          sessionId: activeSessionId,
          role: 'assistant',
          messageType: 'text',
          content: text,
          reasoningContent,
          timestamp: Date.now()
        }
        persistMessageAtomic(turnMsg, activeSessionId)
      },
      onEvent: (event: import('@shared/types').AgentEvent) => {
        send(event as unknown as Record<string, unknown>)
      }
    }

    const home = homedir()
    const resourceRegistry = new ResourceRegistry()
    resourceRegistry.register(new FilesystemResource(home))
    resourceRegistry.register(new TerminalResource())
    const memoryResource = new MemoryResource()
    resourceRegistry.register(memoryResource)
    const visionDescriber = new VisionDescriber()

    const ollamaConfig = currentConfig.ollama
    if (ollamaConfig?.enabled) {
      visionDescriber.addProvider(new OllamaVisionProvider({
        host: ollamaConfig.host || 'http://localhost:11434',
        model: ollamaConfig.model || 'moondream'
      }))
    }

    const remoteVisionConfig = currentConfig.remoteVision
    if (remoteVisionConfig?.enabled) {
      visionDescriber.addProvider(new RemoteVisionProvider({
        apiBaseUrl: remoteVisionConfig.apiBaseUrl,
        apiKey: remoteVisionConfig.apiKey,
        model: remoteVisionConfig.model
      }))
    }

    const visionResource = new VisionResource(visionDescriber)
    resourceRegistry.register(visionResource)

    const savedMessages = messageRepo.getActiveMessages(activeSessionId)
    for (const msg of savedMessages) {
      if (msg.role === 'assistant' && msg.content) {
        memoryResource.store(`round_${msg.timestamp}`, msg.content, 'note')
      }
    }

    const taskToolConfig: import('@tools/task-tool').TaskToolConfig = {
      llmProvider,
      baseConfig: { ...currentConfig, systemPrompt: HARNESS_SYSTEM_PROMPT },
      toolFactory: () => createFullToolRegistry(),
      parentCallbacks: agentCallbacks,
      parentSessionId: activeSessionId,
      skillLoader,
      resourceRegistry
    }
    const rawVibe = currentConfig.vibeCoding || { enabled: false, cliPath: '', argsTemplate: '{prompt}', workingDir: '', timeout: 120000, verifyType: 'none', verifyUrl: '', verifyCommand: '' }
    const vibeConfig = { ...rawVibe, workingDir: rawVibe.workingDir || home }
    const toolRegistry = createMultiAgentToolRegistry(taskToolConfig, vibeConfig, skillLoader, visionResource)
    activeTaskTool = toolRegistry.get('task') as TaskTool | null

    llmProvider = new OpenAILLMProvider(
      Array.from(toolRegistry.values()).map(t => t.definition)
    )

    const toolsResource = new ToolsResource(toolRegistry, vibeConfig.enabled ? vibeConfig : undefined)
    resourceRegistry.register(toolsResource)

    const askUserTool = toolRegistry.get('ask_user') as AskUserTool | null
    if (askUserTool) {
      askUserTool.setWaitCallback(async (message: string, screenshot: string | undefined, options: Array<{ label: string; value: string }>) => {
        let imageBase64 = ''
        if (screenshot && screenshot.startsWith('/')) {
          try {
            const buf = readFileSync(screenshot)
            imageBase64 = `data:image/png;base64,${buf.toString('base64')}`
          } catch (err) {
            console.error(`[Runtime] failed to read ask_user screenshot: ${screenshot}`, err)
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

    const images = options?.images?.map(img => ({
      url: `data:${img.mediaType};base64,${img.data}`,
      alt: 'User uploaded image'
    }))

    let effectiveUserInput = userInput
    const imagePaths: string[] = []
    if (images && images.length > 0) {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { join } = await import('path')
      const { tmpdir } = await import('os')
      const imgDir = join(tmpdir(), 'verdant-uploads')
      mkdirSync(imgDir, { recursive: true })

      for (let i = 0; i < images.length; i++) {
        const img = options!.images![i]
        const filename = `upload_${Date.now()}_${i}.${img.mediaType.split('/')[1] || 'png'}`
        const filepath = join(imgDir, filename)
        writeFileSync(filepath, Buffer.from(img.data, 'base64'))
        imagePaths.push(filepath)
      }

      const imageNote = imagePaths.length === 1
        ? `\n\n[User attached 1 image, saved to: ${imagePaths[0]}]`
        : `\n\n[User attached ${imagePaths.length} images, saved to: ${imagePaths.join(', ')}]`

      effectiveUserInput = userInput + imageNote
    }

    const userMsg: Message = {
      id: randomUUID(),
      sessionId: activeSessionId,
      role: 'user',
      messageType: 'text',
      content: userInput,
      blocks: images ? [{ type: 'image' as const, imagePath: images[0].url, imageAlt: images[0].alt }] : undefined,
      timestamp: Date.now()
    }
    persistMessageAtomic(userMsg, activeSessionId)

    const goalManager = new GoalManager()

    const normalizerRegistry = new NormalizerRegistry()
    normalizerRegistry.register(new VisionNormalizer(visionResource))
    normalizerRegistry.register(new CompileNormalizer())

    const projector = new StateProjector(resourceRegistry, goalManager, memoryResource, normalizerRegistry)
    const formatter = new ContextFormatter(systemPrompt, `Platform: ${process.platform}\nHome: ${home}`)
    const executor = new ExecutorManager(toolRegistry, {
      beforeExecute: (toolName: string, args: Record<string, unknown>) => {
        const cmd = (args?.command as string) || ''
        const path = (args?.path as string) || ''

        if (toolName === 'bash' && cmd) {
          const rmMatch = cmd.match(/\brm\b/)
          if (rmMatch) {
            if (!cmd.includes('/tmp/') && !cmd.includes('/var/tmp/')) {
              console.log(`[Runtime] blocking delete command: ${cmd.substring(0, 80)}`)
              return {
                block: true,
                reason: `This command will delete files: "${cmd.substring(0, 100)}". Use ask_user to confirm with the user before retrying this command.`
              }
            }
          }
        }

        if (path) {
          if (path.startsWith('/tmp/') || path.startsWith('/var/tmp/')) {
            if (toolName === 'write') {
              tempFiles.push(path)
            }
          }
          if (toolName === 'write' && (path.endsWith('.json') || path.endsWith('.txt') || path.endsWith('.py') || path.endsWith('.tmp'))) {
            if (!path.startsWith('/Users/') || path.includes('/tmp/') || path === 'story_outlines.json' || path === 'stories.json') {
              tempFiles.push(path)
            }
          }
        }
        if (cmd && (cmd.includes('/tmp/') || cmd.includes('/var/tmp/'))) {
          if (cmd.includes('>') || cmd.includes('cat >') || cmd.includes('tee ')) {
            const match = cmd.match(/(?:>|tee\s+)(['"]?)(\/tmp\/[^\s'"]+|\/var\/tmp\/[^\s'"]+)\1/)
            if (match?.[2]) {
              tempFiles.push(match[2])
            }
          }
        }
        if (cmd && (cmd.includes('> ') || cmd.includes('cat >') || cmd.includes('tee '))) {
          const fileMatch = cmd.match(/(?:>|tee\s+)(['"]?)([^'"\s|]+)\1/)
          if (fileMatch?.[2] && !fileMatch[2].startsWith('/dev/')) {
            const filePath = fileMatch[2]
            if (filePath.endsWith('.json') || filePath.endsWith('.txt') || filePath.endsWith('.py') || filePath.endsWith('.tmp') || filePath.endsWith('.sh')) {
              tempFiles.push(filePath)
            }
          }
        }
      }
    }, {
      sessionId: activeSessionId,
      workingDirectory: home,
      timeout: currentConfig.shellTimeout,
      maxOutputLength: currentConfig.maxOutputLength
    })

    const observationBuilder = new ObservationBuilder(resourceRegistry)

    runtimeLoop = new RuntimeLoop(
      projector,
      formatter,
      executor,
      llmProvider,
      goalManager,
      {
        maxIterations: currentConfig.maxIterations,
        systemPrompt,
        agentConfig: { ...currentConfig, systemPrompt }
      },
      agentCallbacks as RuntimeLoopCallbacks,
      observationBuilder
    )

    try {
      const finalText = await runtimeLoop.run(effectiveUserInput, images)

      if (compactionService.shouldCompact(activeSessionId)) {
        const _result = await compactionService.compactSession(activeSessionId)
        if (_result) {
          send({
            type: 'complete',
            text: `[Context compacted: ${_result.compactedCount} messages summarized, ${_result.tokensBefore} → ${_result.tokensAfter} tokens]`
          })
        }
      }

      console.log(`[Runtime] === done: "${(finalText || '').substring(0, 80)}..." ===`)
      return { success: true, finalText }
    } catch (err) {
      console.error(`[Runtime] === failed: ${err instanceof Error ? err.message : String(err)} ===`)
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      return { success: false, error: 'agent_error' }
    } finally {
      runtimeLoop = null
      activeTaskTool = null
    }
  })

  ipcMain.handle('agent:stop', async () => {
    activeTaskTool?.stopAll()
    runtimeLoop?.stop()
    const shellTool = Array.from(createFullToolRegistry().values()).find(t => t instanceof ShellTool) as ShellTool | undefined
    shellTool?.killAll()
    return { success: true }
  })

  ipcMain.handle('agent:steer', async (_event, message: string) => {
    if (!runtimeLoop) return { success: false, error: 'no_active_agent' }
    runtimeLoop.steer(message)
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

  ipcMain.handle('message:persist', async (_event, message: Record<string, unknown>) => {
    const msg: Message = {
      id: (message.id as string) || randomUUID(),
      sessionId: (message.sessionId as string) || currentSessionId || '',
      role: (message.role as Message['role']) || 'assistant',
      messageType: (message.messageType as Message['messageType']) || 'text',
      content: (message.content as string) || '',
      timestamp: (message.timestamp as number) || Date.now(),
      blocks: message.blocks as Message['blocks'],
      reasoningContent: message.reasoningContent as string | undefined
    }
    persistMessageAtomic(msg, msg.sessionId)
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
  // Set app icon for macOS Dock
  if (process.platform === 'darwin') {
    try {
      app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
    } catch {
      // ignore
    }
  }

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
