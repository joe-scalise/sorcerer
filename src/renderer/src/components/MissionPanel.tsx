import { useState, useEffect } from 'react'
import { renderMarkdown } from '../utils/renderMarkdown'
import { getApi } from '../api/client'
import { RefreshIcon, ClockIcon, BotIcon } from './icons'
import type { Agent } from '../types'


interface AgentRun {
  id: string
  agent_id: string
  output: string
  exit_code: number
  started_at: number
  completed_at: number
  duration_ms: number
}

function formatRunTime(epoch: number): string {
  const d = new Date(epoch * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function MissionPanel({ agent }: { agent: Agent }) {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null)
  const [loading, setLoading] = useState(true)

  const loadRuns = async () => {
    setLoading(true)
    const data = await getApi().agent.listRuns(agent.id, 50)
    setRuns(data)
    if (data.length > 0 && !selectedRun) {
      setSelectedRun(data[0])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadRuns()
    // Refresh when agent status changes (new run completed)
    const interval = setInterval(loadRuns, 15_000)
    return () => clearInterval(interval)
  }, [agent.id])

  // Update selected run when runs refresh
  useEffect(() => {
    if (selectedRun && runs.length > 0) {
      const updated = runs.find((r) => r.id === selectedRun.id)
      if (updated) setSelectedRun(updated)
    } else if (!selectedRun && runs.length > 0) {
      setSelectedRun(runs[0])
    }
  }, [runs])

  const scheduleLabel = agent.schedule_minutes > 0
    ? agent.schedule_minutes < 60 ? `Every ${agent.schedule_minutes}m`
      : agent.schedule_minutes < 1440 ? `Every ${Math.floor(agent.schedule_minutes / 60)}h`
        : 'Daily'
    : 'Manual'

  return (
    <div className="mission-panel">
      <div className="mission-panel-header">
        <BotIcon style={{ width: 14, height: 14, opacity: 0.5 }} />
        <span className="mission-panel-title">{agent.name}</span>
        <span className="mission-panel-schedule">{scheduleLabel}</span>
        <span className="mission-panel-run-count">{runs.length} runs</span>
        <button className="mission-panel-refresh" onClick={loadRuns} title="Refresh">
          <RefreshIcon />
        </button>
      </div>

      <div className="mission-panel-body">
        {/* Run list sidebar */}
        <div className="mission-panel-runs">
          {loading && runs.length === 0 ? (
            <div className="mission-panel-empty">Loading...</div>
          ) : runs.length === 0 ? (
            <div className="mission-panel-empty">No runs yet</div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                className={`mission-run-item ${selectedRun?.id === run.id ? 'mission-run-item--active' : ''}`}
                onClick={() => setSelectedRun(run)}
              >
                <div className="mission-run-item-top">
                  <span className={`mission-run-status ${run.exit_code === 0 ? 'mission-run-status--ok' : 'mission-run-status--error'}`} />
                  <span className="mission-run-time">{formatRunTime(run.completed_at)}</span>
                </div>
                <div className="mission-run-meta">
                  {formatDuration(run.duration_ms)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Selected run output */}
        <div className="mission-panel-output">
          {selectedRun ? (
            <>
              <div className="mission-output-header">
                <ClockIcon style={{ width: 12, height: 12 }} />
                <span>{formatRunTime(selectedRun.completed_at)}</span>
                <span className="mission-output-duration">{formatDuration(selectedRun.duration_ms)}</span>
                {selectedRun.exit_code !== 0 && (
                  <span className="mission-output-error">Exit {selectedRun.exit_code}</span>
                )}
              </div>
              <div
                className="mission-output-content briefing-text"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedRun.output) }}
              />
            </>
          ) : (
            <div className="mission-panel-empty">
              {agent.mission ? 'Waiting for first run...' : 'No mission configured'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
