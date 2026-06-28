import statusReducer, {
  setAgentStatus,
  startTool,
  finishTool,
  clearTools,
  registerSubAgent,
  updateSubAgent,
  removeSubAgent,
  resetStatus,
  type StatusState
} from '../src/renderer/store/statusSlice'

describe('statusSlice', () => {
  let state: StatusState

  beforeEach(() => {
    state = statusReducer(undefined, { type: 'unknown' })
  })

  describe('setAgentStatus', () => {
    it('should set agent status', () => {
      const newState = statusReducer(state, setAgentStatus('thinking'))
      expect(newState.agentStatus).toBe('thinking')
    })

    it('should set sessionStartTime on first thinking', () => {
      const newState = statusReducer(state, setAgentStatus('thinking'))
      expect(newState.sessionStartTime).toBeGreaterThan(0)
    })

    it('should not overwrite sessionStartTime if already set', () => {
      const thinkingState = statusReducer(state, setAgentStatus('thinking'))
      const originalTime = thinkingState.sessionStartTime
      const workingState = statusReducer(thinkingState, setAgentStatus('working'))
      expect(workingState.sessionStartTime).toBe(originalTime)
    })

    it('should handle all status values', () => {
      const statuses: Array<StatusState['agentStatus']> = ['idle', 'thinking', 'working', 'waiting', 'error', 'complete']
      for (const s of statuses) {
        const newState = statusReducer(state, setAgentStatus(s))
        expect(newState.agentStatus).toBe(s)
      }
    })
  })

  describe('startTool', () => {
    it('should set currentTool and increment totalToolCalls', () => {
      const newState = statusReducer(state, startTool({
        id: 'tool-1',
        toolName: 'bash',
        command: 'echo hello'
      }))
      expect(newState.currentTool).not.toBeNull()
      expect(newState.currentTool!.id).toBe('tool-1')
      expect(newState.currentTool!.toolName).toBe('bash')
      expect(newState.currentTool!.command).toBe('echo hello')
      expect(newState.currentTool!.status).toBe('running')
      expect(newState.totalToolCalls).toBe(1)
      expect(newState.agentStatus).toBe('working')
    })

    it('should set startTime', () => {
      const newState = statusReducer(state, startTool({
        id: 'tool-1',
        toolName: 'read'
      }))
      expect(newState.currentTool!.startTime).toBeGreaterThan(0)
    })
  })

  describe('finishTool', () => {
    it('should move currentTool to history on success', () => {
      const runningState = statusReducer(state, startTool({
        id: 'tool-1',
        toolName: 'bash',
        command: 'echo hello'
      }))
      const finishedState = statusReducer(runningState, finishTool({
        id: 'tool-1',
        output: 'hello',
        isError: false
      }))

      expect(finishedState.currentTool).toBeNull()
      expect(finishedState.toolHistory).toHaveLength(1)
      expect(finishedState.toolHistory[0].status).toBe('success')
      expect(finishedState.toolHistory[0].output).toBe('hello')
      expect(finishedState.toolHistory[0].endTime).toBeGreaterThan(0)
      expect(finishedState.toolHistory[0].duration).toBeGreaterThanOrEqual(0)
      expect(finishedState.agentStatus).toBe('thinking')
      expect(finishedState.totalErrors).toBe(0)
    })

    it('should increment totalErrors on error', () => {
      const runningState = statusReducer(state, startTool({
        id: 'tool-1',
        toolName: 'bash'
      }))
      const finishedState = statusReducer(runningState, finishTool({
        id: 'tool-1',
        error: 'command failed',
        isError: true
      }))

      expect(finishedState.totalErrors).toBe(1)
      expect(finishedState.toolHistory[0].status).toBe('error')
      expect(finishedState.toolHistory[0].error).toBe('command failed')
    })

    it('should do nothing when finishTool called without active tool', () => {
      const finishedState = statusReducer(state, finishTool({
        id: 'wrong-id',
        isError: false
      }))

      expect(finishedState.currentTool).toBeNull()
      expect(finishedState.toolHistory).toHaveLength(0)
    })

    it('should cap history at 50 items', () => {
      let s = state
      for (let i = 0; i < 55; i++) {
        s = statusReducer(s, startTool({ id: `tool-${i}`, toolName: 'bash' }))
        s = statusReducer(s, finishTool({ id: `tool-${i}`, isError: false }))
      }
      expect(s.toolHistory.length).toBe(50)
    })
  })

  describe('clearTools', () => {
    it('should clear tool history and counters', () => {
      let s = statusReducer(state, startTool({ id: 't1', toolName: 'bash' }))
      s = statusReducer(s, finishTool({ id: 't1', isError: false }))
      s = statusReducer(s, clearTools())

      expect(s.toolHistory).toHaveLength(0)
      expect(s.currentTool).toBeNull()
      expect(s.totalToolCalls).toBe(0)
      expect(s.totalErrors).toBe(0)
    })
  })

  describe('sub-agents', () => {
    it('should register a sub-agent', () => {
      const newState = statusReducer(state, registerSubAgent({
        id: 'agent-1',
        name: 'FileAnalyzer',
        status: 'running',
        task: 'Analyze src files'
      }))
      expect(newState.subAgents).toHaveLength(1)
      expect(newState.subAgents[0].name).toBe('FileAnalyzer')
    })

    it('should update sub-agent status', () => {
      let s = statusReducer(state, registerSubAgent({
        id: 'agent-1',
        name: 'FileAnalyzer',
        status: 'running'
      }))
      s = statusReducer(s, updateSubAgent({
        id: 'agent-1',
        status: 'success',
        endTime: Date.now()
      }))
      expect(s.subAgents[0].status).toBe('success')
      expect(s.subAgents[0].endTime).toBeGreaterThan(0)
    })

    it('should remove a sub-agent', () => {
      let s = statusReducer(state, registerSubAgent({
        id: 'agent-1',
        name: 'FileAnalyzer',
        status: 'running'
      }))
      s = statusReducer(s, removeSubAgent('agent-1'))
      expect(s.subAgents).toHaveLength(0)
    })

    it('should ignore update for non-existent sub-agent', () => {
      const newState = statusReducer(state, updateSubAgent({
        id: 'nonexistent',
        status: 'success'
      }))
      expect(newState.subAgents).toHaveLength(0)
    })
  })

  describe('resetStatus', () => {
    it('should reset all state to initial', () => {
      let s = statusReducer(state, setAgentStatus('working'))
      s = statusReducer(s, startTool({ id: 't1', toolName: 'bash' }))
      s = statusReducer(s, finishTool({ id: 't1', isError: true }))
      s = statusReducer(s, resetStatus())

      expect(s.agentStatus).toBe('idle')
      expect(s.currentTool).toBeNull()
      expect(s.toolHistory).toHaveLength(0)
      expect(s.subAgents).toHaveLength(0)
      expect(s.totalToolCalls).toBe(0)
      expect(s.totalErrors).toBe(0)
      expect(s.sessionStartTime).toBeNull()
    })
  })
})
