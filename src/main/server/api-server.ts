import { FeatureDisabledError, getFeatureFlags, requireStandaloneAgents } from '../services/features'
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import { app } from 'electron'
import {
  HandlerServices,
  listProjects,
  addProjectByPath,
  updateProject,
  removeProject,
  syncWorktrees,
  getProjectGitStatus,
  listSessions,
  createSession,
  spawnShell,
  createQuickTerminal,
  renameSession,
  killSession,
  archiveSession,
  deleteSession,
  restartSession,
  resumeSession,
  getSessionResumeHealth,
  getSessionDiagnostics,
  setSessionTeam,
  pushSessionBranch,
  checkDeleteSafety,
  getSessionGitStatus,
  landOnMain,
  restoreSession,
  listAgents,
  addAgent,
  updateAgent,
  removeAgent,
  startAgent,
  resumeAgent,
  restartAgent,
  createAgentQuickTerminal,
  killAgent,
  listTeams,
  getTeamTasks,
  getTeamInbox,
  getSetting,
  setSetting,
  listProviders,
  refreshProviders,
  scanImportableSessions,
  importExternalSessions,
  getUserInfo,
  loadQuickNote,
  saveQuickNote,
  deleteQuickNote,
  listQuickNoteParents,
  setSessionRemoteControl,
  setAgentRemoteControl,
  hasClaudeConversation
} from '../ipc/shared-handlers'
import os from 'os'
import { ScrollbackBuffer } from './scrollback'
import { WebSocketHandler } from './ws-handler'
import {
  MobileAuthError,
  MobileAuthService,
  PairedDevice,
  PairingCode
} from './mobile-auth'
import {
  MOBILE_PROTOCOL_INFO,
  MOBILE_SCOPES,
  MobileRpcMethod,
  validateMobileRpcRequest
} from './mobile-contract'
// In dev, read from disk for live reloading. In production, use inlined copy.
import remoteControlHtmlInlined from './remote-control.html?raw'

// ── Config ──────────────────────────────────────────────────

export interface ApiServerConfig {
  port: number
  bindAddress: string
  authToken: string
}

// ── MIME type map for static file serving ───────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
}

export const MAX_REQUEST_BODY_BYTES = 64 * 1024

class HttpRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

const REMOTE_CONTROL_ASSETS: Record<string, string> = {
  '/rc-assets/xterm.js': path.join('@xterm', 'xterm', 'lib', 'xterm.js'),
  '/rc-assets/xterm.css': path.join('@xterm', 'xterm', 'css', 'xterm.css'),
  '/rc-assets/addon-fit.js': path.join('@xterm', 'addon-fit', 'lib', 'addon-fit.js')
}

// ── ApiServer ───────────────────────────────────────────────

export class ApiServer {
  private httpServer: http.Server | null = null
  private scrollback = new ScrollbackBuffer()
  private wsHandler: WebSocketHandler | null = null
  private _ptyOutputListener: ((sessionId: string, data: string) => void) | null = null
  private _ptyExitListener: ((sessionId: string, exitCode: number) => void) | null = null
  private dispatch: Record<string, (...args: any[]) => any>
  private mobileDispatch: Record<MobileRpcMethod, (...args: any[]) => any>
  private mobileAuth: MobileAuthService

