import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync } from 'child_process'
import { PTYService } from './services/pty-service'
import { DatabaseService } from './services/database-service'
import { WorktreeService } from './services/worktree-service'
import { FileWatcherService } from './services/file-watcher-service'
import { PopoutService } from './services/popout-service'
import { registerIPC, getGlobalApiServer } from './ipc/handlers'
import { UpdateService } from './services/update-service'
import { flushUpdateDrafts } from './services/update-restart'
import { waitForUpdateTasks } from './services/wait-for-update-tasks'
import { syncWorktrees, checkResumeFailed, canRecoverSessionByCwd, persistCodexSessionIdentity, markSessionResumeState, reconcileCodexSessions, persistSessionExitSummary, resolveSessionWorkingDirectory, resolveCodexExitThreadIdentity, extractCodexThreadIdFromOutput, codexThreadBelongsToCwd } from './ipc/shared-handlers'
import { AgentOrchestrator } from './services/agent-orchestrator'
import { refreshProviders as refreshProviderRegistry } from './services/provider-registry'
import { isExternalWebUrl, secureWindowContents } from './window-security'

// Install before any BrowserWindow is created so popouts share the same boundary.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'window') {
    secureWindowContents(contents, (url) => shell.openExternal(url))
  }
})

// On macOS/Linux, Electron doesn't inherit the user's shell PATH.
// Fix process.env.PATH so spawned processes (e.g. 'claude') can be found.
if (process.platform !== 'win32') {
  try {
    const userShell = process.env.SHELL || '/bin/bash'
    const shellPath = execSync(`${userShell} -ilc 'echo -n $PATH'`, {
      encoding: 'utf8',
      timeout: 5000
    })
    if (shellPath) process.env.PATH = shellPath
  } catch { /* keep existing PATH */ }
}

// ── Dev mode isolation ───────────────────────────────────────
// Use a separate user data directory in dev so the dev instance doesn't
// collide with an installed Sorcerer (GPU cache locks, port conflicts, etc.)
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), '-dev'))
}

// ── Memory optimizations ─────────────────────────────────────
// Disable GPU entirely — Sorcerer is a terminal app, no WebGL/3D needed.
// This eliminates the GPU process, its memory overhead, and disk cache lock
// errors on Windows when restarting quickly or running multiple instances.
app.disableHardwareAcceleration()
// Limit renderer JS heap to 128 MB (default is ~4 GB on 64-bit)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128')
// Disable background tab throttling workarounds that bloat memory
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow: BrowserWindow | null = null
let ptyService: PTYService
let dbService: DatabaseService
let worktreeService: WorktreeService
let fileWatcherService: FileWatcherService
let popoutService: PopoutService
let agentOrchestrator: AgentOrchestrator | null = null
let saveWindowBoundsTimer: NodeJS.Timeout | null = null
let rateLimitsWatcher: fs.FSWatcher | null = null
let rateLimitsDebounceTimer: ReturnType<typeof setTimeout> | null = null
const pendingExitPersistence = new Set<Promise<void>>()
const pendingStartupTasks = new Set<Promise<void>>()
let isShuttingDown = false
let updateService: UpdateService | null = null
let preparingUpdate = false
let resumeRemoteAfterUpdateFailure = false
let updatePersistenceError: unknown

async function prepareUpdateInstall(): Promise<void> {
  preparingUpdate = true
  updatePersistenceError = undefined
  agentOrchestrator?.stop()
  ptyService.setSpawnsBlocked(true)
  await flushUpdateDrafts(BrowserWindow.getAllWindows())
  isShuttingDown = true
  const server = getGlobalApiServer()
  resumeRemoteAfterUpdateFailure = server?.isRunning() ?? false
  server?.stop()
  await waitForUpdateTasks(pendingStartupTasks)
  getGlobalApiServer()?.stop()
  await ptyService.killAllAndWaitStrict()
  await waitForUpdateTasks(pendingExitPersistence)
  if (updatePersistenceError) throw new Error('Session state could not be saved. Please retry before installing the update.')
  flushWindowBounds()
  // Keep the database usable if the installer cannot launch.
  dbService.flush()
}

