import { useEffect, useState } from 'react'
import { useAppSelector } from '../store/hooks'
import type { AgentStatus } from '../store/statusSlice'

type PetMood = 'idle' | 'thinking' | 'working' | 'happy' | 'sad' | 'sleeping'

function statusToMood(status: AgentStatus): PetMood {
  switch (status) {
    case 'thinking': return 'thinking'
    case 'working': return 'working'
    case 'error': return 'sad'
    case 'complete': return 'happy'
    case 'waiting': return 'sleeping'
    default: return 'idle'
  }
}

const moodConfig: Record<PetMood, { eye: string; mouth: string; color: string; label: string }> = {
  idle: { eye: '●', mouth: '─', color: 'var(--text-3)', label: 'Idle' },
  thinking: { eye: '◦', mouth: '◡', color: 'var(--info)', label: 'Thinking...' },
  working: { eye: '▸', mouth: '○', color: 'var(--warning)', label: 'Working!' },
  happy: { eye: 'ˆ', mouth: '◡', color: 'var(--brand)', label: 'Done!' },
  sad: { eye: 'ˇ', mouth: '◠', color: 'var(--error)', label: 'Oops...' },
  sleeping: { eye: '-', mouth: 'ω', color: 'var(--text-3)', label: 'Zzz' }
}

export default function CodingPet() {
  const agentStatus = useAppSelector((s) => s.status.agentStatus)
  const [mood, setMood] = useState<PetMood>('idle')
  const [bounce, setBounce] = useState(false)

  useEffect(() => {
    const newMood = statusToMood(agentStatus)
    setMood(newMood)
    if (newMood === 'working' || newMood === 'happy') {
      setBounce(true)
      const t = setTimeout(() => setBounce(false), 600)
      return () => clearTimeout(t)
    }
  }, [agentStatus])

  const config = moodConfig[mood]

  return (
    <div className={`coding-pet ${bounce ? 'bounce' : ''}`}>
      <div className="pet-avatar" style={{ borderColor: config.color }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="15" fill="var(--bg-2)" stroke={config.color} strokeWidth="1.5" />
          <text x="11" y="17" fontSize="10" fill={config.color} fontFamily="monospace" fontWeight="bold">{config.eye}</text>
          <text x="21" y="17" fontSize="10" fill={config.color} fontFamily="monospace" fontWeight="bold">{config.eye}</text>
          <text x="13" y="26" fontSize="9" fill={config.color} fontFamily="monospace">{config.mouth}</text>
        </svg>
        {mood === 'thinking' && (
          <span className="pet-thinking-dots">
            <span /><span /><span />
          </span>
        )}
        {mood === 'sleeping' && (
          <span className="pet-zzz">z</span>
        )}
      </div>
      <span className="pet-label" style={{ color: config.color }}>{config.label}</span>
    </div>
  )
}
