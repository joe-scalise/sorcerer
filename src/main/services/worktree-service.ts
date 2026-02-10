import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'
import os from 'os'
import fs from 'fs'

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

    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    // Create worktree with a new branch
    try {
      await git.raw(['worktree', 'add', '-b', branch, worktreePath])
    } catch (err: any) {
      // If branch exists, try without -b (attach to existing branch)
      if (err.message?.includes('already exists')) {
        try {
          await git.raw(['worktree', 'add', worktreePath, branch])
        } catch {
          throw new Error(`Failed to create worktree: branch "${branch}" already exists and may be in use`)
        }
      } else {
        throw err
      }
    }

    return { worktreePath, branch }
  }

  async remove(projectPath: string, worktreePath: string, branch?: string): Promise<void> {
    this.validateWorktreePath(worktreePath)
    const git: SimpleGit = simpleGit(projectPath)

    // Remove the worktree
    await git.raw(['worktree', 'remove', worktreePath, '--force'])

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
    ahead: number; behind: number; hasRemote: boolean
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

      return {
        dirty: !status.isClean(),
        modified: status.modified.length + status.renamed.length,
        staged: status.staged.length,
        untracked: status.not_added.length,
        ahead,
        behind,
        hasRemote
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

  async squashMergeToMain(projectPath: string, branch: string, sessionName: string): Promise<{ merged: boolean; error?: string }> {
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
          return { merged: false, error: 'No main or master branch found' }
        }
      }

      // Check that the default branch worktree has no staged or modified files
      // (untracked files are fine — they don't interfere with a merge)
      const status = await git.status()
      if (status.modified.length > 0 || status.staged.length > 0 || status.deleted.length > 0 || status.renamed.length > 0 || status.conflicted.length > 0) {
        return { merged: false, error: `The ${defaultBranch} branch has uncommitted changes` }
      }

      // Check there are actually commits to land
      const log = await git.raw(['log', `${defaultBranch}..${branch}`, '--oneline']).catch(() => '')
      if (!log.trim()) {
        return { merged: false, error: 'Nothing to land — no changes ahead of ' + defaultBranch }
      }

      // Squash merge the branch
      try {
        await git.raw(['merge', '--squash', branch])
      } catch (err: any) {
        // Conflict — abort and reset
        try { await git.raw(['merge', '--abort']) } catch { /* ignore */ }
        try { await git.raw(['reset', '--hard']) } catch { /* ignore */ }
        return { merged: false, error: 'Merge conflict — the branch could not be cleanly merged into ' + defaultBranch }
      }

      // Commit the squash merge
      const message = `Land "${sessionName}"\n\nSquash-merged from branch ${branch}`
      await git.commit(message)

      return { merged: true }
    } catch (err: any) {
      console.error('[squashMergeToMain] Failed:', err)
      return { merged: false, error: err?.message || 'Squash merge failed' }
    }
  }

  getWorkspacesRoot(): string {
    return this.workspacesRoot
  }
}
