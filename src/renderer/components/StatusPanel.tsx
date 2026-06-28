import { useState } from 'react'
import { useAppSelector } from '../store/hooks'
import type { SubAgentInfo } from '../store/statusSlice'
import { CloseIcon } from './Icons'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function AgentDetailPopup({ agent, onClose }: { agent: SubAgentInfo; onClose: () => void }) {
  return (
    <div className="agent-popup-overlay" onClick={onClose}>
      <div className="agent-popup" onClick={(e) => e.stopPropagation()}>
        <div className="agent-popup-header">
          <span className={`agent-popup-dot ${agent.status}`} />
          <span className="agent-popup-title">{agent.name}</span>
          <button className="agent-popup-close" onClick={onClose}><CloseIcon size={16} /></button>
        </div>
        <div className="agent-popup-body">
          <div className="agent-popup-field">
            <div className="agent-popup-label">Status</div>
            <div className={`agent-popup-value status-${agent.status}`}>{agent.status}</div>
          </div>
          {agent.startTime && (
            <div className="agent-popup-field">
              <div className="agent-popup-label">Duration</div>
              <div className="agent-popup-value">
                {agent.endTime ? formatDuration(agent.endTime - agent.startTime) : 'running...'}
              </div>
            </div>
          )}
          <div className="agent-popup-field">
            <div className="agent-popup-label">Input (Prompt)</div>
            <textarea className="agent-popup-textarea" readOnly value={agent.prompt || agent.task || 'N/A'} />
          </div>
          <div className="agent-popup-field">
            <div className="agent-popup-label">Output (Result)</div>
            <textarea className="agent-popup-textarea" readOnly value={agent.result || (agent.status === 'running' ? 'Still running...' : 'No output')} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StatusPanel() {
  const subAgents = useAppSelector((s) => s.status.subAgents)
  const agentStatus = useAppSelector((s) => s.status.agentStatus)
  const [selectedAgent, setSelectedAgent] = useState<SubAgentInfo | null>(null)

  const running = subAgents.filter(a => a.status === 'running')
  const succeeded = subAgents.filter(a => a.status === 'success')
  const failed = subAgents.filter(a => a.status === 'error')

  return (
    <div className="status-panel-minimal">
      {subAgents.length > 0 && (
        <div className="status-section">
          <div className="status-section-title">
            Agents ({succeeded.length + failed.length}/{subAgents.length})
            {running.length > 0 && <span className="sub-agent-running-count"> · {running.length} running</span>}
          </div>
          <div className="agent-flat-list">
            {subAgents.map((agent) => (
              <div
                key={agent.id}
                className={`agent-flat-item ${agent.status}`}
                onClick={() => setSelectedAgent(agent)}
              >
                <div className="agent-flat-header">
                  <span className={`agent-flat-dot ${agent.status}`} />
                  <span className="agent-flat-name">{agent.name}</span>
                </div>
                {agent.task && <div className="agent-flat-task">{agent.task}</div>}
                <div className="agent-flat-footer">
                  <span className={`agent-flat-status ${agent.status}`}>{agent.status}</span>
                  {agent.startTime && agent.endTime && (
                    <span className="agent-flat-duration">{formatDuration(agent.endTime - agent.startTime)}</span>
                  )}
                  {agent.startTime && !agent.endTime && agent.status === 'running' && (
                    <span className="agent-flat-duration">running...</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subAgents.length === 0 && agentStatus === 'idle' && (
        <div className="status-empty-minimal">
          <p>Ready</p>
        </div>
      )}

      {selectedAgent && (
        <AgentDetailPopup agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  )
}
