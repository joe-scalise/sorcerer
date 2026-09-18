import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useSessionStore } from './useSessionStore'
import type { SplitNode, SplitLeaf, SplitBranch } from '../types'

type DialogType =
  | 'new-session'
  | 'add-project'
  | 'import-sessions'
  | 'feedback'
  | 'delete-session'
  | 'archive-session'
  | 'land-session'
  | 'settings'
  | 'add-agent'
  | 'delete-agent'
  | 'edit-agent-mission'
  | 'move-project-group'
  | 'move-agent-group'
  | null

interface ContextMenu {
  x: number
  y: number
  type: 'project' | 'session' | 'agent' | 'quicknotes' | 'project-group' | 'projects-header' | 'agent-group' | 'agents-header'
  targetId: string
}

interface SidebarSelection {
  type: 'project' | 'project-group' | 'session'
  id: string
}

export const SIDEBAR_MIN = 200
export const SIDEBAR_DEFAULT = 260
export const AGENT_PANE_MIN = 120
export const AGENT_PANE_DEFAULT = 240

interface UIState {
  activeDialog: DialogType
  dialogTargetId: string | null
  dialogClosing: boolean
  openDialog: (type: DialogType, targetId?: string) => void
  closeDialog: () => void

  contextMenu: ContextMenu | null
  openContextMenu: (menu: ContextMenu) => void
  closeContextMenu: () => void

  sidebarSelection: SidebarSelection | null
  setSidebarSelection: (selection: SidebarSelection | null) => void

  // Inline rename
  renamingId: string | null
  setRenamingId: (id: string | null) => void

  // Sidebar state (moved from session store)
  expandedProjects: Set<string>
  expandedSessions: Set<string>
  expandedGroups: Set<string>
  projectTopLevelOrder: string[]
  toggleProject: (id: string) => void
  toggleSession: (id: string) => void
  toggleGroup: (id: string) => void
  setProjectTopLevelOrder: (order: string[]) => void
  resetSidebarLayout: () => void
  collapseProjects: (projectIds: string[], groupIds: string[]) => void
  collapseAgents: (agentGroupIds: string[]) => void
  sidebarCollapsed: boolean
  sidebarHidden: boolean
  toggleSidebar: () => void
  toggleSidebarCollapse: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  agentPaneHeight: number
  setAgentPaneHeight: (height: number) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void

  // Split view (tree-based, limitless)
  splitRoot: SplitNode | null
  focusedPanelId: string | null
  maximizedPanelId: string | null
  focusModeSessionId: string | null
  spotlightMode: boolean
  splitRight: (sessionId: string) => void
  splitDown: (sessionId: string) => void
  closePanel: (panelId: string) => void
  closeSplit: () => void
  setSplitRatio: (nodeId: string, ratio: number) => void
  setFocusedPanel: (panelId: string) => void
  setPanelSession: (panelId: string, sessionId: string | null) => void
  toggleMaximizePanel: (panelId: string) => void
  unmaximizePanel: () => void
  toggleSpotlightMode: () => void
  setSpotlightMode: (enabled: boolean) => void
  enterFocusMode: (sessionId: string) => void
  exitFocusMode: () => void

  // Remote control — sessions being viewed remotely
  remoteSessionIds: Set<string>
  setRemoteSessionIds: (ids: string[]) => void

  // Popped-out sessions — running in separate windows
  poppedOutSessionIds: Set<string>
  addPoppedOut: (id: string) => void
  removePoppedOut: (id: string) => void

  // Display preferences
  showProviderBadges: boolean
  setShowProviderBadges: (v: boolean) => void
  showFeedbackIcon: boolean
  setShowFeedbackIcon: (v: boolean) => void
}

// --- Split tree helpers ---

let splitIdCounter = 0
function nextSplitId(): string { return 'sp_' + (++splitIdCounter) }

