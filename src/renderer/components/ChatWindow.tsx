import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import MessageBubble from './MessageBubble'
import type { ContentBlock } from '@shared/types'
import { setShowSettings } from '../store/settingsSlice'
import { continueAfterWait } from '../store/chatSlice'
import { LogoIcon, SettingsIcon, ErrorIcon, AgentIcon, TerminalIcon, CheckIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'

function StreamingBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'skill') {
    return <StreamingSkillBlock block={block} />
  }
  if (block.type === 'text') {
    if (!block.text) return null
    return (
      <div className="message-content">{block.text}</div>
    )
  }

  if (block.type === 'image') {
    if (!block.imagePath) return null
    const src = block.imagePath.startsWith('data:') || block.imagePath.startsWith('http')
      ? block.imagePath
      : `file://${block.imagePath}`
    return <img className="md-image" src={src} alt={block.imageAlt || 'Image'} />
  }

  const isRunning = block.status === 'running'
  const isError = block.status === 'error'

  return (
    <div className={`inline-tool-card ${isError ? 'error' : ''} ${isRunning ? 'running' : ''}`}>
      <div className="inline-tool-header">
        <span className={`tool-call-icon ${isError ? 'error' : isRunning ? 'running' : 'success'}`}>
          {isError ? <ErrorIcon size={12} /> : isRunning ? <ClockIcon size={12} /> : <CheckIcon size={12} />}
        </span>
        <TerminalIcon size={12} />
        <span className="inline-tool-name">{block.toolName}</span>
        {block.command && <span className="inline-tool-cmd">{block.command.substring(0, 60)}</span>}
        <span className="inline-tool-status">{isRunning ? 'running' : isError ? 'failed' : 'done'}</span>
      </div>
      {block.command && (
        <div className="inline-tool-command">
          <code>$ {block.command}</code>
        </div>
      )}
      {block.output && (
        <pre className="inline-tool-output">
          <code>{block.output.length > 800 ? block.output.substring(0, 800) + '\n...' : block.output}</code>
        </pre>
      )}
    </div>
  )
}

function StreamingSkillBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="skill-block">
      <div className="skill-block-header" onClick={() => setExpanded(!expanded)}>
        <span className="skill-block-icon">⚡</span>
        <span className="skill-block-name">{block.skillName || 'Skill'}</span>
        <span className="skill-block-label">SKILL</span>
        <span className="skill-block-expand">
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
      </div>
      {expanded && block.skillDescription && (
        <div className="skill-block-description">{block.skillDescription}</div>
      )}
    </div>
  )
}

export default function ChatWindow() {
  const dispatch = useAppDispatch()
  const messages = useAppSelector((s) => s.chat.messages)
  const streamingBlocks = useAppSelector((s) => s.chat.streamingBlocks)
  const streamingSessionId = useAppSelector((s) => s.chat.streamingSessionId)
  const activeSessionId = useAppSelector((s) => s.chat.activeSessionId)
  const error = useAppSelector((s) => s.chat.error)
  const isLoading = useAppSelector((s) => s.chat.isLoading)
  const needsConfig = useAppSelector((s) => s.chat.needsConfig)
  const waitUser = useAppSelector((s) => s.chat.waitUser)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingBlocks, error, needsConfig])

  const visibleMessages = messages.filter(msg => msg.role !== 'system' || msg.isSummary)
  const isStreamingThisSession = streamingSessionId === activeSessionId && streamingBlocks.length > 0
  const isLoadingThisSession = isLoading && streamingSessionId === activeSessionId
  const hasContent = visibleMessages.length > 0 || isStreamingThisSession || isLoadingThisSession

  // Check if any tool is still running
  const hasRunningTool = streamingBlocks.some(b => b.type === 'tool_call' && b.status === 'running')

  return (
    <div className="chat-window" role="log" aria-live="polite">
      {!hasContent && (
        <div className="welcome-screen">
          <div className="welcome-logo">
            <LogoIcon size={32} />
          </div>
          <h2>Verdant</h2>
          <p>Your AI coding assistant. Ask me to write code, run commands, or analyze files.</p>
          <div className="welcome-examples">
            <div className="example-card">"Create a hello world React component"</div>
            <div className="example-card">"Run ls -la in the current directory"</div>
            <div className="example-card">"Read package.json and explain the dependencies"</div>
          </div>
        </div>
      )}

      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {needsConfig && (
        <div className="config-action-row">
          <button className="btn-primary config-btn" onClick={() => dispatch(setShowSettings(true))}>
            <SettingsIcon size={14} />
            Open Settings
          </button>
        </div>
      )}

      {/* Streaming blocks — only show for the active streaming session */}
      {isStreamingThisSession && (
        <div className="message message-assistant">
          <div className="message-avatar">
            <AgentIcon size={16} />
          </div>
          <div className="message-body">
            <div className="message-role">Agent</div>
            {streamingBlocks.map((block, i) => (
              <StreamingBlock key={i} block={block} />
            ))}
            {/* Output indicator at the bottom */}
            <div className="streaming-indicator">
              <span className="streaming-indicator-dots">
                <span></span><span></span><span></span>
              </span>
              <span className="streaming-indicator-text">
                {hasRunningTool ? 'Working...' : 'Generating...'}
              </span>
            </div>
          </div>
        </div>
      )}

      {waitUser && (
        <div className="wait-user-banner">
          <div className="wait-user-message">{waitUser.message}</div>
          {waitUser.screenshot && (
            <img className="wait-user-screenshot" src={waitUser.screenshot} alt="Browser screenshot" />
          )}
          <button className="btn-primary wait-user-btn" onClick={() => dispatch(continueAfterWait())}>
            Continue
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><ErrorIcon size={16} /></span>
          <span>{error}</span>
        </div>
      )}

      {isLoadingThisSession && !isStreamingThisSession && (
        <div className="loading-indicator">
          <div className="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
