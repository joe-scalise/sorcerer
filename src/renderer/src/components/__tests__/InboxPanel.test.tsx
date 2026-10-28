// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '../../../../shared/inbox'

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), reorder: vi.fn(), delete: vi.fn() }))
const exportCsv = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', () => ({ getApi: () => ({ inbox: api }) }))
vi.mock('../../utils/inboxExport', () => ({ downloadInboxCsv: exportCsv }))
vi.mock('../TerminalView', () => ({ disposeTerminal: vi.fn(), focusTerminal: vi.fn() }))
import { InboxPanel } from '../InboxPanel'
import { useInboxStore } from '../../stores/useInboxStore'
import { useProjectStore } from '../../stores/useProjectStore'

let root: Root
let host: HTMLDivElement
let records: InboxItem[]
const initial: InboxItem = { id: 'capture', title: 'Ask about the design', body: 'Bring the reference link.', project_id: 'project', pinned: false, status: 'open', created_at: 1000, updated_at: 1000 }

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  localStorage.clear()
  records = []
  useInboxStore.setState(useInboxStore.getInitialState(), true)
  useProjectStore.setState({ projects: [{ id: 'project', name: 'Sorcerer', path: '/project' }] })
  api.list.mockImplementation(async () => [...records])
  api.delete.mockImplementation(async (id) => { records = records.filter((entry) => entry.id !== id) })
  api.create.mockImplementation(async (draft) => {
    const item = { ...initial, ...draft, id: `capture-${records.length}`, created_at: Date.now() }
    records.push(item)
    return item
  })
  api.update.mockImplementation(async (id, changes) => {
    const item = { ...records.find((entry) => entry.id === id)!, ...changes }
    records = records.map((entry) => entry.id === id ? item : entry)
    return item
  })
  api.reorder.mockImplementation(async (id, targetId) => {
    const ordered = [...records]
    const source = ordered.findIndex((entry) => entry.id === id)
    const target = ordered.findIndex((entry) => entry.id === targetId)
    ordered.splice(target, 0, ordered.splice(source, 1)[0])
    records = ordered.map((entry, index) => ({ ...entry, sort_order: index }))
    return records
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

async function render() { await act(async () => root.render(<InboxPanel />)) }
function field(label: string) { return host.querySelector(`[aria-label="${label}"]`) as HTMLTextAreaElement }
function type(label: string, value: string) {
  const target = field(label)
  const prototype = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value)
    target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.getAttribute('aria-label') === label || entry.textContent === label)!
  expect(button, label).toBeDefined()
  await act(async () => button.click())
}

