/**
 * Agent Orchestrator — Schedules and runs autonomous agent missions.
 *
 * Instead of bending any provider CLI into a daemon, Sorcerer acts as the
 * orchestration layer: it runs the mission on a schedule, captures the
 * output, stores results, and notifies the user.
 *
 * Each run launches the selected provider with the mission and any
 * provider-specific resume behavior. Output is captured via the
 * scrollback buffer and stored in the agent_runs table.
 */

import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { DatabaseService } from './database-service'
import { PTYService } from './pty-service'
import { ensureProviderTrust } from '../ipc/shared-handlers'
import { getProviderRunner } from './provider-runners'
import { resolveLaunchModel } from './provider-registry'

interface RunningAgent {
  agentId: string
  startedAt: number
}

export class AgentOrchestrator {
  private db: DatabaseService
  private pty: PTYService
  private mainWindow: BrowserWindow | null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private initialCheckTimer: ReturnType<typeof setTimeout> | null = null
  private missionInputTimers = new Set<ReturnType<typeof setTimeout>>()
  private exitListenerRegistered = false
  private runningAgents = new Map<string, RunningAgent>()

  constructor(
    db: DatabaseService,
    pty: PTYService,
    mainWindow: BrowserWindow | null
  ) {
    this.db = db
    this.pty = pty
    this.mainWindow = mainWindow
  }

  /**
   * Start the orchestrator — polls every 30 seconds for agents due to run.
   */
  start(): void {
    if (this.pollInterval) return
    console.log('[orchestrator] Started')

    // Initial check after 5 seconds (let app finish loading)
    this.initialCheckTimer = setTimeout(() => {
      this.initialCheckTimer = null
      this.checkSchedule()
    }, 5000)

    // Then poll every 30 seconds
    this.pollInterval = setInterval(() => this.checkSchedule(), 30_000)

    // Keep one subscription across stop/resume. It must remain active while
    // stopped so update shutdown can still persist already-running agents.
    if (!this.exitListenerRegistered) {
      this.exitListenerRegistered = true
      this.pty.onExit((sessionId, exitCode) => {
        const running = this.runningAgents.get(sessionId)
        if (!running) return
        try {
          this.handleRunComplete(sessionId, exitCode, running.startedAt)
        } catch (err) {
          console.error(`[orchestrator] Failed to complete agent run ${sessionId}:`, err)
          this.runningAgents.delete(sessionId)
          // PTYService collects listener errors so update shutdown cannot
          // report success when the completed run was not persisted.
          throw err
        }
      })
    }
  }

