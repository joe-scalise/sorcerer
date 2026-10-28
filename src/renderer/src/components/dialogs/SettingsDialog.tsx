import React, { useState, useRef, useEffect } from 'react'
import { getApi, isElectron } from '../../api/client'
import { useUIStore } from '../../stores/useUIStore'
import { useToastStore } from '../../stores/useToastStore'
import {
  TerminalIcon, GitBranchIcon, SettingsIcon, UserIcon, WifiIcon, CopyIcon, RefreshIcon, EyeIcon, EyeOffIcon, PaletteIcon, SmartphoneIcon, BotIcon, KeyboardIcon
} from '../icons'
import { THEMES, getThemeById, applyTheme } from '../../themes'
import { gravatarUrl } from '../SidebarFooter'
import { Tooltip } from '../Tooltip'
import { DialogSelect } from '../DialogSelect'
import { useProviders } from '../../hooks/useProviders'

type SettingsTab = 'profile' | 'appearance' | 'sessions' | 'providers' | 'git' | 'remote' | 'briefing' | 'general' | 'keybindings'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon /> },
  { id: 'keybindings', label: 'Keybindings', icon: <KeyboardIcon /> },
  { id: 'profile', label: 'Profile', icon: <UserIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'sessions', label: 'Sessions', icon: <TerminalIcon /> },
  { id: 'providers', label: 'Providers', icon: <BotIcon /> },
  { id: 'git', label: 'Git', icon: <GitBranchIcon /> },
  { id: 'remote', label: 'Remote', icon: <WifiIcon /> },
  { id: 'briefing', label: 'Briefing', icon: <BotIcon /> }
]

