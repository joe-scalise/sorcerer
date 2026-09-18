import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, openExternal } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  openExternal: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    on: vi.fn()
  },
  app: { getAppPath: () => process.cwd(), getVersion: () => '1.8.0', isPackaged: false },
  dialog: {},
  shell: { openExternal }
}))

import { registerIPC } from '../ipc/handlers'

describe('open project remote in browser', () => {
  const getRemoteUrl = vi.fn()

  beforeEach(() => {
    openExternal.mockClear()
    registerIPC({} as any, {
      getSetting: () => undefined,
      getSession: () => ({ project_id: 'project-1' }),
      getProject: () => ({ path: 'project' })
    } as any, { getRemoteUrl } as any, {} as any)
  })

  it('does not hand a native protocol from git configuration to the operating system', async () => {
    getRemoteUrl.mockResolvedValue('file:///C:/Windows/System32/calc.exe')
    const result = await handlers.get('session:open-remote')!({}, 'session-1')
    expect(result.opened).toBe(false)
    expect(result.error).toContain('HTTP or HTTPS')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens a web remote and waits for the browser launch to succeed', async () => {
    getRemoteUrl.mockResolvedValue('https://github.com/aetherci-hq/sorcerer')
    const result = await handlers.get('session:open-remote')!({}, 'session-1')
    expect(result.opened).toBe(true)
    expect(openExternal).toHaveBeenCalledWith(result.url)
  })

  it('reports browser launch failure instead of leaving an unhandled rejection', async () => {
    getRemoteUrl.mockResolvedValue('https://github.com/aetherci-hq/sorcerer')
    openExternal.mockRejectedValueOnce(new Error('Browser unavailable'))
    await expect(handlers.get('session:open-remote')!({}, 'session-1')).rejects.toThrow('Browser unavailable')
  })
})
