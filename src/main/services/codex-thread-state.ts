import type { Database, Statement } from 'sql.js'

/** Read resumable user threads, including conversations started in the editor. */
export function prepareCodexRootThreads(db: Database): Statement {
  const schema = db.prepare('PRAGMA table_info(threads)')
  const columns: string[] = []
  try {
    while (schema.step()) columns.push(String(schema.getAsObject().name))
  } finally {
    schema.free()
  }
  // Older Codex databases predate custom conversation names.
  const title = columns.includes('name')
    ? "COALESCE(NULLIF(TRIM(name), ''), title)"
    : 'title'
  const model = columns.includes('model') ? 'model' : "'' AS model"
  return db.prepare(`
    SELECT id, cwd, ${title} AS title, created_at, updated_at, ${model}
    FROM threads
    WHERE archived = 0 AND source IN ('cli', 'vscode')
    ORDER BY updated_at DESC
  `)
}