  stop(): void {
    if (this.initialCheckTimer) {
      clearTimeout(this.initialCheckTimer)
      this.initialCheckTimer = null
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    for (const timer of this.missionInputTimers) clearTimeout(timer)
    this.missionInputTimers.clear()
    console.log('[orchestrator] Stopped')
  }

  /**
   * Check which agents are due to run based on their schedule.
   */
  private checkSchedule(): void {
    if (!this.pollInterval) return
    const agents = this.db.listAgents()
    const now = Math.floor(Date.now() / 1000)

    for (const agent of agents) {
      // Skip agents without a mission or schedule
      if (!agent.mission || !agent.schedule_minutes || agent.schedule_minutes <= 0) continue

      // Skip if already running
      if (this.runningAgents.has(agent.id)) continue
      if (this.pty.isRunning(agent.id)) continue

      // Check if it's time to run
      const lastRun = (agent.last_run_at as number) || 0
      const intervalSeconds = (agent.schedule_minutes as number) * 60
      const nextRunAt = lastRun + intervalSeconds

      if (now >= nextRunAt) {
        this.runAgent(agent)
      }
    }
  }

  /**
   * Execute an agent's mission.
   */
  private runAgent(agent: any): void {
    if (!this.pollInterval) return
    const agentId = agent.id as string
    const cwd = path.join(os.homedir(), '.sorcerer', 'agents', agentId)
    fs.mkdirSync(cwd, { recursive: true })

    const providerId = (agent.provider as string) || 'claude'
    const resolvedModel = resolveLaunchModel(this.db, providerId, agent.model as string, { refresh: providerId === 'codex' })
    const runner = getProviderRunner(providerId)

    ensureProviderTrust(providerId, cwd)

    const hasHistory = this.db.getLatestAgentRun(agentId) !== undefined
    
    const args = runner.getArgs({
      mission: agent.mission as string,
      systemPrompt: agent.system_prompt as string,
      mcpConfig: agent.mcp_config as string,
      bypassPermissions: agent.bypass_permissions !== 0,
      hasHistory,
      model: resolvedModel
    })

    const startedAt = Math.floor(Date.now() / 1000)
    const running = { agentId, startedAt }
    this.runningAgents.set(agentId, running)

    console.log(`[orchestrator] Running agent: ${agent.name} (provider: ${providerId}, ${hasHistory ? 'continue' : 'fresh'})`)

    this.pty.spawn(agentId, cwd, {
      command: runner.resolveBinary(),
      args,
      env: runner.getEnv(agentId)
    })
    if (resolvedModel !== (agent.model as string)) {
      this.db.updateAgent(agentId, { model: resolvedModel })
    }

    const pid = this.pty.getPid(agentId)
    this.db.updateAgent(agentId, { status: 'active', pid: pid ?? null, last_run_at: startedAt })

    // Notify renderer
    this.notifyRenderer('agent:restarted', agentId, 'active', pid ?? null)

    // If continuing with Claude, send the mission as input after Claude loads
    if (hasHistory && providerId === 'claude') {
      const timer = setTimeout(() => {
        this.missionInputTimers.delete(timer)
        if (this.pollInterval && this.runningAgents.get(agentId) === running && this.pty.isRunning(agentId)) {
          this.pty.write(agentId, agent.mission + '\n')
        }
      }, 5000)
      this.missionInputTimers.add(timer)
    }
  }

  /**
   * Handle an agent run completing — capture output, analyze, decide, act.
   */
  private handleRunComplete(agentId: string, exitCode: number, startedAt: number): void {
    const completedAt = Math.floor(Date.now() / 1000)
    const durationMs = (completedAt - startedAt) * 1000

    // ── Capture ────────────────────────────────────────────────
    const output = this.pty.scrollback.getScrollback(agentId)
    const cleanOutput = output
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\r/g, '')
      .trim()

    // Save run to DB
    const runId = uuidv4()
    this.db.saveAgentRun({
      id: runId,
      agent_id: agentId,
      output: cleanOutput,
      exit_code: exitCode,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs
    })

    this.runningAgents.delete(agentId)
    const agent = this.db.getAgent(agentId)
    console.log(`[orchestrator] Agent "${agent?.name}" completed (exit ${exitCode}, ${Math.round(durationMs / 1000)}s)`)

    // ── Decision layer ─────────────────────────────────────────
    // Compare this run's output with the previous run to detect changes
    const runs = this.db.listAgentRuns(agentId, 2)
    const previousRun = runs.length > 1 ? runs[1] : null
    const hasNewFindings = previousRun
      ? cleanOutput !== (previousRun.output as string) && cleanOutput.length > 0
      : cleanOutput.length > 0

    const isError = exitCode !== 0
    const isFirstRun = !previousRun
    const outputChanged = hasNewFindings

    // ── Action layer ───────────────────────────────────────────
    // Update agent status
    this.db.updateAgent(agentId, { status: 'idle', pid: null, last_run_at: completedAt })
    this.notifyRenderer('agent:restarted', agentId, 'idle', null)

    if (isError) {
      // Agent errored — notify user urgently
      this.notifyRenderer('agent:run-complete', agentId, agent?.name || 'Agent', `Run failed (exit ${exitCode})`, 'error')
    } else if (isFirstRun && cleanOutput.length > 0) {
      // First run with output — baseline established
      this.notifyRenderer('agent:run-complete', agentId, agent?.name || 'Agent', 'Initial scan complete — baseline established', 'info')
    } else if (outputChanged) {
      // Output changed from last run — something new found
      const preview = cleanOutput.slice(-300).split('\n').slice(-3).join(' ').trim()
      this.notifyRenderer('agent:run-complete', agentId, agent?.name || 'Agent', preview, 'warning')
    }
    // If output is identical to last run — silent, nothing new to report
  }

  /**
   * Manually trigger a run for an agent (outside of schedule).
   */
  runNow(agentId: string): void {
    const agent = this.db.getAgent(agentId)
    if (!agent || !agent.mission) return
    if (this.runningAgents.has(agentId) || this.pty.isRunning(agentId)) return
    this.runAgent(agent)
  }

  private notifyRenderer(channel: string, ...args: any[]): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args)
      }
    } catch { /* window destroyed */ }
  }
}
