// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { useUIStore, findLeaf } from '../useUIStore'
import { useSessionStore } from '../useSessionStore'

vi.mock('../../components/TerminalView', () => ({ disposeTerminal: vi.fn() }))

beforeEach(() => {
  useUIStore.setState({ splitRoot: null, focusedPanelId: null, maximizedPanelId: null })
  useSessionStore.setState({ activeSessionId: 'session-2' })
})

it('keeps the expanded panel focused, restores the layout from maximized mode and persists it', () => {
  useUIStore.setState({
    splitRoot: { type: 'split', id: 'rows', direction: 'vertical', ratio: 0.5, children: [
      { type: 'split', id: 'columns', direction: 'horizontal', ratio: 0.5, children: [
        { type: 'leaf', id: '1', sessionId: 'session-1' },
        { type: 'leaf', id: '2', sessionId: 'session-2' }
      ] }, { type: 'leaf', id: '3', sessionId: 'quicknotes:session:session-1' }
    ] }, focusedPanelId: '1', maximizedPanelId: '2'
  })
  const panel = findLeaf(useUIStore.getState().splitRoot!, '2')
  useUIStore.getState().expandPanel('2', 'vertical')
  const state = useUIStore.getState()
  expect(state.splitRoot?.type === 'split' && state.splitRoot.direction).toBe('horizontal')
  expect(findLeaf(state.splitRoot!, '2')).toBe(panel)
  expect(state.focusedPanelId).toBe('2')
  expect(state.maximizedPanelId).toBeNull()
  expect(useSessionStore.getState().activeSessionId).toBe('session-2')
  const storage = useUIStore.persist.getOptions().storage!
  expect((storage.getItem(useUIStore.persist.getOptions().name!) as any).state.splitRoot).toEqual(state.splitRoot)
})

it('leaves focus and maximization untouched for an unavailable expansion', () => {
  useUIStore.setState({ focusedPanelId: 'one', maximizedPanelId: 'one' })
  useUIStore.getState().expandPanel('missing', 'horizontal')
  expect(useUIStore.getState().focusedPanelId).toBe('one')
  expect(useUIStore.getState().maximizedPanelId).toBe('one')
})
