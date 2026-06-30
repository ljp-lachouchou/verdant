import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { Message, Session, AgentStreamEvent, ContentBlock } from '@shared/types'
import { setAgentStatus, startTool, finishTool, setPlanSteps, registerSubAgent, updateSubAgent } from './statusSlice'
import { BlockSerializer } from '../utils/blockSerializer'

interface SessionStreamState {
  streamingBlocks: ContentBlock[]
  isLoading: boolean
  requestId: string | null
  error: string | null
  stopped: boolean
  waitUser: { message: string; screenshot: string; options?: Array<{ label: string; value: string }> } | null
}

export interface ChatState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Message[]
  sessionStreams: Record<string, SessionStreamState>
  needsConfig: boolean
}

function emptyStream(): SessionStreamState {
  return {
    streamingBlocks: [],
    isLoading: false,
    requestId: null,
    error: null,
    stopped: false,
    waitUser: null
  }
}

const initialState: ChatState = {
  sessions: [],
  activeSessionId: null,
  messages: [],
  sessionStreams: {},
  needsConfig: false
}

const getAPI = (): any => (window as any).agentAPI

const newId = () => crypto.randomUUID()
const now = () => Date.now()

function getStream(state: ChatState, sessionId: string): SessionStreamState {
  if (!state.sessionStreams[sessionId]) {
    state.sessionStreams[sessionId] = emptyStream()
  }
  return state.sessionStreams[sessionId]
}

