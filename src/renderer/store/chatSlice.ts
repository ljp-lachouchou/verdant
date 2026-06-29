import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { Message, Session, AgentStreamEvent, ContentBlock } from '@shared/types'
import { setAgentStatus, startTool, finishTool, clearTools, clearSubAgents, clearPlan, setPlanSteps, registerSubAgent, updateSubAgent } from './statusSlice'

export interface ChatState {
  sessions: Session[]
  activeSessionId: string | null
  streamingSessionId: string | null
  activeRequestId: string | null
  messages: Message[]
  streamingBlocks: ContentBlock[]
  isLoading: boolean
  error: string | null
  needsConfig: boolean
  stopped: boolean
  waitUser: { message: string; screenshot: string } | null
}

const initialState: ChatState = {
  sessions: [],
  activeSessionId: null,
  streamingSessionId: null,
  activeRequestId: null,
  messages: [],
  streamingBlocks: [],
  isLoading: false,
  error: null,
  needsConfig: false,
  stopped: false,
  waitUser: null
}

const getAPI = (): any => (window as any).agentAPI

const newId = () => crypto.randomUUID()
const now = () => Date.now()

function getCurrentTextBlock(blocks: ContentBlock[]): ContentBlock | null {
  if (blocks.length === 0) return null
  const last = blocks[blocks.length - 1]
  return last.type === 'text' ? last : null
}

function pushAssistantMessageWithBlocks(state: ChatState, blocks: ContentBlock[]) {
  // Filter out empty text blocks and tool_call blocks without output
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
    sessionId: state.streamingSessionId || state.activeSessionId || '',
    role: 'assistant',
    messageType: 'text',
    content: textContent,
    blocks: cleanBlocks,
    timestamp: now()
  })
}

export const initSessions = createAsyncThunk('chat/initSessions', async () => {
  return await getAPI().listSessions()
})

export const createSession = createAsyncThunk('chat/createSession', async (name?: string) => {
  return await getAPI().createSession(name)
})

export const deleteSession = createAsyncThunk('chat/deleteSession', async (id: string) => {
  await getAPI().deleteSession(id)
  return id
})

export const loadSessionMessages = createAsyncThunk(
  'chat/loadSessionMessages',
  async (sessionId: string) => {
    const result = await getAPI().loadSession(sessionId)
    return { sessionId, messages: result.messages as Message[], session: result.session as Session }
  }
)

