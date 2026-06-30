import { useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { createSession, deleteSession, setActiveSession } from '../store/chatSlice'
import { toggleSidebar, toggleTheme, setShowSettings } from '../store/settingsSlice'
import { MenuIcon, PlusIcon, SettingsIcon, SunIcon, MoonIcon, TrashIcon } from './Icons'
import SkillsModal from './SkillsModal'

export default function Sidebar() {
  const dispatch = useAppDispatch()
  const sessions = useAppSelector((s) => s.chat.sessions)
  const activeSessionId = useAppSelector((s) => s.chat.activeSessionId)
  const sessionStreams = useAppSelector((s) => s.chat.sessionStreams)
  const collapsed = useAppSelector((s) => s.settings.sidebarCollapsed)
  const theme = useAppSelector((s) => s.settings.theme)
  const [showSkills, setShowSkills] = useState(false)

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button className="icon-btn" onClick={() => dispatch(toggleSidebar())} aria-label="Expand sidebar">
          <MenuIcon size={18} />
        </button>
        <button className="icon-btn" onClick={() => dispatch(setShowSettings(true))} aria-label="Settings" style={{ marginTop: '6px' }}>
          <SettingsIcon size={18} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <img src="/icon.png" alt="Verdant" style={{ width: '20px', height: '20px', borderRadius: '5px' }} />
          <span>Verdant</span>
        </div>
        <button className="icon-btn" onClick={() => dispatch(toggleSidebar())} aria-label="Collapse sidebar">
          <MenuIcon size={18} />
        </button>
      </div>

      <button className="new-session-btn" onClick={() => dispatch(createSession())}>
        <PlusIcon size={14} />
        New Chat
      </button>

      <div className="session-list" role="list">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item ${activeSessionId === session.id ? 'active' : ''}`}
            role="listitem"
            onClick={() => {
              if (activeSessionId !== session.id) {
                dispatch(setActiveSession(session.id))
              }
            }}
          >
            <span className="session-name">{session.name}</span>
            {sessionStreams[session.id]?.isLoading && (
              <span className="session-loading-dot" style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--accent)', flexShrink: 0,
                animation: 'pulse 1.5s ease-in-out infinite'
              }} />
            )}
            <button
              className="session-delete"
              onClick={(e) => {
                e.stopPropagation()
                dispatch(deleteSession(session.id))
              }}
              aria-label="Delete session"
            >
              <TrashIcon size={13} />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="empty-state">No conversations yet.<br />Click "New Chat" to start.</p>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="footer-btn" onClick={() => setShowSkills(true)}>
          <span style={{ fontSize: '12px' }}>⚡</span>
          Skills
        </button>
        <button className="footer-btn" onClick={() => dispatch(toggleTheme())}>
          {theme === 'dark' ? <MoonIcon size={14} /> : <SunIcon size={14} />}
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
        <button className="footer-btn" onClick={() => dispatch(setShowSettings(true))}>
          <SettingsIcon size={14} />
          Settings
        </button>
      </div>

      <SkillsModal open={showSkills} onClose={() => setShowSkills(false)} />
    </aside>
  )
}
