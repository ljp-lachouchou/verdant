import { useState, useRef, type KeyboardEvent } from 'react'
import { useAppDispatch } from '../store/hooks'
import { sendAgentMessage, stopAgent } from '../store/chatSlice'
import { SendIcon, StopIcon } from './Icons'

interface ChatInputProps {
  disabled?: boolean
}

export default function ChatInput({ disabled }: ChatInputProps) {
  const [input, setInput] = useState('')
  const dispatch = useAppDispatch()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    dispatch(sendAgentMessage(trimmed))
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }

  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={disabled ? 'Agent is working...' : 'Send a message...  (Enter to send, Shift+Enter for new line)'}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
        />
        {disabled ? (
          <button className="send-btn stop-btn" onClick={() => dispatch(stopAgent())} aria-label="Stop">
            <StopIcon size={14} />
          </button>
        ) : (
          <button className="send-btn" onClick={handleSubmit} disabled={!input.trim()} aria-label="Send">
            <SendIcon size={16} />
          </button>
        )}
      </div>
      <div className="chat-input-hint">
        Agent can read/write files, run commands, and delegate to sub-agents for parallel work.
      </div>
    </div>
  )
}
