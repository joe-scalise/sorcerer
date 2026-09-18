import type { WebContents } from 'electron'

/** Links may open a browser, never an arbitrary native protocol handler. */
export function isExternalWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

/** Keep every app window on its trusted renderer, including detached panels. */
export function secureWindowContents(
  contents: WebContents,
  openExternal: (url: string) => Promise<unknown>
): void {
  const openWebLink = (url: string) => {
    if (isExternalWebUrl(url)) {
      void openExternal(url).catch((err) => {
        console.warn('[window] Failed to open browser link:', err)
      })
    }
  }

  // Main-process loadURL/loadFile and reload are unaffected by these events.
  // Hash navigation remains within the renderer and does not emit will-navigate.
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openWebLink(url)
  })
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault()
  })
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    openWebLink(url)
    return { action: 'deny' }
  })
}
