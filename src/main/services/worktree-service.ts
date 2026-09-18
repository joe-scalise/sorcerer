import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Safely remove a directory that may contain Windows reserved filenames (nul, con, aux, etc).
 * Node.js tooling (npm, esbuild, etc.) sometimes creates files named 'nul' on Windows, which
 * are treated as device names and cannot be deleted through normal filesystem APIs.
 *
 * Safety: This function ONLY operates on paths under ~/.sorcerer/workspaces/ and rejects
 * any path that doesn't meet that constraint. The shell commands used (rd, del) are
 * standard Windows builtins that work identically to fs.rmSync — the only difference is
 * they handle reserved filenames that Node.js cannot.
 */
function forceRemoveDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return

  // Safety: only allow removal under the workspaces root
  const workspacesRoot = path.join(os.homedir(), '.sorcerer', 'workspaces')
  const resolved = path.resolve(dirPath)
  if (!resolved.startsWith(path.resolve(workspacesRoot) + path.sep)) {
    throw new Error(`forceRemoveDir refused: path is not under workspaces root: ${resolved}`)
  }

  if (process.platform === 'win32') {
    // First, clean any reserved filenames (nul, con, aux, etc.) that block normal deletion
    cleanReservedFiles(resolved)
    // Now try standard removal — should work after reserved files are gone
    try {
      fs.rmSync(resolved, { recursive: true, force: true })
      return
    } catch { /* ignore — directory may already be gone */ }
  } else {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

/**
 * Walk a directory and delete any Windows reserved filenames using the \\?\ extended-length
 * path prefix, which bypasses Win32 reserved name restrictions. Only targets known reserved
 * device names (nul, con, prn, aux, com0-9, lpt0-9) — all other files are left untouched.
 */
function cleanReservedFiles(dirPath: string): void {
  const reserved = /^(nul|con|prn|aux|com[0-9]|lpt[0-9])(\..+)?$/i
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        cleanReservedFiles(fullPath)
      } else if (reserved.test(entry.name)) {
        try {
          // \\?\ prefix tells Windows to skip reserved name interpretation
          fs.unlinkSync(`\\\\?\\${fullPath}`)
        } catch { /* best effort */ }
      }
    }
  } catch { /* directory may already be gone */ }
}

export class WorktreeService {
  private workspacesRoot: string

  constructor() {
    this.workspacesRoot = path.join(os.homedir(), '.sorcerer', 'workspaces')
    if (!fs.existsSync(this.workspacesRoot)) {
      fs.mkdirSync(this.workspacesRoot, { recursive: true })
    }
  }

  private validateWorktreePath(worktreePath: string): void {
    const resolved = path.resolve(worktreePath)
    const root = path.resolve(this.workspacesRoot)

    // Must be under workspaces root
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error(`Worktree path is not under workspaces root: ${resolved}`)
    }

    // Must be at least 2 levels deep (repo/session)
    const relative = path.relative(root, resolved)
    const parts = relative.split(path.sep).filter(Boolean)
    if (parts.length < 2) {
      throw new Error(`Worktree path must be at least 2 levels deep: ${resolved}`)
    }

