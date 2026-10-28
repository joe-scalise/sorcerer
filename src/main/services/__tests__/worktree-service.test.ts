import fs from 'fs'
import path from 'path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => mockedHome.path } }))
import { WorktreeService } from '../worktree-service'
import { deleteSession, landOnMain, type HandlerServices } from '../../ipc/shared-handlers'

const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())
let project: string
let service: WorktreeService

beforeEach(async () => {
  mockedHome.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-worktree-test-'))
  project = path.join(mockedHome.path, 'repo')
  fs.mkdirSync(project)
  const git = simpleGit(project)
  await git.init(['--initial-branch=main'])
  await git.addConfig('user.name', 'Sorcerer Test')
  await git.addConfig('user.email', 'test@example.invalid')
  await git.addConfig('commit.gpgsign', 'false')
  await git.addConfig('core.autocrlf', 'false')
  fs.writeFileSync(path.join(project, 'file.txt'), 'initial\n')
  await git.add('.')
  await git.commit('Initial')
  service = new WorktreeService()
}, 30_000)

afterEach(() => {
  if (path.resolve(mockedHome.path).startsWith(`${tempRoot}${path.sep}`)) {
    fs.rmSync(mockedHome.path, { recursive: true, force: true })
  }
})

async function createChangedBranch() {
  const created = await service.create(project, 'feature')
  fs.writeFileSync(path.join(created.worktreePath, 'file.txt'), 'feature\n')
  const git = simpleGit(created.worktreePath)
  await git.add('.')
  await git.commit('Feature')
  return created
}

