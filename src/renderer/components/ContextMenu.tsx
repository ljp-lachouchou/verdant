import { useState, useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: string
  onClick: () => void
  disabled?: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

let contextMenuState: ContextMenuState | null = null
let setContextMenuFn: ((state: ContextMenuState | null) => void) | null = null

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  contextMenuState = { x, y, items }
  setContextMenuFn?.(contextMenuState)
}

export function hideContextMenu(): void {
  contextMenuState = null
  setContextMenuFn?.(null)
}

export function ContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContextMenuFn = setState
    return () => { setContextMenuFn = null }
  }, [])

  useEffect(() => {
    if (!state) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        hideContextMenu()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [state])

  if (!state) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 10000,
        minWidth: '160px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        padding: '4px',
        backdropFilter: 'blur(8px)'
      }}
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          className="context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) {
              hideContextMenu()
              item.onClick()
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '6px 12px',
            background: 'none',
            border: 'none',
            color: item.disabled ? 'var(--text-dim)' : 'var(--text)',
            fontSize: '13px',
            cursor: item.disabled ? 'default' : 'pointer',
            borderRadius: '4px',
            textAlign: 'left',
            transition: 'background 0.1s'
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = 'var(--bg-tertiary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none'
          }}
        >
          {item.icon && <span style={{ fontSize: '14px', width: '16px', textAlign: 'center' }}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
