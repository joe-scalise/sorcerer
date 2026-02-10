import { contextBridge, ipcRenderer } from 'electron'

const api = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    add: () => ipcRenderer.invoke('project:add'),
    addPath: (path: string, name?: string) => ipcRenderer.invoke('project:addPath', path, name),
    update: (id: string, updates: any) => ipcRenderer.invoke('project:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('project:remove', id),
    gitStatus: (projectPath: string) => ipcRenderer.invoke('project:git-status', projectPath)
  },

  session: {
    list: (projectId?: string) => ipcRenderer.invoke('session:list', projectId),
    create: (projectId: string, name: string) => ipcRenderer.invoke('session:create', projectId, name),
    spawnShell: (sessionId: string, cwd: string) => ipcRenderer.invoke('session:spawn-shell', sessionId, cwd),
    kill: (sessionId: string) => ipcRenderer.invoke('session:kill', sessionId),
    archive: (sessionId: string) => ipcRenderer.invoke('session:archive', sessionId),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    restart: (sessionId: string) => ipcRenderer.invoke('session:restart', sessionId),
    resume: (sessionId: string) => ipcRenderer.invoke('session:resume', sessionId),
    setTeam: (sessionId: string, teamName: string | null) => ipcRenderer.invoke('session:set-team', sessionId, teamName),
    gitStatus: (sessionId: string) => ipcRenderer.invoke('session:git-status', sessionId),
    checkDeleteSafety: (sessionId: string) => ipcRenderer.invoke('session:check-delete-safety', sessionId),
    pushBranch: (sessionId: string) => ipcRenderer.invoke('session:push-branch', sessionId),
    openRemote: (sessionId: string) => ipcRenderer.invoke('session:open-remote', sessionId),
    restore: (sessionId: string) => ipcRenderer.invoke('session:restore', sessionId),
    landOnMain: (sessionId: string) => ipcRenderer.invoke('session:land-on-main', sessionId)
  },

  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    add: (data: { name: string; description?: string; system_prompt?: string; mcp_config?: string }) =>
      ipcRenderer.invoke('agent:add', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('agent:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('agent:remove', id),
    start: (id: string) => ipcRenderer.invoke('agent:start', id),
    resume: (id: string) => ipcRenderer.invoke('agent:resume', id),
    restart: (id: string) => ipcRenderer.invoke('agent:restart', id),
    kill: (id: string) => ipcRenderer.invoke('agent:kill', id),
  },

  terminal: {
    write: (sessionId: string, data: string) => {
      ipcRenderer.send('terminal:write', sessionId, data)
    },
    resize: (sessionId: string, cols: number, rows: number) => {
      ipcRenderer.send('terminal:resize', sessionId, cols, rows)
    },
    onData: (sessionId: string, callback: (data: string) => void) => {
      const handler = (_event: any, data: string) => callback(data)
      ipcRenderer.on(`terminal:data:${sessionId}`, handler)
      return () => ipcRenderer.removeListener(`terminal:data:${sessionId}`, handler)
    },
    onExit: (sessionId: string, callback: (exitCode: number) => void) => {
      const handler = (_event: any, exitCode: number) => callback(exitCode)
      ipcRenderer.on(`terminal:exit:${sessionId}`, handler)
      return () => ipcRenderer.removeListener(`terminal:exit:${sessionId}`, handler)
    }
  },

  teams: {
    list: () => ipcRenderer.invoke('teams:list'),
    getTasks: (teamName: string) => ipcRenderer.invoke('teams:tasks', teamName),
    getInbox: (teamName: string, agentName: string) => ipcRenderer.invoke('teams:inbox', teamName, agentName),
    onUpdate: (callback: (data: any) => void) => {
      const teamsHandler = (_event: any, data: any) => callback({ type: 'teams', ...data })
      const tasksHandler = (_event: any, data: any) => callback({ type: 'tasks', ...data })
      ipcRenderer.on('filewatcher:teams-update', teamsHandler)
      ipcRenderer.on('filewatcher:tasks-update', tasksHandler)
      return () => {
        ipcRenderer.removeListener('filewatcher:teams-update', teamsHandler)
        ipcRenderer.removeListener('filewatcher:tasks-update', tasksHandler)
      }
    },
    onSessionLinked: (callback: (data: { sessionId: string; teamName: string | null }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('filewatcher:session-linked', handler)
      return () => ipcRenderer.removeListener('filewatcher:session-linked', handler)
    }
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  }
}

contextBridge.exposeInMainWorld('sorcerer', api)

export type SorcererAPI = typeof api
