// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '../../../../shared/inbox'

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('../../api/client', () => ({ getApi: () => ({ inbox: api }) }))
import { useInboxStore } from '../useInboxStore'

const item: InboxItem = { id: 'one', title: 'Original', body: '', project_id: null, pinned: false, status: 'open', created_at: 1, updated_at: 1 }
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  useInboxStore.setState(useInboxStore.getInitialState(), true)
  api.list.mockResolvedValue([item])
})

describe('inbox drafts and request ordering', () => {
  it('serializes a slow refresh before a capture so it cannot erase the new item', async () => {
    let finish!: (items: InboxItem[]) => void
    api.list.mockImplementationOnce(() => new Promise<InboxItem[]>((resolve) => { finish = resolve }))
    api.create.mockResolvedValue({ ...item, id: 'two', title: 'New thought' })
    const loading = useInboxStore.getState().loadItems()
    await Promise.resolve()
    useInboxStore.getState().setDraft({ title: 'New thought' })
    const creating = useInboxStore.getState().capture()
    expect(api.create).not.toHaveBeenCalled()
    finish([item])
    await Promise.all([loading, creating])
    expect(useInboxStore.getState().items.map((entry) => entry.id)).toEqual(['two', 'one'])
  })

  it('keeps failed capture and edit drafts for retry, and persists only drafts/preferences locally', async () => {
    await useInboxStore.getState().loadItems()
    useInboxStore.getState().setDraft({ title: 'Do not lose this', body: 'Some context' })
    api.create.mockRejectedValueOnce(new Error('Offline'))
    expect(await useInboxStore.getState().capture()).toBe(false)
    expect(useInboxStore.getState().draft.title).toBe('Do not lose this')
    useInboxStore.getState().startEditing(item)
    useInboxStore.getState().setEditDraft({ title: 'An unfinished edit' })
    api.update.mockRejectedValueOnce(new Error('Offline'))
    expect(await useInboxStore.getState().saveEdit()).toBe(false)
    expect(useInboxStore.getState().editDraft?.title).toBe('An unfinished edit')
    const saved = JSON.parse(localStorage.getItem('sorcerer-inbox-v1')!).state
    expect(saved.draft.title).toBe('Do not lose this')
    expect(saved.editDraft.title).toBe('An unfinished edit')
    expect(saved).not.toHaveProperty('items')
    api.update.mockResolvedValue({ ...item, title: 'An unfinished edit' })
    expect(await useInboxStore.getState().saveEdit()).toBe(true)
    expect(useInboxStore.getState().editDraft).toBeNull()
  })

  it('retains newer typing when an earlier capture finishes saving', async () => {
    let finish!: (entry: InboxItem) => void
    api.create.mockImplementationOnce(() => new Promise<InboxItem>((resolve) => { finish = resolve }))
    useInboxStore.getState().setDraft({ title: 'First thought' })
    const saving = useInboxStore.getState().capture()
    await Promise.resolve()
    useInboxStore.getState().setDraft({ title: 'Second thought' })
    finish({ ...item, title: 'First thought' })
    await saving
    expect(useInboxStore.getState().draft.title).toBe('Second thought')
  })
})