function resumeAfterUpdateFailure(): void {
  preparingUpdate = false
  isShuttingDown = false
  ptyService.setSpawnsBlocked(false)
  agentOrchestrator?.start()
  if (resumeRemoteAfterUpdateFailure) {
    void getGlobalApiServer()?.start().catch((error) => console.error('[updates] Could not resume remote access:', error))
  }
  resumeRemoteAfterUpdateFailure = false
}

function collectPopoutEntities(panelIds: string[]): { sessions: any[]; agents: any[]; projects: any[] } {
  const sessions = new Map<string, any>()
  const agents = new Map<string, any>()
  const projects = new Map<string, any>()

  const addSession = (sessionId: string) => {
    const session = dbService?.getSession(sessionId)
    if (!session) return false
    sessions.set(session.id as string, session)
    const projectId = session.project_id as string | undefined
    if (projectId) {
      const project = dbService?.getProject(projectId)
      if (project) {
        projects.set(project.id as string, project)
      }
    }
    return true
  }

  const addAgent = (agentId: string) => {
    const agent = dbService?.getAgent(agentId)
    if (!agent) return false
    agents.set(agent.id as string, agent)
    return true
  }

  for (const panelId of panelIds) {
    if (!panelId) continue
    const quickNotesMatch = panelId.match(/^quicknotes:(session|agent):(.+)$/)
    if (quickNotesMatch) {
      const [, parentType, parentId] = quickNotesMatch
      if (parentType === 'session') {
        addSession(parentId)
      } else {
        addAgent(parentId)
      }
      continue
    }

    if (addSession(panelId)) continue
    addAgent(panelId)
  }

  return {
    sessions: Array.from(sessions.values()),
    agents: Array.from(agents.values()),
    projects: Array.from(projects.values())
  }
}

function getWindowBounds(): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
  const defaults = { width: 1200, height: 800, maximized: false }
  if (!dbService) return defaults
  try {
    const saved = dbService.getSetting('windowBounds')
    if (saved) return JSON.parse(saved)
  } catch { /* use defaults */ }
  return defaults
}

function saveWindowBounds(): void {
  if (!mainWindow || !dbService || mainWindow.isDestroyed()) return
  try {
    const maximized = mainWindow.isMaximized()
    // Only save non-maximized bounds so we restore to a good size
    if (!maximized) {
      const bounds = mainWindow.getBounds()
      dbService.setSetting('windowBounds', JSON.stringify({ ...bounds, maximized: false }))
    } else {
      // Preserve previous x/y/width/height but mark as maximized
      let parsed: { width: number; height: number; [key: string]: unknown } = { width: 1200, height: 800 }
      try {
        const prev = dbService.getSetting('windowBounds')
        if (prev) parsed = JSON.parse(prev)
      } catch {
        parsed = { width: 1200, height: 800 }
      }
      dbService.setSetting('windowBounds', JSON.stringify({ ...parsed, maximized: true }))
    }
  } catch (err) {
    console.warn('[window] Failed to save window bounds:', err)
  }
}

function scheduleSaveWindowBounds(): void {
  if (saveWindowBoundsTimer) {
    clearTimeout(saveWindowBoundsTimer)
  }
  saveWindowBoundsTimer = setTimeout(() => {
    saveWindowBoundsTimer = null
    saveWindowBounds()
  }, 150)
}

function flushWindowBounds(): void {
  if (saveWindowBoundsTimer) {
    clearTimeout(saveWindowBoundsTimer)
    saveWindowBoundsTimer = null
  }
  saveWindowBounds()
}

function trackExitPersistence(task: Promise<void>): void {
  pendingExitPersistence.add(task)
  void task.finally(() => {
    pendingExitPersistence.delete(task)
  })
}

async function waitForExitPersistence(timeoutMs = 2000): Promise<void> {
  if (pendingExitPersistence.size === 0) return

  await Promise.race([
    Promise.allSettled(Array.from(pendingExitPersistence)).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ])
}

function trackStartupTask(task: Promise<void>): void {
  pendingStartupTasks.add(task)
  void task.finally(() => {
    pendingStartupTasks.delete(task)
  })
}

