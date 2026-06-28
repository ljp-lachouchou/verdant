import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ToolStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolActivity {
  id: string
  toolName: string
  command?: string
  status: ToolStatus
  output?: string
  error?: string
  startTime: number
  endTime?: number
  duration?: number
}

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'complete'

export interface SubAgentInfo {
  id: string
  name: string
  status: 'idle' | 'running' | 'success' | 'error'
  task?: string
  prompt?: string
  result?: string
  startTime?: number
  endTime?: number
}

export interface PlanStepInfo {
  id: string
  name: string
  description: string
  dependencies: string[]
}

export interface StatusState {
  agentStatus: AgentStatus
  currentTool: ToolActivity | null
  toolHistory: ToolActivity[]
  subAgents: SubAgentInfo[]
  planSteps: PlanStepInfo[]
  totalToolCalls: number
  totalErrors: number
  sessionStartTime: number | null
}

const initialState: StatusState = {
  agentStatus: 'idle',
  currentTool: null,
  toolHistory: [],
  subAgents: [],
  planSteps: [],
  totalToolCalls: 0,
  totalErrors: 0,
  sessionStartTime: null
}

const statusSlice = createSlice({
  name: 'status',
  initialState,
  reducers: {
    setAgentStatus(state, action: PayloadAction<AgentStatus>) {
      state.agentStatus = action.payload
      if (action.payload === 'thinking' && !state.sessionStartTime) {
        state.sessionStartTime = Date.now()
      }
    },

    startTool(state, action: PayloadAction<{ id: string; toolName: string; command?: string }>) {
      const activity: ToolActivity = {
        id: action.payload.id,
        toolName: action.payload.toolName,
        command: action.payload.command,
        status: 'running',
        startTime: Date.now()
      }
      state.currentTool = activity
      state.agentStatus = 'working'
      state.totalToolCalls++
    },

    finishTool(state, action: PayloadAction<{ id: string; output?: string; error?: string; isError: boolean }>) {
      if (state.currentTool) {
        const tool = state.currentTool
        tool.status = action.payload.isError ? 'error' : 'success'
        tool.output = action.payload.output
        tool.error = action.payload.error
        tool.endTime = Date.now()
        tool.duration = tool.endTime - tool.startTime

        state.toolHistory.unshift(tool)
        if (state.toolHistory.length > 50) {
          state.toolHistory = state.toolHistory.slice(0, 50)
        }

        if (action.payload.isError) {
          state.totalErrors++
        }

        state.currentTool = null
        state.agentStatus = 'thinking'
      }
    },

    clearTools(state) {
      state.toolHistory = []
      state.currentTool = null
      state.totalToolCalls = 0
      state.totalErrors = 0
    },

    clearSubAgents(state) {
      state.subAgents = []
    },

    setPlanSteps(state, action: PayloadAction<PlanStepInfo[]>) {
      state.planSteps = action.payload
    },

    clearPlan(state) {
      state.planSteps = []
    },

    registerSubAgent(state, action: PayloadAction<SubAgentInfo>) {
      state.subAgents.push(action.payload)
    },

    updateSubAgent(state, action: PayloadAction<{ id: string; status: SubAgentInfo['status']; endTime?: number; result?: string }>) {
      const agent = state.subAgents.find(a => a.id === action.payload.id)
      if (agent) {
        agent.status = action.payload.status
        if (action.payload.endTime) agent.endTime = action.payload.endTime
        if (action.payload.result !== undefined) agent.result = action.payload.result
      }
    },

    removeSubAgent(state, action: PayloadAction<string>) {
      state.subAgents = state.subAgents.filter(a => a.id !== action.payload)
    },

    resetStatus(state) {
      state.agentStatus = 'idle'
      state.currentTool = null
      state.toolHistory = []
      state.subAgents = []
      state.totalToolCalls = 0
      state.totalErrors = 0
      state.sessionStartTime = null
    }
  }
})

export const {
  setAgentStatus,
  startTool,
  finishTool,
  clearTools,
  clearSubAgents,
  setPlanSteps,
  clearPlan,
  registerSubAgent,
  updateSubAgent,
  removeSubAgent,
  resetStatus
} = statusSlice.actions

export default statusSlice.reducer