const SHORTCUTS = [
  { keys: 'Ctrl + K', action: 'Search' },
  { keys: 'Ctrl + N', action: 'New session' },
  { keys: 'Ctrl + B', action: 'Cycle sidebar (expand / collapse / hide)' },
  { keys: 'Ctrl + ,', action: 'Open settings' },
  { keys: 'Ctrl + \\', action: 'Split right' },
  { keys: 'Ctrl + Shift + \\', action: 'Split down' },
  { keys: 'Ctrl + W', action: 'Close focused panel' },
  { keys: 'Ctrl + Shift + M', action: 'Maximize focused panel' },
  { keys: 'Escape', action: 'Clear search / refocus terminal' },
  { keys: 'Alt + ↑ / ↓', action: 'Navigate sessions' },
  { keys: 'Ctrl + Shift + N', action: 'Toggle quick notes' },
  { keys: 'Ctrl + I', action: 'Dictation input overlay' },
  { keys: 'F2', action: 'Rename selected item' },
  { keys: 'Ctrl + Shift + B', action: 'Toggle briefing panel' }
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`settings-toggle ${checked ? 'settings-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="settings-toggle-dot" />
    </button>
  )
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </div>
      <div className="settings-row-control">
        {children}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="settings-section-title">{children}</h3>
}

/** Helper to load a setting with a fallback */
function useSetting(key: string, fallback: string) {
  const [value, setValue] = useState(fallback)
  useEffect(() => {
    getApi().settings.get(key).then((v: string | undefined) => {
      if (v !== undefined) setValue(v)
    })
  }, [key])
  const save = (v: string) => {
    setValue(v)
    getApi().settings.set(key, v)
  }
  return [value, save] as const
}

function ProfileTab() {
  const [displayName, setDisplayName] = useSetting('display_name', '')
  const [email, setEmail] = useSetting('gravatar_email', '')
  const [osUsername, setOsUsername] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarSource, setAvatarSource] = useState<'gravatar' | 'system' | 'initial'>('initial')
  const [systemPicture, setSystemPicture] = useState<string | null>(null)

  // Load OS username and system picture on mount
  useEffect(() => {
    getApi().system.userInfo().then((info: { username: string }) => {
      setOsUsername(info.username.charAt(0).toUpperCase() + info.username.slice(1))
    })
    getApi().system.accountPicture().then((pic: string | null) => {
      if (pic) setSystemPicture(pic)
    })
  }, [])

  // Resolve avatar preview whenever email or system picture changes
  useEffect(() => {
    if (email) {
      const url = gravatarUrl(email, 128)
      const img = new Image()
      img.onload = () => {
        setAvatarPreview(url)
        setAvatarSource('gravatar')
      }
      img.onerror = () => {
        if (systemPicture) {
          setAvatarPreview(systemPicture)
          setAvatarSource('system')
        } else {
          setAvatarPreview(null)
          setAvatarSource('initial')
        }
      }
      img.src = url
    } else if (systemPicture) {
      setAvatarPreview(systemPicture)
      setAvatarSource('system')
    } else {
      setAvatarPreview(null)
      setAvatarSource('initial')
    }
  }, [email, systemPicture])

  const resolvedName = displayName || osUsername
  const initial = resolvedName.charAt(0).toUpperCase()

  const handleSave = () => {
    // Notify SidebarFooter to re-fetch
    window.dispatchEvent(new CustomEvent('sorcerer:profile-updated'))
  }

  return (
    <>
      <SectionTitle>Avatar</SectionTitle>
      <div className="profile-avatar-section">
        <div className="profile-avatar-preview">
          {avatarPreview ? (
            <img className="profile-avatar-img" src={avatarPreview} alt={resolvedName} />
          ) : (
            <div className="profile-avatar-initial">{initial}</div>
          )}
        </div>
        <div className="profile-avatar-info">
          <span className="profile-avatar-source">
            {avatarSource === 'gravatar' && 'Loaded from Gravatar'}
            {avatarSource === 'system' && 'Windows account picture'}
            {avatarSource === 'initial' && 'Using initial (no image found)'}
          </span>
          <span className="profile-avatar-hint">
            Set an email below to use your Gravatar, or your Windows account picture will be used automatically.
          </span>
        </div>
      </div>

      <SectionTitle>Identity</SectionTitle>
      <SettingRow label="Display name" description="Shown in the sidebar footer. Leave empty to use your system username.">
        <input
          className="settings-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={handleSave}
          placeholder={osUsername}
        />
      </SettingRow>
      <SettingRow label="Email" description="Used to fetch your Gravatar profile picture.">
        <input
          className="settings-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={handleSave}
          placeholder="you@example.com"
          type="email"
        />
      </SettingRow>
    </>
  )
}

function SessionsTab() {
  const [shell, setShell] = useSetting('shell', '')
  const [fontSize, setFontSize] = useSetting('terminalFontSize', '13')
  const [branchPrefix, setBranchPrefix] = useSetting('branchPrefix', 'sorcerer/')
  const [autoArchive, setAutoArchive] = useSetting('autoArchive', 'false')
  const [idleTimeout, setIdleTimeout] = useSetting('idleTimeout', '30m')
  const [confirmDelete, setConfirmDelete] = useSetting('confirmDelete', 'true')
  const { showProviderBadges, setShowProviderBadges } = useUIStore()

  return (
    <>
      <SectionTitle>Shell</SectionTitle>
      <SettingRow label="Custom shell" description="Shell executable for new sessions (leave empty for system default)">
        <div className="settings-path-row">
          <input
            className="settings-input settings-input--path"
            value={shell}
            onChange={(e) => setShell(e.target.value)}
            placeholder="e.g. powershell.exe, /bin/zsh"
          />
          {isElectron && (
            <button
              className="settings-browse-btn"
              type="button"
              onClick={async () => {
                const result = await getApi().project.add()
                if (result) {
                  setShell(result.path)
                }
              }}
            >
              Browse
            </button>
          )}
        </div>
      </SettingRow>

      <SectionTitle>Terminal</SectionTitle>
      <SettingRow label="Font size" description="Font size for terminal text in pixels">
        <DialogSelect
          value={fontSize}
          onChange={(nextValue) => {
            setFontSize(nextValue)
            window.dispatchEvent(new CustomEvent('sorcerer:fontSizeChange', { detail: Number(nextValue) }))
          }}
          style={{ width: 88 }}
          options={[
            { value: '10', label: '10' },
            { value: '11', label: '11' },
            { value: '12', label: '12' },
            { value: '13', label: '13' },
            { value: '14', label: '14' },
            { value: '15', label: '15' },
            { value: '16', label: '16' },
            { value: '18', label: '18' },
            { value: '20', label: '20' }
          ]}
        />
      </SettingRow>

      <SectionTitle>Branch &amp; Worktrees</SectionTitle>
      <SettingRow label="Branch prefix" description="Prefix for auto-created git branches">
        <input
          className="settings-input"
          value={branchPrefix}
          onChange={(e) => setBranchPrefix(e.target.value)}
        />
      </SettingRow>

      <SectionTitle>Lifecycle</SectionTitle>
      <SettingRow label="Auto-archive idle sessions" description="Automatically archive sessions after idle timeout">
        <Toggle checked={autoArchive === 'true'} onChange={(v) => setAutoArchive(v ? 'true' : 'false')} />
      </SettingRow>
      <SettingRow label="Idle timeout" description="How long before a session is considered idle">
        <DialogSelect
          value={idleTimeout}
          onChange={setIdleTimeout}
          disabled={autoArchive !== 'true'}
          style={{ width: 128 }}
          options={[
            { value: '15m', label: '15 minutes' },
            { value: '30m', label: '30 minutes' },
            { value: '1h', label: '1 hour' },
            { value: '2h', label: '2 hours' }
          ]}
        />
      </SettingRow>
      <SettingRow label="Confirm before delete" description="Show confirmation dialog when deleting sessions">
        <Toggle checked={confirmDelete === 'true'} onChange={(v) => setConfirmDelete(v ? 'true' : 'false')} />
      </SettingRow>

      <SectionTitle>Sidebar</SectionTitle>
      <SettingRow label="Show provider badges" description="Display the AI provider name next to sessions and agents using non-default providers">
        <Toggle
          checked={showProviderBadges}
          onChange={setShowProviderBadges}
        />
      </SettingRow>
    </>
  )
}

function GitTab() {
  const [defaultRemote, setDefaultRemote] = useSetting('defaultRemote', 'origin')
  const [autoPush, setAutoPush] = useSetting('autoPush', 'false')
  const [worktreeBase, setWorktreeBase] = useState('~/.sorcerer/workspaces')

  return (
    <>
      <SectionTitle>Remote</SectionTitle>
      <SettingRow label="Default remote" description="Remote to push/pull from by default">
        <input
          className="settings-input"
          value={defaultRemote}
          onChange={(e) => setDefaultRemote(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="Auto-push on create" description="Push branch to remote when creating a session">
        <Toggle checked={autoPush === 'true'} onChange={(v) => setAutoPush(v ? 'true' : 'false')} />
      </SettingRow>

      <SectionTitle>Worktrees</SectionTitle>
      <SettingRow label="Worktree base directory" description="Where git worktrees are created on disk">
        <div className="settings-path-row">
          <input
            className="settings-input settings-input--path"
            value={worktreeBase}
            onChange={(e) => setWorktreeBase(e.target.value)}
            readOnly
          />
          {isElectron && (
            <button className="settings-browse-btn" type="button" onClick={async () => {
              const result = await getApi().project.add()
              if (result) setWorktreeBase(result.path)
            }}>Browse</button>
          )}
        </div>
      </SettingRow>
    </>
  )
}

function RemoteTab() {
  const { addToast } = useToastStore()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [port, setPort] = useState('7437')
  const [bindAddress, setBindAddress] = useState('127.0.0.1')
  const [lanIp, setLanIp] = useState('127.0.0.1')
  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [copiedTarget, setCopiedTarget] = useState<'token' | 'url' | 'rc' | 'deeplink' | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const flashCopied = (target: 'token' | 'url' | 'rc') => {
    setCopiedTarget(target)
    setTimeout(() => {
      setCopiedTarget((current) => current === target ? null : current)
    }, 1500)
  }

  const fetchStatus = async () => {
    try {
      const status = await getApi().remote.status()
      setRunning(status.running)
      setPort(status.port)
      setBindAddress(status.bindAddress)
      setToken(status.token)
    } catch {
      // remote API may not be available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    getApi().system.networkIp().then(setLanIp).catch(() => {})
  }, [])

  const handleToggle = async (enable: boolean) => {
    setToggling(true)
    try {
      if (enable) {
        // Save config before enabling
        await getApi().remote.updateConfig({
          port: parseInt(port),
          bindAddress
        })
        const result = await getApi().remote.enable()
        setRunning(true)
        setToken(result.token)
      } else {
        await getApi().remote.disable()
        setRunning(false)
      }
    } catch (err: any) {
      addToast(`Failed to ${enable ? 'start' : 'stop'} remote desktop: ${err.message}`, 'error')
    } finally {
      setToggling(false)
    }
  }

  const handleRegenerate = async () => {
    try {
      const newToken = await getApi().remote.regenerateToken()
      setToken(newToken)
    } catch (err: any) {
      addToast(`Failed to regenerate token: ${err.message}`, 'error')
    }
  }

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token).then(() => {
      flashCopied('token')
    }).catch((err: any) => {
      addToast(`Failed to copy token: ${err?.message || 'Clipboard error'}`, 'error')
    })
  }

  const host = bindAddress === '0.0.0.0' ? 'localhost' : bindAddress
  const accessUrl = `http://${host}:${port}?token=${token}`
  const rcHost = bindAddress === '0.0.0.0' ? lanIp : bindAddress
  const rcUrl = `http://${rcHost}:${port}/rc?token=${token}`
  const androidDeepLink = (() => {
    const params = new URLSearchParams({
      scheme: 'http',
      host: rcHost,
      port,
      token
    })
    return `sorcerer-remote://connect?${params.toString()}`
  })()

  useEffect(() => {
    let cancelled = false
    if (!running || !token || !rcHost || !port) {
      setQrDataUrl('')
      return
    }

    import('qrcode').then((QRCode) => {
      return QRCode.toDataURL(androidDeepLink, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
        color: {
          dark: '#EDE6D8',
          light: '#0F0E0C'
        }
      })
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    }).catch(() => {
      if (!cancelled) setQrDataUrl('')
    })

    return () => {
      cancelled = true
    }
  }, [androidDeepLink, port, rcHost, running, token])

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(accessUrl).then(() => {
      flashCopied('url')
    }).catch((err: any) => {
      addToast(`Failed to copy URL: ${err?.message || 'Clipboard error'}`, 'error')
    })
  }

  if (loading) {
    return <div className="settings-row"><span className="settings-row-label">Loading...</span></div>
  }

  return (
    <>
      <SectionTitle>Server</SectionTitle>

      <SettingRow label="Enable remote desktop" description="Start an HTTP API server for full browser-based access to Sorcerer">
        <Toggle checked={running} onChange={handleToggle} />
      </SettingRow>

      {running && (
        <>
          <div className="settings-remote-preview">
            <div className="settings-remote-preview-header">
              <span className="settings-status-dot" />
              <span>Server running</span>
            </div>
            <div className="settings-remote-preview-url-row">
              <code className="settings-remote-preview-url">{`http://${host}:${port}?token=${tokenVisible ? token : '\u2022'.repeat(8)}`}</code>
              <button className="settings-copy-inline-btn" type="button" onClick={handleCopyUrl} title={copiedTarget === 'url' ? 'Copied' : 'Copy URL'}>
                {copiedTarget === 'url' ? 'Copied' : <CopyIcon style={{ width: 13, height: 13 }} />}
              </button>
            </div>
            <span className="settings-remote-preview-hint">
              Open this URL in any browser on your network for full remote desktop access to Sorcerer.
            </span>
          </div>

          <div className="settings-remote-preview" style={{ marginTop: 8 }}>
            <div className="settings-remote-preview-header">
              <SmartphoneIcon style={{ width: 14, height: 14, opacity: 0.6 }} />
              <span>Remote Control</span>
            </div>
            <div className="settings-remote-preview-url-row">
              <code className="settings-remote-preview-url">{`http://${rcHost}:${port}/rc?token=${tokenVisible ? token : '\u2022'.repeat(8)}`}</code>
              <button className="settings-copy-inline-btn" type="button" onClick={() => {
                navigator.clipboard.writeText(rcUrl).then(() => {
                  flashCopied('rc')
                }).catch((err: any) => {
                  addToast(`Failed to copy URL: ${err?.message || 'Clipboard error'}`, 'error')
                })
              }} title="Copy URL">
                {copiedTarget === 'rc' ? 'Copied' : <CopyIcon style={{ width: 13, height: 13 }} />}
              </button>
            </div>
            <span className="settings-remote-preview-hint">
              Lightweight mobile interface — check session status and send messages from your phone.
            </span>
          </div>

          <div className="settings-remote-preview" style={{ marginTop: 8 }}>
            <div className="settings-remote-preview-header">
              <SmartphoneIcon style={{ width: 14, height: 14, opacity: 0.6 }} />
              <span>Android Pairing</span>
            </div>
            <div className="settings-remote-qr-block">
              {qrDataUrl ? (
                <img className="settings-remote-qr" src={qrDataUrl} alt="Scan to pair Sorcerer Remote on Android" />
              ) : (
                <div className="settings-remote-qr settings-remote-qr--placeholder">QR unavailable</div>
              )}
              <div className="settings-remote-qr-meta">
                <div className="settings-remote-preview-url-row">
                  <code className="settings-remote-preview-url">{`sorcerer-remote://connect?host=${rcHost}&port=${port}&token=${tokenVisible ? token : '\u2022'.repeat(8)}`}</code>
                  <button className="settings-copy-inline-btn" type="button" onClick={() => {
                    navigator.clipboard.writeText(androidDeepLink).then(() => {
                      flashCopied('deeplink')
                    }).catch((err: any) => {
                      addToast(`Failed to copy Android link: ${err?.message || 'Clipboard error'}`, 'error')
                    })
                  }} title="Copy Android deep link">
                    {copiedTarget === 'deeplink' ? 'Copied' : <CopyIcon style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
                <span className="settings-remote-preview-hint">
                  Scan this with your phone camera after installing the Android app to open Sorcerer Remote with host, port, and token prefilled.
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      <SectionTitle>Configuration</SectionTitle>
      <SettingRow label="Port" description="Port the API server listens on">
        <input
          className="settings-input"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={() => getApi().remote.updateConfig({ port: parseInt(port) })}
          disabled={running}
          type="number"
          min={1024}
          max={65535}
          style={{ width: 100 }}
        />
      </SettingRow>
      <SettingRow label="Bind address" description="Network interface to listen on (127.0.0.1 = local only, 0.0.0.0 = all)">
        <DialogSelect
          value={bindAddress}
          onChange={(nextValue) => {
            setBindAddress(nextValue)
            getApi().remote.updateConfig({ bindAddress: nextValue })
          }}
          disabled={running}
          style={{ width: 200 }}
          options={[
            { value: '127.0.0.1', label: '127.0.0.1 (localhost only)' },
            { value: '0.0.0.0', label: '0.0.0.0 (all interfaces)' }
          ]}
        />
      </SettingRow>

      <SectionTitle>Authentication</SectionTitle>
      <SettingRow label="Auth token" description="Bearer token required for all API requests">
        <div className="settings-path-row">
          <input
            className="settings-input settings-input--path"
            value={tokenVisible ? token : (token ? '\u2022'.repeat(24) : '(none)')}
            readOnly
            style={{ fontFamily: tokenVisible ? 'monospace' : 'inherit' }}
          />
          <button
            className="settings-browse-btn"
            type="button"
            onClick={() => setTokenVisible(!tokenVisible)}
            title={tokenVisible ? 'Hide token' : 'Show token'}
          >
            {tokenVisible ? <EyeOffIcon style={{ width: 14, height: 14 }} /> : <EyeIcon style={{ width: 14, height: 14 }} />}
          </button>
          <button
            className="settings-browse-btn"
            type="button"
            onClick={handleCopyToken}
            title="Copy token"
          >
            {copiedTarget === 'token' ? 'Copied' : <CopyIcon style={{ width: 14, height: 14 }} />}
          </button>
          <button
            className="settings-browse-btn"
            type="button"
            onClick={handleRegenerate}
            title="Regenerate token"
          >
            <RefreshIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </SettingRow>
    </>
  )
}

function useUpdateCheck() {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null)
  useEffect(() => {
    getApi().system.checkUpdate?.()?.then((u: any) => setUpdate(u)).catch(() => {})
  }, [])
  return update
}

function GeneralTab() {
  const [checkUpdates, setCheckUpdates] = useSetting('checkForUpdates', 'true')
  const update = useUpdateCheck()

  return (
    <>
      <SectionTitle>Updates</SectionTitle>
      <SettingRow label="Version" description="Sorcerer">
        <span className="settings-version">{__APP_VERSION__}</span>
      </SettingRow>
      <SettingRow label="Check for updates" description="Periodically check GitHub for new releases">
        <Toggle checked={checkUpdates !== 'false'} onChange={(v) => setCheckUpdates(v ? 'true' : 'false')} />
      </SettingRow>
      {update && (
        <SettingRow label="Update available" description={`Version ${update.version} is available`}>
          <button
            className="settings-action-btn"
            type="button"
            onClick={() => window.open(update.url, '_blank')}
          >
            Download
          </button>
        </SettingRow>
      )}

      <SectionTitle>Data</SectionTitle>
      <SettingRow label="Reset sidebar layout" description="Restore default sidebar width, agent/projects split, and expanded state">
        <button
          className="settings-action-btn"
          type="button"
          onClick={() => {
            localStorage.removeItem('sorcerer-ui-store')
          }}
        >
          Reset
        </button>
      </SettingRow>
      <SettingRow label="Reset dismissed workspaces" description="Re-show orphaned workspace and agent banners you previously dismissed">
        <button
          className="settings-action-btn"
          type="button"
          onClick={async () => {
            await Promise.all([
              getApi().settings.set('dismissedWorkspaces', '[]'),
              getApi().settings.set('dismissedAgents', '[]')
            ])
          }}
        >
          Reset
        </button>
      </SettingRow>
      <SettingRow label="Clear all data" description="Remove all projects, sessions, and settings">
        <button
          className="settings-action-btn settings-action-btn--danger"
          type="button"
          onClick={() => {
            localStorage.clear()
          }}
        >
          Clear Data
        </button>
      </SettingRow>

    </>
  )
}

function ProvidersTab() {
  const { addToast } = useToastStore()
  const { providers, detectedProviders, defaultProvider, loading, reload, refresh } = useProviders()
  const [refreshing, setRefreshing] = useState(false)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (providers.length === 0) return
    setModelDrafts((current) => {
      const next = { ...current }
      for (const provider of providers) {
        next[provider.id] = current[provider.id] ?? provider.defaultModel
      }
      return next
    })
  }, [providers])

  const refreshRegistry = async () => {
    setRefreshing(true)
    try {
      await refresh()
      window.dispatchEvent(new CustomEvent('sorcerer:providers-updated'))
    } catch (err: any) {
      addToast(`Failed to refresh providers: ${err?.message || 'Unknown error'}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const setDefaultProvider = async (providerId: string) => {
    try {
      await getApi().settings.set('defaultProvider', providerId)
      await reload()
      window.dispatchEvent(new CustomEvent('sorcerer:providers-updated'))
    } catch (err: any) {
      addToast(`Failed to save default provider: ${err?.message || 'Unknown error'}`, 'error')
    }
  }

  const saveDefaultModel = async (providerId: string) => {
    try {
      await getApi().settings.set(`defaultModel.${providerId}`, modelDrafts[providerId] || '')
      await reload()
      window.dispatchEvent(new CustomEvent('sorcerer:providers-updated'))
    } catch (err: any) {
      addToast(`Failed to save default model: ${err?.message || 'Unknown error'}`, 'error')
    }
  }

  const lastCheckedAt = providers.reduce((latest, provider) => Math.max(latest, provider.lastCheckedAt || 0), 0)
  const lastCheckedLabel = lastCheckedAt
    ? new Date(lastCheckedAt * 1000).toLocaleString()
    : 'Not checked yet'

  if (loading && providers.length === 0) {
    return <div className="settings-row"><span className="settings-row-label">Loading...</span></div>
  }

  return (
    <>
      <SectionTitle>Defaults</SectionTitle>
      <SettingRow label="Default provider" description="Pre-selected when creating new sessions and agents">
        <DialogSelect
          value={defaultProvider?.id || ''}
          onChange={setDefaultProvider}
          disabled={detectedProviders.length === 0}
          style={{ width: 180 }}
          options={detectedProviders.map((provider) => ({
            value: provider.id,
            label: provider.name
          }))}
        />
      </SettingRow>
      <SettingRow label="Refresh registry" description={`Startup scan only. Last checked ${lastCheckedLabel}.`}>
        <button
          className="settings-action-btn"
          type="button"
          onClick={refreshRegistry}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </SettingRow>

      <SectionTitle>Supported Providers</SectionTitle>
      <div className="providers-list">
        {providers.map((provider) => {
          const disabled = !provider.detected
          const hasSuggestedModels = provider.models.length > 0
          const currentModel = modelDrafts[provider.id] ?? provider.defaultModel
          const isCustomModel = !!currentModel && !provider.models.includes(currentModel)
          const statusBadge = disabled ? (
            <Tooltip label="Not detected on this system">
              <span className="provider-status-badge provider-status-badge--missing">Missing</span>
            </Tooltip>
          ) : (
            <span className="provider-status-badge">Detected</span>
          )

          return (
            <div key={provider.id} className={`provider-card ${disabled ? 'provider-card--disabled' : ''}`}>
              <div className="provider-card-header">
                <div className="provider-card-title-row">
                  <span className="provider-card-title">{provider.name}</span>
                  {statusBadge}
                  {provider.isDefault && (
                    <span className="provider-status-badge provider-status-badge--default">Default</span>
                  )}
                </div>
                <div className="provider-card-meta">
                  {provider.binaryPath || 'CLI not found'}
                  {provider.apiKeyEnv ? ` • ${provider.apiKeyEnv}` : ''}
                  {provider.usesFallbackModels ? ' • bundled model suggestions' : ' • detected model suggestions'}
                </div>
              </div>

              <div className="provider-capability-row">
                <span className="provider-capability-badge">Model {provider.supportsModelOverride ? 'override' : 'fixed'}</span>
                {provider.supportsRemoteControl && <span className="provider-capability-badge">Remote control</span>}
                {provider.supportsSystemPrompt && <span className="provider-capability-badge">System prompt</span>}
                {provider.supportsMcpConfig && <span className="provider-capability-badge">MCP config</span>}
              </div>

              <div className="provider-card-controls">
                <div className="provider-card-control-group">
                  <span className="provider-card-control-label">Default model</span>
                  {provider.supportsModelOverride ? (
                    hasSuggestedModels ? (
                      <>
                        <DialogSelect
                          value={isCustomModel ? '__custom__' : currentModel}
                          onChange={(nextValue) => {
                            if (nextValue === '__custom__') {
                              if (!isCustomModel) {
                                setModelDrafts((current) => ({ ...current, [provider.id]: '' }))
                              }
                              return
                            }
                            setModelDrafts((current) => ({ ...current, [provider.id]: nextValue }))
                            setTimeout(() => saveDefaultModel(provider.id), 0)
                          }}
                          disabled={disabled}
                          style={{ width: 240 }}
                          options={[
                            ...provider.models.map((model) => ({ value: model, label: model })),
                            { value: '__custom__', label: 'Custom…' }
                          ]}
                        />
                        {(isCustomModel || currentModel === '') && (
                          <input
                            className="settings-input provider-model-input"
                            value={currentModel}
                            onChange={(e) => setModelDrafts((current) => ({ ...current, [provider.id]: e.target.value }))}
                            onBlur={() => saveDefaultModel(provider.id)}
                            disabled={disabled}
                            placeholder="Enter custom model"
                          />
                        )}
                      </>
                    ) : (
                      <input
                        className="settings-input provider-model-input"
                        value={currentModel}
                        onChange={(e) => setModelDrafts((current) => ({ ...current, [provider.id]: e.target.value }))}
                        onBlur={() => saveDefaultModel(provider.id)}
                        disabled={disabled}
                        placeholder="Enter model"
                      />
                    )
                  ) : (
                    <span className="settings-row-desc">This provider does not expose model override via CLI.</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function KeybindingsTab() {
  return (
    <>
      <SectionTitle>Keyboard Shortcuts</SectionTitle>
      <div className="settings-shortcuts">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="settings-shortcut-row">
            <kbd className="settings-kbd">{s.keys}</kbd>
            <span className="settings-shortcut-action">{s.action}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function AppearanceTab() {
  const [themeId, setThemeId] = useSetting('theme', 'default')
  const [particlesEnabled, setParticlesEnabled] = useSetting('particlesEnabled', 'true')
  const [particleIntensity, setParticleIntensity] = useSetting('particleIntensity', '0.5')
  const themes = Object.values(THEMES)

  const selectTheme = (id: string) => {
    setThemeId(id)
    applyTheme(getThemeById(id))
  }

  const notifyParticles = () => window.dispatchEvent(new CustomEvent('sorcerer:settings-updated'))

  return (
    <>
      <SectionTitle>Theme</SectionTitle>
      <div className="theme-selector">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-option ${themeId === theme.id ? 'theme-option--active' : ''}`}
            onClick={() => selectTheme(theme.id)}
            type="button"
          >
            <div className="theme-option-swatches">
              <span className="theme-option-swatch" style={{ background: theme.colors['bg-root'] }} title="Background" />
              <span className="theme-option-swatch" style={{ background: theme.colors['bg-sidebar'] }} title="Sidebar" />
              <span className="theme-option-swatch" style={{ background: theme.colors['accent'] }} title="Accent" />
              <span className="theme-option-swatch" style={{ background: theme.colors['text-primary'] }} title="Text" />
            </div>
            <div className="theme-option-info">
              <span className="theme-option-name">{theme.name}</span>
            </div>
          </button>
        ))}
      </div>

      <SectionTitle>Particles</SectionTitle>
      <SettingRow label="Particle animation" description="Show rising particle effect in the titlebar and empty panels">
        <Toggle checked={particlesEnabled !== 'false'} onChange={(v) => { setParticlesEnabled(v ? 'true' : 'false'); notifyParticles() }} />
      </SettingRow>
      {particlesEnabled !== 'false' && (
        <SettingRow label="Titlebar intensity" description="Brightness of particles in the titlebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={particleIntensity}
              onChange={(e) => { setParticleIntensity(e.target.value); notifyParticles() }}
              style={{ width: 120, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', minWidth: 32 }}>{Math.round(parseFloat(particleIntensity) * 100)}%</span>
          </div>
        </SettingRow>
      )}
    </>
  )
}

