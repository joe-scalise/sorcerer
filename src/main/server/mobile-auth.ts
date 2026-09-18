import crypto from 'crypto'
import {
  DatabaseService,
  MobileDeviceRecord
} from '../services/database-service'
import {
  DEFAULT_MOBILE_SCOPES,
  MOBILE_CAPABILITIES,
  MOBILE_PROTOCOL_VERSION
} from './mobile-contract'

const DEFAULT_PAIRING_CODE_TTL_MS = 2 * 60 * 1000
const PAIRING_CODE_BYTES = 24
const DEVICE_TOKEN_BYTES = 32
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000

export type PairedDevice = MobileDeviceRecord

export interface PairingCode {
  code: string
  expiresAt: number
  protocolVersion: typeof MOBILE_PROTOCOL_VERSION
}

export interface PairingRequest {
  code: string
  deviceName: string
  platform?: string
  appVersion?: string
}

export interface PairingResult {
  token: string
  protocolVersion: typeof MOBILE_PROTOCOL_VERSION
  capabilities: string[]
  device: {
    id: string
    name: string
  }
}

export interface MobilePrincipal {
  kind: 'mobile'
  deviceId: string
  scopes: ReadonlySet<string>
}

export class MobileAuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MobileAuthError'
  }
}

interface PairingCodeState {
  expiresAt: number
}

type MobileDeviceStore = Pick<
  DatabaseService,
  | 'createMobileDevice'
  | 'getMobileDeviceByTokenHash'
  | 'listMobileDevices'
  | 'touchMobileDevice'
  | 'revokeMobileDevice'
>

export class MobileAuthService {
  private pairingCodes = new Map<string, PairingCodeState>()

  constructor(
    private db: MobileDeviceStore,
    private now: () => number = Date.now
  ) {}

  createPairingCode(ttlMs: number = DEFAULT_PAIRING_CODE_TTL_MS): PairingCode {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Pairing code TTL must be positive')
    }

    const now = this.now()
    // The desktop displays one QR at a time. Refreshing it invalidates every
    // previously-issued code so a photographed/stale QR cannot still pair.
    this.pairingCodes.clear()
    const code = crypto.randomBytes(PAIRING_CODE_BYTES).toString('base64url')
    const expiresAt = now + ttlMs
    this.pairingCodes.set(hashToken(code), { expiresAt })
    return { code, expiresAt, protocolVersion: MOBILE_PROTOCOL_VERSION }
  }

  exchangePairingCode(request: PairingRequest): PairingResult {
    const code = typeof request.code === 'string' ? request.code : ''
    const codeHash = hashToken(code)
    const state = this.pairingCodes.get(codeHash)

    // Consume before any further work. A failed/expired exchange can never be
    // retried, and concurrent requests cannot mint multiple device tokens.
    this.pairingCodes.delete(codeHash)
    if (!state || state.expiresAt <= this.now()) {
      throw new MobileAuthError(410, 'pairing_code_invalid', 'Pairing code is invalid or expired')
    }

    const deviceName = validateMetadata('deviceName', request.deviceName, 80, true)
    const platform = validateMetadata('platform', request.platform, 40, false)
    const appVersion = validateMetadata('appVersion', request.appVersion, 40, false)
    const token = crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url')
    const id = crypto.randomUUID()

    this.db.createMobileDevice({
      id,
      name: deviceName,
      tokenHash: hashToken(token),
      platform,
      appVersion,
      scopes: [...DEFAULT_MOBILE_SCOPES],
      createdAt: this.now()
    })

    return {
      token,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      capabilities: [...MOBILE_CAPABILITIES],
      device: { id, name: deviceName }
    }
  }

  authenticateToken(token: string): MobilePrincipal | null {
    if (!token || token.length > 512) return null
    const device = this.db.getMobileDeviceByTokenHash(hashToken(token))
    if (!device || device.revokedAt !== null) return null

    const now = this.now()
    if (device.lastSeenAt === null || now - device.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS) {
      this.db.touchMobileDevice(device.id, now)
    }

    return {
      kind: 'mobile',
      deviceId: device.id,
      scopes: new Set(device.scopes)
    }
  }

  listPairedDevices(): PairedDevice[] {
    return this.db.listMobileDevices()
  }

  revokePairedDevice(deviceId: string): boolean {
    return this.db.revokeMobileDevice(deviceId, this.now())
  }

  invalidatePairingCodes(): void {
    this.pairingCodes.clear()
  }

}

export function listPairedDevices(
  db: Pick<DatabaseService, 'listMobileDevices'>
): PairedDevice[] {
  return db.listMobileDevices()
}

export function revokePairedDevice(
  db: Pick<DatabaseService, 'revokeMobileDevice'>,
  deviceId: string
): boolean {
  return db.revokeMobileDevice(deviceId)
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

function validateMetadata(
  field: string,
  value: unknown,
  maxLength: number,
  required: true
): string
function validateMetadata(
  field: string,
  value: unknown,
  maxLength: number,
  required: false
): string | null
function validateMetadata(
  field: string,
  value: unknown,
  maxLength: number,
  required: boolean
): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string') {
    throw new MobileAuthError(400, 'invalid_request', `${field} must be a string`)
  }
  const normalized = value.trim()
  if ((required && normalized.length === 0) || normalized.length > maxLength) {
    throw new MobileAuthError(400, 'invalid_request', `${field} is invalid`)
  }
  return normalized || null
}
