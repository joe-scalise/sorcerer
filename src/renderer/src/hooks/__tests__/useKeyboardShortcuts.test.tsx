// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

const mocks = vi.hoisted(() => ({
  ui: { activeDialog: null, contextMenu: null as object | null, openDialog: vi.fn(), splitRoot: null, searchQuery: 'query', setSearchQuery: vi.fn() },
  session: { activeSessionId: 'terminal', sessions: [{ id: 'terminal', type: 'quick-terminal' }], deleteSession: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('../../stores/useUIStore', () => ({ useUIStore: Object.assign(() => mocks.ui, { getState: () => mocks.ui }), findLeaf: vi.fn() }))
vi.mock('../../stores/useSessionStore', () => ({ useSessionStore: { getState: () => mocks.session } }))
vi.mock('../../stores/useAgentStore', () => ({ useAgentStore: {} }))
vi.mock('../../stores/useProjectStore', () => ({ useProjectStore: {} }))
vi.mock('../../stores/useQuickNotesStore', () => ({ useQuickNotesStore: {} }))
vi.mock('../../components/TerminalView', () => ({ focusTerminal: vi.fn() }))

let root: Root
let host: HTMLDivElement
function Shortcuts() {
  useKeyboardShortcuts()
  return <><div className="xterm"><textarea /></div><input className="search-input" /><div id="menu" tabIndex={0} /></>
}
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.ui.contextMenu = null
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
