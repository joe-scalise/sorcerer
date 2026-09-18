import { EventEmitter } from 'events'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../../shared/update'

const electron = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => ({})),
  getAllWindows: vi.fn(() => []),
  showMessageBox: vi.fn(async () => ({ response: 0 }))
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.8.0' },
  BrowserWindow: { fromWebContents: electron.fromWebContents, getAllWindows: electron.getAllWindows },
  dialog: { showMessageBox: electron.showMessageBox }
}))
import { UpdateService, isTrustedUpdateSender, type ManagedUpdater } from '../update-service'

class FakeUpdater extends EventEmitter implements ManagedUpdater {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  disableWebInstaller = false
  checkForUpdates = vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.9.0', releaseNotes: 'Release notes' } }))
  downloadUpdate = vi.fn(async () => ['installer.exe'])
  quitAndInstall = vi.fn()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function managed(settings: Record<string, string> = { autoDownloadUpdates: 'false' }) {
  const updater = new FakeUpdater()
  const snapshots: UpdateState[] = []
  const confirmInstall = vi.fn(async () => true)
  const service = new UpdateService({
    getSetting: (key) => settings[key], currentVersion: '1.8.0', packaged: true, platform: 'win32', updater,
    broadcast: (state) => snapshots.push(state), confirmInstall, now: () => 42
  })
  return { service, updater, snapshots, confirmInstall, settings }
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.9.0', html_url: 'https://github.com/joe-scalise/sorcerer/releases/tag/v1.9.0',
    draft: false, prerelease: false, body: 'Release notes',
    assets: [{ name: 'Sorcerer-1.9.0-mac-arm64.dmg', browser_download_url: 'https://github.com/joe-scalise/sorcerer/releases/download/v1.9.0/Sorcerer-1.9.0-mac-arm64.dmg' }],
    ...overrides
  }
}

