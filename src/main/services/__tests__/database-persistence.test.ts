import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => mockedHome.path } }))
import { DatabaseService } from '../database-service'

describe('atomic database persistence', () => {
  let db: DatabaseService
  let databasePath: string
  let original: Buffer
  const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())

  beforeEach(async () => {
    mockedHome.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-persistence-'))
    databasePath = path.join(mockedHome.path, '.sorcerer', 'sorcerer.db')
    db = new DatabaseService()
    await db.ensureReady()
    db.setSetting('persistence-test', 'saved')
    original = fs.readFileSync(databasePath)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    if (path.resolve(mockedHome.path).startsWith(`${tempRoot}${path.sep}`)) {
      fs.rmSync(mockedHome.path, { recursive: true, force: true })
    }
  })

  async function expectOriginalReadable(): Promise<void> {
    expect(fs.readFileSync(databasePath)).toEqual(original)
    expect(fs.readdirSync(path.dirname(databasePath))).toEqual(['sorcerer.db'])
    vi.restoreAllMocks()
    // Reopen before closing the modified in-memory instance: close itself saves.
    const reopened = new DatabaseService()
    await reopened.ensureReady()
    expect(reopened.getSetting('persistence-test')).toBe('saved')
    reopened.close()
  }

  it('flushes and closes a same-directory snapshot before replacing, then reloads it', async () => {
    const write = vi.spyOn(fs, 'writeFileSync')
    const flush = vi.spyOn(fs, 'fsyncSync')
    const close = vi.spyOn(fs, 'closeSync')
    const rename = vi.spyOn(fs, 'renameSync')
    db.setSetting('persistence-test', 'updated')
    expect(write.mock.calls[0][0]).toEqual(expect.any(Number))
    expect(flush).toHaveBeenCalledWith(write.mock.calls[0][0])
    expect(close).toHaveBeenCalledWith(write.mock.calls[0][0])
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/sorcerer\.db\.[\w-]+\.tmp$/), databasePath)
    expect(path.dirname(String(rename.mock.calls[0][0]))).toBe(path.dirname(databasePath))
    expect(flush.mock.invocationCallOrder[0]).toBeGreaterThan(write.mock.invocationCallOrder[0])
    expect(close.mock.invocationCallOrder[0]).toBeGreaterThan(flush.mock.invocationCallOrder[0])
    expect(rename.mock.invocationCallOrder[0]).toBeGreaterThan(close.mock.invocationCallOrder[0])
    expect(fs.readdirSync(path.dirname(databasePath))).toEqual(['sorcerer.db'])
    vi.restoreAllMocks()
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.getSetting('persistence-test')).toBe('updated')
  })

  it('leaves the saved database untouched if exporting fails', async () => {
    const internal = db as unknown as { db: { export: () => Uint8Array } }
    vi.spyOn(internal.db, 'export').mockImplementationOnce(() => { throw new Error('export failed') })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('export failed')
    await expectOriginalReadable()
  })

  it('preserves the old snapshot after a partially completed write', async () => {
    const writeFile = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((file) => {
      writeFile(file, Buffer.from('incomplete database'))
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('disk full')
    await expectOriginalReadable()
  })

  it('preserves the old snapshot if flushing fails', async () => {
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('flush failed') })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('flush failed')
    await expectOriginalReadable()
  })

  it('preserves the old snapshot if closing the temporary file fails', async () => {
    vi.spyOn(fs, 'closeSync').mockImplementationOnce(() => { throw new Error('close failed') })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('close failed')
    await expectOriginalReadable()
  })

  it('preserves the old snapshot on a Windows sharing violation and allows retry', async () => {
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('file locked'), { code: 'EPERM' })
    })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('file locked')
    await expectOriginalReadable()
    db.setSetting('persistence-test', 'retried')
    db.close()
    db = new DatabaseService()
    await db.ensureReady()
    expect(db.getSetting('persistence-test')).toBe('retried')
  })

  it('does not delete a temporary file that this save did not create', () => {
    let collisionPath = ''
    const writeFile = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'openSync').mockImplementationOnce((file) => {
      collisionPath = String(file)
      writeFile(file, 'unrelated temporary file')
      throw Object.assign(new Error('already exists'), { code: 'EEXIST' })
    })
    expect(() => db.setSetting('persistence-test', 'unsaved')).toThrow('already exists')
    expect(fs.readFileSync(databasePath)).toEqual(original)
    expect(fs.readFileSync(collisionPath, 'utf8')).toBe('unrelated temporary file')
  })
})
