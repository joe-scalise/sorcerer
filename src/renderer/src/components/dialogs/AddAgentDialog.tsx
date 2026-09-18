import { useState, useEffect } from 'react'
import { Dialog, DialogField, DialogActions, DialogButton } from '../Dialog'
import { DialogSelect } from '../DialogSelect'
import { useUIStore } from '../../stores/useUIStore'
import { useAgentStore } from '../../stores/useAgentStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { ChevronIcon, BotIcon, TerminalIcon } from '../icons'
import { useProviders } from '../../hooks/useProviders'
import { useToastStore } from '../../stores/useToastStore'
import { getFeatures } from '../../features'

type AgentMode = null | 'interactive' | 'autonomous'

export function AddAgentDialog() {
  const { activeDialog, closeDialog } = useUIStore()
  const { addAgent, startAgent } = useAgentStore()
  const { setActiveSession } = useSessionStore()
  const { detectedProviders, defaultProvider, getProvider, loading: providersLoading } = useProviders()
  const [mode, setMode] = useState<AgentMode>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mission, setMission] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [mcpConfig, setMcpConfig] = useState('')
  const [bypassPermissions, setBypassPermissions] = useState(true)
  const [remoteControl, setRemoteControl] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const [scheduleMinutes, setScheduleMinutes] = useState('0')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const open = getFeatures().standaloneAgents && activeDialog === 'add-agent'
  const selectedProvider = getProvider(provider) || defaultProvider
  const hasSuggestedModels = (selectedProvider?.models.length || 0) > 0
  const isCustomModel = customModel || (!!selectedProvider?.supportsModelOverride && !!model && !selectedProvider.models.includes(model))
  const canSubmit = !!name.trim() && !!selectedProvider && detectedProviders.length > 0 && (mode !== 'autonomous' || !!mission.trim()) && !submitting
  const bypassHint =
    provider === 'claude'
      ? 'Claude skips permission prompts and can run tools without asking.'
      : provider === 'gemini'
        ? 'Gemini automatically approves tool actions without asking.'
        : provider === 'codex'
          ? 'Codex skips approval prompts and disables sandbox restrictions.'
          : 'Automatically approves tool actions where supported by this provider.'

  useEffect(() => {
    if (!open || providersLoading || provider || !defaultProvider) return
    setProvider(defaultProvider.id)
    setModel(defaultProvider.supportsModelOverride ? defaultProvider.defaultModel || defaultProvider.models[0] || '' : '')
  }, [open, providersLoading, provider, defaultProvider])

  const resetAndClose = () => {
    setMode(null)
    setName('')
    setDescription('')
    setMission('')
    setSystemPrompt('')
    setMcpConfig('')
    setBypassPermissions(true)
    setRemoteControl(false)
    setAutoStart(false)
    setScheduleMinutes('0')
    setShowAdvanced(false)
    setProvider('')
    setModel('')
    setCustomModel(false)
    setError(null)
    closeDialog()
  }

  const handleClose = () => {
    if (!submitting) resetAndClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const id = await addAgent({
        name: name.trim(),
        description: description.trim(),
        mission: mode === 'autonomous' ? mission.trim() : '',
        system_prompt: systemPrompt.trim(),
        mcp_config: mcpConfig.trim(),
        bypass_permissions: bypassPermissions,
        remote_control: mode === 'interactive' ? remoteControl : false,
        auto_start: mode === 'autonomous' ? autoStart : false,
        auto_restart: mode === 'autonomous' && parseInt(scheduleMinutes) > 0,
        schedule_minutes: mode === 'autonomous' ? parseInt(scheduleMinutes) || 0 : 0,
        provider: selectedProvider.id,
        model: selectedProvider.supportsModelOverride ? model.trim() : ''
      })
      if (id) {
        try {
          await startAgent(id)
        } catch (err) {
          useToastStore.getState().addToast(`Agent created, but could not start: ${err instanceof Error ? err.message : String(err)}. Use Start to retry.`, 'error')
        }
        setActiveSession(id)
        resetAndClose()
      } else {
        setError('Could not create the agent. Check your provider settings and try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  if (!mode) {
    return (
      <Dialog open={open} onClose={handleClose} title="New Agent">
        <div className="dialog-hint" style={{ marginBottom: 12 }}>What kind of agent do you want to create?</div>
        <div className="agent-mode-picker">
          <button type="button" className="agent-mode-option" onClick={() => setMode('interactive')}>
            <TerminalIcon className="agent-mode-icon" />
            <div className="agent-mode-info">
              <span className="agent-mode-label">Interactive Session</span>
              <span className="agent-mode-desc">A standalone agent session you interact with directly. Not tied to any git repo.</span>
            </div>
          </button>
          <button type="button" className="agent-mode-option" onClick={() => setMode('autonomous')}>
            <BotIcon className="agent-mode-icon" />
            <div className="agent-mode-info">
              <span className="agent-mode-label">Scheduled Mission</span>
              <span className="agent-mode-desc">Runs a mission on a schedule — monitor, scan, report, or remediate. Results are captured and diffed between runs.</span>
            </div>
          </button>
        </div>
        <DialogActions>
          <DialogButton onClick={handleClose}>Cancel</DialogButton>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={handleClose} title={mode === 'autonomous' ? 'New Scheduled Mission' : 'New Interactive Agent'}>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {mode === 'autonomous' && (
          <div className="dialog-hint" style={{ marginBottom: 10, color: 'var(--accent)' }}>
            Scheduled missions are experimental. Start with longer intervals and monitor results before increasing frequency.
          </div>
        )}
        <DialogField label="Name">
          <input
            className="dialog-input"
            type="text"
            placeholder={mode === 'autonomous' ? 'e.g. "Sentry Monitor", "Email Responder"' : 'e.g. "Research Assistant", "Code Helper"'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </DialogField>

        <div style={{ display: 'flex', gap: 12 }}>
          <DialogField label="AI Provider" style={{ flex: 1 }}>
            <DialogSelect
              value={provider}
              onChange={(nextValue) => {
                const nextProvider = getProvider(nextValue)
                setProvider(nextValue)
                setCustomModel(false)
                setModel(nextProvider?.supportsModelOverride ? nextProvider.defaultModel || nextProvider.models[0] || '' : '')
                if (!nextProvider?.supportsRemoteControl) setRemoteControl(false)
              }}
              disabled={providersLoading || detectedProviders.length === 0}
              options={detectedProviders.map((providerOption) => ({
                value: providerOption.id,
                label: providerOption.name
              }))}
            />
          </DialogField>
          {selectedProvider?.supportsModelOverride && (
            <DialogField label="Model" style={{ flex: 1 }}>
              {hasSuggestedModels ? (
                <>
                  <DialogSelect
                    value={isCustomModel ? '__custom__' : model}
                    onChange={(nextValue) => {
                      if (nextValue === '__custom__') {
                        setCustomModel(true)
                        if (!isCustomModel) setModel('')
                        return
                      }
                      setCustomModel(false)
                      setModel(nextValue)
                    }}
                    options={[
                      ...selectedProvider.models.map((modelName) => ({
                        value: modelName,
                        label: modelName
                      })),
                      { value: '__custom__', label: 'Custom…' }
                    ]}
                  />
                  {(isCustomModel || model === '') && (
                    <input
                      className="dialog-input"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Enter custom model"
                      aria-label="Custom model"
                      style={{ marginTop: 8 }}
                    />
                  )}
                </>
              ) : (
                <input
                  className="dialog-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Enter model"
                />
              )}
            </DialogField>
          )}
        </div>
        {selectedProvider?.apiKeyEnv && (
          <div className="dialog-hint" style={{ marginTop: 4 }}>
            Requires <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedProvider.apiKeyEnv}</code> in your environment.
          </div>
        )}
        {selectedProvider?.usesFallbackModels && selectedProvider.supportsModelOverride && (
          <div className="dialog-hint" style={{ marginTop: 4 }}>
            Using bundled model suggestions. You can still enter any model manually.
          </div>
        )}
        {!providersLoading && detectedProviders.length === 0 && (
          <div className="dialog-hint" style={{ marginTop: 4 }}>
            No supported providers were detected. Install a supported CLI or refresh Providers in Settings.
          </div>
        )}

        <DialogField label="Description">
          <input
            className="dialog-input"
            type="text"
            placeholder="What does this agent do? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </DialogField>

        {mode === 'autonomous' && (
          <>
            <DialogField label="Mission">
              <textarea
                className="dialog-input dialog-textarea"
                placeholder={'Describe what this agent should do...\n\ne.g. Monitor the Sentry project for new errors. Triage severity and investigate root causes. For critical errors, draft a fix.'}
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                rows={4}
                required
              />
            </DialogField>
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
            <label className="dialog-checkbox">
              <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
              Auto-start when Sorcerer launches
            </label>
          </>
        )}

        <label className="dialog-checkbox">
          <input type="checkbox" checked={bypassPermissions} onChange={(e) => setBypassPermissions(e.target.checked)} />
          Unattended mode
        </label>
        {bypassPermissions && (
          <div className="dialog-hint" style={{ marginTop: 4 }}>
            {bypassHint}
          </div>
        )}
        {mode === 'interactive' && selectedProvider?.supportsRemoteControl && (
          <label className="dialog-checkbox">
            <input type="checkbox" checked={remoteControl} onChange={(e) => setRemoteControl(e.target.checked)} />
            Enable Session Remote Control
          </label>
        )}

        <button
          type="button"
          className="dialog-advanced-toggle"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <ChevronIcon className={`dialog-advanced-chevron ${showAdvanced ? 'dialog-advanced-chevron--open' : ''}`} />
          <span>Configure MCP &amp; System Prompt</span>
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
              <div className="dialog-hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Connect external tools via Model Context Protocol servers.
              </div>
            </DialogField>
            <DialogField label="System Prompt">
              <textarea
                className="dialog-input dialog-textarea"
                placeholder="Custom instructions for this agent..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
              />
              <div className="dialog-hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Appended to agent&apos;s system prompt (if supported).
              </div>
            </DialogField>
          </div>
        )}

        {error && <div className="dialog-error" role="alert">{error}</div>}
        <DialogActions>
          <DialogButton onClick={() => setMode(null)} disabled={submitting}>Back</DialogButton>
          <DialogButton variant="primary" type="submit" loading={submitting} disabled={!canSubmit}>
            {mode === 'autonomous' ? 'Create & Start Mission' : 'Create Agent'}
          </DialogButton>
        </DialogActions>
        </fieldset>
      </form>
    </Dialog>
  )
}
