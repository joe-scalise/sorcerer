import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import type { UpdateState } from '../../shared/update'

const REPOSITORY = 'joe-scalise/sorcerer'
const RELEASE_BASE = `https://github.com/${REPOSITORY}/releases`
const CHECK_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000

interface UpdateInfo {
  version: string
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null
}

/** Small adapter surface keeps the platform updater replaceable in tests. */
export interface ManagedUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<{ updateInfo: UpdateInfo; isUpdateAvailable: boolean } | null>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface UpdateServiceOptions {
  getSetting(key: string): string | undefined
  currentVersion?: string
  packaged?: boolean
  platform?: NodeJS.Platform
  arch?: string
  appImage?: string
  updater?: ManagedUpdater
  fetch?: typeof fetch
  broadcast?: (state: UpdateState) => void
  confirmInstall?: () => Promise<boolean>
  now?: () => number
}

function parseStableVersion(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return undefined
  const parts = value.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : undefined
}

function newerThan(version: string, current: string): boolean {
  const candidate = parseStableVersion(version)
  const installed = parseStableVersion(current)
  if (!candidate || !installed) throw new Error('The update contains an invalid stable version.')
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] !== installed[index]) return candidate[index] > installed[index]
  }
  return false
}

function normalizeNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes.slice(0, 100_000)
  if (Array.isArray(notes)) return notes.map((entry) => typeof entry.note === 'string' ? entry.note : '').join('\n\n').slice(0, 100_000)
  return undefined
}

function updateErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return 'The latest published release does not include automatic-update files yet. Please check again after the next desktop release is published.'
  }
  if (code === 'ERR_CHECKSUM_MISMATCH') {
    return 'The downloaded update failed its integrity check. Please retry the download.'
  }
  const message = error instanceof Error ? error.message : ''
  if (/net::ERR_|ENOTFOUND|ECONNRESET|ETIMEDOUT/.test(message)) {
    return 'Could not connect to the update server. Check your connection and try again.'
  }
  // Updater errors can embed HTTP headers, stack traces, and misleading token
  // advice inside Error.message. Keep those diagnostics out of the product UI.
  if (!message || message.length > 240 || /[\r\n]|Headers:|HttpError:/.test(message)) {
    return 'The update request failed. Please try again later.'
  }
  return message
}

