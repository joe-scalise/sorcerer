import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'http'
import { WebSocket } from 'ws'
import {
  MAX_PENDING_AUTHENTICATIONS,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  WebSocketAuthConfig,
  WebSocketHandler
} from '../ws-handler'
import { ScrollbackBuffer } from '../scrollback'

// ── Helpers ────────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-abc123'
const TEST_PORT = 0 // Let OS pick an available port

/** Minimal PTYService stub for tests. */
function createMockPTY() {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    isRunning: vi.fn(() => false),
    getPid: vi.fn(() => undefined),
    onOutput: vi.fn(),
    onExit: vi.fn(),
    setCustomShell: vi.fn()
  }
}

/** Start an HTTP server + WebSocketHandler, returns a cleanup function. */
function createTestServer(auth: string | WebSocketAuthConfig = TEST_TOKEN) {
  const server = http.createServer()
  const scrollback = new ScrollbackBuffer()
  const pty = createMockPTY()
  const handler = new WebSocketHandler(server, pty as any, scrollback, auth)

  return new Promise<{
    server: http.Server
    handler: WebSocketHandler
    scrollback: ScrollbackBuffer
    pty: ReturnType<typeof createMockPTY>
    url: string
    close: () => Promise<void>
  }>((resolve) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      const url = `ws://127.0.0.1:${addr.port}/ws?token=${encodeURIComponent(TEST_TOKEN)}`
      resolve({
        server,
        handler,
        scrollback,
        pty,
        url,
        close: () =>
          new Promise<void>((res) => {
            handler.close()
            server.close(() => res())
          })
      })
    })
  })
}

/** Connect a WebSocket client and wait for it to open. */
function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/** Wait for a JSON message from a WebSocket. */
function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs)
    ws.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(raw.toString()))
    })
  })
}

/** Send a JSON action to the server. */
function sendAction(ws: WebSocket, action: Record<string, any>): void {
  ws.send(JSON.stringify(action))
}

