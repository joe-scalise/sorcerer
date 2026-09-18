import { useState, useEffect } from 'react'
import { Dialog, DialogField, DialogActions, DialogButton } from '../Dialog'
import { DialogSelect } from '../DialogSelect'
import { getApi } from '../../api/client'
import { useUIStore } from '../../stores/useUIStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { useProviders } from '../../hooks/useProviders'
import { resolveNewSessionProjectId } from '../../utils/newSessionDefaults'

export function NewSessionDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { projects } = useProjectStore()
  const { createSession } = useSessionStore()
  const { detectedProviders, defaultProvider, getProvider, loading: providersLoading } = useProviders()
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [useMainRepo, setUseMainRepo] = useState(false)
  const [bypassPermissions, setBypassPermissions] = useState(true)
  const [remoteControl, setRemoteControl] = useState(false)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<{ hasGit: boolean; hasCommits: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const open = activeDialog === 'new-session'
  const selectedProvider = getProvider(provider) || defaultProvider

  const effectiveProjectId = dialogTargetId || projectId
  const project = projects.find((p) => p.id === effectiveProjectId)

  useEffect(() => {
    if (!open || providersLoading || provider || !defaultProvider) return
    setProvider(defaultProvider.id)
    setModel(defaultProvider.supportsModelOverride ? defaultProvider.defaultModel || defaultProvider.models[0] || '' : '')
  }, [open, providersLoading, provider, defaultProvider])

  useEffect(() => {
    if (!open || !!dialogTargetId) return
    const defaultProjectId = resolveNewSessionProjectId()
    if (defaultProjectId) {
      setProjectId(defaultProjectId)
    }
  }, [open, dialogTargetId])

  useEffect(() => {
    let cancelled = false
    setGitInfo(null)
    setGitError(null)
    setUseMainRepo(false)
    if (!effectiveProjectId || !open) {
      return
    }
    getApi().project.checkGit(effectiveProjectId).then((info) => {
      if (!cancelled) setGitInfo(info)
    }).catch(() => {
      if (!cancelled) setGitError('Could not check this project’s Git status. Select the project again or reopen this dialog to retry.')
    })
    return () => { cancelled = true }
  }, [effectiveProjectId, open])

  const isGitProject = gitInfo?.hasGit && gitInfo?.hasCommits
  const isEmptyGit = gitInfo?.hasGit && !gitInfo?.hasCommits
  const hasSuggestedModels = (selectedProvider?.models.length || 0) > 0
  const isCustomModel = customModel || (!!selectedProvider?.supportsModelOverride && !!model && !selectedProvider.models.includes(model))
  const canSubmit = !!project && !!gitInfo && !!name.trim() && !!selectedProvider && detectedProviders.length > 0 && !submitting
  const bypassHint =
    provider === 'claude'
      ? 'Claude skips permission prompts and can run tools without asking.'
      : provider === 'gemini'
        ? 'Gemini automatically approves tool actions without asking.'
        : provider === 'codex'
          ? 'Codex skips approval prompts and disables sandbox restrictions.'
          : 'Automatically approves tool actions where supported by this provider.'

  const resetAndClose = () => {
    setName('')
    setProjectId('')
    setUseMainRepo(false)
    setBypassPermissions(true)
    setRemoteControl(false)
    setProvider('')
    setModel('')
    setCustomModel(false)
    setError(null)
    setGitError(null)
    setGitInfo(null)
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
      const result = await createSession(
        effectiveProjectId,
        name.trim(),
        !!isGitProject && useMainRepo,
        bypassPermissions,
        remoteControl,
        selectedProvider.id,
        selectedProvider.supportsModelOverride ? model.trim() : ''
      )
      if (!result?.session) {
        setError(result?.error || 'Failed to create session')
      } else {
        resetAndClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setSubmitting(false)
    }
  }

  let hintText: React.ReactNode
  if (!gitInfo) {
    hintText = null
  } else if (!gitInfo.hasGit) {
    hintText = `${selectedProvider?.name || 'Agent'} will run directly in this folder.`
  } else if (isEmptyGit) {
    hintText = 'Git repository has no commits yet — will work directly in the project folder.'
  } else if (useMainRepo) {
    hintText = 'Will use current branch in main repository.'
  } else {
    hintText = <>An isolated worktree branch <span className="dialog-hint-mono">{project?.name || '...'}/{name || '...'}</span> will be created.</>
  }

  return (
    <Dialog open={open} onClose={handleClose} title="New Session">
      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <DialogField label="Project">
          {dialogTargetId ? (
            <div className="dialog-readonly">{project?.name || 'Unknown'}</div>
          ) : (
            <DialogSelect
              value={projectId}
              onChange={setProjectId}
              options={[
                { value: '', label: 'Select a project...' },
                ...projects.map((p) => ({ value: p.id, label: p.name }))
              ]}
            />
          )}
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

        <DialogField label="Session name">
          <input
            className="dialog-input"
            type="text"
            placeholder="e.g. feature-auth, fix-bug-42"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </DialogField>
        {isGitProject && (
          <label className="dialog-checkbox">
            <input
              type="checkbox"
              checked={useMainRepo}
              onChange={(e) => setUseMainRepo(e.target.checked)}
            />
            Work in main repository
          </label>
        )}
        <label className="dialog-checkbox">
          <input
            type="checkbox"
            checked={bypassPermissions}
            onChange={(e) => setBypassPermissions(e.target.checked)}
          />
          Unattended mode
        </label>
        {bypassPermissions && (
          <div className="dialog-hint" style={{ marginTop: 4 }}>
            {bypassHint}
          </div>
        )}
        {selectedProvider?.supportsRemoteControl && (
          <label className="dialog-checkbox">
            <input
              type="checkbox"
              checked={remoteControl}
              onChange={(e) => setRemoteControl(e.target.checked)}
            />
            Enable Session Remote Control
          </label>
        )}
        {hintText && <div className="dialog-hint">{hintText}</div>}
        {effectiveProjectId && !gitInfo && !gitError && <div className="dialog-hint" role="status">Checking project Git status...</div>}
        {gitError && <div className="dialog-error" role="alert">{gitError}</div>}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <DialogActions>
          <DialogButton onClick={handleClose} disabled={submitting}>Cancel</DialogButton>
          <DialogButton variant="primary" type="submit" loading={submitting} disabled={!canSubmit}>Create Session</DialogButton>
        </DialogActions>
        </fieldset>
      </form>
    </Dialog>
  )
}