function syncSplitIdCounter(node: SplitNode | null): void {
  if (!node) return

  let maxId = splitIdCounter
  const visit = (current: SplitNode) => {
    const match = current.id.match(/^sp_(\d+)$/)
    if (match) {
      maxId = Math.max(maxId, Number(match[1]))
    }
    if (current.type === 'split') {
      visit(current.children[0])
      visit(current.children[1])
    }
  }

  visit(node)
  splitIdCounter = Math.max(splitIdCounter, maxId)
}

export function findLeaf(node: SplitNode, leafId: string): SplitLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  return findLeaf(node.children[0], leafId) || findLeaf(node.children[1], leafId)
}

export function findLeafBySession(node: SplitNode, sessionId: string): SplitLeaf | null {
  if (node.type === 'leaf') return node.sessionId === sessionId ? node : null
  return findLeafBySession(node.children[0], sessionId) || findLeafBySession(node.children[1], sessionId)
}

export function getAllSessionIds(node: SplitNode): string[] {
  if (node.type === 'leaf') return node.sessionId ? [node.sessionId] : []
  return getAllSessionIds(node.children[0]).concat(getAllSessionIds(node.children[1]))
}

function getFirstLeaf(node: SplitNode): SplitLeaf {
  if (node.type === 'leaf') return node
  return getFirstLeaf(node.children[0])
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
  if (newLeft !== left) {
    return newLeft === null ? right : { ...node, children: [newLeft, right] }
  }
  const newRight = removeLeaf(right, leafId)
  if (newRight !== right) {
    return newRight === null ? left : { ...node, children: [left, newRight] }
  }
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

function updateLeafSession(node: SplitNode, leafId: string, sessionId: string | null): SplitNode {
  if (node.type === 'leaf' && node.id === leafId) {
    return { ...node, sessionId }
  }
  if (node.type === 'leaf') return node
  return {
    ...node,
    children: [
      updateLeafSession(node.children[0], leafId, sessionId),
      updateLeafSession(node.children[1], leafId, sessionId)
    ]
  }
}

function assignLeafSession(node: SplitNode, leafId: string, sessionId: string | null): SplitNode {
  if (sessionId === null) {
    return updateLeafSession(node, leafId, null)
  }

  const clearedTree = clearSessionFromTree(node, sessionId)
  return updateLeafSession(clearedTree, leafId, sessionId)
}

export function clearSessionFromTree(node: SplitNode, sessionId: string): SplitNode {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? { ...node, sessionId: null } : node
  }
  return {
    ...node,
    children: [
      clearSessionFromTree(node.children[0], sessionId),
      clearSessionFromTree(node.children[1], sessionId)
    ]
  }
}

// Custom storage to handle Set serialization for persist middleware
const setStorage = {
  getItem: (name: string) => {
    const raw = localStorage.getItem(name)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.state) {
      if (Array.isArray(parsed.state.expandedProjects)) {
        const s = new Set<string>()
        for (const v of parsed.state.expandedProjects) s.add(v)
        parsed.state.expandedProjects = s
      }
      if (Array.isArray(parsed.state.expandedSessions)) {
        const s = new Set<string>()
        for (const v of parsed.state.expandedSessions) s.add(v)
        parsed.state.expandedSessions = s
      }
      if (Array.isArray(parsed.state.expandedGroups)) {
        const s = new Set<string>()
        for (const v of parsed.state.expandedGroups) s.add(v)
        parsed.state.expandedGroups = s
      }
      if (Array.isArray(parsed.state.poppedOutSessionIds)) {
        const s = new Set<string>()
        for (const v of parsed.state.poppedOutSessionIds) s.add(v)
        parsed.state.poppedOutSessionIds = s
      }
    }
    return parsed
  },
  setItem: (name: string, value: unknown) => {
    const v = value as { state: Record<string, unknown> }
    const state = { ...v.state }
    if (state.expandedProjects instanceof Set) {
      state.expandedProjects = Array.from(state.expandedProjects as Set<string>)
    }
    if (state.expandedSessions instanceof Set) {
      state.expandedSessions = Array.from(state.expandedSessions as Set<string>)
    }
    if (state.expandedGroups instanceof Set) {
      state.expandedGroups = Array.from(state.expandedGroups as Set<string>)
    }
    if (state.poppedOutSessionIds instanceof Set) {
      state.poppedOutSessionIds = Array.from(state.poppedOutSessionIds as Set<string>)
    }
    localStorage.setItem(name, JSON.stringify({ ...v, state }))
  },
  removeItem: (name: string) => localStorage.removeItem(name)
}

