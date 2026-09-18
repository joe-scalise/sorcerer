import type { SorcererAPI } from '../../../preload/index'

/**
 * Multiplexed WebSocket for streaming channels (terminal I/O, file-watcher events).
 *
 * Protocol: JSON frames with shape { channel, ...payload }
 * Channels:
 *   "terminal:data:<sessionId>"  -> { data: string }
 *   "terminal:exit:<sessionId>"  -> { exitCode: number }
 *   "filewatcher:teams-update"   -> forwarded payload
 *   "filewatcher:tasks-update"   -> forwarded payload
 *   "filewatcher:session-linked" -> { sessionId, teamName }
 */
class RemoteWebSocket {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<(payload: any) => void>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private baseUrl: string
  private token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
  }

  private ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(this.token)
    this.ws = new WebSocket(wsUrl)

    this.ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data)
        const channel: string = frame.channel
        if (!channel) return
        const handlers = this.listeners.get(channel)
        if (handlers) {
          for (const handler of handlers) {
            handler(frame)
          }
        }
      } catch {
        // Ignore malformed frames
      }
    }

    this.ws.onclose = () => {
      // Attempt reconnect if there are active listeners
      if (this.listeners.size > 0 && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.ensureConnected()
        }, 3000)
      }
    }

    this.ws.onerror = () => {
      // Will trigger onclose
    }
  }

  subscribe(channel: string, callback: (payload: any) => void): () => void {
    this.ensureConnected()

    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(callback)

    // Send subscribe message so the server knows what to forward
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', channel }))
    } else if (this.ws) {
      const onOpen = () => {
        this.ws?.send(JSON.stringify({ action: 'subscribe', channel }))
        this.ws?.removeEventListener('open', onOpen)
      }
      this.ws.addEventListener('open', onOpen)
    }

    return () => {
      const set = this.listeners.get(channel)
      if (set) {
        set.delete(callback)
        if (set.size === 0) {
          this.listeners.delete(channel)
          // Unsubscribe on the server
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action: 'unsubscribe', channel }))
          }
        }
      }
      // Close socket if no listeners remain
      if (this.listeners.size === 0 && this.ws) {
        this.ws.close()
        this.ws = null
      }
    }
  }

  /** Send a message to the server (for terminal write / resize) */
  send(message: Record<string, unknown>): void {
    this.ensureConnected()
    const doSend = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message))
      }
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      doSend()
    } else if (this.ws) {
      this.ws.addEventListener('open', doSend, { once: true })
    }
  }
}

/**
 * Create a remote SorcererAPI client that talks to the server over HTTP + WebSocket.
 */
