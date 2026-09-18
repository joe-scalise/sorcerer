import http from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() }
}))

import { ApiServer, MAX_REQUEST_BODY_BYTES } from '../api-server'
import {
  CreateMobileDeviceInput,
  MobileDeviceCredentialRecord,
  MobileDeviceRecord
} from '../../services/database-service'

const LEGACY_TOKEN = 'legacy-browser-token'

class TestDatabase {
  settings = new Map<string, string>([
    ['theme', 'gruvbox-dark'],
    ['featureStandaloneAgents', 'true'],
    ['apiKey_openai', 'super-secret-provider-key']
  ])
  devices = new Map<string, MobileDeviceCredentialRecord>()

  getSetting(key: string): string | undefined {
    return this.settings.get(key)
  }

  setSetting(key: string, value: string): void {
    this.settings.set(key, value)
  }

  listProjects(): any[] {
    return [{ id: 'project-1', name: 'Sorcerer', path: 'C:\\secret\\sorcerer' }]
  }

  listSessions(): any[] {
    return [{
      id: 'session-1',
      project_id: 'project-1',
      name: 'Android work',
      branch: 'feature/android',
      status: 'active',
      type: 'session',
      provider: 'claude',
      worktree_path: 'C:\\secret\\sorcerer',
      provider_session_id: 'secret-provider-session'
    }]
  }

  listAgents(): any[] {
    return [{
      id: 'agent-1',
      name: 'Mobile',
      status: 'idle',
      provider: 'claude',
      system_prompt: 'secret system prompt',
      mcp_config: '{"secret":true}'
    }]
  }

  createMobileDevice(input: CreateMobileDeviceInput): MobileDeviceRecord {
    const record: MobileDeviceCredentialRecord = {
      id: input.id,
      name: input.name,
      tokenHash: input.tokenHash,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      scopes: [...input.scopes],
      createdAt: input.createdAt,
      lastSeenAt: null,
      revokedAt: null
    }
    this.devices.set(input.tokenHash, record)
    return this.publicDevice(record)
  }

  getMobileDeviceByTokenHash(tokenHash: string): MobileDeviceCredentialRecord | undefined {
    const record = this.devices.get(tokenHash)
    return record ? { ...record, scopes: [...record.scopes] } : undefined
  }

  listMobileDevices(): MobileDeviceRecord[] {
    return [...this.devices.values()].map((record) => this.publicDevice(record))
  }

  touchMobileDevice(id: string, seenAt: number): void {
    const record = [...this.devices.values()].find((candidate) => candidate.id === id)
    if (record && record.revokedAt === null) record.lastSeenAt = seenAt
  }

  revokeMobileDevice(id: string, revokedAt: number): boolean {
    const record = [...this.devices.values()].find((candidate) => candidate.id === id)
    if (!record || record.revokedAt !== null) return false
    record.revokedAt = revokedAt
    return true
  }

  private publicDevice(record: MobileDeviceCredentialRecord): MobileDeviceRecord {
    const { tokenHash: _tokenHash, ...device } = record
    return { ...device, scopes: [...device.scopes] }
  }
}

function createServices(db: TestDatabase) {
  return {
    db,
    pty: {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      removeOutputListener: vi.fn(),
      removeExitListener: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    },
    fileWatcher: { onEvent: vi.fn() },
    worktree: {}
  } as any
}

interface TestResponse {
  status: number
  body: any
  text: string
  headers: http.IncomingHttpHeaders
}

function request(
  port: number,
  pathname: string,
  options: { method?: string; token?: string; body?: string; hostHeader?: string } = {}
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {}
    if (options.hostHeader !== undefined) headers.Host = options.hostHeader
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(options.body)
    }
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body: any = text
        try { body = JSON.parse(text) } catch { /* text response */ }
        resolve({ status: res.statusCode || 0, body, text, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (options.body !== undefined) req.end(options.body)
    else req.end()
  })
}

