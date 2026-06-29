import { useState, useEffect } from 'react'
import { useAppDispatch } from '../store/hooks'
import { loadConfig, updateConfig, toggleTheme } from '../store/settingsSlice'
import { useAppSelector } from '../store/hooks'
import { SettingsIcon, CloseIcon, SunIcon, MoonIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'
import type { VibeCodingConfig } from '@shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const PRESETS: Array<{ name: string; cliPath: string; argsTemplate: string; description: string }> = [
  { name: 'Claude Code', cliPath: 'claude', argsTemplate: '--print {prompt}', description: 'Anthropic Claude Code CLI' },
  { name: 'Aider', cliPath: 'aider', argsTemplate: '--message {prompt}', description: 'AI pair programming in terminal' },
  { name: 'Cursor CLI', cliPath: 'cursor', argsTemplate: '{prompt}', description: 'Cursor CLI coding agent' },
  { name: 'Codex CLI', cliPath: 'codex', argsTemplate: '{prompt}', description: 'OpenAI Codex CLI' },
  { name: 'Custom', cliPath: '', argsTemplate: '{prompt}', description: 'Custom CLI tool' },
]

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const dispatch = useAppDispatch()
  const config = useAppSelector((s) => s.settings.config)
  const theme = useAppSelector((s) => s.settings.theme)

  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showVibe, setShowVibe] = useState(false)
  const [vibe, setVibe] = useState<VibeCodingConfig>({
    enabled: false, cliPath: '', argsTemplate: '{prompt}', workingDir: '', timeout: 120000,
    verifyType: 'none', verifyUrl: '', verifyCommand: ''
  })
  const [selectedPreset, setSelectedPreset] = useState('')

  useEffect(() => {
    if (open && !config) dispatch(loadConfig())
  }, [open, config, dispatch])

  useEffect(() => {
    if (config) {
      setApiKey(config.apiKey || '')
      setApiBaseUrl(config.apiBaseUrl || 'https://api.openai.com/v1')
      setModel(config.model || 'gpt-4o')
      if (config.vibeCoding) {
        setVibe(config.vibeCoding)
        const preset = PRESETS.find(p => p.cliPath === config.vibeCoding?.cliPath)
        if (preset) setSelectedPreset(preset.name)
      }
    }
  }, [config])

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    await dispatch(updateConfig({ apiKey, apiBaseUrl, model, vibeCoding: vibe }))
    setSaving(false)
    onClose()
  }

  const applyPreset = (presetName: string) => {
    setSelectedPreset(presetName)
    const preset = PRESETS.find(p => p.name === presetName)
    if (preset) {
      setVibe(prev => ({
        ...prev,
        cliPath: preset.cliPath,
        argsTemplate: preset.argsTemplate
      }))
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><SettingsIcon size={16} /> Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close"><CloseIcon size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input type="password" className="form-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." autoFocus />
            <p className="form-hint">Stored locally. Never sent anywhere except the API provider.</p>
          </div>

          {/* Vibe Coding Section */}
          <button className="advanced-toggle" onClick={() => setShowVibe(!showVibe)}>
            {showVibe ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            Vibe Coding (CLI Tool)
          </button>

          {showVibe && (
            <div className="advanced-section">
              <div className="form-group">
                <label className="form-label">Enable Vibe Coding</label>
                <button
                  className={`form-button ${vibe.enabled ? 'active' : ''}`}
                  onClick={() => setVibe(prev => ({ ...prev, enabled: !prev.enabled }))}
                >
                  {vibe.enabled ? 'ON' : 'OFF'}
                </button>
                <p className="form-hint">When enabled, coding tasks are delegated to an external CLI tool.</p>
              </div>

              {vibe.enabled && (
                <>
                  <div className="form-group">
                    <label className="form-label">Quick Setup (Presets)</label>
                    <div className="preset-list">
                      {PRESETS.map(p => (
                        <button
                          key={p.name}
                          className={`preset-btn ${selectedPreset === p.name ? 'active' : ''}`}
                          onClick={() => applyPreset(p.name)}
                          title={p.description}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">CLI Path / Command</label>
                    <input
                      type="text"
                      className="form-input"
                      value={vibe.cliPath}
                      onChange={(e) => setVibe(prev => ({ ...prev, cliPath: e.target.value }))}
                      placeholder="e.g. claude, aider, codex"
                    />
                    <p className="form-hint">The CLI command to execute. Must be in PATH or use full path.</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Arguments Template</label>
                    <input
                      type="text"
                      className="form-input"
                      value={vibe.argsTemplate}
                      onChange={(e) => setVibe(prev => ({ ...prev, argsTemplate: e.target.value }))}
                      placeholder="{prompt}"
                    />
                    <p className="form-hint">Use {'{prompt}'} as placeholder for the task description. Example: --message {'{prompt}'}</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Working Directory</label>
                    <input
                      type="text"
                      className="form-input"
                      value={vibe.workingDir}
                      onChange={(e) => setVibe(prev => ({ ...prev, workingDir: e.target.value }))}
                      placeholder="Leave empty to use current directory"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Timeout (ms)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={vibe.timeout}
                      onChange={(e) => setVibe(prev => ({ ...prev, timeout: parseInt(e.target.value) || 120000 }))}
                      placeholder="120000"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Verification</label>
                    <select
                      className="form-input"
                      value={vibe.verifyType || 'none'}
                      onChange={(e) => setVibe(prev => ({ ...prev, verifyType: e.target.value as any }))}
                    >
                      <option value="none">None</option>
                      <option value="screenshot">Screenshot (frontend/client)</option>
                      <option value="test">Test (backend)</option>
                      <option value="both">Both screenshot + test</option>
                    </select>
                    <p className="form-hint">Automatically verify results after CLI tool completes.</p>
                  </div>

                  {(vibe.verifyType === 'screenshot' || vibe.verifyType === 'both') && (
                    <div className="form-group">
                      <label className="form-label">Verify URL (for screenshot)</label>
                      <input
                        type="text"
                        className="form-input"
                        value={vibe.verifyUrl || ''}
                        onChange={(e) => setVibe(prev => ({ ...prev, verifyUrl: e.target.value }))}
                        placeholder="http://localhost:3000"
                      />
                      <p className="form-hint">The app URL to screenshot after coding is done.</p>
                    </div>
                  )}

                  {(vibe.verifyType === 'test' || vibe.verifyType === 'both') && (
                    <div className="form-group">
                      <label className="form-label">Test Command</label>
                      <input
                        type="text"
                        className="form-input"
                        value={vibe.verifyCommand || ''}
                        onChange={(e) => setVibe(prev => ({ ...prev, verifyCommand: e.target.value }))}
                        placeholder="npm test"
                      />
                      <p className="form-hint">Command to run tests. e.g. npm test, pytest, go test</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            Advanced
          </button>

          {showAdvanced && (
            <div className="advanced-section">
              <div className="form-group">
                <label className="form-label">Model</label>
                <input type="text" className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
              </div>
              <div className="form-group">
                <label className="form-label">API Base URL</label>
                <input type="text" className="form-input" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="form-group">
                <label className="form-label">Theme</label>
                <button className="form-button" onClick={() => dispatch(toggleTheme())}>
                  {theme === 'dark' ? <MoonIcon size={14} /> : <SunIcon size={14} />}
                  {theme === 'dark' ? 'Dark' : 'Light'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
