import { beforeEach, expect, it, vi } from 'vitest'
import type { DatabaseService } from '../database-service'
import { listProviders, resolveLaunchModel } from '../provider-registry'

vi.mock('child_process', () => ({ spawnSync: () => ({ status: 0, stdout: 'Usage: cli --model <model>', stderr: '' }) }))
const settings = new Map<string, string>()
const db = {
  getSetting: (key: string) => settings.get(key),
  setSetting: (key: string, value: string) => settings.set(key, value)
} as unknown as DatabaseService
beforeEach(() => settings.clear())

it('discovers newly shipped providers from an existing cached installation and preserves model settings', () => {
  settings.set('providerRegistry', JSON.stringify({ providers: [{ id: 'claude', name: 'Claude Code', detected: true, models: ['model'] }], refreshedAt: 1 }))
  settings.set('defaultProvider', 'claude')
  settings.set('defaultModel.claude', 'saved-model')
  const providers = listProviders(db)
  expect(providers.find(provider => provider.id === 'copilot')).toMatchObject({ detected: true, supportsMcpConfig: true, supportsModelOverride: true })
  expect(providers.find(provider => provider.id === 'claude')).toMatchObject({ isDefault: true, defaultModel: 'saved-model' })
  expect(resolveLaunchModel(db, 'copilot')).toBe('')
  expect(resolveLaunchModel(db, 'copilot', 'account-specific-model')).toBe('account-specific-model')
  settings.set('defaultProvider', 'copilot')
  settings.set('defaultModel', 'legacy-claude-model')
  expect(resolveLaunchModel(db, 'copilot')).toBe('')
})
