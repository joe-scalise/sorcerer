import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import os from 'os'
import fs from 'fs'

export interface MobileDeviceRecord {
  id: string
  name: string
  platform: string | null
  appVersion: string | null
  scopes: string[]
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

export interface MobileDeviceCredentialRecord extends MobileDeviceRecord {
  tokenHash: string
}

export interface CreateMobileDeviceInput {
  id: string
  name: string
  tokenHash: string
  platform?: string | null
  appVersion?: string | null
  scopes: string[]
  createdAt: number
}

export class DatabaseService {
  private db: SqlJsDatabase | null = null
  private dbPath: string
  private ready: Promise<void>

  constructor() {
    const dbDir = path.join(os.homedir(), '.sorcerer')
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    this.dbPath = path.join(dbDir, 'sorcerer.db')
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    // Locate the sql.js WASM binary - resolve from the module itself
    const sqlJsDir = path.dirname(require.resolve('sql.js'))
    const wasmPath = path.join(sqlJsDir, 'sql-wasm.wasm')
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    })

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      this.db = new SQL.Database(buffer)
    } else {
      this.db = new SQL.Database()
    }

    this.db.run('PRAGMA foreign_keys = ON;')
    this.runMigrations()
  }

  async ensureReady(): Promise<void> {
    await this.ready
  }

  private getDefaultProviderFallback(): string {
    return this.getSetting('defaultProvider') || 'claude'
  }

  private runMigrations(): void {
    if (!this.db) return

    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        setup_script TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        team_name TEXT,
        pid INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        archived_at INTEGER
      );
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        system_prompt TEXT DEFAULT '',
        mcp_config TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        pid INTEGER,
        team_name TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS quick_notes (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL,
        parent_type TEXT NOT NULL,
        content TEXT DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `)

    // Add sort_order column to projects (idempotent migration)
    try {
      this.db.run(`ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
      // Backfill existing projects: newest first (matching previous created_at DESC order)
      const existing = this.db.prepare('SELECT id FROM projects ORDER BY created_at DESC')
      let idx = 0
      while (existing.step()) {
        const row = existing.getAsObject() as { id: string }
        this.db.run('UPDATE projects SET sort_order = ? WHERE id = ?', [idx, row.id])
        idx++
      }
      existing.free()
    } catch { /* column already exists */ }

    // Add type column to sessions (idempotent migration)
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'session'`)
    } catch { /* column already exists */ }

    // Add bypass_permissions column to sessions and agents (idempotent migration)
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN bypass_permissions INTEGER NOT NULL DEFAULT 1`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE agents ADD COLUMN bypass_permissions INTEGER NOT NULL DEFAULT 1`)
    } catch { /* column already exists */ }

    // Add remote_control column to sessions and agents (idempotent migration)
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN remote_control INTEGER NOT NULL DEFAULT 0`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE agents ADD COLUMN remote_control INTEGER NOT NULL DEFAULT 0`)
    } catch { /* column already exists */ }

    // Add provider and model columns to sessions and agents (idempotent migration)
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT ''`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE agents ADD COLUMN model TEXT DEFAULT ''`)
    } catch { /* column already exists */ }

    // Project groups table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `)

    // Add group_id column to projects (idempotent migration)
    try {
      this.db.run(`ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES project_groups(id) ON DELETE SET NULL`)
    } catch { /* column already exists */ }

    // Agent groups table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `)

    // Add group_id column to agents (idempotent migration)
    try {
      this.db.run(`ALTER TABLE agents ADD COLUMN group_id TEXT REFERENCES agent_groups(id) ON DELETE SET NULL`)
    } catch { /* column already exists */ }

    // Autonomous agent columns (idempotent migrations)
    try { this.db.run(`ALTER TABLE agents ADD COLUMN mission TEXT DEFAULT ''`) } catch { /* exists */ }
    try { this.db.run(`ALTER TABLE agents ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
    try { this.db.run(`ALTER TABLE agents ADD COLUMN auto_restart INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
    try { this.db.run(`ALTER TABLE agents ADD COLUMN restart_delay INTEGER NOT NULL DEFAULT 30`) } catch { /* exists */ }
    try { this.db.run(`ALTER TABLE agents ADD COLUMN max_restarts INTEGER NOT NULL DEFAULT 10`) } catch { /* exists */ }
    // Schedule: cron-like interval in minutes (0 = disabled, >0 = run every N minutes)
    try { this.db.run(`ALTER TABLE agents ADD COLUMN schedule_minutes INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
    try { this.db.run(`ALTER TABLE agents ADD COLUMN last_run_at INTEGER`) } catch { /* exists */ }

    // Agent run log — stores output from each scheduled/autonomous run
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        output TEXT NOT NULL,
        exit_code INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0
      );
    `)

    // Add claude_session_id column to sessions (idempotent migration)
    // Pins each Sorcerer session to a specific Claude Code conversation to prevent
    // cross-contamination when multiple sessions share the same working directory.
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`)
    } catch { /* column already exists */ }

    // Add provider_session_id column to sessions (idempotent migration)
    // Stores provider-native resume IDs such as Codex thread UUIDs.
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_id TEXT`)
    } catch { /* column already exists */ }

    // Track when the current/last session run started
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN started_at INTEGER`)
    } catch { /* column already exists */ }

    // Structured provider resume metadata
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_captured_at INTEGER`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_validated_at INTEGER`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_source TEXT`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN resume_status TEXT`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN resume_reason TEXT`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN last_output_tail TEXT`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN last_exit_code INTEGER`)
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN last_exited_at INTEGER`)
    } catch { /* column already exists */ }

    // Briefing archive table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS briefings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `)

    // Paired mobile devices. Raw bearer tokens are never persisted; only their
    // SHA-256 hashes are stored so a copied database cannot be used to connect.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS mobile_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        platform TEXT,
        app_version TEXT,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
    `)
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_mobile_devices_token_hash
      ON mobile_devices(token_hash);
    `)

    this.save()
  }

  // Briefing archive operations
  saveBriefing(id: string, content: string, provider: string, model: string): void {
    if (!this.db) return
    this.db.run(
      'INSERT INTO briefings (id, content, provider, model) VALUES (?, ?, ?, ?)',
      [id, content, provider, model]
    )
    this.save()
  }

  listBriefings(limit: number = 20): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM briefings ORDER BY created_at DESC LIMIT ?')
    stmt.bind([limit])
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  deleteBriefing(id: string): void {
    if (!this.db) return
    this.db.run('DELETE FROM briefings WHERE id = ?', [id])
    this.save()
  }

  private save(): void {
    if (!this.db) return
    // Export before touching disk, then replace the live file only after the
    // complete snapshot has been flushed. A failed save must not truncate the
    // last readable database. Keeping the temporary file beside it ensures the
    // rename stays on one filesystem.
    const data = Buffer.from(this.db.export())
    const temporaryPath = `${this.dbPath}.${uuidv4()}.tmp`
    let descriptor: number | undefined
    let created = false
    let replaced = false
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
      created = true
      fs.writeFileSync(descriptor, data)
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = undefined
      // Close before replacing for Windows. Never remove the destination as a
      // fallback: a sharing violation should leave the old snapshot intact.
      fs.renameSync(temporaryPath, this.dbPath)
      replaced = true
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor) } catch { /* preserve the save error */ }
      }
      if (created && !replaced) {
        try { fs.unlinkSync(temporaryPath) } catch { /* preserve the save error */ }
      }
    }
  }

  // Project operations
  listProjects(): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY sort_order ASC')
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  getProject(id: string): any | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    stmt.bind([id])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  addProject(id: string, name: string, projectPath: string): any {
    if (!this.db) throw new Error('Database not initialized')
    // Shift all existing projects down to make room at position 0
    this.db.run('UPDATE projects SET sort_order = sort_order + 1')
    this.db.run('INSERT INTO projects (id, name, path, sort_order) VALUES (?, ?, ?, 0)', [id, name, projectPath])
    this.save()
    return this.getProject(id)
  }

  updateProject(id: string, updates: { name?: string; setup_script?: string | null; group_id?: string | null }): any {
    if (!this.db) return undefined
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.setup_script !== undefined) {
      setClauses.push('setup_script = ?')
      values.push(updates.setup_script)
    }
    if (updates.group_id !== undefined) {
      setClauses.push('group_id = ?')
      values.push(updates.group_id)
    }

    if (setClauses.length > 0) {
      values.push(id)
      this.db.run(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`, values)
      this.save()
    }

    return this.getProject(id)
  }

  reorderProjects(projectIds: string[]): void {
    if (!this.db) return
    for (let i = 0; i < projectIds.length; i++) {
      this.db.run('UPDATE projects SET sort_order = ? WHERE id = ?', [i, projectIds[i]])
    }
    this.save()
  }

  removeProject(id: string): void {
    if (!this.db) return
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
    this.save()
  }

  // Project group operations
  listProjectGroups(): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM project_groups ORDER BY sort_order ASC')
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  addProjectGroup(id: string, name: string): any {
    if (!this.db) throw new Error('Database not initialized')
    // Get next sort_order
    const stmt = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM project_groups')
    stmt.step()
    const nextOrder = (stmt.getAsObject() as { next_order: number }).next_order
    stmt.free()
    this.db.run('INSERT INTO project_groups (id, name, sort_order) VALUES (?, ?, ?)', [id, name, nextOrder])
    this.save()
    return { id, name, sort_order: nextOrder }
  }

  updateProjectGroup(id: string, updates: { name?: string }): any {
    if (!this.db) return undefined
    if (updates.name !== undefined) {
      this.db.run('UPDATE project_groups SET name = ? WHERE id = ?', [updates.name, id])
      this.save()
    }
    const stmt = this.db.prepare('SELECT * FROM project_groups WHERE id = ?')
    stmt.bind([id])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  removeProjectGroup(id: string): void {
    if (!this.db) return
    // Ungroup projects in this group (set group_id to null)
    this.db.run('UPDATE projects SET group_id = NULL WHERE group_id = ?', [id])
    this.db.run('DELETE FROM project_groups WHERE id = ?', [id])
    this.save()
  }

  reorderProjectGroups(groupIds: string[]): void {
    if (!this.db) return
    for (let i = 0; i < groupIds.length; i++) {
      this.db.run('UPDATE project_groups SET sort_order = ? WHERE id = ?', [i, groupIds[i]])
    }
    this.save()
  }

  // Session operations
  listSessions(projectId?: string): any[] {
    if (!this.db) return []
    const query = projectId
      ? 'SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM sessions ORDER BY created_at DESC'
    const stmt = this.db.prepare(query)
    if (projectId) stmt.bind([projectId])
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  getSession(id: string): any | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    stmt.bind([id])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  addSession(data: {
    id: string
    project_id: string
    name: string
    branch: string
    worktree_path: string
    type?: 'session' | 'quick-terminal'
    team_name?: string
    parent_session_id?: string
    bypass_permissions?: number
    remote_control?: number
    status?: string
    claude_session_id?: string
    provider_session_id?: string
    started_at?: number
    provider_session_captured_at?: number | null
    provider_session_validated_at?: number | null
    provider_session_source?: string | null
    resume_status?: string | null
    resume_reason?: string | null
    provider?: string
    model?: string
  }): any {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO sessions (id, project_id, name, branch, worktree_path, status, type, team_name, parent_session_id, bypass_permissions, remote_control, claude_session_id, provider_session_id, started_at, provider_session_captured_at, provider_session_validated_at, provider_session_source, resume_status, resume_reason, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.id, data.project_id, data.name, data.branch, data.worktree_path,
       data.status || 'active',
       data.type || 'session', data.team_name || null, data.parent_session_id || null,
       data.bypass_permissions ?? 1, data.remote_control ?? 0, data.claude_session_id || null, data.provider_session_id || null, data.started_at ?? null,
       data.provider_session_captured_at ?? null, data.provider_session_validated_at ?? null, data.provider_session_source ?? null, data.resume_status ?? null, data.resume_reason ?? null,
       data.provider || this.getDefaultProviderFallback(), data.model || '']
    )
    this.save()
    return this.getSession(data.id)
  }

  updateSession(id: string, updates: Partial<{
    name: string
    status: string
    pid: number | null
    team_name: string | null
    archived_at: number | null
    remote_control: number
    claude_session_id: string
    provider_session_id: string | null
    started_at: number | null
    provider_session_captured_at: number | null
    provider_session_validated_at: number | null
    provider_session_source: string | null
    resume_status: string | null
    resume_reason: string | null
    last_output_tail: string | null
    last_exit_code: number | null
    last_exited_at: number | null
    provider: string
    model: string
  }>): any {
    if (!this.db) return undefined
    const setClauses: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`)
        values.push(value)
      }
    }

    if (setClauses.length > 0) {
      values.push(id)
      this.db.run(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`, values)
      this.save()
    }

    return this.getSession(id)
  }

  removeSession(id: string): void {
    if (!this.db) return
    this.db.run('DELETE FROM sessions WHERE id = ?', [id])
    this.save()
  }

  // Agent operations
  listAgents(): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM agents ORDER BY created_at DESC')
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  getAgent(id: string): any | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?')
    stmt.bind([id])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  addAgent(data: {
    id: string
    name: string
    description?: string
    system_prompt?: string
    mcp_config?: string
    bypass_permissions?: number
    remote_control?: number
    mission?: string
    auto_start?: number
    auto_restart?: number
    restart_delay?: number
    max_restarts?: number
    schedule_minutes?: number
    provider?: string
    model?: string
  }): any {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO agents (id, name, description, system_prompt, mcp_config, bypass_permissions, remote_control, mission, auto_start, auto_restart, restart_delay, max_restarts, schedule_minutes, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.id, data.name, data.description || '', data.system_prompt || '', data.mcp_config || '',
       data.bypass_permissions ?? 1, data.remote_control ?? 0,
       data.mission || '', data.auto_start ?? 0, data.auto_restart ?? 0,
       data.restart_delay ?? 30, data.max_restarts ?? 10, data.schedule_minutes ?? 0,
       data.provider || this.getDefaultProviderFallback(), data.model || '']
    )
    this.save()
    return this.getAgent(data.id)
  }

  updateAgent(id: string, updates: Partial<{
    name: string
    description: string
    system_prompt: string
    mcp_config: string
    status: string
    pid: number | null
    team_name: string | null
    remote_control: number
    mission: string
    auto_start: number
    auto_restart: number
    max_restarts: number
    schedule_minutes: number
    last_run_at: number | null
    provider: string
    model: string
  }>): any {
    if (!this.db) return undefined
    const setClauses: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`)
        values.push(value)
      }
    }

    if (setClauses.length > 0) {
      values.push(id)
      this.db.run(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`, values)
      this.save()
    }

    return this.getAgent(id)
  }

  removeAgent(id: string): void {
    if (!this.db) return
    this.db.run('DELETE FROM agents WHERE id = ?', [id])
    this.save()
  }

  // Agent run log operations
  saveAgentRun(data: { id: string; agent_id: string; output: string; exit_code: number; started_at: number; completed_at: number; duration_ms: number }): void {
    if (!this.db) return
    this.db.run(
      'INSERT INTO agent_runs (id, agent_id, output, exit_code, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.id, data.agent_id, data.output, data.exit_code, data.started_at, data.completed_at, data.duration_ms]
    )
    this.save()
  }

  listAgentRuns(agentId: string, limit: number = 20): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY completed_at DESC LIMIT ?')
    stmt.bind([agentId, limit])
    const results: any[] = []
    while (stmt.step()) results.push(stmt.getAsObject())
    stmt.free()
    return results
  }

  getLatestAgentRun(agentId: string): any | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY completed_at DESC LIMIT 1')
    stmt.bind([agentId])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  // Agent group operations
  listAgentGroups(): any[] {
    if (!this.db) return []
    const stmt = this.db.prepare('SELECT * FROM agent_groups ORDER BY sort_order ASC')
    const results: any[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  addAgentGroup(id: string, name: string): any {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM agent_groups')
    stmt.step()
    const nextOrder = (stmt.getAsObject() as { next_order: number }).next_order
    stmt.free()
    this.db.run('INSERT INTO agent_groups (id, name, sort_order) VALUES (?, ?, ?)', [id, name, nextOrder])
    this.save()
    return { id, name, sort_order: nextOrder }
  }

  updateAgentGroup(id: string, updates: { name?: string }): any {
    if (!this.db) return undefined
    if (updates.name !== undefined) {
      this.db.run('UPDATE agent_groups SET name = ? WHERE id = ?', [updates.name, id])
      this.save()
    }
    const stmt = this.db.prepare('SELECT * FROM agent_groups WHERE id = ?')
    stmt.bind([id])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  removeAgentGroup(id: string): void {
    if (!this.db) return
    this.db.run('UPDATE agents SET group_id = NULL WHERE group_id = ?', [id])
    this.db.run('DELETE FROM agent_groups WHERE id = ?', [id])
    this.save()
  }

  reorderAgentGroups(groupIds: string[]): void {
    if (!this.db) return
    for (let i = 0; i < groupIds.length; i++) {
      this.db.run('UPDATE agent_groups SET sort_order = ? WHERE id = ?', [i, groupIds[i]])
    }
    this.save()
  }

  // Settings operations
  createMobileDevice(input: CreateMobileDeviceInput): MobileDeviceRecord {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      `INSERT INTO mobile_devices
       (id, name, token_hash, platform, app_version, scopes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.tokenHash,
        input.platform || null,
        input.appVersion || null,
        JSON.stringify(input.scopes),
        input.createdAt
      ]
    )
    this.save()

    const created = this.getMobileDeviceByTokenHash(input.tokenHash)
    if (!created) throw new Error('Failed to create mobile device')
    return this.toPublicMobileDevice(created)
  }

  getMobileDeviceByTokenHash(tokenHash: string): MobileDeviceCredentialRecord | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare(
      `SELECT id, name, token_hash, platform, app_version, scopes,
              created_at, last_seen_at, revoked_at
       FROM mobile_devices WHERE token_hash = ?`
    )
    stmt.bind([tokenHash])
    const row = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return row ? this.mapMobileDevice(row, true) as MobileDeviceCredentialRecord : undefined
  }

  listMobileDevices(): MobileDeviceRecord[] {
    if (!this.db) return []
    const stmt = this.db.prepare(
      `SELECT id, name, platform, app_version, scopes,
              created_at, last_seen_at, revoked_at
       FROM mobile_devices ORDER BY created_at DESC`
    )
    const results: MobileDeviceRecord[] = []
    while (stmt.step()) {
      results.push(this.mapMobileDevice(stmt.getAsObject(), false))
    }
    stmt.free()
    return results
  }

  touchMobileDevice(id: string, seenAt: number): void {
    if (!this.db) return
    this.db.run(
      `UPDATE mobile_devices SET last_seen_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [seenAt, id]
    )
    this.save()
  }

  revokeMobileDevice(id: string, revokedAt: number = Date.now()): boolean {
    if (!this.db) return false
    const existing = this.db.prepare(
      'SELECT id FROM mobile_devices WHERE id = ? AND revoked_at IS NULL'
    )
    existing.bind([id])
    const canRevoke = existing.step()
    existing.free()
    if (!canRevoke) return false

    this.db.run(
      `UPDATE mobile_devices SET revoked_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [revokedAt, id]
    )
    this.save()
    return true
  }

  private mapMobileDevice(
    row: Record<string, unknown>,
    includeCredential: boolean
  ): MobileDeviceRecord | MobileDeviceCredentialRecord {
    let scopes: string[] = []
    try {
      const parsed = JSON.parse(String(row.scopes || '[]'))
      if (Array.isArray(parsed)) scopes = parsed.filter((scope): scope is string => typeof scope === 'string')
    } catch {
      scopes = []
    }

    const device: MobileDeviceRecord = {
      id: String(row.id),
      name: String(row.name),
      platform: row.platform == null ? null : String(row.platform),
      appVersion: row.app_version == null ? null : String(row.app_version),
      scopes,
      createdAt: Number(row.created_at),
      lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
      revokedAt: row.revoked_at == null ? null : Number(row.revoked_at)
    }

    if (!includeCredential) return device
    return { ...device, tokenHash: String(row.token_hash) }
  }

  private toPublicMobileDevice(device: MobileDeviceCredentialRecord): MobileDeviceRecord {
    const { tokenHash: _tokenHash, ...publicDevice } = device
    return publicDevice
  }

  private isSecret(key: string): boolean {
    return key.startsWith('apiKey_') || key === 'remoteAuthToken'
  }

  getSetting(key: string): string | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    stmt.bind([key])
    const row = stmt.step() ? (stmt.getAsObject() as { value: string }) : undefined
    stmt.free()

    if (!row) return undefined

    if (this.isSecret(key)) {
      try {
        const { safeStorage } = require('electron')
        const buffer = Buffer.from(row.value, 'base64')
        if (safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(buffer)
        }
      } catch (e) {
        // If decryption fails, it's likely plaintext from a previous version.
        // We return it as-is so it can be used, and it will be encrypted on next save.
        return row.value
      }
    }

    return row.value
  }

  setSetting(key: string, value: string): void {
    if (!this.db) return

    let valueToStore = value
    if (this.isSecret(key) && value) {
      try {
        const { safeStorage } = require('electron')
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(value)
          valueToStore = encrypted.toString('base64')
        }
      } catch (e) {
        console.error(`[db] Failed to encrypt secret key ${key}`, e)
      }
    }

    this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, valueToStore])
    this.save()
  }

  // Quick Notes operations
  getQuickNote(parentId: string, parentType: string): any | undefined {
    if (!this.db) return undefined
    const stmt = this.db.prepare('SELECT * FROM quick_notes WHERE parent_id = ? AND parent_type = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1')
    stmt.bind([parentId, parentType])
    const result = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return result
  }

  saveQuickNote(id: string, parentId: string, parentType: string, content: string): void {
    if (!this.db) return
    // Separate windows may both load an empty note and generate their own ID.
    // Reuse the persisted identity so later saves cannot leave competing rows.
    const existing = this.getQuickNote(parentId, parentType)
    this.db.run(
      `INSERT OR REPLACE INTO quick_notes (id, parent_id, parent_type, content, updated_at)
       VALUES (?, ?, ?, ?, strftime('%s','now'))`,
      [existing?.id ?? id, parentId, parentType, content]
    )
    this.save()
  }

  deleteQuickNote(parentId: string, parentType: string): void {
    if (!this.db) return
    this.db.run('DELETE FROM quick_notes WHERE parent_id = ? AND parent_type = ?', [parentId, parentType])
    this.save()
  }

  listQuickNoteParents(): { parent_id: string; parent_type: string }[] {
    if (!this.db) return []
    const stmt = this.db.prepare("SELECT parent_id, parent_type FROM quick_notes WHERE content != ''")
    const results: { parent_id: string; parent_type: string }[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as { parent_id: string; parent_type: string }
      results.push(row)
    }
    stmt.free()
    return results
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }

  flush(): void {
    this.save()
  }
}
