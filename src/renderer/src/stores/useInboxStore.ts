import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getApi } from '../api/client'
import type { InboxItem, InboxStatus, InboxUpdateInput } from '../../../shared/inbox'

export interface InboxDraft {
  title: string
  body: string
  project_id: string | null
}
export interface InboxEditDraft extends InboxDraft {
  id: string
}
const emptyDraft = (): InboxDraft => ({ title: '', body: '', project_id: null })

// Serialize refreshes and writes so an older response cannot undo a newer edit.
let operations: Promise<unknown> = Promise.resolve()
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = operations.then(operation)
  operations = next.catch(() => {})
  return next
}

interface InboxState {
  items: InboxItem[]
  loaded: boolean
  loading: boolean
  loadError: string | null
  createError: string | null
  itemErrors: Record<string, string>
  creating: boolean
  pendingIds: string[]
  collapsed: boolean
  captureOpen: boolean
  setCaptureOpen: (open: boolean) => void
  enabled: boolean
  width: number
  setEnabled: (enabled: boolean) => void
  setWidth: (width: number) => void
  focusRequest: number
  view: InboxStatus
  projectFilter: string
  draft: InboxDraft
  editDraft: InboxEditDraft | null
  setCollapsed: (collapsed: boolean) => void
  openCapture: () => void
  setView: (view: InboxStatus) => void
  setProjectFilter: (id: string) => void
  setDraft: (changes: Partial<InboxDraft>) => void
  startEditing: (item: InboxItem) => void
  setEditDraft: (changes: Partial<InboxDraft>) => void
  cancelEditing: () => void
  loadItems: () => Promise<void>
  capture: () => Promise<boolean>
  updateItem: (id: string, changes: InboxUpdateInput) => Promise<boolean>
  reorderItem: (id: string, targetId: string) => Promise<void>
  deleteItem: (id: string) => Promise<boolean>
  saveEdit: () => Promise<boolean>
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback} ${error.message}` : fallback
}

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      items: [],
      loaded: false,
      loading: false,
      loadError: null,
      createError: null,
      itemErrors: {},
      creating: false,
      pendingIds: [],
      collapsed: false,
      captureOpen: true,
      setCaptureOpen: (captureOpen) => set({ captureOpen }),
      enabled: true,
      width: 320,
      setEnabled: (enabled) => set({ enabled }),
      setWidth: (width) => set({ width: Math.max(280, Math.min(800, width)) }),
      focusRequest: 0,
      view: 'open',
      projectFilter: '',
      draft: emptyDraft(),
      editDraft: null,
      setCollapsed: (collapsed) => set({ collapsed }),
      openCapture: () =>
        set((state) => ({ collapsed: false, captureOpen: true, focusRequest: state.focusRequest + 1 })),
      setView: (view) => set({ view }),
      setProjectFilter: (projectFilter) => set({ projectFilter }),
      setDraft: (changes) => set((state) => ({ draft: { ...state.draft, ...changes }, createError: null })),
      startEditing: (item) => {
        // Keep an unfinished edit until the user saves or explicitly cancels it.
        if (get().editDraft && get().editDraft!.id !== item.id) return
        if (!get().editDraft)
          set({ editDraft: { id: item.id, title: item.title, body: item.body, project_id: item.project_id } })
      },
      setEditDraft: (changes) =>
        set((state) => ({ editDraft: state.editDraft ? { ...state.editDraft, ...changes } : null })),
      cancelEditing: () => set({ editDraft: null }),
      loadItems: async () => {
        if (get().loading) return
        set({ loading: true, loadError: null })
        try {
          await enqueue(async () => {
            const items = await getApi().inbox.list()
            set({ items, loaded: true })
          })
        } catch (error) {
          set({ loadError: message(error, 'Could not load your inbox. Try again.') })
        } finally {
          set({ loading: false })
        }
      },
      capture: async () => {
        if (get().creating || !get().draft.title.trim()) return false
        const draft = { ...get().draft }
        set({ creating: true, createError: null })
        try {
          await enqueue(async () => {
            const item = await getApi().inbox.create(draft)
            set((state) => ({
              items: [item, ...state.items],
              view: 'open',
              projectFilter: '',
              draft: JSON.stringify(state.draft) === JSON.stringify(draft) ? emptyDraft() : state.draft
            }))
          })
          return true
        } catch (error) {
          set({ createError: message(error, 'Could not save. Your draft is kept; try again.') })
          return false
        } finally {
          set({ creating: false })
        }
      },
      updateItem: async (id, changes) => {
        if (get().pendingIds.includes(id)) return false
        set((state) => ({
          pendingIds: [...state.pendingIds, id],
          itemErrors: { ...state.itemErrors, [id]: '' }
        }))
        try {
          await enqueue(async () => {
            const updated = await getApi().inbox.update(id, changes)
            set((state) => ({ items: state.items.map((item) => (item.id === id ? updated : item)) }))
          })
          return true
        } catch (error) {
          set((state) => ({
            itemErrors: {
              ...state.itemErrors,
              [id]: message(error, 'Could not save this change. Try again.')
            }
          }))
          return false
        } finally {
          set((state) => ({ pendingIds: state.pendingIds.filter((pendingId) => pendingId !== id) }))
        }
      },
      deleteItem: async (id) => {
        if (get().pendingIds.includes(id)) return false
        set((state) => ({
          pendingIds: [...state.pendingIds, id],
          itemErrors: { ...state.itemErrors, [id]: '' }
        }))
        try {
          await enqueue(async () => {
            await getApi().inbox.delete(id)
            set((state) => ({
              items: state.items.filter((item) => item.id !== id),
              editDraft: state.editDraft?.id === id ? null : state.editDraft
            }))
          })
          return true
        } catch (error) {
          set((state) => ({
            itemErrors: {
              ...state.itemErrors,
              [id]: message(error, 'Could not delete this item. Try again.')
            }
          }))
          return false
        } finally {
          set((state) => ({ pendingIds: state.pendingIds.filter((pendingId) => pendingId !== id) }))
        }
      },
      reorderItem: async (id, targetId) => {
        try {
          await enqueue(async () => {
            const items = await getApi().inbox.reorder(id, targetId)
            set({ items, loadError: null })
          })
        } catch (error) {
          set({ loadError: message(error, 'Could not reorder items. Try again.') })
        }
      },
      saveEdit: async () => {
        const draft = get().editDraft
        if (!draft || !draft.title.trim()) return false
        const { id, ...changes } = draft
        const saved = await get().updateItem(id, changes)
        if (saved && get().editDraft === draft) set({ editDraft: null })
        return saved
      }
    }),
    {
      name: 'sorcerer-inbox-v1',
      storage: createJSONStorage(() => localStorage),
      // Database records live in SQLite. Only unfinished user input and view choices live here.
      partialize: (state) => ({
        draft: state.draft,
        editDraft: state.editDraft,
        collapsed: state.collapsed,
        captureOpen: state.captureOpen,
        enabled: state.enabled,
        width: state.width,
        view: state.view,
        projectFilter: state.projectFilter
      })
    }
  )
)
