import { describe, expect, it, vi } from 'vitest'
import { getFeatureFlags, requireStandaloneAgents } from '../features'
import {
  addAgent, createAgentQuickTerminal, deleteQuickNote, killAgent, listAgents,
  listQuickNoteParents, listSessions, loadQuickNote, removeAgent, restartAgent,
  resumeAgent, saveQuickNote, setAgentRemoteControl, startAgent, updateAgent,
  type HandlerServices
} from '../../ipc/shared-handlers'

describe('standalone Agents capability', () => {
  it.each([undefined, 'false', '1', 'TRUE'])('defaults off for %s', (value) => {
    const db = { getSetting: () => value }
    expect(getFeatureFlags(db).standaloneAgents).toBe(false)
    expect(() => requireStandaloneAgents(db)).toThrow('restart Sorcerer')
  })

  it('keeps the running capability unchanged until a new database lifecycle', () => {
    let preference = 'false'
    const db = { getSetting: () => preference }
    expect(getFeatureFlags(db).standaloneAgents).toBe(false)
    preference = 'true'
    expect(getFeatureFlags(db).standaloneAgents).toBe(false)
    const restartedDb = { getSetting: () => preference }
    expect(getFeatureFlags(restartedDb).standaloneAgents).toBe(true)
    preference = 'false'
    expect(getFeatureFlags(restartedDb).standaloneAgents).toBe(true)
  })

  it('reuses the process snapshot when macOS reopens a window with a new database service', () => {
    let preference = 'false'
    const initial = getFeatureFlags({ getSetting: () => preference })
    preference = 'true'
    const reopenedDb = { getSetting: () => preference }
    expect(getFeatureFlags(reopenedDb, initial)).toBe(initial)
    expect(getFeatureFlags(reopenedDb).standaloneAgents).toBe(false)
    expect(getFeatureFlags({ getSetting: () => preference }).standaloneAgents).toBe(true)
  })

  it('hides Agent data without changing stored records or Project sessions', () => {
    const agent = { id: 'agent', mission: 'Retain mission', schedule_minutes: 10 }
    const session = { id: 'session', project_id: 'project' }
    let preference = 'false'
    const stored = {
      listAgents: vi.fn(() => [agent]), listSessions: () => [session],
      listQuickNoteParents: () => [{ parent_id: 'agent', parent_type: 'agent' }, { parent_id: 'session', parent_type: 'session' }],
      getQuickNote: () => ({ content: 'Retained note' })
    }
    const db = { ...stored, getSetting: () => preference }
    const services = { db } as unknown as HandlerServices
    expect(listAgents(services)).toEqual([])
    expect(stored.listAgents).not.toHaveBeenCalled()
    expect(listSessions(services)).toEqual([session])
    expect(listQuickNoteParents(services)).toEqual([{ parent_id: 'session', parent_type: 'session' }])
    expect(loadQuickNote(services, 'agent', 'agent')).toBeUndefined()
    preference = 'true'
    const restarted = { db: { ...stored, getSetting: () => preference } } as unknown as HandlerServices
    expect(listAgents(restarted)).toEqual([agent])
    expect(loadQuickNote(restarted, 'agent', 'agent')).toEqual({ content: 'Retained note' })
  })

  it('rejects all Agent mutation and execution paths before touching data or processes', () => {
    // Only getSetting is present: any database, filesystem, or PTY work before
    // the guard would fail with a different error.
    const services = { db: { getSetting: () => undefined }, pty: {} } as unknown as HandlerServices
    const actions = [
      () => addAgent(services, { name: 'Agent' }), () => updateAgent(services, 'a', {}),
      () => removeAgent(services, 'a'), () => startAgent(services, 'a'),
      () => resumeAgent(services, 'a'), () => restartAgent(services, 'a'),
      () => createAgentQuickTerminal(services, 'a'), () => killAgent(services, 'a'),
      () => setAgentRemoteControl(services, 'a', true),
      () => saveQuickNote(services, 'n', 'a', 'agent', 'Keep'),
      () => deleteQuickNote(services, 'a', 'agent')
    ]
    for (const action of actions) expect(action).toThrow('Agents are disabled')
  })
})
