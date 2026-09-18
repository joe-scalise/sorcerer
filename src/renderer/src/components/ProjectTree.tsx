import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getApi } from '../api/client'
import { useProjectStore } from '../stores/useProjectStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useUIStore, getAllSessionIds, findLeafBySession } from '../stores/useUIStore'
import { useTeamStore } from '../stores/useTeamStore'
import { ChevronIcon, GroupIcon, TerminalIcon, ShellPromptIcon, UserIcon, MoreHorizontalIcon, NotesIcon, WifiIcon, ChevronsCollapseIcon, PlusIcon, AlertTriangleIcon, BotIcon, FolderPlusIcon } from './icons'
import { useQuickNotesStore } from '../stores/useQuickNotesStore'
import { StatusDot } from './StatusDot'
import { Tooltip } from './Tooltip'
import { EmptyState } from './EmptyState'
import type { Project, ProjectGroup, ProviderSubAgent, Session, SessionResumeHealth, TeamMember, TaskData } from '../types'
import { assignPanelToPopoutTarget } from '../utils/popoutSelection'
import { getOrderedTopLevelKeys } from '../utils/projectOrdering'

const PROVIDER_SUBAGENT_ACTIVE_MS = 90_000
const PROVIDER_SUBAGENT_EXPIRE_MS = 2 * 60_000

function renderSessionChangeSummary(status: { added: number; deleted: number } | null): ReactNode {
  if (!status || (status.added === 0 && status.deleted === 0)) return null
  return (
    <span className="tree-change-summary">
      {status.added > 0 && <span className="tree-change-summary__add">+{status.added}</span>}
      {status.deleted > 0 && <span className="tree-change-summary__del">-{status.deleted}</span>}
    </span>
  )
}

function formatSessionChangeSummaryTooltip(status: { added: number; deleted: number } | null): string | null {
  if (!status || (status.added === 0 && status.deleted === 0)) return null
  const parts: string[] = []
  if (status.added > 0) {
    parts.push(`${status.added} line${status.added !== 1 ? 's' : ''} added`)
  }
  if (status.deleted > 0) {
    parts.push(`${status.deleted} line${status.deleted !== 1 ? 's' : ''} removed`)
  }
  return parts.join(', ')
}

function formatResumeWarning(health: SessionResumeHealth | null | undefined): string | null {
  if (!health || health.canResume || !health.reason) return null
  return [health.reason, ...health.guidance].join(' ')
}

function getResumeStateLabel(session: Session): string | null {
  if (session.resume_status === 'launching') {
    if (session.provider === 'codex') {
      return session.resume_reason || 'Capturing Codex thread identity.'
    }
    return session.resume_reason || 'Resume state is still being prepared.'
  }
  if (session.resume_status === 'unsupported') {
    return session.resume_reason || 'This provider is restart-only in Sorcerer right now.'
  }
  return null
}

function formatProviderActivityTime(timestamp: number | null): string {
  if (!timestamp) return 'recently'
  const diffMs = Date.now() - timestamp
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSeconds < 10) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function getProviderSubAgentVisualState(subAgent: ProviderSubAgent): 'active' | 'done' | 'expired' {
  const referenceTime = subAgent.updatedAt || subAgent.createdAt
  if (!referenceTime) return 'active'

  const ageMs = Date.now() - referenceTime
  if (ageMs <= PROVIDER_SUBAGENT_ACTIVE_MS) return 'active'
  if (ageMs <= PROVIDER_SUBAGENT_EXPIRE_MS) return 'done'
  return 'expired'
}

function getVisibleProviderSubAgents(subAgents: ProviderSubAgent[]): ProviderSubAgent[] {
  return subAgents.filter((subAgent) => getProviderSubAgentVisualState(subAgent) !== 'expired')
}

function TaskItem({ task }: { task: TaskData }) {
  const statusIcon = task.status === 'completed' ? 'completed'
    : task.status === 'in_progress' ? 'active'
    : 'idle'
  return (
    <div className="tree-item tree-task">
      <StatusDot status={statusIcon} />
      <span className="tree-label tree-task-label">
        {task.activeForm || task.subject}
      </span>
    </div>
  )
}

function TeammateItem({ member, tasks, staggerClass }: { member: TeamMember; tasks: TaskData[]; staggerClass?: string }) {
  // Tasks owned by this member
  const memberTasks = tasks.filter((t) => t.owner === member.name && t.status !== 'completed')
  const activeTask = memberTasks.find((t) => t.status === 'in_progress')

  return (
    <div className={`tree-teammate-group ${staggerClass || ''}`}>
      <div className="tree-item tree-teammate">
        <UserIcon className="tree-icon" />
        <span className="tree-label">{member.name}</span>
        {member.agentType && <span className="teammate-badge">{member.agentType}</span>}
        <StatusDot status={(member.status as string) || 'idle'} />
      </div>
      {activeTask && (
        <div className="tree-teammate-task">
          <span className="tree-task-label">{activeTask.activeForm || activeTask.subject}</span>
        </div>
      )}
    </div>
  )
}

