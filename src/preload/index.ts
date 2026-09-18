import { contextBridge, ipcRenderer } from 'electron'

export interface RemoteStatus {
  running: boolean
  port: string
  bindAddress: string
  advertisedHost: string
  token: string
}

export interface RemotePairingCode {
  code: string
  expiresAt: number
  protocolVersion: number
  scheme: 'http'
  host: string
  port: number
  deepLink: string
}

export interface PairedDevice {
  id: string
  name: string
  scopes: string[]
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

const api = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    add: () => ipcRenderer.invoke('project:add'),
    addPath: (path: string, name?: string) => ipcRenderer.invoke('project:addPath', path, name),
    update: (id: string, updates: any) => ipcRenderer.invoke('project:update', id, updates),
    reorder: (projectIds: string[]) => ipcRenderer.invoke('project:reorder', projectIds),
    remove: (id: string) => ipcRenderer.invoke('project:remove', id),
    gitStatus: (projectPath: string) => ipcRenderer.invoke('project:git-status', projectPath),
    syncWorktrees: (projectId: string) => ipcRenderer.invoke('project:sync-worktrees', projectId),
    checkGit: (projectId: string) => ipcRenderer.invoke('project:check-git', projectId) as Promise<{ hasGit: boolean; hasCommits: boolean }>
  },

  projectGroup: {
    list: () => ipcRenderer.invoke('project-group:list'),
    add: (name: string) => ipcRenderer.invoke('project-group:add', name),
    update: (id: string, updates: { name?: string }) => ipcRenderer.invoke('project-group:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('project-group:remove', id),
    reorder: (groupIds: string[]) => ipcRenderer.invoke('project-group:reorder', groupIds)
  },

  session: {
    list: (projectId?: string) => ipcRenderer.invoke('session:list', projectId),
    create: (projectId: string, name: string, useMainRepo?: boolean, bypassPermissions?: boolean, remoteControl?: boolean, provider?: string, model?: string) => ipcRenderer.invoke('session:create', projectId, name, useMainRepo, bypassPermissions, remoteControl, provider, model),
    scanImports: (projectId?: string) => ipcRenderer.invoke('session:scan-imports', projectId),
    import: (candidateIds: string[]) => ipcRenderer.invoke('session:import', candidateIds),
    spawnShell: (sessionId: string, cwd: string) => ipcRenderer.invoke('session:spawn-shell', sessionId, cwd),
    kill: (sessionId: string) => ipcRenderer.invoke('session:kill', sessionId),
    archive: (sessionId: string) => ipcRenderer.invoke('session:archive', sessionId),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    restart: (sessionId: string) => ipcRenderer.invoke('session:restart', sessionId),
    resume: (sessionId: string) => ipcRenderer.invoke('session:resume', sessionId),
    resumeHealth: (sessionId: string) => ipcRenderer.invoke('session:resume-health', sessionId) as Promise<{
      canResume: boolean
      level: 'ok' | 'warning'
      reason: string | null
      guidance: string[]
    }>,
    diagnostics: (sessionId: string) => ipcRenderer.invoke('session:diagnostics', sessionId) as Promise<{
      sessionId: string
      provider: string
      providerThreadId: string | null
      providerThreadLabel: string
      providerThreadSource: string | null
      resumeStatus: string | null
      resumeReason: string | null
      worktreePath: string | null
      lastOutputTail: string | null
      lastExitCode: number | null
      lastExitedAt: number | null
    } | null>,
    listProviderSubAgents: (sessionId: string) => ipcRenderer.invoke('session:list-provider-subagents', sessionId) as Promise<Array<{
      threadId: string
      parentThreadId: string
      nickname: string | null
      role: string | null
      title: string
      status: string
      updatedAt: number | null
      createdAt: number | null
      depth: number
    }>>,
    setTeam: (sessionId: string, teamName: string | null) => ipcRenderer.invoke('session:set-team', sessionId, teamName),
    gitStatus: (sessionId: string) => ipcRenderer.invoke('session:git-status', sessionId),
    divergence: (sessionId: string) => ipcRenderer.invoke('session:divergence', sessionId) as Promise<{ behind: number; ahead: number } | null>,
    checkDeleteSafety: (sessionId: string) => ipcRenderer.invoke('session:check-delete-safety', sessionId),
    pushBranch: (sessionId: string) => ipcRenderer.invoke('session:push-branch', sessionId),
    openRemote: (sessionId: string) => ipcRenderer.invoke('session:open-remote', sessionId),
    restore: (sessionId: string) => ipcRenderer.invoke('session:restore', sessionId),
    createQuickTerminal: (sourceSessionId: string) => ipcRenderer.invoke('session:create-quick-terminal', sourceSessionId),
    createProjectQuickTerminal: (projectId: string) => ipcRenderer.invoke('session:create-project-quick-terminal', projectId),
    rename: (sessionId: string, name: string) => ipcRenderer.invoke('session:rename', sessionId, name),
    landOnMain: (sessionId: string) => ipcRenderer.invoke('session:land-on-main', sessionId),
    setRemoteControl: (sessionId: string, enabled: boolean) => ipcRenderer.invoke('session:set-remote-control', sessionId, enabled),
    hasConversation: (sessionId: string) => ipcRenderer.invoke('session:has-conversation', sessionId) as Promise<boolean>
  },

  agentGroup: {
    list: () => ipcRenderer.invoke('agent-group:list'),
    add: (name: string) => ipcRenderer.invoke('agent-group:add', name),
    update: (id: string, updates: { name?: string }) => ipcRenderer.invoke('agent-group:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('agent-group:remove', id),
    reorder: (groupIds: string[]) => ipcRenderer.invoke('agent-group:reorder', groupIds)
  },

  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    add: (data: {
      id?: string; name: string; description?: string; system_prompt?: string; mcp_config?: string;
      bypass_permissions?: boolean; remote_control?: boolean;
      mission?: string; auto_start?: boolean; auto_restart?: boolean; restart_delay?: number; max_restarts?: number; schedule_minutes?: number;
      provider?: string; model?: string
    }) => ipcRenderer.invoke('agent:add', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('agent:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('agent:remove', id),
    start: (id: string) => ipcRenderer.invoke('agent:start', id),
    resume: (id: string) => ipcRenderer.invoke('agent:resume', id),
    restart: (id: string) => ipcRenderer.invoke('agent:restart', id),
    kill: (id: string) => ipcRenderer.invoke('agent:kill', id),
    createQuickTerminal: (agentId: string) => ipcRenderer.invoke('agent:create-quick-terminal', agentId),
    setRemoteControl: (agentId: string, enabled: boolean) => ipcRenderer.invoke('agent:set-remote-control', agentId, enabled),
    hasConversation: (agentId: string) => ipcRenderer.invoke('agent:has-conversation', agentId) as Promise<boolean>,
    listRuns: (agentId: string, limit?: number) => ipcRenderer.invoke('agent:list-runs', agentId, limit) as Promise<any[]>,
    latestRun: (agentId: string) => ipcRenderer.invoke('agent:latest-run', agentId) as Promise<any>
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
    },
    onResumeFailed: (callback: (data: { sessionId: string; reason: string }) => void) => {
      const handler = (_event: any, data: { sessionId: string; reason: string }) => callback(data)
      ipcRenderer.on('session:resume-failed', handler)
      return () => ipcRenderer.removeListener('session:resume-failed', handler)
    },
    onAgentRestarted: (callback: (sessionId: string, status: string, pid: number | null) => void) => {
      const handler = (_event: any, sessionId: string, status: string, pid: number | null) => callback(sessionId, status, pid)
      ipcRenderer.on('agent:restarted', handler)
      return () => ipcRenderer.removeListener('agent:restarted', handler)
    },
    onAgentRunComplete: (callback: (agentId: string, agentName: string, preview: string, level: string) => void) => {
      const handler = (_event: any, agentId: string, agentName: string, preview: string, level: string) => callback(agentId, agentName, preview, level)
      ipcRenderer.on('agent:run-complete', handler)
      return () => ipcRenderer.removeListener('agent:run-complete', handler)
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

  workspace: {
    scanOrphans: () => ipcRenderer.invoke('workspace:scan-orphans'),
    dismissOrphan: (dirName: string) => ipcRenderer.invoke('workspace:dismiss-orphan', dirName),
    deleteOrphan: (dirName: string) => ipcRenderer.invoke('workspace:delete-orphan', dirName),
    scanOrphanAgents: () => ipcRenderer.invoke('workspace:scan-orphan-agents'),
    dismissOrphanAgent: (dirName: string) => ipcRenderer.invoke('workspace:dismiss-orphan-agent', dirName),
    deleteOrphanAgent: (dirName: string) => ipcRenderer.invoke('workspace:delete-orphan-agent', dirName)
  },

  quickNotes: {
    load: (parentId: string, parentType: string) => ipcRenderer.invoke('quick-notes:load', parentId, parentType),
    save: (id: string, parentId: string, parentType: string, content: string) => ipcRenderer.invoke('quick-notes:save', id, parentId, parentType, content),
    delete: (parentId: string, parentType: string) => ipcRenderer.invoke('quick-notes:delete', parentId, parentType),
    listParents: () => ipcRenderer.invoke('quick-notes:list-parents') as Promise<{ parent_id: string; parent_type: string }[]>,
  },

  briefing: {
    generate: () => ipcRenderer.invoke('briefing:generate') as Promise<{ text: string; provider: string; model: string; error?: string }>,
    list: (limit?: number) => ipcRenderer.invoke('briefing:list', limit) as Promise<any[]>,
    delete: (id: string) => ipcRenderer.invoke('briefing:delete', id)
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },

  providers: {
    list: () => ipcRenderer.invoke('provider:list'),
    refresh: () => ipcRenderer.invoke('provider:refresh'),
    onUpdated: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('providers:updated', handler)
      return () => ipcRenderer.removeListener('providers:updated', handler)
    }
  },

  system: {
    checkUpdate: () => ipcRenderer.invoke('system:check-update') as Promise<{ version: string; url: string } | null>,
    claudeStats: () => ipcRenderer.invoke('system:claude-stats') as Promise<{
      today: { messages: number; sessions: number; toolCalls: number; tokens: number }
      week: { messages: number; toolCalls: number; tokens: number }
      allTime: { totalSessions: number; totalMessages: number; firstSessionDate: string | null }
      subscription: string
      rateLimitTier: string
    } | null>,
    userInfo: () => ipcRenderer.invoke('system:userInfo'),
    accountPicture: () => ipcRenderer.invoke('system:accountPicture'),
    networkIp: () => ipcRenderer.invoke('system:networkIp') as Promise<string>,
    workspacesRoot: () => ipcRenderer.invoke('system:workspaces-root') as Promise<string>,
    pickPath: (options?: {
      title?: string
      mode?: 'file' | 'directory'
      filters?: Array<{ name: string; extensions: string[] }>
    }) => ipcRenderer.invoke('system:pick-path', options) as Promise<string | null>,
    memoryUsage: () => ipcRenderer.invoke('system:memoryUsage') as Promise<{
      totalMB: number
      breakdown: { type: string; pid: number; mb: number }[]
      processCount: number
    }>,
    platform: process.platform,
    onRateLimits: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('rate-limits:updated', handler)
      return () => ipcRenderer.removeListener('rate-limits:updated', handler)
    }
  },

  remote: {
    status: () => ipcRenderer.invoke('remote:status') as Promise<RemoteStatus>,
    enable: () => ipcRenderer.invoke('remote:enable') as Promise<{ port: number; bindAddress: string; token: string }>,
    disable: () => ipcRenderer.invoke('remote:disable') as Promise<void>,
    regenerateToken: () => ipcRenderer.invoke('remote:regenerate-token') as Promise<string>,
    updateConfig: (config: { port?: number; bindAddress?: string; advertisedHost?: string }) =>
      ipcRenderer.invoke('remote:update-config', config) as Promise<void>,
    createPairingCode: (advertisedHost?: string) =>
      ipcRenderer.invoke('remote:create-pairing-code', advertisedHost) as Promise<RemotePairingCode>,
    listPairedDevices: () =>
      ipcRenderer.invoke('remote:list-paired-devices') as Promise<PairedDevice[]>,
    revokePairedDevice: (deviceId: string) =>
      ipcRenderer.invoke('remote:revoke-paired-device', deviceId) as Promise<boolean>,
    remoteSessionIds: () =>
      ipcRenderer.invoke('remote:remoteSessionIds') as Promise<string[]>
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setTitleBarOverlay: (options: { color: string; symbolColor: string }) => ipcRenderer.send('window:setTitleBarOverlay', options),
    openExternal: (url: string) => ipcRenderer.invoke('window:openExternal', url),
    openPath: (p: string) => ipcRenderer.invoke('window:openPath', p)
  },

  popout: {
    open: (panelType: string, panelId: string, entityName: string) =>
      ipcRenderer.invoke('popout:open', panelType, panelId, entityName) as Promise<{ opened: boolean; windowId: string }>,
    close: (panelId: string) =>
      ipcRenderer.invoke('popout:close', panelId) as Promise<{ closed: boolean }>,
    isOpen: (panelId: string) =>
      ipcRenderer.invoke('popout:isOpen', panelId) as Promise<boolean>,
    getScrollback: (sessionId: string) =>
      ipcRenderer.invoke('popout:getScrollback', sessionId) as Promise<string>,
    getEntities: (panelIds: string[]) =>
      ipcRenderer.invoke('popout:getEntities', panelIds) as Promise<{
        sessions: any[]
        agents: any[]
        projects: any[]
      }>,
    syncPanels: (windowId: string, panelIds: string[]) =>
      ipcRenderer.invoke('popout:syncPanels', windowId, panelIds) as Promise<{ added: string[]; removed: string[] }>,
    setSelectionTargetReady: (windowId: string, ready: boolean) =>
      ipcRenderer.invoke('popout:setSelectionTargetReady', windowId, ready) as Promise<{ ok: boolean }>,
    assignToSelectionTarget: (panelId: string) =>
      ipcRenderer.invoke('popout:assignToSelectionTarget', panelId) as Promise<boolean>,
    broadcastTheme: (themeId: string) =>
      ipcRenderer.send('popout:broadcastTheme', themeId),
    onOpened: (callback: (panelId: string) => void) => {
      const handler = (_event: any, panelId: string) => callback(panelId)
      ipcRenderer.on('popout:opened', handler)
      return () => ipcRenderer.removeListener('popout:opened', handler)
    },
    onClosed: (callback: (panelId: string) => void) => {
      const handler = (_event: any, panelId: string) => callback(panelId)
      ipcRenderer.on('popout:closed', handler)
      return () => ipcRenderer.removeListener('popout:closed', handler)
    },
    onThemeUpdate: (callback: (themeId: string) => void) => {
      const handler = (_event: any, themeId: string) => callback(themeId)
      ipcRenderer.on('popout:theme-update', handler)
      return () => ipcRenderer.removeListener('popout:theme-update', handler)
    },
    notifySessionUpdated: (sessionId: string, status: string, pid: number | null) =>
      ipcRenderer.send('popout:sessionUpdated', sessionId, status, pid),
    onSessionUpdated: (callback: (sessionId: string, status: string, pid: number | null) => void) => {
      const handler = (_event: any, sessionId: string, status: string, pid: number | null) => callback(sessionId, status, pid)
      ipcRenderer.on('popout:sessionUpdated', handler)
      return () => ipcRenderer.removeListener('popout:sessionUpdated', handler)
    },
    onAssignPanel: (callback: (panelId: string) => void) => {
      const handler = (_event: any, panelId: string) => callback(panelId)
      ipcRenderer.on('popout:assign-panel', handler)
      return () => ipcRenderer.removeListener('popout:assign-panel', handler)
    }
  }
}

contextBridge.exposeInMainWorld('sorcerer', api)

export type SorcererAPI = typeof api