    // Reject path traversal
    if (relative.includes('..')) {
      throw new Error(`Path traversal detected: ${resolved}`)
    }
  }

  async create(projectPath: string, sessionName: string): Promise<{ worktreePath: string; branch: string }> {
    const git: SimpleGit = simpleGit(projectPath)
    const repoName = path.basename(projectPath)
    const branch = `${repoName}/${sessionName}`
    const worktreePath = path.join(this.workspacesRoot, repoName, sessionName)
    this.validateWorktreePath(worktreePath)

    // A matching name can belong to another session (or another repository with
    // the same basename). Never treat an existing workspace as disposable.
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Workspace already exists for "${sessionName}". Choose a different session name to preserve its files.`)
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    // Prune stale worktree references (e.g. from deleted sessions)
    try { await git.raw(['worktree', 'prune']) } catch { /* ignore */ }

    // Ensure HEAD is valid (empty repos have no commits, so HEAD is unresolvable)
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD'])
    } catch {
      // No commits yet — create an initial empty commit so worktrees can branch from it
      await git.raw(['commit', '--allow-empty', '-m', 'Initial commit'])
    }

    // Create worktree with a new branch
    try {
      await git.raw(['worktree', 'add', '-b', branch, worktreePath])
    } catch (err: any) {
      if (!err.message?.includes('already exists')) throw err

      // Branch exists — try to attach worktree to existing branch
      try {
        await git.raw(['worktree', 'add', worktreePath, branch])
      } catch (err2: any) {
        // An attach failure does not prove the branch is stale. Its commits may
        // be the user's only copy, so preserve it and surface the Git error.
        throw new Error(`Could not use existing branch "${branch}". Choose a different session name. ${err2.message}`)
      }
    }

    return { worktreePath, branch }
  }

  async remove(projectPath: string, worktreePath: string, branch?: string): Promise<void> {
    this.validateWorktreePath(worktreePath)
    const git: SimpleGit = simpleGit(projectPath)

    // Remove the worktree — fall back to force removal if git can't clean up
    // (e.g. Windows reserved filenames like 'nul' created by Node.js tooling)
    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force'])
    } catch {
      forceRemoveDir(worktreePath)
      // Prune the now-missing worktree reference from git
      try { await git.raw(['worktree', 'prune']) } catch { /* ignore */ }
    }

    // Delete the branch if provided
    if (branch) {
      try {
        await git.raw(['branch', '-D', branch])
      } catch {
        // Branch may already be deleted
      }
    }
  }

  async autoCommit(worktreePath: string): Promise<{ committed: boolean; message?: string }> {
    try {
      const git: SimpleGit = simpleGit(worktreePath)
      const status = await git.status()

      if (status.isClean()) {
        return { committed: false }
      }

      await git.add('-A')

      const modified = status.modified.length + status.renamed.length
      const newFiles = status.not_added.length + status.created.length
      const deleted = status.deleted.length
      const message = `[sorcerer] Auto-save: ${modified} modified, ${newFiles} new, ${deleted} deleted`

      await git.commit(message)
      return { committed: true, message }
    } catch (err) {
      console.error('[autoCommit] Failed:', err)
      return { committed: false }
    }
  }

  async pushBranch(projectPath: string, branch: string): Promise<{ pushed: boolean; error?: string }> {
    try {
      const git: SimpleGit = simpleGit(projectPath)
      const remotes = await git.getRemotes(true)
      const hasOrigin = remotes.some((r) => r.name === 'origin')

      if (!hasOrigin) {
        return { pushed: false, error: 'No origin remote configured' }
      }

      await git.push('origin', branch, ['--set-upstream'])
      return { pushed: true }
    } catch (err: any) {
      console.error('[pushBranch] Failed:', err)
      return { pushed: false, error: err?.message || 'Push failed' }
    }
  }

  async deleteRemoteBranch(projectPath: string, branch: string): Promise<{ deleted: boolean; error?: string }> {
    try {
      const git: SimpleGit = simpleGit(projectPath)
      await git.raw(['push', 'origin', '--delete', branch])
      return { deleted: true }
    } catch (err: any) {
      console.error('[deleteRemoteBranch] Failed:', err)
      return { deleted: false, error: err?.message || 'Delete remote branch failed' }
    }
  }

  async getRemoteUrl(projectPath: string): Promise<string | null> {
    try {
      const git: SimpleGit = simpleGit(projectPath)
      const url = await git.remote(['get-url', 'origin'])
      if (!url) return null
      const trimmed = url.trim()

      // Convert SSH URLs to HTTPS
      const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
      if (sshMatch) {
        return `https://${sshMatch[1]}/${sshMatch[2]}`
      }

      // Strip trailing .git from HTTPS URLs
      return trimmed.replace(/\.git$/, '')
    } catch {
      return null
    }
  }

  async hasUnmergedCommits(projectPath: string, branch: string): Promise<{ unmerged: boolean; count: number }> {
    try {
      const git: SimpleGit = simpleGit(projectPath)

      // Detect default branch
      let defaultBranch = 'main'
      try {
        await git.raw(['rev-parse', '--verify', 'main'])
      } catch {
        try {
          await git.raw(['rev-parse', '--verify', 'master'])
          defaultBranch = 'master'
        } catch {
          return { unmerged: false, count: 0 }
        }
      }

      const result = await git.raw(['log', `${defaultBranch}..${branch}`, '--oneline'])
      const lines = result.trim().split('\n').filter(Boolean)
      return { unmerged: lines.length > 0, count: lines.length }
    } catch {
      return { unmerged: false, count: 0 }
    }
  }

  async getSessionGitStatus(worktreePath: string): Promise<{
    dirty: boolean; modified: number; staged: number; untracked: number
    ahead: number; behind: number; hasRemote: boolean; added: number; deleted: number
  } | null> {
    try {
      const git: SimpleGit = simpleGit(worktreePath)
      const status = await git.status()

      let ahead = 0
      let behind = 0
      let hasRemote = false
      if (status.tracking) {
        hasRemote = true
        ahead = status.ahead
        behind = status.behind
      }

      let added = 0
      let deleted = 0
      const numstat = await git.diff(['--numstat', 'HEAD']).catch(() => '')
      for (const line of numstat.split('\n')) {
        const [rawAdded, rawDeleted] = line.trim().split('\t')
        if (!rawAdded || !rawDeleted) continue
        added += rawAdded === '-' ? 0 : parseInt(rawAdded, 10) || 0
        deleted += rawDeleted === '-' ? 0 : parseInt(rawDeleted, 10) || 0
      }

      for (const filePath of status.not_added) {
        try {
          const fileContent = fs.readFileSync(path.join(worktreePath, filePath), 'utf8')
          added += fileContent.length === 0 ? 0 : fileContent.split(/\r?\n/).length
        } catch {
          added += 1
        }
      }

      return {
        dirty: !status.isClean(),
        modified: status.modified.length + status.renamed.length,
        staged: status.staged.length,
        untracked: status.not_added.length,
        ahead,
        behind,
        hasRemote,
        added,
        deleted
      }
    } catch {
      return null
    }
  }

  async list(projectPath: string): Promise<string[]> {
    const git: SimpleGit = simpleGit(projectPath)
    const result = await git.raw(['worktree', 'list', '--porcelain'])
    const worktrees: string[] = []

    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        worktrees.push(line.substring(9))
      }
    }

    return worktrees
  }

  /**
   * Rebase a worktree branch onto the latest main/master.
   * Operates in the worktree directory so it doesn't touch the main repo checkout.
   */
  async rebaseOntoMain(projectPath: string, worktreePath: string, branch: string): Promise<{ rebased: boolean; error?: string }> {
    try {
      const git: SimpleGit = simpleGit(worktreePath)

      // Detect default branch
      let defaultBranch = 'main'
      try {
        await git.raw(['rev-parse', '--verify', 'main'])
      } catch {
        try {
          await git.raw(['rev-parse', '--verify', 'master'])
          defaultBranch = 'master'
        } catch {
          return { rebased: false, error: 'No main or master branch found' }
        }
      }

      // Fetch latest main from remote into the worktree
      try {
        await git.raw(['fetch', 'origin', defaultBranch])
      } catch {
        // No remote — rebase onto local main
      }

      // Rebase onto origin/main (or local main if no remote)
      const rebaseTarget = await git.raw(['rev-parse', '--verify', `origin/${defaultBranch}`])
        .then(() => `origin/${defaultBranch}`)
        .catch(() => defaultBranch)

      try {
        await git.raw(['rebase', rebaseTarget])
        return { rebased: true }
      } catch (err: any) {
        // Rebase failed (conflicts) — abort and report
        try { await git.raw(['rebase', '--abort']) } catch { /* ignore */ }
        return { rebased: false, error: `Rebase conflict — branch could not be cleanly rebased onto ${defaultBranch}` }
      }
    } catch (err: any) {
      return { rebased: false, error: err?.message || 'Rebase failed' }
    }
  }

  /**
   * Sync all other active worktrees for a project by rebasing them onto updated main.
   * Best-effort: failures are logged but don't block the caller.
   */
  async syncActiveWorktrees(
    projectPath: string,
    excludeBranch: string,
    sessions: Array<{ branch: string; worktree_path: string }>
  ): Promise<void> {
    for (const session of sessions) {
      if (!session.branch || !session.worktree_path || session.branch === excludeBranch) continue
      if (!fs.existsSync(session.worktree_path)) continue

      try {
        // Auto-commit any dirty work first so the rebase doesn't fail on uncommitted changes
        await this.autoCommit(session.worktree_path)
        const result = await this.rebaseOntoMain(projectPath, session.worktree_path, session.branch)
        if (result.rebased) {
          console.log(`[syncActiveWorktrees] Rebased ${session.branch} onto main`)
        } else {
          console.log(`[syncActiveWorktrees] Skipped ${session.branch}: ${result.error}`)
        }
      } catch (err) {
        console.log(`[syncActiveWorktrees] Failed to sync ${session.branch}:`, err)
      }
    }
  }

  async squashMergeToMain(projectPath: string, branch: string, sessionName: string): Promise<{ merged: boolean; error?: string }> {
    const git: SimpleGit = simpleGit(projectPath)
    let squashStarted = false

    try {
      // Detect default branch
      let defaultBranch = 'main'
      try {
        await git.raw(['rev-parse', '--verify', 'main'])
      } catch {
        try {
          await git.raw(['rev-parse', '--verify', 'master'])
          defaultBranch = 'master'
        } catch {
          return { merged: false, error: 'No main or master branch found' }
        }
      }

      const status = await git.status()
      if (status.current !== defaultBranch) {
        return { merged: false, error: `Check out ${defaultBranch} in the project repository before landing. The current checkout has been left unchanged.` }
      }
      if (!status.isClean()) {
        return { merged: false, error: `Commit or stash changes in the project repository before landing onto ${defaultBranch}, including untracked files.` }
      }

      // Pull latest from remote so local main is up to date
      try {
        await git.raw(['fetch', 'origin', defaultBranch])
        await git.raw(['merge', '--ff-only', `origin/${defaultBranch}`])
      } catch {
        // No remote, or local main has diverged — still safe to proceed with local merge
      }

      // Check there are actually commits to land
      const log = await git.raw(['log', `${defaultBranch}..${branch}`, '--oneline']).catch(() => '')
      if (!log.trim()) {
        return { merged: false, error: 'Nothing to land — no changes ahead of ' + defaultBranch }
      }

      // Squash merge the branch
      try {
        squashStarted = true
        await git.raw(['merge', '--squash', branch])
      } catch (err: any) {
        // merge --squash threw — clean up and report
        try { await git.raw(['reset', '--hard']) } catch { /* ignore */ }
        return { merged: false, error: 'Merge conflict — the branch could not be cleanly merged into ' + defaultBranch }
      }

      // Check for unmerged files — squash merge can exit 0 but leave conflicts
      const postStatus = await git.status()
      if (postStatus.conflicted.length > 0) {
        const files = postStatus.conflicted.join(', ')
        try { await git.raw(['reset', '--hard']) } catch { /* ignore */ }
        return { merged: false, error: `Merge conflict in ${files} — resolve manually or rebase the branch onto ${defaultBranch}` }
      }

      // Commit the squash merge
      try {
        const message = `Land "${sessionName}"\n\nSquash-merged from branch ${branch}`
        await git.commit(message)
        squashStarted = false
      } catch (err: any) {
        // Commit failed for unexpected reason — clean up
        try { await git.raw(['reset', '--hard']) } catch { /* ignore */ }
        return { merged: false, error: 'Commit failed after squash merge: ' + (err?.message || 'unknown error') }
      }

      // Push main back to remote
      try {
        await git.raw(['push', 'origin', defaultBranch])
      } catch {
        // Push failed — landed locally but not synced to remote
        console.log('[squashMergeToMain] Push to remote failed — landed locally only')
      }

      return { merged: true }
    } catch (err: any) {
      // Only discard changes created by our squash, never pre-existing work
      // when status inspection or an earlier prerequisite fails.
      if (squashStarted) {
        try { await git.raw(['reset', '--hard']) } catch { /* ignore */ }
      }
      console.error('[squashMergeToMain] Failed:', err)
      return { merged: false, error: err?.message || 'Squash merge failed' }
    }
  }

  getWorkspacesRoot(): string {
    return this.workspacesRoot
  }
}
