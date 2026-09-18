// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionBar } from '../ActionBar'
import { SearchBar } from '../SearchBar'
import { useUIStore } from '../../stores/useUIStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'

const mocks = vi.hoisted(() => ({ deleteSession: vi.fn() }))
vi.mock('../../features', () => ({ getFeatures: () => ({ standaloneAgents: false }) }))
vi.mock('../../stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ activeSessionId: null, sessions: [], deleteSession: mocks.deleteSession }) } }))
vi.mock('../TerminalView', () => ({ focusTerminal: vi.fn() }))

let host: HTMLDivElement
let root: Root
function Header() {
  useKeyboardShortcuts()
  const { sidebarHidden, sidebarCollapsed } = useUIStore()
  if (sidebarHidden) return null
  return <><ActionBar collapsed={sidebarCollapsed} />{!sidebarCollapsed && <SearchBar />}</>
}
function key(target: HTMLElement, key: string, ctrlKey = false) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  useUIStore.setState({ ...useUIStore.getInitialState() })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<Header />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('sidebar search', () => {
  it('starts compact and reveals a focused field from the search action', () => {
    expect(host.querySelector('input')).toBeNull()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Search"]')!.click())
    expect(document.activeElement).toBe(host.querySelector('input'))
    expect(host.querySelector('[aria-label="Search"]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it.each(['collapsed', 'hidden'])('Ctrl+K reveals and focuses search from a %s sidebar', (mode) => {
    act(() => useUIStore.setState({ sidebarCollapsed: true, sidebarHidden: mode === 'hidden' }))
    key(document.body, 'k', true)
    expect(useUIStore.getState().sidebarHidden).toBe(false)
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    expect(host.querySelector('input')).not.toBeNull()
    expect(document.activeElement).toBe(host.querySelector('input'))
  })

  it('refocuses an already open search and preserves its query', () => {
    act(() => useUIStore.getState().setSearchQuery('work'))
    host.querySelector<HTMLButtonElement>('[aria-label="New session"]')!.focus()
    key(document.body, 'k', true)
    expect(document.activeElement).toBe(host.querySelector('input'))
    expect(host.querySelector('input')?.value).toBe('work')
  })

  it('Escape clears first, then dismisses and restores focus without closing a session', () => {
    act(() => useUIStore.getState().setSearchQuery('work'))
    const clear = host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!
    clear.focus()
    key(clear, 'Escape')
    expect(host.querySelector('input')?.value).toBe('')
    expect(document.activeElement).toBe(host.querySelector('input'))
    key(host.querySelector('input')!, 'Escape')
    expect(host.querySelector('input')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Search"]'))
    expect(mocks.deleteSession).not.toHaveBeenCalled()
  })

  it('keeps an active filter apparent after collapsing and reopens it on search', () => {
    act(() => useUIStore.getState().setSearchQuery('work'))
    act(() => useUIStore.getState().toggleSidebarCollapse())
    const search = host.querySelector<HTMLButtonElement>('[aria-label="Search (filter active)"]')!
    expect(search).not.toBeNull()
    act(() => search.click())
    expect(host.querySelector('input')?.value).toBe('work')
    expect(document.activeElement).toBe(host.querySelector('input'))
  })

  it('clears and closes from the field buttons', () => {
    act(() => useUIStore.getState().setSearchQuery('work'))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click())
    expect(host.querySelector('input')?.value).toBe('')
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!.click())
    expect(host.querySelector('input')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Search"]'))
  })
})
