import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('os', () => ({ default: { homedir: () => home.path, platform: () => process.platform } }))
vi.mock('electron', () => ({}))
vi.mock('child_process', () => ({ spawnSync: () => ({ status: 0, stdout: 'Usage: copilot --session-id <id> --model <model>' }) }))
vi.mock('../../services/provider-registry', () => ({
  resolveLaunchModel: (_db: unknown, _provider: string, model?: string) => model || '',
  getDefaultProviderId: () => 'copilot'
}))
import { createSession, restartSession, resumeSession, getSessionResumeHealth, scanImportableSessions, importExternalSessions, getSessionDiagnostics, startAgent, resumeAgent, restartAgent } from '../../ipc/shared-handlers'
import type { HandlerServices } from '../../ipc/shared-handlers'
import { AgentOrchestrator } from '../../services/agent-orchestrator'

let sessions: any[]
let agent: any
let db: any
let pty: any
let services: HandlerServices
let cwd: string
beforeEach(() => {
  home.path = fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), 'sorcerer-copilot-lifecycle-'))
  vi.stubEnv('COPILOT_HOME', path.join(home.path, '.copilot'))
  cwd = path.join(home.path, 'project')
  fs.mkdirSync(cwd)
  sessions = []
  agent = { id: 'agent-one', provider: 'copilot', mission: 'Check status', bypass_permissions: 1 }
  db = {
    getSetting: () => 'true',
    getProject: () => ({ id: 'project', name: 'Project', path: cwd }),
    listProjects: () => [{ id: 'project', name: 'Project', path: cwd }],
    listSessions: () => sessions,
    getSession: (id: string) => sessions.find(session => session.id === id),
    addSession: (session: any) => { sessions.push(session); return session },
    updateSession: (id: string, updates: any) => Object.assign(db.getSession(id), updates),
    getAgent: () => agent,
    updateAgent: (_id: string, updates: any) => Object.assign(agent, updates)
  }
  pty = { spawn: vi.fn(), getPid: () => 123, isRunning: () => false, kill: vi.fn(), scrollback: { getScrollback: () => '' } }
  services = { db, pty, worktree: {}, fileWatcher: {} } as HandlerServices
})
afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(home.path, { recursive: true, force: true })
})
function save(id: string, folder = cwd) {
  const root = path.join(home.path, '.copilot/session-state', id)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ type: 'session.start', data: { sessionId: id, context: { cwd: folder } } }))
  fs.writeFileSync(path.join(root, 'workspace.yaml'), 'summary: Imported conversation\n')
}

it('creates pinned sessions, blocks missing history, resumes exact identity, and gives restarts a new conversation', async () => {
  const session = await createSession(services, 'project', 'Work', true, false, false, 'copilot')
  const id = session.provider_session_id
  expect(id).toBeTruthy()
  expect(pty.spawn.mock.calls[0][2].args).toContain(`--session-id=${id}`)
  expect(pty.spawn.mock.calls[0][2].args).not.toContain('--allow-all')
  expect((await getSessionResumeHealth(services, session.id)).canResume).toBe(false)
  await expect(resumeSession(services, session.id)).rejects.toThrow('missing')
  expect(pty.spawn).toHaveBeenCalledOnce()
  save(id)
  expect((await getSessionResumeHealth(services, session.id)).canResume).toBe(true)
  await resumeSession(services, session.id)
  expect(pty.spawn.mock.calls.at(-1)[2].args).toContain(`--resume=${id}`)
  expect(getSessionDiagnostics(services, session.id)).toMatchObject({ providerThreadId: id, providerThreadLabel: 'Copilot Session' })
  await restartSession(services, session.id)
  expect(session.provider_session_id).not.toBe(id)
  expect(pty.spawn.mock.calls.at(-1)[2].args).toContain(`--session-id=${session.provider_session_id}`)
})

it('imports external conversations with validated identities and does not offer them twice', async () => {
  const id = 'd1e093fd-23a3-414b-b9e8-200642414e10'
  save(id)
  const candidates = await scanImportableSessions(services)
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ id: `copilot:${id}`, title: 'Imported conversation', projectId: 'project' })
  const [imported] = await importExternalSessions(services, [`copilot:${id}`])
  expect(imported).toMatchObject({ provider: 'copilot', provider_session_id: id, resume_status: 'ready', provider_session_source: 'import-validated' })
  expect(await scanImportableSessions(services)).toEqual([])
  await resumeSession(services, imported.id)
  expect(pty.spawn.mock.calls.at(-1)[2].args).toContain(`--resume=${id}`)
})

it('isolates experimental Agent histories and resumes missions with their own conversation', () => {
  startAgent(services, agent.id)
  const id = agent.provider_session_id
  expect(pty.spawn.mock.calls.at(-1)[2].args).toEqual(expect.arrayContaining(['-p', 'Check status', '--allow-all', `--session-id=${id}`]))
  expect(() => resumeAgent(services, agent.id)).toThrow('missing')
  save(id, path.join(home.path, '.sorcerer/agents', agent.id))
  resumeAgent(services, agent.id)
  expect(pty.spawn.mock.calls.at(-1)[2].args).toContain(`--resume=${id}`)
  restartAgent(services, agent.id)
  expect(agent.provider_session_id).not.toBe(id)
})

it('resumes each scheduled mission with its pinned conversation rather than global history', () => {
  vi.useFakeTimers()
  db.listAgents = () => [agent]
  db.getLatestAgentRun = () => ({})
  db.saveAgentRun = vi.fn()
  db.listAgentRuns = () => []
  pty.onExit = vi.fn()
  const orchestrator = new AgentOrchestrator(db, pty, null)
  try {
    orchestrator.start()
    orchestrator.runNow(agent.id)
    const id = agent.provider_session_id
    save(id, path.join(home.path, '.sorcerer/agents', agent.id))
    pty.onExit.mock.calls[0][0](agent.id, 0)
    orchestrator.runNow(agent.id)
    expect(pty.spawn.mock.calls.at(-1)[2].args).toEqual(expect.arrayContaining(['-p', 'Check status', `--resume=${id}`]))
    expect(pty.spawn.mock.calls.at(-1)[2].args).not.toContain('--continue')
  } finally {
    orchestrator.stop()
    vi.useRealTimers()
  }
})