export const sendAgentMessage = createAsyncThunk(
  'chat/sendAgentMessage',
  async (userInput: string, { dispatch, getState }) => {
    const state = getState() as { chat: ChatState }
    let requestSessionId = state.chat.activeSessionId
    const requestId = crypto.randomUUID()

    dispatch(chatSlice.actions.addUserMessage(userInput))
    dispatch(chatSlice.actions.setLoading(true))
    dispatch(chatSlice.actions.clearStreaming())
    dispatch(clearTools())
    dispatch(clearSubAgents())
    dispatch(clearPlan())
    dispatch(chatSlice.actions.resetStopped())
    dispatch(chatSlice.actions.setActiveRequestId(requestId))
    dispatch(setAgentStatus('thinking'))

    // Listen for session creation if we don't have one yet
    let sessionCreatedUnsub: (() => void) | null = null
    if (!requestSessionId) {
      sessionCreatedUnsub = getAPI().onSessionCreated((session: Session) => {
        requestSessionId = session.id
        dispatch(chatSlice.actions.updateActiveSession(session.id))
        dispatch(chatSlice.actions.setStreamingSession(session.id))
        dispatch(initSessions())
      })
    } else {
      dispatch(chatSlice.actions.setStreamingSession(requestSessionId))
    }

    // Listen for session title update (when first message renames session)
    const sessionUpdatedUnsub = getAPI().onSessionUpdated?.((_session: { id: string; name: string }) => {
      dispatch(initSessions())
    })

    let streamDone = false

    const unsubscribe = getAPI().onAgentStream((event: AgentStreamEvent) => {
      // Check if this request is still the active one
      const currentState = getState() as { chat: ChatState }
      if (currentState.chat.activeRequestId !== requestId) return
      if (currentState.chat.stopped) return

      // Drop events from a different session
      if (event.sessionId && requestSessionId && event.sessionId !== requestSessionId) {
        return
      }

      if (event.type === 'complete' || event.type === 'error') {
        streamDone = true
      }

      if (event.type === 'tool_call') {
        dispatch(setAgentStatus('working'))
        dispatch(startTool({
          id: `${event.name}-${Date.now()}`,
          toolName: event.name || 'unknown',
          command: (event.args?.command as string) || (event.args?.path as string)
        }))
      }
      if (event.type === 'tool_result') {
        dispatch(finishTool({
          id: 'placeholder',
          output: event.output,
          error: event.isError ? event.output : undefined,
          isError: !!event.isError
        }))
        dispatch(setAgentStatus('thinking'))
      }
      if (event.type === 'token' || event.type === 'text_chunk') {
        dispatch(setAgentStatus('thinking'))
      }
      if (event.type === 'complete') {
        dispatch(setAgentStatus('complete'))
      }
      if (event.type === 'error') {
        dispatch(setAgentStatus('error'))
      }
      if (event.type === 'wait_user') {
        dispatch(chatSlice.actions.setWaitUser({
          message: event.message || 'Please check the browser and click Continue.',
          screenshot: event.text || ''
        }))
      }

      // Sub-agent events
      if (event.type === 'plan_created') {
        dispatch(setAgentStatus('working'))
        if (event.planSteps) {
          dispatch(setPlanSteps(event.planSteps))
        }
      }
      if (event.type === 'subagent_register' && event.subAgentId) {
        dispatch(registerSubAgent({
          id: event.subAgentId,
          name: event.subAgentName || 'Sub-Agent',
          status: 'running',
          task: event.subAgentTask,
          prompt: event.subAgentTask,
          startTime: Date.now()
        }))
      }
      if (event.type === 'subagent_update' && event.subAgentId) {
        dispatch(updateSubAgent({
          id: event.subAgentId,
          status: (event.subAgentStatus as 'running' | 'success' | 'error') || 'error',
          endTime: event.subAgentStatus === 'error' || event.subAgentStatus === 'success' ? Date.now() : undefined
        }))
      }
      if (event.type === 'subagent_complete' && event.subAgentId) {
        dispatch(updateSubAgent({
          id: event.subAgentId,
          status: 'success',
          endTime: Date.now(),
          result: event.subAgentResult
        } as any))
      }

      dispatch(chatSlice.actions.handleStreamEvent(event))
    })

    try {
      const result = await getAPI().sendAgentMessage(userInput)

      if (result && !result.success && result.error === 'config_required') {
        dispatch(chatSlice.actions.setNeedsConfig(true))
        dispatch(chatSlice.actions.addAssistantMessage(
          result.text || 'No API key configured. Please open Settings.'
        ))
      } else if (!streamDone) {
        dispatch(chatSlice.actions.commitStreamingBlocks())
        dispatch(setAgentStatus('complete'))
      }
    } catch (err) {
      dispatch(chatSlice.actions.setError(err instanceof Error ? err.message : String(err)))
      dispatch(chatSlice.actions.commitStreamingBlocks())
    } finally {
      unsubscribe()
      sessionCreatedUnsub?.()
      sessionUpdatedUnsub?.()
      // Only clear if this is still our request
      const finalState = getState() as { chat: ChatState }
      if (finalState.chat.activeRequestId === requestId) {
        dispatch(chatSlice.actions.setLoading(false))
        dispatch(chatSlice.actions.setStreamingSession(null))
        dispatch(chatSlice.actions.setActiveRequestId(null))
        setTimeout(() => dispatch(setAgentStatus('idle')), 1500)
      }
    }
  }
)

export const stopAgent = createAsyncThunk(
  'chat/stopAgent',
  async (_, { dispatch }) => {
    dispatch(chatSlice.actions.markStopped())
    dispatch(chatSlice.actions.setActiveRequestId(null))
    await getAPI().stopAgent()
    dispatch(chatSlice.actions.commitStreamingBlocks())
    dispatch(chatSlice.actions.setLoading(false))
    dispatch(chatSlice.actions.setStreamingSession(null))
    dispatch(setAgentStatus('idle'))
  }
)

export const steerAgent = createAsyncThunk('chat/steerAgent', async (message: string) => {
  await getAPI().steerAgent?.(message)
})

