// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MainContent } from '../MainContent'
import { useUIStore, findLeaf } from '../../stores/useUIStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { useAgentStore } from '../../stores/useAgentStore'
import type { Session, Agent } from '../../types'

vi.mock('../TerminalView', () => ({ TerminalView: () => <div>Terminal</div>, disposeTerminal: vi.fn() }))
vi.mock('../Updates', () => ({ Updates: () => null }))
vi.mock('../OrphanWorkspaceBanner', () => ({ OrphanWorkspaceBanner: () => null }))
vi.mock('../ParticleCanvas', () => ({ ParticleCanvas: () => null }))
vi.mock('../QuickNotesEditor', () => ({ QuickNotesEditor: () => <div>Notes</div> }))
vi.mock('../../api/client', () => ({ getApi: () => ({ settings: { get: async () => 'false' } }) }))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useUIStore.setState({ splitRoot: null, focusedPanelId: null, maximizedPanelId: null, focusModeSessionId: null, spotlightMode: false })
  useSessionStore.setState({ sessions: [], activeSessionId: null })
  useAgentStore.setState({ agents: [] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it.each(['session', 'quick-terminal', 'agent', 'notes', 'empty'])('expands the selected %s panel without adding or removing panels', async (kind) => {
  const sessionId = kind === 'notes' ? 'quicknotes:session:parent' : kind === 'empty' ? null : 'target'
  useSessionStore.setState({
    activeSessionId: 'parent',
    sessions: [{ id: 'parent', name: 'Parent', status: 'active', type: 'session' },
      ...(kind === 'session' || kind === 'quick-terminal'
        ? [{ id: 'target', name: 'Target', status: 'active', type: kind }] : [])] as Session[]
  })
  if (kind === 'agent') useAgentStore.setState({ agents: [{ id: 'target', name: 'Target', status: 'active' } as Agent] })
  useUIStore.setState({
    focusedPanelId: 'first',
    splitRoot: { type: 'split', id: 'rows', direction: 'vertical', ratio: 0.5, children: [
      { type: 'split', id: 'columns', direction: 'horizontal', ratio: 0.5, children: [
        { type: 'leaf', id: 'first', sessionId: 'parent' },
        { type: 'leaf', id: 'target-pane', sessionId }
      ] }, { type: 'leaf', id: 'bottom', sessionId: null }
    ] }
  })
  await act(async () => root.render(<MainContent />))
  act(() => (host.querySelectorAll('[aria-label="Panel actions"]')[1] as HTMLButtonElement).click())
  const menu = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(menu.find(button => button.textContent === 'Expand horizontally')?.disabled).toBe(true)
  const expand = menu.find(button => button.textContent === 'Expand vertically')!
  expect(expand.disabled).toBe(false)
  act(() => expand.click())
  const state = useUIStore.getState()
  expect(state.splitRoot?.type === 'split' && state.splitRoot.direction).toBe('horizontal')
  expect(state.focusedPanelId).toBe('target-pane')
  expect(findLeaf(state.splitRoot!, 'target-pane')?.sessionId).toBe(sessionId)
  expect(host.querySelectorAll('.split-panel')).toHaveLength(3)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
