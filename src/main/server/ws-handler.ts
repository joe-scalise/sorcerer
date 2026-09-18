import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import { URL } from 'url'
import { PTYService } from '../services/pty-service'
import { ScrollbackBuffer } from './scrollback'
import { MOBILE_PROTOCOL_VERSION, MOBILE_SCOPES } from './mobile-contract'

export const MAX_WEBSOCKET_MESSAGE_BYTES = 256 * 1024
export const MAX_PENDING_AUTHENTICATIONS = 32

export interface WebSocketPrincipal {
  kind: 'legacy' | 'mobile'
  deviceId?: string
  scopes: ReadonlySet<string>
}

export interface WebSocketAuthConfig {
  authenticateQueryToken(token: string): WebSocketPrincipal | null
  authenticateMessageToken(token: string): WebSocketPrincipal | null
  authTimeoutMs?: number
}

/**
 * Per-client state tracking which channels the client has subscribed to.
 */
interface ClientState {
  subscriptions: Set<string>
  principal: WebSocketPrincipal | null
  authTimer: ReturnType<typeof setTimeout> | null
  awaitingAuthentication: boolean
}

interface AuthenticatedUpgradeRequest extends http.IncomingMessage {
  remotePrincipal?: WebSocketPrincipal | null
}

/**
 * WebSocketHandler — multiplexed WebSocket server for streaming terminal I/O
 * and file-watcher events to remote clients.
 *
 * Protocol:
 *
 * Client → Server (actions):
 *   { action: "terminal:write",  sessionId, data }
 *   { action: "terminal:resize", sessionId, cols, rows }
 *   { action: "subscribe",       channel }
 *   { action: "unsubscribe",     channel }
 *
 * Server → Client (push, only to subscribed clients):
 *   { channel: "terminal:data:<sessionId>", data }
 *   { channel: "terminal:exit:<sessionId>", exitCode }
 *   { channel: "filewatcher:<event>",       ...payload }
 *
 * Design note: This handler does NOT hook into PTYService/FileWatcherService
 * listeners directly, because those services only support a single listener
 * each. Instead, the ApiServer registers the single listener and forwards
 * data here via the public broadcast*() methods.
 */
export class WebSocketHandler {
  private wss: WebSocketServer
  private clients = new Map<WebSocket, ClientState>()
  private authConfig: WebSocketAuthConfig
  private pendingAuthentications = 0

