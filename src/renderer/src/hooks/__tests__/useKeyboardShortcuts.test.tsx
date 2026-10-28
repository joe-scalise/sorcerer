// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'
import { useInboxStore } from '../../stores/useInboxStore'

const mocks = vi.hoisted(() => ({
  features: { standaloneAgents: false },
  ui: { activeDialog: null, contextMenu: null as object | null, openDialog: vi.fn(), splitRoot: null, searchQuery: 'query', setSearchQuery: vi.fn(), expandedGroups: new Set<string>() },
  session: { activeSessionId: 'terminal', sessions: [] as Array<{ id: string; type: string; project_id?: string; status?: string; agentId?: string }>, deleteSession: vi.fn().mockResolvedValue(undefined), setActiveSession: vi.fn() },
  agent: { agents: [{ id: 'standalone', name: 'Assistant', description: '', group_id: null }], groups: [] },
  project: { projects: [{ id: 'project', name: 'Project' }] }
}))
vi.mock('../../features', () => ({ getFeatures: () => mocks.features }))
vi.mock('../../stores/useUIStore', () => ({ useUIStore: Object.assign(() => mocks.ui, { getState: () => mocks.ui }), findLeaf: vi.fn() }))
vi.mock('../../stores/useSessionStore', () => ({ useSessionStore: { getState: () => mocks.session } }))
vi.mock('../../stores/useAgentStore', () => ({ useAgentStore: { getState: () => mocks.agent } }))
vi.mock('../../stores/useProjectStore', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('../../stores/useQuickNotesStore', () => ({ useQuickNotesStore: {} }))
vi.mock('../../components/TerminalView', () => ({ focusTerminal: vi.fn() }))

let root: Root
let host: HTMLDivElement
function Shortcuts() {
  useKeyboardShortcuts()
  return <><div className="xterm"><textarea /></div><input className="search-input" /><div id="menu" tabIndex={0} /><aside data-inbox><button id="inbox-control">Inbox</button></aside></>
}
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.features.standaloneAgents = false
  mocks.ui.contextMenu = null
  mocks.ui.searchQuery = 'query'
  mocks.session.activeSessionId = 'terminal'
  mocks.session.sessions = [{ id: 'terminal', type: 'quick-terminal' }]
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<Shortcuts />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function escape(target: HTMLElement) {
  target.focus()
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
}
describe('Escape routing', () => {
  it('leaves workspace shortcuts and Escape to the inbox while its controls have focus', () => {
    const control = host.querySelector('#inbox-control') as HTMLElement
    escape(control)
    act(() => control.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(mocks.session.deleteSession).not.toHaveBeenCalled()
    expect(mocks.ui.openDialog).not.toHaveBeenCalled()
  })

  it('opens capture with Ctrl+Shift+I while a terminal has focus', () => {
    useInboxStore.setState({ collapsed: true, focusRequest: 0 })
    const event = new KeyboardEvent('keydown', { key: 'I', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    act(() => host.querySelector('textarea')!.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(useInboxStore.getState()).toMatchObject({ collapsed: false, focusRequest: 1 })
    expect(mocks.ui.openDialog).not.toHaveBeenCalled()
  })

  it('does not delete the active quick terminal when Escape is typed in it', () => {
    escape(host.querySelector('textarea')!)
    expect(mocks.session.deleteSession).not.toHaveBeenCalled()
  })
  it('lets an open context menu own Escape without closing the session', () => {
    mocks.ui.contextMenu = {}
    escape(host.querySelector('#menu')!)
    expect(mocks.session.deleteSession).not.toHaveBeenCalled()
  })
  it('still clears search with Escape', () => {
    escape(host.querySelector('input')!)
    expect(mocks.ui.setSearchQuery).toHaveBeenCalledWith('')
    expect(mocks.session.deleteSession).not.toHaveBeenCalled()
  })
})

describe('standalone Agent navigation', () => {
  beforeEach(() => {
    mocks.ui.searchQuery = ''
    mocks.session.activeSessionId = ''
    mocks.session.sessions = [
      { id: 'project-session', type: 'session', project_id: 'project', status: 'active' }
    ]
  })

  function next() {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true, cancelable: true })))
  }

  it.each([
    { key: 'ArrowUp', altKey: true },
    { key: 'ArrowDown', altKey: true },
    { key: 'ArrowLeft', shiftKey: true },
    { key: 'ArrowRight', shiftKey: true },
    { key: 'Tab', shiftKey: true },
    { key: 'ArrowDown', altKey: true, ctrlKey: true, shiftKey: true },
    { key: 'ArrowDown', altKey: true, ctrlKey: true, metaKey: true }
  ])('leaves terminal input alone: %j', (input) => {
    const event = new KeyboardEvent('keydown', { ...input, bubbles: true, cancelable: true })
    act(() => host.querySelector('textarea')!.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.session.setActiveSession).not.toHaveBeenCalled()
    expect(mocks.ui.openDialog).not.toHaveBeenCalled()
  })

  it('navigates from a focused terminal with Ctrl+Alt+Down', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown', altKey: true, ctrlKey: true, bubbles: true, cancelable: true
    })
    act(() => host.querySelector('textarea')!.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.session.setActiveSession).toHaveBeenCalledWith('project-session')
  })

  it('navigates directly to Projects while saved standalone Agents are disabled', () => {
    next()
    expect(mocks.session.setActiveSession).toHaveBeenCalledWith('project-session')
    expect(mocks.agent.agents).toHaveLength(1)
  })

  it('keeps standalone Agent navigation when enabled', () => {
    mocks.features.standaloneAgents = true
    next()
    expect(mocks.session.setActiveSession).toHaveBeenCalledWith('standalone')
  })

  it('skips standalone Agent quick terminals while preserving project terminals', () => {
    mocks.session.sessions = [
      { id: 'agent-terminal', type: 'quick-terminal', project_id: 'project', status: 'active', agentId: 'standalone' },
      { id: 'project-terminal', type: 'quick-terminal', project_id: 'project', status: 'active' }
    ]
    next()
    expect(mocks.session.setActiveSession).toHaveBeenCalledWith('project-terminal')
  })
})
