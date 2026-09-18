// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../renderMarkdown'

describe('untrusted agent Markdown', () => {
  it('preserves document formatting and web links', () => {
    const result = renderMarkdown('# Summary\n\n**Done** and `code`\n\n[Review](https://example.com)')
    expect(result).toContain('<h1>Summary</h1>')
    expect(result).toContain('<strong>Done</strong>')
    expect(result).toContain('<code>code</code>')
    expect(result).toContain('href="https://example.com"')
  })

  it('removes active content, remote media, and markup that can cover trusted controls', () => {
    const result = renderMarkdown('<script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/tracker" onerror="alert(1)"><svg onload="alert(1)"></svg><p style="position:fixed;inset:0" id="root" onclick="alert(1)">Text</p>')
    const element = document.createElement('div')
    element.innerHTML = result
    expect(element.querySelector('script, iframe, img, svg, [style], [id], [onclick], [onerror], [onload]')).toBeNull()
    expect(element.textContent).toBe('Text')
  })

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'file:///C:/private', 'smb://host/share', '//host/path'])('removes unsafe links: %s', (href) => {
    const element = document.createElement('div')
    element.innerHTML = renderMarkdown(`<a href="${href}">Link</a>`)
    expect(element.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(element.textContent?.trim()).toBe('Link')
  })
})