export const continueAfterWait = createAsyncThunk(
  'chat/continueAfterWait',
  async (_, { dispatch }) => {
    await getAPI().browserContinue?.()
    dispatch(chatSlice.actions.setWaitUser(null))
  }
)

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addUserMessage: (state, action: PayloadAction<string>) => {
      state.messages.push({
        id: newId(),
        sessionId: state.activeSessionId || '',
        role: 'user',
        messageType: 'text',
        content: action.payload,
        timestamp: now()
      })
      state.error = null
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
    commitStreamingBlocks: (state) => {
      if (state.streamingBlocks.length > 0) {
        pushAssistantMessageWithBlocks(state, state.streamingBlocks)
        state.streamingBlocks = []
      }
    },
    setNeedsConfig: (state, action: PayloadAction<boolean>) => {
      state.needsConfig = action.payload
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    clearStreaming: (state) => {
      state.streamingBlocks = []
    },
    handleStreamEvent: (state, action: PayloadAction<AgentStreamEvent>) => {
      const event = action.payload

      // Only process events for the session that's currently streaming
      if (state.streamingSessionId && event.sessionId && event.sessionId !== state.streamingSessionId) {
        return
      }

      switch (event.type) {
        case 'config_required':
          state.needsConfig = true
          state.messages.push({
            id: newId(),
            sessionId: state.streamingSessionId || state.activeSessionId || '',
            role: 'assistant',
            messageType: 'text',
            content: event.text || 'No API key configured. Please open Settings.',
            blocks: [{ type: 'text', text: event.text || 'No API key configured.' }],
            timestamp: now()
          })
          state.streamingBlocks = []
          break

        case 'token': {
          let textBlock = getCurrentTextBlock(state.streamingBlocks)
          if (!textBlock) {
            textBlock = { type: 'text', text: '' }
            state.streamingBlocks.push(textBlock)
          }
          textBlock.text = (textBlock.text || '') + (event.token || '')
          break
        }

        case 'text_chunk': {
          // text_chunk is pre-tool-call text from onTextChunk — always new block
          // to avoid duplicating with token events
          if (event.text) {
            state.streamingBlocks.push({ type: 'text', text: event.text })
          }
          break
        }

        case 'tool_call': {
          state.streamingBlocks.push({
            type: 'tool_call',
            toolName: event.name || '',
            command: (event.args?.command as string) || (event.args?.path as string) || '',
            status: 'running'
          })
          break
        }

        case 'tool_result': {
          for (let i = state.streamingBlocks.length - 1; i >= 0; i--) {
            if (state.streamingBlocks[i].type === 'tool_call' && state.streamingBlocks[i].status === 'running') {
              state.streamingBlocks[i].output = event.output
              state.streamingBlocks[i].status = event.isError ? 'error' : 'success'

              // If imageBase64 provided, push an image block after this tool block
              if (event.imageBase64 && !event.isError) {
                state.streamingBlocks.splice(i + 1, 0, {
                  type: 'image',
                  imagePath: event.imageBase64,
                  imageAlt: 'Screenshot'
                })
              }

              // If this is a skill tool, push a skill block
              if (event.name === 'skill' && !event.isError) {
                const nameMatch = event.output?.match(/name="([^"]+)"/)
                const skillName = nameMatch?.[1] || 'unknown'
                // Extract description from first paragraph after title
                const descMatch = event.output?.match(/^#\s+.*?\n\n([\s\S]*?)(?:\n\n|\n##)/)
                const skillDesc = descMatch?.[1]?.trim() || ''
                state.streamingBlocks.splice(i + 1, 0, {
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
          // Only add event.text if streamingBlocks has no text at all
          const hasText = state.streamingBlocks.some(b => b.type === 'text' && b.text && b.text.trim())
          if (event.text && !hasText) {
            state.streamingBlocks.push({ type: 'text', text: event.text })
          }
          if (state.streamingBlocks.length > 0) {
            pushAssistantMessageWithBlocks(state, state.streamingBlocks)
            state.streamingBlocks = []
          }
          break
        }

        case 'error': {
          if (state.streamingBlocks.length > 0) {
            pushAssistantMessageWithBlocks(state, state.streamingBlocks)
            state.streamingBlocks = []
          }
          state.error = event.message || 'Unknown error'
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
      state.error = null
    },
    updateActiveSession: (state, action: PayloadAction<string>) => {
      state.activeSessionId = action.payload
    },
    setStreamingSession: (state, action: PayloadAction<string | null>) => {
      state.streamingSessionId = action.payload
      if (action.payload === null) {
        state.streamingBlocks = []
      }
    },
    markStopped: (state) => {
      state.stopped = true
    },
    resetStopped: (state) => {
      state.stopped = false
    },
    setActiveRequestId: (state, action: PayloadAction<string | null>) => {
      state.activeRequestId = action.payload
    },
    setWaitUser: (state, action: PayloadAction<{ message: string; screenshot: string } | null>) => {
      state.waitUser = action.payload
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
        if (state.activeSessionId === action.payload) {
          state.activeSessionId = null
          state.messages = []
        }
      })
      .addCase(loadSessionMessages.fulfilled, (state, action) => {
        state.activeSessionId = action.payload.sessionId
        // Reconstruct blocks from toolCalls for each message
        state.messages = action.payload.messages.map(msg => {
          if (msg.toolCalls && msg.toolCalls.length > 0 && !msg.blocks) {
            const blocks: ContentBlock[] = []
            if (msg.content) {
              blocks.push({ type: 'text', text: msg.content })
            }
            for (const tc of msg.toolCalls) {
              blocks.push({
                type: 'tool_call',
                toolName: tc.toolName,
                command: (tc.args?.command as string) || (tc.args?.path as string) || '',
                output: tc.output,
                status: tc.status === 'error' ? 'error' : 'success'
              })
            }
            return { ...msg, blocks }
          }
          return msg
        })
        state.streamingBlocks = []
        state.error = null
      })
  }
})

export const {
  addUserMessage, addAssistantMessage, commitStreamingBlocks,
  setNeedsConfig, setLoading, setError, clearStreaming, handleStreamEvent,
  setActiveSession, updateActiveSession, setStreamingSession, markStopped, resetStopped,
  setActiveRequestId, setWaitUser
} = chatSlice.actions
export default chatSlice.reducer
