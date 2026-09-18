import { EventEmitter } from 'events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { isExternalWebUrl, secureWindowContents } from '../window-security'

describe('desktop window security', () => {
  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'https://trusted.example@untrusted.example/',
    '//example.com',
    '',
    null
  ])('rejects native protocols and invalid browser links: %s', (value) => {
    expect(isExternalWebUrl(value)).toBe(false)
  })

  it.each(['https://github.com/aetherci-hq/sorcerer', 'http://localhost:3000'])('allows web links: %s', (value) => {
    expect(isExternalWebUrl(value)).toBe(true)
  })

  function setup() {
    const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    const openExternal = vi.fn().mockResolvedValue(undefined)
    secureWindowContents(contents as unknown as WebContents, openExternal)
    return { contents, openExternal }
  }

  it('prevents untrusted navigation from gaining the app preload and opens web links in the browser', () => {
    const { contents, openExternal } = setup()
    const event = { preventDefault: vi.fn() }
    contents.emit('will-navigate', event, 'https://example.com')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com')

    contents.emit('will-navigate', event, 'file:///tmp/untrusted.html')
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('denies all child windows while permitting browser links', () => {
    const { contents, openExternal } = setup()
    const handler = contents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///tmp/untrusted.html' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('blocks subframe navigation and redirects', () => {
    const { contents, openExternal } = setup()
    const event = { preventDefault: vi.fn(), isMainFrame: false }
    contents.emit('will-frame-navigate', event)
    contents.emit('will-redirect', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
