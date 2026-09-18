import { afterEach, expect, it, vi } from 'vitest'
import { waitForUpdateTasks } from '../wait-for-update-tasks'

afterEach(() => vi.useRealTimers())

it('rejects rather than proceeding when persistence does not finish', async () => {
  vi.useFakeTimers()
  const pending = new Set([new Promise<void>(() => {})])
  const check = expect(waitForUpdateTasks(pending, 100)).rejects.toThrow('still being saved')
  await vi.advanceTimersByTimeAsync(100)
  await check
})

it('propagates persistence failures', async () => {
  await expect(waitForUpdateTasks(new Set([Promise.reject(new Error('Disk full'))]))).rejects.toThrow('Disk full')
})

it('waits for tasks added while another task is completing', async () => {
  let finish!: () => void
  let finishLater!: () => void
  const first = new Promise<void>((resolve) => { finish = resolve })
  const later = new Promise<void>((resolve) => { finishLater = resolve })
  const pending = new Set([first])
  void first.then(() => { pending.delete(first); pending.add(later) })
  void later.then(() => pending.delete(later))
  let done = false
  const waiting = waitForUpdateTasks(pending).then(() => { done = true })
  finish()
  await Promise.resolve()
  await Promise.resolve()
  expect(done).toBe(false)
  finishLater()
  await waiting
  expect(done).toBe(true)
})