  constructor(
    private services: HandlerServices,
    private config: ApiServerConfig
  ) {
    this.dispatch = this.buildDispatchMap()
    this.mobileDispatch = this.buildMobileDispatchMap()
    this.mobileAuth = new MobileAuthService(this.services.db)
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        if (!res.headersSent) this.handleRequestError(res, err)
        else res.destroy()
      })
    })

    // Create WebSocket handler (hooks into upgrade events on the HTTP server)
    this.wsHandler = new WebSocketHandler(
      this.httpServer,
      this.services.pty,
      this.scrollback,
      {
        authenticateQueryToken: (token) => this.authenticateLegacyToken(token),
        authenticateMessageToken: (token) => {
          const legacy = this.authenticateLegacyToken(token)
          if (legacy) return legacy
          const mobile = this.mobileAuth.authenticateToken(token)
          return mobile
            ? {
                kind: 'mobile' as const,
                deviceId: mobile.deviceId,
                scopes: mobile.scopes
              }
            : null
        }
      }
    )

    // Hook into PTY output → feed scrollback buffer + broadcast to WS clients
    this._ptyOutputListener = (sessionId: string, data: string) => {
      this.scrollback.append(sessionId, data)
      this.wsHandler?.broadcastTerminalData(sessionId, data)
    }
    this.services.pty.onOutput(this._ptyOutputListener)

    // Hook into PTY exit → broadcast to WS clients
    this._ptyExitListener = (sessionId: string, exitCode: number) => {
      this.wsHandler?.broadcastTerminalExit(sessionId, exitCode)
      this.scrollback.remove(sessionId)
    }
    this.services.pty.onExit(this._ptyExitListener)

    // Hook into file watcher events → broadcast to WS clients
    this.services.fileWatcher.onEvent((event, data) => {
      this.wsHandler?.broadcastFileWatcherEvent(event, data)
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(this.config.port, this.config.bindAddress, () => {
        this.httpServer!.removeListener('error', reject)
        resolve()
      })
    })

    console.log(`[api-server] Listening on ${this.config.bindAddress}:${this.config.port}`)
  }

  stop(): void {
    this.mobileAuth.invalidatePairingCodes()

    // Unhook PTY listeners
    if (this._ptyOutputListener) this.services.pty.removeOutputListener(this._ptyOutputListener)
    if (this._ptyExitListener) this.services.pty.removeExitListener(this._ptyExitListener)
    this._ptyOutputListener = null
    this._ptyExitListener = null

    if (this.wsHandler) {
      this.wsHandler.close()
      this.wsHandler = null
    }

    this.httpServer?.close()
    this.scrollback.clear()
    this.httpServer = null
    console.log('[api-server] Stopped')
  }

  isRunning(): boolean {
    return this.httpServer?.listening ?? false
  }

  getScrollback(): ScrollbackBuffer {
    return this.scrollback
  }

  getHttpServer(): http.Server | null {
    return this.httpServer
  }

  getRemoteSessionIds(): string[] {
    return this.wsHandler?.getRemoteSessionIds() ?? []
  }

  /** Rotate the legacy browser credential without restarting the HTTP server. */
  setAuthToken(token: string): void {
    if (!token) throw new Error('Auth token cannot be empty')
    this.config.authToken = token
    this.wsHandler?.disconnectLegacyClients()
  }

  createPairingCode(ttlMs?: number): PairingCode {
    if (!this.isRunning()) throw new Error('Remote access must be running to create a pairing code')
    return this.mobileAuth.createPairingCode(ttlMs)
  }

  listPairedDevices(): PairedDevice[] {
    return this.mobileAuth.listPairedDevices()
  }

  revokePairedDevice(deviceId: string): boolean {
    const revoked = this.mobileAuth.revokePairedDevice(deviceId)
    if (revoked) this.wsHandler?.disconnectDevice(deviceId)
    return revoked
  }

  // ── Request routing ───────────────────────────────────────

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    let url: URL
    try {
      // Route matching must not parse an attacker-controlled Host header.
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      this.sendError(res, 400, 'invalid_url', 'Invalid request URL')
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/mobile/v1/protocol') {
      this.sendJson(res, 200, MOBILE_PROTOCOL_INFO)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mobile/v1/pair') {
      await this.handlePairing(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mobile/v1/rpc') {
      const principal = this.authenticateRequest(req)
      if (
        !principal ||
        (!principal.scopes.has('*') && !principal.scopes.has(MOBILE_SCOPES.rpc))
      ) {
        this.sendError(res, 401, 'unauthorized', 'Unauthorized')
        return
      }
      await this.handleMobileRpc(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      const token = this.getBearerToken(req)
      if (!token || !this.authenticateLegacyToken(token)) {
        this.sendError(res, 401, 'unauthorized', 'Unauthorized')
        return
      }
      await this.handleLegacyRpc(req, res)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      this.sendError(res, 404, 'not_found', 'Not Found')
      return
    }

    // Remote Control — lightweight mobile page
    if (url.pathname === '/rc') {
      const token = url.searchParams.get('token')
      // Query authentication is retained only for existing browser bookmarks.
      // New clients put the device token in the URL fragment, which is never
      // sent to this HTTP server, and authenticate subsequent requests directly.
      if (token !== null && !this.authenticateLegacyToken(token)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Unauthorized')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
      // In dev mode, read from disk for live editing. In production, use inlined copy.
      if (process.env.ELECTRON_RENDERER_URL) {
        const diskPath = path.join(__dirname, '../../src/main/server/remote-control.html')
        if (fs.existsSync(diskPath)) {
          res.end(fs.readFileSync(diskPath, 'utf-8'))
        } else {
          res.end(remoteControlHtmlInlined)
        }
      } else {
        res.end(remoteControlHtmlInlined)
      }
      return
    }

    if (url.pathname in REMOTE_CONTROL_ASSETS) {
      this.serveRemoteControlAsset(url.pathname, res)
      return
    }

    // Serve renderer — proxy to Vite dev server or serve static files
    if (process.env.ELECTRON_RENDERER_URL) {
      this.proxyToVite(req, res)
    } else {
      this.serveStatic(url.pathname, res)
    }
  }

  // ── RPC dispatch ──────────────────────────────────────────

  private buildDispatchMap(): Record<string, (...args: any[]) => any> {
    const s = this.services
    return {
      // Project
      'project:list': () => listProjects(s),
      'project:addPath': (projectPath: string, name?: string) =>
        addProjectByPath(s, projectPath, name),
      'project:update': (id: string, updates: any) => updateProject(s, id, updates),
      'project:remove': (id: string) => removeProject(s, id),
      'project:reorder': (projectIds: string[]) => s.db.reorderProjects(projectIds),
      'project:sync-worktrees': (projectId: string) => syncWorktrees(s, projectId),
      'project:git-status': (projectPath: string) => getProjectGitStatus(s, projectPath),

      // Project groups
      'project-group:list': () => s.db.listProjectGroups(),
      'project-group:add': (name: string) => {
        const { v4: uuidv4 } = require('uuid')
        return s.db.addProjectGroup(uuidv4(), name)
      },
      'project-group:update': (id: string, updates: { name?: string }) => s.db.updateProjectGroup(id, updates),
      'project-group:remove': (id: string) => s.db.removeProjectGroup(id),
      'project-group:reorder': (groupIds: string[]) => s.db.reorderProjectGroups(groupIds),

      // Agent groups
      'agent-group:list': () => getFeatureFlags(s.db).standaloneAgents ? s.db.listAgentGroups() : [],
      'agent-group:add': (name: string) => {
        requireStandaloneAgents(s.db)
        const { v4: uuidv4 } = require('uuid')
        return s.db.addAgentGroup(uuidv4(), name)
      },
      'agent-group:update': (id: string, updates: { name?: string }) => { requireStandaloneAgents(s.db); return s.db.updateAgentGroup(id, updates) },
      'agent-group:remove': (id: string) => { requireStandaloneAgents(s.db); return s.db.removeAgentGroup(id) },
      'agent-group:reorder': (groupIds: string[]) => { requireStandaloneAgents(s.db); return s.db.reorderAgentGroups(groupIds) },

      // Session
      'session:list': (projectId?: string) => listSessions(s, projectId),
      'session:create': (projectId: string, name: string, useMainRepo?: boolean, bypassPermissions?: boolean, remoteControl?: boolean, provider?: string, model?: string) =>
        createSession(s, projectId, name, useMainRepo, bypassPermissions, remoteControl, provider, model),
      'session:spawn-shell': (sessionId: string, cwd: string) => spawnShell(s, sessionId, cwd),
      'session:create-quick-terminal': (sourceId: string) => createQuickTerminal(s, sourceId),
      'session:rename': (sessionId: string, name: string) => renameSession(s, sessionId, name),
      'session:kill': (sessionId: string) => killSession(s, sessionId),
      'session:archive': (sessionId: string) => archiveSession(s, sessionId),
      'session:delete': (sessionId: string) => deleteSession(s, sessionId),
      'session:restart': (sessionId: string) => restartSession(s, sessionId),
      'session:resume': (sessionId: string) => resumeSession(s, sessionId),
      'session:resume-health': (sessionId: string) => getSessionResumeHealth(s, sessionId),
      'session:diagnostics': (sessionId: string) => getSessionDiagnostics(s, sessionId),
      'session:scan-imports': (projectId?: string) => scanImportableSessions(s, projectId),
      'session:import': (candidateIds: string[]) => importExternalSessions(s, candidateIds),
      'session:set-team': (sessionId: string, teamName: string | null) =>
        setSessionTeam(s, sessionId, teamName),
      'session:push-branch': (sessionId: string) => pushSessionBranch(s, sessionId),
      'session:check-delete-safety': (sessionId: string) => checkDeleteSafety(s, sessionId),
      'session:git-status': (sessionId: string) => getSessionGitStatus(s, sessionId),
      'session:land-on-main': (sessionId: string) => landOnMain(s, sessionId),
      'session:restore': (sessionId: string) => restoreSession(s, sessionId),
      'session:set-remote-control': (sessionId: string, enabled: boolean) =>
        setSessionRemoteControl(s, sessionId, enabled),
      'session:open-remote': (_sessionId: string) => {
        // Remote clients should navigate via browser — no shell.openExternal available
        return { opened: false, error: 'Use browser navigation for remote clients' }
      },
      'session:has-conversation': (sessionId: string) => {
        const session = s.db.getSession(sessionId)
        if (!session) return false
        const cwd = fs.existsSync(session.worktree_path as string)
          ? (session.worktree_path as string)
          : (s.db.getProject(session.project_id as string)?.path as string)
        if (!cwd) return false
        return hasClaudeConversation(cwd)
      },

      // Agent
      'agent:list': () => listAgents(s),
      'agent:add': (data: any) => addAgent(s, data),
      'agent:update': (id: string, updates: any) => updateAgent(s, id, updates),
      'agent:remove': (id: string) => removeAgent(s, id),
      'agent:start': (id: string) => startAgent(s, id),
      'agent:has-conversation': (agentId: string) => {
        if (!getFeatureFlags(s.db).standaloneAgents) return false
        const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
        if (!fs.existsSync(cwd)) return false
        return hasClaudeConversation(cwd)
      },
      'agent:resume': (id: string) => resumeAgent(s, id),
      'agent:restart': (id: string) => restartAgent(s, id),
      'agent:kill': (id: string) => killAgent(s, id),
      'agent:set-remote-control': (agentId: string, enabled: boolean) =>
        setAgentRemoteControl(s, agentId, enabled),
      'agent:create-quick-terminal': (agentId: string) => createAgentQuickTerminal(s, agentId),

      // Teams
      'teams:list': () => listTeams(s),
      'teams:tasks': (teamName: string) => getTeamTasks(s, teamName),
      'teams:inbox': (teamName: string, agentName: string) => getTeamInbox(s, teamName, agentName),

      // Quick Notes
      'quick-notes:load': (parentId: string, parentType: string) => loadQuickNote(s, parentId, parentType),
      'quick-notes:save': (id: string, parentId: string, parentType: string, content: string) => saveQuickNote(s, id, parentId, parentType, content),
      'quick-notes:delete': (parentId: string, parentType: string) => deleteQuickNote(s, parentId, parentType),
      'quick-notes:list-parents': () => listQuickNoteParents(s),

      // Briefing
      'briefing:generate': async () => {
        const { v4: uuidv4 } = require('uuid')
        const { generateBriefing } = await import('../services/briefing-service')
        const result = await generateBriefing(s.db, s.pty)
        if (result.text && !result.error) {
          s.db.saveBriefing(uuidv4(), result.text, result.provider, result.model)
        }
        return result
      },
      'briefing:list': (limit?: number) => s.db.listBriefings(limit || 20),
      'briefing:delete': (id: string) => s.db.deleteBriefing(id),

      // Settings
      'settings:get': (key: string) => getSetting(s, key),
      'settings:set': (key: string, value: string) => setSetting(s, key, value),
      'provider:list': () => listProviders(s),
      'provider:refresh': () => refreshProviders(s),

      // System
      'system:features': () => getFeatureFlags(s.db),
      'system:userInfo': () => getUserInfo(),
      'system:remoteSessionIds': () => this.wsHandler?.getRemoteSessionIds() ?? []
    }
  }

  private buildMobileDispatchMap(): Record<MobileRpcMethod, (...args: any[]) => any> {
    const s = this.services
    return {
      'project:list': () => listProjects(s).map((project: any) => ({
        id: project.id,
        name: project.name
      })),
      'session:list': (projectId?: string) => {
        const projects = new Map(
          listProjects(s).map((project: any) => [project.id, project.path])
        )
        return listSessions(s, projectId).map((session: any) => ({
          id: session.id,
          project_id: session.project_id,
          name: session.name,
          branch: session.branch,
          status: session.status,
          type: session.type,
          provider: session.provider,
          is_main_repo: session.worktree_path === projects.get(session.project_id)
        }))
      },
      'session:resume': async (sessionId: string) => {
        await resumeSession(s, sessionId)
        return { ok: true }
      },
      'session:restart': async (sessionId: string) => {
        await restartSession(s, sessionId)
        return { ok: true }
      },
      'agent:list': () => listAgents(s).map((agent: any) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        provider: agent.provider
      })),
      'agent:resume': async (agentId: string) => {
        await resumeAgent(s, agentId)
        return { ok: true }
      },
      'agent:restart': async (agentId: string) => {
        await restartAgent(s, agentId)
        return { ok: true }
      },
      'theme:get': () => getSetting(s, 'theme')
    }
  }

  private async handleLegacyRpc(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { method, args } = await this.readRpcRequest(req)

      // The HTTP bridge is not a trusted desktop IPC boundary. Never allow a
      // remote bearer token to read secret-backed settings or mutate settings.
      if (method === 'settings:set' || (method === 'settings:get' && args[0] !== 'theme')) {
        this.sendError(res, 403, 'setting_not_allowed', 'Setting is not available remotely')
        return
      }

      const handler = this.dispatch[method]

      if (!handler) {
        this.sendError(res, 404, 'method_not_found', `Unknown method: ${method}`)
        return
      }

      const result = await handler(...(args || []))
      this.sendJson(res, 200, { result })
    } catch (err) {
      this.handleRequestError(res, err)
    }
  }

  private async handleMobileRpc(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { method, params } = await this.readMobileRpcRequest(req)
      const decision = validateMobileRpcRequest(method, params)
      if (!decision.allowed) {
        const status = decision.reason === 'method_not_allowed' ? 403 : 400
        this.sendError(res, status, decision.reason, 'RPC request is not allowed')
        return
      }

      const result = await this.mobileDispatch[decision.method](...decision.args)
      this.sendJson(res, 200, { result })
    } catch (err) {
      this.handleRequestError(res, err)
    }
  }

  private async handlePairing(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readJsonBody(req)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpRequestError(400, 'invalid_request', 'Request body must be an object')
      }
      const result = this.mobileAuth.exchangePairingCode({
        code: (body as any).code,
        deviceName: (body as any).deviceName,
        platform: (body as any).platform,
        appVersion: (body as any).appVersion
      })
      this.sendJson(res, 200, result)
    } catch (err) {
      this.handleRequestError(res, err)
    }
  }

  private async readRpcRequest(
    req: http.IncomingMessage
  ): Promise<{ method: string; args: any[] }> {
    const body = await this.readJsonBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpRequestError(400, 'invalid_request', 'Request body must be an object')
    }
    const { method, args = [] } = body as Record<string, unknown>
    if (typeof method !== 'string' || !Array.isArray(args)) {
      throw new HttpRequestError(400, 'invalid_request', 'RPC method and args are required')
    }
    return { method, args }
  }

  private async readMobileRpcRequest(
    req: http.IncomingMessage
  ): Promise<{ method: string; params: unknown }> {
    const body = await this.readJsonBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpRequestError(400, 'invalid_request', 'Request body must be an object')
    }
    const { method, params } = body as Record<string, unknown>
    if (typeof method !== 'string' || params === undefined) {
      throw new HttpRequestError(400, 'invalid_request', 'RPC method and params are required')
    }
    return { method, params }
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    const body = await this.readBody(req)
    try {
      return JSON.parse(body)
    } catch {
      throw new HttpRequestError(400, 'invalid_json', 'Request body is not valid JSON')
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false

      const contentLength = Number(req.headers['content-length'] || 0)
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
        req.resume()
        reject(new HttpRequestError(413, 'request_too_large', 'Request body is too large'))
        return
      }

      req.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > MAX_REQUEST_BODY_BYTES) {
          settled = true
          req.resume()
          reject(new HttpRequestError(413, 'request_too_large', 'Request body is too large'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (!settled) resolve(Buffer.concat(chunks).toString())
      })
      req.on('error', (err) => {
        if (!settled) reject(err)
      })
    })
  }

  private getBearerToken(req: http.IncomingMessage): string | null {
    const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)
    return match?.[1] || null
  }

  private authenticateLegacyToken(token: string): { kind: 'legacy'; scopes: Set<string> } | null {
    return secureTokenEqual(token, this.config.authToken)
      ? { kind: 'legacy', scopes: new Set(['*']) }
      : null
  }

  private authenticateRequest(req: http.IncomingMessage): {
    kind: 'legacy' | 'mobile'
    scopes: ReadonlySet<string>
  } | null {
    const token = this.getBearerToken(req)
    if (!token) return null
    const legacy = this.authenticateLegacyToken(token)
    if (legacy) return legacy
    return this.mobileAuth.authenticateToken(token)
  }

  private sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    })
    res.end(JSON.stringify(body))
  }

  private sendError(
    res: http.ServerResponse,
    statusCode: number,
    code: string,
    message: string
  ): void {
    this.sendJson(res, statusCode, { error: message, code })
  }

  private handleRequestError(res: http.ServerResponse, err: unknown): void {
    if (err instanceof FeatureDisabledError) {
      this.sendError(res, 403, 'feature_disabled', err.message)
      return
    }
    if (err instanceof HttpRequestError || err instanceof MobileAuthError) {
      this.sendError(res, err.statusCode, err.code, err.message)
      return
    }
    console.error('[api-server] Request failed:', err)
    this.sendError(res, 500, 'internal_error', 'Internal server error')
  }

  // ── Dev proxy to Vite ────────────────────────────────────

  private proxyToVite(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    // Only forward the pathname+query to the Vite dev server, never an arbitrary host.
    // Keep the target protocol/host fixed to the trusted Vite dev server and forward only a sanitized path.
    const base = new URL(process.env.ELECTRON_RENDERER_URL!)
    const reqPath = (req.url || '/').replace(/^[a-zA-Z]+:\/\/[^/]*/, '') // strip any scheme+host
    const normalizedPath = reqPath.startsWith('/') ? reqPath : `/${reqPath}`
    const parsedPath = new URL(normalizedPath, 'http://localhost')
    const proxyReq = http.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method: req.method,
        headers: {
          ...req.headers,
          host: base.host
        },
        path: `${parsedPath.pathname}${parsedPath.search}`
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      }
    )
    proxyReq.on('error', () => {
      res.writeHead(502)
      res.end('Vite dev server unavailable')
    })
    req.pipe(proxyReq)
  }

  // ── Static file serving ───────────────────────────────────

  private serveRemoteControlAsset(pathname: string, res: http.ServerResponse): void {
    const relativeAssetPath = REMOTE_CONTROL_ASSETS[pathname]
    if (!relativeAssetPath) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const filePath = path.join(app.getAppPath(), 'node_modules', relativeAssetPath)
    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    })
    fs.createReadStream(filePath).pipe(res)
  }

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    // Resolve to renderer output directory
    const rendererDir = path.join(__dirname, '../renderer')
    let filePath = path.join(rendererDir, pathname === '/' ? 'index.html' : pathname)

    // Security: prevent directory traversal
    if (!filePath.startsWith(rendererDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // If file doesn't exist or is a directory, serve index.html (SPA fallback)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(rendererDir, 'index.html')
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  }
}

function secureTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  )
}
