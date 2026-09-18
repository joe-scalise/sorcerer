import { getFeatureFlags } from './features'
/**
 * Briefing Service — Collects session/agent context and generates
 * personalized "here's where you left off" summaries via AI.
 */

import path from 'path'
import fs from 'fs'
import simpleGit from 'simple-git'
import { DatabaseService } from './database-service'
import { PTYService } from './pty-service'
import { generateCompletion, type AIMessage } from './ai-provider-service'
import { getTerminalOutputTail } from './terminal-output-utils'

interface SessionContext {
  name: string
  projectName: string
  branch: string
  status: string
  type: string
  age: string
  gitSummary?: string
  scrollbackTail?: string
  quickNotes?: string
  divergence?: { behind: number; ahead: number }
}

interface AgentContext {
  name: string
  description: string
  status: string
  age: string
  scrollbackTail?: string
  quickNotes?: string
}

interface BriefingData {
  sessions: SessionContext[]
  agents: AgentContext[]
}

function timeAgo(epochSeconds: number): string {
  const diff = Date.now() - epochSeconds * 1000
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

async function getGitSummary(worktreePath: string): Promise<string | undefined> {
  if (!fs.existsSync(path.join(worktreePath, '.git')) && !fs.existsSync(worktreePath)) {
    return undefined
  }
  try {
    const git = simpleGit(worktreePath)
    const status = await git.status()

    const parts: string[] = []
    if (status.modified.length > 0) parts.push(`${status.modified.length} modified`)
    if (status.not_added.length > 0) parts.push(`${status.not_added.length} untracked`)
    if (status.staged.length > 0) parts.push(`${status.staged.length} staged`)
    if (status.ahead > 0) parts.push(`${status.ahead} ahead`)
    if (status.behind > 0) parts.push(`${status.behind} behind`)

    if (parts.length === 0 && status.isClean()) {
      parts.push('clean')
    }

    // Get most recent commit message
    try {
      const log = await git.log({ maxCount: 1 })
      if (log.latest) {
        parts.push(`last commit: "${log.latest.message.slice(0, 80)}"`)
      }
    } catch { /* no commits */ }

    return parts.join(', ')
  } catch {
    return undefined
  }
}

function getScrollbackTail(pty: PTYService, sessionId: string, maxChars: number = 500): string | undefined {
  const scrollback = pty.scrollback.getScrollback(sessionId)
  return getTerminalOutputTail(scrollback, maxChars)
}

export function collectBriefingData(db: DatabaseService, pty: PTYService): BriefingData {
  const projects = db.listProjects()
  const allSessions = db.listSessions()
  const allAgents = getFeatureFlags(db).standaloneAgents ? db.listAgents() : []

  // Filter to non-deleted, non-archived sessions (exclude quick terminals)
  const relevantSessions = allSessions.filter(
    (s: any) => s.status !== 'deleted' && s.status !== 'archived' && s.type !== 'quick-terminal'
  )

  const sessions: SessionContext[] = []
  for (const s of relevantSessions) {
    const project = projects.find((p: any) => p.id === s.project_id)

    const ctx: SessionContext = {
      name: s.name,
      projectName: project?.name || 'Unknown',
      branch: s.branch || '',
      status: s.status,
      type: s.type || 'session',
      age: timeAgo(s.created_at)
    }

    // Quick notes
    const note = db.getQuickNote(s.id, 'session')
    if (note?.content) {
      ctx.quickNotes = (note.content as string).slice(0, 300)
    }

    if (s.status === 'active') {
      ctx.scrollbackTail = getScrollbackTail(pty, s.id)
    } else {
      ctx.scrollbackTail = (s.last_output_tail as string | undefined) || undefined
    }

    sessions.push(ctx)
  }

  // Collect git summaries async — we'll do this in the generate function
  const agents: AgentContext[] = []
  for (const a of allAgents) {
    if (a.status === 'archived') continue

    const ctx: AgentContext = {
      name: a.name,
      description: a.description || '',
      status: a.status,
      age: timeAgo(a.created_at)
    }

    const note = db.getQuickNote(a.id, 'agent')
    if (note?.content) {
      ctx.quickNotes = (note.content as string).slice(0, 300)
    }

    if (a.status === 'active') {
      ctx.scrollbackTail = getScrollbackTail(pty, a.id)
    }

    agents.push(ctx)
  }

  return { sessions, agents }
}

export async function collectGitSummaries(
  db: DatabaseService,
  sessions: SessionContext[]
): Promise<void> {
  const allSessions = db.listSessions()
  const allProjects = db.listProjects()
  for (const ctx of sessions) {
    const dbSession = allSessions.find((s: any) => s.name === ctx.name && ctx.projectName)
    if (dbSession?.worktree_path) {
      ctx.gitSummary = await getGitSummary(dbSession.worktree_path)

      // Divergence check for worktree sessions
      const project = allProjects.find((p: any) => p.id === dbSession.project_id)
      if (project && dbSession.worktree_path !== project.path && dbSession.branch) {
        try {
          const git = simpleGit(project.path as string)
          let defaultBranch = 'main'
          try {
            const branches = await git.branch()
            if (branches.all.includes('master') && !branches.all.includes('main')) defaultBranch = 'master'
          } catch { /* use main */ }

          const behind = await git.raw(['rev-list', '--count', `${dbSession.branch}..${defaultBranch}`]).catch(() => '0')
          const ahead = await git.raw(['rev-list', '--count', `${defaultBranch}..${dbSession.branch}`]).catch(() => '0')
          const b = parseInt(behind.trim()) || 0
          const a = parseInt(ahead.trim()) || 0
          if (b > 0 || a > 0) {
            ctx.divergence = { behind: b, ahead: a }
          }
        } catch { /* skip */ }
      }
    }
  }
}

function buildPromptContext(data: BriefingData): string {
  const lines: string[] = []

  if (data.sessions.length > 0) {
    lines.push('## Sessions')
    for (const s of data.sessions) {
      lines.push(`- **${s.projectName} / ${s.name}** [${s.status}] (created ${s.age})`)
      if (s.branch) lines.push(`  Branch: ${s.branch}`)
      if (s.divergence) lines.push(`  Divergence: ${s.divergence.behind} commits behind main, ${s.divergence.ahead} ahead`)
      if (s.gitSummary) lines.push(`  Git: ${s.gitSummary}`)
      if (s.quickNotes) lines.push(`  Notes: ${s.quickNotes}`)
      if (s.scrollbackTail) lines.push(`  Last terminal output:\n  \`\`\`\n  ${s.scrollbackTail}\n  \`\`\``)
    }
  }

  if (data.agents.length > 0) {
    lines.push('\n## Agents')
    for (const a of data.agents) {
      lines.push(`- **${a.name}** [${a.status}] (created ${a.age})`)
      if (a.description) lines.push(`  Description: ${a.description}`)
      if (a.quickNotes) lines.push(`  Notes: ${a.quickNotes}`)
      if (a.scrollbackTail) lines.push(`  Last terminal output:\n  \`\`\`\n  ${a.scrollbackTail}\n  \`\`\``)
    }
  }

  if (lines.length === 0) {
    return 'No active sessions or agents.'
  }

  return lines.join('\n')
}

const BRIEFING_SYSTEM_PROMPT = `You are a helpful assistant integrated into Sorcerer, a desktop app for orchestrating multiple coding agents. The user is likely multi-tasking across several projects and may feel overwhelmed. Your job is to help them quickly orient, prioritize, and take action.

You will receive a summary of the user's current sessions, agents, git status, terminal output, and notes. Use this to provide a concise, personalized briefing.

Generate a concise, structured briefing using EXACTLY these three sections:

## Your Next Priority
Pick the ONE session, agent, or project that most needs the user's attention right now. If an agent just finished a task, suggest the user review it. Explain in 1-2 sentences what's happening and what they should do next.

## Needs Attention
List any sessions or agents that have issues or loose ends — uncommitted changes, sessions idle for a long time, stale branches, failed processes, or notes that suggest unfinished work. Use bullet points, one per item. If nothing needs attention, write "All clear."

**Branch divergence is critical to flag.** If a session shows "X commits behind main", warn the user — the longer they wait, the harder it will be to land. Branches 10+ commits behind should be called out urgently.

## Clean & Ready
Briefly list sessions that are in a good state — clean git status, recently completed work, or idle with nothing pending. Keep this short.

Rules:
- Keep the total response under 250 words
- Be specific — reference project names, branch names, and actual content from notes/terminal output
- Use **bold** for project/session names
- Do NOT make up information that isn't in the context
- Do NOT add a greeting or sign-off — get straight to the content
- If a session has no terminal output or notes, just report its status briefly
- If there's only 1-2 sessions, keep each section proportionally short`

export async function generateBriefing(
  db: DatabaseService,
  pty: PTYService
): Promise<{ text: string; provider: string; model: string; error?: string }> {
  // Get configured provider and key
  const providerId = db.getSetting('briefingProvider') || 'anthropic'
  const apiKey = db.getSetting(`apiKey_${providerId}`)

  if (!apiKey) {
    return {
      text: '',
      provider: providerId,
      model: '',
      error: `No API key configured for ${providerId}. Add one in Settings → Briefing.`
    }
  }

  // Collect data
  const data = collectBriefingData(db, pty)

  if (data.sessions.length === 0 && data.agents.length === 0) {
    return {
      text: 'No sessions or agents to report on. Create a session to get started!',
      provider: providerId,
      model: '',
    }
  }

  // Collect git summaries (async)
  await collectGitSummaries(db, data.sessions)

  // Build prompt
  const contextText = buildPromptContext(data)
  const messages: AIMessage[] = [
    { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
    { role: 'user', content: `Here is the current state of my workspace:\n\n${contextText}` }
  ]

  return generateCompletion(providerId, apiKey, messages)
}
