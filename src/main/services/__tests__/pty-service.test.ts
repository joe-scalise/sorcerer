import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: mocked.spawn }))
vi.mock('electron', () => ({}))
import { PTYService } from '../pty-service'

function setup() {
  const send = vi.fn()
  const window = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
  const service = new PTYService(window)
  const spawn = (id: string) => {
    let exitCallback!: (event: { exitCode: number }) => void
    const process = {
      pid: 42,
      kill: vi.fn(), write: vi.fn(), resize: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((callback) => { exitCallback = callback })
    }
    mocked.spawn.mockReturnValueOnce(process)
    service.spawn(id, '.', { command: 'fake-shell' })
    return { ...process, exit: (exitCode = 0) => exitCallback({ exitCode }) }
  }
  return { service, spawn, send }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PTY shutdown before updates', () => {
  it('blocks late spawns during update preparation and allows them again after a failed restart', () => {
    const { service, spawn } = setup()
    service.setSpawnsBlocked(true)
    mocked.spawn.mockClear()
    expect(() => service.spawn('late', '.', { command: 'fake-shell' })).toThrow('preparing to restart')
    expect(mocked.spawn).not.toHaveBeenCalled()
    expect(service.isRunning('late')).toBe(false)
    service.setSpawnsBlocked(false)
    spawn('retry')
    expect(service.isRunning('retry')).toBe(true)
    expect(mocked.spawn).toHaveBeenCalledTimes(1)
  })

  it('waits for every actual exit and invokes all consumers before resolving', async () => {
    const { service, spawn } = setup()
    const first = spawn('first')
    const second = spawn('second')
    const called: string[] = []
    service.onExit((id) => called.push(`first:${id}`))
    const waiting = service.killAllAndWaitStrict()
    service.onExit((id) => called.push(`last:${id}`))
    let finished = false
    void waiting.then(() => { finished = true; called.push('finished') })
    first.exit()
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(service.isRunning('second')).toBe(false)
    second.exit()
    await waiting
    expect(called).toEqual(['first:first', 'last:first', 'first:second', 'last:second', 'finished'])
    expect(first.kill).toHaveBeenCalledTimes(1)
    expect(second.kill).toHaveBeenCalledTimes(1)
  })

  it('rejects a timeout and continues tracking the live process for retry', async () => {
    vi.useFakeTimers()
    const { service, spawn } = setup()
    const process = spawn('slow')
    const timedOut = expect(service.killAllAndWaitStrict(100)).rejects.toThrow('did not stop')
    await vi.advanceTimersByTimeAsync(100)
    await timedOut
    expect(service.isRunning('slow')).toBe(false)
    const retry = service.killAllAndWaitStrict(100)
    let finished = false
    void retry.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    process.exit()
    await retry
    expect(process.kill).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('includes a process previously killed through the ordinary API until actual exit', async () => {
    const { service, spawn } = setup()
    const process = spawn('already-killed')
    service.kill('already-killed')
    const waiting = service.killAllAndWaitStrict()
    let finished = false
    void waiting.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    process.exit()
    await waiting
  })

  it('cleans timers on kill errors and still waits for the other terminals', async () => {
    vi.useFakeTimers()
    const { service, spawn } = setup()
    const failed = spawn('failed')
    const other = spawn('other')
    failed.kill.mockImplementationOnce(() => { throw new Error('kill failed') })
    const waiting = service.killAllAndWaitStrict(100)
    let finished = false
    void waiting.catch(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    other.exit()
    await expect(waiting).rejects.toThrow('kill failed')
    expect(vi.getTimerCount()).toBe(0)
    const retry = service.killAllAndWaitStrict(100)
    failed.exit()
    await retry
  })

  it('invokes later persistence listeners even if an earlier listener throws', async () => {
    vi.useFakeTimers()
    const { service, spawn, send } = setup()
    const process = spawn('session')
    send.mockImplementation(() => { throw new Error('window closed') })
    const later = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.onExit(() => { throw new Error('persistence failed') })
    service.onExit(later)
    const waiting = service.killAllAndWaitStrict(100)
    process.exit()
    await expect(waiting).rejects.toThrow('persistence failed')
    expect(later).toHaveBeenCalledWith('session', 0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves permissive timeout behavior for an ordinary application quit', async () => {
    vi.useFakeTimers()
    const { service, spawn } = setup()
    spawn('slow')
    const waiting = service.killAllAndWait(100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(waiting).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles a synchronous exit fired from kill without missing the event', async () => {
    const { service, spawn } = setup()
    const process = spawn('sync')
    process.kill.mockImplementationOnce(() => process.exit())
    await expect(service.killAllAndWaitStrict()).resolves.toBeUndefined()
    await expect(service.killAllAndWaitStrict()).resolves.toBeUndefined()
    expect(process.kill).toHaveBeenCalledTimes(1)
  })
})