// --- Store ---

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      activeDialog: null,
      dialogTargetId: null,
      dialogClosing: false,
      openDialog: (type, targetId) => set({
        activeDialog: type,
        dialogTargetId: targetId ?? null,
        dialogClosing: false,
        contextMenu: null
      }),
      closeDialog: () => {
        set({ dialogClosing: true })
        setTimeout(() => {
          set({ activeDialog: null, dialogTargetId: null, dialogClosing: false })
        }, 150)
      },

      contextMenu: null,
      openContextMenu: (menu) => set({ contextMenu: menu }),
      closeContextMenu: () => set({ contextMenu: null }),

      sidebarSelection: null,
      setSidebarSelection: (selection) => set({ sidebarSelection: selection }),

      // Inline rename
      renamingId: null,
      setRenamingId: (id) => set({ renamingId: id }),

      // Sidebar state
      expandedProjects: new Set<string>(),
      expandedSessions: new Set<string>(),
      expandedGroups: new Set<string>(),
      projectTopLevelOrder: [],

      toggleProject: (id) =>
        set((state) => {
          const next = new Set(state.expandedProjects)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { expandedProjects: next }
        }),

      toggleGroup: (id) =>
        set((state) => {
          const next = new Set(state.expandedGroups)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { expandedGroups: next }
        }),

      setProjectTopLevelOrder: (order) => set({ projectTopLevelOrder: order }),

      resetSidebarLayout: () => set({
        expandedProjects: new Set<string>(),
        expandedSessions: new Set<string>(),
        expandedGroups: new Set<string>(),
        projectTopLevelOrder: [],
        sidebarCollapsed: false,
        sidebarHidden: false,
        sidebarWidth: SIDEBAR_DEFAULT,
        agentPaneHeight: AGENT_PANE_DEFAULT,
        searchQuery: '',
        searchOpen: false,
        sidebarSelection: null
      }),

      collapseProjects: (projectIds, groupIds) =>
        set((state) => {
          const nextProjects = new Set(state.expandedProjects)
          const nextGroups = new Set(state.expandedGroups)
          for (const id of projectIds) nextProjects.delete(id)
          for (const id of groupIds) nextGroups.delete(id)
          return { expandedProjects: nextProjects, expandedSessions: new Set<string>(), expandedGroups: nextGroups }
        }),

      collapseAgents: (agentGroupIds) =>
        set((state) => {
          const nextGroups = new Set(state.expandedGroups)
          for (const id of agentGroupIds) nextGroups.delete(id)
          return { expandedGroups: nextGroups }
        }),

      toggleSession: (id) =>
        set((state) => {
          const next = new Set(state.expandedSessions)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { expandedSessions: next }
        }),

      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query, ...(query ? { searchOpen: true } : {}) }),
      searchOpen: false,
      openSearch: () => set({ searchOpen: true, sidebarCollapsed: false, sidebarHidden: false }),
      closeSearch: () => set({ searchOpen: false, searchQuery: '' }),

      sidebarCollapsed: false,
      sidebarHidden: false,
      toggleSidebar: () => set((state) => {
        if (!state.sidebarCollapsed && !state.sidebarHidden) {
          // expanded → collapsed
          return { sidebarCollapsed: true, sidebarHidden: false }
        } else if (state.sidebarCollapsed && !state.sidebarHidden) {
          // collapsed → hidden
          return { sidebarCollapsed: true, sidebarHidden: true }
        } else {
          // hidden → expanded
          return { sidebarCollapsed: false, sidebarHidden: false }
        }
      }),
      toggleSidebarCollapse: () => set((state) => ({
        sidebarCollapsed: !state.sidebarCollapsed,
        sidebarHidden: false
      })),

      sidebarWidth: SIDEBAR_DEFAULT,
      setSidebarWidth: (width) => set({
        sidebarWidth: Math.max(SIDEBAR_MIN, width)
      }),
      agentPaneHeight: AGENT_PANE_DEFAULT,
      setAgentPaneHeight: (height) => set({
        agentPaneHeight: Math.max(AGENT_PANE_MIN, height)
      }),

      // Split view
      splitRoot: null,
      focusedPanelId: null,
      maximizedPanelId: null,
      focusModeSessionId: null,
      spotlightMode: false,

      splitRight: (sessionId) => {
        const state = get()
        const activeId = useSessionStore.getState().activeSessionId
        const direction = 'horizontal' as const
        syncSplitIdCounter(state.splitRoot)

        if (!state.splitRoot) {
          const leftId = nextSplitId()
          const rightId = nextSplitId()
          const branchId = nextSplitId()
          const newSessionId = activeId === sessionId ? null : sessionId
          set({
            splitRoot: {
              type: 'split', id: branchId, direction, ratio: 0.5,
              children: [
                { type: 'leaf', id: leftId, sessionId: activeId },
                { type: 'leaf', id: rightId, sessionId: newSessionId }
              ]
            },
            focusedPanelId: newSessionId === null ? rightId : leftId
          })
        } else {
          const focusedId = state.focusedPanelId
          if (!focusedId) return
          const focused = findLeaf(state.splitRoot, focusedId)
          if (!focused) return

          const newLeafId = nextSplitId()
          const branchId = nextSplitId()
          const newSessionId = focused.sessionId === sessionId ? null : sessionId
          const newBranch: SplitBranch = {
            type: 'split', id: branchId, direction, ratio: 0.5,
            children: [
              { ...focused },
              { type: 'leaf', id: newLeafId, sessionId: newSessionId }
            ]
          }
          set({
            splitRoot: replaceNode(state.splitRoot, focusedId, newBranch),
            focusedPanelId: newSessionId === null ? newLeafId : focusedId
          })
        }
      },

      splitDown: (sessionId) => {
        const state = get()
        const activeId = useSessionStore.getState().activeSessionId
        const direction = 'vertical' as const
        syncSplitIdCounter(state.splitRoot)

        if (!state.splitRoot) {
          const leftId = nextSplitId()
          const rightId = nextSplitId()
          const branchId = nextSplitId()
          const newSessionId = activeId === sessionId ? null : sessionId
          set({
            splitRoot: {
              type: 'split', id: branchId, direction, ratio: 0.5,
              children: [
                { type: 'leaf', id: leftId, sessionId: activeId },
                { type: 'leaf', id: rightId, sessionId: newSessionId }
              ]
            },
            focusedPanelId: newSessionId === null ? rightId : leftId
          })
        } else {
          const focusedId = state.focusedPanelId
          if (!focusedId) return
          const focused = findLeaf(state.splitRoot, focusedId)
          if (!focused) return

          const newLeafId = nextSplitId()
          const branchId = nextSplitId()
          const newSessionId = focused.sessionId === sessionId ? null : sessionId
          const newBranch: SplitBranch = {
            type: 'split', id: branchId, direction, ratio: 0.5,
            children: [
              { ...focused },
              { type: 'leaf', id: newLeafId, sessionId: newSessionId }
            ]
          }
          set({
            splitRoot: replaceNode(state.splitRoot, focusedId, newBranch),
            focusedPanelId: newSessionId === null ? newLeafId : focusedId
          })
        }
      },

      closePanel: (panelId) => {
        const state = get()
        if (!state.splitRoot) return
        const panel = findLeaf(state.splitRoot, panelId)
        const clearFocusMode = panel?.sessionId && state.focusModeSessionId === panel.sessionId ? null : state.focusModeSessionId

        const clearMaximized = state.maximizedPanelId === panelId ? null : state.maximizedPanelId
        const result = removeLeaf(state.splitRoot, panelId)
        if (!result || result.type === 'leaf') {
          set({ splitRoot: null, focusedPanelId: null, maximizedPanelId: null, focusModeSessionId: clearFocusMode })
          if (result && result.type === 'leaf' && result.sessionId) {
            useSessionStore.setState({ activeSessionId: result.sessionId })
          }
        } else {
          const newFocused = state.focusedPanelId === panelId
            ? getFirstLeaf(result).id
            : state.focusedPanelId
          set({ splitRoot: result, focusedPanelId: newFocused, maximizedPanelId: clearMaximized, focusModeSessionId: clearFocusMode })
        }
      },

      closeSplit: () => set({ splitRoot: null, focusedPanelId: null, maximizedPanelId: null }),

      setSplitRatio: (nodeId, ratio) => {
        const state = get()
        if (!state.splitRoot) return
        set({ splitRoot: updateNodeRatio(state.splitRoot, nodeId, ratio) })
      },

      setFocusedPanel: (panelId) => set({ focusedPanelId: panelId }),

      setPanelSession: (panelId, sessionId) => {
        const state = get()
        if (!state.splitRoot) return
        set({ splitRoot: assignLeafSession(state.splitRoot, panelId, sessionId) })
      },

      toggleMaximizePanel: (panelId) => {
        const state = get()
        set({
          maximizedPanelId: state.maximizedPanelId === panelId ? null : panelId
        })
      },

      unmaximizePanel: () => set({ maximizedPanelId: null }),
      toggleSpotlightMode: () => set((state) => ({ spotlightMode: !state.spotlightMode })),
      setSpotlightMode: (enabled) => set({ spotlightMode: enabled }),
      enterFocusMode: (sessionId) => set({ focusModeSessionId: sessionId, maximizedPanelId: null }),
      exitFocusMode: () => set({ focusModeSessionId: null }),

      remoteSessionIds: new Set(),
      setRemoteSessionIds: (ids) => set((state) => {
        const next = new Set(ids)
        if (state.remoteSessionIds.size === next.size) {
          let unchanged = true
          for (const id of next) {
            if (!state.remoteSessionIds.has(id)) {
              unchanged = false
              break
            }
          }
          if (unchanged) return state
        }
        return { remoteSessionIds: next }
      }),

      poppedOutSessionIds: new Set(),
      addPoppedOut: (id) => set((state) => {
        const next = new Set(state.poppedOutSessionIds)
        next.add(id)
        return { poppedOutSessionIds: next }
      }),
      removePoppedOut: (id) => set((state) => {
        const next = new Set(state.poppedOutSessionIds)
        next.delete(id)
        return { poppedOutSessionIds: next }
      }),

      showProviderBadges: true,
      setShowProviderBadges: (v) => set({ showProviderBadges: v }),
      showFeedbackIcon: true,
      setShowFeedbackIcon: (v) => set({ showFeedbackIcon: v })
    }),
    {
      name: 'sorcerer-ui-store',
      storage: setStorage,
      partialize: (state) => ({
        expandedProjects: state.expandedProjects,
        expandedSessions: state.expandedSessions,
        expandedGroups: state.expandedGroups,
        projectTopLevelOrder: state.projectTopLevelOrder,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        agentPaneHeight: state.agentPaneHeight,
        showProviderBadges: state.showProviderBadges,
        showFeedbackIcon: state.showFeedbackIcon,
        sidebarSelection: state.sidebarSelection,
        splitRoot: state.splitRoot,
        focusedPanelId: state.focusedPanelId,
        maximizedPanelId: state.maximizedPanelId,
        spotlightMode: state.spotlightMode,
        poppedOutSessionIds: state.poppedOutSessionIds
      })
    }
  )
)
