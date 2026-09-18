import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getApi } from './api/client'
import { getFeatures } from './features'
import { getAppliedTheme, getThemeById, applyTheme, toXtermTheme } from './themes'
import { GitBranchIcon, TerminalIcon, BotIcon, NotesIcon, SplitHorizontalIcon, SplitVerticalIcon, MaximizeIcon, MinimizeIcon, EyeIcon } from './components/icons'
import { PanelActionsMenu, type PanelActionMenuItem } from './components/PanelActionsMenu'
import { QuickNotesPanel, parseQuickNotesPanelId } from './components/QuickNotesPanel'
import { useQuickNotesStore } from './stores/useQuickNotesStore'
import type { SorcererTheme } from './themes'
import type { Agent, Project, Session, SplitBranch, SplitLeaf, SplitNode } from './types'
import '@xterm/xterm/css/xterm.css'

interface PopoutParams {
  panelType: string
  panelId: string
  entityName: string
  themeId: string
  windowId: string
  projectName?: string
  branch?: string
}

type EntityMap = {
  sessions: Session[]
  agents: Agent[]
  projects: Project[]
}

function getHydrationPanelIds(node: SplitNode | null, fallbackPanelId: string): string[] {
  const ids = getAllPanelIds(node)
  return ids.length > 0 ? ids : [fallbackPanelId]
}

let splitIdCounter = 0
function nextSplitId(): string { return `pw_${++splitIdCounter}` }

function parsePopoutParams(): PopoutParams | null {
  const params = new URLSearchParams(window.location.search)
  const popout = params.get('popout')
  const windowId = params.get('windowId')
  if (!popout || !windowId) return null
  const colonIdx = popout.indexOf(':')
  if (colonIdx === -1) return null
  return {
    panelType: popout.slice(0, colonIdx),
    panelId: popout.slice(colonIdx + 1),
    windowId,
    entityName: params.get('name') || 'Sorcerer',
    themeId: params.get('theme') || 'default',
    projectName: params.get('project') || undefined,
    branch: params.get('branch') || undefined
  }
}

function findLeaf(node: SplitNode, leafId: string): SplitLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  return findLeaf(node.children[0], leafId) || findLeaf(node.children[1], leafId)
}

function getAllPanelIds(node: SplitNode | null): string[] {
  if (!node) return []
  if (node.type === 'leaf') return node.sessionId ? [node.sessionId] : []
  return getAllPanelIds(node.children[0]).concat(getAllPanelIds(node.children[1]))
}

function getFirstLeaf(node: SplitNode): SplitLeaf {
  return node.type === 'leaf' ? node : getFirstLeaf(node.children[0])
}

function replaceNode(node: SplitNode, targetId: string, replacement: SplitNode): SplitNode {
  if (node.id === targetId) return replacement
  if (node.type === 'leaf') return node
  return {
    ...node,
    children: [
      replaceNode(node.children[0], targetId, replacement),
      replaceNode(node.children[1], targetId, replacement)
    ]
  }
}

function removeLeaf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === 'leaf') return node.id === leafId ? null : node
  const [left, right] = node.children
  if (left.id === leafId) return right
  if (right.id === leafId) return left
  const newLeft = removeLeaf(left, leafId)
  if (newLeft !== left) return newLeft === null ? right : { ...node, children: [newLeft, right] }
  const newRight = removeLeaf(right, leafId)
  if (newRight !== right) return newRight === null ? left : { ...node, children: [left, newRight] }
  return node
}

function updateNodeRatio(node: SplitNode, targetId: string, ratio: number): SplitNode {
  if (node.id === targetId && node.type === 'split') {
    return { ...node, ratio: Math.min(0.8, Math.max(0.2, ratio)) }
  }
  if (node.type === 'leaf') return node
  return {
    ...node,
    children: [
      updateNodeRatio(node.children[0], targetId, ratio),
      updateNodeRatio(node.children[1], targetId, ratio)
    ]
  }
}

function updateLeafPanel(node: SplitNode, leafId: string, panelId: string | null): SplitNode {
  if (node.type === 'leaf' && node.id === leafId) return { ...node, sessionId: panelId }
  if (node.type === 'leaf') return node
  return {
    ...node,
    children: [
      updateLeafPanel(node.children[0], leafId, panelId),
      updateLeafPanel(node.children[1], leafId, panelId)
    ]
  }
}

