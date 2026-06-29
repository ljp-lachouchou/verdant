import { useState, useEffect } from 'react'
import { CloseIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'

interface SkillItem {
  name: string
  description: string
  location: string
}

interface SkillsModalProps {
  open: boolean
  onClose: () => void
}

export default function SkillsModal({ open, onClose }: SkillsModalProps) {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLoading(true)
      const api = (window as unknown as { agentAPI: { listSkills: () => Promise<SkillItem[]> } }).agentAPI
      api?.listSkills?.()
        .then((result) => setSkills(result || []))
        .catch(() => setSkills([]))
        .finally(() => setLoading(false))
    }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚡ Skills</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close"><CloseIcon size={18} /></button>
        </div>

        <div className="modal-body">
          {loading && <p className="form-hint">Loading skills...</p>}

          {!loading && skills.length === 0 && (
            <div className="skills-empty">
              <p>No skills available.</p>
              <p className="form-hint">
                Create skills in <code>.verdant/skills/&lt;name&gt;/SKILL.md</code>
              </p>
            </div>
          )}

          {!loading && skills.length > 0 && (
            <div className="skills-list">
              {skills.map((skill) => (
                <div key={skill.name} className="skill-item-modal">
                  <div
                    className="skill-item-modal-header"
                    onClick={() => setExpandedSkill(expandedSkill === skill.name ? null : skill.name)}
                  >
                    <span className="skill-item-modal-icon">⚡</span>
                    <span className="skill-item-modal-name">{skill.name}</span>
                    <span className="skill-item-modal-expand">
                      {expandedSkill === skill.name ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                    </span>
                  </div>
                  {expandedSkill === skill.name && (
                    <div className="skill-item-modal-detail">
                      <div className="skill-item-modal-desc">{skill.description}</div>
                      <div className="skill-item-modal-path">
                        <span className="form-hint">Location: </span>
                        <code>{skill.location}</code>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
