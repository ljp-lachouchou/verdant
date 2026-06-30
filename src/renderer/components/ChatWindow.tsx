import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import MessageBubble from './MessageBubble'
import { ContextMenu } from './ContextMenu'
import type { ContentBlock } from '@shared/types'
import { setShowSettings } from '../store/settingsSlice'
import { continueAfterWait } from '../store/chatSlice'
import { SettingsIcon, ErrorIcon, AgentIcon, TerminalIcon, CheckIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'

function StreamingBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'skill') {
    return <StreamingSkillBlock block={block} />
  }
  if (block.type === 'subagent') {
    return <StreamingSubAgentBlock block={block} />
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
  const [showPrompt, setShowPrompt] = useState(false)
  const hasPrompt = !!block.promptInput

  return (
    <div className={`inline-tool-card ${isError ? 'error' : ''} ${isRunning ? 'running' : ''}`}>
      <div className="inline-tool-header">
        <span className={`tool-call-icon ${isError ? 'error' : isRunning ? 'running' : 'success'}`}>
          {isError ? <ErrorIcon size={12} /> : isRunning ? <ClockIcon size={12} /> : <CheckIcon size={12} />}
        </span>
        <TerminalIcon size={12} />
        <span className="inline-tool-name">{block.toolName}</span>
        {block.command && <span className="inline-tool-cmd">{block.command.substring(0, 60)}</span>}
        {hasPrompt && (
          <button
            className="inline-tool-prompt-toggle"
            onClick={() => setShowPrompt(!showPrompt)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '11px', padding: '0 4px' }}
          >
            {showPrompt ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />} prompt
          </button>
        )}
        <span className="inline-tool-status">{isRunning ? 'running' : isError ? 'failed' : 'done'}</span>
      </div>
      {hasPrompt && showPrompt && (
        <div className="inline-tool-prompt" style={{ padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: '4px', margin: '4px 0', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Prompt Input</div>
          <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)', maxHeight: '300px', overflow: 'auto' }}>
            <code>{block.promptInput}</code>
          </pre>
        </div>
      )}
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

function StreamingSubAgentBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false)
  const status = block.subAgentStatus || 'running'

  return (
    <div className={`subagent-block ${status}`}>
      <div className="subagent-block-header" onClick={() => setExpanded(!expanded)}>
        <span className={`subagent-block-dot ${status}`} />
        <span className="subagent-block-icon">🤖</span>
        <span className="subagent-block-name">{block.subAgentName || 'Sub-Agent'}</span>
        <span className="subagent-block-label">SUB-AGENT</span>
        <span className={`subagent-block-status ${status}`}>{status}</span>
        <span className="subagent-block-expand">
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
      </div>
      {expanded && block.subAgentResult && (
        <div className="subagent-block-result">
          <pre className="subagent-block-output"><code>{block.subAgentResult}</code></pre>
        </div>
      )}
      {expanded && !block.subAgentResult && status === 'running' && (
        <div className="subagent-block-result">
          <div className="streaming-indicator">
            <span className="streaming-indicator-dots">
              <span></span><span></span><span></span>
            </span>
            <span className="streaming-indicator-text">Working...</span>
          </div>
        </div>
      )}
    </div>
  )
}

function WaitUserBanner({ message, screenshot, options, onRespond }: {
  message: string
  screenshot: string
  options?: Array<{ label: string; value: string }>
  onRespond: (response?: string) => void
}) {
  const [customInput, setCustomInput] = useState('')

  const hasOptions = options && options.length > 0

  return (
    <div className="wait-user-banner">
      <div className="wait-user-message">{message}</div>
      {screenshot && (
        <img className="wait-user-screenshot" src={screenshot} alt="Browser screenshot" />
      )}
      {hasOptions && (
        <div className="wait-user-options">
          {options!.map((opt, i) => (
            <button
              key={i}
              className="wait-user-option-btn"
              onClick={() => onRespond(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div className="wait-user-custom-input">
        <input
          type="text"
          className="form-input"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="Type your response..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customInput.trim()) {
              onRespond(customInput.trim())
            }
          }}
          autoFocus
        />
        <button
          className="btn-primary"
          onClick={() => onRespond(customInput.trim() || undefined)}
          disabled={!customInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

export default function ChatWindow() {
  const dispatch = useAppDispatch()
  const messages = useAppSelector((s) => s.chat.messages)
  const activeSessionId = useAppSelector((s) => s.chat.activeSessionId)
  const needsConfig = useAppSelector((s) => s.chat.needsConfig)
  const endRef = useRef<HTMLDivElement>(null)

  const sessionStream = useAppSelector((s) => {
    if (!activeSessionId) return null
    return s.chat.sessionStreams[activeSessionId] || null
  })

  const streamingBlocks = sessionStream?.streamingBlocks || []
  const isLoading = sessionStream?.isLoading || false
  const error = sessionStream?.error || null
  const waitUser = sessionStream?.waitUser || null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingBlocks, error, needsConfig])

  const visibleMessages = messages.filter(msg => msg.role !== 'system' || msg.isSummary)
  const isStreamingThisSession = streamingBlocks.length > 0
  const isLoadingThisSession = isLoading
  const hasContent = visibleMessages.length > 0 || isStreamingThisSession || isLoadingThisSession

  const hasRunningTool = streamingBlocks.some(b => b.type === 'tool_call' && b.status === 'running')

  return (
    <div className="chat-window" role="log" aria-live="polite">
      {!hasContent && (
        <div className="welcome-screen">
          <div className="welcome-logo">
            <img src="/icon.png" alt="Verdant" style={{ width: '48px', height: '48px', borderRadius: '12px' }} />
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
        <WaitUserBanner
          message={waitUser.message}
          screenshot={waitUser.screenshot}
          options={waitUser.options}
          onRespond={(response) => dispatch(continueAfterWait(response))}
        />
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
      <ContextMenu />
    </div>
  )
}
