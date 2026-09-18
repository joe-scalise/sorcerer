import { ipcMain, dialog, shell, app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import os from 'os'
import path from 'path'
import fs from 'fs'
import simpleGit from 'simple-git'
import { PTYService } from '../services/pty-service'
import { DatabaseService } from '../services/database-service'
import { WorktreeService } from '../services/worktree-service'
import { FileWatcherService } from '../services/file-watcher-service'
import { isExternalWebUrl } from '../window-security'
import {
  HandlerServices,
  listProjects,
  addProjectByPath,
  updateProject,
  removeProject,
  syncWorktrees,
  getProjectGitStatus,
  listSessions,
  createSession,
  spawnShell,
  createQuickTerminal,
  renameSession,
  killSession,
  archiveSession,
  deleteSession,
  restartSession,
  resumeSession,
  setSessionTeam,
  pushSessionBranch,
  checkDeleteSafety,
  getSessionGitStatus,
  landOnMain,
  restoreSession,
  listAgents,
  addAgent,
  updateAgent as updateAgentHandler,
  removeAgent,
  startAgent,
  resumeAgent,
  restartAgent,
  createAgentQuickTerminal,
  killAgent,
  terminalWrite,
  terminalResize,
  listTeams,
  getTeamTasks,
  getTeamInbox,
  getSetting,
  setSetting,
  listProviders,
  refreshProviders,
  scanImportableSessions,
  importExternalSessions,
  getUserInfo,
  getNetworkIp,
  hasClaudeConversation,
  getSessionResumeHealth,
  getSessionDiagnostics,
  listProviderSubAgents,
  loadQuickNote,
  saveQuickNote,
  deleteQuickNote,
  listQuickNoteParents,
  setSessionRemoteControl,
  setAgentRemoteControl
} from './shared-handlers'
import {
  buildAndroidPairingIntent,
  normalizePairingHost,
  parseRemotePort
} from '../server/remote-network'

interface RemoteApiServer {
  start(): Promise<void>
  stop(): void
  isRunning(): boolean
  getRemoteSessionIds(): string[]
  setAuthToken?(token: string): void
  createPairingCode?(ttlMs?: number): {
    code: string
    expiresAt: number
    protocolVersion: number
  }
  listPairedDevices?(): unknown[]
  revokePairedDevice?(deviceId: string): boolean
}

let globalApiServer: RemoteApiServer | null = null

export function getGlobalApiServer(): RemoteApiServer | null { return globalApiServer }
export function setGlobalApiServer(server: RemoteApiServer): void { globalApiServer = server }

function getPairingHost(bindAddress: string, advertisedHost?: unknown): string {
  if (advertisedHost !== undefined && typeof advertisedHost !== 'string') {
    throw new Error('Phone address must be a string.')
  }
  const wildcardBind = bindAddress === '0.0.0.0' || bindAddress === '::'
  const requestedHost = typeof advertisedHost === 'string' ? advertisedHost.trim() : ''
  const candidate = wildcardBind ? requestedHost || getNetworkIp() : bindAddress
  return normalizePairingHost(candidate)
}

export function registerIPC(
  ptyService: PTYService,
  dbService: DatabaseService,
  worktreeService: WorktreeService,
  fileWatcherService: FileWatcherService
): void {
  const services: HandlerServices = {
    db: dbService,
    pty: ptyService,
    worktree: worktreeService,
    fileWatcher: fileWatcherService
  }

  // ── Project operations ──────────────────────────────────────

  ipcMain.handle('project:list', () => {
    return listProjects(services)
  })

  // Electron-only: uses dialog.showOpenDialog
  ipcMain.handle('project:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a Project Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const projectPath = result.filePaths[0]
    const name = path.basename(projectPath)

    // Check if project already exists
    const existing = dbService.listProjects().find((p: any) => p.path === projectPath)
    if (existing) {
      return existing // Return existing project instead of erroring
    }

    const id = uuidv4()
    return dbService.addProject(id, name, projectPath)
  })

  ipcMain.handle('system:pick-path', async (_event, options?: {
    title?: string
    mode?: 'file' | 'directory'
    filters?: Array<{ name: string; extensions: string[] }>
  }) => {
    const mode = options?.mode === 'file' ? 'file' : 'directory'
    const result = await dialog.showOpenDialog({
      title: options?.title || (mode === 'file' ? 'Select a File' : 'Select a Folder'),
      properties: mode === 'file' ? ['openFile'] : ['openDirectory'],
      filters: options?.filters
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('project:addPath', (_event, projectPath: string, customName?: string) => {
    return addProjectByPath(services, projectPath, customName)
  })

  // ── Workspace orphan detection ─────────────────────────────

  ipcMain.handle('workspace:scan-orphans', () => {
    const root = worktreeService.getWorkspacesRoot()
    if (!fs.existsSync(root)) return []

    const projects = dbService.listProjects()
    const knownNames = new Set(projects.map((p: any) => path.basename(p.path)))

    // Load dismissed list
    const dismissedRaw = dbService.getSetting('dismissedWorkspaces')
    const dismissed = new Set<string>(dismissedRaw ? JSON.parse(dismissedRaw) : [])

    const entries = fs.readdirSync(root, { withFileTypes: true })
    const orphans: { dirName: string; sessionCount: number; fullPath: string; lastModified: string; diskSize: number }[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (knownNames.has(entry.name)) continue
      if (dismissed.has(entry.name)) continue

      const dirPath = path.join(root, entry.name)
      // Count child directories (sessions) and gather stats
      let sessionCount = 0
      let lastModified = new Date(0)
      let diskSize = 0
      try {
        const children = fs.readdirSync(dirPath, { withFileTypes: true })
        for (const child of children) {
          if (child.isDirectory()) {
            sessionCount++
            try {
              const stat = fs.statSync(path.join(dirPath, child.name))
              if (stat.mtime > lastModified) lastModified = stat.mtime
              diskSize += stat.size
            } catch { /* skip */ }
          }
        }
      } catch { /* skip unreadable */ }

      if (sessionCount > 0) {
        const dirStat = fs.statSync(dirPath)
        if (dirStat.mtime > lastModified) lastModified = dirStat.mtime
        orphans.push({ dirName: entry.name, sessionCount, fullPath: dirPath, lastModified: lastModified.toISOString(), diskSize })
      }
    }

    return orphans
  })

  ipcMain.handle('workspace:dismiss-orphan', (_event, dirName: string) => {
    const raw = dbService.getSetting('dismissedWorkspaces')
    const list: string[] = raw ? JSON.parse(raw) : []
    if (!list.includes(dirName)) {
      list.push(dirName)
    }
    dbService.setSetting('dismissedWorkspaces', JSON.stringify(list))
  })

  // ── Agent orphan detection ──────────────────────────────────

  ipcMain.handle('workspace:scan-orphan-agents', () => {
    const agentsRoot = path.join(os.homedir(), '.sorcerer', 'agents')
    if (!fs.existsSync(agentsRoot)) return []

    const knownAgents = dbService.listAgents()
    const knownIds = new Set(knownAgents.map((a: any) => a.id))

    const dismissedRaw = dbService.getSetting('dismissedAgents')
    const dismissed = new Set<string>(dismissedRaw ? JSON.parse(dismissedRaw) : [])

    const entries = fs.readdirSync(agentsRoot, { withFileTypes: true })
    const orphans: { dirName: string; agentName: string; fullPath: string; hasManifest: boolean; manifest?: any; lastModified: string; fileCount: number }[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (knownIds.has(entry.name)) continue
      if (dismissed.has(entry.name)) continue

      const dirPath = path.join(agentsRoot, entry.name)
      const manifestPath = path.join(dirPath, 'agent.json')
      let hasManifest = false
      let manifest: any = null
      let agentName = entry.name

      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          hasManifest = true
          if (manifest.name) agentName = manifest.name
        } catch { /* ignore corrupt manifest */ }
      }

      // Gather directory stats
      let lastModified = new Date(0)
      let fileCount = 0
      try {
        const dirStat = fs.statSync(dirPath)
        lastModified = dirStat.mtime
        const children = fs.readdirSync(dirPath)
        fileCount = children.length
        for (const child of children) {
          try {
            const childStat = fs.statSync(path.join(dirPath, child))
            if (childStat.mtime > lastModified) lastModified = childStat.mtime
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      orphans.push({ dirName: entry.name, agentName, fullPath: dirPath, hasManifest, manifest, lastModified: lastModified.toISOString(), fileCount })
    }

    return orphans
  })

  ipcMain.handle('workspace:dismiss-orphan-agent', (_event, dirName: string) => {
    const raw = dbService.getSetting('dismissedAgents')
    const list: string[] = raw ? JSON.parse(raw) : []
    if (!list.includes(dirName)) {
      list.push(dirName)
    }
    dbService.setSetting('dismissedAgents', JSON.stringify(list))
  })

  ipcMain.handle('workspace:delete-orphan', (_event, dirName: string) => {
    const root = worktreeService.getWorkspacesRoot()
    const dirPath = path.join(root, dirName)
    // Safety: only delete if it's actually inside the workspaces root
    if (!dirPath.startsWith(root) || !fs.existsSync(dirPath)) return
    fs.rmSync(dirPath, { recursive: true, force: true })
  })

  ipcMain.handle('workspace:delete-orphan-agent', (_event, dirName: string) => {
    const agentsRoot = path.join(os.homedir(), '.sorcerer', 'agents')
    const dirPath = path.join(agentsRoot, dirName)
    // Safety: only delete if it's actually inside the agents root
    if (!dirPath.startsWith(agentsRoot) || !fs.existsSync(dirPath)) return
    fs.rmSync(dirPath, { recursive: true, force: true })
  })

  ipcMain.handle('project:reorder', (_event, projectIds: string[]) => {
    dbService.reorderProjects(projectIds)
  })

  // ── Project group operations ───────────────────────────────

  ipcMain.handle('project-group:list', () => {
    return dbService.listProjectGroups()
  })

  ipcMain.handle('project-group:add', (_event, name: string) => {
    const id = uuidv4()
    return dbService.addProjectGroup(id, name)
  })

  ipcMain.handle('project-group:update', (_event, id: string, updates: { name?: string }) => {
    return dbService.updateProjectGroup(id, updates)
  })

  ipcMain.handle('project-group:remove', (_event, id: string) => {
    dbService.removeProjectGroup(id)
  })

  ipcMain.handle('project-group:reorder', (_event, groupIds: string[]) => {
    dbService.reorderProjectGroups(groupIds)
  })

  ipcMain.handle('project:update', (_event, id: string, updates: any) => {
    return updateProject(services, id, updates)
  })

  ipcMain.handle('project:remove', (_event, id: string) => {
    return removeProject(services, id)
  })

  ipcMain.handle('project:sync-worktrees', async (_event, projectId: string) => {
    return syncWorktrees(services, projectId)
  })

  ipcMain.handle('project:git-status', async (_event, projectPath: string) => {
    return getProjectGitStatus(services, projectPath)
  })

  ipcMain.handle('project:check-git', (_event, projectId: string) => {
    const project = dbService.getProject(projectId)
    if (!project) return { hasGit: false, hasCommits: false }
    const hasGit = fs.existsSync(path.join(project.path as string, '.git'))
    let hasCommits = false
    if (hasGit) {
      try {
        // Quick check: HEAD ref exists
        fs.accessSync(path.join(project.path as string, '.git', 'HEAD'))
        const headContent = fs.readFileSync(path.join(project.path as string, '.git', 'HEAD'), 'utf8')
        // If HEAD points to a ref, check if that ref file exists (has commits)
        if (headContent.startsWith('ref: ')) {
          const refPath = path.join(project.path as string, '.git', headContent.trim().slice(5))
          hasCommits = fs.existsSync(refPath)
        } else {
          // Detached HEAD with a hash = has commits
          hasCommits = true
        }
      } catch { /* no commits */ }
    }
    return { hasGit, hasCommits }
  })

  // ── Session operations ──────────────────────────────────────

  // Load custom shell setting on startup
  const customShell = dbService.getSetting('shell')
  if (customShell) {
    ptyService.setCustomShell(customShell)
  }

  ipcMain.handle('session:list', (_event, projectId?: string) => {
    return listSessions(services, projectId)
  })

  ipcMain.handle('session:create', (_e, projectId: string, name: string, useMainRepo?: boolean, bypassPermissions?: boolean, remoteControl?: boolean, provider?: string, model?: string) => {
    return createSession(services, projectId, name, useMainRepo, bypassPermissions, remoteControl, provider, model)
  })

  ipcMain.handle('provider:list', () => {
    return listProviders(services)
  })

  ipcMain.handle('provider:refresh', () => {
    return refreshProviders(services)
  })

  ipcMain.handle('session:spawn-shell', (_event, sessionId: string, cwd: string) => {
    return spawnShell(services, sessionId, cwd)
  })

  ipcMain.handle('session:create-quick-terminal', async (_event, sourceSessionId: string) => {
    return createQuickTerminal(services, sourceSessionId)
  })

  ipcMain.handle('session:create-project-quick-terminal', async (_event, projectId: string) => {
    const project = dbService.getProject(projectId)
    if (!project) throw new Error('Project not found')

    // Generate unique name
    const projectSessions = dbService.listSessions(projectId)
    const terminalNames = projectSessions
      .filter((s: any) => s.type === 'quick-terminal' && s.status !== 'deleted')
      .map((s: any) => s.name as string)
    let name = 'Terminal'
    if (terminalNames.includes(name)) {
      let n = 2
      while (terminalNames.includes(`Terminal (${n})`)) n++
      name = `Terminal (${n})`
    }

    // Get current branch
    let branch = 'main'
    try {
      branch = (await simpleGit(project.path as string).revparse(['--abbrev-ref', 'HEAD'])).trim()
    } catch { /* fallback to main */ }

    const id = uuidv4()
    const session = dbService.addSession({
      id,
      project_id: projectId,
      name,
      branch,
      worktree_path: project.path as string,
      type: 'quick-terminal'
    })

    // Spawn plain shell in project root
    ptyService.spawn(id, project.path as string)
    const pid = ptyService.getPid(id)
    if (pid) {
      dbService.updateSession(id, { pid })
    }

    return session
  })

  ipcMain.handle('session:rename', (_event, sessionId: string, newName: string) => {
    return renameSession(services, sessionId, newName)
  })

  ipcMain.handle('session:kill', (_event, sessionId: string) => {
    return killSession(services, sessionId)
  })

  ipcMain.handle('session:archive', async (_event, sessionId: string) => {
    return archiveSession(services, sessionId)
  })

  ipcMain.handle('session:delete', async (_event, sessionId: string) => {
    return deleteSession(services, sessionId)
  })

  ipcMain.handle('session:restart', async (_event, sessionId: string) => {
    return restartSession(services, sessionId)
  })

  ipcMain.handle('session:resume', async (_event, sessionId: string) => {
    return resumeSession(services, sessionId)
  })

  ipcMain.handle('session:resume-health', (_event, sessionId: string) => {
    return getSessionResumeHealth(services, sessionId)
  })

  ipcMain.handle('session:diagnostics', (_event, sessionId: string) => {
    return getSessionDiagnostics(services, sessionId)
  })

  ipcMain.handle('session:list-provider-subagents', (_event, sessionId: string) => {
    return listProviderSubAgents(services, sessionId)
  })

  ipcMain.handle('session:scan-imports', (_event, projectId?: string) => {
    return scanImportableSessions(services, projectId)
  })

  ipcMain.handle('session:import', (_event, candidateIds: string[]) => {
    return importExternalSessions(services, candidateIds)
  })

  ipcMain.handle('session:has-conversation', (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) return false
    // Use worktree path if it exists, otherwise fall back to project path
    const cwd = fs.existsSync(session.worktree_path as string)
      ? (session.worktree_path as string)
      : (dbService.getProject(session.project_id as string)?.path as string)
    if (!cwd) return false
    return hasClaudeConversation(cwd)
  })

  ipcMain.handle('session:set-team', (_event, sessionId: string, teamName: string | null) => {
    return setSessionTeam(services, sessionId, teamName)
  })

  ipcMain.handle('session:push-branch', async (_event, sessionId: string) => {
    return pushSessionBranch(services, sessionId)
  })

  // Electron-only: uses shell.openExternal
  ipcMain.handle('session:open-remote', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = dbService.getProject(session.project_id as string)
    if (!project) throw new Error('Project not found')

    const url = await worktreeService.getRemoteUrl(project.path as string)
    if (url) {
      if (!isExternalWebUrl(url)) {
        return { opened: false, error: 'The remote URL must use HTTP or HTTPS to open in a browser' }
      }
      await shell.openExternal(url)
      return { opened: true, url }
    }
    return { opened: false, error: 'No remote URL found' }
  })

  ipcMain.handle('session:check-delete-safety', async (_event, sessionId: string) => {
    return checkDeleteSafety(services, sessionId)
  })

  ipcMain.handle('session:git-status', async (_event, sessionId: string) => {
    return getSessionGitStatus(services, sessionId)
  })

  ipcMain.handle('session:divergence', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session || !session.branch || session.type === 'quick-terminal') return null

    const project = dbService.getProject(session.project_id as string)
    if (!project) return null

    // Skip direct sessions (worktree_path === project.path)
    if (session.worktree_path === project.path) return null

    try {
      const git = simpleGit(project.path as string)

      // Find the default branch
      let defaultBranch = 'main'
      try {
        const branches = await git.branch()
        if (branches.all.includes('master') && !branches.all.includes('main')) {
          defaultBranch = 'master'
        }
      } catch { /* use main */ }

      const branch = session.branch as string
      const behind = await git.raw(['rev-list', '--count', `${branch}..${defaultBranch}`]).catch(() => '0')
      const ahead = await git.raw(['rev-list', '--count', `${defaultBranch}..${branch}`]).catch(() => '0')

      return {
        behind: parseInt(behind.trim()) || 0,
        ahead: parseInt(ahead.trim()) || 0
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('session:land-on-main', async (_event, sessionId: string) => {
    return landOnMain(services, sessionId)
  })

  ipcMain.handle('session:restore', (_event, sessionId: string) => {
    return restoreSession(services, sessionId)
  })

  ipcMain.handle('session:set-remote-control', (_event, sessionId: string, enabled: boolean) => {
    return setSessionRemoteControl(services, sessionId, enabled)
  })

  // ── Agent group operations ──────────────────────────────────

  ipcMain.handle('agent-group:list', () => {
    return dbService.listAgentGroups()
  })

  ipcMain.handle('agent-group:add', (_event, name: string) => {
    const id = uuidv4()
    return dbService.addAgentGroup(id, name)
  })

  ipcMain.handle('agent-group:update', (_event, id: string, updates: { name?: string }) => {
    return dbService.updateAgentGroup(id, updates)
  })

  ipcMain.handle('agent-group:remove', (_event, id: string) => {
    dbService.removeAgentGroup(id)
  })

  ipcMain.handle('agent-group:reorder', (_event, groupIds: string[]) => {
    dbService.reorderAgentGroups(groupIds)
  })

  // ── Agent operations ───────────────────────────────────────

  ipcMain.handle('agent:list', () => {
    return listAgents(services)
  })

  ipcMain.handle('agent:add', (_event, data: {
    id?: string; name: string; description?: string; system_prompt?: string; mcp_config?: string;
    bypass_permissions?: boolean; remote_control?: boolean;
    mission?: string; auto_start?: boolean; auto_restart?: boolean; restart_delay?: number; max_restarts?: number; schedule_minutes?: number;
    provider?: string; model?: string
  }) => {
    return addAgent(services, data)
  })

  ipcMain.handle('agent:update', (_event, id: string, updates: any) => {
    return updateAgentHandler(services, id, updates)
  })

  ipcMain.handle('agent:remove', (_event, id: string) => {
    return removeAgent(services, id)
  })

  ipcMain.handle('agent:start', (_event, agentId: string) => {
    return startAgent(services, agentId)
  })

  ipcMain.handle('agent:resume', (_event, agentId: string) => {
    return resumeAgent(services, agentId)
  })

  ipcMain.handle('agent:has-conversation', (_event, agentId: string) => {
    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
    if (!fs.existsSync(cwd)) return false
    return hasClaudeConversation(cwd)
  })

  ipcMain.handle('agent:restart', (_event, agentId: string) => {
    return restartAgent(services, agentId)
  })

  ipcMain.handle('agent:create-quick-terminal', (_event, agentId: string) => {
    return createAgentQuickTerminal(services, agentId)
  })

  ipcMain.handle('agent:kill', (_event, agentId: string) => {
    return killAgent(services, agentId)
  })

  ipcMain.handle('agent:set-remote-control', (_event, agentId: string, enabled: boolean) => {
    return setAgentRemoteControl(services, agentId, enabled)
  })

  ipcMain.handle('agent:list-runs', (_event, agentId: string, limit?: number) => {
    return dbService.listAgentRuns(agentId, limit || 20)
  })

  ipcMain.handle('agent:latest-run', (_event, agentId: string) => {
    return dbService.getLatestAgentRun(agentId)
  })

  // ── Terminal I/O ────────────────────────────────────────────

  ipcMain.on('terminal:write', (_event, sessionId: string, data: string) => {
    terminalWrite(services, sessionId, data)
  })

  ipcMain.on('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    terminalResize(services, sessionId, cols, rows)
  })

  // ── Team/agent monitoring ───────────────────────────────────

  ipcMain.handle('teams:list', () => {
    return listTeams(services)
  })

  ipcMain.handle('teams:tasks', (_event, teamName: string) => {
    return getTeamTasks(services, teamName)
  })

  ipcMain.handle('teams:inbox', (_event, teamName: string, agentName: string) => {
    return getTeamInbox(services, teamName, agentName)
  })

  // ── Settings ────────────────────────────────────────────────

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(services, key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    return setSetting(services, key, value)
  })

  // ── Quick Notes ─────────────────────────────────────────────

  ipcMain.handle('quick-notes:load', (_event, parentId: string, parentType: string) => {
    return loadQuickNote(services, parentId, parentType)
  })

  ipcMain.handle('quick-notes:save', (_event, id: string, parentId: string, parentType: string, content: string) => {
    return saveQuickNote(services, id, parentId, parentType, content)
  })

  ipcMain.handle('quick-notes:delete', (_event, parentId: string, parentType: string) => {
    return deleteQuickNote(services, parentId, parentType)
  })

  ipcMain.handle('quick-notes:list-parents', () => {
    return listQuickNoteParents(services)
  })

  // ── Briefing ──────────────────────────────────────────────

  ipcMain.handle('briefing:generate', async () => {
    const { generateBriefing } = await import('../services/briefing-service')
    const result = await generateBriefing(dbService, ptyService)

    // Auto-save successful briefings to archive
    if (result.text && !result.error) {
      const id = uuidv4()
      dbService.saveBriefing(id, result.text, result.provider, result.model)
    }

    return result
  })

  ipcMain.handle('briefing:list', (_event, limit?: number) => {
    return dbService.listBriefings(limit || 20)
  })

  ipcMain.handle('briefing:delete', (_event, id: string) => {
    dbService.deleteBriefing(id)
  })

  // ── Update check ───────────────────────────────────────────

  ipcMain.handle('system:check-update', async () => {
    try {
      const res = await fetch('https://api.github.com/repos/aetherci-hq/sorcerer/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Sorcerer' }
      })
      if (!res.ok) return null
      const data = await res.json()
      const latest = (data.tag_name || '').replace(/^v/, '')
      const current = app.getVersion()
      if (!latest) return null

      // Simple semver compare
      const toNum = (v: string) => v.split('.').map(Number)
      const [cMaj, cMin, cPat] = toNum(current)
      const [lMaj, lMin, lPat] = toNum(latest)
      const isNewer = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat)

      if (isNewer) {
        return { version: latest, url: data.html_url }
      }
      return null
    } catch {
      return null
    }
  })

  // ── Claude integration stats ───────────────────────────────

  ipcMain.handle('system:claude-stats', () => {
    const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json')
    if (!fs.existsSync(statsPath)) return null
    try {
      const raw = fs.readFileSync(statsPath, 'utf8')
      const data = JSON.parse(raw)

      const today = new Date().toISOString().slice(0, 10)
      const todayActivity = data.dailyActivity?.find((d: any) => d.date === today)
      const todayTokens = data.dailyModelTokens?.find((d: any) => d.date === today)

      // Sum tokens across all models for today
      let todayTotalTokens = 0
      if (todayTokens?.tokensByModel) {
        for (const count of Object.values(todayTokens.tokensByModel)) {
          todayTotalTokens += count as number
        }
      }

      // 7-day totals
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const sevenDayStr = sevenDaysAgo.toISOString().slice(0, 10)

      let weekMessages = 0
      let weekToolCalls = 0
      let weekTokens = 0
      for (const day of (data.dailyActivity || [])) {
        if (day.date >= sevenDayStr) {
          weekMessages += day.messageCount
          weekToolCalls += day.toolCallCount
        }
      }
      for (const day of (data.dailyModelTokens || [])) {
        if (day.date >= sevenDayStr && day.tokensByModel) {
          for (const count of Object.values(day.tokensByModel)) {
            weekTokens += count as number
          }
        }
      }

      // Read subscription/tier info from credentials
      let subscriptionType = ''
      let rateLimitTier = ''
      try {
        const credsPath = path.join(os.homedir(), '.claude', '.credentials.json')
        if (fs.existsSync(credsPath)) {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
          const oauth = creds.claudeAiOauth || {}
          subscriptionType = oauth.subscriptionType || ''
          rateLimitTier = oauth.rateLimitTier || ''
        }
      } catch { /* ignore */ }

      return {
        today: {
          messages: todayActivity?.messageCount || 0,
          sessions: todayActivity?.sessionCount || 0,
          toolCalls: todayActivity?.toolCallCount || 0,
          tokens: todayTotalTokens
        },
        week: {
          messages: weekMessages,
          toolCalls: weekToolCalls,
          tokens: weekTokens
        },
        allTime: {
          totalSessions: data.totalSessions || 0,
          totalMessages: data.totalMessages || 0,
          firstSessionDate: data.firstSessionDate || null
        },
        subscription: subscriptionType,
        rateLimitTier
      }
    } catch {
      return null
    }
  })

  // ── System info ─────────────────────────────────────────────

  ipcMain.handle('system:userInfo', () => {
    return getUserInfo()
  })

  ipcMain.handle('system:networkIp', () => {
    return getNetworkIp()
  })

  ipcMain.handle('system:workspaces-root', () => {
    return worktreeService.getWorkspacesRoot()
  })

  ipcMain.handle('system:memoryUsage', () => {
    const metrics = app.getAppMetrics()
    let totalMB = 0
    const breakdown: { type: string; pid: number; mb: number }[] = []
    for (const m of metrics) {
      const mb = Math.round(m.memory.workingSetSize / 1024)
      totalMB += mb
      breakdown.push({ type: m.type, pid: m.pid, mb })
    }
    return { totalMB, breakdown, processCount: metrics.length }
  })

  // ── Remote access ──────────────────────────────────────────

  ipcMain.handle('remote:remoteSessionIds', () => {
    return globalApiServer?.getRemoteSessionIds?.() ?? []
  })

  ipcMain.handle('remote:status', () => {
    return {
      running: globalApiServer?.isRunning() ?? false,
      port: dbService.getSetting('remotePort') || '7437',
      bindAddress: dbService.getSetting('remoteBindAddress') || '127.0.0.1',
      advertisedHost: dbService.getSetting('remoteAdvertisedHost') || '',
      token: dbService.getSetting('remoteAuthToken') || ''
    }
  })

  ipcMain.handle('remote:enable', async () => {
    const { ApiServer } = await import('../server/api-server')
    const { getOrCreateAuthToken } = await import('../server/auth')

    const port = parseRemotePort(dbService.getSetting('remotePort') || '7437')
    const bindAddress = dbService.getSetting('remoteBindAddress') || '127.0.0.1'
    const authToken = getOrCreateAuthToken(dbService)

    if (globalApiServer) globalApiServer.stop()
    globalApiServer = new ApiServer(services, { port, bindAddress, authToken })
    await globalApiServer.start()
    dbService.setSetting('remoteEnabled', 'true')
    return { port, bindAddress, token: authToken }
  })

  ipcMain.handle('remote:disable', () => {
    if (globalApiServer) { globalApiServer.stop(); globalApiServer = null }
    dbService.setSetting('remoteEnabled', 'false')
  })

  ipcMain.handle('remote:regenerate-token', async () => {
    const { regenerateAuthToken } = await import('../server/auth')
    const token = regenerateAuthToken(dbService)

    // Token rotation must invalidate the old credential immediately. Older
    // ApiServer implementations did not observe the value written to settings
    // until the next app restart, so prefer the live update API and retain a
    // restart fallback for compatibility.
    if (globalApiServer?.isRunning()) {
      if (globalApiServer.setAuthToken) {
        globalApiServer.setAuthToken(token)
      } else {
        const { ApiServer } = await import('../server/api-server')
        const port = parseRemotePort(dbService.getSetting('remotePort') || '7437')
        const bindAddress = dbService.getSetting('remoteBindAddress') || '127.0.0.1'
        globalApiServer.stop()
        globalApiServer = new ApiServer(services, { port, bindAddress, authToken: token })
        try {
          await globalApiServer.start()
        } catch (error) {
          dbService.setSetting('remoteEnabled', 'false')
          throw error
        }
      }
    }

    return token
  })

  ipcMain.handle('remote:update-config', (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Remote configuration must be an object.')
    }
    const config = value as Record<string, unknown>

    const port = config.port === undefined ? undefined : parseRemotePort(config.port, 1024)
    const bindAddress = config.bindAddress
    if (
      bindAddress !== undefined &&
      (typeof bindAddress !== 'string' || !['127.0.0.1', '0.0.0.0', '::1', '::'].includes(bindAddress))
    ) {
      throw new Error('Bind address must be a supported loopback or wildcard address.')
    }
    const advertisedHost = config.advertisedHost === undefined
      ? undefined
      : typeof config.advertisedHost === 'string' && config.advertisedHost.trim() === ''
        ? ''
        : normalizePairingHost(config.advertisedHost)

    // Validate every supplied field before persisting any of them, so an
    // invalid multi-field update cannot leave a partially changed config.
    if (port !== undefined) dbService.setSetting('remotePort', String(port))
    if (typeof bindAddress === 'string') dbService.setSetting('remoteBindAddress', bindAddress)
    if (advertisedHost !== undefined) dbService.setSetting('remoteAdvertisedHost', advertisedHost)
  })

  ipcMain.handle('remote:create-pairing-code', (_event, advertisedHost?: unknown) => {
    if (!globalApiServer?.isRunning() || !globalApiServer.createPairingCode) {
      throw new Error('Start remote access before pairing an Android device.')
    }

    const bindAddress = dbService.getSetting('remoteBindAddress') || '127.0.0.1'
    const host = getPairingHost(
      bindAddress,
      advertisedHost || dbService.getSetting('remoteAdvertisedHost')
    )
    const port = parseRemotePort(dbService.getSetting('remotePort') || '7437')
    const pairing = globalApiServer.createPairingCode(2 * 60 * 1000)
    // Pin QR dispatch to the production package. A bare custom-scheme URL can
    // be claimed by another installed app, which could race to redeem the
    // one-time code before Sorcerer Remote receives it.
    const deepLink = buildAndroidPairingIntent({
      scheme: 'http',
      host,
      port,
      code: pairing.code,
      protocolVersion: pairing.protocolVersion
    })

    return {
      ...pairing,
      scheme: 'http' as const,
      host,
      port,
      deepLink
    }
  })

  ipcMain.handle('remote:list-paired-devices', () => {
    return dbService.listMobileDevices()
  })

  ipcMain.handle('remote:revoke-paired-device', (_event, deviceId: string) => {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new Error('A device ID is required.')
    }

    // The running server owns active mobile sockets, so let it apply the
    // revocation immediately. The database fallback keeps device management
    // available while remote access is stopped.
    return globalApiServer?.revokePairedDevice?.(deviceId)
      ?? dbService.revokeMobileDevice(deviceId)
  })

  // Electron-only: uses child_process execSync and Windows registry
  ipcMain.handle('system:accountPicture', () => {
    // Windows: read account picture path from registry
    if (process.platform !== 'win32') return null
    try {
      const { execSync } = require('child_process')
      const regPath = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AccountPicture\\Users'
      const sidOutput = execSync(`reg query "${regPath}" /f * /k`, { encoding: 'utf8' })
      // Find the SID subkey for the current user
      const sidMatch = sidOutput.match(new RegExp(`${regPath.replace(/\\/g, '\\\\')}\\\\(S-[\\d-]+)`, 'i'))
      if (!sidMatch) return null
      const sid = sidMatch[1]
      // Query the Image96 value (good size for avatars)
      const imgOutput = execSync(`reg query "${regPath}\\${sid}" /v Image96`, { encoding: 'utf8' })
      const pathMatch = imgOutput.match(/Image96\s+REG_SZ\s+(.+)/i)
      if (!pathMatch) return null
      const imgPath = pathMatch[1].trim()
      if (!fs.existsSync(imgPath)) return null
      // Read and return as data URL
      const buf = fs.readFileSync(imgPath)
      const ext = path.extname(imgPath).slice(1) || 'jpg'
      return `data:image/${ext};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
}
