import { useEffect, useState, useCallback, useRef } from 'react'
import { getApi } from './api/client'
import { Sidebar } from './components/Sidebar'
import { MainContent } from './components/MainContent'
import { ContextMenu } from './components/ContextMenu'
import { ToastContainer } from './components/Toast'
import { NewSessionDialog } from './components/dialogs/NewSessionDialog'
import { AddProjectDialog } from './components/dialogs/AddProjectDialog'
import { ImportSessionsDialog } from './components/dialogs/ImportSessionsDialog'
import { DeleteDialog } from './components/dialogs/DeleteDialog'
import { LandDialog } from './components/dialogs/LandDialog'
import { ArchiveDialog } from './components/dialogs/ArchiveDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { AddAgentDialog } from './components/dialogs/AddAgentDialog'
import { DeleteAgentDialog } from './components/dialogs/DeleteAgentDialog'
import { QuickNotesOverlay } from './components/QuickNotesOverlay'
import { EditMissionDialog } from './components/dialogs/EditMissionDialog'
import { BriefingPanel } from './components/BriefingPanel'
import { MoveToGroupDialog } from './components/dialogs/MoveToGroupDialog'
import { FeedbackDialog } from './components/dialogs/FeedbackDialog'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useProjectStore } from './stores/useProjectStore'
import { useSessionStore } from './stores/useSessionStore'
import { useAgentStore } from './stores/useAgentStore'
import { getFeatures } from './features'
import { restoreSplitLayout } from './utils/restoreSplitLayout'
import { useTeamStore } from './stores/useTeamStore'
import { useQuickNotesStore } from './stores/useQuickNotesStore'
import { useToastStore } from './stores/useToastStore'
import { useUIStore, findLeaf } from './stores/useUIStore'
import type { Agent, Session, SplitNode } from './types'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isQuickNotesPanelId(id: string): boolean {
  return /^quicknotes:(session|agent):.+$/.test(id)
}

function panelTargetExists(id: string, sessions: Session[], agents: Agent[]): boolean {
  if (isQuickNotesPanelId(id)) {
    const match = id.match(/^quicknotes:(session|agent):(.+)$/)
    if (!match) return false
    const [, parentType, parentId] = match
    return parentType === 'session'
      ? sessions.some((session) => session.id === parentId)
      : agents.some((agent) => agent.id === parentId)
  }

  return sessions.some((session) => session.id === id) || agents.some((agent) => agent.id === id)
}

function splitTreeHasLeafId(node: SplitNode | null, leafId: string | null): boolean {
  if (!node || !leafId) return false
  if (node.type === 'leaf') return node.id === leafId
  return splitTreeHasLeafId(node.children[0], leafId) || splitTreeHasLeafId(node.children[1], leafId)
}

function findFirstLeafSessionId(node: SplitNode | null): string | null {
  if (!node) return null
  if (node.type === 'leaf') return node.sessionId
  return findFirstLeafSessionId(node.children[0]) || findFirstLeafSessionId(node.children[1])
}

function buildPopoutEntityName(panelId: string, sessions: Session[], agents: Agent[]): string | null {
  const session = sessions.find((entry) => entry.id === panelId)
  if (session) return session.name

  const agent = agents.find((entry) => entry.id === panelId)
  if (agent) return agent.name

  return null
}

