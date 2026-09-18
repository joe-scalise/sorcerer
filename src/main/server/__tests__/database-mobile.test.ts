import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedHome = vi.hoisted(() => ({ path: '' }))

vi.mock('os', () => ({
  default: { homedir: () => mockedHome.path },
  homedir: () => mockedHome.path
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}))

import { DatabaseService } from '../../services/database-service'

describe('DatabaseService mobile devices', () => {
  let db: DatabaseService | undefined
  const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())

  beforeEach(async () => {
    mockedHome.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-mobile-db-'))
    db = new DatabaseService()
    await db.ensureReady()
  })

  afterEach(() => {
    db?.close()
    if (path.resolve(mockedHome.path).startsWith(`${tempRoot}${path.sep}`)) {
      fs.rmSync(mockedHome.path, { recursive: true, force: true })
    }
  })

  it('persists hash-only credentials and returns public device metadata without the hash', async () => {
    const rawToken = 'raw-device-token-that-must-not-be-persisted'
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const created = db!.createMobileDevice({
      id: 'device-1',
      name: 'Pixel',
      tokenHash,
      platform: 'android',
      appVersion: '0.1.0',
      scopes: ['mobile:rpc', 'terminal:read'],
      createdAt: 1_000
    })
    expect(created).not.toHaveProperty('tokenHash')
    expect(db!.listMobileDevices()[0]).not.toHaveProperty('tokenHash')
    expect(db!.getMobileDeviceByTokenHash(tokenHash)?.tokenHash).toBe(tokenHash)

    db!.close()
    const databaseBytes = fs.readFileSync(path.join(mockedHome.path, '.sorcerer', 'sorcerer.db'))
    expect(databaseBytes.includes(Buffer.from(rawToken))).toBe(false)

    db = new DatabaseService()
    await db.ensureReady()
    expect(db.listMobileDevices()[0]).toMatchObject({
      id: 'device-1',
      name: 'Pixel',
      platform: 'android',
      appVersion: '0.1.0',
      scopes: ['mobile:rpc', 'terminal:read'],
      revokedAt: null
    })
    expect(db.revokeMobileDevice('device-1', 2_000)).toBe(true)
    expect(db.revokeMobileDevice('device-1', 3_000)).toBe(false)
    expect(db.listMobileDevices()[0].revokedAt).toBe(2_000)
  })
})
