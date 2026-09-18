// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionBar } from '../ActionBar'
import { OrphanWorkspaceBanner } from '../OrphanWorkspaceBanner'

const mocks = vi.hoisted(() => ({
  features: { standaloneAgents: false },
  openDialog: vi.fn(),
  openSearch: vi.fn(),
  scanOrphans: vi.fn(),
  scanOrphanAgents: vi.fn(),
  load: vi.fn(),
  addToast: vi.fn()
}))
vi.mock('../../features', () => ({ getFeatures: () => mocks.features }))
vi.mock('../../stores/useUIStore', () => ({ useUIStore: () => ({ openDialog: mocks.openDialog, openSearch: mocks.openSearch }) }))
vi.mock('../../stores/useProjectStore', () => ({ useProjectStore: (select: any) => select({ loadProjects: mocks.load }) }))
vi.mock('../../stores/useSessionStore', () => ({ useSessionStore: (select: any) => select({ loadSessions: mocks.load }) }))
vi.mock('../../stores/useAgentStore', () => ({ useAgentStore: (select: any) => select({ loadAgents: mocks.load }) }))
vi.mock('../../stores/useToastStore', () => ({ useToastStore: (select: any) => select({ addToast: mocks.addToast }) }))
vi.mock('../../api/client', () => ({ getApi: () => ({ workspace: { scanOrphans: mocks.scanOrphans, scanOrphanAgents: mocks.scanOrphanAgents } }) }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.features.standaloneAgents = false
  mocks.scanOrphans.mockResolvedValue([{ dirName: 'project-workspace', sessionCount: 1, fullPath: '/workspace', lastModified: new Date().toISOString(), diskSize: 0 }])
  mocks.scanOrphanAgents.mockResolvedValue([{ dirName: 'saved-agent', agentName: 'Saved agent', fullPath: '/agents/saved-agent', hasManifest: true, lastModified: new Date().toISOString(), fileCount: 1 }])
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('standalone Agent entry points', () => {
  it.each([false, true])('keeps project/session creation and gates Agent creation (collapsed=%s)', async (collapsed) => {
    await act(async () => root.render(<ActionBar collapsed={collapsed} />))
    expect(host.querySelector('[title="New Agent"]')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="New session"]')!.click())
    expect(mocks.openDialog).toHaveBeenLastCalledWith('new-session')
    if (collapsed) {
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add project"]')!.click())
      expect(mocks.openDialog).toHaveBeenLastCalledWith('add-project')
    }
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Search"]')!.click())
    expect(mocks.openSearch).toHaveBeenCalledOnce()

    mocks.features.standaloneAgents = true
    await act(async () => root.render(<ActionBar collapsed={collapsed} />))
    await act(async () => host.querySelector<HTMLButtonElement>('[title="New Agent"]')!.click())
    expect(mocks.openDialog).toHaveBeenLastCalledWith('add-agent')
  })

  it('keeps project recovery without scanning or surfacing hidden Agent workspaces', async () => {
    await act(async () => root.render(<OrphanWorkspaceBanner />))
    expect(mocks.scanOrphans).toHaveBeenCalledOnce()
    expect(mocks.scanOrphanAgents).not.toHaveBeenCalled()
    expect(host.textContent).toContain('project-workspace')
    expect(host.textContent).not.toContain('Saved agent')
    expect(host.textContent).not.toContain('Re-import')
  })

  it('retains Agent workspace recovery when explicitly enabled', async () => {
    mocks.features.standaloneAgents = true
    await act(async () => root.render(<OrphanWorkspaceBanner />))
    expect(mocks.scanOrphanAgents).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('Saved agent')
    expect(host.textContent).toContain('Re-import')
  })
})