/** Small delay for async settling. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Tests ──────────────────────────────────────────────────

describe('WebSocketHandler', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>

  beforeEach(async () => {
    ctx = await createTestServer()
  })

  afterEach(async () => {
    await ctx.close()
  })

  // ── Auth ─────────────────────────────────────────────────

  describe('authentication', () => {
    it('accepts connection with valid token', async () => {
      const ws = await connectClient(ctx.url)
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(ctx.handler.clientCount).toBe(1)
      ws.close()
    })

    it('rejects connection with invalid token', async () => {
      const addr = ctx.server.address() as { port: number }
      const badUrl = `ws://127.0.0.1:${addr.port}/ws?token=wrong`
      const ws = new WebSocket(badUrl)

      await new Promise<void>((resolve) => {
        ws.on('error', () => {
          // Expected: upgrade rejected
          resolve()
        })
        ws.on('close', () => {
          resolve()
        })
      })

      expect(ctx.handler.clientCount).toBe(0)
    })

    it('rejects a no-query connection that sends an action before authenticating', async () => {
      const addr = ctx.server.address() as { port: number }
      const noTokenUrl = `ws://127.0.0.1:${addr.port}/ws`
      const ws = await connectClient(noTokenUrl)

      const closed = new Promise<void>((resolve) => {
        ws.on('close', () => resolve())
      })
      sendAction(ws, { action: 'terminal:write', sessionId: 's1', data: 'nope' })
      await closed

      expect(ctx.handler.clientCount).toBe(0)
      expect(ctx.pty.write).not.toHaveBeenCalled()
    })

    it('accepts a valid token in the first frame without putting it in the URL', async () => {
      const addr = ctx.server.address() as { port: number }
      const ws = await connectClient(`ws://127.0.0.1:${addr.port}/ws`)
      const authenticated = waitForMessage(ws)
      sendAction(ws, { action: 'authenticate', token: TEST_TOKEN })

      expect(await authenticated).toEqual({ type: 'authenticated', protocolVersion: 1 })
      expect(ctx.handler.clientCount).toBe(1)
      ws.close()
    })

    it('closes an oversized unauthenticated frame before parsing it', async () => {
      const addr = ctx.server.address() as { port: number }
      const ws = await connectClient(`ws://127.0.0.1:${addr.port}/ws`)
      const closed = new Promise<number>((resolve) => {
        ws.once('close', (code) => resolve(code))
      })

      ws.send(Buffer.alloc(MAX_WEBSOCKET_MESSAGE_BYTES + 1))

      expect(await closed).toBe(1009)
      expect(ctx.handler.clientCount).toBe(0)
    })

    it('caps simultaneous unauthenticated connections', async () => {
      await ctx.close()
      ctx = await createTestServer({
        authenticateQueryToken: () => null,
        authenticateMessageToken: () => null,
        authTimeoutMs: 10_000
      })
      const addr = ctx.server.address() as { port: number }
      const clients: WebSocket[] = []
      for (let index = 0; index < MAX_PENDING_AUTHENTICATIONS; index++) {
        clients.push(await connectClient(`ws://127.0.0.1:${addr.port}/ws`))
      }

      const rejected = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`)
      const closeCode = new Promise<number>((resolve) => {
        rejected.once('close', (code) => resolve(code))
      })

      expect(await closeCode).toBe(1013)
      clients.forEach((client) => client.close())
    })

    it('rejects upgrade to non-/ws path', async () => {
      const addr = ctx.server.address() as { port: number }
      const wrongPath = `ws://127.0.0.1:${addr.port}/other?token=${TEST_TOKEN}`
      const ws = new WebSocket(wrongPath)

      await new Promise<void>((resolve) => {
        ws.on('error', () => resolve())
        ws.on('close', () => resolve())
      })

      expect(ctx.handler.clientCount).toBe(0)
    })
  })

  // ── Terminal I/O actions ─────────────────────────────────

  describe('terminal:write action', () => {
    it('forwards write to PTYService', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'terminal:write', sessionId: 'sess-1', data: 'ls -la\n' })
      await delay(50)

      expect(ctx.pty.write).toHaveBeenCalledWith('sess-1', 'ls -la\n')
      ws.close()
    })

    it('ignores write with missing sessionId', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'terminal:write', data: 'hello' })
      await delay(50)

      expect(ctx.pty.write).not.toHaveBeenCalled()
      ws.close()
    })

    it('ignores write with non-string data', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'terminal:write', sessionId: 's1', data: 123 })
      await delay(50)

      expect(ctx.pty.write).not.toHaveBeenCalled()
      ws.close()
    })
  })

  describe('mobile scopes', () => {
    it('allows terminal reads but rejects writes and non-terminal subscriptions without scope', async () => {
      await ctx.close()
      ctx = await createTestServer({
        authenticateQueryToken: () => null,
        authenticateMessageToken: (token) => token === 'read-only-device-token'
          ? {
              kind: 'mobile',
              deviceId: 'device-1',
              scopes: new Set(['terminal:read'])
            }
          : null,
        authTimeoutMs: 100
      })
      const addr = ctx.server.address() as { port: number }
      const ws = await connectClient(`ws://127.0.0.1:${addr.port}/ws`)

      const authMessage = waitForMessage(ws)
      sendAction(ws, { action: 'authenticate', token: 'read-only-device-token' })
      await authMessage

      const writeError = waitForMessage(ws)
      sendAction(ws, { action: 'terminal:write', sessionId: 'sess-1', data: 'blocked' })
      expect(await writeError).toEqual({
        type: 'error',
        code: 'forbidden',
        action: 'terminal:write'
      })
      expect(ctx.pty.write).not.toHaveBeenCalled()

      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(25)
      const terminalData = waitForMessage(ws)
      ctx.handler.broadcastTerminalData('sess-1', 'allowed')
      expect(await terminalData).toMatchObject({
        channel: 'terminal:data:sess-1',
        data: 'allowed'
      })

      const subscriptionError = waitForMessage(ws)
      sendAction(ws, { action: 'subscribe', channel: 'filewatcher:teams-update' })
      expect(await subscriptionError).toEqual({
        type: 'error',
        code: 'forbidden',
        action: 'subscribe'
      })
      ws.close()
    })
  })

  describe('terminal:resize action', () => {
    it('forwards resize to PTYService', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'terminal:resize', sessionId: 'sess-1', cols: 120, rows: 40 })
      await delay(50)

      expect(ctx.pty.resize).toHaveBeenCalledWith('sess-1', 120, 40)
      ws.close()
    })

    it('ignores resize with missing dimensions', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'terminal:resize', sessionId: 's1', cols: 80 })
      await delay(50)

      expect(ctx.pty.resize).not.toHaveBeenCalled()
      ws.close()
    })
  })

  // ── Subscribe / Unsubscribe ──────────────────────────────

  describe('subscribe and unsubscribe', () => {
    it('receives broadcast after subscribing', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastTerminalData('sess-1', 'hello output')
      const msg = await msgPromise

      expect(msg).toEqual({
        channel: 'terminal:data:sess-1',
        data: 'hello output'
      })
      ws.close()
    })

    it('does not receive broadcast for unsubscribed channel', async () => {
      const ws = await connectClient(ctx.url)
      // Subscribe to sess-1 only
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      // Collect all received messages
      const received: any[] = []
      ws.on('message', (raw) => {
        received.push(JSON.parse(raw.toString()))
      })

      // Broadcast to sess-2 (not subscribed) then sess-1 (subscribed)
      ctx.handler.broadcastTerminalData('sess-2', 'other session')
      ctx.handler.broadcastTerminalData('sess-1', 'my session')
      await delay(100)

      // Should only have received the sess-1 message
      expect(received).toHaveLength(1)
      expect(received[0].channel).toBe('terminal:data:sess-1')
      expect(received[0].data).toBe('my session')
      ws.close()
    })

    it('stops receiving after unsubscribe', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      // First broadcast should be received
      const msg1Promise = waitForMessage(ws)
      ctx.handler.broadcastTerminalData('sess-1', 'first')
      const msg1 = await msg1Promise
      expect(msg1.data).toBe('first')

      // Unsubscribe
      sendAction(ws, { action: 'unsubscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      // Subscribe to a different channel so we can verify the first one is gone
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-2' })
      await delay(50)

      ctx.handler.broadcastTerminalData('sess-1', 'should not arrive')
      const msg2Promise = waitForMessage(ws)
      ctx.handler.broadcastTerminalData('sess-2', 'from sess-2')
      const msg2 = await msg2Promise

      expect(msg2.channel).toBe('terminal:data:sess-2')
      expect(msg2.data).toBe('from sess-2')
      ws.close()
    })

    it('ignores subscribe with non-string channel', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 123 })
      await delay(50)

      // Should not crash — client count still 1
      expect(ctx.handler.clientCount).toBe(1)
      ws.close()
    })
  })

  // ── Scrollback replay ────────────────────────────────────

  describe('scrollback replay on subscribe', () => {
    it('sends scrollback when subscribing to terminal:data channel', async () => {
      ctx.scrollback.append('sess-1', 'previous output here')
      const ws = await connectClient(ctx.url)

      const msgPromise = waitForMessage(ws)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      const msg = await msgPromise

      expect(msg).toEqual({
        channel: 'terminal:data:sess-1',
        data: 'previous output here'
      })
      ws.close()
    })

    it('does not send scrollback when no data exists', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-empty' })
      await delay(100)

      // Subscribe to a second channel to prove the first one didn't send anything
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-2' })
      ctx.scrollback.append('sess-2', 'some data')

      // Re-subscribe to get scrollback from sess-2
      sendAction(ws, { action: 'unsubscribe', channel: 'terminal:data:sess-2' })
      await delay(50)
      const msgPromise = waitForMessage(ws)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-2' })
      const msg = await msgPromise

      expect(msg.channel).toBe('terminal:data:sess-2')
      ws.close()
    })

    it('does not send scrollback for non-terminal channels', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'filewatcher:teams-update' })
      await delay(100)

      // No message should arrive. Verify by broadcasting to that channel instead.
      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastFileWatcherEvent('teams-update', { event: 'change' })
      const msg = await msgPromise

      expect(msg.channel).toBe('filewatcher:teams-update')
      expect(msg.event).toBe('change')
      ws.close()
    })
  })

  // ── Broadcast methods ────────────────────────────────────

  describe('broadcastTerminalData', () => {
    it('sends to multiple subscribed clients', async () => {
      const ws1 = await connectClient(ctx.url)
      const ws2 = await connectClient(ctx.url)

      sendAction(ws1, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      sendAction(ws2, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      const p1 = waitForMessage(ws1)
      const p2 = waitForMessage(ws2)
      ctx.handler.broadcastTerminalData('sess-1', 'shared output')

      const [msg1, msg2] = await Promise.all([p1, p2])
      expect(msg1.data).toBe('shared output')
      expect(msg2.data).toBe('shared output')

      ws1.close()
      ws2.close()
    })

    it('only sends to clients subscribed to that specific session', async () => {
      const ws1 = await connectClient(ctx.url)
      const ws2 = await connectClient(ctx.url)

      sendAction(ws1, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      sendAction(ws2, { action: 'subscribe', channel: 'terminal:data:sess-2' })
      await delay(50)

      const p1 = waitForMessage(ws1)
      ctx.handler.broadcastTerminalData('sess-1', 'only for ws1')
      const msg1 = await p1
      expect(msg1.data).toBe('only for ws1')

      const p2 = waitForMessage(ws2)
      ctx.handler.broadcastTerminalData('sess-2', 'only for ws2')
      const msg2 = await p2
      expect(msg2.data).toBe('only for ws2')

      ws1.close()
      ws2.close()
    })
  })

  describe('broadcastTerminalExit', () => {
    it('sends exit code to subscribed clients', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:exit:sess-1' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastTerminalExit('sess-1', 0)
      const msg = await msgPromise

      expect(msg).toEqual({
        channel: 'terminal:exit:sess-1',
        exitCode: 0
      })
      ws.close()
    })

    it('sends non-zero exit codes', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:exit:sess-1' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastTerminalExit('sess-1', 137)
      const msg = await msgPromise

      expect(msg.exitCode).toBe(137)
      ws.close()
    })
  })

  describe('broadcastFileWatcherEvent', () => {
    it('broadcasts teams-update events', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'filewatcher:teams-update' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastFileWatcherEvent('teams-update', { event: 'change', path: '/some/path' })
      const msg = await msgPromise

      expect(msg).toEqual({
        channel: 'filewatcher:teams-update',
        event: 'change',
        path: '/some/path'
      })
      ws.close()
    })

    it('broadcasts tasks-update events', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'filewatcher:tasks-update' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastFileWatcherEvent('tasks-update', {
        event: 'add',
        path: '/tasks/team1/task.json',
        teamName: 'team1'
      })
      const msg = await msgPromise

      expect(msg.channel).toBe('filewatcher:tasks-update')
      expect(msg.teamName).toBe('team1')
      ws.close()
    })

    it('broadcasts session-linked events', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'filewatcher:session-linked' })
      await delay(50)

      const msgPromise = waitForMessage(ws)
      ctx.handler.broadcastFileWatcherEvent('session-linked', {
        sessionId: 'sess-1',
        teamName: 'my-team'
      })
      const msg = await msgPromise

      expect(msg).toEqual({
        channel: 'filewatcher:session-linked',
        sessionId: 'sess-1',
        teamName: 'my-team'
      })
      ws.close()
    })
  })

  // ── Connection lifecycle ─────────────────────────────────

  describe('connection lifecycle', () => {
    it('tracks client count correctly', async () => {
      expect(ctx.handler.clientCount).toBe(0)

      const ws1 = await connectClient(ctx.url)
      expect(ctx.handler.clientCount).toBe(1)

      const ws2 = await connectClient(ctx.url)
      expect(ctx.handler.clientCount).toBe(2)

      ws1.close()
      await delay(50)
      expect(ctx.handler.clientCount).toBe(1)

      ws2.close()
      await delay(50)
      expect(ctx.handler.clientCount).toBe(0)
    })

    it('cleans up subscriptions on disconnect', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'subscribe', channel: 'terminal:data:sess-1' })
      await delay(50)

      ws.close()
      await delay(50)

      // Broadcast should not throw even though client is gone
      expect(() => {
        ctx.handler.broadcastTerminalData('sess-1', 'after disconnect')
      }).not.toThrow()
    })
  })

  // ── Malformed messages ───────────────────────────────────

  describe('malformed messages', () => {
    it('ignores non-JSON messages', async () => {
      const ws = await connectClient(ctx.url)
      ws.send('not json at all')
      await delay(50)

      // Connection should remain alive
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(ctx.handler.clientCount).toBe(1)
      ws.close()
    })

    it('ignores messages with unknown action', async () => {
      const ws = await connectClient(ctx.url)
      sendAction(ws, { action: 'unknown:action', foo: 'bar' })
      await delay(50)

      // Connection should remain alive
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })

    it('ignores messages without action field', async () => {
      const ws = await connectClient(ctx.url)
      ws.send(JSON.stringify({ channel: 'something', data: 'test' }))
      await delay(50)

      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  // ── close() ──────────────────────────────────────────────

  describe('close()', () => {
    it('disconnects all clients on close', async () => {
      const ws1 = await connectClient(ctx.url)
      const ws2 = await connectClient(ctx.url)
      expect(ctx.handler.clientCount).toBe(2)

      const closePromises = [
        new Promise<void>((r) => ws1.on('close', () => r())),
        new Promise<void>((r) => ws2.on('close', () => r()))
      ]

      ctx.handler.close()
      await Promise.all(closePromises)

      expect(ctx.handler.clientCount).toBe(0)
    })
  })
})
