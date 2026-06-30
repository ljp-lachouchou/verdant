import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'
import ChatInput from './components/ChatInput'
import StatusPanel from './components/StatusPanel'
import CodingPet from './components/CodingPet'
import SettingsModal from './components/SettingsModal'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { initSessions, loadSessionMessages } from './store/chatSlice'
import { loadConfig, setShowSettings } from './store/settingsSlice'

export default function App() {
  const dispatch = useAppDispatch()
  const activeSessionId = useAppSelector((s) => s.chat.activeSessionId)
  const theme = useAppSelector((s) => s.settings.theme)
  const showSettings = useAppSelector((s) => s.settings.showSettings)
  const isLoading = useAppSelector((s) => {
    return Object.values(s.chat.sessionStreams).some(stream => stream.isLoading)
  })

  useEffect(() => {
    dispatch(initSessions())
    dispatch(loadConfig())
  }, [dispatch])

  useEffect(() => {
    if (activeSessionId) {
      dispatch(loadSessionMessages(activeSessionId))
    }
  }, [activeSessionId, dispatch])

  useEffect(() => {
    document.documentElement.className = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const api = (window as unknown as { agentAPI: {
      getTitleBarHeight: () => number
      onTitleBarHeightChange: (cb: (h: number) => void) => () => void
    } }).agentAPI
    if (!api?.getTitleBarHeight) return

    const apply = (h: number) => {
      if (h > 0) {
        document.documentElement.style.setProperty('--titlebar-height', `${h}px`)
      }
    }

    apply(api.getTitleBarHeight())
    const unsub = api.onTitleBarHeightChange(apply)
    return unsub
  }, [])

  return (
    <div className="app-container">
      <Sidebar />
      <main className="chat-main">
        <ChatWindow />
        <ChatInput disabled={isLoading} />
      </main>
      <aside className="status-sidebar">
        <CodingPet />
        <StatusPanel />
      </aside>
      <SettingsModal open={showSettings} onClose={() => dispatch(setShowSettings(false))} />
    </div>
  )
}
