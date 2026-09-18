// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogButton } from '../Dialog'
import { DialogSelect } from '../DialogSelect'

vi.mock('../TerminalView', () => ({ disposeTerminal: vi.fn(), focusTerminal: vi.fn() }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as any)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function key(target: Element, key: string, shiftKey = false) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })))
}

describe('dialog keyboard boundaries', () => {
  it('restores the opener when a child uses autofocus', () => {
    const opener = document.createElement('button')
    document.body.prepend(opener)
    opener.focus()
    act(() => root.render(<Dialog open onClose={() => {}} title="New session"><input autoFocus /></Dialog>))
    expect(document.activeElement).toBe(container.querySelector('input'))
    act(() => root.render(<Dialog open={false} onClose={() => {}} title="New session"><input autoFocus /></Dialog>))
    expect(document.activeElement).toBe(opener)
  })

  it('names the modal, contains Tab focus, and restores its opener', () => {
    const opener = document.createElement('button')
    document.body.prepend(opener)
    opener.focus()
    const close = vi.fn()
    act(() => root.render(<Dialog open onClose={close} title="Delete session"><DialogButton>Cancel</DialogButton></Dialog>))
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete session')
    expect(document.activeElement).toBe(dialog)
    const buttons = dialog.querySelectorAll('button')
    buttons[buttons.length - 1].focus()
    key(buttons[buttons.length - 1], 'Tab')
    expect(document.activeElement).toBe(buttons[0])
    key(buttons[0], 'Tab', true)
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    key(dialog, 'Escape')
    expect(close).toHaveBeenCalledOnce()
    act(() => root.render(<Dialog open={false} onClose={close} title="Delete session">Closed</Dialog>))
    expect(document.activeElement).toBe(opener)
  })

  it('Escape closes the portalled select before the parent dialog', () => {
    const close = vi.fn()
    act(() => root.render(<Dialog open onClose={close} title="New session"><DialogSelect value="one" onChange={() => {}} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} /></Dialog>))
    const trigger = container.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement
    act(() => trigger.click())
    const option = document.querySelector('[role="option"]')!
    expect(document.activeElement).toBe(option)
    key(option, 'Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(close).not.toHaveBeenCalled()
    key(trigger, 'Escape')
    expect(close).toHaveBeenCalledOnce()
  })

  it('retains the action name while busy', () => {
    act(() => root.render(<DialogButton loading>Creating session</DialogButton>))
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('Creating session')
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })
})