describe('native inbox interactions', () => {
  it('exports only the current project and status view', async () => {
    records = [initial, { ...initial, id: 'other', project_id: null }, { ...initial, id: 'done', status: 'done' }]
    await render()
    type('Filter inbox by project', 'project')
    await click('Export visible list as CSV')
    expect(exportCsv).toHaveBeenCalledOnce()
    expect(exportCsv.mock.calls[0][0]).toEqual([initial])
    expect(exportCsv.mock.calls[0][2]).toBe('open')
    await act(async () => useInboxStore.getState().setView('done'))
    await click('Export visible list as CSV')
    expect(exportCsv.mock.calls[1][0]).toEqual([records[2]])
    expect(exportCsv.mock.calls[1][2]).toBe('done')
  })
  it('confirms deletion, supports cancellation and retains an item after a failed delete', async () => {
    records = [initial]
    await render()
    await click(`Delete: ${initial.title}`)
    await click('Cancel')
    expect(api.delete).not.toHaveBeenCalled()
    await click(`Delete: ${initial.title}`)
    api.delete.mockRejectedValueOnce(new Error('Disk full'))
    await click('Delete')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not delete')
    expect(host.querySelectorAll('article')).toHaveLength(1)
    await click('Delete')
    expect(host.querySelectorAll('article')).toHaveLength(0)
  })
  it('collapses capture while preserving its draft and reopens it for the capture shortcut', async () => {
    records = [initial]
    await render()
    type('Capture a thought', 'Keep this draft')
    await click('Collapse capture')
    expect(host.querySelector('#inbox-capture-form')?.hasAttribute('hidden')).toBe(true)
    expect(host.querySelectorAll('article')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('sorcerer-inbox-v1')!).state.captureOpen).toBe(false)
    await act(async () => useInboxStore.getState().openCapture())
    expect(host.querySelector('#inbox-capture-form')?.hasAttribute('hidden')).toBe(false)
    expect(field('Capture a thought').value).toBe('Keep this draft')
    expect(document.activeElement).toBe(field('Capture a thought'))
  })
  it('reorders items with the keyboard and shows the pinned icon as active', async () => {
    records = [{ ...initial, id: 'one', title: 'First', created_at: 2 }, { ...initial, id: 'two', title: 'Second', created_at: 1 }]
    await render()
    const handle = host.querySelector('[aria-label="Reorder: Second"]')!
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })))
    expect(api.reorder).toHaveBeenCalledWith('two', 'one')
    expect(host.querySelectorAll('article')[0].getAttribute('aria-label')).toBe('Second')
    await click('Pin: Second')
    expect(host.querySelector('[aria-label="Unpin: Second"]')?.classList.contains('is-active')).toBe(true)
  })
  it('hides the entire panel while preserving drafts, and restores it when enabled', async () => {
    await render()
    type('Capture a thought', 'Keep this draft')
    await act(async () => useInboxStore.getState().setEnabled(false))
    expect(host.querySelector('[data-inbox]')).toBeNull()
    await act(async () => useInboxStore.getState().setEnabled(true))
    expect(field('Capture a thought').value).toBe('Keep this draft')
    expect(JSON.parse(localStorage.getItem('sorcerer-inbox-v1')!).state.enabled).toBe(true)
  })

  it('resizes using the divider and persists the selected width', async () => {
    await render()
    const divider = host.querySelector('[aria-label="Resize inbox"]') as HTMLElement
    act(() => divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: window.innerWidth - 450 })))
    act(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: window.innerWidth - 450 })))
    expect(useInboxStore.getState().width).toBe(450)
    expect(JSON.parse(localStorage.getItem('sorcerer-inbox-v1')!).state.width).toBe(450)
    expect(divider.getAttribute('aria-valuenow')).toBe('450')
  })

  it('captures a project thought with details, then edits it independently of sessions', async () => {
    await render()
    type('Capture a thought', 'Try a smaller first release')
    await click('+ Details')
    type('Capture details', 'Discuss the scope before Friday.')
    type('Capture project', 'project')
    await click('Capture')
    expect(api.create).toHaveBeenCalledWith({ title: 'Try a smaller first release', body: 'Discuss the scope before Friday.', project_id: 'project' })
    expect(field('Capture a thought').value).toBe('')
    expect(host.querySelectorAll('article')).toHaveLength(1)
    await click('Try a smaller first release')
    type('Edit thought', 'A smaller release')
    await click('Save changes')
    expect(records[0].title).toBe('A smaller release')
    expect(host.textContent).toContain('A smaller release')
  })

  it('supports pin, done, archive and restore with project filtering', async () => {
    records = [initial, { ...initial, id: 'unassigned', title: 'Another thought', project_id: null }]
    await render()
    type('Filter inbox by project', 'project')
    expect(host.querySelectorAll('article')).toHaveLength(1)
    await click(`Pin: ${initial.title}`)
    expect(records[0].pinned).toBe(true)
    await click(`Mark done: ${initial.title}`)
    expect(host.querySelectorAll('article')).toHaveLength(0)
    await act(async () => useInboxStore.getState().setView('done'))
    await click(`Archive: ${initial.title}`)
    await act(async () => useInboxStore.getState().setView('archived'))
    await click(`Restore: ${initial.title}`)
    expect(records[0].status).toBe('open')
    await act(async () => useInboxStore.getState().setView('open'))
    expect(host.querySelectorAll('article')).toHaveLength(1)
  })

  it('keeps input and unfinished edits across errors, collapse and reopening', async () => {
    records = [initial]
    await render()
    type('Capture a thought', 'A thought worth keeping')
    api.create.mockRejectedValueOnce(new Error('Disk full'))
    await click('Capture')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Your draft is kept')
    expect(field('Capture a thought').value).toBe('A thought worth keeping')
    await click(initial.title)
    type('Edit details', 'Unfinished details')
    await click('Collapse inbox')
    expect(host.querySelector('#personal-inbox-content')?.hasAttribute('hidden')).toBe(true)
    await act(async () => useInboxStore.getState().openCapture())
    expect(field('Edit details').value).toBe('Unfinished details')
    expect(field('Capture a thought').value).toBe('A thought worth keeping')
    expect(document.activeElement).toBe(field('Capture a thought'))
  })

  it('offers retry for a failed load and does not replace the inbox with a false empty state', async () => {
    api.list.mockRejectedValueOnce(new Error('Disconnected'))
    await render()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load')
    expect(host.querySelector('.inbox-empty')).toBeNull()
    records = [initial]
    await click('Try again')
    expect(host.querySelectorAll('article')).toHaveLength(1)
  })
})