/** Only the application renderer's top-level frame may control installation. */
export function isTrustedUpdateSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  options: { packaged?: boolean; rendererPath?: string; devUrl?: string } = {}
): boolean {
  if (!event.senderFrame || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return false
  if (!BrowserWindow.fromWebContents(event.sender)) return false
  try {
    const actual = new URL(event.senderFrame.url)
    const devUrl = options.devUrl ?? process.env.ELECTRON_RENDERER_URL
    const expected = new URL(!(options.packaged ?? app.isPackaged) && devUrl
      ? devUrl
      : pathToFileURL(options.rendererPath ?? path.join(__dirname, '../renderer/index.html')).href)
    // Popouts use search/hash parameters on the same renderer document.
    actual.search = expected.search = ''
    actual.hash = expected.hash = ''
    return actual.href === expected.href
  } catch {
    return false
  }
}

export class UpdateService {
  private state: UpdateState
  private readonly updater?: ManagedUpdater
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly fetchRelease: typeof fetch
  private readonly now: () => number
  private checkFlight?: Promise<UpdateState>
  private downloadFlight?: Promise<UpdateState>
  private installFlight?: Promise<UpdateState>
  private startupTimer?: ReturnType<typeof setTimeout>
  private pollTimer?: ReturnType<typeof setInterval>
  private beforeInstall?: () => Promise<void> | void
  private downloaded = false
  private managedVersion?: string

  constructor(private readonly options: UpdateServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.fetchRelease = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    const managed = (options.packaged ?? app.isPackaged) && (
      this.platform === 'win32' || (this.platform === 'linux' && Boolean(options.appImage ?? process.env.APPIMAGE))
    )
    this.state = { revision: 0, status: 'idle', currentVersion: options.currentVersion ?? app.getVersion(), managed, downloaded: false, canDownload: false }
    if (managed) {
      this.updater = options.updater ?? require('electron-updater').autoUpdater as ManagedUpdater
      // Downloads are started by this service so preference changes are honored
      // even when they happen while a check is in flight.
      this.updater.autoDownload = false
      this.updater.autoInstallOnAppQuit = false
      this.updater.allowPrerelease = false
      this.updater.allowDowngrade = false
      this.updater.disableWebInstaller = true
      this.updater.on('download-progress', ({ percent }: { percent: number }) => {
        if (this.state.status === 'downloading' && Number.isFinite(percent)) {
          this.publish({ progress: Math.max(0, Math.min(100, percent)) })
        }
      })
      this.updater.on('update-downloaded', (info: UpdateInfo) => {
        if (this.state.status !== 'downloading' || info.version !== this.state.version) return
        this.downloaded = true
        this.publish({ status: 'downloaded', downloaded: true, progress: 100, error: undefined })
      })
      // electron-updater emits errors as well as rejecting promises. Register a
      // listener so failures never become unhandled EventEmitter exceptions.
      this.updater.on('error', (error: Error) => this.fail(error))
    }
  }

  getState(): UpdateState {
    return {
      ...this.state,
      canDownload: this.state.managed && !this.downloaded && Boolean(this.managedVersion) && this.managedVersion === this.state.version
    }
  }

  setBeforeInstall(callback: () => Promise<void> | void): void { this.beforeInstall = callback }

  start(): void {
    if (this.startupTimer || this.pollTimer) return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined
      void this.check({ automatic: true })
    }, 5_000)
    this.pollTimer = setInterval(() => { void this.check({ automatic: true }) }, POLL_INTERVAL_MS)
    this.startupTimer.unref?.()
    this.pollTimer.unref?.()
  }

  stop(): void {
    clearTimeout(this.startupTimer)
    clearInterval(this.pollTimer)
    this.startupTimer = undefined
    this.pollTimer = undefined
  }

  check({ automatic = false }: { automatic?: boolean } = {}): Promise<UpdateState> {
    if (this.installFlight) return this.installFlight
    if (this.downloadFlight) return this.downloadFlight
    if (this.checkFlight) return this.checkFlight
    // Keep the staged package available until the user explicitly installs it.
    if (this.downloaded || (automatic && this.options.getSetting('checkForUpdates') === 'false')) {
      return Promise.resolve(this.getState())
    }
    this.checkFlight = this.runCheck().finally(() => { this.checkFlight = undefined })
    return this.checkFlight
  }

  private async runCheck(): Promise<UpdateState> {
    this.publish({ status: 'checking', error: undefined })
    try {
      const info = this.updater ? await this.checkManaged() : await this.checkManual()
      const checkedAt = this.now()
      if (!info) {
        this.publish({ status: 'idle', version: undefined, url: undefined, releaseNotes: undefined, progress: undefined, checkedAt, error: undefined })
      } else {
        this.publish({ status: 'available', ...info, progress: undefined, checkedAt, error: undefined })
        if (this.updater && this.options.getSetting('checkForUpdates') !== 'false' && this.options.getSetting('autoDownloadUpdates') !== 'false') {
          await this.startDownload()
        }
      }
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  private async checkManaged(): Promise<Pick<UpdateState, 'version' | 'url' | 'releaseNotes'> | undefined> {
    this.managedVersion = undefined
    const result = await this.updater!.checkForUpdates()
    if (!result) throw new Error('The update server did not return update information.')
    const info = result.updateInfo
    if (!newerThan(info.version, this.state.currentVersion) || !result.isUpdateAvailable) return undefined
    this.managedVersion = info.version
    return { version: info.version, url: `${RELEASE_BASE}/tag/v${info.version}`, releaseNotes: normalizeNotes(info.releaseNotes) }
  }

  private async checkManual(): Promise<Pick<UpdateState, 'version' | 'url' | 'releaseNotes'> | undefined> {
    const response = await this.fetchRelease(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Sorcerer' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status}). Please try again later.`)
    const release = await response.json() as Record<string, unknown>
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) {
      throw new Error('The update server returned an invalid stable release.')
    }
    const version = release.tag_name.slice(1)
    const isNewer = newerThan(version, this.state.currentVersion)
    const url = `${RELEASE_BASE}/tag/v${version}`
    if (release.html_url !== url) throw new Error('The update has an untrusted release URL.')
    const os = this.platform === 'win32' ? 'win' : this.platform === 'darwin' ? 'mac' : this.platform === 'linux' ? 'linux' : undefined
    const extension = this.platform === 'win32' ? 'exe' : this.platform === 'darwin' ? 'dmg' : 'AppImage'
    const assetArch = this.platform === 'linux' && this.arch === 'x64' ? 'x86_64' : this.arch
    const assetName = `Sorcerer-${version}-${os}-${assetArch}.${extension}`
    const downloadUrl = `${RELEASE_BASE}/download/v${version}/${assetName}`
    if (!os || !Array.isArray(release.assets) || !release.assets.some((asset: unknown) => {
      if (!asset || typeof asset !== 'object') return false
      const candidate = asset as Record<string, unknown>
      return candidate.name === assetName && candidate.browser_download_url === downloadUrl
    })) throw new Error('This release does not include a download for your operating system and processor.')
    if (!isNewer) return undefined
    return { version, url, releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 100_000) : undefined }
  }

  download(): Promise<UpdateState> {
    if (this.installFlight) return this.installFlight
    if (this.downloadFlight) return this.downloadFlight
    if (this.checkFlight) return this.checkFlight.then(() => this.download())
    if (this.downloaded) return Promise.resolve(this.getState())
    if (!this.updater || !this.state.version || this.managedVersion !== this.state.version) return Promise.resolve(this.getState())
    return this.startDownload()
  }

  private startDownload(): Promise<UpdateState> {
    if (this.downloadFlight) return this.downloadFlight
    this.downloadFlight = this.runDownload().finally(() => { this.downloadFlight = undefined })
    return this.downloadFlight
  }

  private async runDownload(): Promise<UpdateState> {
    this.publish({ status: 'downloading', progress: 0, error: undefined })
    try {
      const files = await this.updater!.downloadUpdate()
      if (files.length === 0) throw new Error('The update download did not produce an installer.')
      this.downloaded = true
      this.publish({ status: 'downloaded', downloaded: true, progress: 100, error: undefined })
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  install(): Promise<UpdateState> {
    if (this.installFlight) return this.installFlight
    if (this.state.status === 'installing' || this.checkFlight || this.downloadFlight) return Promise.resolve(this.getState())
    if (!this.downloaded || !this.updater) return Promise.resolve(this.getState())
    this.installFlight = this.runInstall().finally(() => { this.installFlight = undefined })
    return this.installFlight
  }

  private async runInstall(): Promise<UpdateState> {
    try {
      if (!this.beforeInstall) throw new Error('Safe restart is not available. Please restart Sorcerer and try again.')
      const confirmed = this.options.confirmInstall ? await this.options.confirmInstall() : (await dialog.showMessageBox({
        type: 'question',
        title: 'Restart to update Sorcerer?',
        message: `Install Sorcerer ${this.state.version} and restart?`,
        detail: 'Running terminals and agents will stop. Sorcerer will save your notes and session state before restarting.',
        buttons: ['Cancel', 'Restart and install'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })).response === 1
      if (!confirmed) return this.getState()
      this.publish({ status: 'installing', error: undefined })
      await this.beforeInstall()
      this.updater!.quitAndInstall(true, true)
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  private fail(error: unknown): void {
    this.publish({ status: 'error', error: updateErrorMessage(error) })
  }

  private publish(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    const snapshot = this.getState()
    if (this.options.broadcast) this.options.broadcast(snapshot)
    else for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('system:updates:state', snapshot)
    }
  }
}
