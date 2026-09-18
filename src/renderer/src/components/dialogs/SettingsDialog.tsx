import React, { useState, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import type { PairedDevice, RemotePairingCode } from '../../../../preload'
import { getApi, isElectron } from '../../api/client'
import { useUIStore } from '../../stores/useUIStore'
import { useToastStore } from '../../stores/useToastStore'
import {
  TerminalIcon, GitBranchIcon, SettingsIcon, UserIcon, WifiIcon, CopyIcon, RefreshIcon, EyeIcon, EyeOffIcon, PaletteIcon, SmartphoneIcon, BotIcon, KeyboardIcon, TrashIcon
} from '../icons'
import { THEMES, getThemeById, applyTheme } from '../../themes'
import { gravatarUrl } from '../SidebarFooter'
import { Tooltip } from '../Tooltip'
import { DialogSelect } from '../DialogSelect'
import { useProviders } from '../../hooks/useProviders'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { UpdateActions, UpdateSummary } from '../Updates'

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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`settings-toggle ${checked ? 'settings-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
  const requestVersionRef = useRef(0)
  useEffect(() => {
    let cancelled = false
    const requestVersion = requestVersionRef.current
    getApi().settings.get(key).then((v: string | undefined) => {
      if (!cancelled && requestVersionRef.current === requestVersion && v !== undefined) {
        setValue(v)
      }
    })
    return () => { cancelled = true }
  }, [key])
  const save = (v: string) => {
    requestVersionRef.current += 1
    setValue(v)
    getApi().settings.set(key, v)
  }
  return [value, save] as const
}

function useDebouncedSetting(key: string, fallback: string, debounceMs = 250) {
  const [value, setValue] = useState(fallback)
  const loadedRef = useRef(false)
  const latestValueRef = useRef(fallback)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadedRef.current = false
    getApi().settings.get(key).then((v: string | undefined) => {
      if (cancelled) return
      const next = v ?? fallback
      latestValueRef.current = next
      setValue(next)
      loadedRef.current = true
    })
    return () => {
      cancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void getApi().settings.set(key, latestValueRef.current)
      }
    }
  }, [fallback, key])

  const save = (next: string) => {
    latestValueRef.current = next
    setValue(next)
    if (!loadedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void getApi().settings.set(key, latestValueRef.current)
    }, debounceMs)
  }

  return [value, save] as const
}

function ProfileTab() {
  const [displayName, setDisplayName] = useDebouncedSetting('display_name', '')
  const [email, setEmail] = useDebouncedSetting('gravatar_email', '')
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
    setAvatarPreview(null)
    setAvatarSource(systemPicture ? 'system' : 'initial')
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
  const [shell, setShell] = useDebouncedSetting('shell', '')
  const [fontSize, setFontSize] = useSetting('terminalFontSize', '13')
  const [branchPrefix, setBranchPrefix] = useDebouncedSetting('branchPrefix', 'sorcerer/')
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
                const selectedPath = await getApi().system.pickPath({
                  title: 'Select Shell Executable',
                  mode: 'file'
                })
                if (selectedPath) {
                  setShell(selectedPath)
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
        <Toggle checked={autoArchive === 'true'} onChange={(v) => setAutoArchive(v ? 'true' : 'false')} label="Auto-archive idle sessions" />
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
        <Toggle checked={confirmDelete === 'true'} onChange={(v) => setConfirmDelete(v ? 'true' : 'false')} label="Confirm before delete" />
      </SettingRow>

      <SectionTitle>Sidebar</SectionTitle>
      <SettingRow label="Show provider badges" description="Display the AI provider name next to sessions and agents using non-default providers">
        <Toggle
          checked={showProviderBadges}
          onChange={setShowProviderBadges}
          label="Show provider badges"
        />
      </SettingRow>
    </>
  )
}

function GitTab() {
  const [defaultRemote, setDefaultRemote] = useDebouncedSetting('defaultRemote', 'origin')
  const [autoPush, setAutoPush] = useSetting('autoPush', 'false')
  const [workspacesRoot, setWorkspacesRoot] = useState('')

  useEffect(() => {
    getApi().system.workspacesRoot().then(setWorkspacesRoot).catch(() => {})
  }, [])

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
        <Toggle checked={autoPush === 'true'} onChange={(v) => setAutoPush(v ? 'true' : 'false')} label="Auto-push on create" />
      </SettingRow>

      <SectionTitle>Worktrees</SectionTitle>
      <SettingRow label="Workspace root" description="Current on-disk root used for Sorcerer worktrees">
        <input
          className="settings-input settings-input--path"
          value={workspacesRoot}
          readOnly
        />
      </SettingRow>
    </>
  )
}

type RemoteCopyTarget = 'token' | 'url' | 'rc' | 'pairing' | 'pairing-code'

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return !normalized || normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || /^127(?:\.|$)/.test(normalized)
}

function hasValidHostSyntax(host: string): boolean {
  const normalized = host.trim().replace(/^\[|\]$/g, '')
  return normalized.length > 0 && normalized.length <= 253 && /^[a-zA-Z0-9._:%-]+$/.test(normalized)
}

function isValidPairingHost(host: string): boolean {
  const normalized = host.trim().replace(/^\[|\]$/g, '')
  return hasValidHostSyntax(normalized) &&
    !isLoopbackHost(normalized) && normalized !== '0.0.0.0' && normalized !== '::'
}

function formatUrlHost(host: string): string {
  const normalized = host.trim().replace(/^\[|\]$/g, '')
  return normalized.includes(':') ? `[${normalized}]` : normalized
}

function formatPairingCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDeviceTime(timestamp: number | null): string {
  if (!timestamp) return 'Never connected'
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function RemoteTab() {
  const { addToast } = useToastStore()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [port, setPort] = useState('7437')
  const [bindAddress, setBindAddress] = useState('127.0.0.1')
  const [advertisedHost, setAdvertisedHost] = useState('')
  const [networkChecked, setNetworkChecked] = useState(false)
  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [copiedTarget, setCopiedTarget] = useState<RemoteCopyTarget | null>(null)
  const [pairing, setPairing] = useState<RemotePairingCode | null>(null)
  const [pairingQr, setPairingQr] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState('')
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null)

  const flashCopied = (target: RemoteCopyTarget) => {
    setCopiedTarget(target)
    setTimeout(() => {
      setCopiedTarget((current) => current === target ? null : current)
    }, 1500)
  }

  const refreshDevices = async (showLoading = true) => {
    if (showLoading) setDevicesLoading(true)
    try {
      const nextDevices = await getApi().remote.listPairedDevices()
      setDevices(nextDevices)
      setDevicesError('')
    } catch (err: any) {
      setDevicesError(err?.message || 'Could not load paired devices.')
    } finally {
      if (showLoading) setDevicesLoading(false)
    }
  }

  const fetchStatus = async () => {
    try {
      const status = await getApi().remote.status()
      setRunning(status.running)
      setPort(status.port)
      setBindAddress(status.bindAddress)
      setAdvertisedHost((current) => status.advertisedHost || current)
      setToken(status.token)
    } catch {
      // Remote access is optional in browser-renderer builds.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
    void refreshDevices()
    getApi().system.networkIp()
      .then((ip) => {
        setAdvertisedHost((current) => current || ip)
      })
      .catch(() => {})
      .finally(() => setNetworkChecked(true))
  }, [])

  useEffect(() => {
    if (!pairing) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairing])

  useEffect(() => {
    let cancelled = false
    if (!pairing) {
      setPairingQr('')
      return
    }

    setPairingQr('')

    QRCode.toDataURL(pairing.deepLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#111111', light: '#ffffff' }
    }).then((dataUrl) => {
      if (!cancelled) setPairingQr(dataUrl)
    }).catch(() => {
      if (!cancelled) {
        setPairingQr('')
        setPairingError('The pairing code is valid, but the QR could not be rendered. Copy the pairing link instead.')
      }
    })

    return () => { cancelled = true }
  }, [pairing])

  const pairingExpired = pairing !== null && now >= pairing.expiresAt

  useEffect(() => {
    if (!pairing || pairingExpired) return
    const timer = window.setInterval(() => { void refreshDevices(false) }, 3000)
    return () => window.clearInterval(timer)
  }, [pairing?.code, pairingExpired])

  const wildcardBind = bindAddress === '0.0.0.0' || bindAddress === '::'
  const host = wildcardBind ? advertisedHost : bindAddress
  const normalizedHost = host.trim().replace(/^\[|\]$/g, '')
  const lanReachable = isValidPairingHost(host)
  const formattedHost = formatUrlHost(host || bindAddress)
  const hostDetected = hasValidHostSyntax(normalizedHost) && normalizedHost !== '0.0.0.0' && normalizedHost !== '::'
  const accessUrl = hostDetected ? `http://${formattedHost}:${port}?token=${token}` : ''
  const rcUrl = hostDetected ? `http://${formattedHost}:${port}/rc?token=${token}` : ''
  const activeDevices = devices.filter((device) => device.revokedAt === null)

  const copyText = (text: string, target: RemoteCopyTarget, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      flashCopied(target)
    }).catch((err: any) => {
      addToast(`Failed to copy ${label}: ${err?.message || 'Clipboard error'}`, 'error')
    })
  }

  const handleToggle = async (enable: boolean) => {
    if (toggling) return
    const parsedPort = parseInt(port)
    if (enable && (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535)) {
      addToast('Choose a port between 1024 and 65535.', 'error')
      return
    }

    setToggling(true)
    try {
      if (enable) {
        await getApi().remote.updateConfig({
          port: parsedPort,
          bindAddress,
          advertisedHost: wildcardBind ? advertisedHost : undefined
        })
        const result = await getApi().remote.enable()
        setRunning(true)
        setToken(result.token)
      } else {
        await getApi().remote.disable()
        setRunning(false)
        setPairing(null)
        setPairingError('')
      }
    } catch (err: any) {
      addToast(`Failed to ${enable ? 'start' : 'stop'} remote access: ${err.message}`, 'error')
    } finally {
      setToggling(false)
    }
  }

  const handleBindAddressChange = async (nextValue: string) => {
    const previousValue = bindAddress
    setBindAddress(nextValue)
    try {
      await getApi().remote.updateConfig({ bindAddress: nextValue })
    } catch (err: any) {
      setBindAddress(previousValue)
      addToast(`Failed to save bind address: ${err?.message || 'Unknown error'}`, 'error')
    }
  }

  const handlePortBlur = async () => {
    const parsedPort = parseInt(port)
    if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      addToast('Choose a port between 1024 and 65535.', 'error')
      return
    }
    try {
      await getApi().remote.updateConfig({ port: parsedPort })
    } catch (err: any) {
      addToast(`Failed to save port: ${err?.message || 'Unknown error'}`, 'error')
    }
  }

  const handleAdvertisedHostBlur = async () => {
    const normalized = advertisedHost.trim().replace(/^\[|\]$/g, '')
    if (normalized && !isValidPairingHost(normalized)) {
      addToast('Enter a valid LAN IP address or DNS name for the Android connection.', 'error')
      return
    }
    setAdvertisedHost(normalized)
    try {
      await getApi().remote.updateConfig({ advertisedHost: normalized })
    } catch (err: any) {
      addToast(`Failed to save phone address: ${err?.message || 'Unknown error'}`, 'error')
    }
  }

  const handleCreatePairing = async () => {
    if (!running || !lanReachable || pairingBusy) return
    setPairingBusy(true)
    setPairingError('')
    setPairingQr('')
    try {
      const nextPairing = await getApi().remote.createPairingCode(wildcardBind ? advertisedHost : undefined)
      setPairing(nextPairing)
      setNow(Date.now())
    } catch (err: any) {
      setPairingError(err?.message || 'Could not create a pairing code.')
    } finally {
      setPairingBusy(false)
    }
  }

  const handleRegenerate = async () => {
    if (!token) return
    if (!window.confirm('Regenerate the legacy browser token? Existing browser links will stop working immediately. Paired Android devices are not affected.')) return
    try {
      const newToken = await getApi().remote.regenerateToken()
      setToken(newToken)
      addToast('Legacy browser token regenerated.', 'success')
    } catch (err: any) {
      addToast(`Failed to regenerate token: ${err.message}`, 'error')
    }
  }

  const handleRevokeDevice = async (device: PairedDevice) => {
    if (!window.confirm(`Revoke access for ${device.name || 'this Android device'}?`)) return
    setRevokingDeviceId(device.id)
    try {
      const revoked = await getApi().remote.revokePairedDevice(device.id)
      if (!revoked) throw new Error('The device was already revoked or no longer exists.')
      await refreshDevices(false)
      addToast(`${device.name || 'Android device'} revoked.`, 'success')
    } catch (err: any) {
      addToast(`Failed to revoke device: ${err?.message || 'Unknown error'}`, 'error')
    } finally {
      setRevokingDeviceId(null)
    }
  }

  if (loading) {
    return <div className="settings-row"><span className="settings-row-label">Loading...</span></div>
  }

  return (
    <>
      <SectionTitle>Server</SectionTitle>

      <SettingRow
        label="Enable remote access"
        description={toggling ? 'Applying server changes…' : 'Allow trusted browsers and paired Android devices to connect'}
      >
        <Toggle checked={running} onChange={handleToggle} label="Enable remote access" />
      </SettingRow>

      {running && (
        <>
          <div className="settings-remote-preview">
            <div className="settings-remote-preview-header">
              <span className="settings-status-dot" />
              <span>Server running on {formattedHost}:{port}</span>
            </div>
            <div className="settings-remote-preview-url-row">
              <code className="settings-remote-preview-url">{`http://${formattedHost}:${port}?token=${tokenVisible ? token : '\u2022'.repeat(8)}`}</code>
              <button className="settings-copy-inline-btn" type="button" disabled={!accessUrl} onClick={() => accessUrl && copyText(accessUrl, 'url', 'browser URL')} title={accessUrl ? 'Copy browser URL' : 'No reachable network address detected'}>
                {copiedTarget === 'url' ? 'Copied' : <CopyIcon style={{ width: 13, height: 13 }} />}
              </button>
            </div>
            <span className="settings-remote-preview-hint">
              Full browser interface. Use only on a trusted private network or encrypted VPN.
            </span>
          </div>

          <div className="settings-remote-preview">
            <div className="settings-remote-preview-header">
              <SmartphoneIcon style={{ width: 14, height: 14, opacity: 0.7 }} />
              <span>Lightweight browser remote</span>
            </div>
            <div className="settings-remote-preview-url-row">
              <code className="settings-remote-preview-url">{`http://${formattedHost}:${port}/rc?token=${tokenVisible ? token : '\u2022'.repeat(8)}`}</code>
              <button className="settings-copy-inline-btn" type="button" disabled={!rcUrl} onClick={() => rcUrl && copyText(rcUrl, 'rc', 'remote URL')} title={rcUrl ? 'Copy remote URL' : 'No reachable network address detected'}>
                {copiedTarget === 'rc' ? 'Copied' : <CopyIcon style={{ width: 13, height: 13 }} />}
              </button>
            </div>
            <span className="settings-remote-preview-hint">
              Legacy browser link for session status and terminal interaction. Android pairing below never uses this token.
            </span>
          </div>
        </>
      )}

      <SectionTitle>Network</SectionTitle>
      <SettingRow label="Port" description="Port the remote server listens on">
        <input
          className="settings-input"
          value={port}
          onChange={(event) => setPort(event.target.value)}
          onBlur={() => { void handlePortBlur() }}
          disabled={running}
          type="number"
          min={1024}
          max={65535}
          style={{ width: 100 }}
        />
      </SettingRow>
      <SettingRow label="Reachability" description="Android requires Private network; This computer only blocks other devices">
        <DialogSelect
          value={bindAddress}
          onChange={(nextValue) => { void handleBindAddressChange(nextValue) }}
          disabled={running}
          style={{ width: 230 }}
          options={[
            { value: '127.0.0.1', label: 'This computer only (127.0.0.1)' },
            { value: '0.0.0.0', label: 'Private network (0.0.0.0)' }
          ]}
        />
      </SettingRow>

      {wildcardBind && (
        <SettingRow label="Phone address" description="Address encoded in pairing links; change it if a VPN or virtual adapter was detected">
          <input
            className="settings-input"
            value={advertisedHost}
            onChange={(event) => {
              setAdvertisedHost(event.target.value)
              setPairing(null)
              setPairingError('')
            }}
            onBlur={() => { void handleAdvertisedHostBlur() }}
            placeholder="192.168.1.20 or host name"
            spellCheck={false}
            style={{ width: 230 }}
          />
        </SettingRow>
      )}

      {!lanReachable && (
        <div className="settings-remote-notice settings-remote-notice--warning">
          <strong>{running ? 'Android cannot reach this server yet' : 'Android pairing needs a private-network address'}</strong>
          <span>
            {running
              ? 'Turn off remote access, choose Private network above, then start it again.'
              : networkChecked && wildcardBind
                ? 'Connect this computer to your LAN or VPN, then refresh Settings before pairing.'
                : 'Choose Private network above, then start remote access. Pairing links are never created for 127.0.0.1.'}
          </span>
        </div>
      )}

      {lanReachable && (
        <div className="settings-remote-notice settings-remote-notice--info">
          <strong>Android address</strong>
          <code>{`http://${formattedHost}:${port}`}</code>
          <span>HTTP pairing is unencrypted. Use only a trusted LAN or encrypted VPN—never shared or public Wi-Fi.</span>
        </div>
      )}

      <SectionTitle>Android companion</SectionTitle>

      {running && lanReachable ? (
        <div className="settings-pairing-card">
          <div className="settings-pairing-heading">
            <div>
              <span className="settings-pairing-title">Pair a device</span>
              <span className="settings-remote-preview-hint">Codes work once and expire after two minutes.</span>
            </div>
            <button className="settings-pairing-primary" type="button" onClick={() => { void handleCreatePairing() }} disabled={pairingBusy}>
              <RefreshIcon style={{ width: 14, height: 14 }} />
              {pairingBusy ? 'Creating…' : pairing ? 'Refresh code' : 'Create pairing code'}
            </button>
          </div>

          {pairingError && <div className="settings-pairing-error">{pairingError}</div>}

          {pairing ? (
            <div className={`settings-pairing-content ${pairingExpired ? 'settings-pairing-content--expired' : ''}`}>
              <div className="settings-pairing-qr-wrap">
                {pairingQr ? (
                  <img className="settings-pairing-qr" src={pairingQr} alt="Scan to pair Sorcerer Remote" />
                ) : (
                  <div className="settings-pairing-qr settings-pairing-qr--placeholder">QR unavailable</div>
                )}
                {pairingExpired && <span className="settings-pairing-expired-label">Expired</span>}
              </div>
              <div className="settings-pairing-details">
                <div className="settings-pairing-status">
                  <span className={`settings-status-dot ${pairingExpired ? 'settings-status-dot--expired' : ''}`} />
                  <strong>{pairingExpired ? 'Pairing code expired' : `Expires in ${formatPairingCountdown(pairing.expiresAt - now)}`}</strong>
                </div>
                <div className="settings-pairing-code-row">
                  <span>One-time code</span>
                  <code>{pairing.code}</code>
                </div>
                <div className="settings-pairing-actions">
                  <button
                    className="settings-browse-btn"
                    type="button"
                    disabled={pairingExpired}
                    onClick={() => copyText(pairing.code, 'pairing-code', 'one-time code')}
                  >
                    <CopyIcon style={{ width: 14, height: 14 }} />
                    {copiedTarget === 'pairing-code' ? 'Copied code' : 'Copy code'}
                  </button>
                  <button
                    className="settings-browse-btn"
                    type="button"
                    disabled={pairingExpired}
                    onClick={() => copyText(pairing.deepLink, 'pairing', 'pairing link')}
                  >
                    <CopyIcon style={{ width: 14, height: 14 }} />
                    {copiedTarget === 'pairing' ? 'Copied' : 'Copy pairing link'}
                  </button>
                  {pairingExpired && (
                    <button className="settings-browse-btn" type="button" onClick={() => { void handleCreatePairing() }} disabled={pairingBusy}>
                      <RefreshIcon style={{ width: 14, height: 14 }} />
                      New code
                    </button>
                  )}
                </div>
                <span className="settings-remote-preview-hint">
                  The QR contains this address and one-time code only—never your permanent browser token.
                </span>
              </div>
            </div>
          ) : (
            <div className="settings-pairing-empty">
              <SmartphoneIcon style={{ width: 22, height: 22 }} />
              <span>Create a code, then scan it from Sorcerer Remote on Android.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="settings-pairing-empty settings-pairing-empty--blocked">
          <SmartphoneIcon style={{ width: 22, height: 22 }} />
          <span>{running ? 'Make the server reachable on your private network to pair Android.' : 'Configure a private-network address and start remote access to pair Android.'}</span>
        </div>
      )}

      <div className="settings-section-heading-row">
        <SectionTitle>Paired devices</SectionTitle>
        <button className="settings-copy-inline-btn" type="button" onClick={() => { void refreshDevices() }} title="Refresh paired devices">
          <RefreshIcon style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {devicesLoading ? (
        <div className="settings-device-empty">Loading paired devices…</div>
      ) : devicesError ? (
        <div className="settings-pairing-error">{devicesError}</div>
      ) : activeDevices.length === 0 ? (
        <div className="settings-device-empty">No Android devices are paired yet.</div>
      ) : (
        <div className="settings-device-list">
          {activeDevices.map((device) => (
            <div className="settings-device-row" key={device.id}>
              <div className="settings-device-icon"><SmartphoneIcon /></div>
              <div className="settings-device-info">
                <span className="settings-device-name">{device.name || 'Android device'}</span>
                <span className="settings-device-meta">
                  {device.lastSeenAt ? `Last connected ${formatDeviceTime(device.lastSeenAt)}` : `Paired ${formatDeviceTime(device.createdAt)}`}
                </span>
              </div>
              <button
                className="settings-device-revoke"
                type="button"
                onClick={() => { void handleRevokeDevice(device) }}
                disabled={revokingDeviceId === device.id}
                title={`Revoke ${device.name || 'Android device'}`}
              >
                <TrashIcon style={{ width: 14, height: 14 }} />
                {revokingDeviceId === device.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}

      <SectionTitle>Legacy browser authentication</SectionTitle>
      <SettingRow label="Browser token" description="Bearer token used by the two browser URLs above; Android devices use separate revocable credentials">
        <div className="settings-path-row">
          <input
            className="settings-input settings-input--path"
            value={tokenVisible ? token : (token ? '\u2022'.repeat(24) : '(created when enabled)')}
            readOnly
            style={{ fontFamily: tokenVisible ? 'monospace' : 'inherit' }}
          />
          <button className="settings-browse-btn" type="button" onClick={() => setTokenVisible(!tokenVisible)} disabled={!token} title={tokenVisible ? 'Hide token' : 'Show token'}>
            {tokenVisible ? <EyeOffIcon style={{ width: 14, height: 14 }} /> : <EyeIcon style={{ width: 14, height: 14 }} />}
          </button>
          <button className="settings-browse-btn" type="button" onClick={() => copyText(token, 'token', 'token')} disabled={!token} title="Copy token">
            {copiedTarget === 'token' ? 'Copied' : <CopyIcon style={{ width: 14, height: 14 }} />}
          </button>
          <button className="settings-browse-btn" type="button" onClick={() => { void handleRegenerate() }} disabled={!token} title="Regenerate token">
            <RefreshIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </SettingRow>
    </>
  )
}

function GeneralTab() {
  const [checkUpdates, setCheckUpdates] = useSetting('checkForUpdates', 'true')
  const [autoDownload, setAutoDownload] = useSetting('autoDownloadUpdates', 'true')
  const { showFeedbackIcon, setShowFeedbackIcon, resetSidebarLayout } = useUIStore()

  return (
    <>
      <SectionTitle>Updates</SectionTitle>
      <SettingRow label="Version" description="Sorcerer">
        <span className="settings-version">{__APP_VERSION__}</span>
      </SettingRow>
      {isElectron ? <>
      <SettingRow label="Check for updates" description="Check at startup and every two hours">
        <Toggle checked={checkUpdates !== 'false'} onChange={(v) => setCheckUpdates(v ? 'true' : 'false')} label="Check for updates" />
      </SettingRow>
      <SettingRow label="Download updates automatically" description="With update checks enabled, download in the background where supported. A notice beside your profile lets you choose when to restart and install.">
        <Toggle checked={autoDownload !== 'false'} onChange={(v) => setAutoDownload(v ? 'true' : 'false')} label="Download updates automatically" />
      </SettingRow>
      <div className="settings-update-panel">
        <UpdateSummary />
        <div className="update-actions"><UpdateActions /></div>
      </div>
      </> : <p className="update-caption">Manage desktop updates from Sorcerer on your computer.</p>}

      <SectionTitle>Interface</SectionTitle>
      <SettingRow label="Show feedback button" description="Display the Give feedback shortcut in the sidebar footer">
        <Toggle
          checked={showFeedbackIcon}
          onChange={setShowFeedbackIcon}
          label="Show feedback button"
        />
      </SettingRow>

      <SectionTitle>Data</SectionTitle>
      <SettingRow label="Reset sidebar layout" description="Restore default sidebar width, agent/projects split, and expanded state">
        <button
          className="settings-action-btn"
          type="button"
          onClick={() => {
            resetSidebarLayout()
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
      <SettingRow label="Clear local UI state" description="Clear locally stored UI preferences and cached window state">
        <button
          className="settings-action-btn settings-action-btn--danger"
          type="button"
          onClick={() => {
            localStorage.removeItem('sorcerer-ui-store')
            localStorage.removeItem('sorcerer-stats-pinned')
          }}
        >
          Clear UI State
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
        <Toggle checked={particlesEnabled !== 'false'} onChange={(v) => { setParticlesEnabled(v ? 'true' : 'false'); notifyParticles() }} label="Particle animation" />
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
  const [anthropicKey, setAnthropicKey] = useDebouncedSetting('apiKey_anthropic', '')
  const [openaiKey, setOpenaiKey] = useDebouncedSetting('apiKey_openai', '')
  const [googleKey, setGoogleKey] = useDebouncedSetting('apiKey_google', '')
  const [autoLoadOnStartup, setAutoLoadOnStartup] = useSetting('briefingAutoStartup', 'false')
  const [autoLoadOnIdle, setAutoLoadOnIdle] = useSetting('briefingAutoIdle', 'false')
  const [idleMinutes, setIdleMinutes] = useDebouncedSetting('briefingIdleMinutes', '15')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  const notifyBriefingSettingsUpdated = () => {
    window.dispatchEvent(new CustomEvent('sorcerer:briefing-settings-updated'))
  }

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
          onChange={(nextValue) => {
            setProvider(nextValue)
            notifyBriefingSettingsUpdated()
          }}
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
              onChange={(e) => {
                field.save(e.target.value)
                notifyBriefingSettingsUpdated()
              }}
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
        <Toggle checked={autoLoadOnStartup === 'true'} onChange={(v) => {
          setAutoLoadOnStartup(v ? 'true' : 'false')
          notifyBriefingSettingsUpdated()
        }} label="Show on startup" />
      </SettingRow>
      <SettingRow label="Show on return from idle" description="Refresh briefing when you come back after being away">
        <Toggle checked={autoLoadOnIdle === 'true'} onChange={(v) => {
          setAutoLoadOnIdle(v ? 'true' : 'false')
          notifyBriefingSettingsUpdated()
        }} label="Show on return from idle" />
      </SettingRow>
      {autoLoadOnIdle === 'true' && (
        <SettingRow label="Idle timeout (minutes)" description="How long before you're considered idle">
          <input
            className="dialog-input"
            type="number"
            min="1"
            max="120"
            value={idleMinutes}
            onChange={(e) => {
              setIdleMinutes(e.target.value)
              notifyBriefingSettingsUpdated()
            }}
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
  const dialogRef = useDialogFocus(open, closeDialog)

  if (!open) return null

  const effectiveTab = !isElectron && activeTab === 'remote' ? 'general' : activeTab
  const TabContent = TAB_CONTENT[effectiveTab]
  const visibleTabs = isElectron ? TABS : TABS.filter((tab) => tab.id !== 'remote')

  return (
    <div
      className={`dialog-overlay ${dialogClosing ? 'dialog-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) closeDialog() }}
    >
      <div id="settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" tabIndex={-1} className={`settings-dialog ${dialogClosing ? 'dialog--closing' : ''}`}>
        <div className="dialog-header">
          <h2 id="settings-dialog-title" className="dialog-title">Settings</h2>
          <button className="dialog-close" onClick={closeDialog} aria-label="Close settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-nav-item ${effectiveTab === tab.id ? 'settings-nav-item--active' : ''}`}
                aria-current={effectiveTab === tab.id ? 'page' : undefined}
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
