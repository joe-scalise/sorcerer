import { describe, expect, it } from 'vitest'
import {
  MobileAuthError,
  MobileAuthService,
  hashToken
} from '../mobile-auth'
import {
  CreateMobileDeviceInput,
  MobileDeviceCredentialRecord,
  MobileDeviceRecord
} from '../../services/database-service'

class MemoryDeviceStore {
  records = new Map<string, MobileDeviceCredentialRecord>()

  createMobileDevice(input: CreateMobileDeviceInput): MobileDeviceRecord {
    const record: MobileDeviceCredentialRecord = {
      id: input.id,
      name: input.name,
      tokenHash: input.tokenHash,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      scopes: [...input.scopes],
      createdAt: input.createdAt,
      lastSeenAt: null,
      revokedAt: null
    }
    this.records.set(input.tokenHash, record)
    return this.toPublic(record)
  }

  getMobileDeviceByTokenHash(tokenHash: string): MobileDeviceCredentialRecord | undefined {
    const record = this.records.get(tokenHash)
    return record ? { ...record, scopes: [...record.scopes] } : undefined
  }

  listMobileDevices(): MobileDeviceRecord[] {
    return [...this.records.values()].map((record) => this.toPublic(record))
  }

  touchMobileDevice(id: string, seenAt: number): void {
    const record = [...this.records.values()].find((candidate) => candidate.id === id)
    if (record && record.revokedAt === null) record.lastSeenAt = seenAt
  }

  revokeMobileDevice(id: string, revokedAt: number): boolean {
    const record = [...this.records.values()].find((candidate) => candidate.id === id)
    if (!record || record.revokedAt !== null) return false
    record.revokedAt = revokedAt
    return true
  }

  private toPublic(record: MobileDeviceCredentialRecord): MobileDeviceRecord {
    const { tokenHash: _tokenHash, ...device } = record
    return { ...device, scopes: [...device.scopes] }
  }
}

describe('MobileAuthService', () => {
  it('exchanges a high-entropy one-time code and persists only the token hash', () => {
    const store = new MemoryDeviceStore()
    const auth = new MobileAuthService(store as any, () => 1_000)
    const pairing = auth.createPairingCode()

    expect(Buffer.from(pairing.code, 'base64url')).toHaveLength(24)

    const result = auth.exchangePairingCode({
      code: pairing.code,
      deviceName: '  Pixel 9  ',
      platform: 'android',
      appVersion: '0.1.0'
    })
    const stored = [...store.records.values()][0]

    expect(result.device).toEqual({ id: stored.id, name: 'Pixel 9' })
    expect(stored.tokenHash).toBe(hashToken(result.token))
    expect(stored.tokenHash).not.toContain(result.token)
    expect(JSON.stringify(stored)).not.toContain(result.token)
    expect(stored.platform).toBe('android')
  })

  it('rejects replay of a pairing code', () => {
    const auth = new MobileAuthService(new MemoryDeviceStore() as any, () => 1_000)
    const pairing = auth.createPairingCode()
    auth.exchangePairingCode({ code: pairing.code, deviceName: 'Phone' })

    expect(() => auth.exchangePairingCode({ code: pairing.code, deviceName: 'Other' }))
      .toThrowError(expect.objectContaining<Partial<MobileAuthError>>({
        statusCode: 410,
        code: 'pairing_code_invalid'
      }))
  })

  it('rejects expired pairing codes without creating a device', () => {
    let now = 1_000
    const store = new MemoryDeviceStore()
    const auth = new MobileAuthService(store as any, () => now)
    const pairing = auth.createPairingCode(100)
    now = pairing.expiresAt

    expect(() => auth.exchangePairingCode({ code: pairing.code, deviceName: 'Phone' }))
      .toThrowError(expect.objectContaining<Partial<MobileAuthError>>({ statusCode: 410 }))
    expect(store.records.size).toBe(0)
  })

  it('invalidates the previous outstanding code when the QR is refreshed', () => {
    const auth = new MobileAuthService(new MemoryDeviceStore() as any, () => 1_000)
    const first = auth.createPairingCode()
    const refreshed = auth.createPairingCode()

    expect(() => auth.exchangePairingCode({ code: first.code, deviceName: 'Stale QR' }))
      .toThrowError(expect.objectContaining<Partial<MobileAuthError>>({ statusCode: 410 }))
    expect(auth.exchangePairingCode({ code: refreshed.code, deviceName: 'Current QR' }).token)
      .toEqual(expect.any(String))
  })

  it('authenticates a device token, records use, and rejects it after revocation', () => {
    let now = 5_000
    const store = new MemoryDeviceStore()
    const auth = new MobileAuthService(store as any, () => now)
    const pairing = auth.createPairingCode()
    const result = auth.exchangePairingCode({ code: pairing.code, deviceName: 'Phone' })

    const principal = auth.authenticateToken(result.token)
    expect(principal?.deviceId).toBe(result.device.id)
    expect(principal?.scopes).toContain('mobile:rpc')
    expect(store.records.get(hashToken(result.token))?.lastSeenAt).toBe(now)

    now += 1
    expect(auth.revokePairedDevice(result.device.id)).toBe(true)
    expect(auth.authenticateToken(result.token)).toBeNull()
    expect(auth.listPairedDevices()[0].revokedAt).toBe(now)
  })
})