function ChildQTItem({
  session,
  isActive,
}: {
  session: Session
  isActive: boolean
}) {
  const { setActiveSession } = useSessionStore()
  const { openContextMenu, splitRoot, poppedOutSessionIds, setSidebarSelection } = useUIStore()
  const itemRef = useRef<HTMLDivElement>(null)

  const splitIds = splitRoot ? getAllSessionIds(splitRoot) : []
  const isInSplit = !isActive && splitIds.includes(session.id)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSidebarSelection({ type: 'session', id: session.id })
    openContextMenu({ x: e.clientX, y: e.clientY, type: 'session', targetId: session.id })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSidebarSelection({ type: 'session', id: session.id })
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({ x: rect.right, y: rect.bottom, type: 'session', targetId: session.id })
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'session', id: session.id, projectId: session.project_id
    }))
    e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => {
      itemRef.current?.classList.add('tree-item--dragging')
    })
  }

  const handleDragEnd = () => {
    itemRef.current?.classList.remove('tree-item--dragging')
  }

  return (
    <div
      ref={itemRef}
      className={`tree-item tree-item--child-qt ${isActive ? 'tree-item--active' : ''} ${isInSplit ? 'tree-item--split' : ''}`}
      onClick={async () => {
        setSidebarSelection({ type: 'session', id: session.id })
        if (await assignPanelToPopoutTarget(session.id)) return
        setActiveSession(session.id)
      }}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <ShellPromptIcon className="tree-icon tree-icon--quick-terminal" />
      <span className="tree-label">{session.name}</span>
      <button className="tree-item-actions" onClick={handleMoreClick}>
        <MoreHorizontalIcon />
      </button>
      <StatusDot status={poppedOutSessionIds.has(session.id) && session.status === 'active' ? 'popped-out' : session.status} />
    </div>
  )
}

