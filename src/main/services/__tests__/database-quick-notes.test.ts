import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => mockedHome.path } }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { DatabaseService } from '../database-service'

let db: DatabaseService
const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())
beforeEach(async () => {
  mockedHome.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-notes-db-'))
  db = new DatabaseService()
  await db.ensureReady()
})
afterEach(() => {
  db.close()
  if (path.resolve(mockedHome.path).startsWith(`${tempRoot}${path.sep}`)) {
    fs.rmSync(mockedHome.path, { recursive: true, force: true })
  }
})

describe('quick note identity', () => {
  it('updates the existing note when two windows generate different IDs for one parent', async () => {
    db.saveQuickNote('window-one-id', 'parent', 'session', 'first draft')
    db.saveQuickNote('window-two-id', 'parent', 'session', 'latest draft')
    expect(db.getQuickNote('parent', 'session')).toMatchObject({ id: 'window-one-id', content: 'latest draft' })
    expect(db.listQuickNoteParents()).toEqual([{ parent_id: 'parent', parent_type: 'session' }])
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.getQuickNote('parent', 'session')?.content).toBe('latest draft')
  })

  it('keeps session and agent notes with the same parent ID separate', () => {
    db.saveQuickNote('session-note', 'parent', 'session', 'session notes')
    db.saveQuickNote('agent-note', 'parent', 'agent', 'agent notes')
    expect(db.getQuickNote('parent', 'session')?.content).toBe('session notes')
    expect(db.getQuickNote('parent', 'agent')?.content).toBe('agent notes')
  })
})
