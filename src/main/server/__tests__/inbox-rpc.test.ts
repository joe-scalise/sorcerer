import fs from 'fs'
import path from 'path'
import http from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => home.path, networkInterfaces: () => ({}) } }))
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))
import { ApiServer } from '../api-server'
import { DatabaseService } from '../../services/database-service'

const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd())
const token = 'isolated-inbox-test-token'
let db: DatabaseService
let server: ApiServer
let port: number

beforeEach(async () => {
  home.path = fs.mkdtempSync(path.join(tempRoot, 'sorcerer-inbox-rpc-'))
  db = new DatabaseService()
  await db.ensureReady()
  server = new ApiServer({
    db, pty: { onOutput: vi.fn(), onExit: vi.fn(), removeOutputListener: vi.fn(), removeExitListener: vi.fn() },
    fileWatcher: { onEvent: vi.fn() }, worktree: {}
  } as any, { port: 0, bindAddress: '127.0.0.1', authToken: token })
  await server.start()
  port = (server.getHttpServer()!.address() as { port: number }).port
})
afterEach(() => {
  server.stop()
  db.close()
  if (path.resolve(home.path).startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(home.path, { recursive: true, force: true })
})

function rpc(method: string, args: unknown[] = [], authenticate = true): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, args })
    const request = http.request({
      hostname: '127.0.0.1', port, path: '/api/rpc', method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        ...(authenticate ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

describe('inbox browser transport', () => {
  it('uses the same durable manual lifecycle through authenticated RPC', async () => {
    expect((await rpc('inbox:list', [], false)).status).toBe(401)
    const created = await rpc('inbox:create', [{ title: 'Remember this from the browser', body: 'Human input' }])
    expect(created.status).toBe(200)
    const id = created.body.result.id
    expect((await rpc('inbox:update', [id, { pinned: true, status: 'done' }])).body.result).toMatchObject({ id, pinned: true, status: 'done' })
    expect((await rpc('inbox:list')).body.result).toEqual(db.listInboxItems())
    const invalid = await rpc('inbox:update', [id, { status: 'running', session_id: 'session' }])
    expect(invalid.body).toHaveProperty('error')
    expect(db.listInboxItems()[0]).toMatchObject({ id, status: 'done' })
    expect((await rpc('inbox:delete', [id], false)).status).toBe(401)
    expect((await rpc('inbox:delete', [id])).status).toBe(200)
    expect((await rpc('inbox:list')).body.result).toEqual([])
  })
})