function clearPanelFromTree(node: SplitNode, panelId: string): SplitNode {
  if (node.type === 'leaf') return node.sessionId === panelId ? { ...node, sessionId: null } : node
  return {
    ...node,
    children: [
      clearPanelFromTree(node.children[0], panelId),
      clearPanelFromTree(node.children[1], panelId)
    ]
  }
}

function assignLeafPanel(node: SplitNode, leafId: string, panelId: string | null): SplitNode {
  if (panelId === null) return updateLeafPanel(node, leafId, null)
  return updateLeafPanel(clearPanelFromTree(node, panelId), leafId, panelId)
}

function buildTitleForPanel(panelId: string, data: EntityMap): string {
  if (panelId.startsWith('quicknotes:')) {
    const parsed = parseQuickNotesPanelId(panelId)
    if (!parsed) return 'Notes'
    if (parsed.parentType === 'session') {
      const session = data.sessions.find((entry) => entry.id === parsed.parentId)
      return `Notes: ${session?.name ?? 'Session'}`
    }
    const agent = data.agents.find((entry) => entry.id === parsed.parentId)
    return `Notes: ${agent?.name ?? 'Agent'}`
  }

  const session = data.sessions.find((entry) => entry.id === panelId)
  if (session) return session.name
  const agent = data.agents.find((entry) => entry.id === panelId)
  if (agent) return agent.name
  return 'Sorcerer'
}

function PanelHeaderInfo({ panelId, data }: { panelId: string | null; data: EntityMap }) {
  if (!panelId) return <span className="split-panel-name">Empty</span>
  if (panelId.startsWith('quicknotes:')) {
    return <span className="split-panel-name">{buildTitleForPanel(panelId, data)}</span>
  }

  const session = data.sessions.find((entry) => entry.id === panelId)
  if (!session) {
    const agent = data.agents.find((entry) => entry.id === panelId)
    return (
      <span className="split-panel-name">
        <BotIcon style={{ width: 12, height: 12, opacity: 0.5, flexShrink: 0 }} />
        {agent?.name ?? 'Unknown'}
      </span>
    )
  }

  const project = data.projects.find((entry) => entry.id === session.project_id)
  return (
    <span className="split-panel-name">
      {project && (
        <>
          <span className="split-panel-project">{project.name}</span>
          <span className="split-panel-sep">/</span>
        </>
      )}
      {session.name}
      {session.branch && session.type !== 'quick-terminal' && (
        <span className="split-panel-branch">
          <GitBranchIcon />
          {session.branch}
        </span>
      )}
    </span>
  )
}

