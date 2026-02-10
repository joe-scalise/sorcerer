import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useSessionStore } from './useSessionStore'
import type { SplitNode, SplitLeaf, SplitBranch } from '../types'

type DialogType = 'new-session' | 'add-project' | 'delete-session' | 'archive-session' | 'land-session' | 'settings' | 'add-agent' | 'delete-agent' | null

interface ContextMenu {
  x: number
  y: number
  type: 'project' | 'session' | 'agent'
  targetId: string
}

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420
export const SIDEBAR_DEFAULT = 260

interface UIState {
  activeDialog: DialogType
  dialogTargetId: string | null
  dialogClosing: boolean
  openDialog: (type: DialogType, targetId?: string) => void
  closeDialog: () => void

  contextMenu: ContextMenu | null
  openContextMenu: (menu: ContextMenu) => void
  closeContextMenu: () => void

  // Inline rename
  renamingId: string | null
  setRenamingId: (id: string | null) => void

  // Sidebar state (moved from session store)
  expandedProjects: Set<string>
  expandedSessions: Set<string>
  toggleProject: (id: string) => void
  toggleSession: (id: string) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  searchQuery: string
  setSearchQuery: (query: string) => void

  // Split view (tree-based, limitless)
  splitRoot: SplitNode | null
  focusedPanelId: string | null
  splitRight: (sessionId: string) => void
  splitDown: (sessionId: string) => void
  closePanel: (panelId: string) => void
  closeSplit: () => void
  setSplitRatio: (nodeId: string, ratio: number) => void
  setFocusedPanel: (panelId: string) => void
  setPanelSession: (panelId: string, sessionId: string) => void
}

// --- Split tree helpers ---

let splitIdCounter = 0
function nextSplitId(): string { return 'sp_' + (++splitIdCounter) }

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

function updateLeafSession(node: SplitNode, leafId: string, sessionId: string): SplitNode {
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

      // Inline rename
      renamingId: null,
      setRenamingId: (id) => set({ renamingId: id }),

      // Sidebar state
      expandedProjects: new Set<string>(),
      expandedSessions: new Set<string>(),

      toggleProject: (id) =>
        set((state) => {
          const next = new Set(state.expandedProjects)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { expandedProjects: next }
        }),

      toggleSession: (id) =>
        set((state) => {
          const next = new Set(state.expandedSessions)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { expandedSessions: next }
        }),

      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      sidebarWidth: SIDEBAR_DEFAULT,
      setSidebarWidth: (width) => set({
        sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))
      }),

      // Split view
      splitRoot: null,
      focusedPanelId: null,

      splitRight: (sessionId) => {
        const state = get()
        const activeId = useSessionStore.getState().activeSessionId
        const direction = 'horizontal' as const

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

        const result = removeLeaf(state.splitRoot, panelId)
        if (!result || result.type === 'leaf') {
          set({ splitRoot: null, focusedPanelId: null })
          if (result && result.type === 'leaf' && result.sessionId) {
            useSessionStore.setState({ activeSessionId: result.sessionId })
          }
        } else {
          const newFocused = state.focusedPanelId === panelId
            ? getFirstLeaf(result).id
            : state.focusedPanelId
          set({ splitRoot: result, focusedPanelId: newFocused })
        }
      },

      closeSplit: () => set({ splitRoot: null, focusedPanelId: null }),

      setSplitRatio: (nodeId, ratio) => {
        const state = get()
        if (!state.splitRoot) return
        set({ splitRoot: updateNodeRatio(state.splitRoot, nodeId, ratio) })
      },

      setFocusedPanel: (panelId) => set({ focusedPanelId: panelId }),

      setPanelSession: (panelId, sessionId) => {
        const state = get()
        if (!state.splitRoot) return
        set({ splitRoot: updateLeafSession(state.splitRoot, panelId, sessionId) })
      }
    }),
    {
      name: 'sorcerer-ui-store',
      storage: setStorage,
      partialize: (state) => ({
        expandedProjects: state.expandedProjects,
        expandedSessions: state.expandedSessions,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth
      })
    }
  )
)