export function App() {
  useKeyboardShortcuts()
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [layoutRestored, setLayoutRestored] = useState(false)
  const closeBriefing = useCallback(() => setBriefingOpen(false), [])
  const sessions = useSessionStore((s) => s.sessions)
  const agents = useAgentStore((s) => s.agents)
  const briefingConfigRef = useRef({ autoIdle: false, idleMinutes: 15, provider: 'anthropic' })
  const needsResumeRefresh = sessions.some((session) =>
    session.type !== 'quick-terminal' &&
    session.provider === 'codex' &&
    (
      session.resume_status === 'launching' ||
      (session.status === 'active' && !session.provider_session_id)
    )
  )

  useEffect(() => {
    if (!needsResumeRefresh) return

    const interval = setInterval(() => {
      void useSessionStore.getState().loadSessions()
    }, 3000)

    return () => clearInterval(interval)
  }, [needsResumeRefresh])

  useEffect(() => {
    if (!layoutReady || layoutRestored) return

    const isDevRuntime = window.location.protocol === 'http:'
    const validTarget = (id: string) => panelTargetExists(id, sessions, agents)
    const uiState = useUIStore.getState()
    const sanitizedSplitRoot = uiState.splitRoot ? restoreSplitLayout(uiState.splitRoot, validTarget) : null
    const nextFocusedPanelId = splitTreeHasLeafId(sanitizedSplitRoot, uiState.focusedPanelId)
      ? uiState.focusedPanelId
      : null
    const nextMaximizedPanelId = splitTreeHasLeafId(sanitizedSplitRoot, uiState.maximizedPanelId)
      ? uiState.maximizedPanelId
      : null
    const activeSessionId = useSessionStore.getState().activeSessionId

    useUIStore.setState({
      splitRoot: sanitizedSplitRoot,
      focusedPanelId: nextFocusedPanelId,
      maximizedPanelId: nextMaximizedPanelId
    })

    if (sanitizedSplitRoot) {
      const focusedLeaf = nextFocusedPanelId ? findLeaf(sanitizedSplitRoot, nextFocusedPanelId) : null
      useSessionStore.setState({
        activeSessionId: focusedLeaf?.sessionId || findFirstLeafSessionId(sanitizedSplitRoot)
      })
    } else if (activeSessionId && !validTarget(activeSessionId)) {
      useSessionStore.setState({ activeSessionId: null })
    }

    const validPopouts = Array.from(uiState.poppedOutSessionIds).filter((panelId) =>
      sessions.some((session) => session.id === panelId) || agents.some((agent) => agent.id === panelId)
    )
    useUIStore.setState({ poppedOutSessionIds: new Set(validPopouts) })

    let cancelled = false

    const restorePopouts = async () => {
      const restoreDelayMs = isDevRuntime ? 1200 : 0
      const restoreInitialDelayMs = isDevRuntime ? 1500 : 0

      if (restoreInitialDelayMs > 0) {
        await delay(restoreInitialDelayMs)
      }

      for (const panelId of validPopouts) {
        if (cancelled) return
        const entityName = buildPopoutEntityName(panelId, sessions, agents)
        if (!entityName) continue
        try {
          await getApi().popout.open('terminal', panelId, entityName)
        } catch (error) {
          console.error('Could not restore saved popout:', error)
          const remaining = new Set(useUIStore.getState().poppedOutSessionIds)
          remaining.delete(panelId)
          useUIStore.setState({ poppedOutSessionIds: remaining })
          useToastStore.getState().addToast('Could not reopen a saved window. Its content is available in the sidebar.', 'error')
        }
        if (restoreDelayMs > 0) {
          await delay(restoreDelayMs)
        }
      }

      if (!cancelled) {
        setLayoutRestored(true)
      }
    }

    void restorePopouts()

    return () => {
      cancelled = true
    }
  }, [layoutReady, layoutRestored, sessions, agents])

  useEffect(() => {
    // Set platform class on <html> for OS-specific CSS (e.g. macOS traffic lights)
    const platform = getApi().system.platform
    if (platform) document.documentElement.dataset.platform = platform

    const { loadProjects, loadGroups } = useProjectStore.getState()
    const { loadSessions } = useSessionStore.getState()
    const { loadAgents, loadAgentGroups } = useAgentStore.getState()
    const { loadTeams, loadTasks } = useTeamStore.getState()

    // Load all data on mount
    const agentsPromise = getFeatures().standaloneAgents ? loadAgents() : Promise.resolve()
    const agentGroupsPromise = (getFeatures().standaloneAgents ? loadAgentGroups() : Promise.resolve()).then(() => {
      const agentGroups = useAgentStore.getState().groups
      const { expandedGroups } = useUIStore.getState()
      // Auto-expand agent groups on first load (if no groups are expanded yet)
      if (agentGroups.length > 0) {
        const expanded = new Set(expandedGroups)
        let added = false
        for (const g of agentGroups) {
          if (!expanded.has(g.id)) { expanded.add(g.id); added = true }
        }
        if (added) useUIStore.setState({ expandedGroups: expanded })
      }
    })
    const groupsPromise = loadGroups().then(() => {
      // Auto-expand all groups on first load
      const groups = useProjectStore.getState().groups
      const { expandedGroups } = useUIStore.getState()
      if (expandedGroups.size === 0 && groups.length > 0) {
        const expanded = new Set<string>()
        for (const g of groups) expanded.add(g.id)
        useUIStore.setState({ expandedGroups: expanded })
      }
    })
    const quickNotesPromise = useQuickNotesStore.getState().loadNotePanels()
    const projectsPromise = loadProjects().then(() => {
      // Auto-expand all projects on first load
      const projects = useProjectStore.getState().projects
      const { expandedProjects } = useUIStore.getState()
      if (expandedProjects.size === 0 && projects.length > 0) {
        const expanded = new Set<string>()
        for (const p of projects) expanded.add(p.id)
        useUIStore.setState({ expandedProjects: expanded })
      }
    })
    // Load sessions first, then teams (teams trigger auto-link which needs sessions in store)
    loadSessions().then(() => {
      return loadTeams()
    }).then(() => {
      const sessions = useSessionStore.getState().sessions
      const { expandedSessions } = useUIStore.getState()
      const withTeams = sessions.filter((s) => s.team_name)
      if (withTeams.length > 0) {
        const next = new Set(expandedSessions)
        for (const s of withTeams) next.add(s.id)
        useUIStore.setState({ expandedSessions: next })
      }
      return Promise.all([
        agentsPromise,
        agentGroupsPromise,
        groupsPromise,
        quickNotesPromise,
        projectsPromise
      ])
    }).then(() => {
      setLayoutReady(true)
    })

    // Subscribe to file watcher for team/task updates
    const unsub = getApi().teams.onUpdate((data: any) => {
      if (data.type === 'teams') {
        loadTeams()
      } else if (data.type === 'tasks' && data.teamName) {
        loadTasks(data.teamName)
      }
    })

    // Subscribe to session-team auto-linking
    const unsubLink = getApi().teams.onSessionLinked((data: { sessionId: string; teamName: string | null }) => {
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

    // Subscribe to session updates from pop-out windows (status dot sync)
    const unsubPopout = getApi().popout.onSessionUpdated((sessionId: string, status: string, pid: number | null) => {
      useSessionStore.getState().updateSessionInStore(sessionId, { status: status as any, pid })
    })

    // Listen for auto-restarted agents — update store so TerminalView re-attaches
    const unsubAgentRestarted = getApi().terminal.onAgentRestarted((sessionId: string, status: string, pid: number | null) => {
      if (!getFeatures().standaloneAgents) return
      useAgentStore.getState().updateAgentInStore(sessionId, { status: status as any, pid })
    })

    // Listen for completed agent runs — show toast with findings
    const unsubAgentRunComplete = getApi().terminal.onAgentRunComplete((agentId: string, agentName: string, preview: string, level: string) => {
      if (!getFeatures().standaloneAgents) return
      if (level === 'error') {
        useToastStore.getState().addToast(`${agentName}: ${preview}`, 'error')
      }
    })

    // Track which sessions are popped out to separate windows
    const unsubPopoutOpened = getApi().popout.onOpened((sessionId: string) => {
      useUIStore.getState().addPoppedOut(sessionId)
    })
    const unsubPopoutClosed = getApi().popout.onClosed((sessionId: string) => {
      useUIStore.getState().removePoppedOut(sessionId)
    })

    // Listen for failed resume attempts (e.g. "No conversation found to continue")
    const unsubResumeFailed = getApi().terminal.onResumeFailed(({ sessionId, reason }) => {
      // Update store so UI reflects idle state immediately
      const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
      if (session) {
        useSessionStore.getState().updateSessionInStore(sessionId, { status: 'idle', pid: null })
        useToastStore.getState().addToast(`Resume failed for "${session.name}": ${reason}. Use "New Session" to start fresh.`, 'error')
      } else {
        useAgentStore.getState().updateAgentInStore(sessionId, { status: 'idle', pid: null })
        useToastStore.getState().addToast(`Resume failed: ${reason}. Use "Start New Session" to start fresh.`, 'error')
      }
    })

    // Idle detection for auto-briefing on return
    let lastActivity = Date.now()
    let wasIdle = false
    const activityHandler = () => { lastActivity = Date.now(); wasIdle = false }
    window.addEventListener('mousemove', activityHandler, { passive: true })
    window.addEventListener('keydown', activityHandler, { passive: true })

    const loadBriefingConfig = async () => {
      const [autoIdle, idleMinutesStr, provider] = await Promise.all([
        getApi().settings.get('briefingAutoIdle'),
        getApi().settings.get('briefingIdleMinutes'),
        getApi().settings.get('briefingProvider')
      ])

      briefingConfigRef.current = {
        autoIdle: autoIdle === 'true',
        idleMinutes: parseInt(idleMinutesStr || '15') || 15,
        provider: provider || 'anthropic'
      }
    }

    void loadBriefingConfig()

    const idleCheckInterval = setInterval(async () => {
      const briefingConfig = briefingConfigRef.current
      if (!briefingConfig.autoIdle) return

      const idleThreshold = briefingConfig.idleMinutes * 60 * 1000
      const elapsed = Date.now() - lastActivity

      if (elapsed >= idleThreshold) {
        wasIdle = true
      } else if (wasIdle) {
        // User just came back from idle
        wasIdle = false
        const key = await getApi().settings.get(`apiKey_${briefingConfig.provider}`)
        if (key) setBriefingOpen(true)
      }
    }, 30000) // Check every 30 seconds

    const handleBriefingSettingsUpdated = () => {
      void loadBriefingConfig()
    }
    window.addEventListener('sorcerer:briefing-settings-updated', handleBriefingSettingsUpdated)

    // Briefing keyboard shortcut: Ctrl+Shift+B
    const briefingKeyHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault()
        setBriefingOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', briefingKeyHandler)

    // Auto-open briefing on startup if enabled
    getApi().settings.get('briefingAutoStartup').then((v: string | undefined) => {
      if (v === 'true') {
        // Check that an API key is configured before auto-opening
        getApi().settings.get('briefingProvider').then((provider: string | undefined) => {
          const providerId = provider || 'anthropic'
          getApi().settings.get(`apiKey_${providerId}`).then((key: string | undefined) => {
            if (key) setBriefingOpen(true)
          })
        })
      }
    })

    let remotePollingEnabled = false

    // Poll for remote control viewers (which sessions have WS subscribers)
    const pollRemote = async () => {
      if (!remotePollingEnabled || document.hidden) return
      try {
        const ids = await getApi().remote.remoteSessionIds()
        useUIStore.getState().setRemoteSessionIds(ids)
      } catch { /* remote server may not be running */ }
    }

    const updateRemotePollingState = async () => {
      const enabled = await getApi().settings.get('remoteEnabled')
      remotePollingEnabled = enabled === 'true'
      if (!remotePollingEnabled) {
        useUIStore.getState().setRemoteSessionIds([])
        return
      }
      await pollRemote()
    }

    void updateRemotePollingState()
    const remoteInterval = setInterval(() => {
      void pollRemote()
    }, 5000)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void updateRemotePollingState()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      unsub()
      unsubLink()
      unsubPopout()
      unsubPopoutOpened()
      unsubPopoutClosed()
      unsubResumeFailed()
      unsubAgentRestarted()
      unsubAgentRunComplete()
      window.removeEventListener('keydown', briefingKeyHandler)
      window.removeEventListener('mousemove', activityHandler)
      window.removeEventListener('keydown', activityHandler)
      window.removeEventListener('sorcerer:briefing-settings-updated', handleBriefingSettingsUpdated)
      clearInterval(idleCheckInterval)
      clearInterval(remoteInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <div className="app-shell">
      <Sidebar />
      {layoutRestored ? <MainContent /> : <main className="main-content"><div className="terminal-placeholder" role="status">Restoring workspace…</div></main>}
      <ContextMenu />
      <ToastContainer />
      <NewSessionDialog />
      <AddProjectDialog />
      <ImportSessionsDialog />
      <DeleteDialog />
      <LandDialog />
      <ArchiveDialog />
      <SettingsDialog />
      {getFeatures().standaloneAgents && <AddAgentDialog />}
      {getFeatures().standaloneAgents && <DeleteAgentDialog />}
      <QuickNotesOverlay />
      {getFeatures().standaloneAgents && <EditMissionDialog />}
      <MoveToGroupDialog />
      <FeedbackDialog />
      <BriefingPanel open={briefingOpen} onClose={closeBriefing} />
    </div>
  )
}
