import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})
import { ipcMain } from 'electron'
import { flushUpdateDrafts } from '../update-restart'

function fakeWindow(id: number) {
  const contents = Object.assign(new EventEmitter(), {
    id,
    mainFrame: {},
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: vi.fn(() => false) })
  return { window, contents, browserWindow: window as unknown as BrowserWindow }
}

function acknowledge(target: ReturnType<typeof fakeWindow>, response: Record<string, unknown> = {}, frame = target.contents.mainFrame) {
  ipcMain.emit('updates:prepared', { sender: target.contents, senderFrame: frame }, {
    requestId: target.contents.send.mock.calls[0][1].requestId,
    ok: true,
    ...response
  })
}

function expectClean(...targets: ReturnType<typeof fakeWindow>[]) {
  expect(ipcMain.listenerCount('updates:prepared')).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  for (const { window, contents } of targets) {
    expect(window.listenerCount('closed')).toBe(0)
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  ipcMain.removeAllListeners()
  vi.useRealTimers()
})

describe('update draft flush handshake', () => {
  it('requires both main and popout windows to confirm their notes were saved', async () => {
    const main = fakeWindow(1)
    const popout = fakeWindow(2)
    const completed = vi.fn()
    const result = flushUpdateDrafts([main.browserWindow, popout.browserWindow]).then(completed)
    expect(main.contents.send).toHaveBeenCalledWith('updates:prepare-install', { requestId: expect.any(String) })
    expect(popout.contents.send.mock.calls[0][1]).toEqual(main.contents.send.mock.calls[0][1])
    acknowledge(main)
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    acknowledge(popout)
    await result
    expect(completed).toHaveBeenCalledOnce()
    expectClean(main, popout)
  })

  it('registers acknowledgements before sending, including synchronous replies', async () => {
    const main = fakeWindow(1)
    main.contents.send.mockImplementation((_channel, { requestId }) => {
      ipcMain.emit('updates:prepared', { sender: main.contents, senderFrame: main.contents.mainFrame }, { requestId, ok: true })
    })
    await flushUpdateDrafts([main.browserWindow])
    expectClean(main)
  })

  it('ignores unrelated senders, child frames, stale requests, and duplicate replies', async () => {
    const main = fakeWindow(1)
    const popout = fakeWindow(2)
    const stranger = fakeWindow(3)
    const result = flushUpdateDrafts([main.browserWindow, popout.browserWindow])
    const rejected = expect(result).rejects.toThrow('did not finish saving')
    const requestId = main.contents.send.mock.calls[0][1].requestId
    ipcMain.emit('updates:prepared', { sender: stranger.contents, senderFrame: stranger.contents.mainFrame }, { requestId, ok: true })
    acknowledge(main, { requestId: 'old-request' })
    acknowledge(main, {}, {})
    acknowledge(popout)
    acknowledge(popout)
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expectClean(main, popout)
  })

  it('rejects a failed draft save and removes all listeners', async () => {
    const main = fakeWindow(1)
    const result = flushUpdateDrafts([main.browserWindow])
    const rejected = expect(result).rejects.toThrow('Notes could not be saved: Disk full')
    acknowledge(main, { ok: false, error: 'Disk full' })
    await rejected
    expectClean(main)
  })

  it('does not accept a truthy non-boolean success value', async () => {
    const main = fakeWindow(1)
    const result = flushUpdateDrafts([main.browserWindow])
    const rejected = expect(result).rejects.toThrow('Notes could not be saved')
    acknowledge(main, { ok: 'true' })
    await rejected
    expectClean(main)
  })

  it.each(['closed', 'destroyed', 'render-process-gone'])('rejects when an acknowledged window becomes unavailable: %s', async (event) => {
    const main = fakeWindow(1)
    const popout = fakeWindow(2)
    const result = flushUpdateDrafts([main.browserWindow, popout.browserWindow])
    const rejected = expect(result).rejects.toThrow('before all notes were saved')
    acknowledge(main)
    if (event === 'closed') main.window.emit(event)
    else main.contents.emit(event)
    await rejected
    expectClean(main, popout)
  })

  it('rejects renderer replacement but permits in-page or child navigation', async () => {
    const main = fakeWindow(1)
    const result = flushUpdateDrafts([main.browserWindow])
    const rejected = expect(result).rejects.toThrow('before all notes were saved')
    main.contents.emit('did-start-navigation', {}, 'file:///app#notes', true, true)
    main.contents.emit('did-start-navigation', {}, 'about:blank', false, false)
    expect(ipcMain.listenerCount('updates:prepared')).toBe(1)
    main.contents.emit('did-start-navigation', {}, 'file:///app', false, true)
    await rejected
    expectClean(main)
  })

  it('rejects send failures without waiting for the deadline', async () => {
    const main = fakeWindow(1)
    main.contents.send.mockImplementation(() => { throw new Error('IPC unavailable') })
    await expect(flushUpdateDrafts([main.browserWindow])).rejects.toThrow('Could not ask every window')
    expectClean(main)
  })

  it('skips windows already closed before the handshake begins', async () => {
    const old = fakeWindow(1)
    old.window.isDestroyed.mockReturnValue(true)
    await flushUpdateDrafts([old.browserWindow])
    expect(old.contents.send).not.toHaveBeenCalled()
    expectClean(old)
  })

  it('fails if a live window has already lost its renderer', async () => {
    const main = fakeWindow(1)
    main.contents.isDestroyed.mockReturnValue(true)
    await expect(flushUpdateDrafts([main.browserWindow])).rejects.toThrow('window closed')
    expectClean(main)
  })

  it('uses a fresh request ID for retries', async () => {
    const main = fakeWindow(1)
    const first = flushUpdateDrafts([main.browserWindow])
    acknowledge(main)
    await first
    const oldId = main.contents.send.mock.calls[0][1].requestId
    main.contents.send.mockClear()
    const second = flushUpdateDrafts([main.browserWindow])
    expect(main.contents.send.mock.calls[0][1].requestId).not.toBe(oldId)
    acknowledge(main)
    await second
    expectClean(main)
  })
})
