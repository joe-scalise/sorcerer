// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewSessionDialog } from '../NewSessionDialog'
import { LandDialog } from '../LandDialog'
import { AddProjectDialog } from '../AddProjectDialog'

const mocks = vi.hoisted(() => ({
  ui: { activeDialog: 'new-session', dialogTargetId: 'a', dialogClosing: false, closeDialog: vi.fn() },
  checkGit: vi.fn(),
  divergence: vi.fn(),
  createSession: vi.fn(),
  landOnMain: vi.fn(),
  addProject: vi.fn(),
  addProjectByPath: vi.fn(),
  provider: { id: 'claude', name: 'Claude', models: ['sonnet'], supportsModelOverride: true, defaultModel: 'sonnet' }
}))

vi.mock('../../../stores/useUIStore', () => ({
  useUIStore: (selector?: (state: typeof mocks.ui) => unknown) => selector ? selector(mocks.ui) : mocks.ui
}))
vi.mock('../../../stores/useProjectStore', () => ({
  useProjectStore: () => ({ projects: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], addProject: mocks.addProject, addProjectByPath: mocks.addProjectByPath })
}))
vi.mock('../../../stores/useSessionStore', () => ({
  useSessionStore: () => ({ sessions: [{ id: 'a', name: 'Feature' }], createSession: mocks.createSession, landOnMain: mocks.landOnMain })
}))
vi.mock('../../../api/client', () => ({ getApi: () => ({ project: { checkGit: mocks.checkGit }, session: { divergence: mocks.divergence } }) }))
vi.mock('../../../hooks/useProviders', () => ({
  useProviders: () => ({ detectedProviders: [mocks.provider], defaultProvider: mocks.provider, getProvider: () => mocks.provider, loading: false })
}))
vi.mock('../../../utils/newSessionDefaults', () => ({ resolveNewSessionProjectId: () => 'a' }))

let host: HTMLDivElement
let root: Root

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.ui.activeDialog = 'new-session'
  mocks.ui.dialogTargetId = 'a'
  mocks.checkGit.mockResolvedValue({ hasGit: true, hasCommits: true })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('creation and landing workflows', () => {
  it('discards stale Git results when switching projects', async () => {
    const first = deferred<{ hasGit: boolean; hasCommits: boolean }>()
    const second = deferred<{ hasGit: boolean; hasCommits: boolean }>()
    mocks.checkGit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await act(async () => root.render(<NewSessionDialog />))
    mocks.ui.dialogTargetId = 'b'
    await act(async () => root.render(<NewSessionDialog />))
    await act(async () => second.resolve({ hasGit: false, hasCommits: false }))
    await act(async () => first.resolve({ hasGit: true, hasCommits: true }))
    expect(host.textContent).toContain('will run directly in this folder')
    expect(host.textContent).not.toContain('Work in main repository')
  })

  it('shows Git lookup errors and keeps creation disabled', async () => {
    mocks.checkGit.mockRejectedValueOnce(new Error('Unavailable'))
    await act(async () => root.render(<NewSessionDialog />))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not check')
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  it('keeps the custom model editor visible when its text matches a suggestion', async () => {
    await act(async () => root.render(<NewSessionDialog />))
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[aria-haspopup="listbox"]')[1].click())
    const customOption = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((button) => button.textContent === 'Custom…')!
    await act(async () => customOption.click())
    const input = host.querySelector<HTMLInputElement>('[aria-label="Custom model"]')!
    expect(input).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sonnet')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector('[aria-label="Custom model"]')).toBe(input)
    expect(input.value).toBe('sonnet')
  })

  it('reports an unsuccessful project add without closing the form', async () => {
    mocks.ui.activeDialog = 'add-project'
    mocks.addProjectByPath.mockResolvedValueOnce(null)
    await act(async () => root.render(<AddProjectDialog />))
    const input = host.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'C:\\missing')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not add this folder')
    expect(mocks.ui.closeDialog).not.toHaveBeenCalled()
  })

  it.each(['missing', 'rejected'])('never reports a healthy branch for a %s divergence response', async (kind) => {
    mocks.ui.activeDialog = 'land-session'
    if (kind === 'missing') mocks.divergence.mockResolvedValueOnce(null)
    else mocks.divergence.mockRejectedValueOnce(new Error('Git unavailable'))
    await act(async () => root.render(<LandDialog />))
    expect(host.textContent).not.toContain('Branch is up to date')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not check branch health')
    expect(Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Land')?.disabled).toBe(true)
    expect(mocks.landOnMain).not.toHaveBeenCalled()
  })

  it('keeps project browsing open while the operation is in progress', async () => {
    mocks.ui.activeDialog = 'add-project'
    const pending = deferred<null>()
    mocks.addProject.mockReturnValueOnce(pending.promise)
    await act(async () => root.render(<AddProjectDialog />))
    await act(async () => host.querySelector<HTMLButtonElement>('.dialog-browse-btn')?.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(mocks.ui.closeDialog).not.toHaveBeenCalled()
    await act(async () => pending.resolve(null))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(mocks.ui.closeDialog).toHaveBeenCalledOnce()
  })
})
