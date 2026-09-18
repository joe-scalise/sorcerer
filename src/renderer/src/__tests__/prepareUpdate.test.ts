// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../../shared/update'

const flush = vi.hoisted(() => vi.fn())
vi.mock('../stores/useQuickNotesDraftStore', () => ({ flushAllNoteDrafts: flush }))
import { registerUpdatePreparation } from '../prepareUpdate'

let prepare: (id: string) => void
let stateChanged: (state: UpdateState) => void
const prepared = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  document.body.replaceChildren()
  document.body.inert = false
  ;(window as any).sorcerer = { system: { updates: {
    onState: (listener: typeof stateChanged) => { stateChanged = listener },
    onPrepareInstall: (listener: typeof prepare) => { prepare = listener },
    prepared
  } } }
  registerUpdatePreparation()
})

it('freezes editing before flushing and acknowledges only when the save finishes', async () => {
  let finish!: () => void
  flush.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  prepare('request-1')
  expect(document.body.inert).toBe(true)
  expect(prepared).not.toHaveBeenCalled()
  finish()
  await Promise.resolve()
  expect(prepared).toHaveBeenCalledWith('request-1', true)
  expect(document.body.inert).toBe(true)
  stateChanged({ status: 'error' } as UpdateState)
  expect(document.body.inert).toBe(false)
  expect(document.querySelector('.update-preparing-overlay')).toBeNull()
})

it('reports save failures and restores editing instead of permitting installation', async () => {
  flush.mockRejectedValue(new Error('Disk full'))
  prepare('request-2')
  await Promise.resolve()
  await Promise.resolve()
  expect(prepared).toHaveBeenCalledWith('request-2', false, 'Disk full')
  expect(document.body.inert).toBe(false)
})
