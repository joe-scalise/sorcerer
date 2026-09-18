import crypto from 'crypto'
import { DatabaseService } from '../services/database-service'

export interface LiveAuthTokenTarget {
  setAuthToken(token: string): void
}

/** Get existing auth token or create a new one */
export function getOrCreateAuthToken(db: DatabaseService): string {
  let token = db.getSetting('remoteAuthToken')
  if (!token) {
    token = crypto.randomBytes(32).toString('hex')
    db.setSetting('remoteAuthToken', token)
  }
  return token
}

/** Generate a new auth token (invalidates old one) */
export function regenerateAuthToken(
  db: DatabaseService,
  liveServer?: LiveAuthTokenTarget | null
): string {
  const token = crypto.randomBytes(32).toString('hex')
  db.setSetting('remoteAuthToken', token)
  liveServer?.setAuthToken(token)
  return token
}
