// Exercise the shipped Electron ABI and SQLite WASM without opening a user profile.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')

if (process.argv[2] !== '--child') {
  const packagedRoot = process.platform === 'darwin'
    ? `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Sorcerer.app/Contents/Resources/app.asar`
    : `dist/${process.platform === 'win32' ? 'win' : 'linux'}-unpacked/resources/app.asar`
  const appRoot = path.resolve(process.argv[2] === '--packaged' ? packagedRoot : process.argv[2] || process.cwd())
  const result = spawnSync(require('electron'), [__filename, '--child', appRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    stdio: 'inherit',
    timeout: 45000
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
} else {
  run().then(() => process.exit(0)).catch((error) => {
    console.error('Native smoke failed:', error)
    process.exit(1)
  })
}

async function run() {
  if (!process.versions.electron) throw new Error('Smoke test must run under Electron')
  const appRoot = path.resolve(process.argv[3])
  const appRequire = createRequire(path.join(appRoot, 'package.json'))
  const pkg = appRequire('./package.json')
  const pty = appRequire('node-pty')
  const initSqlJs = appRequire('sql.js')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-native-smoke-'))
  try {
    const wasm = path.join(path.dirname(appRequire.resolve('sql.js')), 'sql-wasm.wasm')
    const SQL = await initSqlJs({ locateFile: () => wasm })
    const database = new SQL.Database()
    database.run('CREATE TABLE smoke (value TEXT)')
    database.run('INSERT INTO smoke VALUES (?)', ['persistent'])
    const databasePath = path.join(temporary, 'smoke.db')
    fs.writeFileSync(databasePath, database.export())
    database.close()
    const reopened = new SQL.Database(fs.readFileSync(databasePath))
    const value = reopened.exec('SELECT value FROM smoke')[0]?.values[0]?.[0]
    reopened.close()
    if (value !== 'persistent') throw new Error('SQLite persistence round trip failed')

    await new Promise((resolve, reject) => {
      const windows = process.platform === 'win32'
      const terminal = pty.spawn(windows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh', windows ? ['/d', '/q'] : [], {
        name: 'xterm-256color', cols: 80, rows: 24, cwd: temporary, env: process.env
      })
      let output = ''
      const timeout = setTimeout(() => {
        terminal.kill()
        reject(new Error('PTY did not exit within 15 seconds'))
      }, 15000)
      terminal.onData((data) => { output += data })
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode !== 0 || !output.includes('SORCERER_PTY_OK')) {
          reject(new Error(`PTY echo/exit failed (exit ${exitCode})`))
        } else resolve()
      })
      terminal.resize(100, 30)
      terminal.write(windows ? 'echo SORCERER_PTY_OK\r\nexit\r\n' : "printf 'SORCERER_PTY_OK\\n'\nexit\n")
    })
    console.log(`Native smoke passed: Sorcerer ${pkg.version}, Electron ${process.versions.electron}, ${process.platform}/${process.arch}; PTY input/resize/output/exit and SQLite WASM persistence`)
  } finally {
    // Only remove the exact temporary directory allocated by this invocation.
    const resolved = path.resolve(temporary)
    const parent = path.resolve(os.tmpdir())
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('sorcerer-native-smoke-')) {
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
}