describe('worktree data preservation', { timeout: 30_000 }, () => {
  it('refuses a colliding workspace name without deleting uncommitted files', async () => {
    const { worktreePath } = await service.create(project, 'existing')
    fs.writeFileSync(path.join(worktreePath, 'unsaved.txt'), 'only copy')
    await expect(service.create(project, 'existing')).rejects.toThrow('Workspace already exists')
    expect(fs.readFileSync(path.join(worktreePath, 'unsaved.txt'), 'utf8')).toBe('only copy')
  })

  it('does not delete an existing branch when it is checked out elsewhere', async () => {
    const git = simpleGit(project)
    const elsewhere = path.join(mockedHome.path, 'other-worktree')
    await git.raw(['worktree', 'add', '-b', 'repo/locked', elsewhere])
    fs.writeFileSync(path.join(elsewhere, 'unique.txt'), 'valuable commit')
    await simpleGit(elsewhere).add('.')
    await simpleGit(elsewhere).commit('Unmerged work')
    const before = await git.revparse(['repo/locked'])
    await expect(service.create(project, 'locked')).rejects.toThrow('Could not use existing branch')
    expect(await git.revparse(['repo/locked'])).toBe(before)
    expect(fs.readFileSync(path.join(elsewhere, 'unique.txt'), 'utf8')).toBe('valuable commit')
  })

  it('refuses landing when the project checkout is on another branch', async () => {
    const { branch } = await createChangedBranch()
    const git = simpleGit(project)
    await git.checkoutLocalBranch('unrelated')
    const before = await git.revparse(['HEAD'])
    const result = await service.squashMergeToMain(project, branch, 'feature')
    expect(result).toMatchObject({ merged: false })
    expect(result.error).toContain('Check out main')
    expect(await git.revparse(['HEAD'])).toBe(before)
    expect((await git.status()).current).toBe('unrelated')
  })

  it('preserves dirty tracked and untracked project files when landing is refused', async () => {
    const { branch } = await createChangedBranch()
    fs.writeFileSync(path.join(project, 'file.txt'), 'uncommitted user work\n')
    fs.writeFileSync(path.join(project, 'new.txt'), 'untracked user work\n')
    const result = await service.squashMergeToMain(project, branch, 'feature')
    expect(result.merged).toBe(false)
    expect(result.error).toContain('Commit or stash')
    expect(fs.readFileSync(path.join(project, 'file.txt'), 'utf8')).toBe('uncommitted user work\n')
    expect(fs.readFileSync(path.join(project, 'new.txt'), 'utf8')).toBe('untracked user work\n')
    expect((await simpleGit(project).stashList()).total).toBe(0)
  })

  it('lands successfully into a clean main checkout', async () => {
    const { branch } = await createChangedBranch()
    expect(await service.squashMergeToMain(project, branch, 'feature')).toMatchObject({ merged: true, warning: expect.stringContaining('no origin') })
    expect(fs.readFileSync(path.join(project, 'file.txt'), 'utf8')).toBe('feature\n')
    expect((await simpleGit(project).status()).isClean()).toBe(true)
  })

  it('starts new worktrees from main even when a feature branch is checked out', async () => {
    const git = simpleGit(project)
    const main = await git.revparse(['main'])
    await git.checkoutLocalBranch('unrelated')
    fs.writeFileSync(path.join(project, 'other.txt'), 'unrelated')
    await git.add('.')
    await git.commit('Other work')
    const created = await service.create(project, 'fresh')
    expect(await git.revparse([created.branch])).toBe(main)
    expect((await git.status()).current).toBe('unrelated')
  })

  it('preserves the running session when preflight fails', async () => {
    const created = await createChangedBranch()
    await simpleGit(project).checkoutLocalBranch('unrelated')
    const pty = { isRunning: vi.fn(() => true), killSessionAndWait: vi.fn() }
    const db = { getSession: () => ({ project_id: 'p', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), updateSession: vi.fn() }
    const result = await landOnMain({ db, pty, worktree: service } as unknown as HandlerServices, 's')
    expect(result.error).toContain('Check out main')
    expect(pty.killSessionAndWait).not.toHaveBeenCalled()
    expect(db.updateSession).not.toHaveBeenCalled()
  })

  it('refuses to stop a session when Sorcerer runs inside its worktree', async () => {
    const created = await createChangedBranch()
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(created.worktreePath)
    const pty = { isRunning: vi.fn(() => true), killSessionAndWait: vi.fn() }
    const db = { getSession: () => ({ project_id: 'p', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }) }
    try {
      const result = await landOnMain({ db, pty, worktree: service } as unknown as HandlerServices, 's')
      expect(result.error).toContain('running from this workspace')
      expect(pty.killSessionAndWait).not.toHaveBeenCalled()
    } finally { cwd.mockRestore() }
  })

  it('lands while retaining the session, worktree, branch and ignored files', async () => {
    const created = await createChangedBranch()
    fs.writeFileSync(path.join(created.worktreePath, '.gitignore'), 'ignored.txt\n')
    await simpleGit(created.worktreePath).add('.gitignore')
    await simpleGit(created.worktreePath).commit('Ignore local data')
    fs.writeFileSync(path.join(created.worktreePath, 'ignored.txt'), 'local data')
    const pty = { isRunning: vi.fn(() => true), killSessionAndWait: vi.fn().mockResolvedValue(undefined) }
    const db = { getSession: () => ({ project_id: 'p', name: 'feature', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), updateSession: vi.fn(), removeSession: vi.fn() }
    const result = await landOnMain({ db, pty, worktree: service } as unknown as HandlerServices, 's')
    expect(result).toMatchObject({ landed: true, warning: expect.stringContaining('no origin') })
    expect(pty.killSessionAndWait).toHaveBeenCalledOnce()
    expect(db.removeSession).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(created.worktreePath, 'ignored.txt'), 'utf8')).toBe('local data')
    expect(await simpleGit(project).revparse([created.branch])).toBeTruthy()
    expect(fs.readFileSync(path.join(project, 'file.txt'), 'utf8')).toBe('feature\n')
  })

  it('does not merge or remove work if automatic commit fails', async () => {
    const created = await createChangedBranch()
    fs.writeFileSync(path.join(created.worktreePath, 'uncommitted.txt'), 'unsaved work')
    await simpleGit(created.worktreePath).addConfig('user.name', '')
    await simpleGit(created.worktreePath).addConfig('user.email', '')
    const db = { getSession: () => ({ project_id: 'p', name: 'feature', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), updateSession: vi.fn(), removeSession: vi.fn() }
    const pty = { isRunning: () => false, kill: vi.fn() }
    const before = await simpleGit(project).revparse(['HEAD'])
    const result = await landOnMain({ db, pty, worktree: service } as unknown as HandlerServices, 's')
    expect(result.error).toContain('Could not commit')
    expect(await simpleGit(project).revparse(['HEAD'])).toBe(before)
    expect(fs.readFileSync(path.join(created.worktreePath, 'uncommitted.txt'), 'utf8')).toBe('unsaved work')
    expect(db.removeSession).not.toHaveBeenCalled()
  })

  it('reports a failed push as a completed local merge', async () => {
    const remote = path.join(mockedHome.path, 'remote.git')
    await simpleGit(mockedHome.path).raw(['init', '--bare', remote])
    const git = simpleGit(project)
    await git.addRemote('origin', remote)
    await git.push('origin', 'main')
    await git.raw(['remote', 'set-url', '--push', 'origin', path.join(mockedHome.path, 'missing.git')])
    const { branch } = await createChangedBranch()
    const result = await service.squashMergeToMain(project, branch, 'feature')
    expect(result).toMatchObject({ merged: true, warning: expect.stringContaining('push failed') })
    expect(fs.readFileSync(path.join(project, 'file.txt'), 'utf8')).toBe('feature\n')
    expect(await git.revparse(['main'])).not.toBe(await git.revparse(['origin/main']))
  })

  it('keeps the workspace and branch when saving session deletion fails', async () => {
    const created = await createChangedBranch()
    const db = { getSession: () => ({ project_id: 'p', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), removeSession: vi.fn(() => { throw new Error('unable to open database file') }) }
    const pty = { isRunning: () => false }
    await expect(deleteSession({ db, pty, worktree: service } as unknown as HandlerServices, 's')).rejects.toThrow('workspace and branch were kept')
    expect(fs.existsSync(created.worktreePath)).toBe(true)
    expect(await simpleGit(project).revparse([created.branch])).toBeTruthy()
  })

  it('removes the workspace only after saving the deletion and keeps the branch', async () => {
    const created = await createChangedBranch()
    const db = { getSession: () => ({ project_id: 'p', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), removeSession: vi.fn(() => expect(fs.existsSync(created.worktreePath)).toBe(true)) }
    const pty = { isRunning: () => false }
    await deleteSession({ db, pty, worktree: service } as unknown as HandlerServices, 's')
    expect(db.removeSession).toHaveBeenCalledOnce()
    expect(fs.existsSync(created.worktreePath)).toBe(false)
    expect(await simpleGit(project).revparse([created.branch])).toBeTruthy()
  })

  it('refuses to delete the running app workspace before stopping its session', async () => {
    const created = await createChangedBranch()
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(created.worktreePath)
    const pty = { isRunning: vi.fn(() => true), killSessionAndWait: vi.fn() }
    const db = { getSession: () => ({ project_id: 'p', worktree_path: created.worktreePath, branch: created.branch }), getProject: () => ({ path: project }), removeSession: vi.fn() }
    try {
      await expect(deleteSession({ db, pty, worktree: service } as unknown as HandlerServices, 's')).rejects.toThrow('running from this workspace')
      expect(pty.killSessionAndWait).not.toHaveBeenCalled()
      expect(db.removeSession).not.toHaveBeenCalled()
    } finally { cwd.mockRestore() }
  })
})
