// Load the built application and its real preload in a disposable, hidden profile.
// This is a boot/persistence check, not a substitute for interactive installer QA.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.argv[2] !== '--child') {
  const packaged = process.platform === 'darwin'
    ? `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Sorcerer.app/Contents/Resources/app.asar`
    : `dist/${process.platform === 'win32' ? 'win' : 'linux'}-unpacked/resources/app.asar`
  let appRoot = path.resolve(process.argv[2] === '--packaged' ? packaged : process.cwd())
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-app-smoke-'))
  const env = { ...process.env, HOME: profile, USERPROFILE: profile, APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'localappdata') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_PATH
  fs.mkdirSync(env.APPDATA)
  fs.mkdirSync(env.LOCALAPPDATA)
  try {
    if (appRoot.endsWith('.asar')) {
      // Test outside the checkout so missing shipped dependencies cannot fall
      // back to the development node_modules in ancestor directories.
      const isolatedRoot = path.join(profile, 'application', 'app.asar')
      fs.mkdirSync(path.dirname(isolatedRoot))
      fs.copyFileSync(appRoot, isolatedRoot)
      if (fs.existsSync(`${appRoot}.unpacked`)) fs.cpSync(`${appRoot}.unpacked`, `${isolatedRoot}.unpacked`, { recursive: true })
      appRoot = isolatedRoot
    }
    for (const phase of ['write', 'read']) {
      const result = spawnSync(require('electron'), [__filename, '--child', appRoot, profile, phase], {
        env, windowsHide: true, stdio: 'inherit', timeout: 60000
      })
      if (result.error || result.status !== 0) throw result.error || new Error(`App smoke ${phase} exited ${result.status}`)
      if (!fs.existsSync(path.join(profile, `smoke-${phase}.ok`))) throw new Error(`App exited before completing the ${phase} smoke check`)
    }
    console.log('Application smoke passed: renderer/preload boot, database IPC, saved notes across restart, clean shutdown')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('sorcerer-app-smoke-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
} else {
  const { app, BrowserWindow } = require('electron')
  const appRoot = path.resolve(process.argv[3])
  const profile = path.resolve(process.argv[4])
  const phase = process.argv[5]
  // Covers every os.homedir consumer, including DB, workspaces and CLI settings.
  os.homedir = () => profile
  app.setPath('home', profile)
  app.setPath('userData', path.join(profile, 'electron'))
  BrowserWindow.prototype.show = function () {}
  const deadline = setTimeout(() => { console.error('Application smoke timed out'); app.exit(1) }, 45000)
  let completed = false
  app.on('will-quit', () => {
    clearTimeout(deadline)
    if (!completed) process.exitCode = 1
  })
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`Renderer failed to load: ${code} ${description}`)
      app.exit(1)
    })
    window.webContents.once('did-finish-load', async () => {
      try {
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const started = Date.now();
          const timer = setInterval(() => {
            if (window.sorcerer && document.querySelector('.app-shell')) { clearInterval(timer); resolve(true) }
            else if (Date.now() - started > 15000) { clearInterval(timer); reject(new Error('App shell did not boot')) }
          }, 100)
        })`)
        const result = await window.webContents.executeJavaScript(`(async () => {
          const api = window.sorcerer;
          const projects = await api.project.list();
          if (projects.length !== 0) throw new Error('Smoke profile is not empty');
          if (${JSON.stringify(phase)} === 'write') {
            await api.quickNotes.save('smoke-note', 'smoke-parent', 'session', 'release persistence check');
          }
          const note = await api.quickNotes.load('smoke-parent', 'session');
          if (note?.content !== 'release persistence check') throw new Error('Note persistence check failed');
          return document.querySelector('.app-shell').textContent.length;
        })()`)
        if (!result) throw new Error('Rendered app is empty')
        if (phase === 'read') {
          const screenshot = await window.webContents.capturePage()
          const output = path.resolve('dist', `smoke-${process.platform}-${process.arch}.png`)
          fs.mkdirSync(path.dirname(output), { recursive: true })
          fs.writeFileSync(output, screenshot.toPNG())
        }
        completed = true
        fs.writeFileSync(path.join(profile, `smoke-${phase}.ok`), 'passed')
        console.log(`Application smoke ${phase} passed`)
        app.quit()
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
  })
  require(path.join(appRoot, 'out/main/index.js'))
}
