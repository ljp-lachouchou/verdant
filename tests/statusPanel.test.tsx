import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import statusReducer from '../src/renderer/store/statusSlice'
import StatusPanel from '../src/renderer/components/StatusPanel'
import CodingPet from '../src/renderer/components/CodingPet'

function renderComponent(component: React.ReactElement, preloadedState?: any) {
  const defaultStatus = {
    agentStatus: 'idle',
    currentTool: null,
    toolHistory: [],
    subAgents: [],
    planSteps: [],
    totalToolCalls: 0,
    totalErrors: 0,
    sessionStartTime: null
  }
  const store = configureStore({
    reducer: { status: statusReducer, settings: () => ({ theme: 'dark', sidebarCollapsed: false, showSettings: false, config: null }) },
    preloadedState: preloadedState || { status: defaultStatus }
  })
  return render(<Provider store={store}>{component}</Provider>)
}

describe('StatusPanel', () => {
  it('should render ready state when no sub-agents', () => {
    renderComponent(<StatusPanel />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('should render sub-agents when present', () => {
    renderComponent(<StatusPanel />, {
      status: {
        agentStatus: 'working',
        currentTool: null,
        toolHistory: [],
        subAgents: [{
          id: 'agent-1',
          name: 'FileAnalyzer',
          status: 'running',
          task: 'Analyzing files'
        }],
        planSteps: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: Date.now()
      }
    })
    expect(screen.getByText('FileAnalyzer')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })
})

describe('CodingPet', () => {
  it('should render idle pet', () => {
    renderComponent(<CodingPet />)
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  it('should show thinking mood', () => {
    renderComponent(<CodingPet />, {
      status: {
        agentStatus: 'thinking',
        currentTool: null,
        toolHistory: [],
        subAgents: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: null
      }
    })
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('should show working mood', () => {
    renderComponent(<CodingPet />, {
      status: {
        agentStatus: 'working',
        currentTool: null,
        toolHistory: [],
        subAgents: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: null
      }
    })
    expect(screen.getByText('Working!')).toBeInTheDocument()
  })

  it('should show happy mood on complete', () => {
    renderComponent(<CodingPet />, {
      status: {
        agentStatus: 'complete',
        currentTool: null,
        toolHistory: [],
        subAgents: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: null
      }
    })
    expect(screen.getByText('Done!')).toBeInTheDocument()
  })

  it('should show sad mood on error', () => {
    renderComponent(<CodingPet />, {
      status: {
        agentStatus: 'error',
        currentTool: null,
        toolHistory: [],
        subAgents: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: null
      }
    })
    expect(screen.getByText('Oops...')).toBeInTheDocument()
  })

  it('should show sleeping mood when waiting', () => {
    renderComponent(<CodingPet />, {
      status: {
        agentStatus: 'waiting',
        currentTool: null,
        toolHistory: [],
        subAgents: [],
        totalToolCalls: 0,
        totalErrors: 0,
        sessionStartTime: null
      }
    })
    expect(screen.getByText('Zzz')).toBeInTheDocument()
  })
})