async function waitForStartupTasks(timeoutMs = 3000): Promise<void> {
  if (pendingStartupTasks.size === 0) return

  await Promise.race([
    Promise.allSettled(Array.from(pendingStartupTasks)).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ])
}

async function createWindow(): Promise<void> {
  // Initialize database first so we can read window bounds
  dbService = new DatabaseService()
  await dbService.ensureReady()

  const bounds = getWindowBounds()

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : {
          titleBarOverlay: {
            color: '#0f0e0c',
            symbolColor: '#a69e8e',
            height: 36
          }
        }),
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      v8CacheOptions: 'bypassHeatCheck'
    }
  })

  if (bounds.maximized) {
    mainWindow.maximize()
  }

  // Initialize remaining services
  try {
    ptyService = new PTYService(mainWindow)
    worktreeService = new WorktreeService()
    popoutService = new PopoutService(mainWindow)
    fileWatcherService = new FileWatcherService(mainWindow, dbService)

    // Mark all previously-active sessions as idle (PTY processes died on app exit)
    const staleSessions = dbService.listSessions().filter((s: any) => s.status === 'active')
    for (const s of staleSessions) {
      dbService.updateSession(s.id, { status: 'idle', pid: null })
    }

    // Same for agents — their PTY processes also die on app exit
    const staleAgents = dbService.listAgents().filter((a: any) => a.status === 'active')
    for (const a of staleAgents) {
      dbService.updateAgent(a.id, { status: 'idle', pid: null })
    }

    // Clean up idle quick terminals — they can never be recovered
    const idleQTs = dbService.listSessions().filter(
      (s: any) => s.type === 'quick-terminal' && s.status === 'idle'
    )
    for (const qt of idleQTs) {
      dbService.removeSession(qt.id)
    }
    if (idleQTs.length > 0) {
      console.log(`[startup] Cleaned up ${idleQTs.length} idle quick terminal(s)`)
    }
  } catch (err) {
    console.error('[startup] Service initialization failed:', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy()
      mainWindow = null
    }
    throw err
  }

  // Register IPC handlers
  if (!updateService) {
    updateService = new UpdateService({
      getSetting: (key) => dbService.getSetting(key),
      broadcast: (state) => {
        if (preparingUpdate && state.status !== 'installing') resumeAfterUpdateFailure()
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('system:updates:state', state)
        }
      }
    })
    updateService.setBeforeInstall(prepareUpdateInstall)
    updateService.start()
  }
  registerIPC(ptyService, dbService, worktreeService, fileWatcherService, updateService)

  // Start the agent orchestrator — handles scheduled runs, output capture, decisions
  if (!agentOrchestrator) {
    agentOrchestrator = new AgentOrchestrator(dbService, ptyService, mainWindow)
    agentOrchestrator.start()
  }

  // Capture Codex thread IDs from live PTY output as soon as Codex prints them.
  ptyService.onOutput((sessionId, data) => {
    void (async () => {
      const session = dbService.getSession(sessionId)
      if (!session || session.provider !== 'codex' || session.type === 'quick-terminal') return

      const scrollbackText = ptyService.scrollback.getScrollback(sessionId)
      const extractedThreadId = extractCodexThreadIdFromOutput(scrollbackText)
      if (!extractedThreadId) return
      const cwd = resolveSessionWorkingDirectory(dbService, session, { allowProjectFallback: true })
      if (!cwd) return
      if (!await codexThreadBelongsToCwd(extractedThreadId, cwd)) return
      if (
        extractedThreadId === session.provider_session_id &&
        session.resume_status === 'ready' &&
        session.provider_session_source === 'live-output'
      ) return

      persistCodexSessionIdentity(dbService, sessionId, extractedThreadId, 'live-output')
      console.log(`[codex-thread] ${sessionId}: captured ${extractedThreadId} from live-output`)
    })().catch((err) => {
      console.error(`[codex-thread] ${sessionId}: failed to persist live-output identity`, err)
    })
  })

  // Detect failed resumes (e.g. "No conversation found to continue")
  ptyService.onExit((sessionId, exitCode) => {
    let scrollbackText = ''
    let session: any | undefined
    try {
      scrollbackText = ptyService.scrollback.getScrollback(sessionId)
      session = dbService.getSession(sessionId)
      const agent = session ? null : dbService.getAgent(sessionId)

      if (session) {
        dbService.updateSession(sessionId, { status: 'idle', pid: null })
      } else if (agent) {
        dbService.updateAgent(sessionId, { status: 'idle', pid: null })
      }

      if (session) {
        persistSessionExitSummary(dbService, sessionId, scrollbackText, exitCode)
      }
    } catch (err) {
      console.error(`[pty-exit] ${sessionId}: failed to persist exit state`, err)
      if (preparingUpdate) updatePersistenceError = err
      return
    }

    if (session && session.provider === 'codex' && session.type !== 'quick-terminal') {
      const cwd = resolveSessionWorkingDirectory(dbService, session, { allowProjectFallback: true })
      const allowCwdRecovery = canRecoverSessionByCwd(dbService, session)
      const persistenceTask = (async () => {
        const { providerSessionId, source } = await resolveCodexExitThreadIdentity(session, scrollbackText, {
          cwd,
          allowCwdRecovery
        })
        if (providerSessionId && source) {
          persistCodexSessionIdentity(dbService, sessionId, providerSessionId, source)
          console.log(`[codex-thread] ${sessionId}: stored ${providerSessionId} from ${source}`)
        } else if (!session.provider_session_id) {
          markSessionResumeState(
            dbService,
            sessionId,
            'degraded',
            'Codex thread identity was never captured for this session.'
          )
        }
      })().catch((err) => {
        console.error(`[codex-thread] ${sessionId}: failed to persist exit identity`, err)
        if (preparingUpdate) updatePersistenceError = err
      })
      trackExitPersistence(persistenceTask)
    }

    const reason = checkResumeFailed(sessionId, scrollbackText)
    if (reason) {
      console.log(`[resume-failed] ${sessionId}: ${reason} (exit code ${exitCode})`)
      if (session) {
        console.log(
          `[resume-failed] details provider=${session.provider} claude_session_id=${session.claude_session_id || ''} provider_session_id=${session.provider_session_id || ''} cwd=${session.worktree_path || ''}`
        )
      }
      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:resume-failed', { sessionId, reason })
      }
    }
  })

  // Note: Scheduled agents are managed by the AgentOrchestrator (schedule-based).
  // The old auto-restart handler was removed — orchestrator handles all scheduling.

  // Save window bounds on resize/move
  mainWindow.on('resize', scheduleSaveWindowBounds)
  mainWindow.on('move', scheduleSaveWindowBounds)
  mainWindow.on('maximize', scheduleSaveWindowBounds)
  mainWindow.on('unmaximize', scheduleSaveWindowBounds)

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', flushWindowBounds)

  mainWindow.on('closed', () => {
    flushWindowBounds()
    popoutService.closeAll()
    mainWindow = null
  })

  setImmediate(() => {
    const startupTask = (async () => {
      if (isShuttingDown) return
      try {
        refreshProviderRegistry(dbService)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('providers:updated')
        }
      } catch (err) {
        console.error('[providers] Startup refresh failed (non-fatal):', err)
      }

      if (isShuttingDown) return

      try {
        const result = await reconcileCodexSessions(dbService)
        if (result.updated > 0) {
          console.log(`[codex-reconcile] checked ${result.checked}, updated ${result.updated}`)
        }
      } catch (err) {
        console.error('[codex-reconcile] Startup reconciliation failed (non-fatal):', err)
      }

      if (isShuttingDown) return

      // One-time cleanup: clear mock team_name values from sessions
      try {
        if (!dbService.getSetting('teamLinkCleanupDone')) {
          const allSessions = dbService.listSessions()
          for (const s of allSessions) {
            if (s.team_name) {
              dbService.updateSession(s.id, { team_name: null })
            }
          }
          dbService.setSetting('teamLinkCleanupDone', '1')
        }
      } catch (err) {
        console.error('[startup] Team cleanup failed:', err)
      }

      if (isShuttingDown) return

      // Crash recovery: auto-commit orphaned worktrees
      try {
        const allProjects = dbService.listProjects()
        const allSessions = dbService.listSessions()
        for (const project of allProjects) {
          try {
            const gitDir = path.join(project.path as string, '.git')
            if (!fs.existsSync(gitDir)) continue

            const worktrees = await worktreeService.list(project.path)
            const root = worktreeService.getWorkspacesRoot()

            for (const wt of worktrees) {
              if (!wt.startsWith(root)) continue

              const hasSession = allSessions.some(
                (s: any) => s.worktree_path === wt && s.status !== 'deleted'
              )

              if (!hasSession) {
                console.log('[crash-recovery] Orphaned worktree found:', wt)
                const commitResult = await worktreeService.autoCommit(wt)
                if (commitResult.committed) {
                  console.log('[crash-recovery] Auto-committed orphaned work:', commitResult.message)
                }
              }
            }
          } catch (err) {
            console.log('[crash-recovery] Failed to check project:', project.name, err)
          }
        }
      } catch (err) {
        console.error('[crash-recovery] Failed:', err)
      }

      if (isShuttingDown) return

      // Recover orphaned worktree directories that lack DB session records
      try {
        const services = { db: dbService, pty: ptyService, worktree: worktreeService, fileWatcher: fileWatcherService }
        const allProjects = dbService.listProjects()
        for (const project of allProjects) {
          try {
            const result = await syncWorktrees(services, project.id)
            if (result.created > 0 || result.removed > 0) {
              console.log(`[startup-sync] ${project.name}: recovered ${result.created}, cleaned ${result.removed}`)
            }
          } catch (err) {
            console.log('[startup-sync] Failed for project:', project.name, err)
          }
        }
      } catch (err) {
        console.error('[startup-sync] Failed:', err)
      }

      if (isShuttingDown) return

      // Auto-start agents configured for auto_start (immediate, outside of schedule)
      try {
        const autoStartAgents = dbService.listAgents().filter((a: any) => a.auto_start === 1 && a.mission)
        if (autoStartAgents.length > 0) {
          for (const agent of autoStartAgents) {
            try {
              agentOrchestrator?.runNow(agent.id)
              console.log(`[startup] Auto-started agent: ${agent.name}`)
            } catch (err) {
              console.error(`[startup] Failed to auto-start agent ${agent.name}:`, err)
            }
          }
        }
      } catch (err) {
        console.error('[startup] Auto-start agent scan failed:', err)
      }

      if (isShuttingDown) return

      // Auto-start remote access if previously enabled
      try {
        const remoteEnabled = dbService.getSetting('remoteEnabled')
        if (remoteEnabled === 'true') {
          const remoteStartupTask = import('./server/api-server').then(async ({ ApiServer }) => {
            const { getOrCreateAuthToken } = await import('./server/auth')
            const port = parseInt(dbService.getSetting('remotePort') || '7437')
            const bindAddress = dbService.getSetting('remoteBindAddress') || '127.0.0.1'
            const authToken = getOrCreateAuthToken(dbService)

            const net = await import('net')
            const portAvailable = await new Promise<boolean>((resolve) => {
              const tester = net.createServer()
              tester.once('error', () => resolve(false))
              tester.listen(port, bindAddress, () => {
                tester.close(() => resolve(true))
              })
            })

            if (!portAvailable) {
              console.log(`[remote-access] Port ${port} already in use, skipping auto-start (another instance may be running)`)
              return
            }

            const { setGlobalApiServer } = await import('./ipc/handlers')
            const server = new ApiServer(
              { db: dbService, pty: ptyService, worktree: worktreeService, fileWatcher: fileWatcherService },
              { port, bindAddress, authToken }
            )
            if (isShuttingDown) return
            await server.start()
            if (isShuttingDown) {
              server.stop()
              return
            }
            setGlobalApiServer(server)
            console.log(`[remote-access] Auto-started on ${bindAddress}:${port}`)
          }).catch((err) => {
            console.error('[remote-access] Auto-start failed:', err)
          })
          trackStartupTask(remoteStartupTask)
        }
      } catch (err) {
        console.error('[remote-access] Startup check failed:', err)
      }

      // ── Statusline: auto-configure + watch rate limits ────────
      const sorcererDir = path.join(os.homedir(), '.sorcerer')
      const statuslineScript = path.join(sorcererDir, 'statusline.cjs')
      try {
        const src = [
          '// Sorcerer statusline script for Claude Code.',
          '// Claude Code pipes JSON on stdin after every response.',
          'const fs = require("fs"), path = require("path");',
          'let input = "";',
          'process.stdin.setEncoding("utf8");',
          'process.stdin.on("data", (c) => { input += c });',
          'process.stdin.on("end", () => {',
          '  try {',
          '    const d = JSON.parse(input), out = {};',
          '    if (d.rate_limits) out.rateLimits = d.rate_limits;',
          '    if (d.cost) out.cost = d.cost;',
          '    out.model = (d.model && (d.model.display_name || d.model.id)) || "";',
          '    out.timestamp = Date.now();',
          '    const dir = path.join(require("os").homedir(), ".sorcerer");',
          '    fs.mkdirSync(dir, { recursive: true });',
          '    fs.writeFileSync(path.join(dir, "rate-limits.json"), JSON.stringify(out));',
          '  } catch {}',
          '});',
        ].join('\n')
        fs.mkdirSync(sorcererDir, { recursive: true })
        const existing = fs.existsSync(statuslineScript) ? fs.readFileSync(statuslineScript, 'utf8') : ''
        if (src !== existing) fs.writeFileSync(statuslineScript, src)

        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')
        if (fs.existsSync(claudeSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'))
          const expectedCmd = `node "${statuslineScript.replace(/\\/g, '/')}"`
          if (!settings.statusLine || settings.statusLine.command !== expectedCmd) {
            settings.statusLine = { type: 'command', command: expectedCmd }
            fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2))
            console.log('[statusline] Configured Claude Code to use Sorcerer statusline')
          }
        }
      } catch (err) {
        console.log('[statusline] Setup failed (non-fatal):', err)
      }

      const rateLimitsPath = path.join(sorcererDir, 'rate-limits.json')
      try {
        if (!fs.existsSync(rateLimitsPath)) fs.writeFileSync(rateLimitsPath, '{}')
        rateLimitsWatcher?.close()
        rateLimitsWatcher = fs.watch(rateLimitsPath, () => {
          if (rateLimitsDebounceTimer) clearTimeout(rateLimitsDebounceTimer)
          rateLimitsDebounceTimer = setTimeout(() => {
            try {
              const data = JSON.parse(fs.readFileSync(rateLimitsPath, 'utf8'))
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('rate-limits:updated', data)
              }
            } catch { /* ignore parse errors */ }
          }, 200)
        })
      } catch (err) {
        console.log('[statusline] Rate limit watcher failed (non-fatal):', err)
      }
    })()
    trackStartupTask(startupTask)
  })
}

