import { useState } from 'react'
import type { Message, ContentBlock } from '@shared/types'
import { UserIcon, AgentIcon, TerminalIcon, CheckIcon, ErrorIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

function renderContent(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatMarkdown(text: string): string {
  let html = renderContent(text)

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="code-block${lang ? ` lang-${lang}` : ''}"><code>${code.trim()}</code></pre>`)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Images: ![alt](path) — supports local file paths
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, path) => {
    const src = path.startsWith('http') ? path : `file://${path}`
    return `<img class="md-image" src="${src}" alt="${alt}" />`
  })

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header, _sep, body) => {
    const headers = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('')
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    return `<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`
  })

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = `<p>${html}</p>`
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<table[\s\S]*?<\/table>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul[\s\S]*?<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p>(<pre[\s\S]*?<\/pre>)<\/p>/g, '$1')
  return html
}

function ToolBlock({ block }: { block: ContentBlock }) {
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

function ImageBlock({ block }: { block: ContentBlock }) {
  if (!block.imagePath) return null
  // imagePath can be a data URL (base64), http URL, or file path
  const src = block.imagePath.startsWith('data:') || block.imagePath.startsWith('http')
    ? block.imagePath
    : `file://${block.imagePath}`
  return (
    <img className="md-image" src={src} alt={block.imageAlt || 'Image'} />
  )
}

function SkillBlock({ block }: { block: ContentBlock }) {
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

function TextBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) return null
  return (
    <>
      <div
        className={`message-content ${isStreaming ? 'streaming' : ''}`}
        dangerouslySetInnerHTML={{ __html: formatMarkdown(text) }}
      />
      {isStreaming && <span className="cursor-blink">▊</span>}
    </>
  )
}

export default function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (message.role === 'system' && message.isSummary) {
    return (
      <div className="message message-summary">
        <div className="summary-badge">Summary</div>
        <div className="message-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }} />
      </div>
    )
  }

  if (message.role === 'system' || message.role === 'tool') return null

  // Render using blocks if available
  if (message.blocks && message.blocks.length > 0) {
    return (
      <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
        <div className="message-avatar">
          {isUser ? <UserIcon size={16} /> : <AgentIcon size={16} />}
        </div>
        <div className="message-body">
          <div className="message-role">{isUser ? 'You' : 'Agent'}</div>
          {message.blocks.map((block, i) => {
            if (block.type === 'text') {
              return <TextBlock key={i} text={block.text || ''} isStreaming={isStreaming && i === message.blocks!.length - 1} />
            }
            if (block.type === 'image') {
              return <ImageBlock key={i} block={block} />
            }
            if (block.type === 'skill') {
              return <SkillBlock key={i} block={block} />
            }
            return <ToolBlock key={i} block={block} />
          })}
        </div>
      </div>
    )
  }

  // Fallback: plain content
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-avatar">
        {isUser ? <UserIcon size={16} /> : <AgentIcon size={16} />}
      </div>
      <div className="message-body">
        <div className="message-role">{isUser ? 'You' : 'Agent'}</div>
        <div
          className="message-content"
          dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
        />
      </div>
    </div>
  )
}
