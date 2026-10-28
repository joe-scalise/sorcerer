import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => home.path } }))
import { DatabaseService } from '../database-service'

const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())
let db: DatabaseService

beforeEach(async () => {
  home.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-inbox-test-'))
  db = new DatabaseService()
  await db.ensureReady()
})
afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  if (path.resolve(home.path).startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(home.path, { recursive: true, force: true })
})

describe('human-owned inbox persistence', () => {
  it('deletes only the selected item, preserves it on save failure, and persists deletion', async () => {
    const item = db.createInboxItem({ title: 'Delete me' })
    const other = db.createInboxItem({ title: 'Keep me' })
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('Disk unavailable') })
    expect(() => db.deleteInboxItem(item.id)).toThrow('Disk unavailable')
    expect(db.listInboxItems().map((entry) => entry.id)).toContain(item.id)
    vi.restoreAllMocks()
    db.deleteInboxItem(item.id)
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.listInboxItems().map((entry) => entry.id)).toEqual([other.id])
  })
  it('keeps captures, details, pins and manual states through a restart', async () => {
    const item = db.createInboxItem({ title: '  Ask about the release  ', body: 'Reference: https://example.com\nFor tomorrow.' })
    db.updateInboxItem(item.id, { pinned: true, status: 'done' })
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.listInboxItems()).toEqual([expect.objectContaining({
      id: item.id, title: 'Ask about the release', body: 'Reference: https://example.com\nFor tomorrow.',
      project_id: null, pinned: true, status: 'done'
    })])
    db.updateInboxItem(item.id, { status: 'archived' })
    expect(db.updateInboxItem(item.id, { status: 'open' })).toMatchObject({ pinned: true, status: 'open' })
  })

  it('retains captures when their project is removed', async () => {
    db.addProject('project', 'Project', path.join(home.path, 'repo'))
    const item = db.createInboxItem({ title: 'Remember this', project_id: 'project' })
    db.removeProject('project')
    expect(db.listInboxItems()).toEqual([expect.objectContaining({ id: item.id, project_id: null })])
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.listInboxItems()[0]).toMatchObject({ id: item.id, title: 'Remember this', project_id: null })
  })

  it('rejects invalid content and session/provider fields before changing stored items', () => {
    for (const input of [null, [], {}, { title: ' ' }, { title: 'x'.repeat(501) }, { title: 'Valid', body: 1 },
      { title: 'Valid', project_id: 'missing' }, { title: 'Valid', session_id: 'session' }]) {
      expect(() => db.createInboxItem(input as any)).toThrow()
    }
    const item = db.createInboxItem({ title: 'Human input' })
    for (const patch of [{ status: 'running' }, { pinned: 1 }, { title: '' }, { provider: 'codex' }, { project_id: false }]) {
      expect(() => db.updateInboxItem(item.id, patch as any)).toThrow()
    }
    expect(db.listInboxItems()).toEqual([item])
  })

  it('does not retain or duplicate a failed capture when the user retries', () => {
    const replace = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('Disk unavailable') })
    expect(() => db.createInboxItem({ title: 'Keep my draft' })).toThrow('Disk unavailable')
    expect(db.listInboxItems()).toEqual([])
    replace.mockRestore()
    db.createInboxItem({ title: 'Keep my draft' })
    expect(db.listInboxItems()).toHaveLength(1)
  })

  it('restores the previous state after a failed edit or archive', () => {
    const item = db.createInboxItem({ title: 'Keep the original', body: 'My context' })
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('Disk unavailable') })
    expect(() => db.updateInboxItem(item.id, { title: 'Changed', status: 'archived' })).toThrow('Disk unavailable')
    expect(db.listInboxItems()).toEqual([item])
  })

  it('orders pinned captures ahead of newer unpinned captures', () => {
    const earlier = db.createInboxItem({ title: 'Important thought' })
    db.createInboxItem({ title: 'Another thought' })
    db.updateInboxItem(earlier.id, { pinned: true })
    expect(db.listInboxItems()[0].id).toBe(earlier.id)
  })

  it('persists a manual order and restores it after a failed reorder', async () => {
    const one = db.createInboxItem({ title: 'One' })
    const two = db.createInboxItem({ title: 'Two' })
    const three = db.createInboxItem({ title: 'Three' })
    db.reorderInboxItem(one.id, three.id)
    const ordered = db.listInboxItems().map((item) => item.id)
    expect(ordered.indexOf(one.id)).toBeLessThan(ordered.indexOf(three.id))
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('Disk unavailable') })
    expect(() => db.reorderInboxItem(two.id, one.id)).toThrow('Disk unavailable')
    expect(db.listInboxItems().map((item) => item.id)).toEqual(ordered)
    vi.restoreAllMocks()
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.listInboxItems().map((item) => item.id)).toEqual(ordered)
  })
})
