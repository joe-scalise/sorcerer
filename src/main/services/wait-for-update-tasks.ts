/** Update installation must fail closed, rather than treating timeout as success. */
export async function waitForUpdateTasks(tasks: Set<Promise<void>>, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        while (tasks.size > 0) await Promise.all(Array.from(tasks))
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Session state is still being saved. Please wait and retry the update.')), timeoutMs)
      })
    ])
  } finally { clearTimeout(timer) }
}
