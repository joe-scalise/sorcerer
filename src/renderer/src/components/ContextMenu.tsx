import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getApi } from '../api/client'
import { getFeatures } from '../features'
import { useUIStore, findLeaf, findLeafBySession } from '../stores/useUIStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useAgentStore } from '../stores/useAgentStore'
import { useToastStore } from '../stores/useToastStore'
import {
  PlusIcon, CopyIcon, TrashIcon, SplitHorizontalIcon, SplitVerticalIcon,
  RefreshIcon, UploadIcon, ExternalLinkIcon, ArchiveIcon, RotateCcwIcon, EditIcon, PlayIcon, StopIcon, TerminalIcon, MergeIcon, NotesIcon, SmartphoneIcon, FolderIcon, SettingsIcon, MaximizeIcon
} from './icons'
import { useQuickNotesStore } from '../stores/useQuickNotesStore'
import type { SessionDiagnostics, SessionResumeHealth } from '../types'

type MenuItem =
  | { label: string; icon?: ReactNode; shortcut?: string; action: () => void; danger?: boolean; eager?: boolean; disabled?: boolean }
  | { type: 'meta'; label: string; value: string }
  | { type: 'separator' }

export function ContextMenu() {
  const { contextMenu, closeContextMenu, openDialog, splitRight, splitDown, setRenamingId, enterFocusMode } = useUIStore()
  const { projects } = useProjectStore()
  const { sessions, resumeSession, restartSession, restoreSession, pushBranch, createQuickTerminal } = useSessionStore()
  const { agents, startAgent, resumeAgent, restartAgent, killAgent } = useAgentStore()
  const { addToast } = useToastStore()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const [loadingItem, setLoadingItem] = useState<number | null>(null)
  const actionInFlight = useRef<object | null>(null)
  const [resumeHealth, setResumeHealth] = useState<SessionResumeHealth | null>(null)
  const [sessionDiagnostics, setSessionDiagnostics] = useState<SessionDiagnostics | null>(null)

  useEffect(() => { setLoadingItem(null) }, [contextMenu])

  const updateMenuPosition = () => {
    if (!contextMenu || !menuRef.current) {
      setPos(null)
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    const pad = 8
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxHeight = Math.max(120, viewportHeight - pad * 2)
    const clampedHeight = Math.min(rect.height, maxHeight)
    const maxLeft = Math.max(pad, viewportWidth - rect.width - pad)
    const maxTop = Math.max(pad, viewportHeight - clampedHeight - pad)
    const left = Math.min(Math.max(contextMenu.x, pad), maxLeft)
    const top = Math.min(Math.max(contextMenu.y, pad), maxTop)

    setPos({ top, left, maxHeight })
  }

  useEffect(() => {
    if (!contextMenu || contextMenu.type !== 'session') {
      setResumeHealth(null)
      setSessionDiagnostics(null)
      return
    }
    let cancelled = false
    void Promise.all([
      getApi().session.resumeHealth(contextMenu.targetId).catch(() => null),
      getApi().session.diagnostics(contextMenu.targetId).catch(() => null)
    ]).then(([health, diagnostics]) => {
      if (cancelled) return
      setResumeHealth(health)
      setSessionDiagnostics(diagnostics)
    })
    return () => {
      cancelled = true
    }
  }, [contextMenu])

  // Clamp menu position to viewport before paint
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) {
      setPos(null)
      return
    }

    updateMenuPosition()

    const resizeObserver = new ResizeObserver(() => {
      updateMenuPosition()
    })
    resizeObserver.observe(menuRef.current)

    const onWindowResize = () => updateMenuPosition()
    window.addEventListener('resize', onWindowResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [contextMenu, sessionDiagnostics, resumeHealth])

  useEffect(() => {
    if (!contextMenu) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeContextMenu(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!menuRef.current) return
        const btns = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('.context-menu-item:not(:disabled)'))
        if (btns.length === 0) return
        const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'ArrowDown') {
          btns[idx >= 0 ? (idx + 1) % btns.length : 0].focus()
        } else {
          btns[idx >= 0 ? (idx - 1 + btns.length) % btns.length : btns.length - 1].focus()
        }
      }
    }
    const frame = requestAnimationFrame(() => {
      window.addEventListener('click', onClick)
      window.addEventListener('contextmenu', onClick)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, closeContextMenu])

  if (!contextMenu) return null
  if (!getFeatures().standaloneAgents && (
    contextMenu.type === 'agent' || contextMenu.type === 'agents-header' || contextMenu.type === 'agent-group' ||
    (contextMenu.type === 'quicknotes' && contextMenu.targetId.startsWith('quicknotes:agent:')) ||
    (contextMenu.type === 'session' && sessions.some((session) => session.id === contextMenu.targetId && session.agentId))
  )) return null

  const findProjectPath = (targetId: string): string => {
    const project = projects.find((p) => p.id === targetId)
    return project?.path ?? ''
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      addToast('Failed to copy', 'error')
    })
  }

  const refreshProjectSidebar = async () => {
    try {
      await Promise.all([
        useProjectStore.getState().loadGroups(),
        useProjectStore.getState().loadProjects(),
        useSessionStore.getState().loadSessions()
      ])
      addToast('Projects refreshed', 'success')
    } catch (err) {
      console.error('[context-menu] refreshProjectSidebar failed:', err)
      addToast('Failed to refresh projects', 'error')
    }
  }

  // Find session/agent to determine state
  const targetSession = contextMenu.type === 'session'
    ? sessions.find((s) => s.id === contextMenu.targetId)
    : undefined
  const targetAgent = contextMenu.type === 'agent'
    ? agents.find((a) => a.id === contextMenu.targetId)
    : undefined
  const isQuickTerminal = targetSession?.type === 'quick-terminal'
  const isArchived = targetSession?.status === 'archived'
  const targetProject = targetSession
    ? projects.find((p) => p.id === targetSession.project_id)
    : undefined
  const isMainRepo = targetProject && targetSession?.worktree_path === targetProject.path

  const iconClass = 'context-menu-icon'

  // Ensure a session/agent is expanded in the sidebar so its children are visible
  const ensureExpanded = (id: string) => {
    if (!useUIStore.getState().expandedSessions.has(id)) {
      useUIStore.getState().toggleSession(id)
    }
  }

  // Focus the panel containing a target session/agent before splitting,
  // so the split happens relative to the right-clicked item
  const focusTargetPanel = (targetId: string) => {
    const { splitRoot: root, setFocusedPanel: focus } = useUIStore.getState()
    if (root) {
      const leaf = findLeafBySession(root, targetId)
      if (leaf) focus(leaf.id)
    }
  }

  // If the currently focused panel is empty, fill it with the session instead of splitting
  const fillEmptyOrSplit = (sessionId: string) => {
    const { splitRoot: root, focusedPanelId, setPanelSession } = useUIStore.getState()
    if (root && focusedPanelId) {
      const focused = findLeaf(root, focusedPanelId)
      if (focused && focused.sessionId === null) {
        setPanelSession(focusedPanelId, sessionId)
        useSessionStore.getState().setActiveSession(sessionId)
        return
      }
    }
    splitRight(sessionId)
  }

  // Same as fillEmptyOrSplit but for Quick Notes panels (not sessions).
  // Falls back to focusing the target session's panel and splitting next to it.
  const fillEmptyOrSplitNotes = (notePanelId: string) => {
    const { splitRoot: root, focusedPanelId, setPanelSession, setFocusedPanel } = useUIStore.getState()
    if (root && focusedPanelId) {
      const focused = findLeaf(root, focusedPanelId)
      if (focused && focused.sessionId === null) {
        setPanelSession(focusedPanelId, notePanelId)
        setFocusedPanel(focusedPanelId)
        return
      }
      setPanelSession(focusedPanelId, notePanelId)
      setFocusedPanel(focusedPanelId)
      return
    }
    useSessionStore.setState({ activeSessionId: notePanelId })
  }

  let items: MenuItem[]

  if (contextMenu.type === 'agent') {
    const isRunning = targetAgent?.status === 'active'
    const agentRcEnabled = targetAgent?.remote_control === 1
    items = [
      ...(isRunning ? [
        { label: 'Stop Agent', icon: <StopIcon className={iconClass} />, action: async () => {
          await killAgent(contextMenu.targetId)
        }}
      ] : targetAgent?.mission ? [
        { label: 'Start Mission', icon: <PlayIcon className={iconClass} />, action: async () => {
          await startAgent(contextMenu.targetId)
        }}
      ] : [
        { label: 'Resume Agent', icon: <PlayIcon className={iconClass} />, eager: true, action: async () => {
          await resumeAgent(contextMenu.targetId)
        }},
        { label: 'Start New Session', icon: <RefreshIcon className={iconClass} />, eager: true, action: async () => {
          await restartAgent(contextMenu.targetId)
        }}
      ]),
      { label: agentRcEnabled ? 'Disable Session Remote Control' : 'Enable Session Remote Control',
        icon: <SmartphoneIcon className={iconClass} />,
        action: async () => {
          await getApi().agent.setRemoteControl(contextMenu.targetId, !agentRcEnabled)
          useAgentStore.getState().updateAgentInStore(contextMenu.targetId, { remote_control: agentRcEnabled ? 0 : 1 })
        }
      },
      { type: 'separator' as const },
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitRight(contextMenu.targetId) } },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitDown(contextMenu.targetId) } },
      { label: 'Focus Mode', icon: <MaximizeIcon className={iconClass} />, action: () => enterFocusMode(contextMenu.targetId) },
      { label: 'Pop Out', icon: <ExternalLinkIcon className={iconClass} />, action: async () => {
        await getApi().popout.open('terminal', contextMenu.targetId, targetAgent?.name || 'Agent')
        // Clear the panel in the main app so it's not shown in two places
        const { splitRoot: root, setPanelSession } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, contextMenu.targetId)
          if (leaf) setPanelSession(leaf.id, null)
        } else {
          // Single panel mode (no splits) — clear the active session
          useSessionStore.getState().setActiveSession(contextMenu.targetId)
          useSessionStore.setState({ activeSessionId: null })
        }
      }},
      { label: 'Open Quick Terminal', icon: <TerminalIcon className={iconClass} />, action: async () => {
        const qt = await getApi().agent.createQuickTerminal(contextMenu.targetId)
        if (qt) {
          useSessionStore.getState().addLocalSession(qt as any)
          ensureExpanded(contextMenu.targetId)
          fillEmptyOrSplit(qt.id)
          const { splitRoot: root, setFocusedPanel } = useUIStore.getState()
          if (root) {
            const leaf = findLeafBySession(root, qt.id)
            if (leaf) setFocusedPanel(leaf.id)
          }
          useSessionStore.getState().setActiveSession(qt.id)
        }
      }},
      { label: 'Open Quick Notes', icon: <NotesIcon className={iconClass} />, action: () => {
        const notePanelId = `quicknotes:agent:${contextMenu.targetId}`
        useQuickNotesStore.getState().addNotePanel(contextMenu.targetId)
        ensureExpanded(contextMenu.targetId)
        fillEmptyOrSplitNotes(notePanelId)
        const { splitRoot: root, setFocusedPanel } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, notePanelId)
          if (leaf) setFocusedPanel(leaf.id)
        }
      }},
      { type: 'separator' as const },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Edit Agent Settings', icon: <SettingsIcon className={iconClass} />, action: () => {
        openDialog('edit-agent-mission', contextMenu.targetId)
      }},
      ...(targetAgent?.mission ? [
        { label: 'Disable Mission', icon: <StopIcon className={iconClass} />, danger: true, action: async () => {
          await killAgent(contextMenu.targetId)
          await getApi().agent.update(contextMenu.targetId, { mission: '', auto_start: 0, auto_restart: 0, schedule_minutes: 0 })
          useAgentStore.getState().updateAgentInStore(contextMenu.targetId, { mission: '', auto_start: 0, auto_restart: 0, schedule_minutes: 0 })
        }}
      ] : []),
      ...(() => {
        const { groups: agentGroups } = useAgentStore.getState()
        const currentAgent = agents.find((a) => a.id === contextMenu.targetId)
        const canMoveAgentToGroup = agentGroups.length > 0 || !!currentAgent?.group_id
        const agentGroupItems: MenuItem[] = [
          { type: 'separator' as const },
          {
            label: 'Move to Group...',
            icon: <FolderIcon className={iconClass} />,
            disabled: !canMoveAgentToGroup,
            action: () => openDialog('move-agent-group', contextMenu.targetId)
          }
        ]
        return agentGroupItems
      })(),
      { type: 'separator' as const },
      { label: 'Delete Agent', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-agent', contextMenu.targetId) }
    ]
  } else if (contextMenu.type === 'agents-header') {
    items = [
      { label: 'Add Agent', icon: <PlusIcon className={iconClass} />, action: () => openDialog('add-agent') },
      { label: 'New Group', icon: <FolderIcon className={iconClass} />, action: async () => {
        const group = await useAgentStore.getState().addAgentGroup('New Group')
        if (group) {
          useUIStore.getState().toggleGroup(group.id)
          requestAnimationFrame(() => useUIStore.getState().setRenamingId(group.id))
        }
      }}
    ]
  } else if (contextMenu.type === 'agent-group') {
    items = [
      { label: 'Rename Group', icon: <EditIcon className={iconClass} />, action: () => setRenamingId(contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Delete Group', icon: <TrashIcon className={iconClass} />, danger: true, action: async () => {
        await useAgentStore.getState().removeAgentGroup(contextMenu.targetId)
      }}
    ]
  } else if (contextMenu.type === 'projects-header') {
    items = [
      { label: 'Add Project', icon: <PlusIcon className={iconClass} />, action: () => openDialog('add-project') },
      { label: 'Import Sessions', icon: <UploadIcon className={iconClass} />, action: () => openDialog('import-sessions') },
      { label: 'Refresh Projects', icon: <RefreshIcon className={iconClass} />, eager: true, action: refreshProjectSidebar },
      { type: 'separator' },
      { label: 'New Group', icon: <FolderIcon className={iconClass} />, action: async () => {
        const group = await useProjectStore.getState().addGroup('New Group')
        if (group) {
          useUIStore.getState().toggleGroup(group.id)
          requestAnimationFrame(() => {
            useUIStore.getState().setRenamingId(group.id)
          })
        }
      }}
    ]
  } else if (contextMenu.type === 'project-group') {
    items = [
      { label: 'Rename Group', icon: <EditIcon className={iconClass} />, action: () => setRenamingId(contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Delete Group', icon: <TrashIcon className={iconClass} />, danger: true, action: async () => {
        await useProjectStore.getState().removeGroup(contextMenu.targetId)
      }}
    ]
  } else if (contextMenu.type === 'project') {
    const { groups } = useProjectStore.getState()
    const currentProject = projects.find((p) => p.id === contextMenu.targetId)
    const canMoveProjectToGroup = groups.length > 0 || !!currentProject?.group_id
    const groupItems: MenuItem[] = [
      { type: 'separator' },
      {
        label: 'Move to Group...',
        icon: <FolderIcon className={iconClass} />,
        disabled: !canMoveProjectToGroup,
        action: () => openDialog('move-project-group', contextMenu.targetId)
      }
    ]

    items = [
      { label: 'New Session', icon: <PlusIcon className={iconClass} />, shortcut: 'Ctrl+N', action: () => openDialog('new-session', contextMenu.targetId) },
      { label: 'Import Sessions', icon: <UploadIcon className={iconClass} />, action: () => openDialog('import-sessions', contextMenu.targetId) },
      { label: 'Open Quick Terminal', icon: <TerminalIcon className={iconClass} />, action: async () => {
        const newSession = await window.sorcerer?.session.createProjectQuickTerminal(contextMenu.targetId)
        if (newSession) {
          await useSessionStore.getState().loadSessions()
          fillEmptyOrSplit(newSession.id)
          useSessionStore.getState().setActiveSession(newSession.id)
        }
      }},
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Copy Project Path', icon: <CopyIcon className={iconClass} />, action: () => copyToClipboard(findProjectPath(contextMenu.targetId)) },
      { label: 'Sync Worktrees', icon: <RefreshIcon className={iconClass} />, action: async () => {
        await getApi().project.syncWorktrees(contextMenu.targetId)
        await useSessionStore.getState().loadSessions()
      }},
      { label: 'Refresh Projects', icon: <RefreshIcon className={iconClass} />, eager: true, action: refreshProjectSidebar },
      ...groupItems,
      { type: 'separator' },
      { label: 'Remove Project', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  } else if (contextMenu.type === 'quicknotes') {
    items = [
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitRight(contextMenu.targetId) } },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitDown(contextMenu.targetId) } },
      { label: 'Focus Mode', icon: <MaximizeIcon className={iconClass} />, action: () => enterFocusMode(contextMenu.targetId) },
      { type: 'separator' as const },
      { label: 'Delete Notes', icon: <TrashIcon className={iconClass} />, danger: true, action: async () => {
        const parts = contextMenu.targetId.split(':')
        if (parts.length === 3) {
          const parentType = parts[1] as 'session' | 'agent'
          const parentId = parts[2]
          await getApi().quickNotes.delete(parentId, parentType)
          useQuickNotesStore.getState().clearSaved(parentId)
          useQuickNotesStore.getState().removeNotePanel(parentId)
        }
        const { splitRoot: root } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, contextMenu.targetId)
          if (leaf) useUIStore.getState().closePanel(leaf.id)
        }
      }},
      { label: 'Close Panel', icon: <ExternalLinkIcon className={iconClass} />, action: () => {
        const parts = contextMenu.targetId.split(':')
        if (parts.length === 3) {
          useQuickNotesStore.getState().removeNotePanel(parts[2])
        }
        const { splitRoot: root } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, contextMenu.targetId)
          if (leaf) useUIStore.getState().closePanel(leaf.id)
        }
      }}
    ]
  } else if (isQuickTerminal) {
    items = [
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitRight(contextMenu.targetId) } },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitDown(contextMenu.targetId) } },
      { label: 'Focus Mode', icon: <MaximizeIcon className={iconClass} />, action: () => enterFocusMode(contextMenu.targetId) },
      ...(targetSession?.parent_session_id ? [
        { label: 'Open Quick Notes', icon: <NotesIcon className={iconClass} />, action: () => {
          const parentId = targetSession!.parent_session_id!
          const notePanelId = `quicknotes:session:${parentId}`
          useQuickNotesStore.getState().addNotePanel(parentId)
          ensureExpanded(parentId)
          fillEmptyOrSplitNotes(notePanelId)
          const { splitRoot: root, setFocusedPanel } = useUIStore.getState()
          if (root) {
            const leaf = findLeafBySession(root, notePanelId)
            if (leaf) setFocusedPanel(leaf.id)
          }
        }}
      ] : []),
      { type: 'separator' },
      { label: 'Restart Shell', icon: <RefreshIcon className={iconClass} />, action: async () => {
        await restartSession(contextMenu.targetId)
      }},
      { type: 'separator' },
      { label: 'Close Terminal', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  } else if (isArchived) {
    items = [
      { label: 'Restore Session', icon: <RotateCcwIcon className={iconClass} />, action: async () => {
        await restoreSession(contextMenu.targetId)
      }},
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Copy Worktree Path', icon: <CopyIcon className={iconClass} />, action: () => {
        if (targetSession) copyToClipboard(targetSession.worktree_path)
      }},
      { label: 'Open Worktree Path', icon: <FolderIcon className={iconClass} />, action: () => {
        if (targetSession) window.sorcerer?.window.openPath(targetSession.worktree_path)
      }},
      { type: 'separator' },
      { label: 'Delete Session', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  } else {
    const sessionDiagnosticItems: MenuItem[] = sessionDiagnostics ? [
      { type: 'separator' as const },
      { type: 'meta' as const, label: 'Sorcerer Session', value: sessionDiagnostics.sessionId },
      { type: 'meta' as const, label: sessionDiagnostics.providerThreadLabel, value: sessionDiagnostics.providerThreadId || 'Unavailable' },
      { type: 'meta' as const, label: 'Resume Source', value: sessionDiagnostics.providerThreadSource || 'Unknown' },
      { label: 'Copy Sorcerer Session ID', icon: <CopyIcon className={iconClass} />, action: () => copyToClipboard(sessionDiagnostics.sessionId) },
      ...(sessionDiagnostics.providerThreadId ? [
        { label: `Copy ${sessionDiagnostics.providerThreadLabel}`, icon: <CopyIcon className={iconClass} />, action: () => copyToClipboard(sessionDiagnostics.providerThreadId!) }
      ] : [])
    ] : []

    items = [
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitRight(contextMenu.targetId) } },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => { focusTargetPanel(contextMenu.targetId); splitDown(contextMenu.targetId) } },
      { label: 'Focus Mode', icon: <MaximizeIcon className={iconClass} />, action: () => enterFocusMode(contextMenu.targetId) },
      { label: 'Pop Out', icon: <ExternalLinkIcon className={iconClass} />, action: async () => {
        await getApi().popout.open('terminal', contextMenu.targetId, targetSession?.name || 'Session')
        // Clear the panel in the main app so it's not shown in two places
        const { splitRoot: root, setPanelSession } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, contextMenu.targetId)
          if (leaf) setPanelSession(leaf.id, null)
        } else {
          // Single panel mode (no splits) — clear the active session
          useSessionStore.setState({ activeSessionId: null })
        }
      }},
      { label: 'Open Quick Terminal', icon: <TerminalIcon className={iconClass} />, action: async () => {
        const newSession = await createQuickTerminal(contextMenu.targetId)
        if (newSession) {
          ensureExpanded(contextMenu.targetId)
          fillEmptyOrSplit(newSession.id)
          const { splitRoot: root, setFocusedPanel } = useUIStore.getState()
          if (root) {
            const leaf = findLeafBySession(root, newSession.id)
            if (leaf) setFocusedPanel(leaf.id)
          }
          useSessionStore.getState().setActiveSession(newSession.id)
        }
      }},
      { label: 'Open Quick Notes', icon: <NotesIcon className={iconClass} />, action: () => {
        const notePanelId = `quicknotes:session:${contextMenu.targetId}`
        useQuickNotesStore.getState().addNotePanel(contextMenu.targetId)
        ensureExpanded(contextMenu.targetId)
        fillEmptyOrSplitNotes(notePanelId)
        const { splitRoot: root, setFocusedPanel } = useUIStore.getState()
        if (root) {
          const leaf = findLeafBySession(root, notePanelId)
          if (leaf) setFocusedPanel(leaf.id)
        }
      }},
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Resume Session', icon: <PlayIcon className={iconClass} />, eager: true, disabled: resumeHealth?.canResume === false, action: async () => {
        await resumeSession(contextMenu.targetId)
      }},
      { label: 'New Session', icon: <RefreshIcon className={iconClass} />, eager: true, action: async () => {
        await restartSession(contextMenu.targetId)
      }},
      { label: targetSession?.remote_control ? 'Disable Session Remote Control' : 'Enable Session Remote Control',
        icon: <SmartphoneIcon className={iconClass} />,
        action: async () => {
          const enabling = !targetSession?.remote_control
          await getApi().session.setRemoteControl(contextMenu.targetId, enabling)
          useSessionStore.getState().updateSessionInStore(contextMenu.targetId, { remote_control: enabling ? 1 : 0 })
        }
      },
      { label: targetSession?.branch ? 'Copy Worktree Path' : 'Copy Path', icon: <CopyIcon className={iconClass} />, action: () => {
        if (targetSession) copyToClipboard(targetSession.worktree_path)
      }},
      { label: targetSession?.branch ? 'Open Worktree Path' : 'Open Path', icon: <FolderIcon className={iconClass} />, action: () => {
        if (targetSession) window.sorcerer?.window.openPath(targetSession.worktree_path)
      }},
      ...(targetSession?.branch ? [
        { type: 'separator' as const },
        { label: 'Push Branch', icon: <UploadIcon className={iconClass} />, action: async () => {
          const result = await pushBranch(contextMenu.targetId)
          if (!result.pushed) {
            addToast(result.error || 'Push failed', 'error')
          }
        }},
        { label: 'Open Remote', icon: <ExternalLinkIcon className={iconClass} />, action: async () => {
          try {
            const result = await getApi().session.openRemote(contextMenu.targetId)
            if (!result.opened) {
              addToast(result.error || 'No remote URL found', 'error')
            }
          } catch {
            addToast('Failed to open remote', 'error')
          }
        }},
        ...(!isMainRepo ? [
          { label: 'Land on Main', icon: <MergeIcon className={iconClass} />, action: () => openDialog('land-session', contextMenu.targetId) },
        ] : []),
      ] : []),
      ...sessionDiagnosticItems,
      { type: 'separator' },
      { label: 'Archive Session', icon: <ArchiveIcon className={iconClass} />, action: () => openDialog('archive-session', contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Delete Session', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  }

  return createPortal(
    <div
      className="context-menu"
      ref={menuRef}
      style={{
        top: pos?.top ?? contextMenu.y,
        left: pos?.left ?? contextMenu.x,
        maxHeight: pos?.maxHeight ?? undefined
      }}
    >
      {items.map((item, i) =>
        'type' in item && item.type === 'separator' ? (
          <div key={i} className="context-menu-separator" />
        ) : 'type' in item && item.type === 'meta' ? (
          <div key={i} className="context-menu-meta">
            <span className="context-menu-meta-label">{item.label}</span>
            <span className="context-menu-meta-value">{item.value}</span>
          </div>
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'context-menu-item--danger' : ''} ${loadingItem === i ? 'context-menu-item--active' : ''}`}
            disabled={item.disabled || loadingItem !== null}
            onClick={async () => {
              if (item.disabled || actionInFlight.current === contextMenu) return
              actionInFlight.current = contextMenu
              let spinnerTimer: ReturnType<typeof setTimeout> | null = null
              if (item.eager) {
                setLoadingItem(i)
              } else {
                spinnerTimer = setTimeout(() => {
                  spinnerTimer = null
                  if (useUIStore.getState().contextMenu === contextMenu) setLoadingItem(i)
                }, 150)
              }
              try {
                await Promise.resolve(item.action())
              } catch (error) {
                addToast(error instanceof Error ? error.message : 'Action failed. Please try again.', 'error')
              } finally {
                if (actionInFlight.current === contextMenu) actionInFlight.current = null
                if (spinnerTimer !== null) clearTimeout(spinnerTimer)
                if (useUIStore.getState().contextMenu === contextMenu) {
                  setLoadingItem(null)
                  closeContextMenu()
                }
              }
            }}
          >
            {loadingItem === i
              ? <span className="btn-spinner btn-spinner--sm" />
              : item.icon}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
