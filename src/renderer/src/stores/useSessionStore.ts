import { create } from 'zustand'
import type { Session } from '../types'
import { useUIStore, findLeaf, findLeafBySession, clearSessionFromTree } from './useUIStore'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  loading: boolean

  loadSessions: (projectId?: string) => Promise<void>
  createSession: (projectId: string, name: string) => Promise<Session | null>
  killSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  restartSession: (sessionId: string) => Promise<void>
  resumeSession: (sessionId: string) => Promise<void>
  restoreSession: (sessionId: string) => Promise<void>
  landOnMain: (sessionId: string) => Promise<void>
  pushBranch: (sessionId: string) => Promise<{ pushed: boolean; error?: string }>
  setActiveSession: (id: string) => void
  updateSessionInStore: (id: string, updates: Partial<Session>) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,

  loadSessions: async (projectId?: string) => {
    set({ loading: true })
    try {
      const sessions = await window.sorcerer.session.list(projectId)
      set({ sessions, loading: false })
    } catch (err) {
      console.error('[session-store] loadSessions failed:', err)
      set({ loading: false })
    }
  },

  createSession: async (projectId, name) => {
    try {
      const session = await window.sorcerer.session.create(projectId, name)
      if (!session) return null
      set((state) => ({
        sessions: [session, ...state.sessions]
      }))
      get().setActiveSession(session.id)
      return session
    } catch (err) {
      console.error('[session-store] createSession failed:', err)
      return null
    }
  },

  killSession: async (sessionId) => {
    try {
      await window.sorcerer.session.kill(sessionId)
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
      await window.sorcerer.session.archive(sessionId)
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'archived' as const, pid: null } : s
        )
      }))
    } catch (err) {
      console.error('[session-store] archiveSession failed:', err)
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await window.sorcerer.session.delete(sessionId)

      // Clear deleted session from split panels
      const { splitRoot } = useUIStore.getState()
      if (splitRoot) {
        useUIStore.setState({ splitRoot: clearSessionFromTree(splitRoot, sessionId) })
      }

      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
      }))
    } catch (err) {
      console.error('[session-store] deleteSession failed:', err)
    }
  },

  restartSession: async (sessionId) => {
    try {
      const session = await window.sorcerer.session.restart(sessionId)
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => s.id === sessionId ? session : s)
        }))
      }
    } catch (err) {
      console.error('[session-store] restartSession failed:', err)
    }
  },

  resumeSession: async (sessionId) => {
    try {
      const session = await window.sorcerer.session.resume(sessionId)
      if (session) {
        set((state) => ({
          sessions: state.sessions.map((s) => s.id === sessionId ? session : s)
        }))
      }
    } catch (err) {
      console.error('[session-store] resumeSession failed:', err)
    }
  },

  restoreSession: async (sessionId) => {
    try {
      const session = await window.sorcerer.session.restore(sessionId)
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
    const result = await window.sorcerer.session.landOnMain(sessionId)
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
      return await window.sorcerer.session.pushBranch(sessionId)
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

  updateSessionInStore: (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      )
    }))
  }
}))
