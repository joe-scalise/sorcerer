import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), delete: vi.fn() }))
vi.mock('../../api/client', () => ({ getApi: () => ({ quickNotes: api }) }))
import { flushAllNoteDrafts, noteKey, useQuickNotesDraftStore } from '../useQuickNotesDraftStore'
import { useQuickNotesStore } from '../useQuickNotesStore'

const store = () => useQuickNotesDraftStore.getState()
const draft = () => store().drafts[noteKey('session-1', 'session')]
const load = () => store().load('session-1', 'session')
const update = (content: string) => store().update('session-1', 'session', content)
const flush = () => store().flush('session-1', 'session')

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  api.load.mockResolvedValue(undefined)
  api.save.mockResolvedValue(undefined)
  api.delete.mockResolvedValue(undefined)
  useQuickNotesDraftStore.setState({ drafts: {} })
  useQuickNotesStore.setState({ savedNotes: new Set() })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('quick note draft persistence', () => {
  it('blocks installation when flushing a draft fails, then permits a successful retry', async () => {
    await load()
    update('do not lose this')
    api.save.mockRejectedValueOnce(new Error('Disk full'))
    await expect(flushAllNoteDrafts()).rejects.toThrow('could not be saved')
    expect(draft().content).toBe('do not lose this')
    await expect(flushAllNoteDrafts()).resolves.toBeUndefined()
    expect(draft().dirty).toBe(false)
  })
  it('flushes the latest edits immediately when the editor closes before debounce', async () => {
    await load()
    update('first')
    update('latest')
    expect(api.save).not.toHaveBeenCalled()
    await flush()
    expect(api.save).toHaveBeenCalledExactlyOnceWith(draft().id, 'session-1', 'session', 'latest')
    expect(draft().dirty).toBe(false)
  })

  it('shares pending drafts and note identity between multiple editors', async () => {
    await Promise.all([load(), load()])
    expect(api.load).toHaveBeenCalledTimes(1)
    const id = draft().id
    update('pending draft')
    await load()
    expect(draft()).toMatchObject({ id, content: 'pending draft' })
    await flush()
  })

  it('refreshes saved notes when reopening after edits in another window', async () => {
    api.load.mockResolvedValueOnce({ id: 'persisted', content: 'original' })
    await load()
    api.load.mockResolvedValueOnce({ id: 'persisted', content: 'changed elsewhere' })
    await load()
    expect(draft()).toMatchObject({ id: 'persisted', content: 'changed elsewhere', dirty: false })
  })

  it('serializes saves so slow older writes cannot overwrite newer edits', async () => {
    await load()
    let complete!: () => void
    api.save.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    update('older')
    const saving = flush()
    update('newer')
    await vi.advanceTimersByTimeAsync(500)
    expect(api.save).toHaveBeenCalledTimes(1)
    complete()
    await saving
    expect(api.save.mock.calls.map((call) => call[3])).toEqual(['older', 'newer'])
    expect(draft().dirty).toBe(false)
  })

  it('keeps a failed save as a retryable draft and does not mark it saved', async () => {
    await load()
    api.save.mockRejectedValueOnce(new Error('offline'))
    update('keep me')
    await flush()
    expect(draft()).toMatchObject({ content: 'keep me', dirty: true })
    expect(draft().error).toContain('Could not save')
    expect(useQuickNotesStore.getState().savedNotes.has('session-1')).toBe(false)
    await flush()
    expect(draft()).toMatchObject({ dirty: false, error: null })
  })

  it('waits for an in-flight save before deleting and cancels later edits', async () => {
    await load()
    let complete!: () => void
    api.save.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    update('sent')
    const saving = flush()
    update('pending')
    const deleting = store().remove('session-1', 'session')
    expect(api.delete).not.toHaveBeenCalled()
    complete()
    await Promise.all([saving, deleting])
    await vi.advanceTimersByTimeAsync(500)
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.delete).toHaveBeenCalledExactlyOnceWith('session-1', 'session')
    expect(draft()).toMatchObject({ content: '', dirty: false, deleting: false })
  })

  it('does not allow loading notes to overwrite user input', async () => {
    let complete!: (note: object) => void
    api.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const loading = load()
    update('cannot type while loading')
    complete({ id: 'persisted', content: 'saved note' })
    await loading
    expect(draft()).toMatchObject({ id: 'persisted', content: 'saved note', dirty: false })
    expect(api.save).not.toHaveBeenCalled()
  })
})