function getCurrentTextBlock(blocks: ContentBlock[]): ContentBlock | null {
  if (blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  return last.type === 'text' ? last : null
}

function pushAssistantMessageWithBlocks(state: ChatState, blocks: ContentBlock[], sessionId: string) {
  const cleanBlocks = blocks.filter(b => {
    if (b.type === 'text') return b.text && b.text.trim()
    if (b.type === 'tool_call') return b.toolName
    return true
  })

  if (cleanBlocks.length === 0) return

  const textContent = cleanBlocks
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join('\n\n')

  state.messages.push({
    id: newId(),
    sessionId,
    role: 'assistant',
    messageType: 'text',
    content: textContent,
    blocks: cleanBlocks,
    timestamp: now()
  })
}

export const initSessions = createAsyncThunk(
  'chat/initSessions',
  async () => {
    return await getAPI().listSessions()
  }
)

export const createSession = createAsyncThunk(
  'chat/createSession',
  async (name?: string) => {
    return await getAPI().createSession(name)
  }
)

export const deleteSession = createAsyncThunk(
  'chat/deleteSession',
  async (id: string) => {
    await getAPI().deleteSession(id)
    return id
  }
)

export const loadSessionMessages = createAsyncThunk(
  'chat/loadSessionMessages',
  async (sessionId: string) => {
    const result = await getAPI().loadSession(sessionId)
    return { sessionId, messages: result.messages as Message[], session: result.session as Session }
  }
)

export const sendAgentMessage = createAsyncThunk(
  'chat/sendAgentMessage',
  async (params: { text: string; images?: Array<{ data: string; mediaType: string }> }, { dispatch, getState }) => {
    const { text: userInput, images } = params
    const state = getState() as { chat: ChatState }
    let requestSessionId = state.chat.activeSessionId
    const requestId = crypto.randomUUID()

    dispatch(chatSlice.actions.startSessionStream({ sessionId: requestSessionId || '', requestId }))

    if (requestSessionId) {
      dispatch(chatSlice.actions.addUserMessage({ text: userInput, images }))
    }

    dispatch(setAgentStatus('thinking'))

    let sessionCreatedUnsub: (() => void) | null = null
    if (!requestSessionId) {
      sessionCreatedUnsub = getAPI().onSessionCreated((session: Session) => {
        requestSessionId = session.id
        dispatch(chatSlice.actions.updateActiveSession(session.id))
        dispatch(chatSlice.actions.setStreamSessionId({ oldId: '', newId: session.id, requestId }))
        dispatch(chatSlice.actions.addUserMessage({ text: userInput, images }))
        dispatch(chatSlice.actions.insertSession(session))
      })
    }

    const sessionUpdatedUnsub = getAPI().onSessionUpdated?.((session: { id: string; name: string }) => {
      dispatch(chatSlice.actions.updateSessionName(session))
    })

    let streamDone = false

    const unsubscribe = getAPI().onAgentStream((event: AgentStreamEvent) => {
      const currentState = getState() as { chat: ChatState }
      const sid = event.sessionId || requestSessionId
      if (!sid) return

      const stream = currentState.chat.sessionStreams[sid]
      if (!stream || stream.requestId !== requestId) return
      if (stream.stopped) return

      if (event.type === 'complete' || event.type === 'error') {
        streamDone = true
      }

      if (event.type === 'tool_call') {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(setAgentStatus('working'))
          dispatch(startTool({
            id: `${event.name}-${Date.now()}`,
            toolName: event.name || 'unknown',
            command: (event.args?.command as string) || (event.args?.path as string)
          }))
        }
      }
      if (event.type === 'tool_result') {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(finishTool({
            id: 'placeholder',
            output: event.output,
            error: event.isError ? event.output : undefined,
            isError: !!event.isError
          }))
          dispatch(setAgentStatus('thinking'))
        }
      }
      if (event.type === 'token' || event.type === 'text_chunk') {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(setAgentStatus('thinking'))
        }
      }
      if (event.type === 'complete') {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(setAgentStatus('complete'))
        }
      }
      if (event.type === 'error') {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(setAgentStatus('error'))
        }
      }
      if (event.type === 'wait_user') {
        dispatch(chatSlice.actions.setWaitUser({
          sessionId: sid,
          waitUser: {
            message: event.message || 'Please check the browser and click Continue.',
            screenshot: event.text || '',
            options: event.options
          }
        }))
      }

      if (event.type === 'plan_created') {
        if (sid === currentState.chat.activeSessionId && event.planSteps) {
          dispatch(setPlanSteps(event.planSteps))
        }
      }
      if (event.type === 'subagent_register' && event.subAgentId) {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(registerSubAgent({
            id: event.subAgentId,
            name: event.subAgentName || 'Sub-Agent',
            status: 'running',
            task: event.subAgentTask,
            prompt: event.subAgentTask,
            startTime: Date.now()
          }))
        }
        dispatch(chatSlice.actions.addSubAgentBlock({
          sessionId: sid,
          subAgentId: event.subAgentId,
          subAgentName: event.subAgentName || 'Sub-Agent',
          subAgentStatus: 'running'
        }))
      }
      if (event.type === 'subagent_update' && event.subAgentId) {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(updateSubAgent({
            id: event.subAgentId,
            status: (event.subAgentStatus as 'running' | 'success' | 'error') || 'error',
            endTime: event.subAgentStatus === 'error' || event.subAgentStatus === 'success' ? Date.now() : undefined
          }))
        }
        dispatch(chatSlice.actions.updateSubAgentBlock({
          sessionId: sid,
          subAgentId: event.subAgentId,
          subAgentStatus: (event.subAgentStatus as 'running' | 'success' | 'error') || 'error'
        }))
      }
      if (event.type === 'subagent_complete' && event.subAgentId) {
        if (sid === currentState.chat.activeSessionId) {
          dispatch(updateSubAgent({
            id: event.subAgentId,
            status: 'success',
            endTime: Date.now(),
            result: event.subAgentResult
          } as any))
        }
        dispatch(chatSlice.actions.updateSubAgentBlock({
          sessionId: sid,
          subAgentId: event.subAgentId,
          subAgentStatus: 'success',
          subAgentResult: event.subAgentResult
        }))
      }

      dispatch(chatSlice.actions.handleStreamEvent({ event, sessionId: sid }))
    })

    try {
      const result = await getAPI().sendAgentMessage(userInput, images ? { images } : undefined)

      if (result && !result.success && result.error === 'config_required') {
        dispatch(chatSlice.actions.setNeedsConfig(true))
        dispatch(chatSlice.actions.addAssistantMessage(
          result.text || 'No API key configured. Please open Settings.'
        ))
      } else if (!streamDone) {
        dispatch(chatSlice.actions.commitStreamingBlocks(requestSessionId || ''))
        dispatch(setAgentStatus('complete'))
      }
    } catch (err) {
      dispatch(chatSlice.actions.setError({ sessionId: requestSessionId || '', error: err instanceof Error ? err.message : String(err) }))
      dispatch(chatSlice.actions.commitStreamingBlocks(requestSessionId || ''))
    } finally {
      unsubscribe()
      sessionCreatedUnsub?.()
      sessionUpdatedUnsub?.()
      dispatch(chatSlice.actions.finishSessionStream(requestSessionId || ''))
      const finalState = getState() as { chat: ChatState }
      if (finalState.chat.activeSessionId === requestSessionId) {
        setTimeout(() => dispatch(setAgentStatus('idle')), 1500)
      }
    }
  }
)

