// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PopoutTerminal } from '../../PopoutApp'
import { TerminalView, disposeTerminal } from '../TerminalView'

const mocks = vi.hoisted(() => ({
  instances: [] as any[],
  exit: undefined as undefined | ((code: number) => void),
  unsubscribe: vi.fn(),
  scrollback: vi.fn(),
  settings: vi.fn(),
  resize: vi.fn(),
  write: vi.fn()
}))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}
  cols = 80
  rows = 24
  loadAddon = vi.fn()
  open = vi.fn()
  write = vi.fn()
  writeln = vi.fn()
  focus = vi.fn()
  dispose = vi.fn()
  onData = vi.fn()
  onSelectionChange = vi.fn()
  attachCustomKeyEventHandler = vi.fn()
  constructor() { mocks.instances.push(this) }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('../../api/client', () => ({ getApi: () => ({
  settings: { get: mocks.settings },
  popout: { getScrollback: mocks.scrollback, notifySessionUpdated: vi.fn() },
  terminal: {
    write: mocks.write,
    resize: mocks.resize,
    onData: () => mocks.unsubscribe,
    onExit: (_id: string, callback: (code: number) => void) => {
      mocks.exit = callback
      return mocks.unsubscribe
    }
  }
}) }))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.instances.length = 0
  mocks.settings.mockResolvedValue(undefined)
  mocks.scrollback.mockResolvedValue('saved output')
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  disposeTerminal('keyboard-test')
  host.remove()
  vi.unstubAllGlobals()
})

it.each(['main', 'popout'] as const)('preserves Codex question keys in the %s terminal', async (surface) => {
  await act(async () => root.render(surface === 'main'
    ? <TerminalView sessionId="keyboard-test" />
    : <PopoutTerminal sessionId="keyboard-test" onExited={() => {}} />))
  const terminal = mocks.instances[0]
  const handler = terminal.attachCustomKeyEventHandler.mock.calls[0][0]
  const onData = terminal.onData.mock.calls[0][0]
  const keys: Array<[string, KeyboardEventInit, string]> = [
    ['ArrowLeft', { shiftKey: true }, '\x1b[1;2D'],
    ['ArrowRight', { shiftKey: true }, '\x1b[1;2C'],
    ['ArrowUp', { altKey: true }, '\x1b[1;3A'],
    ['ArrowDown', { altKey: true }, '\x1b[1;3B'],
    ['Tab', {}, '\t'],
    ['Tab', { shiftKey: true }, '\x1b[Z'],
    ['ArrowUp', {}, '\x1b[A'],
    ['ArrowDown', {}, '\x1b[B'],
    ['Enter', {}, '\r'],
    ['Escape', {}, '\x1b']
  ]
  for (const [key, modifiers, data] of keys) {
    for (const type of ['keydown', 'keyup']) {
      const event = new KeyboardEvent(type, { key, ...modifiers, cancelable: true })
      expect(handler(event), `${type}: ${key}`).toBe(true)
      expect(event.defaultPrevented).toBe(false)
    }
    // xterm's encoded input must reach the session's PTY unchanged.
    onData(data)
    expect(mocks.write).toHaveBeenLastCalledWith('keyboard-test', data)
  }
  expect(mocks.write).toHaveBeenCalledTimes(keys.length)
  if (surface === 'main') {
    const navigation = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true })
    expect(handler(navigation)).toBe(false)
    expect(navigation.defaultPrevented).toBe(false) // window shortcut owns it
    expect(handler(new KeyboardEvent('keydown', {
      key: 'ArrowDown', ctrlKey: true, altKey: true, shiftKey: true
    }))).toBe(true)
  }
})

it('keeps the terminal and subscriptions across metadata renders and uses the latest exit handler', async () => {
  const first = vi.fn()
  const latest = vi.fn()
  await act(async () => root.render(<PopoutTerminal sessionId="one" onExited={first} />))
  const terminal = mocks.instances[0]
  for (let i = 0; i < 5; i++) {
    await act(async () => root.render(<PopoutTerminal sessionId="one" onExited={() => latest()} />))
  }
  expect(mocks.instances).toHaveLength(1)
  expect(terminal.dispose).not.toHaveBeenCalled()
  expect(mocks.unsubscribe).not.toHaveBeenCalled()
  expect(mocks.scrollback).toHaveBeenCalledTimes(1)
  act(() => mocks.exit!(0))
  expect(first).not.toHaveBeenCalled()
  expect(latest).toHaveBeenCalledOnce()
  await act(async () => root.render(<PopoutTerminal sessionId="two" onExited={latest} />))
  expect(terminal.dispose).toHaveBeenCalledOnce()
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(2)
  expect(mocks.instances).toHaveLength(2)
})

it('ignores initialization results arriving after unmount', async () => {
  let resolveScrollback!: (value: string) => void
  let resolveSettings!: (value: string) => void
  mocks.scrollback.mockReturnValue(new Promise<string>(resolve => { resolveScrollback = resolve }))
  mocks.settings.mockReturnValue(new Promise<string>(resolve => { resolveSettings = resolve }))
  await act(async () => root.render(<PopoutTerminal sessionId="one" onExited={() => {}} />))
  const terminal = mocks.instances[0]
  act(() => root.render(null))
  await act(async () => { resolveScrollback('late output'); resolveSettings('18') })
  expect(terminal.write).not.toHaveBeenCalled()
  expect(terminal.options).toEqual({})
  expect(mocks.resize).not.toHaveBeenCalled()
  expect(cancelAnimationFrame).toHaveBeenCalled()
})