export function createRemoteClient(baseUrl: string, token: string): SorcererAPI {
  // Normalize: strip trailing slash
  const base = baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  }

  const ws = new RemoteWebSocket(base, token)

  async function rpc<T = any>(method: string, ...args: any[]): Promise<T> {
    const res = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Remote API error (${res.status}): ${body}`)
    }
    const json = await res.json()
    return json.result
  }

  return {
    project: {
      list: () => rpc('project:list'),
      add: () => {
        throw new Error('Use addPath for remote clients — native file dialog is not available.')
      },
      addPath: (path: string, name?: string) => rpc('project:addPath', path, name),
      update: (id: string, updates: any) => rpc('project:update', id, updates),
      remove: (id: string) => rpc('project:remove', id),
      reorder: (projectIds: string[]) => rpc('project:reorder', projectIds),
      gitStatus: (projectPath: string) => rpc('project:git-status', projectPath),
      syncWorktrees: (projectId: string) => rpc('project:sync-worktrees', projectId)
    },

    projectGroup: {
      list: () => rpc('project-group:list'),
      add: (name: string) => rpc('project-group:add', name),
      update: (id: string, updates: { name?: string }) => rpc('project-group:update', id, updates),
      remove: (id: string) => rpc('project-group:remove', id),
      reorder: (groupIds: string[]) => rpc('project-group:reorder', groupIds)
    },

    workspace: {
      scanOrphans: async () => [],
      dismissOrphan: async () => {},
      scanOrphanAgents: async () => [],
      dismissOrphanAgent: async () => {}
    },

    session: {
      list: (projectId?: string) => rpc('session:list', projectId),
      create: (projectId: string, name: string, useMainRepo?: boolean, bypassPermissions?: boolean, remoteControl?: boolean, provider?: string, model?: string) =>
        rpc('session:create', projectId, name, useMainRepo, bypassPermissions, remoteControl, provider, model),
      scanImports: (projectId?: string) => rpc('session:scan-imports', projectId),
      import: (candidateIds: string[]) => rpc('session:import', candidateIds),
      spawnShell: (sessionId: string, cwd: string) => rpc('session:spawn-shell', sessionId, cwd),
      kill: (sessionId: string) => rpc('session:kill', sessionId),
      archive: (sessionId: string) => rpc('session:archive', sessionId),
      delete: (sessionId: string) => rpc('session:delete', sessionId),
      restart: (sessionId: string) => rpc('session:restart', sessionId),
      resume: (sessionId: string) => rpc('session:resume', sessionId),
      resumeHealth: (sessionId: string) => rpc('session:resume-health', sessionId),
      diagnostics: (sessionId: string) => rpc('session:diagnostics', sessionId),
      listProviderSubAgents: (sessionId: string) => rpc('session:list-provider-subagents', sessionId),
      setTeam: (sessionId: string, teamName: string | null) => rpc('session:set-team', sessionId, teamName),
      gitStatus: (sessionId: string) => rpc('session:git-status', sessionId),
      checkDeleteSafety: (sessionId: string) => rpc('session:check-delete-safety', sessionId),
      pushBranch: (sessionId: string) => rpc('session:push-branch', sessionId),
      openRemote: (sessionId: string) => rpc('session:open-remote', sessionId),
      restore: (sessionId: string) => rpc('session:restore', sessionId),
      createQuickTerminal: (sourceSessionId: string) => rpc('session:create-quick-terminal', sourceSessionId),
      rename: (sessionId: string, name: string) => rpc('session:rename', sessionId, name),
      landOnMain: (sessionId: string) => rpc('session:land-on-main', sessionId),
      setRemoteControl: (sessionId: string, enabled: boolean) => rpc('session:set-remote-control', sessionId, enabled),
      divergence: async () => null,
      hasConversation: (sessionId: string) => rpc('session:has-conversation', sessionId)
    },

    providers: {
      list: () => rpc('provider:list'),
      refresh: () => rpc('provider:refresh'),
      onUpdated: () => () => {}
    },

    agentGroup: {
      list: () => rpc('agent-group:list'),
      add: (name: string) => rpc('agent-group:add', name),
      update: (id: string, updates: { name?: string }) => rpc('agent-group:update', id, updates),
      remove: (id: string) => rpc('agent-group:remove', id),
      reorder: (groupIds: string[]) => rpc('agent-group:reorder', groupIds)
    },

    agent: {
      list: () => rpc('agent:list'),
      add: (data: {
        id?: string; name: string; description?: string; system_prompt?: string; mcp_config?: string;
        bypass_permissions?: boolean; remote_control?: boolean;
        mission?: string; auto_start?: boolean; auto_restart?: boolean; restart_delay?: number; max_restarts?: number; schedule_minutes?: number;
        provider?: string; model?: string
      }) =>
        rpc('agent:add', data),
      update: (id: string, updates: any) => rpc('agent:update', id, updates),
      remove: (id: string) => rpc('agent:remove', id),
      start: (id: string) => rpc('agent:start', id),
      resume: (id: string) => rpc('agent:resume', id),
      restart: (id: string) => rpc('agent:restart', id),
      kill: (id: string) => rpc('agent:kill', id),
      createQuickTerminal: (agentId: string) => rpc('agent:create-quick-terminal', agentId),
      setRemoteControl: (agentId: string, enabled: boolean) => rpc('agent:set-remote-control', agentId, enabled),
      hasConversation: (agentId: string) => rpc('agent:has-conversation', agentId)
    },

    terminal: {
      write: (sessionId: string, data: string) => {
        ws.send({ action: 'terminal:write', sessionId, data })
      },
      resize: (sessionId: string, cols: number, rows: number) => {
        ws.send({ action: 'terminal:resize', sessionId, cols, rows })
      },
      onData: (sessionId: string, callback: (data: string) => void) => {
        return ws.subscribe(`terminal:data:${sessionId}`, (payload) => {
          callback(payload.data)
        })
      },
      onExit: (sessionId: string, callback: (exitCode: number) => void) => {
        return ws.subscribe(`terminal:exit:${sessionId}`, (payload) => {
          callback(payload.exitCode)
        })
      },
      onResumeFailed: () => () => {}
    },

    teams: {
      list: () => rpc('teams:list'),
      getTasks: (teamName: string) => rpc('teams:tasks', teamName),
      getInbox: (teamName: string, agentName: string) => rpc('teams:inbox', teamName, agentName),
      onUpdate: (callback: (data: any) => void) => {
        const unsub1 = ws.subscribe('filewatcher:teams-update', (payload) => {
          callback({ type: 'teams', ...payload })
        })
        const unsub2 = ws.subscribe('filewatcher:tasks-update', (payload) => {
          callback({ type: 'tasks', ...payload })
        })
        return () => {
          unsub1()
          unsub2()
        }
      },
      onSessionLinked: (callback: (data: { sessionId: string; teamName: string | null }) => void) => {
        return ws.subscribe('filewatcher:session-linked', (payload) => {
          callback(payload)
        })
      }
    },

    quickNotes: {
      load: (parentId: string, parentType: string) => rpc('quick-notes:load', parentId, parentType),
      save: (id: string, parentId: string, parentType: string, content: string) => rpc('quick-notes:save', id, parentId, parentType, content),
      delete: (parentId: string, parentType: string) => rpc('quick-notes:delete', parentId, parentType),
      listParents: () => rpc('quick-notes:list-parents') as Promise<{ parent_id: string; parent_type: string }[]>,
    },

    settings: {
      get: (key: string) => rpc('settings:get', key),
      set: (key: string, value: string) => rpc('settings:set', key, value)
    },

    briefing: {
      generate: () => rpc('briefing:generate'),
      list: (limit?: number) => rpc('briefing:list', limit),
      delete: (id: string) => rpc('briefing:delete', id)
    },

    system: {
      features: () => rpc('system:features'),
      userInfo: () => rpc('system:userInfo'),
      accountPicture: async () => null,
      memoryUsage: async () => ({ totalMB: 0, breakdown: [], processCount: 0 }),
      networkIp: async () => '0.0.0.0',
      checkUpdate: async () => null,
      platform: 'unknown' as string
    },

    popout: {
      open: async () => ({ opened: false }),
      close: async () => ({ closed: false }),
      isOpen: async () => false,
      getScrollback: async () => '',
      broadcastTheme: () => {},
      onOpened: () => () => {},
      onClosed: () => () => {},
      onThemeUpdate: () => () => {},
      notifySessionUpdated: () => {},
      onSessionUpdated: () => () => {}
    },

    remote: {
      status: async () => ({ running: true, port: '0', bindAddress: '0.0.0.0', token: '' }),
      enable: async () => ({ port: 0, bindAddress: '', token: '' }),
      disable: async () => {},
      regenerateToken: async () => '',
      updateConfig: async () => {}
    },

    window: {
      minimize: () => {},
      maximize: () => {},
      close: () => {},
      isMaximized: async () => false
    }
  } as any as SorcererAPI
}
