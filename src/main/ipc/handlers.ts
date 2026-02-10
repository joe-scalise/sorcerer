import { ipcMain, dialog, shell } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import os from 'os'
import simpleGit from 'simple-git'
import { PTYService } from '../services/pty-service'
import { DatabaseService } from '../services/database-service'
import { WorktreeService } from '../services/worktree-service'
import { FileWatcherService } from '../services/file-watcher-service'

/**
 * Build session-scoped env vars for Claude Code.
 * Each session gets its own CLAUDE_CODE_TASK_LIST_ID to prevent cross-session task contamination.
 */
function sessionEnv(sessionId: string): Record<string, string> {
  return {
    CLAUDE_CODE_TASK_LIST_ID: sessionId
  }
}

export function registerIPC(
  ptyService: PTYService,
  dbService: DatabaseService,
  worktreeService: WorktreeService,
  fileWatcherService: FileWatcherService
): void {
  // ── Project operations ──────────────────────────────────────

  ipcMain.handle('project:list', () => {
    return dbService.listProjects()
  })

  ipcMain.handle('project:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a Git Repository'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const projectPath = result.filePaths[0]
    const name = path.basename(projectPath)

    // Verify it's a git repo
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      throw new Error('Not a git repository')
    }

    // Check if project already exists
    const existing = dbService.listProjects().find((p: any) => p.path === projectPath)
    if (existing) {
      return existing // Return existing project instead of erroring
    }

    const id = uuidv4()
    return dbService.addProject(id, name, projectPath)
  })

  ipcMain.handle('project:addPath', (_event, projectPath: string, customName?: string) => {
    const name = customName || path.basename(projectPath)
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) {
      throw new Error('Selected directory is not a git repository')
    }
    const existing = dbService.listProjects().find((p: any) => p.path === projectPath)
    if (existing) return existing
    const id = uuidv4()
    return dbService.addProject(id, name, projectPath)
  })

  ipcMain.handle('project:update', (_event, id: string, updates: any) => {
    return dbService.updateProject(id, updates)
  })

  ipcMain.handle('project:remove', (_event, id: string) => {
    dbService.removeProject(id)
  })

  ipcMain.handle('project:git-status', async (_event, projectPath: string) => {
    try {
      const git = simpleGit(projectPath)
      const [branch, status, log] = await Promise.all([
        git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
        git.status(),
        git.log({ maxCount: 1 }).catch(() => null)
      ])

      // Ahead/behind from tracking branch
      let ahead = 0
      let behind = 0
      try {
        const tracking = status.tracking
        if (tracking) {
          ahead = status.ahead
          behind = status.behind
        }
      } catch { /* no tracking */ }

      return {
        branch: branch.trim(),
        dirty: !status.isClean(),
        modified: status.modified.length + status.renamed.length,
        staged: status.staged.length,
        untracked: status.not_added.length,
        ahead,
        behind,
        lastCommit: log?.latest?.message || null,
        lastCommitDate: log?.latest?.date || null
      }
    } catch {
      return null
    }
  })

  // ── Session operations ──────────────────────────────────────

  // Load custom shell setting on startup
  const customShell = dbService.getSetting('shell')
  if (customShell) {
    ptyService.setCustomShell(customShell)
  }

  ipcMain.handle('session:list', (_event, projectId?: string) => {
    return dbService.listSessions(projectId)
  })

  ipcMain.handle('session:create', async (_event, projectId: string, sessionName: string) => {
    console.log('[session:create] Starting:', { projectId, sessionName })
    const project = dbService.getProject(projectId)
    if (!project) throw new Error('Project not found')
    console.log('[session:create] Project found:', project.path)

    // Create git worktree
    const { worktreePath, branch } = await worktreeService.create(project.path, sessionName)
    console.log('[session:create] Worktree created:', { worktreePath, branch })

    // Create session record
    const id = uuidv4()
    const session = dbService.addSession({
      id,
      project_id: projectId,
      name: sessionName,
      branch,
      worktree_path: worktreePath
    })
    console.log('[session:create] Session saved:', { id, status: session?.status })

    // Spawn Claude Code directly in the worktree — no shell prompt visible
    ptyService.spawn(id, worktreePath, {
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
      env: sessionEnv(id)
    })
    const pid = ptyService.getPid(id)
    console.log('[session:create] Claude spawned, pid:', pid)
    if (pid) {
      dbService.updateSession(id, { pid })
    }

    // Push branch to remote on creation (fire-and-forget)
    worktreeService.pushBranch(project.path, branch).then((r) => {
      if (r.pushed) console.log('[session:create] Branch pushed to remote')
      else console.log('[session:create] Push skipped:', r.error)
    })

    return session
  })

  ipcMain.handle('session:spawn-shell', (_event, sessionId: string, cwd: string) => {
    // Spawn a plain shell session (no worktree needed)
    ptyService.spawn(sessionId, cwd)
    const pid = ptyService.getPid(sessionId)
    return { pid }
  })

  ipcMain.handle('session:kill', (_event, sessionId: string) => {
    ptyService.kill(sessionId)
    dbService.updateSession(sessionId, { status: 'idle', pid: null })
  })

  ipcMain.handle('session:archive', async (_event, sessionId: string) => {
    ptyService.kill(sessionId)

    const session = dbService.getSession(sessionId)
    if (session) {
      const project = dbService.getProject(session.project_id)

      // Auto-commit dirty work (non-destructive — worktree stays alive)
      if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
        const commitResult = await worktreeService.autoCommit(session.worktree_path as string)
        if (commitResult.committed) {
          console.log('[session:archive] Auto-committed:', commitResult.message)
        }
      }

      // Push to remote (fire-and-forget)
      if (project && session.branch) {
        worktreeService.pushBranch(project.path as string, session.branch as string).then((r) => {
          if (r.pushed) console.log('[session:archive] Pushed to remote')
          else console.log('[session:archive] Push skipped:', r.error)
        })
      }
    }

    dbService.updateSession(sessionId, {
      status: 'archived',
      pid: null,
      archived_at: Math.floor(Date.now() / 1000)
    })
  })

  ipcMain.handle('session:delete', async (_event, sessionId: string) => {
    if (ptyService.isRunning(sessionId)) {
      ptyService.kill(sessionId)
    }

    const session = dbService.getSession(sessionId)
    if (session) {
      const project = dbService.getProject(session.project_id as string)

      // Auto-commit dirty work before destruction
      if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
        const commitResult = await worktreeService.autoCommit(session.worktree_path as string)
        if (commitResult.committed) {
          console.log('[session:delete] Auto-committed:', commitResult.message)
        }
      }

      // Push to remote (blocking — ensure backup before destruction)
      if (project && session.branch) {
        const pushResult = await worktreeService.pushBranch(project.path as string, session.branch as string)
        if (pushResult.pushed) {
          console.log('[session:delete] Pushed to remote before deletion')
        } else {
          console.log('[session:delete] Push skipped:', pushResult.error)
        }
      }

      // Remove worktree + local branch
      if (project && session.worktree_path && fs.existsSync(session.worktree_path as string)) {
        try {
          await worktreeService.remove(project.path as string, session.worktree_path as string, session.branch as string)
        } catch (err) {
          console.log('[session:delete] Worktree cleanup failed (may already be removed):', err)
        }
      }

      // Delete remote branch (fire-and-forget)
      if (project && session.branch) {
        worktreeService.deleteRemoteBranch(project.path as string, session.branch as string).then((r) => {
          if (r.deleted) console.log('[session:delete] Remote branch deleted')
        })
      }
    }

    dbService.removeSession(sessionId)
  })

  ipcMain.handle('session:restart', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')

    // Kill existing process if running
    if (ptyService.isRunning(sessionId)) {
      ptyService.kill(sessionId)
    }

    // Check if worktree directory still exists
    const cwd = fs.existsSync(session.worktree_path as string)
      ? (session.worktree_path as string)
      : (dbService.getProject(session.project_id as string)?.path as string || process.cwd())

    // Re-spawn Claude Code directly in the worktree (fresh session)
    ptyService.spawn(sessionId, cwd, {
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
      env: sessionEnv(sessionId)
    })
    const pid = ptyService.getPid(sessionId)
    dbService.updateSession(sessionId, { status: 'active', pid: pid ?? null })

    return dbService.getSession(sessionId)
  })

  ipcMain.handle('session:resume', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')

    // Kill existing process if running
    if (ptyService.isRunning(sessionId)) {
      ptyService.kill(sessionId)
    }

    // Check if worktree directory still exists
    const cwd = fs.existsSync(session.worktree_path as string)
      ? (session.worktree_path as string)
      : (dbService.getProject(session.project_id as string)?.path as string || process.cwd())

    // Resume the most recent Claude Code conversation in this worktree
    ptyService.spawn(sessionId, cwd, {
      command: 'claude',
      args: ['--continue', '--dangerously-skip-permissions'],
      env: sessionEnv(sessionId)
    })
    const pid = ptyService.getPid(sessionId)
    dbService.updateSession(sessionId, { status: 'active', pid: pid ?? null })

    return dbService.getSession(sessionId)
  })

  ipcMain.handle('session:set-team', (_event, sessionId: string, teamName: string | null) => {
    dbService.updateSession(sessionId, { team_name: teamName })
    return dbService.getSession(sessionId)
  })

  ipcMain.handle('session:push-branch', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = dbService.getProject(session.project_id as string)
    if (!project) throw new Error('Project not found')

    // Auto-commit first
    if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
      const commitResult = await worktreeService.autoCommit(session.worktree_path as string)
      if (commitResult.committed) {
        console.log('[session:push-branch] Auto-committed:', commitResult.message)
      }
    }

    return worktreeService.pushBranch(project.path as string, session.branch as string)
  })

  ipcMain.handle('session:open-remote', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = dbService.getProject(session.project_id as string)
    if (!project) throw new Error('Project not found')

    const url = await worktreeService.getRemoteUrl(project.path as string)
    if (url) {
      shell.openExternal(url)
      return { opened: true, url }
    }
    return { opened: false, error: 'No remote URL found' }
  })

  ipcMain.handle('session:check-delete-safety', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = dbService.getProject(session.project_id as string)
    if (!project) return { dirty: false, unmergedCount: 0, hasRemote: false }

    let dirty = false
    if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
      try {
        const git = simpleGit(session.worktree_path as string)
        const status = await git.status()
        dirty = !status.isClean()
      } catch { /* ignore */ }
    }

    const { count: unmergedCount } = await worktreeService.hasUnmergedCommits(project.path as string, session.branch as string)

    let hasRemote = false
    try {
      const git = simpleGit(project.path as string)
      const remotes = await git.getRemotes(true)
      hasRemote = remotes.some((r) => r.name === 'origin')
    } catch { /* ignore */ }

    return { dirty, unmergedCount, hasRemote }
  })

  ipcMain.handle('session:git-status', async (_event, sessionId: string) => {
    const session = dbService.getSession(sessionId)
    if (!session) return null
    if (!session.worktree_path || !fs.existsSync(session.worktree_path as string)) return null
    return worktreeService.getSessionGitStatus(session.worktree_path as string)
  })

  ipcMain.handle('session:land-on-main', async (_event, sessionId: string) => {
    // Kill running process if active
    if (ptyService.isRunning(sessionId)) {
      ptyService.kill(sessionId)
    }

    const session = dbService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = dbService.getProject(session.project_id as string)
    if (!project) throw new Error('Project not found')

    // Auto-commit dirty work in the worktree
    if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
      const commitResult = await worktreeService.autoCommit(session.worktree_path as string)
      if (commitResult.committed) {
        console.log('[session:land-on-main] Auto-committed:', commitResult.message)
      }
    }

    // Squash merge to main
    const mergeResult = await worktreeService.squashMergeToMain(
      project.path as string,
      session.branch as string,
      session.name as string
    )

    if (!mergeResult.merged) {
      return { landed: false, error: mergeResult.error }
    }

    // Remove worktree + local branch
    if (session.worktree_path && fs.existsSync(session.worktree_path as string)) {
      try {
        await worktreeService.remove(project.path as string, session.worktree_path as string, session.branch as string)
      } catch (err) {
        console.log('[session:land-on-main] Worktree cleanup failed:', err)
      }
    }

    // Delete remote branch (fire-and-forget)
    if (session.branch) {
      worktreeService.deleteRemoteBranch(project.path as string, session.branch as string).then((r) => {
        if (r.deleted) console.log('[session:land-on-main] Remote branch deleted')
      })
    }

    // Remove session from DB
    dbService.removeSession(sessionId)

    return { landed: true }
  })

  ipcMain.handle('session:restore', (_event, sessionId: string) => {
    dbService.updateSession(sessionId, { status: 'idle', archived_at: null })
    return dbService.getSession(sessionId)
  })

  // ── Agent operations ───────────────────────────────────────

  ipcMain.handle('agent:list', () => {
    return dbService.listAgents()
  })

  ipcMain.handle('agent:add', (_event, data: { name: string; description?: string; system_prompt?: string; mcp_config?: string }) => {
    const id = uuidv4()
    // Create scratch directory for this agent
    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', id)
    fs.mkdirSync(cwd, { recursive: true })
    return dbService.addAgent({ id, ...data })
  })

  ipcMain.handle('agent:update', (_event, id: string, updates: any) => {
    return dbService.updateAgent(id, updates)
  })

  ipcMain.handle('agent:remove', (_event, id: string) => {
    if (ptyService.isRunning(id)) {
      ptyService.kill(id)
    }
    dbService.removeAgent(id)
  })

  ipcMain.handle('agent:start', (_event, agentId: string) => {
    const agent = dbService.getAgent(agentId)
    if (!agent) throw new Error('Agent not found')

    if (ptyService.isRunning(agentId)) {
      ptyService.kill(agentId)
    }

    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
    fs.mkdirSync(cwd, { recursive: true })

    const args = ['--dangerously-skip-permissions']
    if (agent.mcp_config) args.push('--mcp-config', agent.mcp_config as string)
    if (agent.system_prompt) args.push('--append-system-prompt', agent.system_prompt as string)

    ptyService.spawn(agentId, cwd, {
      command: 'claude',
      args,
      env: sessionEnv(agentId)
    })
    const pid = ptyService.getPid(agentId)
    dbService.updateAgent(agentId, { status: 'active', pid: pid ?? null })
    return dbService.getAgent(agentId)
  })

  ipcMain.handle('agent:resume', (_event, agentId: string) => {
    const agent = dbService.getAgent(agentId)
    if (!agent) throw new Error('Agent not found')

    if (ptyService.isRunning(agentId)) {
      ptyService.kill(agentId)
    }

    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
    fs.mkdirSync(cwd, { recursive: true })

    const args = ['--continue', '--dangerously-skip-permissions']
    if (agent.mcp_config) args.push('--mcp-config', agent.mcp_config as string)
    if (agent.system_prompt) args.push('--append-system-prompt', agent.system_prompt as string)

    ptyService.spawn(agentId, cwd, {
      command: 'claude',
      args,
      env: sessionEnv(agentId)
    })
    const pid = ptyService.getPid(agentId)
    dbService.updateAgent(agentId, { status: 'active', pid: pid ?? null })
    return dbService.getAgent(agentId)
  })

  ipcMain.handle('agent:restart', (_event, agentId: string) => {
    const agent = dbService.getAgent(agentId)
    if (!agent) throw new Error('Agent not found')

    if (ptyService.isRunning(agentId)) {
      ptyService.kill(agentId)
    }

    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
    fs.mkdirSync(cwd, { recursive: true })

    const args = ['--dangerously-skip-permissions']
    if (agent.mcp_config) args.push('--mcp-config', agent.mcp_config as string)
    if (agent.system_prompt) args.push('--append-system-prompt', agent.system_prompt as string)

    ptyService.spawn(agentId, cwd, {
      command: 'claude',
      args,
      env: sessionEnv(agentId)
    })
    const pid = ptyService.getPid(agentId)
    dbService.updateAgent(agentId, { status: 'active', pid: pid ?? null })
    return dbService.getAgent(agentId)
  })

  ipcMain.handle('agent:kill', (_event, agentId: string) => {
    if (ptyService.isRunning(agentId)) {
      ptyService.kill(agentId)
    }
    dbService.updateAgent(agentId, { status: 'idle', pid: null })
  })

  // ── Terminal I/O ────────────────────────────────────────────

  ipcMain.on('terminal:write', (_event, sessionId: string, data: string) => {
    ptyService.write(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    ptyService.resize(sessionId, cols, rows)
  })

  // ── Team/agent monitoring ───────────────────────────────────

  ipcMain.handle('teams:list', () => {
    return fileWatcherService.listTeams()
  })

  ipcMain.handle('teams:tasks', (_event, teamName: string) => {
    // Gather tasks from team-name directory
    const teamTasks = fileWatcherService.getTeamTasks(teamName)
    // Also gather tasks from session-ID and agent-ID directories linked to this team
    const sessions = dbService.listSessions()
    const linkedSessions = sessions.filter((s: any) => s.team_name === teamName)
    const agents = dbService.listAgents()
    const linkedAgents = agents.filter((a: any) => a.team_name === teamName)
    const sessionTasks = [...linkedSessions, ...linkedAgents].flatMap((item: any) =>
      fileWatcherService.getTeamTasks(item.id)
    )
    // Merge, deduplicate by id, and filter out internal team-spawn tasks
    const seen = new Set<string>()
    const merged: any[] = []
    for (const t of [...teamTasks, ...sessionTasks]) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      if (t.metadata?._internal) continue
      merged.push(t)
    }
    return merged
  })

  ipcMain.handle('teams:inbox', (_event, teamName: string, agentName: string) => {
    return fileWatcherService.getTeamInbox(teamName, agentName)
  })

  // ── Settings ────────────────────────────────────────────────

  ipcMain.handle('settings:get', (_event, key: string) => {
    return dbService.getSetting(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    dbService.setSetting(key, value)
    // Apply shell setting immediately
    if (key === 'shell') {
      ptyService.setCustomShell(value || undefined)
    }
  })
}
