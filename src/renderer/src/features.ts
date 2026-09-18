import type { FeatureFlags } from '../../shared/features'
import { getApi } from './api/client'

// Read once before mounting any window. A pending Settings change must not hide
// running work or expose controls that the main process has not enabled yet.
let features: Readonly<FeatureFlags> = Object.freeze({ standaloneAgents: false })

export function getFeatures(): Readonly<FeatureFlags> { return features }

export async function loadFeatures(): Promise<void> {
  const effective = await getApi().system.features()
  if (typeof effective?.standaloneAgents !== 'boolean') throw new Error('Could not load application features.')
  features = Object.freeze({ standaloneAgents: effective.standaloneAgents })
}
