import { useState, useRef, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react'
import { useAppDispatch } from '../store/hooks'
import { sendAgentMessage, stopAgent } from '../store/chatSlice'
import { SendIcon, StopIcon } from './Icons'

interface ChatInputProps {
  disabled?: boolean
}

interface PendingImage {
  data: string
  mediaType: string
  preview: string
}

export default function ChatInput({ disabled }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const dispatch = useAppDispatch()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fileToBase64 = (file: File): Promise<PendingImage> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        resolve({
          data: base64,
          mediaType: file.type || 'image/png',
          preview: result
        })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const addFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    const newImages = await Promise.all(imageFiles.map(fileToBase64))
    setImages(prev => [...prev, ...newImages])
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files)
      e.target.value = ''
    }
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    const trimmed = input.trim()
    if ((!trimmed && images.length === 0) || disabled) return
    dispatch(sendAgentMessage({
      text: trimmed || 'Please analyze the attached image(s).',
      images: images.length > 0 ? images.map(({ data, mediaType }) => ({ data, mediaType })) : undefined
    }))
    setInput('')
    setImages([])
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div className="chat-input-container">
      {images.length > 0 && (
        <div className="chat-input-images" style={{ display: 'flex', gap: '8px', padding: '8px 12px 0', flexWrap: 'wrap' }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: '60px', height: '60px' }}>
              <img
                src={img.preview}
                alt="preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
              <button
                onClick={() => removeImage(i)}
                style={{
                  position: 'absolute', top: '-4px', right: '-4px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: '11px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, padding: 0
                }}
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="chat-input-wrapper"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <button
          className="image-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{
            background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
            color: 'var(--text-dim)', padding: '4px 8px', fontSize: '18px',
            display: 'flex', alignItems: 'center', opacity: disabled ? 0.5 : 1
          }}
          aria-label="Attach image"
          title="Attach image"
        >
          +
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={disabled ? 'Agent is working...' : 'Send a message...  (Enter to send, Shift+Enter for new line, paste or drop images)'}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
        />
        {disabled ? (
          <button className="send-btn stop-btn" onClick={() => dispatch(stopAgent())} aria-label="Stop">
            <StopIcon size={14} />
          </button>
        ) : (
          <button className="send-btn" onClick={handleSubmit} disabled={!input.trim() && images.length === 0} aria-label="Send">
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
