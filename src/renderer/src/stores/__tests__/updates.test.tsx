// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToUpdates, useUpdateStore } from '../useUpdateStore'
import { UpdateActions, updateStatusText } from '../../components/Updates'
import type { UpdateState } from '../../../../shared/update'

const snapshot = (revision: number, patch: Partial<UpdateState> = {}): UpdateState => ({
  revision, currentVersion: '1.8.0', status: 'idle', downloaded: false, managed: true, canDownload: false, ...patch
})

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useUpdateStore.setState({ state: null, open: false, actionError: null })
})

describe('update status and actions', () => {
  it('ignores a stale snapshot arriving after a newer event and unsubscribes', async () => {
    let resolve!: (state: UpdateState) => void
    const unsubscribe = vi.fn()
    ;(window as any).sorcerer = { system: { updates: {
      onState: (listener: (state: UpdateState) => void) => { listener(snapshot(4, { status: 'downloading', progress: 50 })); return unsubscribe },
      getState: () => new Promise<UpdateState>((done) => { resolve = done })
    } } }
    const stop = subscribeToUpdates()
    resolve(snapshot(2))
    await Promise.resolve()
    expect(useUpdateStore.getState().state?.progress).toBe(50)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('never labels failed checks as up to date and keeps staged readiness visible', () => {
    expect(updateStatusText(snapshot(2, { status: 'error', checkedAt: Date.now() }))).toContain('Could not')
    expect(updateStatusText(snapshot(3, { status: 'error', downloaded: true, version: '1.9.0' }))).toContain('ready to install')
  })

  it('offers managed restart only after download, and manual download on unsupported installs', () => {
    const node = document.createElement('div')
    const root = createRoot(node)
    act(() => {
      useUpdateStore.setState({ state: snapshot(1, { status: 'available', version: '1.9.0', canDownload: true, url: 'https://github.com/joe-scalise/sorcerer/releases/tag/v1.9.0' }) })
      root.render(<UpdateActions />)
    })
    expect(node.textContent).toContain('Download update')
    expect(node.textContent).not.toContain('Restart and install')
    act(() => { useUpdateStore.setState({ state: snapshot(2, { status: 'downloaded', version: '1.9.0', downloaded: true }) }) })
    expect(node.textContent).toContain('Restart and install')
    act(() => { useUpdateStore.setState({ state: snapshot(3, { status: 'available', version: '1.9.0', managed: false, url: 'https://github.com/joe-scalise/sorcerer/releases/tag/v1.9.0' }) }) })
    expect(node.textContent).toContain('Download from GitHub')
    expect(node.textContent).not.toContain('Restart and install')
    act(() => root.unmount())
  })
})
