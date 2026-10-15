import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotRunner, CopilotSessionBackend } from '../copilot-backend'

let root: string
let cwd: string
let backend: CopilotSessionBackend
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-copilot-test-'))
  cwd = path.join(root, 'project with spaces')
  fs.mkdirSync(cwd)
  backend = new CopilotSessionBackend(() => root)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }) })

function save(id: string, folder = cwd, metadata = '') {
  const directory = path.join(root, 'session-state', id)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({
    type: 'session.start', timestamp: '2026-10-15T12:00:00Z',
    data: { sessionId: id, context: { cwd: folder }, selectedModel: 'custom-model' }
  }) + '\n{"partial":')
  if (metadata) fs.writeFileSync(path.join(directory, 'workspace.yaml'), metadata)
  return directory
}

describe('Copilot conversation identity', () => {
  it('pins fresh launches independently and resumes only the exact saved conversation', () => {
    const first = backend.fresh()
    const second = backend.fresh()
    expect(second.id).not.toBe(first.id)
    expect(first.args).toEqual([`--session-id=${first.id}`])
    expect(() => backend.resume(first.id, cwd)).toThrow('missing')
    save(first.id)
    save(second.id)
    expect(backend.resume(first.id, cwd)).toEqual({ id: first.id, args: [`--resume=${first.id}`] })
    expect(backend.validate(first.id, path.join(root, 'other'))).toBe(false)
    expect(() => backend.resume(null, cwd)).toThrow()
    expect(backend.validate('../outside', cwd)).toBe(false)
    expect(backend.validate(first.id.slice(0, 8), cwd)).toBe(false)
  })

  it('discovers custom names and timestamps without reading message content', () => {
    const { id } = backend.fresh()
    save(id, cwd, `id: ${id}\nsummary: My saved conversation\ncreated_at: 2026-10-15T12:00:00Z\nupdated_at: 2026-10-15T13:00:00Z\n`)
    expect(backend.discover()).toEqual([{
      id, cwd, title: 'My saved conversation', createdAt: 1792065600,
      updatedAt: 1792069200, model: 'custom-model'
    }])
  })

  it('rejects conflicting metadata, corrupt history and missing session identities', () => {
    const { id } = backend.fresh()
    const directory = save(id, cwd, 'id: different-session\n')
    expect(backend.validate(id, cwd)).toBe(false)
    fs.writeFileSync(path.join(directory, 'workspace.yaml'), 'cwd: /another-project\n')
    expect(backend.validate(id, cwd)).toBe(false)
    fs.unlinkSync(path.join(directory, 'workspace.yaml'))
    fs.writeFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ type: 'session.start', data: { sessionId: 'wrong', context: { cwd } } }))
    expect(backend.discover()).toEqual([])
    fs.writeFileSync(path.join(directory, 'events.jsonl'), 'broken')
    expect(backend.validate(id, cwd)).toBe(false)
  })

  it('retains a conversation when optional workspace metadata is unavailable', () => {
    const { id } = backend.fresh()
    save(id, cwd)
    expect(backend.discover()[0]).toMatchObject({ id, cwd, title: 'project with spaces' })
  })
})

describe('Copilot launch options', () => {
  it.skipIf(process.platform !== 'win32')('launches the Windows npm loader without a command shell', () => {
    const directory = path.join(root, 'npm with spaces')
    const loader = path.join(directory, 'node_modules/@github/copilot/npm-loader.js')
    fs.mkdirSync(path.dirname(loader), { recursive: true })
    fs.writeFileSync(path.join(directory, 'copilot.cmd'), '')
    fs.writeFileSync(loader, '')
    vi.stubEnv('PATH', directory)
    const runner = new CopilotRunner()
    expect(runner.resolveBinary()).toBe(process.execPath)
    expect(runner.getArgs({ mission: 'quoted "input" & data', bypassPermissions: true })[0]).toBe(loader)
    expect(runner.probeArgs()).toEqual([loader, '--help'])
    expect(runner.getEnv('one')).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })
  it('supports the legacy UUID flag as well as the current exact-session flag', () => {
    const runner = new CopilotRunner()
    runner.observeHelp('Usage: copilot --resume[=sessionId]')
    const legacy = runner.sessionBackend.fresh()
    expect(legacy.args).toEqual([`--resume=${legacy.id}`])
    runner.observeHelp('Usage: copilot --session-id <id>')
    const current = runner.sessionBackend.fresh()
    expect(current.args).toEqual([`--session-id=${current.id}`])
  })
  it('uses native model and interactive permission defaults without global history selection', () => {
    const runner = new CopilotRunner()
    expect(runner.getArgs({ hasHistory: true })).toEqual(['--no-auto-update'])
    expect(runner.getEnv('one')).toEqual({})
    expect(runner.capabilities.supportsSystemPrompt).toBe(false)
    expect(runner.capabilities.supportsRemoteControl).toBe(false)
    expect(() => runner.getArgs({ mission: 'Check status', bypassPermissions: false })).toThrow('unattended mode')
    vi.stubEnv('COPILOT_HOME', root)
    expect(runner.getArgs({})).toEqual(['--no-auto-update', '--config-dir', root])
  })
  it('maps missions, model overrides, unattended mode and MCP without shell interpolation', () => {
    const mission = 'Review "quoted" work; $(nothing)'
    expect(new CopilotRunner().getArgs({ mission, model: 'custom', bypassPermissions: true, mcpConfig: 'C:\\MCP config.json' })).toEqual([
      '--no-auto-update', '--allow-all', '--model', 'custom', '--additional-mcp-config', '@C:\\MCP config.json', '-p', mission
    ])
    expect(new CopilotRunner().getArgs({ mcpConfig: '{"mcpServers":{}}' })).toContain('{"mcpServers":{}}')
  })
})
