import { contextBridge, ipcRenderer } from 'electron'
import type { AgentConfig, Message, Session, AgentStreamEvent } from '@shared/types'

const api = {
  sendAgentMessage: (input: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('agent:send', input),

  stopAgent: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('agent:stop'),

  steerAgent: (message: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('agent:steer', message),

  listSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('session:list'),

  createSession: (name?: string): Promise<Session> =>
    ipcRenderer.invoke('session:create', name),

  deleteSession: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('session:delete', id),

  loadSession: (id: string): Promise<{ session: Session | null; messages: Message[] }> =>
    ipcRenderer.invoke('session:load', id),

  getConfig: (): Promise<AgentConfig> =>
    ipcRenderer.invoke('config:get'),

  setConfig: (config: Partial<AgentConfig>): Promise<AgentConfig> =>
    ipcRenderer.invoke('config:set', config),

  onAgentStream: (callback: (event: AgentStreamEvent) => void) => {
    const handler = (_event: unknown, data: AgentStreamEvent) => callback(data)
    ipcRenderer.on('agent:stream', handler)
    return () => ipcRenderer.removeListener('agent:stream', handler)
  },

  onSessionCreated: (callback: (session: Session) => void) => {
    const handler = (_event: unknown, data: Session) => callback(data)
    ipcRenderer.on('session:created', handler)
    return () => ipcRenderer.removeListener('session:created', handler)
  },

  getTitleBarHeight: (): number => {
    try {
      const wco = (navigator as unknown as { windowControlsOverlay?: { getTitlebarRect: () => { height: number } } }).windowControlsOverlay
      if (wco) {
        return wco.getTitlebarRect().height
      }
    } catch {
      // not available
    }
    return 0
  },

  onTitleBarHeightChange: (callback: (height: number) => void) => {
    try {
      const wco = (navigator as unknown as { windowControlsOverlay?: {
        addEventListener: (type: string, cb: () => void) => void
        removeEventListener: (type: string, cb: () => void) => void
        getTitlebarRect: () => { height: number }
      } }).windowControlsOverlay
      if (wco) {
        const handler = () => {
          callback(wco.getTitlebarRect().height)
        }
        wco.addEventListener('geometrychange', handler)
        return () => wco.removeEventListener('geometrychange', handler)
      }
    } catch {
      // not available
    }
    return () => {}
  },

  browserContinue: (): Promise<void> =>
    ipcRenderer.invoke('browser:continue', { action: 'continue' })
}

export type AgentAPI = typeof api

contextBridge.exposeInMainWorld('agentAPI', api)
