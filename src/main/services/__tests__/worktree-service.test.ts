import fs from 'fs'
import path from 'path'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => mockedHome.path } }))
import { WorktreeService } from '../worktree-service'

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
    expect(await service.squashMergeToMain(project, branch, 'feature')).toEqual({ merged: true })
    expect(fs.readFileSync(path.join(project, 'file.txt'), 'utf8')).toBe('feature\n')
    expect((await simpleGit(project).status()).isClean()).toBe(true)
  })
})
