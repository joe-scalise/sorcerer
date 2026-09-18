import { useState, useEffect } from 'react'
import { Dialog, DialogField, DialogActions, DialogButton } from '../Dialog'
import { DialogSelect } from '../DialogSelect'
import { getApi } from '../../api/client'
import { useUIStore } from '../../stores/useUIStore'
import { useAgentStore } from '../../stores/useAgentStore'
import { ChevronIcon } from '../icons'
import { useProviders } from '../../hooks/useProviders'
import { getFeatures } from '../../features'

export function EditMissionDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const agents = useAgentStore((s) => s.agents)
  const [mission, setMission] = useState('')
  const [scheduleMinutes, setScheduleMinutes] = useState('0')
  const [autoStart, setAutoStart] = useState(false)
  const [maxRestarts, setMaxRestarts] = useState('10')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [mcpConfig, setMcpConfig] = useState('')
  const [bypassPermissions, setBypassPermissions] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const { defaultProvider } = useProviders()

  const open = getFeatures().standaloneAgents && activeDialog === 'edit-agent-mission'
  const agent = agents.find((a) => a.id === dialogTargetId)

  useEffect(() => {
    if (open && agent) {
      setMission(agent.mission || '')
      setScheduleMinutes(String(agent.schedule_minutes || 0))
      setAutoStart(agent.auto_start === 1)
      setMaxRestarts(String(agent.max_restarts || 10))
      setSystemPrompt(agent.system_prompt || '')
      setMcpConfig(agent.mcp_config || '')
      setBypassPermissions(agent.bypass_permissions !== 0)
      setShowAdvanced(!!(agent.system_prompt || agent.mcp_config))
    }
  }, [open, agent])

  const handleClose = () => {
    setShowAdvanced(false)
    closeDialog()
  }

  const handleSave = async () => {
    if (!dialogTargetId) return
    setLoading(true)
    try {
      const updates: any = {
        mission: mission.trim(),
        schedule_minutes: parseInt(scheduleMinutes) || 0,
        auto_start: autoStart ? 1 : 0,
        auto_restart: parseInt(scheduleMinutes) > 0 ? 1 : 0,
        max_restarts: parseInt(maxRestarts) || 10,
        system_prompt: systemPrompt.trim(),
        mcp_config: mcpConfig.trim(),
        bypass_permissions: bypassPermissions ? 1 : 0
      }
      await getApi().agent.update(dialogTargetId, updates)
      useAgentStore.getState().updateAgentInStore(dialogTargetId, updates)
      handleClose()
    } finally {
      setLoading(false)
    }
  }

  if (!open || !agent) return null

  const hasMission = mission.trim().length > 0
  const provider = agent.provider || defaultProvider?.id || 'claude'
  const bypassHint =
    provider === 'claude'
      ? 'Claude runs with --dangerously-skip-permissions.'
      : provider === 'gemini'
        ? 'Gemini runs with --yolo.'
        : provider === 'codex'
          ? 'Codex runs with --dangerously-bypass-approvals-and-sandbox.'
          : 'Runs with the provider’s closest unattended mode.'

  return (
    <Dialog open={open} onClose={handleClose} title={`Edit Agent — ${agent.name}`}>
      <DialogField label="Mission">
        <textarea
          className="dialog-input dialog-textarea"
          placeholder="Describe what this agent should do...&#10;&#10;Leave empty for an interactive session."
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          rows={5}
          autoFocus
        />
      </DialogField>

      {hasMission && (
        <>
          <DialogField label="Run Schedule">
            <DialogSelect
              value={scheduleMinutes}
              onChange={setScheduleMinutes}
              style={{ width: 200 }}
              options={[
                { value: '0', label: 'Run once (manual)' },
                { value: '5', label: 'Every 5 minutes' },
                { value: '15', label: 'Every 15 minutes' },
                { value: '30', label: 'Every 30 minutes' },
                { value: '60', label: 'Every hour' },
                { value: '120', label: 'Every 2 hours' },
                { value: '360', label: 'Every 6 hours' },
                { value: '720', label: 'Every 12 hours' },
                { value: '1440', label: 'Daily' }
              ]}
            />
          </DialogField>
          <DialogField label="Max runs per day">
            <input
              className="dialog-input"
              type="number"
              min="1"
              max="100"
              value={maxRestarts}
              onChange={(e) => setMaxRestarts(e.target.value)}
              style={{ width: 80 }}
            />
          </DialogField>
          <label className="dialog-checkbox">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            Auto-start when Sorcerer launches
          </label>
        </>
      )}

      <label className="dialog-checkbox">
        <input type="checkbox" checked={bypassPermissions} onChange={(e) => setBypassPermissions(e.target.checked)} />
        Auto-accept permissions
      </label>
      {bypassPermissions && (
        <div className="dialog-hint" style={{ marginTop: 4 }}>
          {bypassHint}
        </div>
      )}

      <button
        type="button"
        className="dialog-advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <ChevronIcon className={`dialog-advanced-chevron ${showAdvanced ? 'dialog-advanced-chevron--open' : ''}`} />
        <span>MCP &amp; System Prompt</span>
      </button>

      {showAdvanced && (
        <div className="dialog-advanced-body">
          <DialogField label="MCP Config">
            <input
              className="dialog-input"
              type="text"
              placeholder="Path to mcp-config.json"
              value={mcpConfig}
              onChange={(e) => setMcpConfig(e.target.value)}
            />
          </DialogField>
          <DialogField label="System Prompt">
            <textarea
              className="dialog-input dialog-textarea"
              placeholder="Custom instructions appended to the agent's system prompt..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
            />
          </DialogField>
        </div>
      )}

      <div className="dialog-hint">
        {hasMission ? 'Changes take effect on the next scheduled run.' : 'Clearing the mission converts this to an interactive agent.'}
      </div>
      <DialogActions>
        <DialogButton onClick={handleClose} disabled={loading}>Cancel</DialogButton>
        <DialogButton variant="primary" onClick={handleSave} loading={loading}>Save</DialogButton>
      </DialogActions>
    </Dialog>
  )
}