  constructor(
    server: http.Server,
    private pty: PTYService,
    private scrollback: ScrollbackBuffer,
    auth: string | WebSocketAuthConfig
  ) {
    this.authConfig = typeof auth === 'string' ? legacyAuthConfig(auth) : auth
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES
    })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))

    // Handle HTTP upgrade requests for the /ws path
    server.on('upgrade', (req, socket, head) => {
      let url: URL
      try {
        // The Host header is untrusted and irrelevant to local route matching.
        url = new URL(req.url || '/', 'http://localhost')
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }

      // Only handle upgrades to /ws
      if (url.pathname !== '/ws') {
        socket.destroy()
        return
      }

      // Legacy browser clients authenticate during upgrade. New mobile clients
      // omit the query token and authenticate in their first WebSocket frame so
      // the device credential never appears in a URL or proxy log.
      const token = url.searchParams.get('token')
      const principal = token === null ? null : this.authConfig.authenticateQueryToken(token)
      if (token !== null && !principal) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ;(req as AuthenticatedUpgradeRequest).remotePrincipal = principal
        this.wss.emit('connection', ws, req)
      })
    })
  }

  // ── Connection lifecycle ─────────────────────────────────

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const principal = (req as AuthenticatedUpgradeRequest).remotePrincipal ?? null
    const clientState: ClientState = {
      subscriptions: new Set(),
      principal,
      authTimer: null,
      awaitingAuthentication: false
    }
    this.clients.set(ws, clientState)

    ws.on('close', () => {
      if (clientState.authTimer) clearTimeout(clientState.authTimer)
      this.finishPendingAuthentication(clientState)
      this.clients.delete(ws)
    })
    // Protocol and payload-limit errors close the socket; consuming the error
    // prevents an unauthenticated malformed frame from becoming an uncaught
    // EventEmitter error in the desktop process.
    ws.on('error', () => {})

    if (!principal) {
      if (this.pendingAuthentications >= MAX_PENDING_AUTHENTICATIONS) {
        ws.close(1013, 'Too many pending authentication attempts')
        return
      }
      clientState.awaitingAuthentication = true
      this.pendingAuthentications++
      clientState.authTimer = setTimeout(() => {
        ws.close(1008, 'Authentication required')
      }, this.authConfig.authTimeoutMs ?? 5000)
      clientState.authTimer.unref?.()
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (!clientState.principal) {
          this.handleAuthentication(ws, clientState, msg)
          return
        }
        this.handleMessage(ws, clientState, msg)
      } catch {
        // Ignore malformed messages
      }
    })
  }

  // ── Inbound message dispatch ─────────────────────────────

  private handleAuthentication(
    ws: WebSocket,
    state: ClientState,
    msg: Record<string, any>
  ): void {
    if (msg.action !== 'authenticate' || typeof msg.token !== 'string') {
      ws.close(1008, 'Authentication required')
      return
    }

    const principal = this.authConfig.authenticateMessageToken(msg.token)
    if (!principal) {
      ws.close(1008, 'Invalid credentials')
      return
    }

    state.principal = principal
    if (state.authTimer) clearTimeout(state.authTimer)
    state.authTimer = null
    this.finishPendingAuthentication(state)
    this.sendTo(ws, { type: 'authenticated', protocolVersion: MOBILE_PROTOCOL_VERSION })
  }

  private handleMessage(
    ws: WebSocket,
    state: ClientState,
    msg: Record<string, any>
  ): void {
    const principal = state.principal
    if (!principal) return

    switch (msg.action) {
      case 'terminal:write':
        if (!this.hasScope(principal, MOBILE_SCOPES.terminalWrite)) {
          this.sendForbidden(ws, msg.action)
          break
        }
        if (typeof msg.sessionId === 'string' && typeof msg.data === 'string') {
          this.pty.write(msg.sessionId, msg.data)
        }
        break

      case 'terminal:resize':
        if (!this.hasScope(principal, MOBILE_SCOPES.terminalWrite)) {
          this.sendForbidden(ws, msg.action)
          break
        }
        if (
          typeof msg.sessionId === 'string' &&
          typeof msg.cols === 'number' &&
          typeof msg.rows === 'number'
        ) {
          this.pty.resize(msg.sessionId, msg.cols, msg.rows)
        }
        break

      case 'subscribe':
        if (typeof msg.channel === 'string') {
          if (!this.canReadChannel(principal, msg.channel)) {
            this.sendForbidden(ws, msg.action)
            break
          }
          state.subscriptions.add(msg.channel)
          // When subscribing to a terminal data channel, replay scrollback
          if (msg.channel.startsWith('terminal:data:')) {
            const sessionId = msg.channel.slice('terminal:data:'.length)
            const data = this.scrollback.getScrollback(sessionId)
            if (data) {
              this.sendTo(ws, { channel: msg.channel, data })
            }
          }
        }
        break

      case 'unsubscribe':
        if (typeof msg.channel === 'string') {
          if (!this.canReadChannel(principal, msg.channel)) {
            this.sendForbidden(ws, msg.action)
            break
          }
          state.subscriptions.delete(msg.channel)
        }
        break
    }
  }

  // ── Public broadcast methods (called by ApiServer) ───────

  /**
   * Broadcast PTY output to all clients subscribed to the terminal data channel.
   */
  broadcastTerminalData(sessionId: string, data: string): void {
    this.broadcast(`terminal:data:${sessionId}`, { data })
  }

  /**
   * Broadcast PTY exit to all clients subscribed to the terminal exit channel.
   */
  broadcastTerminalExit(sessionId: string, exitCode: number): void {
    this.broadcast(`terminal:exit:${sessionId}`, { exitCode })
  }

  /**
   * Broadcast a file-watcher event to all clients subscribed to that channel.
   * @param event - The event name suffix (e.g. "teams-update", "tasks-update", "session-linked")
   * @param data - The event payload
   */
  broadcastFileWatcherEvent(event: string, data: Record<string, any>): void {
    this.broadcast(`filewatcher:${event}`, data)
  }

  // ── Internal helpers ─────────────────────────────────────

  /**
   * Send a JSON message to a specific client.
   */
  private sendTo(ws: WebSocket, message: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Broadcast a message to all clients subscribed to the given channel.
   * The message sent includes the channel field merged with the payload.
   */
  private broadcast(channel: string, payload: Record<string, any>): void {
    const message = JSON.stringify({ channel, ...payload })
    for (const [ws, state] of this.clients) {
      if (state.subscriptions.has(channel) && ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    }
  }

  // ── Accessors (for testing) ──────────────────────────────

  /** Number of currently connected clients. */
  get clientCount(): number {
    let count = 0
    for (const state of this.clients.values()) {
      if (state.principal) count++
    }
    return count
  }

  /** Get session IDs that have at least one remote subscriber watching terminal data. */
  getRemoteSessionIds(): string[] {
    const ids = new Set<string>()
    for (const [, state] of this.clients) {
      for (const ch of state.subscriptions) {
        if (ch.startsWith('terminal:data:')) {
          ids.add(ch.slice('terminal:data:'.length))
        }
      }
    }
    return Array.from(ids)
  }

  /** Disconnect active sockets for a device immediately after revocation. */
  disconnectDevice(deviceId: string): void {
    for (const [ws, state] of this.clients) {
      if (state.principal?.kind === 'mobile' && state.principal.deviceId === deviceId) {
        state.principal = null
        state.subscriptions.clear()
        ws.close(1008, 'Device revoked')
      }
    }
  }

  /** Disconnect sockets authenticated with a rotated legacy credential. */
  disconnectLegacyClients(): void {
    for (const [ws, state] of this.clients) {
      if (state.principal?.kind === 'legacy') {
        state.principal = null
        state.subscriptions.clear()
        ws.close(1008, 'Credential rotated')
      }
    }
  }

  private hasScope(principal: WebSocketPrincipal, scope: string): boolean {
    return principal.scopes.has('*') || principal.scopes.has(scope)
  }

  private canReadChannel(principal: WebSocketPrincipal, channel: string): boolean {
    if (principal.scopes.has('*')) return true
    return (
      this.hasScope(principal, MOBILE_SCOPES.terminalRead) &&
      (channel.startsWith('terminal:data:') || channel.startsWith('terminal:exit:'))
    )
  }

  private sendForbidden(ws: WebSocket, action: string): void {
    this.sendTo(ws, { type: 'error', code: 'forbidden', action })
  }

  private finishPendingAuthentication(state: ClientState): void {
    if (!state.awaitingAuthentication) return
    state.awaitingAuthentication = false
    this.pendingAuthentications = Math.max(0, this.pendingAuthentications - 1)
  }

  // ── Shutdown ─────────────────────────────────────────────

  /**
   * Gracefully close all connections and shut down the WebSocket server.
   */
  close(): void {
    for (const [ws, state] of this.clients) {
      this.finishPendingAuthentication(state)
      ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()
    this.wss.close()
  }
}

function legacyAuthConfig(initialToken: string): WebSocketAuthConfig {
  const authToken = initialToken
  const authenticate = (token: string): WebSocketPrincipal | null =>
    token === authToken
      ? { kind: 'legacy', scopes: new Set(['*']) }
      : null

  return {
    authenticateQueryToken: authenticate,
    authenticateMessageToken: authenticate,
    // Kept as a property for tests using the legacy constructor. ApiServer uses
    // closures over its mutable config for live legacy-token rotation.
    get authTimeoutMs() {
      return 5000
    }
  }
}
