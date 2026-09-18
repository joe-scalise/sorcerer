import { useEffect } from 'react'
import { getFeatures } from '../features'
import { useUIStore } from '../stores/useUIStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useAgentStore } from '../stores/useAgentStore'
import { useProjectStore } from '../stores/useProjectStore'
import { findLeaf } from '../stores/useUIStore'
import { useQuickNotesStore } from '../stores/useQuickNotesStore'
import { useToastStore } from '../stores/useToastStore'
import { focusTerminal } from '../components/TerminalView'

/** Refocus the active session's terminal */
function focusActiveTerminal(): void {
  const id = useSessionStore.getState().activeSessionId
  if (id) requestAnimationFrame(() => focusTerminal(id))
}

function closeActivePanel(): boolean {
  const ui = useUIStore.getState()
  const { sessions, activeSessionId, deleteSession } = useSessionStore.getState()

  if (ui.splitRoot && ui.focusedPanelId) {
    const focusedLeaf = findLeaf(ui.splitRoot, ui.focusedPanelId)
    if (!focusedLeaf) return false

    if (focusedLeaf.sessionId?.startsWith('quicknotes:')) {
      const [, , parentId] = focusedLeaf.sessionId.split(':')
      if (parentId) useQuickNotesStore.getState().removeNotePanel(parentId)
    }

    const focusedSession = focusedLeaf.sessionId
      ? sessions.find((session) => session.id === focusedLeaf.sessionId)
      : undefined

    if (focusedSession?.type === 'quick-terminal') {
      void deleteSession(focusedSession.id).catch(() => {
        useToastStore.getState().addToast('Could not close the terminal. Please try again.', 'error')
      })
      return true
    }

    ui.closePanel(ui.focusedPanelId)
    return true
  }

  if (!activeSessionId) return false

  if (activeSessionId.startsWith('quicknotes:')) {
    const [, , parentId] = activeSessionId.split(':')
    if (parentId) useQuickNotesStore.getState().removeNotePanel(parentId)
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  if (activeSession?.type === 'quick-terminal') {
    void deleteSession(activeSession.id).catch(() => {
      useToastStore.getState().addToast('Could not close the terminal. Please try again.', 'error')
    })
    return true
  }

  useSessionStore.setState({ activeSessionId: null })
  return true
}

/**
 * Build a flat ordered list of navigable session/agent IDs matching sidebar order:
 * ungrouped agents → grouped agents → projects with their visible sessions.
 */
function getNavigableIds(): string[] {
  const { agents, groups } = getFeatures().standaloneAgents
    ? useAgentStore.getState()
    : { agents: [], groups: [] }
  const { projects } = useProjectStore.getState()
  const { sessions } = useSessionStore.getState()
  const { searchQuery, expandedGroups } = useUIStore.getState()

  const query = searchQuery.toLowerCase().trim()
  const ids: string[] = []

  // Agents (same order as AgentTree)
  const filteredAgents = query
    ? agents.filter((a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query))
    : agents

  const ungrouped = filteredAgents.filter((a) => !a.group_id)
  ungrouped.forEach((a) => ids.push(a.id))

  for (const group of groups) {
    if (!expandedGroups.has(group.id)) continue
    const groupAgents = agents.filter((a) => a.group_id === group.id)
    const visible = groupAgents.filter((a) => filteredAgents.includes(a))
    visible.forEach((a) => ids.push(a.id))
  }

  // Projects + sessions (same order as ProjectTree)
  const filteredProjects = query
    ? projects.filter((p) => {
        const ps = sessions.filter((s) => s.project_id === p.id && s.status !== 'deleted')
        return ps.some((s) => s.name.toLowerCase().includes(query) || s.branch.toLowerCase().includes(query)) ||
          p.name.toLowerCase().includes(query)
      })
    : projects

  for (const project of filteredProjects) {
    const projectSessions = sessions.filter((s) => s.project_id === project.id && s.status !== 'deleted' && s.status !== 'archived' && (getFeatures().standaloneAgents || !s.agentId))
    projectSessions.forEach((s) => ids.push(s.id))
  }

  return ids
}

export function useKeyboardShortcuts() {
  const { openDialog, activeDialog } = useUIStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire shortcuts when a dialog is open
      if (activeDialog || useUIStore.getState().contextMenu || e.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return

      // Alt+↑ / Alt+↓ — navigate sessions/agents
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const ids = getNavigableIds()
        if (ids.length === 0) return
        const { activeSessionId, setActiveSession } = useSessionStore.getState()
        const currentIndex = activeSessionId ? ids.indexOf(activeSessionId) : -1
        let nextIndex: number
        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < ids.length - 1 ? currentIndex + 1 : 0
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1
        }
        setActiveSession(ids[nextIndex])
      }

      // Ctrl+K — focus search
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector('.search-input') as HTMLInputElement | null
        searchInput?.focus()
      }

      // Ctrl+N — new session
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault()
        openDialog('new-session')
      }

      // Ctrl+B — cycle sidebar (expanded → collapsed → hidden → expanded)
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
      }

      // Ctrl+, — open settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        openDialog('settings')
      }

      // Ctrl+Shift+N — toggle Quick Notes overlay
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        const sessionId = useSessionStore.getState().activeSessionId
        if (!sessionId) return
        const isAgent = useAgentStore.getState().agents.some((a) => a.id === sessionId)
        useQuickNotesStore.getState().toggleOverlay(sessionId, isAgent ? 'agent' : 'session')
      }

      // Ctrl+\ — split right
      if (e.ctrlKey && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        const sessionId = useSessionStore.getState().activeSessionId
        if (sessionId) {
          useUIStore.getState().splitRight(sessionId)
        }
      }

      // Ctrl+Shift+\ — split down
      if (e.ctrlKey && e.shiftKey && e.key === '|') {
        e.preventDefault()
        const sessionId = useSessionStore.getState().activeSessionId
        if (sessionId) {
          useUIStore.getState().splitDown(sessionId)
        }
      }

      // Ctrl+W — close focused panel (only in split mode)
      if (e.ctrlKey && e.key === 'w') {
        const { splitRoot, focusedPanelId, closePanel } = useUIStore.getState()
        if (splitRoot && focusedPanelId) {
          e.preventDefault()
          closePanel(focusedPanelId)
        }
      }

      // Ctrl+Shift+M — toggle maximize on focused panel
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault()
        const { splitRoot, focusedPanelId, toggleMaximizePanel } = useUIStore.getState()
        if (splitRoot && focusedPanelId) {
          toggleMaximizePanel(focusedPanelId)
        }
      }

      // Escape — clear search, exit focus mode, unmaximize, close panel, or refocus terminal
      if (e.key === 'Escape') {
        // Escape belongs to terminal applications and editors while they have focus.
        const target = e.target as HTMLElement | null
        if (target?.closest('.xterm, textarea, [contenteditable="true"], input:not(.search-input)')) return
        const searchInput = document.querySelector('.search-input') as HTMLInputElement | null
        if (document.activeElement === searchInput) {
          const { searchQuery, setSearchQuery } = useUIStore.getState()
          if (searchQuery) {
            setSearchQuery('')
          } else {
            searchInput?.blur()
            focusActiveTerminal()
          }
        } else {
          const { focusModeSessionId, exitFocusMode, maximizedPanelId, unmaximizePanel, spotlightMode, setSpotlightMode } = useUIStore.getState()
          if (focusModeSessionId) {
            exitFocusMode()
          } else if (spotlightMode) {
            setSpotlightMode(false)
          } else if (maximizedPanelId) {
            unmaximizePanel()
          } else if (closeActivePanel()) {
            return
          } else {
            focusActiveTerminal()
          }
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openDialog, activeDialog])
}
