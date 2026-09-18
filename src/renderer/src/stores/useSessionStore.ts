import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session } from '../types'
import { useUIStore, findLeaf, findLeafBySession, clearSessionFromTree } from './useUIStore'
import { useQuickNotesStore } from './useQuickNotesStore'
import { useQuickNotesDraftStore } from './useQuickNotesDraftStore'
import { disposeTerminal } from '../components/TerminalView'
import { getApi } from '../api/client'
import { useToastStore } from './useToastStore'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  loading: boolean
  pendingActions: Record<string, 'resume' | 'restart'>

  loadSessions: (projectId?: string) => Promise<void>
  createSession: (projectId: string, name: string, useMainRepo?: boolean, bypassPermissions?: boolean, remoteControl?: boolean, provider?: string, model?: string) => Promise<{ session: Session; error?: string } | { session: null; error: string }>
  createQuickTerminal: (sourceSessionId: string) => Promise<Session | null>
  killSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  restartSession: (sessionId: string) => Promise<void>
  resumeSession: (sessionId: string) => Promise<void>
  restoreSession: (sessionId: string) => Promise<void>
  landOnMain: (sessionId: string) => Promise<void>
  pushBranch: (sessionId: string) => Promise<{ pushed: boolean; error?: string }>
  setActiveSession: (id: string) => void
  renameSession: (sessionId: string, name: string) => Promise<void>
  addLocalSession: (session: Session) => void
  updateSessionInStore: (id: string, updates: Partial<Session>) => void
}