const AI_PROVIDER_OPTIONS = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI (GPT)' },
  { id: 'google', name: 'Google (Gemini)' }
]

function BriefingTab() {
  const [provider, setProvider] = useSetting('briefingProvider', 'anthropic')
  const [anthropicKey, setAnthropicKey] = useSetting('apiKey_anthropic', '')
  const [openaiKey, setOpenaiKey] = useSetting('apiKey_openai', '')
  const [googleKey, setGoogleKey] = useSetting('apiKey_google', '')
  const [autoLoadOnStartup, setAutoLoadOnStartup] = useSetting('briefingAutoStartup', 'false')
  const [autoLoadOnIdle, setAutoLoadOnIdle] = useSetting('briefingAutoIdle', 'false')
  const [idleMinutes, setIdleMinutes] = useSetting('briefingIdleMinutes', '15')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const keyFields = [
    { id: 'anthropic', label: 'Anthropic API Key', value: anthropicKey, save: setAnthropicKey, placeholder: 'sk-ant-...' },
    { id: 'openai', label: 'OpenAI API Key', value: openaiKey, save: setOpenaiKey, placeholder: 'sk-...' },
    { id: 'google', label: 'Google AI API Key', value: googleKey, save: setGoogleKey, placeholder: 'AIza...' }
  ]

  return (
    <>
      <SectionTitle>AI Provider</SectionTitle>
      <SettingRow label="Preferred provider" description="Which AI to use for generating briefings">
        <DialogSelect
          value={provider}
          onChange={setProvider}
          style={{ width: 200 }}
          options={AI_PROVIDER_OPTIONS.map((p) => ({ value: p.id, label: p.name }))}
        />
      </SettingRow>

      <SectionTitle>API Keys</SectionTitle>
      {keyFields.map((field) => (
        <SettingRow key={field.id} label={field.label}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="dialog-input"
              type={showKeys[field.id] ? 'text' : 'password'}
              value={field.value}
              onChange={(e) => field.save(e.target.value)}
              placeholder={field.placeholder}
              style={{ width: 240, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <button
              className="settings-browse-btn"
              type="button"
              onClick={() => toggleShowKey(field.id)}
              title={showKeys[field.id] ? 'Hide' : 'Show'}
              aria-label={showKeys[field.id] ? `Hide ${field.label}` : `Show ${field.label}`}
            >
              {showKeys[field.id] ? <EyeOffIcon style={{ width: 14, height: 14 }} /> : <EyeIcon style={{ width: 14, height: 14 }} />}
            </button>
          </div>
        </SettingRow>
      ))}

      <SectionTitle>Behavior</SectionTitle>
      <SettingRow label="Show on startup" description="Auto-generate a briefing when Sorcerer launches">
        <Toggle checked={autoLoadOnStartup === 'true'} onChange={(v) => setAutoLoadOnStartup(v ? 'true' : 'false')} />
      </SettingRow>
      <SettingRow label="Show on return from idle" description="Refresh briefing when you come back after being away">
        <Toggle checked={autoLoadOnIdle === 'true'} onChange={(v) => setAutoLoadOnIdle(v ? 'true' : 'false')} />
      </SettingRow>
      {autoLoadOnIdle === 'true' && (
        <SettingRow label="Idle timeout (minutes)" description="How long before you're considered idle">
          <input
            className="dialog-input"
            type="number"
            min="1"
            max="120"
            value={idleMinutes}
            onChange={(e) => setIdleMinutes(e.target.value)}
            style={{ width: 80 }}
          />
        </SettingRow>
      )}

      <div className="dialog-hint" style={{ marginTop: 12 }}>
        Press <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3 }}>Ctrl + Shift + B</kbd> to open the briefing panel anytime.
      </div>
    </>
  )
}

const TAB_CONTENT: Record<SettingsTab, () => React.JSX.Element> = {
  profile: ProfileTab,
  appearance: AppearanceTab,
  sessions: SessionsTab,
  providers: ProvidersTab,
  git: GitTab,
  remote: RemoteTab,
  briefing: BriefingTab,
  keybindings: KeybindingsTab,
  general: GeneralTab
}

export function SettingsDialog() {
  const { activeDialog, dialogClosing, closeDialog } = useUIStore()
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const open = activeDialog === 'settings'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDialog])

  if (!open) return null

  const TabContent = TAB_CONTENT[activeTab]

  return (
    <div
      className={`dialog-overlay ${dialogClosing ? 'dialog-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) closeDialog() }}
    >
      <div className={`settings-dialog ${dialogClosing ? 'dialog--closing' : ''}`}>
        <div className="dialog-header">
          <h2 className="dialog-title">Settings</h2>
          <button className="dialog-close" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'settings-nav-item--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-nav-icon">{tab.icon}</span>
                <span className="settings-nav-label">{tab.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <TabContent />
          </div>
        </div>
      </div>
    </div>
  )
}