describe('ApiServer mobile v1', () => {
  let db: TestDatabase
  let server: ApiServer
  let port: number

  beforeEach(async () => {
    db = new TestDatabase()
    server = new ApiServer(createServices(db), {
      port: 0,
      bindAddress: '127.0.0.1',
      authToken: LEGACY_TOKEN
    })
    await server.start()
    port = (server.getHttpServer()!.address() as { port: number }).port
  })

  afterEach(() => {
    server.stop()
  })

  it('keeps Projects available remotely while disabled Agents cannot be started', async () => {
    db.settings.delete('featureStandaloneAgents')
    const rpc = (method: string, args: unknown[] = []) => request(port, '/api/rpc', {
      method: 'POST', token: LEGACY_TOKEN, body: JSON.stringify({ method, args })
    })
    expect(await rpc('system:features')).toMatchObject({ status: 200, body: { result: { standaloneAgents: false } } })
    expect(await rpc('agent:list')).toMatchObject({ status: 200, body: { result: [] } })
    expect(await rpc('agent-group:list')).toMatchObject({ status: 200, body: { result: [] } })
    const projects = await rpc('project:list')
    expect(projects.status).toBe(200)
    expect(projects.body.result).toHaveLength(1)
    const sessions = await rpc('session:list')
    expect(sessions.status).toBe(200)
    expect(sessions.body.result).toHaveLength(1)
    for (const method of ['agent:start', 'agent:resume', 'agent:restart', 'agent:remove', 'agent-group:remove']) {
      const result = await rpc(method, ['agent-1'])
      expect(result.status).toBeGreaterThanOrEqual(400)
      expect(result.text).toContain('Agents are disabled')
    }
    db.settings.set('featureStandaloneAgents', 'true')
    expect(await rpc('agent:list')).toMatchObject({ status: 200, body: { result: [] } })
    expect(db.listAgents()).toHaveLength(1)
  })

  it('publishes protocol capabilities without exposing a credential', async () => {
    const response = await request(port, '/api/mobile/v1/protocol')
    expect(response.status).toBe(200)
    expect(response.body.protocolVersion).toBe(1)
    expect(response.body.endpoints.rpc).toBe('/api/mobile/v1/rpc')
    expect(response.text).not.toContain(LEGACY_TOKEN)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('ignores malformed Host headers when matching public routes', async () => {
    const response = await request(port, '/api/mobile/v1/protocol', { hostHeader: '[' })
    expect(response.status).toBe(200)
    expect(response.body.protocolVersion).toBe(1)
  })

  it('rejects malformed request targets and continues serving requests', async () => {
    const malformed = await request(port, 'http://[')
    expect(malformed.status).toBe(400)
    expect(malformed.body.code).toBe('invalid_url')

    const healthy = await request(port, '/api/mobile/v1/protocol')
    expect(healthy.status).toBe(200)
  })

  it('serves fragment bootstrap with the exact native authentication-failure signal', async () => {
    const response = await request(port, '/rc')

    expect(response.status).toBe(200)
    expect(response.text).toContain("location.href = 'sorcerer-remote://auth-failed'")
    expect(response.text).not.toContain('sorcerer-remote://auth-failed?')
    expect(response.text).toContain("history.replaceState(null, '', location.pathname)")
  })

  it('pairs once, authorizes named RPC, sanitizes records, and rejects a revoked token', async () => {
    const pairing = server.createPairingCode()
    const paired = await request(port, '/api/mobile/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ code: pairing.code, deviceName: 'Pixel' })
    })
    expect(paired.status).toBe(200)
    expect(paired.body.token).toEqual(expect.any(String))
    expect(paired.headers['cache-control']).toBe('no-store')

    const replay = await request(port, '/api/mobile/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ code: pairing.code, deviceName: 'Replay' })
    })
    expect(replay.status).toBe(410)

    const sessions = await request(port, '/api/mobile/v1/rpc', {
      method: 'POST',
      token: paired.body.token,
      body: JSON.stringify({ method: 'session:list', params: {} })
    })
    expect(sessions.status).toBe(200)
    expect(sessions.body.result[0]).toEqual({
      id: 'session-1',
      project_id: 'project-1',
      name: 'Android work',
      branch: 'feature/android',
      status: 'active',
      type: 'session',
      provider: 'claude',
      is_main_repo: true
    })
    expect(sessions.text).not.toContain('secret-provider-session')
    expect(sessions.text).not.toContain('C:\\secret')

    expect(server.revokePairedDevice(paired.body.device.id)).toBe(true)
    const revoked = await request(port, '/api/mobile/v1/rpc', {
      method: 'POST',
      token: paired.body.token,
      body: JSON.stringify({ method: 'theme:get', params: {} })
    })
    expect(revoked.status).toBe(401)
  })

  it('denies arbitrary methods and secret settings on both mobile and legacy HTTP RPC', async () => {
    const pairing = server.createPairingCode()
    const paired = await request(port, '/api/mobile/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ code: pairing.code, deviceName: 'Pixel' })
    })

    const mobileSecret = await request(port, '/api/mobile/v1/rpc', {
      method: 'POST',
      token: paired.body.token,
      body: JSON.stringify({ method: 'settings:get', params: { key: 'apiKey_openai' } })
    })
    expect(mobileSecret.status).toBe(403)
    expect(mobileSecret.text).not.toContain('super-secret-provider-key')

    const legacySecret = await request(port, '/api/rpc', {
      method: 'POST',
      token: LEGACY_TOKEN,
      body: JSON.stringify({ method: 'settings:get', args: ['apiKey_openai'] })
    })
    expect(legacySecret.status).toBe(403)
    expect(legacySecret.text).not.toContain('super-secret-provider-key')

    const mobileOnLegacyRpc = await request(port, '/api/rpc', {
      method: 'POST',
      token: paired.body.token,
      body: JSON.stringify({ method: 'settings:get', args: ['theme'] })
    })
    expect(mobileOnLegacyRpc.status).toBe(401)

    const theme = await request(port, '/api/rpc', {
      method: 'POST',
      token: LEGACY_TOKEN,
      body: JSON.stringify({ method: 'settings:get', args: ['theme'] })
    })
    expect(theme).toMatchObject({ status: 200, body: { result: 'gruvbox-dark' } })
  })

  it('rejects request bodies over the configured limit', async () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(MAX_REQUEST_BODY_BYTES) })
    const response = await request(port, '/api/mobile/v1/pair', {
      method: 'POST',
      body: oversized
    })
    expect(response.status).toBe(413)
    expect(response.body.code).toBe('request_too_large')
  })

  it('invalidates legacy HTTP, query, and active WebSocket authentication on live rotation', async () => {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const client = new WebSocket(
        `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(LEGACY_TOKEN)}`
      )
      client.once('open', () => resolve(client))
      client.once('error', reject)
    })
    const closed = new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code))
    })

    const rotatedToken = 'rotated-legacy-token'
    server.setAuthToken(rotatedToken)
    expect(await closed).toBe(1008)

    const oldRpc = await request(port, '/api/rpc', {
      method: 'POST',
      token: LEGACY_TOKEN,
      body: JSON.stringify({ method: 'settings:get', args: ['theme'] })
    })
    expect(oldRpc.status).toBe(401)
    expect((await request(port, `/rc?token=${LEGACY_TOKEN}`)).status).toBe(401)
    expect((await request(port, `/rc?token=${rotatedToken}`)).status).toBe(200)

    const newRpc = await request(port, '/api/rpc', {
      method: 'POST',
      token: rotatedToken,
      body: JSON.stringify({ method: 'settings:get', args: ['theme'] })
    })
    expect(newRpc).toMatchObject({ status: 200, body: { result: 'gruvbox-dark' } })
  })
})