function ChildNotesItem({
  parentId,
  parentType,
}: {
  parentId: string
  parentType: 'session' | 'agent'
}) {
  const { splitRight, setFocusedPanel, setPanelSession, splitRoot, focusedPanelId, openContextMenu } = useUIStore()
  const notePanelId = `quicknotes:${parentType}:${parentId}`

  // Determine active/split state
  const splitIds = splitRoot ? getAllSessionIds(splitRoot) : []
  const isInSplitView = splitIds.includes(notePanelId)
  const focusedLeaf = splitRoot ? findLeafBySession(splitRoot, notePanelId) : null
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const isActive = (isInSplitView && focusedLeaf?.id === focusedPanelId) || (!splitRoot && activeSessionId === notePanelId)
  const isInSplit = isInSplitView && !isActive

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu({ x: e.clientX, y: e.clientY, type: 'quicknotes', targetId: notePanelId })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({ x: rect.right, y: rect.bottom, type: 'quicknotes', targetId: notePanelId })
  }

  const handleClick = async () => {
    if (await assignPanelToPopoutTarget(notePanelId)) return
    useQuickNotesStore.getState().addNotePanel(parentId)
    if (splitRoot) {
      const leaf = findLeafBySession(splitRoot, notePanelId)
      if (leaf) {
        setFocusedPanel(leaf.id)
        return
      }
      if (focusedPanelId) {
        setPanelSession(focusedPanelId, notePanelId)
        setFocusedPanel(focusedPanelId)
        return
      }
    }
    if (!splitRoot) {
      useSessionStore.setState({ activeSessionId: notePanelId })
      return
    }
    splitRight(notePanelId)
    const { splitRoot: root } = useUIStore.getState()
    if (root) {
      const leaf = findLeafBySession(root, notePanelId)
      if (leaf) setFocusedPanel(leaf.id)
    }
  }

  return (
    <div
      className={`tree-item tree-item--child-qt ${isActive ? 'tree-item--active' : ''} ${isInSplit ? 'tree-item--split' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <NotesIcon className="tree-icon tree-icon--quick-terminal" />
      <span className="tree-label">Notes</span>
      <button className="tree-item-actions" onClick={handleMoreClick}>
        <MoreHorizontalIcon />
      </button>
    </div>
  )
}

function ProviderSubAgentItem({
  subAgent,
  parentSessionId,
}: {
  subAgent: ProviderSubAgent
  parentSessionId: string
}) {
  const { setActiveSession } = useSessionStore()
  const visualState = getProviderSubAgentVisualState(subAgent)

  const activityLabel = formatProviderActivityTime(subAgent.updatedAt || subAgent.createdAt)
  const summary = [
    subAgent.nickname || subAgent.role || 'Codex sub-agent',
    subAgent.role ? `Role: ${subAgent.role}` : null,
    visualState === 'done' ? `Completed ${activityLabel}` : `Updated ${activityLabel}`
  ].filter(Boolean).join(' • ')

  return (
    <Tooltip label={summary}>
      <div
        className={`tree-item tree-subagent tree-subagent--${visualState}`}
        onClick={() => setActiveSession(parentSessionId)}
      >
        <div className={`tree-subagent-dot tree-subagent-dot--${visualState}`} />
        <BotIcon className="tree-icon tree-icon--subagent" />
        <div className="tree-subagent-copy">
          <span className="tree-label tree-subagent-title">
            {subAgent.nickname || subAgent.title}
          </span>
          <span className="tree-subagent-meta">
            <span className="tree-subagent-provider">codex</span>
            {subAgent.role ? <span>{subAgent.role}</span> : null}
            {visualState === 'done' ? <span className="tree-subagent-state">done</span> : null}
            <span className="tree-subagent-updated">{activityLabel}</span>
          </span>
        </div>
      </div>
    </Tooltip>
  )
}

function SessionItem({
  session,
  childQTs,
  providerSubAgents,
  isActive,
  staggerClass,
  projectId,
  resumeHealth,
}: {
  session: Session
  childQTs: Session[]
  providerSubAgents: ProviderSubAgent[]
  isActive: boolean
  staggerClass?: string
  projectId: string
  resumeHealth: SessionResumeHealth | null
}) {
  const { setActiveSession, activeSessionId } = useSessionStore()
  const { expandedSessions, toggleSession, openContextMenu, renamingId, setRenamingId, splitRoot, remoteSessionIds, poppedOutSessionIds, showProviderBadges, setSidebarSelection } = useUIStore()
  const { projects } = useProjectStore()
  const { teams, tasksByTeam } = useTeamStore()
  const isExpanded = expandedSessions.has(session.id)
  const project = projects.find((p) => p.id === projectId)
  const isMainRepo = project && session.worktree_path === project.path
  const isWorktree = !isMainRepo && !!session.branch && session.type !== 'quick-terminal'
  const itemRef = useRef<HTMLDivElement>(null)

  // Worktree divergence check
  const [divergence, setDivergence] = useState<{ behind: number; ahead: number } | null>(null)
  const [changeSummary, setChangeSummary] = useState<{ added: number; deleted: number } | null>(null)
  useEffect(() => {
    if (!isWorktree) return
    getApi().session.divergence(session.id).then((d) => setDivergence(d)).catch(() => {})
  }, [session.id, isWorktree])
  useEffect(() => {
    if (!project || session.type === 'quick-terminal' || !session.branch) {
      setChangeSummary(null)
      return
    }
    getApi().session.gitStatus(session.id).then((status) => {
      setChangeSummary(status && typeof status.added === 'number' && typeof status.deleted === 'number'
        ? { added: status.added, deleted: status.deleted }
        : null)
    }).catch(() => setChangeSummary(null))
  }, [project, session.branch, session.id, session.type])

  // Quick notes panel open?
  const hasNotesPanel = useQuickNotesStore((s) => s.openNotePanels.has(session.id))
  const hasSavedNotes = useQuickNotesStore((s) => s.savedNotes.has(session.id))
  const visibleProviderSubAgents = getVisibleProviderSubAgents(providerSubAgents)
  const activeProviderSubAgentCount = visibleProviderSubAgents.filter((subAgent) =>
    getProviderSubAgentVisualState(subAgent) === 'active'
  ).length

  // Team members and tasks for this session
  const team = session.team_name ? teams.find((t) => t.name === session.team_name) : undefined
  const hasTeammates = (team?.members.length ?? 0) > 0
  const hasChildren = childQTs.length > 0 || visibleProviderSubAgents.length > 0 || hasTeammates || hasNotesPanel
  const tasks = session.team_name ? (tasksByTeam[session.team_name] || []) : []
  const totalTaskCount = tasks.length
  const completedTaskCount = tasks.filter((t) => t.status === 'completed').length
  const pendingTaskCount = totalTaskCount - completedTaskCount

  // Is this session in the split view but not the focused one?
  const splitIds = splitRoot ? getAllSessionIds(splitRoot) : []
  const isInSplit = !isActive && splitIds.includes(session.id)

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Watch renamingId from UI store (context menu trigger)
  useEffect(() => {
    if (renamingId === session.id) {
      setIsRenaming(true)
      setRenameValue(session.name)
      setRenamingId(null)
    }
  }, [renamingId, session.id, session.name, setRenamingId])

  // Focus input when rename mode activates
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  // Scroll active session into view
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  const commitRename = async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== session.name) {
      await useSessionStore.getState().renameSession(session.id, trimmed)
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setRenameValue(session.name)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsRenaming(true)
    setRenameValue(session.name)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { commitRename() }
    else if (e.key === 'Escape') { cancelRename() }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSidebarSelection({ type: 'session', id: session.id })
    openContextMenu({ x: e.clientX, y: e.clientY, type: 'session', targetId: session.id })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSidebarSelection({ type: 'session', id: session.id })
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({ x: rect.right, y: rect.bottom, type: 'session', targetId: session.id })
  }

  // Drag source
  const handleDragStart = (e: React.DragEvent) => {
    if (isRenaming) { e.preventDefault(); return }
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'session', id: session.id, projectId
    }))
    e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => {
      itemRef.current?.classList.add('tree-item--dragging')
    })
  }

  const handleDragEnd = () => {
    itemRef.current?.classList.remove('tree-item--dragging')
  }

  return (
    <div className={`tree-project ${staggerClass || ''}`}>
      <div
        ref={itemRef}
        className={`tree-item tree-item--session-row ${isActive ? 'tree-item--active' : ''} ${isInSplit ? 'tree-item--split' : ''} ${session.status === 'archived' ? 'tree-item--archived' : ''}`}
        onClick={async () => {
          if (isRenaming) return
          setSidebarSelection({ type: 'session', id: session.id })
          if (await assignPanelToPopoutTarget(session.id)) return
          setActiveSession(session.id)
        }}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {session.type === 'quick-terminal'
          ? <ShellPromptIcon className="tree-icon tree-icon--quick-terminal" />
          : <TerminalIcon className="tree-icon" />
        }
        <div className="tree-item-main">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="tree-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className="tree-item-titleline">
                <span className="tree-label tree-label--session" onDoubleClick={handleDoubleClick}>{session.name}</span>
              </div>
              <div className="tree-item-meta">
                {showProviderBadges && session.provider && (
                  <span className="tree-meta-badge">{session.provider}</span>
                )}
                {isMainRepo && session.branch && (
                  <span className="tree-meta-badge">direct</span>
                )}
                {session.branch && <span className="tree-meta-text">{session.branch}</span>}
                {getResumeStateLabel(session) && (
                  <Tooltip label={getResumeStateLabel(session)!}>
                    <span className="tree-resume-state">{session.resume_status === 'unsupported' ? 'restart only' : 'capturing'}</span>
                  </Tooltip>
                )}
                {visibleProviderSubAgents.length > 0 && (
                  <Tooltip
                    label={
                      activeProviderSubAgentCount > 0
                        ? `${activeProviderSubAgentCount} active Codex sub-agent${activeProviderSubAgentCount !== 1 ? 's' : ''}, ${visibleProviderSubAgents.length} visible total`
                        : `${visibleProviderSubAgents.length} recent Codex sub-agent${visibleProviderSubAgents.length !== 1 ? 's' : ''}`
                    }
                  >
                    <span className={`tree-subagent-summary ${activeProviderSubAgentCount > 0 ? 'tree-subagent-summary--active' : ''}`}>
                      {activeProviderSubAgentCount > 0 ? `${activeProviderSubAgentCount} active` : `${visibleProviderSubAgents.length} recent`}
                    </span>
                  </Tooltip>
                )}
                {!resumeHealth?.canResume && formatResumeWarning(resumeHealth) && (
                  <Tooltip label={formatResumeWarning(resumeHealth)!}>
                    <span className="tree-resume-warning" aria-label="Resume warning">
                      <AlertTriangleIcon />
                    </span>
                  </Tooltip>
                )}
                {renderSessionChangeSummary(changeSummary) && (
                  <Tooltip label={formatSessionChangeSummaryTooltip(changeSummary)!}>
                    {renderSessionChangeSummary(changeSummary)}
                  </Tooltip>
                )}
                {divergence && divergence.behind > 0 && (
                  <Tooltip label={`${divergence.behind} commit${divergence.behind !== 1 ? 's' : ''} behind main${divergence.ahead > 0 ? `, ${divergence.ahead} ahead` : ''}`}>
                    <span className={`tree-divergence ${divergence.behind >= 10 ? 'tree-divergence--danger' : divergence.behind >= 3 ? 'tree-divergence--warning' : ''}`}>
                      <span className="tree-divergence__label">behind</span>
                      <span className="tree-divergence__count">{divergence.behind}</span>
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4z"/></svg>
                    </span>
                  </Tooltip>
                )}
                {hasSavedNotes && <NotesIcon className="tree-icon tree-notes-indicator" />}
                {remoteSessionIds.has(session.id) && (
                  <WifiIcon className="tree-icon tree-remote-indicator" />
                )}
              </div>
            </>
          )}
        </div>
        {!isRenaming && (
          <div className="tree-item-tail">
            <button className="tree-item-actions" onClick={handleMoreClick}>
              <MoreHorizontalIcon />
            </button>
            <StatusDot status={poppedOutSessionIds.has(session.id) && session.status === 'active' ? 'popped-out' : session.status} />
            {hasChildren && (
              <ChevronIcon
                className={`tree-chevron ${isExpanded ? 'tree-chevron--open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSession(session.id)
                }}
              />
            )}
          </div>
        )}
      </div>

      {hasChildren && (
        <div className={`tree-children-wrapper ${isExpanded ? 'tree-children-wrapper--open' : ''}`}>
          <div className="tree-children">
            {hasNotesPanel && (
              <ChildNotesItem parentId={session.id} parentType="session" />
            )}
            {childQTs.map((qt) => (
              <ChildQTItem
                key={qt.id}
                session={qt}
                isActive={qt.id === activeSessionId}
              />
            ))}
            {visibleProviderSubAgents.map((subAgent) => (
              <ProviderSubAgentItem
                key={subAgent.threadId}
                subAgent={subAgent}
                parentSessionId={session.id}
              />
            ))}
            {hasTeammates && team && team.members.map((member, i) => (
              <TeammateItem
                key={member.name}
                member={member}
                tasks={tasks}
                staggerClass={`stagger-${Math.min(i + 7, 10)}`}
              />
            ))}
            {tasks.length > 0 && (
              <>
                <div className="tree-team-summary">
                  {completedTaskCount}/{totalTaskCount} tasks done
                </div>
                {tasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectItem({
  project,
  staggerClass,
  projectIndex,
  onDragStart: onProjectDragStart,
  onDragOver: onProjectDragOver,
  onDragEnd: onProjectDragEnd,
  onDrop: onProjectDrop,
  dropPosition,
  dragMode = 'project',
  onTopLevelDragStart,
  onTopLevelDragOver,
  onTopLevelDragEnd,
  onTopLevelDrop,
  subAgentClock,
}: {
  project: Project
  staggerClass: string
  projectIndex: number
  onDragStart: (e: React.DragEvent, index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent, index: number) => void
  dropPosition: 'above' | 'below' | null
  dragMode?: 'project' | 'top-level'
  onTopLevelDragStart?: (e: React.DragEvent, key: string) => void
  onTopLevelDragOver?: (e: React.DragEvent, key: string) => void
  onTopLevelDragEnd?: () => void
  onTopLevelDrop?: (e: React.DragEvent, key: string) => void
  subAgentClock: number
}) {
  const { sessions, activeSessionId } = useSessionStore()
  const { expandedProjects, toggleProject, openContextMenu, renamingId, setRenamingId, setSidebarSelection } = useUIStore()
  const isExpanded = expandedProjects.has(project.id)
  const headerRef = useRef<HTMLDivElement>(null)

  // Get sessions for this project (non-deleted, non-archived go first)
  const projectSessions = sessions.filter((s) => s.project_id === project.id && s.status !== 'deleted')
  // Split into top-level (no parent) and child QTs (have parent_session_id)
  const topLevelActive = projectSessions.filter((s) => s.status !== 'archived' && !s.parent_session_id)
  const childQTMap = new Map<string, Session[]>()
  for (const s of projectSessions) {
    if (s.parent_session_id && s.status !== 'archived') {
      const children = childQTMap.get(s.parent_session_id) || []
      children.push(s)
      childQTMap.set(s.parent_session_id, children)
    }
  }
  const archivedSessions = projectSessions.filter((s) => s.status === 'archived')
  const hasVisibleChildren = topLevelActive.length > 0 || archivedSessions.length > 0
  const [resumeHealthBySession, setResumeHealthBySession] = useState<Record<string, SessionResumeHealth>>({})
  const [providerSubAgentsBySession, setProviderSubAgentsBySession] = useState<Record<string, ProviderSubAgent[]>>({})
  const resumeHealthKey = projectSessions
    .map((session) => [
      session.id,
      session.status,
      session.provider || '',
      session.started_at || 0,
      session.worktree_path,
      session.provider_session_id || '',
      session.provider_session_source || '',
      session.resume_status || '',
      session.resume_reason || ''
    ].join(':'))
    .join('|')
  const providerSubAgentKey = projectSessions
    .filter((session) => session.provider === 'codex' && session.type !== 'quick-terminal')
    .map((session) => `${session.id}:${session.provider_session_id || ''}:${session.status}:${session.provider_session_captured_at || 0}`)
    .join('|')

  useEffect(() => {
    let cancelled = false
    const relevantSessions = projectSessions.filter((session) => session.type !== 'quick-terminal')

    if (relevantSessions.length === 0) {
      setResumeHealthBySession({})
      return
    }

    void Promise.all(
      relevantSessions.map(async (session) => {
        try {
          const health = await getApi().session.resumeHealth(session.id)
          return [session.id, health] as const
        } catch {
          return [session.id, { canResume: true, level: 'ok', reason: null, guidance: [] as string[] }] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setResumeHealthBySession(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [resumeHealthKey])

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const codexSessions = projectSessions.filter((session) =>
      session.provider === 'codex' &&
      session.type !== 'quick-terminal' &&
      !!session.provider_session_id
    )

    if (!isExpanded || codexSessions.length === 0) {
      setProviderSubAgentsBySession({})
      return
    }

    const refresh = () => {
      void Promise.all(
        codexSessions.map(async (session) => {
          try {
            const subAgents = await getApi().session.listProviderSubAgents(session.id)
            return [session.id, subAgents] as const
          } catch {
            return [session.id, [] as ProviderSubAgent[]] as const
          }
        })
      ).then((entries) => {
        if (cancelled) return
        setProviderSubAgentsBySession(Object.fromEntries(entries))
      })
    }

    refresh()
    interval = setInterval(refresh, 15000)

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [providerSubAgentKey, isExpanded])

  void subAgentClock

  const hasResumeWarning = projectSessions.some((session) => resumeHealthBySession[session.id] && !resumeHealthBySession[session.id].canResume)
  const projectWarningLabel = hasResumeWarning
    ? 'One or more sessions in this project cannot be resumed safely. Expand the project to review the affected sessions.'
    : null

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Watch renamingId from UI store (context menu trigger)
  useEffect(() => {
    if (renamingId === project.id) {
      setIsRenaming(true)
      setRenameValue(project.name)
      setRenamingId(null)
    }
  }, [renamingId, project.id, project.name, setRenamingId])

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  const commitRename = async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== project.name) {
      await useProjectStore.getState().updateProject(project.id, { name: trimmed })
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setRenameValue(project.name)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsRenaming(true)
    setRenameValue(project.name)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { commitRename() }
    else if (e.key === 'Escape') { cancelRename() }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSidebarSelection({ type: 'project', id: project.id })
    openContextMenu({ x: e.clientX, y: e.clientY, type: 'project', targetId: project.id })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSidebarSelection({ type: 'project', id: project.id })
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({ x: rect.right, y: rect.bottom, type: 'project', targetId: project.id })
  }

  return (
    <div className={`tree-project ${staggerClass}`}>
      <div
        ref={headerRef}
        className={`tree-item tree-item--folder-row ${dropPosition === 'above' ? 'tree-item--drop-above' : ''} ${dropPosition === 'below' ? 'tree-item--drop-below' : ''}`}
        onClick={() => {
          if (isRenaming) return
          setSidebarSelection({ type: 'project', id: project.id })
          if (!hasVisibleChildren) return
          toggleProject(project.id)
        }}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={(e) => {
          if (dragMode === 'top-level') onTopLevelDragStart?.(e, `project:${project.id}`)
          else onProjectDragStart(e, projectIndex)
        }}
        onDragOver={(e) => {
          if (dragMode === 'top-level') {
            if (
              e.dataTransfer.types.includes('application/x-project-top-level') ||
              e.dataTransfer.types.includes('application/x-project-id')
            ) {
              onTopLevelDragOver?.(e, `project:${project.id}`)
            }
          }
          else onProjectDragOver(e, projectIndex)
        }}
        onDragEnd={() => {
          if (dragMode === 'top-level') onTopLevelDragEnd?.()
          else onProjectDragEnd()
        }}
        onDrop={(e) => {
          if (dragMode === 'top-level') onTopLevelDrop?.(e, `project:${project.id}`)
          else onProjectDrop(e, projectIndex)
        }}
      >
        <div className="tree-item-main">
          <div className="tree-item-titleline">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="tree-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={() => commitRename()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tree-label" onDoubleClick={handleDoubleClick}>{project.name}</span>
            )}
          </div>
          <div className="tree-item-meta tree-item-meta--empty" aria-hidden="true" />
        </div>
        <div className="tree-item-tail">
          {!isRenaming && hasResumeWarning && projectWarningLabel && (
            <Tooltip label={projectWarningLabel}>
              <span className="tree-resume-warning tree-resume-warning--project" aria-label="Project resume warning">
                <AlertTriangleIcon />
              </span>
            </Tooltip>
          )}
          {!isRenaming && (
            <button className="tree-item-actions" onClick={handleMoreClick}>
              <MoreHorizontalIcon />
            </button>
          )}
          {hasVisibleChildren && (
            <ChevronIcon
              className={`tree-chevron ${isExpanded ? 'tree-chevron--open' : ''}`}
            />
          )}
        </div>
      </div>

      {hasVisibleChildren && (
        <div className={`tree-children-wrapper ${isExpanded ? 'tree-children-wrapper--open' : ''}`}>
          <div className="tree-children">
            {topLevelActive.map((session, i) => (
              <SessionItem
                key={session.id}
                session={session}
                childQTs={childQTMap.get(session.id) || []}
                providerSubAgents={providerSubAgentsBySession[session.id] || []}
                isActive={session.id === activeSessionId}
                staggerClass={`stagger-${Math.min(i + 6, 10)}`}
                projectId={project.id}
                resumeHealth={resumeHealthBySession[session.id] || null}
              />
            ))}
            {archivedSessions.length > 0 && (
              <>
                <div className="tree-archived-divider">
                  <span className="tree-archived-label">Archived ({archivedSessions.length})</span>
                </div>
                {archivedSessions.map((session, i) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    childQTs={[]}
                    providerSubAgents={[]}
                    isActive={session.id === activeSessionId}
                    staggerClass={`stagger-${Math.min(i + 8, 10)}`}
                    projectId={project.id}
                    resumeHealth={resumeHealthBySession[session.id] || null}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GroupItem({
  group,
  groupKey,
  groupProjects,
  filteredProjects: filtered,
  sessions: allSessions,
  staggerClass,
  projectDragHandlers,
  topLevelDragState,
  onTopLevelDragStart,
  onTopLevelDragOver,
  onTopLevelDragEnd,
  onTopLevelDrop,
  clearTopLevelDropTarget,
  dragState,
  subAgentClock,
}: {
  group: ProjectGroup
  groupKey: string
  groupProjects: Project[]
  filteredProjects: Project[]
  sessions: Session[]
  staggerClass: string
  projectDragHandlers: {
    onDragStart: (e: React.DragEvent, index: number) => void
    onDragOver: (e: React.DragEvent, index: number) => void
    onDragEnd: () => void
    onDrop: (e: React.DragEvent, index: number) => void
  }
  topLevelDragState: { dragKey: string | null; dropTarget: { key: string; position: 'above' | 'below' } | null }
  onTopLevelDragStart: (e: React.DragEvent, key: string) => void
  onTopLevelDragOver: (e: React.DragEvent, key: string) => void
  onTopLevelDragEnd: () => void
  onTopLevelDrop: (e: React.DragEvent, key: string) => void
  clearTopLevelDropTarget: () => void
  dragState: { dragIndex: number | null; dropTarget: { index: number; position: 'above' | 'below' } | null }
  subAgentClock: number
}) {
  const { expandedGroups, toggleGroup, openContextMenu, renamingId, setRenamingId, setSidebarSelection } = useUIStore()
  const { moveProjectToGroup } = useProjectStore()
  const isExpanded = expandedGroups.has(group.id)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [dropHighlight, setDropHighlight] = useState(false)

  // Watch renamingId from UI store (context menu trigger)
  useEffect(() => {
    if (renamingId === group.id) {
      setIsRenaming(true)
      setRenameValue(group.name)
      setRenamingId(null)
    }
  }, [renamingId, group.id, group.name, setRenamingId])

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  const commitRename = async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== group.name) {
      await useProjectStore.getState().updateGroup(group.id, { name: trimmed })
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setRenameValue(group.name)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSidebarSelection({ type: 'project-group', id: group.id })
    openContextMenu({ x: e.clientX, y: e.clientY, type: 'project-group', targetId: group.id })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSidebarSelection({ type: 'project-group', id: group.id })
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu({ x: rect.right, y: rect.bottom, type: 'project-group', targetId: group.id })
  }

  // Accept project drops to assign to this group
  const handleGroupDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-project-top-level')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const isProjectDrag = topLevelDragState.dragKey?.startsWith('project:') ?? false
      if (!isProjectDrag) {
        setDropHighlight(false)
        onTopLevelDragOver(e, groupKey)
        return
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const topBand = rect.top + rect.height * 0.28
      const bottomBand = rect.bottom - rect.height * 0.28
      if (e.clientY <= topBand || e.clientY >= bottomBand) {
        setDropHighlight(false)
        onTopLevelDragOver(e, groupKey)
      } else {
        clearTopLevelDropTarget()
        setDropHighlight(true)
      }
      return
    }
    if (e.dataTransfer.types.includes('application/x-project-reorder')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const topBand = rect.top + rect.height * 0.28
      const bottomBand = rect.bottom - rect.height * 0.28
      if (e.clientY <= topBand || e.clientY >= bottomBand) {
        setDropHighlight(false)
        onTopLevelDragOver(e, groupKey)
      } else {
        clearTopLevelDropTarget()
        setDropHighlight(true)
      }
    }
  }

  const handleGroupDragLeave = () => {
    setDropHighlight(false)
  }

  const handleGroupDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-project-top-level')) {
      e.preventDefault()
      e.stopPropagation()
      const draggedKey = topLevelDragState.dragKey
      if (dropHighlight && draggedKey?.startsWith('project:')) {
        setDropHighlight(false)
        void moveProjectToGroup(draggedKey.slice('project:'.length), group.id)
      } else {
        setDropHighlight(false)
        onTopLevelDrop(e, groupKey)
      }
      return
    }
    const projectId = e.dataTransfer.getData('application/x-project-id')
    if (projectId) {
      e.preventDefault()
      e.stopPropagation()
      if (dropHighlight) {
        setDropHighlight(false)
        moveProjectToGroup(projectId, group.id)
      } else {
        onTopLevelDrop(e, groupKey)
      }
    }
  }

  // Filter to only show projects that match search
  const visibleProjects = groupProjects.filter((p) => filtered.includes(p))
  const hasVisibleChildren = visibleProjects.length > 0

  // Hide group only when search is active and nothing matches
  const isSearching = filtered.length !== useProjectStore.getState().projects.length
  if (visibleProjects.length === 0 && isSearching) return null

  return (
    <div className={`tree-group ${staggerClass}`}>
      <div
        className={`tree-item tree-item--group tree-item--folder-row ${dropHighlight ? 'tree-item--drop-inside' : ''} ${topLevelDragState.dropTarget?.key === groupKey && topLevelDragState.dragKey !== groupKey ? `tree-item--drop-${topLevelDragState.dropTarget.position}` : ''}`}
        onClick={() => {
          if (isRenaming) return
          setSidebarSelection({ type: 'project-group', id: group.id })
          if (!hasVisibleChildren) return
          toggleGroup(group.id)
        }}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={(e) => onTopLevelDragStart(e, groupKey)}
        onDragEnd={onTopLevelDragEnd}
        onDragOver={handleGroupDragOver}
        onDragLeave={handleGroupDragLeave}
        onDrop={handleGroupDrop}
      >
        <div className="tree-item-main">
          <div className="tree-item-titleline">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="tree-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') cancelRename()
                }}
                onBlur={() => commitRename()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <GroupIcon className="tree-group-marker" />
                <span className="tree-label tree-label--group">{group.name}</span>
              </>
            )}
          </div>
          <div className="tree-item-meta tree-item-meta--empty" aria-hidden="true" />
        </div>
        <div className="tree-item-tail">
          {!isRenaming && (
            <button className="tree-item-actions" onClick={handleMoreClick}>
              <MoreHorizontalIcon />
            </button>
          )}
          <span className="tree-group-count">{visibleProjects.length}</span>
          {hasVisibleChildren && (
            <ChevronIcon
              className={`tree-chevron ${isExpanded ? 'tree-chevron--open' : ''}`}
            />
          )}
        </div>
      </div>

      {hasVisibleChildren && (
        <div className={`tree-children-wrapper ${isExpanded ? 'tree-children-wrapper--open' : ''}`}>
          <div className="tree-children">
            {visibleProjects.map((project, i) => {
              const pIdx = useProjectStore.getState().projects.findIndex((item) => item.id === project.id)
              return (
                <ProjectItem
                  key={project.id}
                  project={project}
                  staggerClass={`stagger-${Math.min(i + 6, 10)}`}
                  projectIndex={pIdx}
                  onDragStart={projectDragHandlers.onDragStart}
                  onDragOver={projectDragHandlers.onDragOver}
                onDragEnd={projectDragHandlers.onDragEnd}
                onDrop={projectDragHandlers.onDrop}
                dropPosition={dragState.dropTarget?.index === pIdx && dragState.dragIndex !== pIdx ? dragState.dropTarget.position : null}
                subAgentClock={subAgentClock}
              />
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectTree() {
  const { projects, groups, reorderProjects, addGroup, moveProjectToGroup } = useProjectStore()
  const { sessions } = useSessionStore()
  const { searchQuery, expandedProjects, expandedSessions, expandedGroups, collapseProjects, openDialog, setRenamingId, toggleGroup, projectTopLevelOrder, setProjectTopLevelOrder } = useUIStore()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; position: 'above' | 'below' } | null>(null)
  const [topLevelDragKey, setTopLevelDragKey] = useState<string | null>(null)
  const [topLevelDropTarget, setTopLevelDropTarget] = useState<{ key: string; position: 'above' | 'below' } | null>(null)
  const [subAgentClock, setSubAgentClock] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setSubAgentClock(Date.now())
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

  if (projects.length === 0) {
    return <EmptyState />
  }

  const query = searchQuery.toLowerCase().trim()

  // Filter projects to only those with matching sessions (or matching project name)
  const filteredProjects = query
    ? projects.filter((p) => {
        const projectSessions = sessions.filter((s) => s.project_id === p.id && s.status !== 'deleted')
        const hasMatchingSession = projectSessions.some((s) =>
          s.name.toLowerCase().includes(query) ||
          s.branch.toLowerCase().includes(query)
        )
        return hasMatchingSession || p.name.toLowerCase().includes(query)
      })
    : projects

  // Drag-and-drop is only enabled when showing the full unfiltered list
  const isDragEnabled = !query

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!isDragEnabled) { e.preventDefault(); return }
    const project = projects[index]
    e.dataTransfer.setData('application/x-project-reorder', String(index))
    e.dataTransfer.setData('application/x-project-id', project.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!isDragEnabled || dragIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'above' : 'below'
    setDropTarget({ index, position })
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDropTarget(null)
  }

  const handleDrop = (_e: React.DragEvent, targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      handleDragEnd()
      return
    }
    const newProjects = [...projects]
    const [moved] = newProjects.splice(dragIndex, 1)
    let insertAt = targetIndex
    if (dropTarget?.position === 'below') {
      insertAt = dragIndex < targetIndex ? targetIndex : targetIndex + 1
    } else {
      insertAt = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
    }
    newProjects.splice(insertAt, 0, moved)
    reorderProjects(newProjects.map((p) => p.id))
    handleDragEnd()
  }

  const handleTopLevelDragStart = (e: React.DragEvent, key: string) => {
    if (!isDragEnabled) { e.preventDefault(); return }
    e.dataTransfer.setData('application/x-project-top-level', key)
    if (key.startsWith('project:')) {
      e.dataTransfer.setData('application/x-project-id', key.slice('project:'.length))
    }
    e.dataTransfer.effectAllowed = 'move'
    setTopLevelDragKey(key)
  }

  const handleTopLevelDragOver = (e: React.DragEvent, key: string) => {
    if (!isDragEnabled) return
    const isTopLevelDrag = e.dataTransfer.types.includes('application/x-project-top-level')
    const isProjectDrag = e.dataTransfer.types.includes('application/x-project-id')
    if ((isTopLevelDrag && topLevelDragKey === null) || (!isTopLevelDrag && !isProjectDrag)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(null)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'above' : 'below'
    setTopLevelDropTarget({ key, position })
  }

  const handleTopLevelDragEnd = () => {
    setTopLevelDragKey(null)
    setTopLevelDropTarget(null)
  }

  const handleTopLevelDrop = (_e: React.DragEvent, targetKey: string) => {
    _e.preventDefault()
    _e.stopPropagation()
    const reorderTopLevel = (draggedKey: string) => {
      if (draggedKey === targetKey) {
        handleTopLevelDragEnd()
        return
      }
      const newOrder = [...orderedTopLevelKeys].filter((key) => key !== draggedKey)
      const targetIndex = newOrder.indexOf(targetKey)
      if (targetIndex === -1) {
        handleTopLevelDragEnd()
        return
      }
      let insertAt = targetIndex
      if (topLevelDropTarget?.position === 'below') {
        insertAt = targetIndex + 1
      }
      newOrder.splice(insertAt, 0, draggedKey)
      setProjectTopLevelOrder(newOrder)
      handleTopLevelDragEnd()
    }

    if (_e.dataTransfer.types.includes('application/x-project-top-level')) {
      if (!topLevelDragKey) {
        handleTopLevelDragEnd()
        return
      }
      reorderTopLevel(topLevelDragKey)
      return
    }

    const projectId = _e.dataTransfer.getData('application/x-project-id')
    if (projectId) {
      const draggedKey = `project:${projectId}`
      void moveProjectToGroup(projectId, null)
      reorderTopLevel(draggedKey)
      handleDragEnd()
      return
    }

    handleTopLevelDragEnd()
  }

  const projectDragHandlers = {
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragEnd: handleDragEnd,
    onDrop: handleDrop
  }
  const dragState = { dragIndex, dropTarget }
  const topLevelDragState = { dragKey: topLevelDragKey, dropTarget: topLevelDropTarget }

  if (filteredProjects.length === 0) {
    return (
      <>
        <div className="section-header stagger-4">
          <span className="section-label">Projects</span>
          <div className="section-header__actions">
            <span className="section-count">0</span>
            <button className="section-add-btn" onClick={() => openDialog('add-project')} aria-label="Add project" title="Add project">
              <PlusIcon />
            </button>
          </div>
        </div>
        <div className="empty-state">
          <p className="empty-state-title">No results</p>
          <p className="empty-state-text">No projects or sessions match "{searchQuery}"</p>
        </div>
      </>
    )
  }

  const totalSessions = sessions.filter((s) =>
    filteredProjects.some((p) => p.id === s.project_id) && s.status !== 'deleted'
  ).length

  // Split projects into ungrouped and per-group
  const ungroupedProjects = filteredProjects.filter((p) => !p.group_id)
  const orderedTopLevelKeys = getOrderedTopLevelKeys(ungroupedProjects, groups, projectTopLevelOrder)
  const ungroupedProjectByKey = new Map(ungroupedProjects.map((project) => [`project:${project.id}`, project]))
  const groupByKey = new Map(groups.map((group) => [`group:${group.id}`, group]))
  const projectIndexById = new Map(projects.map((project, index) => [project.id, index]))
  const projectGroupIds = groups.map((g) => g.id)
  const hasAnyExpanded = expandedProjects.size > 0 || expandedSessions.size > 0 ||
    projectGroupIds.some((id) => expandedGroups.has(id))

  const handleSectionContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    useUIStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, type: 'projects-header', targetId: '' })
  }

  const handleCreateGroup = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const group = await addGroup('New Group')
    if (!group) return
    toggleGroup(group.id)
    requestAnimationFrame(() => setRenamingId(group.id))
  }

  return (
    <>
      <div className="section-header stagger-4" onContextMenu={handleSectionContextMenu}>
        <span className="section-label">Projects</span>
        <div className="section-header__actions">
          <span className="section-count">{totalSessions}</span>
          {hasAnyExpanded && (
            <button className="section-collapse-btn" onClick={(e) => { e.stopPropagation(); collapseProjects(projects.map((p) => p.id), projectGroupIds) }} title="Collapse all">
              <ChevronsCollapseIcon />
            </button>
          )}
          <button className="section-add-btn" onClick={handleCreateGroup} title="New group">
            <FolderPlusIcon />
          </button>
          <button className="section-add-btn" onClick={(e) => { e.stopPropagation(); openDialog('add-project') }} aria-label="Add project" title="Add project">
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="tree" onDragLeave={() => { setDropTarget(null); setTopLevelDropTarget(null) }}>
        {orderedTopLevelKeys.map((entryKey, index) => {
          if (entryKey.startsWith('project:')) {
            const project = ungroupedProjectByKey.get(entryKey)
            if (!project) return null
            const pIdx = projectIndexById.get(project.id) ?? -1
            return (
              <ProjectItem
                key={project.id}
                project={project}
                staggerClass={`stagger-${Math.min(index + 5, 10)}`}
                projectIndex={pIdx}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                dropPosition={topLevelDropTarget?.key === entryKey && topLevelDragKey !== entryKey
                  ? topLevelDropTarget.position
                  : dropTarget?.index === pIdx && dragIndex !== pIdx
                    ? dropTarget.position
                    : null}
                dragMode="top-level"
                onTopLevelDragStart={handleTopLevelDragStart}
                onTopLevelDragOver={handleTopLevelDragOver}
                onTopLevelDragEnd={handleTopLevelDragEnd}
                onTopLevelDrop={handleTopLevelDrop}
                subAgentClock={subAgentClock}
              />
            )
          }

          const group = groupByKey.get(entryKey)
          if (!group) return null
          const groupProjects = projects.filter((p) => p.group_id === group.id)
          return (
            <GroupItem
              key={group.id}
              group={group}
              groupKey={entryKey}
              groupProjects={groupProjects}
              filteredProjects={filteredProjects}
              sessions={sessions}
              staggerClass={`stagger-${Math.min(index + 5, 10)}`}
              projectDragHandlers={projectDragHandlers}
              topLevelDragState={topLevelDragState}
              onTopLevelDragStart={handleTopLevelDragStart}
              onTopLevelDragOver={handleTopLevelDragOver}
              onTopLevelDragEnd={handleTopLevelDragEnd}
              onTopLevelDrop={handleTopLevelDrop}
              clearTopLevelDropTarget={() => setTopLevelDropTarget(null)}
              dragState={dragState}
              subAgentClock={subAgentClock}
            />
          )
        })}
      </div>
    </>
  )
}