export const useSessionStore = create<SessionState>()(
  persist((set, get) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,
  pendingActions: {},

  loadSessions: async (projectId?: string) => {
    set({ loading: true })
    try {
      const sessions = await getApi().session.list(projectId)
      set({ sessions, loading: false })
    } catch (err) {
      console.error('[session-store] loadSessions failed:', err)
      set({ loading: false })
    }
  },

  createSession: async (projectId, name, useMainRepo?, bypassPermissions?, remoteControl?, provider?, model?) => {
    try {
      const session = await getApi().session.create(projectId, name, useMainRepo, bypassPermissions, remoteControl, provider, model)
      if (!session) return { session: null, error: 'No session returned' }
      set((state) => ({
        sessions: [session, ...state.sessions]
      }))
      get().setActiveSession(session.id)
      return { session }
    } catch (err: any) {
      console.error('[session-store] createSession failed:', err)
      return { session: null, error: err?.message || 'Failed to create session' }
    }
  },

  createQuickTerminal: async (sourceSessionId) => {
    try {
      const session = await getApi().session.createQuickTerminal(sourceSessionId)
      if (!session) return null
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id
      }))
      return session
    } catch (err) {
      console.error('[session-store] createQuickTerminal failed:', err)
      return null
    }
  },

  killSession: async (sessionId) => {
    try {
      await getApi().session.kill(sessionId)
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'idle' as const, pid: null } : s
        )
      }))
    } catch (err) {
      console.error('[session-store] killSession failed:', err)
    }
  },

  archiveSession: async (sessionId) => {
    try {
      await getApi().session.archive(sessionId)
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'archived' as const, pid: null } : s
        )
      }))
    } catch (err) {
      console.error('[session-store] archiveSession failed:', err)
      throw err
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await getApi().session.delete(sessionId)

      // Clean up terminal cache
      disposeTerminal(sessionId)

      // Clean up quick notes
      await useQuickNotesDraftStore.getState().remove(sessionId, 'session').catch((err) => {
        console.error('[session-store] Notes cleanup failed:', err)
      })
      const qnState = useQuickNotesStore.getState()
      if (qnState.overlayOpen && qnState.overlayParentId === sessionId) {
        qnState.closeOverlay()
      }
      qnState.removeNotePanel(sessionId)
      qnState.clearSaved(sessionId)

      // Clear deleted session from split panels
      const { splitRoot } = useUIStore.getState()
      if (splitRoot) {
        let root = clearSessionFromTree(splitRoot, sessionId)
        root = clearSessionFromTree(root, `quicknotes:session:${sessionId}`)
        useUIStore.setState({ splitRoot: root })
      }

      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
      }))
    } catch (err) {
      console.error('[session-store] deleteSession failed:', err)
      throw err
    }
  },

  restartSession: async (sessionId) => {
    set((state) => ({
      pendingActions: { ...state.pendingActions, [sessionId]: 'restart' }
    }))
    try {
      // Dispose cached terminal so the restarted session gets a fresh terminal
      disposeTerminal(sessionId)

      const session = await getApi().session.restart(sessionId)
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => s.id === sessionId ? session : s)
        }))
      }
    } catch (err) {
      console.error('[session-store] restartSession failed:', err)
    } finally {
      set((state) => {
        const next = { ...state.pendingActions }
        delete next[sessionId]
        return { pendingActions: next }
      })
    }
  },

  resumeSession: async (sessionId) => {
    set((state) => ({
      pendingActions: { ...state.pendingActions, [sessionId]: 'resume' }
    }))
    try {
      // Dispose cached terminal so the resumed session gets a fresh terminal
      // with clean IPC listeners — prevents stale output from prior run
      disposeTerminal(sessionId)

      const session = await getApi().session.resume(sessionId)
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => s.id === sessionId ? session : s)
        }))
      }
    } catch (err: any) {
      console.error('[session-store] resumeSession failed:', err)
      const session = get().sessions.find((s) => s.id === sessionId)
      const message = err?.message || 'Unable to resume session'
      useToastStore.getState().addToast(
        session ? `Could not resume "${session.name}": ${message}` : message,
        'error'
      )
    } finally {
      set((state) => {
        const next = { ...state.pendingActions }
        delete next[sessionId]
        return { pendingActions: next }
      })
    }
  },

  restoreSession: async (sessionId) => {
    try {
      const session = await getApi().session.restore(sessionId)
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => s.id === sessionId ? session : s)
        }))
      }
    } catch (err) {
      console.error('[session-store] restoreSession failed:', err)
    }
  },

  landOnMain: async (sessionId) => {
    const result = await getApi().session.landOnMain(sessionId)
    if (!result.landed) {
      throw new Error(result.error || 'Landing failed')
    }

    // Clear from split panels
    const { splitRoot } = useUIStore.getState()
    if (splitRoot) {
      useUIStore.setState({ splitRoot: clearSessionFromTree(splitRoot, sessionId) })
    }

    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
    }))
  },

  pushBranch: async (sessionId) => {
    try {
      return await getApi().session.pushBranch(sessionId)
    } catch (err) {
      console.error('[session-store] pushBranch failed:', err)
      return { pushed: false, error: String(err) }
    }
  },

  setActiveSession: (id) => {
    const ui = useUIStore.getState()
    if (ui.splitRoot) {
      // If focused panel is empty — fill it
      if (ui.focusedPanelId) {
        const focused = findLeaf(ui.splitRoot, ui.focusedPanelId)
        if (focused && focused.sessionId === null) {
          ui.setPanelSession(ui.focusedPanelId, id)
          set({ activeSessionId: id })
          return
        }
      }
      // If session is already in a panel — focus that panel
      const existing = findLeafBySession(ui.splitRoot, id)
      if (existing) {
        useUIStore.setState({ focusedPanelId: existing.id })
        set({ activeSessionId: id })
        return
      }
      // Replace focused panel's session
      if (ui.focusedPanelId) {
        ui.setPanelSession(ui.focusedPanelId, id)
      }
    }
    set({ activeSessionId: id })
  },

  renameSession: async (sessionId, name) => {
    try {
      await getApi().session.rename(sessionId, name)
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, name } : s
        )
      }))
    } catch (err) {
      console.error('[session-store] renameSession failed:', err)
    }
  },

  addLocalSession: (session) => {
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id
    }))
  },

  updateSessionInStore: (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      )
    }))
  }
}),
  {
    name: 'sorcerer-session-store',
    partialize: (state) => ({
      activeSessionId: state.activeSessionId
    })
  })
)