app.whenReady().then(() => {
  void createWindow().catch((err) => {
    console.error('[startup] Window creation failed:', err)
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      isShuttingDown = false
      void createWindow().catch((err) => {
        console.error('[startup] Window recreation failed:', err)
      })
    }
  })
})

app.on('before-quit', () => {
  isShuttingDown = true
  updateService?.stop()
})

app.on('window-all-closed', () => {
  void (async () => {
    try {
      isShuttingDown = true
      flushWindowBounds()
      // Give PTY exit handlers a brief chance to persist final state before the DB closes.
      if (ptyService) await ptyService.killAllAndWait()
      await waitForExitPersistence()
      await waitForStartupTasks()
      agentOrchestrator?.stop()
      agentOrchestrator = null
      if (rateLimitsDebounceTimer) {
        clearTimeout(rateLimitsDebounceTimer)
        rateLimitsDebounceTimer = null
      }
      if (rateLimitsWatcher) {
        rateLimitsWatcher.close()
        rateLimitsWatcher = null
      }
      if (fileWatcherService) fileWatcherService.close()

      // Stop remote access server
      import('./ipc/handlers').then(({ getGlobalApiServer }) => {
        const server = getGlobalApiServer()
        if (server) server.stop()
      }).catch(() => {})

      if (dbService) {
        try {
          dbService.close()
        } catch (err) {
          console.error('[shutdown] Failed to close database cleanly:', err)
        }
      }
    } catch (err) {
      console.error('[shutdown] Failed during window-all-closed cleanup:', err)
    } finally {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    }
  })()
})

