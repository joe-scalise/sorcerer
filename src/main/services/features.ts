import { STANDALONE_AGENTS_SETTING, type FeatureFlags } from '../../shared/features'

type SettingsSource = { getSetting(key: string): string | undefined }

// Preferences take effect on the next application start. Keep the effective
// capabilities stable so saving a preference cannot hide or stop running work.
const snapshots = new WeakMap<SettingsSource, Readonly<FeatureFlags>>()

export function getFeatureFlags(db: SettingsSource, initialSnapshot?: Readonly<FeatureFlags>): Readonly<FeatureFlags> {
  let flags = snapshots.get(db)
  if (!flags) {
    flags = initialSnapshot ?? Object.freeze({ standaloneAgents: db.getSetting(STANDALONE_AGENTS_SETTING) === 'true' })
    snapshots.set(db, flags)
  }
  return flags
}

export class FeatureDisabledError extends Error {}

export function requireStandaloneAgents(db: SettingsSource): void {
  if (!getFeatureFlags(db).standaloneAgents) {
    throw new FeatureDisabledError('Agents are disabled. Enable Agents in Settings and restart Sorcerer to use them.')
  }
}
