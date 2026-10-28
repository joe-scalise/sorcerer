// Exercise the actual built app in two processes sharing a disposable data root.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

if (process.argv[2] === '--child') {
  const { app, BrowserWindow } = require('electron')
  const profile = process.argv[3]
  const role = process.argv[4]
  app.setName(`sorcerer-lock-${role}`)
  os.homedir = () => profile
  app.setPath('home', profile)
  app.setPath('userData', path.join(profile, `ui-${role}`))
  BrowserWindow.prototype.show = function () {}
  app.on('browser-window-created', () => fs.writeFileSync(path.join(profile, `${role}-window`), 'yes'))
  const timer = setInterval(() => {
    if (fs.existsSync(path.join(profile, 'stop'))) app.quit()
  }, 100)
  app.on('will-quit', () => clearInterval(timer))
  require(path.join(process.cwd(), 'out/main/index.js'))
} else {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-lock-smoke-'))
  const env = { ...process.env, HOME: profile, USERPROFILE: profile, APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'localappdata') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  fs.mkdirSync(env.APPDATA)
  fs.mkdirSync(env.LOCALAPPDATA)
  const start = (role) => spawn(require('electron'), [__filename, '--child', profile, role], { env, windowsHide: true, stdio: 'ignore' })
  const wait = async (condition, timeout = 30000) => {
    const end = Date.now() + timeout
    while (!condition()) {
      if (Date.now() > end) throw new Error('Timed out waiting for app instance')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  ;(async () => {
    let first, second, third
    try {
      first = start('first')
      await wait(() => fs.existsSync(path.join(profile, 'first-window')) || first.exitCode !== null)
      if (first.exitCode !== null) throw new Error('First instance exited before opening')
      second = start('second')
      await wait(() => second.exitCode !== null)
      if (second.exitCode !== 0 || fs.existsSync(path.join(profile, 'second-window'))) throw new Error('Second instance was not safely rejected')
      fs.writeFileSync(path.join(profile, 'stop'), 'stop')
      await wait(() => first.exitCode !== null)
      if (first.exitCode !== 0) throw new Error('First instance did not shut down cleanly')
      fs.unlinkSync(path.join(profile, 'stop'))
      third = start('third')
      await wait(() => fs.existsSync(path.join(profile, 'third-window')) || third.exitCode !== null)
      if (third.exitCode !== null) throw new Error('Lock was not released on shutdown')
      fs.writeFileSync(path.join(profile, 'stop'), 'stop')
      await wait(() => third.exitCode !== null)
      if (third.exitCode !== 0) throw new Error('Third instance did not shut down cleanly')
      console.log('Instance lock smoke passed: second UI profile rejected and lock released on shutdown')
    } finally {
      if (first && first.exitCode === null) first.kill()
      if (second && second.exitCode === null) second.kill()
      if (third && third.exitCode === null) third.kill()
      if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('sorcerer-lock-smoke-')) {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    }
  })().catch((error) => { console.error(error); process.exitCode = 1 })
}
