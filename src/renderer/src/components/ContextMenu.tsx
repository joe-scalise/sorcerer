import { useEffect, useRef, type ReactNode } from 'react'
import { useUIStore } from '../stores/useUIStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useAgentStore } from '../stores/useAgentStore'
import { useToastStore } from '../stores/useToastStore'
import {
  PlusIcon, CopyIcon, TrashIcon, SplitHorizontalIcon, SplitVerticalIcon,
  RefreshIcon, UploadIcon, ExternalLinkIcon, ArchiveIcon, RotateCcwIcon, EditIcon, PlayIcon, StopIcon, MergeIcon
} from './icons'

type MenuItem =
  | { label: string; icon?: ReactNode; shortcut?: string; action: () => void; danger?: boolean }
  | { type: 'separator' }

export function ContextMenu() {
  const { contextMenu, closeContextMenu, openDialog, splitRight, splitDown, setRenamingId } = useUIStore()
  const { projects } = useProjectStore()
  const { sessions, resumeSession, restartSession, restoreSession, pushBranch } = useSessionStore()
  const { agents, startAgent, resumeAgent, restartAgent, killAgent } = useAgentStore()
  const { addToast } = useToastStore()
  const menuRef = useRef<HTMLDivElement>(null)

  // Clamp menu position to viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const pad = 8

    let top = contextMenu.y
    let left = contextMenu.x
    if (rect.right > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad
    }
    if (rect.bottom > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad
    }
    if (left < pad) left = pad
    if (top < pad) top = pad

    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
  })

  // Focus first item when menu opens
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const firstBtn = menuRef.current.querySelector<HTMLButtonElement>('.context-menu-item')
    firstBtn?.focus()
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeContextMenu(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!menuRef.current) return
        const btns = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('.context-menu-item'))
        if (btns.length === 0) return
        const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'ArrowDown') {
          btns[(idx + 1) % btns.length].focus()
        } else {
          btns[(idx - 1 + btns.length) % btns.length].focus()
        }
      }
    }
    requestAnimationFrame(() => {
      window.addEventListener('click', onClick)
      window.addEventListener('contextmenu', onClick)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, closeContextMenu])

  if (!contextMenu) return null

  const findProjectPath = (targetId: string): string => {
    const project = projects.find((p) => p.id === targetId)
    return project?.path ?? ''
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      addToast(`${label} copied`, 'success')
    }).catch(() => {
      addToast('Failed to copy', 'error')
    })
  }

  // Find session/agent to determine state
  const targetSession = contextMenu.type === 'session'
    ? sessions.find((s) => s.id === contextMenu.targetId)
    : undefined
  const targetAgent = contextMenu.type === 'agent'
    ? agents.find((a) => a.id === contextMenu.targetId)
    : undefined
  const isArchived = targetSession?.status === 'archived'

  const iconClass = 'context-menu-icon'

  let items: MenuItem[]

  if (contextMenu.type === 'agent') {
    const isRunning = targetAgent?.status === 'active'
    items = [
      ...(isRunning ? [
        { label: 'Stop Agent', icon: <StopIcon className={iconClass} />, action: async () => {
          await killAgent(contextMenu.targetId)
          addToast('Agent stopped', 'info')
        }}
      ] : [
        { label: 'Resume Agent', icon: <PlayIcon className={iconClass} />, action: async () => {
          await resumeAgent(contextMenu.targetId)
          addToast('Agent resumed', 'info')
        }},
        { label: 'Start New Session', icon: <RefreshIcon className={iconClass} />, action: async () => {
          await restartAgent(contextMenu.targetId)
          addToast('New agent session started', 'info')
        }}
      ]),
      { type: 'separator' as const },
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => splitRight(contextMenu.targetId) },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => splitDown(contextMenu.targetId) },
      { type: 'separator' as const },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { type: 'separator' as const },
      { label: 'Delete Agent', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-agent', contextMenu.targetId) }
    ]
  } else if (contextMenu.type === 'project') {
    items = [
      { label: 'New Session', icon: <PlusIcon className={iconClass} />, shortcut: 'Ctrl+N', action: () => openDialog('new-session', contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Copy Project Path', icon: <CopyIcon className={iconClass} />, action: () => copyToClipboard(findProjectPath(contextMenu.targetId), 'Path') },
      { type: 'separator' },
      { label: 'Remove Project', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  } else if (isArchived) {
    items = [
      { label: 'Restore Session', icon: <RotateCcwIcon className={iconClass} />, action: async () => {
        await restoreSession(contextMenu.targetId)
        addToast(`"${targetSession!.name}" restored`, 'info')
      }},
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Copy Worktree Path', icon: <CopyIcon className={iconClass} />, action: () => {
        if (targetSession) copyToClipboard(targetSession.worktree_path, 'Worktree path')
      }},
      { type: 'separator' },
      { label: 'Delete Session', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  } else {
    items = [
      { label: 'Split Right', icon: <SplitHorizontalIcon className={iconClass} />, action: () => splitRight(contextMenu.targetId) },
      { label: 'Split Down', icon: <SplitVerticalIcon className={iconClass} />, action: () => splitDown(contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Rename', icon: <EditIcon className={iconClass} />, shortcut: 'F2', action: () => setRenamingId(contextMenu.targetId) },
      { label: 'Resume Session', icon: <PlayIcon className={iconClass} />, action: async () => {
        await resumeSession(contextMenu.targetId)
        addToast('Session resumed', 'info')
      }},
      { label: 'New Session', icon: <RefreshIcon className={iconClass} />, action: async () => {
        await restartSession(contextMenu.targetId)
        addToast('New session started', 'info')
      }},
      { label: 'Copy Worktree Path', icon: <CopyIcon className={iconClass} />, action: () => {
        if (targetSession) copyToClipboard(targetSession.worktree_path, 'Worktree path')
      }},
      { type: 'separator' },
      { label: 'Push Branch', icon: <UploadIcon className={iconClass} />, action: async () => {
        addToast('Pushing branch...', 'info')
        const result = await pushBranch(contextMenu.targetId)
        if (result.pushed) {
          addToast('Branch pushed to remote', 'success')
        } else {
          addToast(result.error || 'Push failed', 'error')
        }
      }},
      { label: 'Open Remote', icon: <ExternalLinkIcon className={iconClass} />, action: async () => {
        try {
          const result = await window.sorcerer.session.openRemote(contextMenu.targetId)
          if (!result.opened) {
            addToast(result.error || 'No remote URL found', 'error')
          }
        } catch {
          addToast('Failed to open remote', 'error')
        }
      }},
      { label: 'Land on Main', icon: <MergeIcon className={iconClass} />, action: () => openDialog('land-session', contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Archive Session', icon: <ArchiveIcon className={iconClass} />, action: () => openDialog('archive-session', contextMenu.targetId) },
      { type: 'separator' },
      { label: 'Delete Session', icon: <TrashIcon className={iconClass} />, danger: true, action: () => openDialog('delete-session', contextMenu.targetId) }
    ]
  }

  return (
    <div
      className="context-menu"
      ref={menuRef}
      style={{ top: contextMenu.y, left: contextMenu.x }}
    >
      {items.map((item, i) =>
        'type' in item ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'context-menu-item--danger' : ''}`}
            onClick={() => { item.action(); closeContextMenu() }}
          >
            {item.icon}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
