// Real Electron HTTP + NSIS updater download integrity, using only inert fixtures.
// Never executes an installer, calls quitAndInstall, or touches a user profile.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

if (process.argv[2] !== '--child') {
  if (process.platform !== 'win32') throw new Error('The NSIS download smoke test requires Windows')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-update-download-'))
  const env = { ...process.env, USERPROFILE: profile, APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'localappdata') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_PATH
  fs.mkdirSync(env.APPDATA)
  fs.mkdirSync(env.LOCALAPPDATA)
  try {
    const result = spawnSync(require('electron'), [__filename, '--child', profile], {
      env, windowsHide: true, stdio: 'inherit', timeout: 60000
    })
    if (result.error || result.status !== 0) throw result.error || new Error(`Update download smoke exited ${result.status}`)
    assert.ok(fs.existsSync(path.join(profile, 'completed.ok')), 'Electron exited before completing download checks')
  } catch (error) {
    console.error('Update download smoke failed:', error)
    process.exitCode = 1
  } finally {
    // Verify the exact allocated temporary path before any recursive cleanup.
    const resolved = path.resolve(profile)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('sorcerer-update-download-')) {
      throw new Error('Refusing cleanup outside the allocated update smoke directory')
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
} else {
  const { app } = require('electron')
  const profile = path.resolve(process.argv[3])
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert.ok(path.basename(profile).startsWith('sorcerer-update-download-'))
  for (const [name, directory] of [['home', profile], ['userData', path.join(profile, 'electron')], ['sessionData', path.join(profile, 'session')]]) {
    fs.mkdirSync(directory, { recursive: true })
    app.setPath(name, directory)
  }
  app.disableHardwareAcceleration()
  const deadline = setTimeout(() => { console.error('Update download smoke timed out'); app.exit(1) }, 45000)
  app.whenReady().then(() => runDownloadChecks(profile)).then(() => {
    fs.writeFileSync(path.join(profile, 'completed.ok'), 'passed')
    console.log('Update download smoke passed: real Electron HTTP, verified NSIS download, corrupt payload rejected; no installation performed')
    clearTimeout(deadline)
    app.exit(0)
  }).catch((error) => {
    console.error('Update download smoke failed:', error)
    clearTimeout(deadline)
    app.exit(1)
  })
}

async function runDownloadChecks(profile) {
  const http = require('node:http')
  const crypto = require('node:crypto')
  const { NsisUpdater } = require('electron-updater')
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
  const { app } = require('electron')
  assert.equal(require('electron-updater/package.json').version, '6.8.9')
  const filename = 'Sorcerer-inert-download-fixture.exe'
  // Plain text, deliberately not an executable or installer.
  const payload = Buffer.from('SORCERER INERT DOWNLOAD INTEGRITY FIXTURE\n'.repeat(128))
  const corrupted = Buffer.from(payload)
  corrupted[0] ^= 1
  const sha512 = crypto.createHash('sha512').update(payload).digest('base64')
  const manifest = `version: 1.0.1\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '2026-09-18T00:00:00.000Z'\n`
  const requests = []
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    requests.push(pathname)
    const match = /^\/(good|corrupt)\/(.+)$/.exec(pathname)
    if (!match || !['latest.yml', filename].includes(match[2])) {
      response.writeHead(404).end()
      return
    }
    const body = match[2] === 'latest.yml' ? Buffer.from(manifest) : match[1] === 'good' ? payload : corrupted
    response.writeHead(200, { 'Content-Type': match[2] === 'latest.yml' ? 'application/yaml' : 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
    response.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    for (const scenario of ['good', 'corrupt']) {
      const scenarioRoot = path.join(profile, scenario)
      const userDataPath = path.join(scenarioRoot, 'user-data')
      const baseCachePath = path.join(scenarioRoot, 'cache')
      fs.mkdirSync(userDataPath, { recursive: true })
      fs.mkdirSync(baseCachePath, { recursive: true })
      const feed = `http://127.0.0.1:${server.address().port}/${scenario}/`
      const appUpdateConfigPath = path.join(scenarioRoot, 'app-update.yml')
      // No publisherName: matches the existing unsigned package configuration.
      // Signature behavior is untouched; this check tests download SHA512 only.
      fs.writeFileSync(appUpdateConfigPath, `provider: generic\nurl: ${feed}\nupdaterCacheDirName: fixture-updater\n`)
      let forbiddenCalls = 0
      const forbidInstall = () => { forbiddenCalls++; throw new Error('Installation and app lifecycle actions are forbidden in this download smoke') }
      const adapter = {
        version: '1.0.0', name: 'SorcererDownloadSmoke', isPackaged: true,
        appUpdateConfigPath, userDataPath, baseCachePath,
        whenReady: () => app.whenReady(), quit: forbidInstall, relaunch: forbidInstall, onQuit: forbidInstall
      }
      const updater = new NsisUpdater(null, adapter)
      updater.httpExecutor = new ElectronHttpExecutor()
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.autoRunAppAfterInstall = false
      updater.disableDifferentialDownload = true
      updater.disableWebInstaller = true
      updater.quitAndInstall = forbidInstall
      updater.install = forbidInstall
      updater.doInstall = forbidInstall
      updater.logger = null
      updater.setFeedURL({ provider: 'generic', url: feed, useMultipleRangeRequest: false })
      let downloaded = 0
      let lastError
      updater.on('update-downloaded', () => { downloaded++ })
      updater.on('error', (error) => { lastError = error })
      const check = await updater.checkForUpdates()
      assert.equal(check.updateInfo.version, '1.0.1')
      assert.equal(check.downloadPromise, null, 'Checking must not automatically download')
      assert.ok(!requests.includes(`/${scenario}/${filename}`), 'Checking fetched the payload before explicit download')
      if (scenario === 'good') {
        const files = await updater.downloadUpdate()
        assert.equal(files.length, 1)
        assert.ok(path.resolve(files[0]).startsWith(`${path.resolve(baseCachePath)}${path.sep}`), 'Download escaped the disposable cache')
        assert.deepEqual(fs.readFileSync(files[0]), payload)
        assert.equal(downloaded, 1)
        assert.equal(lastError, undefined)
      } else {
        await assert.rejects(updater.downloadUpdate(), (error) => error.code === 'ERR_CHECKSUM_MISMATCH')
        assert.equal(lastError?.code, 'ERR_CHECKSUM_MISMATCH')
        assert.equal(downloaded, 0, 'Corrupt payload must not be marked downloaded')
        assert.equal(updater.installerPath, null, 'Corrupt payload must not become an installable update')
      }
      assert.equal(forbiddenCalls, 0)
      assert.equal(updater.quitHandlerAdded, false)
      assert.ok(requests.includes(`/${scenario}/latest.yml`))
      assert.ok(requests.includes(`/${scenario}/${filename}`), 'Payload must actually arrive over HTTP')
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
