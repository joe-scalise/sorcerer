import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import { parseDocument } from 'yaml'
import type { ProviderRunner } from './provider-runners'
import type { ProviderExternalSession, ProviderSessionBackend } from './provider-session-backend'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const comparablePath = (value: string) => {
  const normalized = path.resolve(value.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
const timestamp = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Date.parse(String(value || ''))
  return Number.isFinite(n) ? Math.floor(n > 10_000_000_000 ? n / 1000 : n) : 0
}

export class CopilotSessionBackend implements ProviderSessionBackend {
  label = 'Copilot Session'
  constructor(
    private home = () => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'),
    private freshFlag = () => '--session-id'
  ) {}

  fresh() {
    const id = randomUUID()
    return { id, args: [`${this.freshFlag()}=${id}`] }
  }

  resume(id: string | null | undefined, cwd: string) {
    if (!this.validate(id, cwd)) {
      throw new Error('The saved Copilot conversation is missing or belongs to another folder. Import the intended conversation or start a new session.')
    }
    return { id: id!, args: [`--resume=${id}`] }
  }

  validate(id: string | null | undefined, cwd: string): boolean {
    const session = id && UUID.test(id) ? this.read(id) : null
    return !!session && comparablePath(session.cwd) === comparablePath(cwd)
  }

  discover(): ProviderExternalSession[] {
    const root = path.join(this.home(), 'session-state')
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && UUID.test(entry.name))
        .map(entry => this.read(entry.name))
        .filter((entry): entry is ProviderExternalSession => !!entry)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    } catch { return [] }
  }

  private read(id: string): ProviderExternalSession | null {
    const directory = path.join(this.home(), 'session-state', id)
    let fd: number | undefined
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) return null
      const eventsPath = path.join(directory, 'events.jsonl')
      if (fs.lstatSync(eventsPath).isSymbolicLink()) return null
      // Read only the beginning, never a potentially huge conversation transcript.
      fd = fs.openSync(eventsPath, 'r')
      const buffer = Buffer.alloc(65536)
      const count = fs.readSync(fd, buffer, 0, buffer.length, 0)
      const events = buffer.subarray(0, count).toString('utf8').split('\n')
      let start: any = null
      for (const line of events) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'session.start' && event.data?.sessionId === id) { start = event; break }
        } catch { /* tolerate a partial final record */ }
      }
      if (!start || typeof start.data.context?.cwd !== 'string') return null
      let metadata: any = {}
      const metadataPath = path.join(directory, 'workspace.yaml')
      if (fs.existsSync(metadataPath) && !fs.lstatSync(metadataPath).isSymbolicLink() && fs.statSync(metadataPath).size <= 65536) {
        const document = parseDocument(fs.readFileSync(metadataPath, 'utf8'), { uniqueKeys: true })
        if (!document.errors.length) metadata = document.toJS({ maxAliasCount: 0 }) || {}
      }
      if (metadata.id && metadata.id !== id) return null
      const cwd = start.data.context.cwd
      if (metadata.cwd && (typeof metadata.cwd !== 'string' || comparablePath(metadata.cwd) !== comparablePath(cwd))) return null
      return {
        id, cwd,
        title: String(metadata.summary || metadata.name || path.basename(cwd)),
        createdAt: timestamp(metadata.created_at || start.timestamp),
        updatedAt: timestamp(metadata.updated_at) || Math.floor(fs.statSync(eventsPath).mtimeMs / 1000),
        model: typeof start.data.selectedModel === 'string' ? start.data.selectedModel : ''
      }
    } catch { return null } finally { if (fd !== undefined) fs.closeSync(fd) }
  }
}

export class CopilotRunner implements ProviderRunner {
  private npmLoader: string | null = null
  private freshFlag: string | null = null
  id = 'copilot'
  name = 'GitHub Copilot CLI'
  apiKeyEnv = null // Copilot owns sign-in and token storage.
  usesCliModelDefault = true
  capabilities = { supportsMcpConfig: true, supportsModelOverride: true, supportsRemoteControl: false, supportsSystemPrompt: false }
  fallbackModels: string[] = [] // Use the CLI/account default; /model lists entitled models.
  sessionBackend = new CopilotSessionBackend(undefined, () => this.getFreshFlag())
  observeHelp(help: string): void {
    this.freshFlag = /--session-id\b/.test(help) ? '--session-id' : '--resume'
  }
  private getFreshFlag(): string {
    if (!this.freshFlag) {
      const binary = this.resolveBinary()
      const result = spawnSync(binary, this.probeArgs(), {
        encoding: 'utf8', timeout: 10000, windowsHide: true,
        env: { ...process.env, ...this.getEnv('provider-probe') }
      })
      if (result.error || result.status !== 0) throw new Error('Could not inspect Copilot CLI. Check the installation and refresh providers in Settings.')
      this.observeHelp(`${result.stdout || ''}\n${result.stderr || ''}`)
    }
    return this.freshFlag!
  }
  resolveBinary(): string {
    const home = os.homedir()
    const pathCandidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(directory =>
      (process.platform === 'win32' ? ['copilot.exe', 'copilot.cmd'] : ['copilot']).map(name => path.join(directory.replace(/^"|"$/g, ''), name)))
    const candidates = [...pathCandidates, ...(process.platform === 'win32'
      ? [path.join(home, 'AppData/Local/Microsoft/WinGet/Links/copilot.exe'), path.join(home, '.local/bin/copilot.exe'), path.join(home, 'AppData/Roaming/npm/copilot.cmd')]
      : [path.join(home, '.local/bin/copilot'), '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot', path.join(home, '.npm-global/bin/copilot')])]
    const binary = candidates.find(candidate => fs.existsSync(candidate))
    this.npmLoader = null
    if (binary?.endsWith('.cmd')) {
      const loader = path.join(path.dirname(binary), 'node_modules/@github/copilot/npm-loader.js')
      if (!fs.existsSync(loader)) throw new Error('Copilot npm installation is incomplete. Reinstall @github/copilot or install the native Copilot CLI.')
      this.npmLoader = loader
      return process.execPath
    }
    // WinGet's link is outside the package directory containing CLI resources.
    return binary ? fs.realpathSync(binary) : 'copilot'
  }
  getArgs(data: Parameters<ProviderRunner['getArgs']>[0]): string[] {
    if (data.mission && !data.bypassPermissions) {
      throw new Error('Copilot missions run without permission prompts. Enable unattended mode for this Agent, or use an interactive Project session.')
    }
    this.resolveBinary()
    const args: string[] = [...(this.npmLoader ? [this.npmLoader] : []), '--no-auto-update']
    // Older versions use --config-dir rather than honoring COPILOT_HOME.
    if (process.env.COPILOT_HOME) args.push('--config-dir', path.resolve(process.env.COPILOT_HOME))
    if (data.bypassPermissions) args.push('--allow-all')
    if (data.model?.trim()) args.push('--model', data.model.trim())
    if (data.mcpConfig?.trim()) {
      const config = data.mcpConfig.trim()
      args.push('--additional-mcp-config', config.startsWith('{') || config.startsWith('@') ? config : `@${config}`)
    }
    if (data.mission) args.push('-p', data.mission)
    // History selection is deliberately owned by sessionBackend, never --continue.
    return args
  }
  probeArgs(): string[] {
    this.resolveBinary()
    return [...(this.npmLoader ? [this.npmLoader] : []), '--help']
  }
  getEnv(_id: string): Record<string, string> {
    return this.npmLoader ? { ELECTRON_RUN_AS_NODE: '1' } : {}
  }
  discoverModels() { return { models: this.fallbackModels, usesFallback: false } }
}
