import { beforeAll, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { prepareCodexRootThreads } from '../codex-thread-state'

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs() })

it('includes CLI and editor conversations, prefers custom names, and excludes archived and subagent threads', () => {
  const db = new SQL.Database()
  try {
    db.run('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, name TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, archived INTEGER, model TEXT)')
    const add = (id: string, source: string, archived = 0, name: string | null = null) => {
      db.run('INSERT INTO threads VALUES (?, ?, ?, ?, 1, 2, ?, ?, ?)', [id, 'C:\\work', 'Original prompt', name, source, archived, 'model'])
    }
    add('cli', 'cli')
    add('editor', 'vscode', 0, 'Summarize Deployment Day work')
    add('child', '{"subagent":{"thread_spawn":{}}}')
    add('archived', 'vscode', 1)
    const stmt = prepareCodexRootThreads(db)
    const rows: any[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    expect(rows.map(row => row.id).sort()).toEqual(['cli', 'editor'])
    expect(rows.find(row => row.id === 'editor')?.title).toBe('Summarize Deployment Day work')
    expect(rows.find(row => row.id === 'cli')?.title).toBe('Original prompt')
  } finally { db.close() }
})

it('supports older schemas and retains older threads beyond the former global limits', () => {
  const db = new SQL.Database()
  try {
    db.run('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, archived INTEGER)')
    for (let i = 0; i < 505; i++) {
      db.run("INSERT INTO threads VALUES (?, ?, ?, 1, ?, 'cli', 0)", [String(i), 'C:\\work', 'Old title', i])
    }
    const stmt = prepareCodexRootThreads(db)
    const rows: any[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    expect(rows).toHaveLength(505)
    expect(rows.at(-1)).toMatchObject({ id: '0', title: 'Old title', model: '' })
  } finally { db.close() }
})
