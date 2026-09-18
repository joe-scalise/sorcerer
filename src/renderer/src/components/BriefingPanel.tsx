import { useState, useEffect, useCallback } from 'react'
import { renderMarkdown } from '../utils/renderMarkdown'
import { getApi } from '../api/client'
import { RefreshIcon, BotIcon, ClockIcon, TrashIcon } from './icons'


interface BriefingResult {
  text: string
  provider: string
  model: string
  error?: string
}

interface ArchivedBriefing {
  id: string
  content: string
  provider: string
  model: string
  created_at: number
}

function formatTimestamp(epoch: number): string {
  const d = new Date(epoch * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today at ${time}`
  if (isYesterday) return `Yesterday at ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`
}

export function BriefingPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [archive, setArchive] = useState<ArchivedBriefing[]>([])
  const [viewingArchive, setViewingArchive] = useState<ArchivedBriefing | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const loadArchive = useCallback(async () => {
    const list = await getApi().briefing.list(30)
    setArchive(list)
  }, [])

  const generate = useCallback(async () => {
    setViewingArchive(null)
    setLoading(true)
    setError(undefined)
    try {
      const result: BriefingResult = await getApi().briefing.generate()
      setText(result.text)
      setProvider(result.provider)
      setModel(result.model)
      setError(result.error)
      // Reload archive to include the new briefing
      loadArchive()
    } catch (err: any) {
      setError(err.message || 'Failed to generate briefing')
    } finally {
      setLoading(false)
    }
  }, [loadArchive])

  // Generate on open if no briefing yet
  useEffect(() => {
    if (open && !text && !loading && !error) {
      generate()
    }
    if (open) {
      loadArchive()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        if (showArchive) {
          setShowArchive(false)
          setViewingArchive(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose, showArchive])

  if (!open) return null

  const displayText = viewingArchive ? viewingArchive.content : text
  const displayProvider = viewingArchive ? viewingArchive.provider : provider
  const displayError = viewingArchive ? undefined : error
  const isViewingOld = viewingArchive !== null

  const handleDeleteArchive = async (id: string) => {
    await getApi().briefing.delete(id)
    setArchive((prev) => prev.filter((b) => b.id !== id))
    if (viewingArchive?.id === id) {
      setViewingArchive(null)
    }
  }

  return (
    <div className="briefing-overlay-backdrop" onClick={onClose}>
      <div className="briefing-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="briefing-header">
          <div className="briefing-title">
            <BotIcon style={{ width: 16, height: 16, opacity: 0.6 }} />
            <span>{isViewingOld ? 'Past Briefing' : 'Briefing'}</span>
          </div>
          <div className="briefing-actions">
            {displayProvider && <span className="briefing-provider">{displayProvider}</span>}
            {isViewingOld && (
              <button
                className="briefing-nav-btn"
                onClick={() => setViewingArchive(null)}
                title="Back to current"
              >
                Current
              </button>
            )}
            <button
              className="briefing-nav-btn"
              onClick={() => setShowArchive(!showArchive)}
              title={showArchive ? 'Hide history' : 'Show history'}
            >
              <ClockIcon />
              {archive.length > 0 && <span className="briefing-archive-count">{archive.length}</span>}
            </button>
            <button
              className="briefing-refresh"
              onClick={generate}
              disabled={loading}
              title="Generate new briefing"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        <div className="briefing-body">
          {showArchive && (
            <div className="briefing-archive-sidebar">
              <div className="briefing-archive-title">History</div>
              {archive.length === 0 ? (
                <div className="briefing-archive-empty">No past briefings</div>
              ) : (
                archive.map((b) => (
                  <button
                    key={b.id}
                    className={`briefing-archive-item ${viewingArchive?.id === b.id ? 'briefing-archive-item--active' : ''}`}
                    onClick={() => setViewingArchive(b)}
                  >
                    <span className="briefing-archive-date">{formatTimestamp(b.created_at)}</span>
                    <span className="briefing-archive-preview">{b.content.slice(0, 60)}...</span>
                    <button
                      className="briefing-archive-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteArchive(b.id) }}
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="briefing-content">
            {loading ? (
              <div className="briefing-loading">
                <div className="briefing-loading-dot" />
                <span>Generating briefing...</span>
              </div>
            ) : displayError ? (
              <div className="briefing-error">{displayError}</div>
            ) : displayText ? (
              <div className="briefing-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }} />
            ) : (
              <div className="briefing-loading">
                <span>No briefing yet. Click refresh to generate one.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
