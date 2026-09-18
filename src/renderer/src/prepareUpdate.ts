import { flushAllNoteDrafts } from './stores/useQuickNotesDraftStore'

/** Installed in both main and popout windows before React renders. */
export function registerUpdatePreparation(): void {
  const api = window.sorcerer?.system.updates
  if (!api) return
  let preparing = false
  let notice: HTMLDivElement | undefined
  const unlock = () => {
    if (!preparing) return
    preparing = false
    document.body.inert = false
    notice?.remove()
    notice = undefined
  }
  api.onState((state) => { if (state.status !== 'installing') unlock() })
  api.onPrepareInstall((requestId) => {
    preparing = true
    // Freeze inputs before saving so an early acknowledgement cannot be
    // followed by another edit while other windows are still preparing.
    document.body.inert = true
    notice = document.createElement('div')
    notice.className = 'update-preparing-overlay'
    notice.textContent = 'Saving your work before restarting…'
    notice.setAttribute('role', 'status')
    document.body.append(notice)
    void flushAllNoteDrafts().then(() => api.prepared(requestId, true)).catch((error) => {
      unlock()
      api.prepared(requestId, false, error instanceof Error ? error.message : 'Could not save notes.')
    })
  })
}
