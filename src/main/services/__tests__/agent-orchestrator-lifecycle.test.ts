import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseService } from '../database-service'
import type { PTYService } from '../pty-service'

vi.mock('electron', () => ({}))
vi.mock('fs', () => ({ default: { mkdirSync: vi.fn() } }))
vi.mock('../../ipc/shared-handlers', () => ({ ensureProviderTrust: vi.fn() }))
vi.mock('../provider-registry', () => ({ resolveLaunchModel: () => 'test-model' }))
vi.mock('../provider-runners', () => ({
  getProviderRunner: () => ({ getArgs: () => [], resolveBinary: () => 'test-agent', getEnv: () => ({}) })
}))

import { AgentOrchestrator } from '../agent-orchestrator'

function setup(hasHistory = false) {
  const agent = { id: 'agent-one', name: 'Scheduled agent', mission: 'Check work', schedule_minutes: 1, last_run_at: 0, provider: 'claude', model: 'test-model' }
  const db = {
    getSetting: vi.fn(() => 'true'),
    listAgents: vi.fn(() => [agent]), getAgent: vi.fn(() => agent),
    getLatestAgentRun: vi.fn(() => hasHistory ? {} : undefined),
    updateAgent: vi.fn(), saveAgentRun: vi.fn(), listAgentRuns: vi.fn(() => [])
  }
  const pty = {
    isRunning: vi.fn(() => false), spawn: vi.fn(), write: vi.fn(), getPid: vi.fn(() => 123),
    onExit: vi.fn<(listener: (id: string, code: number) => void) => void>(),
    scrollback: { getScrollback: vi.fn(() => 'Finished work') }
  }
  const orchestrator = new AgentOrchestrator(db as unknown as DatabaseService, pty as unknown as PTYService, null)
  return { orchestrator, db, pty }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('agent orchestrator restart lifecycle', () => {
  it('never schedules or runs Agents while the feature is disabled', () => {
    const { orchestrator, db, pty } = setup()
    db.getSetting.mockReturnValue('false')
    orchestrator.start()
    orchestrator.runNow('agent-one')
    vi.advanceTimersByTime(120_000)
    expect(pty.spawn).not.toHaveBeenCalled()
    expect(db.listAgents).not.toHaveBeenCalled()
    expect(pty.onExit).not.toHaveBeenCalled()
    // Saving the preference cannot start work in the current process.
    db.getSetting.mockReturnValue('true')
    orchestrator.start()
    vi.advanceTimersByTime(120_000)
    expect(pty.spawn).not.toHaveBeenCalled()
  })

  it('cancels the startup check when stopped before its first scheduled poll', () => {
    const { orchestrator, pty, db } = setup()
    orchestrator.start()
    orchestrator.stop()
    vi.advanceTimersByTime(60_000)
    expect(db.listAgents).not.toHaveBeenCalled()
    expect(pty.spawn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resumes with a fresh startup delay and exactly one exit listener', () => {
    const { orchestrator, pty } = setup()
    orchestrator.start()
    vi.advanceTimersByTime(4_000)
    orchestrator.stop()
    orchestrator.start()
    vi.advanceTimersByTime(1_000)
    expect(pty.spawn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4_000)
    expect(pty.spawn).toHaveBeenCalledOnce()
    expect(pty.onExit).toHaveBeenCalledOnce()
    orchestrator.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not launch a startup-requested mission while stopped', () => {
    const { orchestrator, pty } = setup()
    orchestrator.start()
    orchestrator.stop()
    orchestrator.runNow('agent-one')
    expect(pty.spawn).not.toHaveBeenCalled()
  })

  it('cancels delayed mission input during update shutdown', () => {
    const { orchestrator, pty } = setup(true)
    orchestrator.start()
    vi.advanceTimersByTime(5_000)
    expect(pty.spawn).toHaveBeenCalledOnce()
    pty.isRunning.mockReturnValue(true)
    orchestrator.stop()
    vi.advanceTimersByTime(5_000)
    expect(pty.write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still captures running agent exits after scheduling has stopped', async () => {
    const { orchestrator, pty, db } = setup()
    orchestrator.start()
    vi.advanceTimersByTime(5_000)
    orchestrator.stop()
    pty.onExit.mock.calls[0][0]('agent-one', 0)
    await Promise.resolve()
    expect(db.saveAgentRun).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent-one', output: 'Finished work' }))
    expect(db.updateAgent).toHaveBeenLastCalledWith('agent-one', expect.objectContaining({ status: 'idle', pid: null }))
  })

  it('does not send a completed run\'s delayed mission to a replacement terminal', async () => {
    const { orchestrator, pty } = setup(true)
    orchestrator.start()
    vi.advanceTimersByTime(5_000)
    pty.onExit.mock.calls[0][0]('agent-one', 0)
    await Promise.resolve()
    pty.isRunning.mockReturnValue(true)
    vi.advanceTimersByTime(5_000)
    expect(pty.write).not.toHaveBeenCalled()
    orchestrator.stop()
  })

  it('propagates run persistence failure to the PTY exit collector and permits a later retry', () => {
    const { orchestrator, pty, db } = setup()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('Disk full')
    try {
      orchestrator.start()
      vi.advanceTimersByTime(5_000)
      orchestrator.stop()
      db.saveAgentRun.mockImplementationOnce(() => { throw failure })
      expect(() => pty.onExit.mock.calls[0][0]('agent-one', 0)).toThrow(failure)
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to complete agent run'), failure)
      orchestrator.start()
      orchestrator.runNow('agent-one')
      expect(pty.spawn).toHaveBeenCalledTimes(2)
      orchestrator.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      errorLog.mockRestore()
    }
  })
})