// Handle window control IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('window:openExternal', (_e, url: string) => {
  if (!isExternalWebUrl(url)) throw new Error('Only HTTP and HTTPS links can be opened')
  return shell.openExternal(url)
})
ipcMain.handle('window:openPath', (_e, p: string) => shell.openPath(p))
ipcMain.on('window:setTitleBarOverlay', (_e, options: { color: string; symbolColor: string }) => {
  if (process.platform !== 'darwin') {
    // Update main window
    if (mainWindow) {
      try { mainWindow.setTitleBarOverlay({ ...options, height: 36 }) } catch { /* unsupported */ }
    }
    // Update all pop-out windows
    if (popoutService) {
      for (const win of popoutService.getAllWindows()) {
        try { win.setTitleBarOverlay({ ...options, height: 36 }) } catch { /* ignore */ }
      }
    }
  }
})

// ── Pop-out window IPC ──────────────────────────────────────
ipcMain.handle('popout:open', (_e, panelType: string, panelId: string, entityName: string) => {
  if (preparingUpdate) throw new Error('Sorcerer is preparing to install an update.')
  const themeId = dbService?.getSetting('theme') || 'default'

  // Look up project name and branch for the popout header
  let projectName: string | undefined
  let branch: string | undefined
  const session = dbService?.getSession(panelId)
  if (session) {
    branch = session.branch as string | undefined
    const project = session.project_id ? dbService?.getProject(session.project_id as string) : null
    if (project) projectName = project.name as string
  }

  const { win, windowId } = popoutService.open({ panelType, panelId, entityName, themeId, projectName, branch })

  // Register the pop-out window as a listener for terminal data
  if (panelType === 'terminal' && !panelId.startsWith('quicknotes:')) {
    const wc = win.webContents
    ptyService.addListener(panelId, wc)
    win.on('closed', () => {
      ptyService.removeListener(panelId, wc)
    })
  }

  return { opened: true, windowId }
})

