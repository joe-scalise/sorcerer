import { create } from 'zustand'
import type { UpdateState } from '../../../shared/update'

interface UpdateStore {
  state: UpdateState | null
  open: boolean
  actionError: string | null
  setOpen: (open: boolean) => void
  accept: (state: UpdateState) => void
  run: (action: 'check' | 'download' | 'install') => Promise<void>
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  open: false,
  actionError: null,
  setOpen: (open) => set({ open, actionError: null }),
  accept: (state) => {
    if (!get().state || state.revision >= get().state!.revision) set({ state })
  },
  run: async (action) => {
    const api = window.sorcerer?.system.updates
    if (!api) return
    set({ actionError: null })
    try { get().accept(await api[action]()) }
    catch (error) { set({ actionError: error instanceof Error ? error.message : 'The update could not be completed. Try again.' }) }
  }
}))

export function subscribeToUpdates(): () => void {
  const api = window.sorcerer?.system.updates
  if (!api) return () => {}
  let active = true
  const accept = (state: UpdateState) => { if (active) useUpdateStore.getState().accept(state) }
  // Events may arrive while the initial snapshot is in flight.
  const unsubscribe = api.onState(accept)
  void api.getState().then(accept).catch(() => {
    if (active) useUpdateStore.setState({ actionError: 'Could not load update status. Try checking again.' })
  })
  return () => { active = false; unsubscribe() }
}
