import { TerminalIcon, CheckIcon, ErrorIcon, ClockIcon } from './Icons'

interface ToolCallCardProps {
  name: string
  output?: string
  isError?: boolean
}

export default function ToolCallCard({ name, output, isError }: ToolCallCardProps) {
  const isRunning = output === undefined

  return (
    <div className={`tool-call-inline ${isError ? 'tool-call-error' : ''} ${isRunning ? 'tool-call-running' : ''}`}>
      <div className="tool-call-header">
        <span className={`tool-call-icon ${isError ? 'error' : isRunning ? 'running' : 'success'}`}>
          {isError ? <ErrorIcon size={13} /> : isRunning ? <ClockIcon size={13} /> : <CheckIcon size={13} />}
        </span>
        <TerminalIcon size={13} />
        <span className="tool-call-name">{name}</span>
        <span className="tool-call-status">
          {isRunning ? 'running' : isError ? 'failed' : 'done'}
        </span>
      </div>
      {output && (
        <pre className="tool-call-output">
          <code>{output.length > 2000 ? output.substring(0, 2000) + '\n... [truncated]' : output}</code>
        </pre>
      )}
    </div>
  )
}