ipcMain.handle('popout:close', (_e, panelId: string) => {
  popoutService.close(panelId)
  return { closed: true }
})

ipcMain.handle('popout:isOpen', (_e, panelId: string) => {
  return popoutService.isOpen(panelId)
})

ipcMain.handle('popout:getScrollback', (_e, sessionId: string) => {
  const live = ptyService.scrollback.getScrollback(sessionId)
  if (live) return live

  const session = dbService?.getSession(sessionId)
  return (session?.last_output_tail as string | undefined) || ''
})

ipcMain.handle('popout:getEntities', (_e, panelIds: string[]) => {
  return collectPopoutEntities(panelIds)
})

// When a popout window resumes/restarts a session, notify the main window
// so its Zustand store updates the status dot
ipcMain.on('popout:sessionUpdated', (_e, sessionId: string, status: string, pid: number | null) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout:sessionUpdated', sessionId, status, pid)
    }
  } catch { /* main window already destroyed */ }
})

ipcMain.on('popout:broadcastTheme', (_e, themeId: string) => {
  for (const win of popoutService.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('popout:theme-update', themeId)
      }
    } catch { /* window already destroyed */ }
  }
})

ipcMain.handle('popout:syncPanels', (e, windowId: string, panelIds: string[]) => {
  const diff = popoutService.updatePanels(windowId, panelIds)
  const win = popoutService.getWindowByWebContentsId(e.sender.id)
  if (!win) return diff

  for (const panelId of diff.added) {
    if (!panelId.startsWith('quicknotes:')) {
      ptyService.addListener(panelId, win.webContents)
    }
  }
  for (const panelId of diff.removed) {
    if (!panelId.startsWith('quicknotes:')) {
      ptyService.removeListener(panelId, win.webContents)
    }
  }
  return diff
})

ipcMain.handle('popout:setSelectionTargetReady', (_e, windowId: string, ready: boolean) => {
  popoutService.setSelectionTargetReady(windowId, ready)
  return { ok: true }
})

ipcMain.handle('popout:assignToSelectionTarget', (_e, panelId: string) => {
  return popoutService.assignToSelectionTarget(panelId)
})
