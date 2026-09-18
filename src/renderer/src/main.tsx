import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { PopoutApp } from './PopoutApp'
import { isPopout } from './popout'
import { getThemeById, applyTheme } from './themes'
import './styles/index.css'
import { registerUpdatePreparation } from './prepareUpdate'
import { loadFeatures } from './features'

async function boot() {
  registerUpdatePreparation()
  // In a browser (no Electron preload), initialise the remote API client
  // using the token from the URL query string (?token=...).
  if (!window.sorcerer) {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) {
      document.getElementById('root')!.innerHTML =
        '<div style="padding:2rem;font-family:var(--font-sans, system-ui);color:var(--text-secondary);background:var(--bg-root);min-height:100vh">' +
        '<h2>Remote Access</h2>' +
        '<p>Append <code>?token=YOUR_TOKEN</code> to the URL to connect.</p>' +
        '</div>'
      return
    }
    const baseUrl = window.location.origin
    const { initRemoteClient } = await import('./api/client')
    await initRemoteClient(baseUrl, token)
  }

  await loadFeatures()

  // Popout windows get a minimal chrome-less view
  if (isPopout()) {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <PopoutApp />
      </React.StrictMode>
    )
    return
  }

  // Apply persisted theme before first render to avoid color flash
  const { getApi } = await import('./api/client')
  const themeId = await getApi().settings.get('theme')
  applyTheme(getThemeById(themeId || 'default'))

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot().catch((error) => {
  console.error('Sorcerer could not start:', error)
  const root = document.getElementById('root')!
  const message = document.createElement('p')
  message.textContent = 'Could not connect to Sorcerer. Please reopen the app or reload to try again.'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Reload'
  retry.onclick = () => window.location.reload()
  root.replaceChildren(message, retry)
})
