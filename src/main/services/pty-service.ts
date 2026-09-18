import { BrowserWindow, WebContents } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import { ScrollbackBuffer } from '../server/scrollback'

interface PTYSession {
  ptyProcess: pty.IPty
  sessionId: string
  exited: Promise<Error | undefined>
}

export class PTYService {
  private sessions: Map<string, PTYSession> = new Map()
  /** Includes terminated PTYs until their real exit event and listeners finish. */
  private liveSessions: Set<PTYSession> = new Set()
  private mainWindow: BrowserWindow
  private customShell: string | undefined
  private spawnsBlocked = false
  private outputListeners: ((sessionId: string, data: string) => void)[] = []
  private exitListeners: ((sessionId: string, exitCode: number) => void)[] = []
  /** Extra windows that should receive terminal data for a given session */
  private extraListeners: Map<string, Set<WebContents>> = new Map()
  /** Scrollback buffer for terminal replay in pop-out windows */
  readonly scrollback: ScrollbackBuffer = new ScrollbackBuffer()

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  setCustomShell(shell: string | undefined): void {
    this.customShell = shell
  }

  setSpawnsBlocked(blocked: boolean): void {
    this.spawnsBlocked = blocked
  }

  /** Register a listener for all PTY output (used by API server for WebSocket broadcast) */
  onOutput(listener: (sessionId: string, data: string) => void): void {
    this.outputListeners.push(listener)
  }

  /** Remove a previously registered output listener */
  removeOutputListener(listener: (sessionId: string, data: string) => void): void {
    this.outputListeners = this.outputListeners.filter((l) => l !== listener)
  }

  /** Register a listener for all PTY exits */
  onExit(listener: (sessionId: string, exitCode: number) => void): void {
    this.exitListeners.push(listener)
  }

  /** Remove a previously registered exit listener */
  removeExitListener(listener: (sessionId: string, exitCode: number) => void): void {
    this.exitListeners = this.exitListeners.filter((l) => l !== listener)
  }

  /** Subscribe an extra WebContents to a session's terminal output */
  addListener(sessionId: string, wc: WebContents): void {
    let set = this.extraListeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.extraListeners.set(sessionId, set)
    }
    set.add(wc)
  }

  /** Unsubscribe an extra WebContents from a session's terminal output */
  removeListener(sessionId: string, wc: WebContents): void {
    const set = this.extraListeners.get(sessionId)
    if (set) {
      set.delete(wc)
      if (set.size === 0) this.extraListeners.delete(sessionId)
    }
  }

  /**
   * Spawn a process in a PTY.
   * If command is provided, spawn that directly (e.g. 'claude').
   * Otherwise spawn the user's shell.
   */
  spawn(sessionId: string, cwd: string, options?: {
    command?: string
    args?: string[]
    env?: Record<string, string>
  }): void {
    if (this.spawnsBlocked) throw new Error('Sorcerer is preparing to restart. New terminals cannot start yet.')
    let file: string
    let args: string[]

    if (options?.command) {
      // Spawn the command directly - no shell wrapper
      file = options.command
      args = options.args || []
    } else {
      // Spawn a shell
      if (this.customShell) {
        file = this.customShell
      } else {
        file = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
      }
      args = os.platform() === 'win32' && !file.includes('bash') ? [] : ['--login']
    }

    const ptyProcess = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        ...options?.env
      } as Record<string, string>
    })

    let finishExit!: (error?: Error) => void
    const exited = new Promise<Error | undefined>((resolve) => { finishExit = resolve })
    const session: PTYSession = { ptyProcess, sessionId, exited }
    this.sessions.set(sessionId, session)
    this.liveSessions.add(session)

    ptyProcess.onData((data: string) => {
      // Store in scrollback for pop-out replay
      this.scrollback.append(sessionId, data)

      // Send to main window
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(`terminal:data:${sessionId}`, data)
      }

      // Send to any extra listeners (pop-out windows)
      const extras = this.extraListeners.get(sessionId)
      if (extras) {
        for (const wc of extras) {
          try {
            if (!wc.isDestroyed()) {
              wc.send(`terminal:data:${sessionId}`, data)
            } else {
              extras.delete(wc)
            }
          } catch {
            extras.delete(wc)
          }
        }
      }

      for (const listener of this.outputListeners) listener(sessionId, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      // A closing window or one failing consumer must not skip persistence
      // listeners, leave a wait pending, or hide a still-running PTY on retry.
      let exitError: Error | undefined
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(`terminal:exit:${sessionId}`, exitCode)
        }
      } catch { /* window already destroyed */ }

      // Notify extra listeners of exit
      const extras = this.extraListeners.get(sessionId)
      if (extras) {
        for (const wc of extras) {
          try {
            if (!wc.isDestroyed()) {
              wc.send(`terminal:exit:${sessionId}`, exitCode)
            }
          } catch { /* window already destroyed */ }
        }
        this.extraListeners.delete(sessionId)
      }

      for (const listener of [...this.exitListeners]) {
        try { listener(sessionId, exitCode) } catch (error) {
          exitError ??= error instanceof Error ? error : new Error('A terminal exit handler failed.')
        }
      }
      if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId)
      this.scrollback.remove(sessionId)
      this.liveSessions.delete(session)
      finishExit(exitError)
      if (exitError) console.error(`[pty] Exit handler failed for ${sessionId}:`, exitError)
    })
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.ptyProcess.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.ptyProcess.resize(cols, rows)
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.ptyProcess.kill()
      this.sessions.delete(sessionId)
    }
    // Scrollback is released on the PTY exit event so exit handlers can still inspect it.
    this.extraListeners.delete(sessionId)
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }

  async killAllAndWait(timeoutMs = 1500): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    if (sessionIds.length === 0) return

    await Promise.all(sessionIds.map((sessionId) => this.killAndWait(sessionId, timeoutMs)))
  }

  /** Update installation must never proceed merely because its wait expired. */
  async killAllAndWaitStrict(timeoutMs = 10_000): Promise<void> {
    const sessions = [...this.liveSessions]
    const results = await Promise.allSettled(sessions.map((session) => this.waitForExit(session, timeoutMs, true)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private killAndWait(sessionId: string, timeoutMs: number): Promise<void> {
    const session = this.sessions.get(sessionId)
    return session ? this.waitForExit(session, timeoutMs, false) : Promise.resolve()
  }

  private waitForExit(session: PTYSession, timeoutMs: number, strict: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => finish(strict
        ? new Error(`Terminal ${session.sessionId} did not stop within ${timeoutMs} ms. The update was not installed. Try again after it exits.`)
        : undefined), timeoutMs)
      // This resolves only after every exit consumer has been invoked, including
      // the main process listeners that enqueue session state persistence.
      void session.exited.then((error) => finish(strict ? error : undefined))
      try {
        session.ptyProcess.kill()
        if (this.sessions.get(session.sessionId) === session) this.sessions.delete(session.sessionId)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(`Could not stop terminal ${session.sessionId}.`))
      } finally {
        this.extraListeners.delete(session.sessionId)
      }
    })
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getPid(sessionId: string): number | undefined {
    const session = this.sessions.get(sessionId)
    return session?.ptyProcess.pid
  }
}
