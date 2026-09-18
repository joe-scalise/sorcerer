import { create } from 'zustand'
import type { Project, ProjectGroup } from '../types'
import { getApi } from '../api/client'

interface ProjectState {
  projects: Project[]
  groups: ProjectGroup[]
  activeProjectId: string | null
  loading: boolean

  loadProjects: () => Promise<void>
  addProject: () => Promise<Project | null>
  addProjectByPath: (path: string, name?: string) => Promise<Project | null>
  removeProject: (id: string) => Promise<void>
  updateProject: (id: string, updates: { name?: string; setup_script?: string | null; group_id?: string | null }) => Promise<void>
  reorderProjects: (projectIds: string[]) => Promise<void>
  setActiveProject: (id: string | null) => void

  loadGroups: () => Promise<void>
  addGroup: (name: string) => Promise<ProjectGroup | null>
  updateGroup: (id: string, updates: { name?: string }) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  reorderGroups: (groupIds: string[]) => Promise<void>
  moveProjectToGroup: (projectId: string, groupId: string | null) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  groups: [],
  activeProjectId: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    try {
      const projects = await getApi().project.list()
      set({ projects, loading: false })
    } catch (err) {
      console.error('[project-store] loadProjects failed:', err)
      set({ loading: false })
    }
  },

  addProject: async () => {
    try {
      const project = await getApi().project.add()
      if (!project) return null
      set((state) => ({ projects: [project, ...state.projects] }))
      return project
    } catch (err) {
      console.error('[project-store] addProject failed:', err)
      return null
    }
  },

  addProjectByPath: async (path: string, name?: string) => {
    try {
      const project = await getApi().project.addPath(path, name)
      if (!project) return null
      set((state) => ({ projects: [project, ...state.projects] }))
      return project
    } catch (err) {
      console.error('[project-store] addProjectByPath failed:', err)
      return null
    }
  },

  removeProject: async (id: string) => {
    try {
      await getApi().project.remove(id)
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId
      }))
    } catch (err) {
      console.error('[project-store] removeProject failed:', err)
      throw err
    }
  },

  updateProject: async (id, updates) => {
    try {
      await getApi().project.update(id, updates)
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        )
      }))
    } catch (err) {
      console.error('[project-store] updateProject failed:', err)
    }
  },

  reorderProjects: async (projectIds: string[]) => {
    // Optimistically reorder in store
    set((state) => {
      const projectMap = new Map(state.projects.map((p) => [p.id, p]))
      const reordered = projectIds.map((id) => projectMap.get(id)!).filter(Boolean)
      return { projects: reordered }
    })
    try {
      await getApi().project.reorder(projectIds)
    } catch (err) {
      console.error('[project-store] reorderProjects failed:', err)
    }
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  // Group operations
  loadGroups: async () => {
    try {
      const groups = await getApi().projectGroup.list()
      set({ groups })
    } catch (err) {
      console.error('[project-store] loadGroups failed:', err)
    }
  },

  addGroup: async (name: string) => {
    try {
      const group = await getApi().projectGroup.add(name)
      if (!group) return null
      set((state) => ({ groups: [...state.groups, group] }))
      return group
    } catch (err) {
      console.error('[project-store] addGroup failed:', err)
      return null
    }
  },

  updateGroup: async (id: string, updates: { name?: string }) => {
    try {
      await getApi().projectGroup.update(id, updates)
      set((state) => ({
        groups: state.groups.map((g) =>
          g.id === id ? { ...g, ...updates } : g
        )
      }))
    } catch (err) {
      console.error('[project-store] updateGroup failed:', err)
    }
  },

  removeGroup: async (id: string) => {
    try {
      await getApi().projectGroup.remove(id)
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        // Ungroup projects that were in this group
        projects: state.projects.map((p) =>
          p.group_id === id ? { ...p, group_id: null } : p
        )
      }))
    } catch (err) {
      console.error('[project-store] removeGroup failed:', err)
    }
  },

  reorderGroups: async (groupIds: string[]) => {
    set((state) => {
      const groupMap = new Map(state.groups.map((g) => [g.id, g]))
      const reordered = groupIds.map((id) => groupMap.get(id)!).filter(Boolean)
      return { groups: reordered }
    })
    try {
      await getApi().projectGroup.reorder(groupIds)
    } catch (err) {
      console.error('[project-store] reorderGroups failed:', err)
    }
  },

  moveProjectToGroup: async (projectId: string, groupId: string | null) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, group_id: groupId } : p
      )
    }))
    try {
      await getApi().project.update(projectId, { group_id: groupId })
    } catch (err) {
      console.error('[project-store] moveProjectToGroup failed:', err)
    }
  }
}))
