import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow, type IpcMainEvent, type WebContents, type WebFrameMain } from 'electron'

const PREPARE_CHANNEL = 'updates:prepare-install'
const PREPARED_CHANNEL = 'updates:prepared'
const PREPARE_TIMEOUT_MS = 10_000

/** Save every live window's drafts before allowing an update to stop the app. */
export async function flushUpdateDrafts(windows: BrowserWindow[]): Promise<void> {
  const participants = new Map<number, { window: BrowserWindow; contents: WebContents; frame: WebFrameMain }>()
  for (const window of windows) {
    if (window.isDestroyed()) continue
    const contents = window.webContents
    if (contents.isDestroyed()) throw new Error('A window closed before its notes could be saved. Retry the update after checking your notes.')
    participants.set(contents.id, { window, contents, frame: contents.mainFrame })
  }
  if (participants.size === 0) return

  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const pending = new Set(participants.keys())
    const removers: Array<() => void> = []
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const remove of removers) remove()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('Some windows did not finish saving notes. Check your notes and retry the update.')), PREPARE_TIMEOUT_MS)
    const acknowledge = (event: IpcMainEvent, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const response = payload as { requestId?: unknown; ok?: unknown; error?: unknown }
      if (response.requestId !== requestId) return
      const participant = participants.get(event.sender.id)
      if (!participant || participant.contents !== event.sender || !pending.has(event.sender.id)) return
      if (participant.window.isDestroyed() || participant.contents.isDestroyed()) {
        finish(new Error('A window closed before its notes could be saved. Retry the update after checking your notes.'))
        return
      }
      // A child frame or a replacement renderer cannot confirm the original
      // window's unsaved draft state.
      if (event.senderFrame !== participant.frame || participant.contents.mainFrame !== participant.frame) return
      if (response.ok !== true) {
        const detail = typeof response.error === 'string' ? response.error.trim().slice(0, 300) : ''
        finish(new Error(detail ? `Notes could not be saved: ${detail}` : 'Notes could not be saved. Retry saving your notes before updating.'))
        return
      }
      pending.delete(event.sender.id)
      if (pending.size === 0) finish()
    }

    ipcMain.on(PREPARED_CHANNEL, acknowledge)
    removers.push(() => ipcMain.removeListener(PREPARED_CHANNEL, acknowledge))
    try {
      // Observe every participant until the whole handshake finishes, including
      // windows that have already acknowledged while another is still saving.
      for (const { window, contents } of participants.values()) {
        const unavailable = () => finish(new Error('A window closed or stopped responding before all notes were saved. Retry the update after checking your notes.'))
        const navigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
          if (isMainFrame && !isInPlace) unavailable()
        }
        window.on('closed', unavailable)
        contents.on('destroyed', unavailable)
        contents.on('render-process-gone', unavailable)
        contents.on('did-start-navigation', navigation)
        removers.push(() => {
          window.removeListener('closed', unavailable)
          contents.removeListener('destroyed', unavailable)
          contents.removeListener('render-process-gone', unavailable)
          contents.removeListener('did-start-navigation', navigation)
        })
      }
      for (const { window, contents } of participants.values()) {
        if (settled) break
        if (window.isDestroyed() || contents.isDestroyed()) throw new Error('A window closed before its notes could be saved. Retry the update after checking your notes.')
        contents.send(PREPARE_CHANNEL, { requestId })
      }
    } catch (error) {
      finish(new Error('Could not ask every window to save its notes. Retry the update after checking your notes.', { cause: error }))
    }
  })
}
