import { create } from 'zustand'
import type { Agent, AgentGroup } from '../types'
import { useUIStore, clearSessionFromTree } from './useUIStore'
import { useQuickNotesStore } from './useQuickNotesStore'
import { useQuickNotesDraftStore } from './useQuickNotesDraftStore'
import { disposeTerminal } from '../components/TerminalView'
import { getApi } from '../api/client'

interface AgentState {
  agents: Agent[]
  groups: AgentGroup[]
  loading: boolean

  loadAgents: () => Promise<void>
  addAgent: (data: {
    id?: string; name: string; description?: string; system_prompt?: string; mcp_config?: string;
    bypass_permissions?: boolean; remote_control?: boolean;
    mission?: string; auto_start?: boolean; auto_restart?: boolean; restart_delay?: number; max_restarts?: number; schedule_minutes?: number;
    provider?: string; model?: string
  }) => Promise<string | null>
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>
  removeAgent: (id: string) => Promise<void>
  startAgent: (id: string) => Promise<void>
  resumeAgent: (id: string) => Promise<void>
  restartAgent: (id: string) => Promise<void>
  killAgent: (id: string) => Promise<void>
  renameAgent: (id: string, name: string) => Promise<void>
  updateAgentInStore: (id: string, updates: Partial<Agent>) => void

  loadAgentGroups: () => Promise<void>
  addAgentGroup: (name: string) => Promise<AgentGroup | null>
  updateAgentGroup: (id: string, updates: { name?: string }) => Promise<void>
  removeAgentGroup: (id: string) => Promise<void>
  reorderAgentGroups: (groupIds: string[]) => Promise<void>
  moveAgentToGroup: (agentId: string, groupId: string | null) => Promise<void>
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  groups: [],
  loading: false,

  loadAgents: async () => {
    set({ loading: true })
    try {
      const agents = await getApi().agent.list()
      set({ agents, loading: false })
    } catch (err) {
      console.error('[agent-store] loadAgents failed:', err)
      set({ loading: false })
    }
  },

  addAgent: async (data) => {
    try {
      const agent = await getApi().agent.add(data)
      if (!agent) return null
      set((state) => ({ agents: [agent, ...state.agents] }))
      return agent.id
    } catch (err) {
      console.error('[agent-store] addAgent failed:', err)
      throw err
    }
  },

  updateAgent: async (id, updates) => {
    try {
      await getApi().agent.update(id, updates)
      set((state) => ({
        agents: state.agents.map((a) => a.id === id ? { ...a, ...updates } : a)
      }))
    } catch (err) {
      console.error('[agent-store] updateAgent failed:', err)
    }
  },

  removeAgent: async (id) => {
    try {
      await getApi().agent.remove(id)

      // Clean up terminal cache
      disposeTerminal(id)

      // Clean up quick notes
      await useQuickNotesDraftStore.getState().remove(id, 'agent').catch((err) => {
        console.error('[agent-store] Notes cleanup failed:', err)
      })
      const qnState = useQuickNotesStore.getState()
      if (qnState.overlayOpen && qnState.overlayParentId === id) {
        qnState.closeOverlay()
      }
      qnState.removeNotePanel(id)
      qnState.clearSaved(id)

      // Clear from split panels
      const { splitRoot } = useUIStore.getState()
      if (splitRoot) {
        let root = clearSessionFromTree(splitRoot, id)
        root = clearSessionFromTree(root, `quicknotes:agent:${id}`)
        useUIStore.setState({ splitRoot: root })
      }

      set((state) => ({ agents: state.agents.filter((a) => a.id !== id) }))
    } catch (err) {
      console.error('[agent-store] removeAgent failed:', err)
      throw err
    }
  },

  startAgent: async (id) => {
    try {
      const agent = await getApi().agent.start(id)
      if (agent) {
        set((state) => ({
          agents: state.agents.map((a) => a.id === id ? agent : a)
        }))
      }
    } catch (err) {
      console.error('[agent-store] startAgent failed:', err)
      throw err
    }
  },

  resumeAgent: async (id) => {
    try {
      disposeTerminal(id)
      const agent = await getApi().agent.resume(id)
      if (agent) {
        set((state) => ({
          agents: state.agents.map((a) => a.id === id ? agent : a)
        }))
      }
    } catch (err) {
      console.error('[agent-store] resumeAgent failed:', err)
    }
  },

  restartAgent: async (id) => {
    try {
      disposeTerminal(id)
      const agent = await getApi().agent.restart(id)
      if (agent) {
        set((state) => ({
          agents: state.agents.map((a) => a.id === id ? agent : a)
        }))
      }
    } catch (err) {
      console.error('[agent-store] restartAgent failed:', err)
    }
  },

  killAgent: async (id) => {
    try {
      await getApi().agent.kill(id)
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === id ? { ...a, status: 'idle' as const, pid: null } : a
        )
      }))
    } catch (err) {
      console.error('[agent-store] killAgent failed:', err)
    }
  },

  renameAgent: async (id, name) => {
    try {
      await getApi().agent.update(id, { name })
      set((state) => ({
        agents: state.agents.map((a) => a.id === id ? { ...a, name } : a)
      }))
    } catch (err) {
      console.error('[agent-store] renameAgent failed:', err)
    }
  },

  updateAgentInStore: (id, updates) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      )
    }))
  },

  // Agent group operations
  loadAgentGroups: async () => {
    try {
      const groups = await getApi().agentGroup.list()
      set({ groups })
    } catch (err) {
      console.error('[agent-store] loadAgentGroups failed:', err)
    }
  },

  addAgentGroup: async (name: string) => {
    try {
      const group = await getApi().agentGroup.add(name)
      if (!group) return null
      set((state) => ({ groups: [...state.groups, group] }))
      return group
    } catch (err) {
      console.error('[agent-store] addAgentGroup failed:', err)
      return null
    }
  },

  updateAgentGroup: async (id: string, updates: { name?: string }) => {
    try {
      await getApi().agentGroup.update(id, updates)
      set((state) => ({
        groups: state.groups.map((g) => g.id === id ? { ...g, ...updates } : g)
      }))
    } catch (err) {
      console.error('[agent-store] updateAgentGroup failed:', err)
    }
  },

  removeAgentGroup: async (id: string) => {
    try {
      await getApi().agentGroup.remove(id)
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        agents: state.agents.map((a) => a.group_id === id ? { ...a, group_id: null } : a)
      }))
    } catch (err) {
      console.error('[agent-store] removeAgentGroup failed:', err)
    }
  },

  reorderAgentGroups: async (groupIds: string[]) => {
    set((state) => {
      const groupMap = new Map(state.groups.map((g) => [g.id, g]))
      const reordered = groupIds.map((id) => groupMap.get(id)!).filter(Boolean)
      return { groups: reordered }
    })
    try {
      await getApi().agentGroup.reorder(groupIds)
    } catch (err) {
      console.error('[agent-store] reorderAgentGroups failed:', err)
    }
  },

  moveAgentToGroup: async (agentId: string, groupId: string | null) => {
    set((state) => ({
      agents: state.agents.map((a) => a.id === agentId ? { ...a, group_id: groupId } : a)
    }))
    try {
      await getApi().agent.update(agentId, { group_id: groupId })
    } catch (err) {
      console.error('[agent-store] moveAgentToGroup failed:', err)
    }
  }
}))
