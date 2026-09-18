import { create } from 'zustand'
import { getApi } from '../api/client'
import { useQuickNotesStore } from './useQuickNotesStore'
import { useToastStore } from './useToastStore'

type ParentType = 'session' | 'agent'
export interface NoteDraft {
  id: string
  content: string
  loaded: boolean
  dirty: boolean
  saving: boolean
  deleting: boolean
  error: string | null
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const loads = new Map<string, Promise<void>>()
const saves = new Map<string, Promise<void>>()
export const noteKey = (parentId: string, parentType: ParentType) => `${parentType}:${parentId}`

interface DraftState {
  drafts: Record<string, NoteDraft>
  load: (parentId: string, parentType: ParentType) => Promise<void>
  update: (parentId: string, parentType: ParentType, content: string) => void
  flush: (parentId: string, parentType: ParentType) => Promise<void>
  remove: (parentId: string, parentType: ParentType) => Promise<void>
}

// Drafts live beyond the editor so closing/reopening or switching between a
// panel and overlay cannot lose pending edits or create competing note IDs.
export const useQuickNotesDraftStore = create<DraftState>((set, get) => {
  const patch = (key: string, updates: Partial<NoteDraft>) => set((state) => ({
    drafts: { ...state.drafts, [key]: { ...state.drafts[key], ...updates } }
  }))
  const cancelTimer = (key: string) => {
    clearTimeout(timers.get(key))
    timers.delete(key)
  }

  return {
    drafts: {},
    load: (parentId, parentType) => {
      const key = noteKey(parentId, parentType)
      const previous = get().drafts[key]
      if (previous?.loaded && (previous.dirty || previous.saving || previous.deleting)) return Promise.resolve()
      const existing = loads.get(key)
      if (existing) return existing
      patch(key, { id: previous?.id ?? crypto.randomUUID(), content: previous?.content ?? '', loaded: false, dirty: false, saving: false, deleting: false, error: null })
      const request = (async () => {
        try {
          const note = await getApi().quickNotes.load(parentId, parentType)
          patch(key, { id: note?.id ?? get().drafts[key].id, content: note?.content ?? '', loaded: true })
        } catch {
          patch(key, { error: 'Could not load notes. Try again.' })
        } finally {
          loads.delete(key)
        }
      })()
      loads.set(key, request)
      return request
    },
    update: (parentId, parentType, content) => {
      const key = noteKey(parentId, parentType)
      if (!get().drafts[key]?.loaded || get().drafts[key].deleting) return
      patch(key, { content, dirty: true, error: null })
      cancelTimer(key)
      timers.set(key, setTimeout(() => { void get().flush(parentId, parentType) }, 500))
    },
    flush: (parentId, parentType) => {
      const key = noteKey(parentId, parentType)
      cancelTimer(key)
      const existing = saves.get(key)
      if (existing) return existing
      if (!get().drafts[key]?.dirty || get().drafts[key].deleting) return Promise.resolve()
      const request = (async () => {
        try {
          // Serialize writes and pick up edits made while a save was in flight.
          while (get().drafts[key]?.dirty && !get().drafts[key].deleting) {
            const { id, content } = get().drafts[key]
            patch(key, { saving: true, dirty: false, error: null })
            try {
              await getApi().quickNotes.save(id, parentId, parentType, content)
              if (content) useQuickNotesStore.getState().markSaved(parentId)
              else useQuickNotesStore.getState().clearSaved(parentId)
            } catch {
              patch(key, { dirty: true, error: 'Could not save notes. Your draft is kept here. Try again.' })
              useToastStore.getState().addToast('Could not save notes. Reopen notes to retry your draft.', 'error')
              break
            }
          }
        } finally {
          patch(key, { saving: false })
          saves.delete(key)
        }
      })()
      saves.set(key, request)
      return request
    },
    remove: async (parentId, parentType) => {
      const key = noteKey(parentId, parentType)
      cancelTimer(key)
      const previous = get().drafts[key]
      if (!previous) {
        await getApi().quickNotes.delete(parentId, parentType)
        useQuickNotesStore.getState().clearSaved(parentId)
        return
      }
      if (previous.deleting) return
      patch(key, { deleting: true })
      try {
        // Let any already-sent save finish before deleting, so it cannot
        // recreate the note after deletion.
        await saves.get(key)
        await getApi().quickNotes.delete(parentId, parentType)
        useQuickNotesStore.getState().clearSaved(parentId)
        patch(key, { id: crypto.randomUUID(), content: '', dirty: false, error: null })
      } catch (error) {
        patch(key, { dirty: previous.dirty || get().drafts[key].dirty, error: 'Could not delete notes. Try again.' })
        throw error
      } finally {
        patch(key, { deleting: false })
      }
    }
  }
})
