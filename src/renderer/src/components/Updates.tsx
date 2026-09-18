import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, DialogActions, DialogButton } from './Dialog'
import { subscribeToUpdates, useUpdateStore } from '../stores/useUpdateStore'
import type { UpdateState } from '../../../shared/update'
import { renderMarkdown } from '../utils/renderMarkdown'

export function updateStatusText(state: UpdateState | null): string {
  if (!state) return 'Ready to check for updates'
  if (state.status === 'installing') return 'Preparing to restart…'
  if (state.downloaded) return `Version ${state.version} is ready to install`
  if (state.status === 'downloading') return `Downloading ${Math.round(state.progress || 0)}%`
  if (state.status === 'checking') return 'Checking for updates…'
  if (state.status === 'error') return 'Could not complete the update'
  if (state.version) return `Version ${state.version} is available`
  if (state.checkedAt) return 'You’re up to date'
  return 'Ready to check for updates'
}

function openRelease(url?: string) {
  if (url) void window.sorcerer?.window.openExternal(url)
}

export function UpdateActions() {
  const { state, run } = useUpdateStore()
  const busy = state && ['checking', 'downloading', 'installing'].includes(state.status)
  return <>
    {!state?.downloaded && <DialogButton disabled={!!busy} onClick={() => { void run('check') }}>{state?.status === 'error' ? 'Retry check' : 'Check now'}</DialogButton>}
    {state?.url && <DialogButton onClick={() => openRelease(state.url)}>View release</DialogButton>}
    {state?.downloaded && <DialogButton variant="primary" disabled={!!busy} onClick={() => { void run('install') }}>Restart and install</DialogButton>}
    {state?.canDownload && <DialogButton variant="primary" disabled={!!busy} onClick={() => { void run('download') }}>{state.status === 'downloading' ? 'Downloading…' : state.status === 'error' ? 'Retry download' : 'Download update'}</DialogButton>}
    {state?.version && !state.managed && state.url && <DialogButton variant="primary" onClick={() => openRelease(state.url)}>Download from GitHub</DialogButton>}
  </>
}

export function UpdateSummary() {
  const { state, actionError } = useUpdateStore()
  return <div className="update-summary">
    <p className="update-status" role="status" aria-live="polite">{updateStatusText(state)}</p>
    {state?.status === 'downloading' && <progress className="update-progress" max={100} value={state.progress || 0} aria-label="Update download progress" />}
    {(actionError || state?.error) && <p className="update-error" role="alert">{actionError || state?.error}</p>}
    {state?.checkedAt && <p className="update-caption">Last checked {new Date(state.checkedAt).toLocaleString()}</p>}
  </div>
}

export function Updates() {
  const { state, open, setOpen } = useUpdateStore()
  const releaseNotes = useMemo(() => renderMarkdown(state?.releaseNotes || ''), [state?.releaseNotes])
  useEffect(subscribeToUpdates, [])
  if (!window.sorcerer) return null
  const visible = !!state && (!!state.version || state.status === 'error')
  const label = state?.downloaded ? 'Update ready' : state?.status === 'downloading'
    ? `Downloading update · ${Math.round(state.progress || 0)}%`
    : state?.version ? `Update available · ${state.version}` : 'Update check failed'
  return <>
    {visible && <button type="button" className="titlebar-update" onClick={() => setOpen(true)}>{label}</button>}
    {createPortal(<Dialog open={open} onClose={() => setOpen(false)} title="Sorcerer updates">
      <div className="update-version-line"><span>Installed</span><strong>{state?.currentVersion || __APP_VERSION__}</strong></div>
      <UpdateSummary />
      {state?.downloaded && <p className="update-caption">Install when you’re ready. Restarting stops running terminals and agents. Your notes will be saved first.</p>}
      {state && !state.managed && <p className="update-caption">This installation uses manual updates. Download the installer for your platform from the release page.</p>}
      {state?.releaseNotes && <details className="update-notes" open>
        <summary>What’s new in {state.version}</summary>
        <div className="update-notes-body" dangerouslySetInnerHTML={{ __html: releaseNotes }} />
      </details>}
      <DialogActions><UpdateActions /></DialogActions>
    </Dialog>, document.body)}
  </>
}