export const stopAgent = createAsyncThunk(
  'chat/stopAgent',
  async (_, { dispatch, getState }) => {
    const state = getState() as { chat: ChatState }
    const sid = state.chat.activeSessionId
    if (!sid) return
    dispatch(chatSlice.actions.markStopped(sid))
    await getAPI().stopAgent()
    dispatch(chatSlice.actions.commitStreamingBlocks(sid))
    dispatch(chatSlice.actions.finishSessionStream(sid))
    dispatch(setAgentStatus('idle'))
  }
)

export const continueAfterWait = createAsyncThunk(
  'chat/continueAfterWait',
  async (response: string | undefined, { dispatch, getState }) => {
    await getAPI().browserContinue?.(response)
    const state = getState() as { chat: ChatState }
    const sid = state.chat.activeSessionId
    if (sid) {
      dispatch(chatSlice.actions.setWaitUser({ sessionId: sid, waitUser: null }))
    }
  }
)

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    startSessionStream: (state, action: PayloadAction<{ sessionId: string; requestId: string }>) => {
      const { sessionId, requestId } = action.payload
      const stream = getStream(state, sessionId)
      stream.requestId = requestId
      stream.isLoading = true
      stream.stopped = false
      stream.streamingBlocks = []
      stream.error = null
    },
    setStreamSessionId: (state, action: PayloadAction<{ oldId: string; newId: string; requestId: string }>) => {
      const { oldId, newId, requestId } = action.payload
      if (oldId && state.sessionStreams[oldId]) {
        const old = state.sessionStreams[oldId]
        delete state.sessionStreams[oldId]
        state.sessionStreams[newId] = { ...old, requestId }
      } else {
        const stream = getStream(state, newId)
        stream.requestId = requestId
        stream.isLoading = true
      }
    },
    finishSessionStream: (state, action: PayloadAction<string>) => {
      const sid = action.payload
      const stream = state.sessionStreams[sid]
      if (stream) {
        stream.isLoading = false
        stream.requestId = null
      }
    },
    addUserMessage: (state, action: PayloadAction<{ text: string; images?: Array<{ data: string; mediaType: string }> }>) => {
      const { text, images } = action.payload
      let blocks: ContentBlock[] | undefined
      if (images && images.length > 0) {
        blocks = []
        if (text && text.trim()) {
          blocks.push({ type: 'text', text })
        }
        for (const img of images) {
          blocks.push({
            type: 'image',
            imagePath: `data:${img.mediaType};base64,${img.data}`,
            imageAlt: 'User uploaded image'
          })
        }
      }

      state.messages.push({
        id: newId(),
        sessionId: state.activeSessionId || '',
        role: 'user',
        messageType: 'text',
        content: text,
        blocks,
        timestamp: now()
      })
    },
    addAssistantMessage: (state, action: PayloadAction<string>) => {
      state.messages.push({
        id: newId(),
        sessionId: state.activeSessionId || '',
        role: 'assistant',
        messageType: 'text',
        content: action.payload,
        blocks: [{ type: 'text', text: action.payload }],
        timestamp: now()
      })
    },
    commitStreamingBlocks: (state, action: PayloadAction<string>) => {
      const sid = action.payload
      const stream = state.sessionStreams[sid]
      if (!stream || stream.streamingBlocks.length === 0) return

      pushAssistantMessageWithBlocks(state, [...stream.streamingBlocks], sid)

      const lastMsg = state.messages[state.messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        const api = (window as unknown as { agentAPI?: { persistMessage?: (m: Record<string, unknown>) => Promise<void> } }).agentAPI
        api?.persistMessage?.({
          id: lastMsg.id,
          sessionId: lastMsg.sessionId,
          role: lastMsg.role,
          messageType: lastMsg.messageType,
          content: lastMsg.content,
          blocks: lastMsg.blocks,
          timestamp: lastMsg.timestamp
        })
      }
      stream.streamingBlocks = []
    },
    setNeedsConfig: (state, action: PayloadAction<boolean>) => {
      state.needsConfig = action.payload
    },
    setError: (state, action: PayloadAction<{ sessionId: string; error: string }>) => {
      const stream = getStream(state, action.payload.sessionId)
      stream.error = action.payload.error
    },
    clearStreaming: (state, action: PayloadAction<string>) => {
      const stream = state.sessionStreams[action.payload]
      if (stream) stream.streamingBlocks = []
    },
    handleStreamEvent: (state, action: PayloadAction<{ event: AgentStreamEvent; sessionId: string }>) => {
      const { event, sessionId } = action.payload
      const stream = getStream(state, sessionId)

      switch (event.type) {
        case 'config_required':
          state.needsConfig = true
          state.messages.push({
            id: newId(),
            sessionId,
            role: 'assistant',
            messageType: 'text',
            content: event.text || 'No API key configured. Please open Settings.',
            blocks: [{ type: 'text', text: event.text || 'No API key configured.' }],
            timestamp: now()
          })
          stream.streamingBlocks = []
          break

        case 'token': {
          let textBlock = getCurrentTextBlock(stream.streamingBlocks)
          if (!textBlock) {
            textBlock = { type: 'text', text: '' }
            stream.streamingBlocks.push(textBlock)
          }
          textBlock.text = (textBlock.text || '') + (event.token || '')
          break
        }

        case 'text_chunk': {
          if (event.text) {
            const trimmed = event.text.trim()
            if (trimmed) {
              const isDuplicate = stream.streamingBlocks.some(
                b => b.type === 'text' && b.text && b.text.includes(trimmed)
              )
              if (!isDuplicate) {
                stream.streamingBlocks.push({ type: 'text', text: event.text })
              }
            }
          }
          break
        }

        case 'tool_call': {
          const toolName = event.name || ''
          const block: ContentBlock = {
            type: 'tool_call',
            toolName,
            command: (event.args?.command as string) || (event.args?.path as string) || '',
            status: 'running'
          }
          if (toolName === 'vibe_coding' && event.args?.prompt) {
            block.promptInput = event.args.prompt as string
          }
          stream.streamingBlocks.push(block)
          break
        }

        case 'tool_result': {
          for (let i = stream.streamingBlocks.length - 1; i >= 0; i--) {
            if (stream.streamingBlocks[i].type === 'tool_call' && stream.streamingBlocks[i].status === 'running') {
              stream.streamingBlocks[i].output = event.output
              stream.streamingBlocks[i].status = event.isError ? 'error' : 'success'

              if (event.imageBase64 && !event.isError) {
                stream.streamingBlocks.splice(i + 1, 0, {
                  type: 'image',
                  imagePath: event.imageBase64,
                  imageAlt: 'Screenshot'
                })
              }

              if (event.name === 'skill' && !event.isError) {
                const nameMatch = event.output?.match(/name="([^"]+)"/)
                const skillName = nameMatch?.[1] || 'unknown'
                const descMatch = event.output?.match(/#\s+[^\n]+\n+([\s\S]*?)(?:\n##\s|$)/)
                const skillDesc = descMatch?.[1]?.trim() || event.output?.substring(0, 200) || ''
                stream.streamingBlocks.splice(i + 1, 0, {
                  type: 'skill',
                  skillName,
                  skillDescription: skillDesc
                })
              }

              break
            }
          }
          break
        }

        case 'complete': {
          const hasText = stream.streamingBlocks.some(b => b.type === 'text' && b.text && b.text.trim())
          if (event.text && !hasText) {
            stream.streamingBlocks.push({ type: 'text', text: event.text })
          }
          if (stream.streamingBlocks.length > 0) {
            pushAssistantMessageWithBlocks(state, [...stream.streamingBlocks], sessionId)

            const lastMsg = state.messages[state.messages.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              const api = (window as unknown as { agentAPI?: { persistMessage?: (m: Record<string, unknown>) => Promise<void> } }).agentAPI
              api?.persistMessage?.({
                id: lastMsg.id,
                sessionId: lastMsg.sessionId,
                role: lastMsg.role,
                messageType: lastMsg.messageType,
                content: lastMsg.content,
                blocks: lastMsg.blocks,
                timestamp: lastMsg.timestamp
              })
            }
            stream.streamingBlocks = []
          }
          break
        }

        case 'error': {
          if (stream.streamingBlocks.length > 0) {
            pushAssistantMessageWithBlocks(state, [...stream.streamingBlocks], sessionId)
            stream.streamingBlocks = []
          }
          stream.error = event.message || 'Unknown error'
          break
        }

        case 'plan_created':
        case 'subagent_register':
        case 'subagent_update':
        case 'subagent_complete':
          break
      }
    },
    setActiveSession: (state, action: PayloadAction<string | null>) => {
      state.activeSessionId = action.payload
      state.messages = []
    },
    updateActiveSession: (state, action: PayloadAction<string>) => {
      state.activeSessionId = action.payload
    },
    insertSession: (state, action: PayloadAction<Session>) => {
      if (!state.sessions.find(s => s.id === action.payload.id)) {
        state.sessions.unshift(action.payload)
      }
    },
    updateSessionName: (state, action: PayloadAction<{ id: string; name: string }>) => {
      const session = state.sessions.find(s => s.id === action.payload.id)
      if (session) {
        session.name = action.payload.name
      }
    },
    markStopped: (state, action: PayloadAction<string>) => {
      const stream = state.sessionStreams[action.payload]
      if (stream) stream.stopped = true
    },
    resetStopped: (state, action: PayloadAction<string>) => {
      const stream = state.sessionStreams[action.payload]
      if (stream) stream.stopped = false
    },
    setWaitUser: (state, action: PayloadAction<{ sessionId: string; waitUser: { message: string; screenshot: string; options?: Array<{ label: string; value: string }> } | null }>) => {
      const stream = getStream(state, action.payload.sessionId)
      stream.waitUser = action.payload.waitUser
    },
    addSubAgentBlock: (state, action: PayloadAction<{ sessionId: string; subAgentId: string; subAgentName: string; subAgentStatus: 'running' | 'success' | 'error' }>) => {
      const stream = getStream(state, action.payload.sessionId)
      stream.streamingBlocks.push({
        type: 'subagent',
        subAgentId: action.payload.subAgentId,
        subAgentName: action.payload.subAgentName,
        subAgentStatus: action.payload.subAgentStatus
      })
    },
    updateSubAgentBlock: (state, action: PayloadAction<{ sessionId: string; subAgentId: string; subAgentStatus: 'running' | 'success' | 'error'; subAgentResult?: string }>) => {
      const stream = state.sessionStreams[action.payload.sessionId]
      if (!stream) return
      for (const block of stream.streamingBlocks) {
        if (block.type === 'subagent' && block.subAgentId === action.payload.subAgentId) {
          block.subAgentStatus = action.payload.subAgentStatus
          if (action.payload.subAgentResult !== undefined) {
            block.subAgentResult = action.payload.subAgentResult
          }
          break
        }
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(initSessions.fulfilled, (state, action) => {
        state.sessions = action.payload
      })
      .addCase(createSession.fulfilled, (state, action) => {
        state.sessions.unshift(action.payload)
        state.activeSessionId = action.payload.id
        state.messages = []
      })
      .addCase(deleteSession.fulfilled, (state, action) => {
        state.sessions = state.sessions.filter((s) => s.id !== action.payload)
        delete state.sessionStreams[action.payload]
        if (state.activeSessionId === action.payload) {
          state.activeSessionId = null
          state.messages = []
        }
      })
      .addCase(loadSessionMessages.fulfilled, (state, action) => {
        state.activeSessionId = action.payload.sessionId
        state.messages = action.payload.messages.map(msg => BlockSerializer.mergeBlocks(msg))
        const stream = state.sessionStreams[action.payload.sessionId]
        if (stream) {
          stream.error = null
        }
      })
  }
})

export const {
  addUserMessage, addAssistantMessage, commitStreamingBlocks,
  setNeedsConfig, setError, clearStreaming, handleStreamEvent,
  setActiveSession, updateActiveSession, insertSession, updateSessionName,
  markStopped, resetStopped,
  setWaitUser, addSubAgentBlock, updateSubAgentBlock,
  startSessionStream, finishSessionStream, setStreamSessionId
} = chatSlice.actions

export function useSessionStream(state: ChatState, sessionId: string | null): SessionStreamState {
  if (!sessionId) return emptyStream()
  return state.sessionStreams[sessionId] || emptyStream()
}

export default chatSlice.reducer