function manual(body: Record<string, unknown> = release(), platform: NodeJS.Platform = 'darwin', arch = 'arm64') {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response)
  const service = new UpdateService({
    getSetting: () => undefined, currentVersion: '1.8.0', packaged: true, platform, arch, appImage: '',
    fetch: fetchMock as typeof fetch, broadcast: vi.fn()
  })
  return { service, fetchMock }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('managed desktop updates', () => {
  it('explains an unpublished update feed without exposing HTTP diagnostics or claiming up to date', async () => {
    const { service, updater, snapshots } = managed()
    const error = Object.assign(new Error('Cannot find latest.yml: HttpError: 404\nPlease double check your authentication token.\nHeaders: secret diagnostics\n at local/file.js'), {
      code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
    })
    updater.checkForUpdates.mockImplementationOnce(async () => { updater.emit('error', error); throw error })
    const state = await service.check()
    expect(state).toMatchObject({ status: 'error', downloaded: false, canDownload: false })
    expect(state.checkedAt).toBeUndefined()
    expect(state.error).toContain('does not include automatic-update files yet')
    for (const snapshot of snapshots.filter((entry) => entry.status === 'error')) {
      expect(snapshot.error).toBe(state.error)
      expect(snapshot.error).not.toMatch(/token|Headers|local\/file/)
    }
  })

  it('keeps unexpected HTTP dumps out of the error message', async () => {
    const { service, updater } = managed()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('HttpError: 503\nHeaders: internal details\n at local/file.js'))
    expect((await service.check()).error).toBe('The update request failed. Please try again later.')
  })

  it('explains integrity failures while retaining a download retry', async () => {
    const { service, updater } = managed()
    await service.check()
    updater.downloadUpdate.mockRejectedValueOnce(Object.assign(new Error('expected hash versus actual hash'), { code: 'ERR_CHECKSUM_MISMATCH' }))
    expect(await service.download()).toMatchObject({ status: 'error', downloaded: false, canDownload: true, error: 'The downloaded update failed its integrity check. Please retry the download.' })
  })

  it('disables implicit install, prereleases, downgrades and web installers', () => {
    const { updater, service } = managed()
    expect(service.getState()).toMatchObject({ managed: true, downloaded: false, currentVersion: '1.8.0' })
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false, disableWebInstaller: true })
  })

  it('shares in-flight checks and publishes ordered state with release notes', async () => {
    const { updater, service, snapshots } = managed()
    const pending = deferred<{ isUpdateAvailable: boolean; updateInfo: { version: string; releaseNotes: string } }>()
    updater.checkForUpdates.mockReturnValue(pending.promise)
    const first = service.check()
    const second = service.check()
    expect(first).toBe(second)
    expect(service.getState().status).toBe('checking')
    pending.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.9.0', releaseNotes: 'Notes' } })
    expect(await first).toMatchObject({ status: 'available', version: '1.9.0', checkedAt: 42, releaseNotes: 'Notes' })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(snapshots.map(({ revision }) => revision)).toEqual([1, 2])
  })

  it('automatically downloads by default but never installs or enables install on quit', async () => {
    const { updater, service } = managed({})
    expect(await service.check()).toMatchObject({ status: 'downloaded', downloaded: true, progress: 100 })
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('respects automatic-check opt-out even for a manual check auto-download', async () => {
    const { updater, service } = managed({ checkForUpdates: 'false' })
    await service.check({ automatic: true })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(await service.check()).toMatchObject({ status: 'available' })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    await service.download()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('re-reads download preferences after a pending check completes', async () => {
    const { service, updater, settings } = managed({})
    const pending = deferred<{ isUpdateAvailable: boolean; updateInfo: { version: string; releaseNotes: string } }>()
    updater.checkForUpdates.mockReturnValue(pending.promise)
    const checked = service.check()
    settings.autoDownloadUpdates = 'false'
    pending.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.9.0', releaseNotes: '' } })
    expect((await checked).status).toBe('available')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('starts one five-second startup check and polls every two hours with current preferences', async () => {
    vi.useFakeTimers()
    const { service, updater, settings } = managed()
    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    settings.checkForUpdates = 'false'
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    settings.checkForUpdates = 'true'
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    service.stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('single-flights downloads, handles bounded progress and preserves the staged package during checks', async () => {
    const { service, updater } = managed()
    await service.check()
    const pending = deferred<string[]>()
    updater.downloadUpdate.mockReturnValue(pending.promise)
    const first = service.download()
    expect(service.download()).toBe(first)
    expect(service.check()).toBe(first)
    updater.emit('download-progress', { percent: 35 })
    expect(service.getState()).toMatchObject({ status: 'downloading', progress: 35 })
    updater.emit('download-progress', { percent: Infinity })
    expect(service.getState().progress).toBe(35)
    pending.resolve(['installer.exe'])
    expect(await first).toMatchObject({ status: 'downloaded', downloaded: true, version: '1.9.0', releaseNotes: 'Release notes' })
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('keeps known release information on check failure without claiming up-to-date or downloading stale metadata', async () => {
    const { service, updater } = managed()
    await service.check()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Offline'))
    expect(await service.check()).toMatchObject({ status: 'error', error: 'Offline', version: '1.9.0', releaseNotes: 'Release notes', canDownload: false })
    await service.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it.each(['1.10', '01.9.0', '1.9.0-beta.1', 'not-a-version'])('rejects invalid or prerelease managed version %s', async (version) => {
    const { service, updater } = managed({})
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version, releaseNotes: '' } })
    expect((await service.check()).status).toBe('error')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('does not downgrade or offer the installed version', async () => {
    const { service, updater } = managed({})
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.7.99', releaseNotes: '' } })
    expect((await service.check()).status).toBe('idle')
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.8.0', releaseNotes: '' } })
    expect((await service.check()).status).toBe('idle')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('reports download failures and allows a download retry', async () => {
    const { service, updater } = managed()
    await service.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('Checksum mismatch'))
    expect(await service.download()).toMatchObject({ status: 'error', error: 'Checksum mismatch', downloaded: false, version: '1.9.0', canDownload: true })
    expect(await service.download()).toMatchObject({ status: 'downloaded', downloaded: true })
  })

  it('respects updater rollout and operating-system eligibility for a newer release', async () => {
    const { service, updater } = managed({})
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.9.0', releaseNotes: '' } })
    expect((await service.check()).status).toBe('idle')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('requires a safe-shutdown callback and native confirmation before installation', async () => {
    const { service, updater, confirmInstall } = managed({})
    await service.check()
    expect(await service.install()).toMatchObject({ status: 'error', downloaded: true })
    expect(confirmInstall).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    const prepare = vi.fn()
    service.setBeforeInstall(prepare)
    confirmInstall.mockResolvedValueOnce(false)
    await service.install()
    expect(prepare).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(await service.install()).toMatchObject({ status: 'installing' })
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(updater.quitAndInstall.mock.invocationCallOrder[0])
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('single-flights install prompts and refuses installation when draft/session flushing fails', async () => {
    const { service, updater, confirmInstall } = managed({})
    await service.check()
    const pending = deferred<void>()
    service.setBeforeInstall(() => pending.promise)
    const first = service.install()
    expect(service.install()).toBe(first)
    await Promise.resolve()
    pending.reject(new Error('Notes could not be saved'))
    expect(await first).toMatchObject({ status: 'error', downloaded: true, error: 'Notes could not be saved' })
    expect(confirmInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('keeps a staged package after an updater install error so retry remains possible', async () => {
    const { service, updater } = managed({})
    await service.check()
    service.setBeforeInstall(() => {})
    updater.quitAndInstall.mockImplementationOnce(() => { updater.emit('error', new Error('Installer could not start')) })
    expect(await service.install()).toMatchObject({ status: 'error', downloaded: true, version: '1.9.0' })
    expect(await service.install()).toMatchObject({ status: 'installing' })
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
  })
})

describe('manual desktop release discovery', () => {
  it('offers a trusted stable macOS release with notes and a bounded request', async () => {
    const { service, fetchMock } = manual()
    expect(await service.check()).toMatchObject({ status: 'available', managed: false, downloaded: false, version: '1.9.0', releaseNotes: 'Release notes' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/joe-scalise/sorcerer/releases/latest', expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'error' }))
    expect((await service.download()).status).toBe('available')
    expect((await service.install()).status).toBe('available')
  })

  it.each([
    { prerelease: true }, { draft: true }, { tag_name: 'android-v1.9.0' }, { tag_name: 'v1.9.0-rc.1' },
    { tag_name: 'v01.9.0' }, { html_url: 'https://evil.test/update' }, { assets: [] },
    { assets: [{ name: 'Sorcerer-1.9.0-mac-arm64.dmg', browser_download_url: 'https://evil.test/installer.dmg' }] },
    { assets: [{ name: 'sorcerer-android.apk', browser_download_url: 'https://github.com/joe-scalise/sorcerer/releases/download/v1.9.0/sorcerer-android.apk' }] }
  ])('rejects unsafe or mismatched release metadata %j', async (override) => {
    expect((await manual(release(override)).service.check()).status).toBe('error')
  })

  it('matches actual Linux x64 AppImage naming for manual distribution', async () => {
    const assetName = 'Sorcerer-1.9.0-linux-x86_64.AppImage'
    const { service } = manual(release({ assets: [{ name: assetName, browser_download_url: `https://github.com/joe-scalise/sorcerer/releases/download/v1.9.0/${assetName}` }] }), 'linux', 'x64')
    expect(await service.check()).toMatchObject({ status: 'available', managed: false })
  })

  it('uses managed updates only for packaged Windows and AppImage Linux', () => {
    const updater = new FakeUpdater()
    const base = { getSetting: () => undefined, currentVersion: '1.8.0', broadcast: vi.fn(), updater }
    expect(new UpdateService({ ...base, packaged: true, platform: 'linux', appImage: '/opt/Sorcerer.AppImage' }).getState().managed).toBe(true)
    expect(new UpdateService({ ...base, packaged: true, platform: 'darwin' }).getState().managed).toBe(false)
    expect(new UpdateService({ ...base, packaged: false, platform: 'win32' }).getState().managed).toBe(false)
    expect(new UpdateService({ ...base, packaged: true, platform: 'linux', appImage: '' }).getState().managed).toBe(false)
  })

  it('shows HTTP and timeout failures as errors rather than up-to-date', async () => {
    const { service, fetchMock } = manual()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    expect(await service.check()).toMatchObject({ status: 'error', error: expect.stringContaining('429') })
    fetchMock.mockRejectedValueOnce(new DOMException('Request timed out', 'TimeoutError'))
    expect(await service.check()).toMatchObject({ status: 'error', error: 'Request timed out' })
  })
})

describe('local updater IPC boundary', () => {
  const rendererPath = path.resolve('out/renderer/index.html')
  function sender(url: string) {
    const frame = { url }
    return { sender: { isDestroyed: () => false, mainFrame: frame }, senderFrame: frame } as unknown as Parameters<typeof isTrustedUpdateSender>[0]
  }

  it('allows the actual packaged renderer, including detached-panel query parameters', () => {
    const event = sender(`${pathToFileURL(rendererPath).href}?popout=agent#main`)
    expect(isTrustedUpdateSender(event, { packaged: true, rendererPath })).toBe(true)
  })

  it('rejects subframes, other files, remote windows, and unrelated development paths', () => {
    const event = sender(pathToFileURL(rendererPath).href)
    const subframe = { ...event, senderFrame: { url: event.senderFrame!.url } } as typeof event
    expect(isTrustedUpdateSender(subframe, { packaged: true, rendererPath })).toBe(false)
    expect(isTrustedUpdateSender(sender('file:///tmp/evil.html'), { packaged: true, rendererPath })).toBe(false)
    expect(isTrustedUpdateSender(sender('https://github.com/joe-scalise/sorcerer'), { packaged: true, rendererPath })).toBe(false)
    expect(isTrustedUpdateSender(sender('http://localhost:5173/evil'), { packaged: false, devUrl: 'http://localhost:5173/' })).toBe(false)
    expect(isTrustedUpdateSender(sender('http://localhost:5173/?popout=x'), { packaged: false, devUrl: 'http://localhost:5173/' })).toBe(true)
  })

  it('rejects web contents that do not belong to an application window', () => {
    electron.fromWebContents.mockReturnValueOnce(null as unknown as object)
    expect(isTrustedUpdateSender(sender(pathToFileURL(rendererPath).href), { packaged: true, rendererPath })).toBe(false)
  })
})
