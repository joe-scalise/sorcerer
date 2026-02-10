import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useSessionStore } from '../stores/useSessionStore'
import { useAgentStore } from '../stores/useAgentStore'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  sessionId: string
  isFocused?: boolean
}

// Cache terminal instances so they survive React re-renders
const terminalCache = new Map<string, { terminal: Terminal; fitAddon: FitAddon; attached: boolean; _ipcCleanup?: () => void }>()

// Module-level font size — loaded once from settings, kept in sync via custom event
let terminalFontSize = 13
window.sorcerer.settings.get('terminalFontSize').then((v: string | undefined) => {
  const size = v ? Number(v) : 13
  if (!size || size === terminalFontSize) return
  terminalFontSize = size
  for (const [sid, cached] of terminalCache) {
    cached.terminal.options.fontSize = size
    try {
      cached.fitAddon.fit()
      window.sorcerer.terminal.resize(sid, cached.terminal.cols, cached.terminal.rows)
    } catch { /* ignore fit errors */ }
  }
})

window.addEventListener('sorcerer:fontSizeChange', (e: Event) => {
  const size = (e as CustomEvent).detail as number
  if (!size) return
  terminalFontSize = size
  for (const [sid, cached] of terminalCache) {
    cached.terminal.options.fontSize = size
    try {
      cached.fitAddon.fit()
      window.sorcerer.terminal.resize(sid, cached.terminal.cols, cached.terminal.rows)
    } catch { /* ignore fit errors */ }
  }
})

export function TerminalView({ sessionId, isFocused }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [exited, setExited] = useState(false)
  const restartSession = useSessionStore((s) => s.restartSession)
  const restartAgent = useAgentStore((s) => s.restartAgent)

  const handleRestart = async () => {
    setExited(false)
    const cached = terminalCache.get(sessionId)
    if (cached) {
      cached.terminal.clear()
    }
    // Determine if this is a session or an agent
    const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
    if (session) {
      await restartSession(sessionId)
    } else {
      await restartAgent(sessionId)
    }
  }

  const attach = useCallback(() => {
    if (!containerRef.current) return

    let cached = terminalCache.get(sessionId)
    if (!cached) {
      // Read the agent-driven terminal background from CSS custom property
      const terminalBg = getComputedStyle(document.documentElement)
        .getPropertyValue('--terminal-bg').trim() || '#111114'

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: terminalFontSize,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        theme: {
          background: terminalBg,
          foreground: '#e8e6e3',
          cursor: '#e2a445',
          cursorAccent: terminalBg,
          selectionBackground: '#e2a44533',
          selectionForeground: undefined,
          black: terminalBg,
          red: '#e25555',
          green: '#5ec269',
          yellow: '#e2a445',
          blue: '#5ba4e6',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e8e6e3',
          brightBlack: '#6b6a68',
          brightRed: '#f87171',
          brightGreen: '#86efac',
          brightYellow: '#fde68a',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff'
        },
        allowTransparency: false,
        scrollback: 10000,
        lineHeight: 1.2
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)

      cached = { terminal, fitAddon, attached: false }
      terminalCache.set(sessionId, cached)

      // Intercept Ctrl+I before xterm processes it (Ctrl+I = Tab in terminal)
      terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'i' && e.type === 'keydown') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('sorcerer:dictation', { detail: sessionId }))
          return false
        }
        return true
      })

      // Copy selection to clipboard on select
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
        }
      })

      // Forward keyboard input to PTY
      terminal.onData((data) => {
        window.sorcerer.terminal.write(sessionId, data)
      })

      // Listen for PTY output
      const unsubData = window.sorcerer.terminal.onData(sessionId, (data: string) => {
        terminal.write(data)
      })

      const unsubExit = window.sorcerer.terminal.onExit(sessionId, (exitCode: number) => {
        terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`)
        setExited(true)
        // Update whichever store owns this ID
        const sess = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
        if (sess) {
          useSessionStore.getState().updateSessionInStore(sessionId, { status: 'idle', pid: null })
        } else {
          useAgentStore.getState().updateAgentInStore(sessionId, { status: 'idle', pid: null })
        }
      })

      cached._ipcCleanup = () => {
        unsubData()
        unsubExit()
      }
    }

    const { terminal, fitAddon } = cached

    if (!cached.attached) {
      containerRef.current.innerHTML = ''
      terminal.open(containerRef.current)
      cached.attached = true
    } else {
      const xtermElement = terminal.element
      if (xtermElement && xtermElement.parentElement !== containerRef.current) {
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(xtermElement)
      }
    }

    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
        window.sorcerer.terminal.resize(sessionId, terminal.cols, terminal.rows)
      } catch {
        // Ignore fit errors during transitions
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.sorcerer.terminal.resize(sessionId, terminal.cols, terminal.rows)
      } catch {
        // Ignore
      }
    })
    resizeObserver.observe(containerRef.current)

    cleanupRef.current = () => {
      resizeObserver.disconnect()
    }
  }, [sessionId])

  useEffect(() => {
    attach()
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }
  }, [attach])

  // Focus the terminal when it becomes the focused pane
  useEffect(() => {
    if (!isFocused) return
    const cached = terminalCache.get(sessionId)
    if (cached) {
      requestAnimationFrame(() => {
        cached.terminal.focus()
      })
    }
  }, [sessionId, isFocused])

  // Dictation input overlay — scoped to this panel
  const [dictationOpen, setDictationOpen] = useState(false)
  const [dictationValue, setDictationValue] = useState('')
  const dictationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === sessionId) {
        setDictationOpen(true)
        setDictationValue('')
      }
    }
    window.addEventListener('sorcerer:dictation', handler)
    return () => window.removeEventListener('sorcerer:dictation', handler)
  }, [sessionId])

  useEffect(() => {
    if (dictationOpen && dictationRef.current) {
      dictationRef.current.focus()
    }
  }, [dictationOpen])

  const closeDictation = () => {
    setDictationOpen(false)
    setDictationValue('')
    const cached = terminalCache.get(sessionId)
    if (cached) cached.terminal.focus()
  }

  const sendDictation = () => {
    const text = dictationValue.trim()
    if (!text) return
    window.sorcerer.terminal.write(sessionId, text + '\r')
    closeDictation()
  }

  return (
    <div className="terminal-container">
      <div ref={containerRef} className="terminal-xterm" />
      {dictationOpen && (
        <div className="dictation-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDictation() }}>
          <div className="dictation-box">
            <input
              ref={dictationRef}
              className="dictation-input"
              type="text"
              value={dictationValue}
              onChange={(e) => setDictationValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); sendDictation() }
                else if (e.key === 'Escape') closeDictation()
              }}
              placeholder="Type or dictate, then press Enter..."
              spellCheck={false}
              autoComplete="off"
            />
            <div className="dictation-hint">
              <kbd>Enter</kbd> send <kbd>Esc</kbd> cancel
            </div>
          </div>
        </div>
      )}
      {exited && (
        <div className="terminal-restart-overlay">
          <button className="terminal-restart-btn" onClick={handleRestart}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
              <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z" />
            </svg>
            Restart Session
          </button>
        </div>
      )}
    </div>
  )
}

export function disposeTerminal(sessionId: string) {
  const cached = terminalCache.get(sessionId)
  if (cached) {
    if (cached._ipcCleanup) cached._ipcCleanup()
    cached.terminal.dispose()
    terminalCache.delete(sessionId)
  }
}
