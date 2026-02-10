import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { MainContent } from './components/MainContent'
import { ContextMenu } from './components/ContextMenu'
import { ToastContainer } from './components/Toast'
import { NewSessionDialog } from './components/dialogs/NewSessionDialog'
import { AddProjectDialog } from './components/dialogs/AddProjectDialog'
import { DeleteDialog } from './components/dialogs/DeleteDialog'
import { LandDialog } from './components/dialogs/LandDialog'
import { ArchiveDialog } from './components/dialogs/ArchiveDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { AddAgentDialog } from './components/dialogs/AddAgentDialog'
import { DeleteAgentDialog } from './components/dialogs/DeleteAgentDialog'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useProjectStore } from './stores/useProjectStore'
import { useSessionStore } from './stores/useSessionStore'
import { useAgentStore } from './stores/useAgentStore'
import { useTeamStore } from './stores/useTeamStore'
import { useUIStore } from './stores/useUIStore'

export function App() {
  useKeyboardShortcuts()

  useEffect(() => {
    const { loadProjects } = useProjectStore.getState()
    const { loadSessions } = useSessionStore.getState()
    const { loadAgents } = useAgentStore.getState()
    const { loadTeams, loadTasks } = useTeamStore.getState()

    // Load all data on mount
    loadAgents()
    loadProjects().then(() => {
      // Auto-expand all projects on first load
      const projects = useProjectStore.getState().projects
      const { expandedProjects } = useUIStore.getState()
      if (expandedProjects.size === 0 && projects.length > 0) {
        const expanded = new Set<string>()
        for (const p of projects) expanded.add(p.id)
        useUIStore.setState({ expandedProjects: expanded })
      }
    })
    // After sessions + teams load, auto-expand sessions that already have teams
    Promise.all([loadSessions(), loadTeams()]).then(() => {
      const sessions = useSessionStore.getState().sessions
      const { expandedSessions } = useUIStore.getState()
      const withTeams = sessions.filter((s) => s.team_name)
      if (withTeams.length > 0) {
        const next = new Set(expandedSessions)
        for (const s of withTeams) next.add(s.id)
        useUIStore.setState({ expandedSessions: next })
      }
    })

    // Subscribe to file watcher for team/task updates
    const unsub = window.sorcerer.teams.onUpdate((data: any) => {
      if (data.type === 'teams') {
        loadTeams()
      } else if (data.type === 'tasks' && data.teamName) {
        loadTasks(data.teamName)
      }
    })

    // Subscribe to session-team auto-linking
    const unsubLink = window.sorcerer.teams.onSessionLinked((data: { sessionId: string; teamName: string | null }) => {
      useSessionStore.getState().updateSessionInStore(data.sessionId, { team_name: data.teamName })
      // Auto-expand the session in the sidebar when a team is linked
      if (data.teamName) {
        const { expandedSessions } = useUIStore.getState()
        if (!expandedSessions.has(data.sessionId)) {
          const next = new Set(expandedSessions)
          next.add(data.sessionId)
          useUIStore.setState({ expandedSessions: next })
        }
      }
    })

    return () => {
      unsub()
      unsubLink()
    }
  }, [])

  return (
    <div className="app-shell">
      <Sidebar />
      <MainContent />
      <ContextMenu />
      <ToastContainer />
      <NewSessionDialog />
      <AddProjectDialog />
      <DeleteDialog />
      <LandDialog />
      <ArchiveDialog />
      <SettingsDialog />
      <AddAgentDialog />
      <DeleteAgentDialog />
    </div>
  )
}