function PopoutTerminal({ sessionId, onExited }: { sessionId: string; onExited: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ terminal: Terminal; fitAddon: FitAddon } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const theme = getAppliedTheme()
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
      drawBoldTextInBrightColors: false,
      theme: toXtermTheme(theme),
      allowTransparency: false,
      scrollback: 3000,
      lineHeight: 1.2
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    termRef.current = { terminal, fitAddon }

    getApi().settings.get('terminalFontSize').then((v: string | undefined) => {
      const size = v ? Number(v) : 13
      if (size && size !== 13) {
        terminal.options.fontSize = size
        try { fitAddon.fit() } catch {}
      }
    })

    getApi().popout.getScrollback(sessionId).then((scrollback: string) => {
      if (scrollback) terminal.write(scrollback)
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          getApi().terminal.resize(sessionId, terminal.cols, terminal.rows)
        } catch {}
      })
    })

    terminal.onData((data) => {
      getApi().terminal.write(sessionId, data)
    })

    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection()
      if (selection) navigator.clipboard.writeText(selection).catch(() => {})
    })

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'v' && e.type === 'keydown') {
        e.preventDefault()
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text)
        }).catch(() => {})
        return false
      }
      return true
    })

    const unsubData = getApi().terminal.onData(sessionId, (data: string) => {
      terminal.write(data)
    })
    const unsubExit = getApi().terminal.onExit(sessionId, (exitCode: number) => {
      terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`)
      getApi().popout.notifySessionUpdated(sessionId, 'idle', null)
      onExited()
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        getApi().terminal.resize(sessionId, terminal.cols, terminal.rows)
      } catch {}
    })
    resizeObserver.observe(containerRef.current)

    requestAnimationFrame(() => terminal.focus())

    return () => {
      resizeObserver.disconnect()
      unsubData()
      unsubExit()
      terminal.dispose()
      termRef.current = null
    }
  }, [sessionId, onExited])

  useEffect(() => {
    const handler = (e: Event) => {
      const theme = (e as CustomEvent<SorcererTheme>).detail
      if (!theme || !termRef.current) return
      termRef.current.terminal.options.theme = toXtermTheme(theme)
    }
    window.addEventListener('sorcerer:themeChange', handler)
    return () => window.removeEventListener('sorcerer:themeChange', handler)
  }, [])

  return (
    <div className="terminal-container">
      <div ref={containerRef} className="terminal-xterm popout-terminal" />
    </div>
  )
}

function SplitDivider({ direction, onDrag }: { direction: 'horizontal' | 'vertical'; onDrag: (ratio: number) => void }) {
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLElement | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    containerRef.current = (e.currentTarget as HTMLElement).parentElement
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [direction])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      onDrag(direction === 'horizontal'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height)
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [direction, onDrag])

  return <div className={`split-divider split-divider--${direction}`} onMouseDown={onMouseDown} />
}

function PopoutLeafContent({
  panelId,
  data,
  onStarted,
  onExited,
}: {
  panelId: string
  data: EntityMap
  onStarted: (panelId: string, status: string, pid: number | null) => void
  onExited: (panelId: string) => void
}) {
  if (panelId.startsWith('quicknotes:')) {
    return <QuickNotesPanel panelSessionId={panelId} />
  }

  const session = data.sessions.find((entry) => entry.id === panelId)
  const agent = !session ? data.agents.find((entry) => entry.id === panelId) : undefined
  const activeItem = session || agent

  if (!activeItem) {
    return (
      <div className="terminal-placeholder">
        <TerminalIcon className="terminal-placeholder-icon" />
        <div className="terminal-placeholder-text">Panel target not found.</div>
      </div>
    )
  }

  if (activeItem.status === 'active') {
    return <PopoutTerminal sessionId={activeItem.id} onExited={() => onExited(activeItem.id)} />
  }

  if (session?.type === 'quick-terminal') {
    return (
      <div className="terminal-placeholder">
        <TerminalIcon className="terminal-placeholder-icon" />
        <div className="terminal-placeholder-text">Terminal has ended.</div>
        <div className="terminal-action-row">
          <button className="terminal-restart-btn terminal-restart-btn--primary" onClick={async () => {
            const restarted = await getApi().session.restart(session.id)
            if (restarted) onStarted(session.id, restarted.status, restarted.pid ?? null)
          }}>
            Restart
          </button>
        </div>
      </div>
    )
  }

  if (session) {
    return (
      <div className="terminal-placeholder">
        <TerminalIcon className="terminal-placeholder-icon" />
        <div className="terminal-placeholder-text">Session <strong>{session.name}</strong> has ended.</div>
        <div className="terminal-action-row">
          <button className="terminal-restart-btn terminal-restart-btn--primary" onClick={async () => {
            const resumed = await getApi().session.resume(session.id)
            if (resumed) onStarted(session.id, resumed.status, resumed.pid ?? null)
          }}>
            Resume
          </button>
          <button className="terminal-restart-btn" onClick={async () => {
            const restarted = await getApi().session.restart(session.id)
            if (restarted) onStarted(session.id, restarted.status, restarted.pid ?? null)
          }}>
            New Session
          </button>
        </div>
      </div>
    )
  }

  const isAutonomous = !!agent?.mission
  return (
    <div className="terminal-placeholder">
      <BotIcon className="terminal-placeholder-icon" />
      <div className="terminal-placeholder-text">Agent <strong>{agent?.name}</strong> has {isAutonomous ? 'stopped' : 'ended'}.</div>
      <div className="terminal-action-row">
        {isAutonomous ? (
          <button className="terminal-restart-btn terminal-restart-btn--primary" onClick={async () => {
            await getApi().agent.start(agent!.id)
            onStarted(agent!.id, 'active', null)
          }}>
            Restart Mission
          </button>
        ) : (
          <>
            <button className="terminal-restart-btn terminal-restart-btn--primary" onClick={async () => {
              await getApi().agent.resume(agent!.id)
              onStarted(agent!.id, 'active', null)
            }}>
              Resume
            </button>
            <button className="terminal-restart-btn" onClick={async () => {
              await getApi().agent.restart(agent!.id)
              onStarted(agent!.id, 'active', null)
            }}>
              New Session
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function PopoutWorkspace({ params }: { params: PopoutParams }) {
  const [data, setData] = useState<EntityMap>({ sessions: [], agents: [], projects: [] })
  const [splitRoot, setSplitRoot] = useState<SplitNode>({
    type: 'leaf',
    id: nextSplitId(),
    sessionId: params.panelId
  })
  const [focusedPanelId, setFocusedPanelId] = useState(splitRoot.id)
  const [maximizedPanelId, setMaximizedPanelId] = useState<string | null>(null)
  const [spotlightMode, setSpotlightMode] = useState(false)
  const loadInFlightRef = useRef(false)
  const reloadQueuedRef = useRef(false)
  const queuedPanelIdsRef = useRef<string[] | null>(null)

  const loadEntities = useCallback(async (panelIds?: string[]) => {
    if (loadInFlightRef.current) {
      reloadQueuedRef.current = true
      queuedPanelIdsRef.current = panelIds ?? getHydrationPanelIds(splitRoot, params.panelId)
      return
    }

    loadInFlightRef.current = true
    try {
      const nextPanelIds = panelIds ?? getHydrationPanelIds(splitRoot, params.panelId)
      const { sessions, agents, projects } = await getApi().popout.getEntities(nextPanelIds)
      setData({ sessions, agents, projects })
    } finally {
      loadInFlightRef.current = false
      if (reloadQueuedRef.current) {
        reloadQueuedRef.current = false
        const nextQueuedIds = queuedPanelIdsRef.current
        queuedPanelIdsRef.current = null
        void loadEntities(nextQueuedIds ?? undefined)
      }
    }
  }, [params.panelId, splitRoot])

  useEffect(() => {
    void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
    const interval = setInterval(() => {
      if (!document.hidden) {
        void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
      }
    }, 5000)
    const handleWindowFocus = () => { void loadEntities(getHydrationPanelIds(splitRoot, params.panelId)) }
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
      }
    }
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadEntities, params.panelId, splitRoot])

  useEffect(() => {
    void getApi().popout.syncPanels(params.windowId, getAllPanelIds(splitRoot))
    void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
  }, [loadEntities, params.panelId, params.windowId, splitRoot])

  useEffect(() => {
    const focusedLeaf = findLeaf(splitRoot, focusedPanelId)
    const ready = !!focusedLeaf && focusedLeaf.sessionId === null
    void getApi().popout.setSelectionTargetReady(params.windowId, ready)
    return () => {
      void getApi().popout.setSelectionTargetReady(params.windowId, false)
    }
  }, [params.windowId, splitRoot, focusedPanelId])

  useEffect(() => {
    const unsubAssign = getApi().popout.onAssignPanel((panelId: string) => {
      setSplitRoot((current) => {
        const focusedLeaf = findLeaf(current, focusedPanelId)
        if (!focusedLeaf || focusedLeaf.sessionId !== null) return current
        return assignLeafPanel(current, focusedLeaf.id, panelId)
      })
      void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
    })
    const unsubUpdated = getApi().popout.onSessionUpdated((panelId, status, pid) => {
      setData((current) => ({
        ...current,
        sessions: current.sessions.map((entry) => entry.id === panelId ? { ...entry, status: status as any, pid } : entry),
        agents: current.agents.map((entry) => entry.id === panelId ? { ...entry, status: status as any, pid } : entry)
      }))
    })
    return () => {
      unsubAssign()
      unsubUpdated()
    }
  }, [focusedPanelId, loadEntities, params.panelId, splitRoot])

  useEffect(() => {
    const title = buildTitleForPanel(getAllPanelIds(splitRoot)[0] || params.panelId, data)
    document.title = getAllPanelIds(splitRoot).length > 1
      ? `${title} +${getAllPanelIds(splitRoot).length - 1} — Sorcerer`
      : `${title} — Sorcerer`
  }, [data, params.panelId, splitRoot])

  const updateSessionState = (panelId: string, status: string, pid: number | null) => {
    getApi().popout.notifySessionUpdated(panelId, status, pid)
    void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
  }

  const splitFocused = (leafId: string, direction: 'horizontal' | 'vertical', panelId: string) => {
    setFocusedPanelId(leafId)
    setSplitRoot((current) => {
      const focused = findLeaf(current, leafId)
      if (!focused) return current
      const newLeafId = nextSplitId()
      const branchId = nextSplitId()
      const newPanelId = focused.sessionId === panelId ? null : panelId
      const newBranch: SplitBranch = {
        type: 'split',
        id: branchId,
        direction,
        ratio: 0.5,
        children: [
          { ...focused },
          { type: 'leaf', id: newLeafId, sessionId: newPanelId }
        ]
      }
      setFocusedPanelId(newLeafId)
      return replaceNode(current, leafId, newBranch)
    })
  }

  const closeLeaf = async (leafId: string, panelId: string | null) => {
    if (panelId?.startsWith('quicknotes:')) {
      const parsed = parseQuickNotesPanelId(panelId)
      if (parsed) useQuickNotesStore.getState().removeNotePanel(parsed.parentId)
    }
    const session = panelId ? data.sessions.find((entry) => entry.id === panelId) : null
    if (session?.type === 'quick-terminal') {
      await getApi().session.delete(session.id)
      void loadEntities(getHydrationPanelIds(splitRoot, params.panelId))
    }

    setSplitRoot((current) => {
      const result = removeLeaf(current, leafId)
      if (!result) {
        window.close()
        return current
      }
      if (result.type === 'leaf') {
        setFocusedPanelId(result.id)
        setMaximizedPanelId(null)
        return result
      }
      if (focusedPanelId === leafId) {
        setFocusedPanelId(getFirstLeaf(result).id)
      }
      if (maximizedPanelId === leafId) {
        setMaximizedPanelId(null)
      }
      return result
    })
  }

  const setPanelId = (leafId: string, panelId: string | null) => {
    setSplitRoot((current) => assignLeafPanel(current, leafId, panelId))
  }

  const renderNode = (node: SplitNode): ReactElement => {
    if (node.type === 'leaf') {
      const isFocused = focusedPanelId === node.id
      const isDimmedBySpotlight = spotlightMode && !!focusedPanelId && !isFocused
      const panelId = node.sessionId
      const isEmpty = panelId === null
      const isQuickNotes = !!panelId?.startsWith('quicknotes:')
      const session = panelId && !isQuickNotes ? data.sessions.find((entry) => entry.id === panelId) : undefined
      const agent = panelId && !isQuickNotes && !session ? data.agents.find((entry) => entry.id === panelId) : undefined

      const fillEmptyOrSplit = (nextPanelId: string) => {
        const focusedLeaf = findLeaf(splitRoot, focusedPanelId)
        if (focusedLeaf && focusedLeaf.sessionId === null) {
          setPanelId(focusedLeaf.id, nextPanelId)
          return focusedLeaf.id
        }
        splitFocused(node.id, 'horizontal', nextPanelId)
        return null
      }

      const openQuickNotes = (parentId: string, parentType: 'session' | 'agent') => {
        const notePanelId = `quicknotes:${parentType}:${parentId}`
        useQuickNotesStore.getState().addNotePanel(parentId)
        const filledLeafId = fillEmptyOrSplit(notePanelId)
        if (filledLeafId) setFocusedPanelId(filledLeafId)
      }

      const panelMenuItems: PanelActionMenuItem[] = []
      if (session && session.type !== 'quick-terminal') {
        panelMenuItems.push(
          {
            label: 'Open Quick Notes',
            icon: <NotesIcon />,
            action: () => openQuickNotes(session.id, 'session')
          },
          {
            label: 'Open Quick Terminal',
            icon: <TerminalIcon />,
            action: async () => {
              const quickTerminal = await getApi().session.createQuickTerminal(session.id)
              if (!quickTerminal) return
              await loadEntities()
              const leafId = fillEmptyOrSplit(quickTerminal.id)
              if (leafId) setFocusedPanelId(leafId)
            }
          }
        )
      }
      if (agent) {
        panelMenuItems.push(
          {
            label: 'Open Quick Notes',
            icon: <NotesIcon />,
            action: () => openQuickNotes(agent.id, 'agent')
          },
          {
            label: 'Open Quick Terminal',
            icon: <TerminalIcon />,
            action: async () => {
              const quickTerminal = await getApi().agent.createQuickTerminal(agent.id)
              if (!quickTerminal) return
              await loadEntities()
              const leafId = fillEmptyOrSplit(quickTerminal.id)
              if (leafId) setFocusedPanelId(leafId)
            }
          }
        )
      }
      if (panelMenuItems.length > 0 && panelId) {
        panelMenuItems.push({ type: 'separator' })
      }
      if (panelId) {
        panelMenuItems.push(
          {
            label: 'Split Right',
            icon: <SplitHorizontalIcon />,
            action: () => splitFocused(node.id, 'horizontal', panelId)
          },
          {
            label: 'Split Down',
            icon: <SplitVerticalIcon />,
            action: () => splitFocused(node.id, 'vertical', panelId)
          }
        )
      }
      if (panelMenuItems.length > 0) {
        panelMenuItems.push({ type: 'separator' })
      }
      panelMenuItems.push(
        {
          label: spotlightMode ? 'Turn off Spotlight' : 'Spotlight',
          icon: <EyeIcon />,
          active: spotlightMode,
          action: () => {
            setFocusedPanelId(node.id)
            setSpotlightMode((current) => !current)
          }
        },
        {
          label: maximizedPanelId === node.id ? 'Restore' : 'Maximize',
          icon: maximizedPanelId === node.id ? <MinimizeIcon /> : <MaximizeIcon />,
          active: maximizedPanelId === node.id,
          action: () => setMaximizedPanelId((current) => current === node.id ? null : node.id)
        }
      )

      return (
        <div className={`split-panel ${isFocused ? 'split-panel--focused' : ''} ${isDimmedBySpotlight ? 'split-panel--spotlight-dimmed' : ''}`} onClick={() => setFocusedPanelId(node.id)}>
          <div className="split-panel-titlebar">
            <PanelHeaderInfo panelId={panelId} data={data} />
            <div className="split-panel-actions">
              <PanelActionsMenu items={panelMenuItems} />
              <button className="split-panel-close" onClick={(e) => {
                e.stopPropagation()
                void closeLeaf(node.id, panelId)
              }}>&times;</button>
            </div>
          </div>
          <div className="split-panel-body">
            {isEmpty ? (
              <div className="terminal-placeholder">
                <TerminalIcon className="terminal-placeholder-icon" />
                <div className="terminal-placeholder-text">
                  {getFeatures().standaloneAgents ? 'Click a session, agent, or notes entry in the sidebar to open it here' : 'Click a session or notes entry in the sidebar to open it here'}
                </div>
              </div>
            ) : (
              <PopoutLeafContent
                panelId={panelId!}
                data={data}
                onStarted={updateSessionState}
                onExited={(id) => updateSessionState(id, 'idle', null)}
              />
            )}
          </div>
        </div>
      )
    }

    const [child1, child2] = node.children
    return (
      <div className={`split-container split-container--${node.direction}`}>
        <div className="split-pane" style={node.direction === 'horizontal' ? { width: `${node.ratio * 100}%` } : { height: `${node.ratio * 100}%` }}>
          {renderNode(child1)}
        </div>
        <SplitDivider direction={node.direction} onDrag={(ratio) => setSplitRoot((current) => updateNodeRatio(current, node.id, ratio))} />
        <div className="split-pane" style={node.direction === 'horizontal' ? { width: `${(1 - node.ratio) * 100}%` } : { height: `${(1 - node.ratio) * 100}%` }}>
          {renderNode(child2)}
        </div>
      </div>
    )
  }

  const maximizedLeaf = maximizedPanelId ? findLeaf(splitRoot, maximizedPanelId) : null
  return (
    <div className="popout-shell">
      <div className="main-titlebar" />
      {maximizedLeaf ? (
        <div className="split-panel--maximized-container">{renderNode(maximizedLeaf)}</div>
      ) : (
        renderNode(splitRoot)
      )}
    </div>
  )
}

export function PopoutApp() {
  const [params] = useState(() => parsePopoutParams())

  useEffect(() => {
    if (params?.themeId) {
      applyTheme(getThemeById(params.themeId), { broadcast: false })
    }
  }, [params?.themeId])

  useEffect(() => {
    const unsub = getApi().popout.onThemeUpdate((themeId: string) => {
      applyTheme(getThemeById(themeId), { broadcast: false })
    })
    return () => { unsub() }
  }, [])

  if (!params) {
    return <div className="popout-error">Invalid popout parameters</div>
  }

  if (params.panelType === 'terminal') {
    return <PopoutWorkspace params={params} />
  }

  return <div className="popout-error">Unknown panel type: {params.panelType}</div>
}
