import { useState, useEffect } from 'react'
import { getApi } from '../api/client'
import { getFeatures } from '../features'
import { useProjectStore } from '../stores/useProjectStore'
import { useSessionStore } from '../stores/useSessionStore'
import { useAgentStore } from '../stores/useAgentStore'
import { useToastStore } from '../stores/useToastStore'

interface OrphanWorkspace {
  dirName: string
  sessionCount: number
  fullPath: string
  lastModified: string
  diskSize: number
}

interface OrphanAgent {
  dirName: string
  agentName: string
  fullPath: string
  hasManifest: boolean
  lastModified: string
  fileCount: number
  manifest?: {
    name: string
    description?: string
    system_prompt?: string
    mcp_config?: string
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function truncateId(id: string): string {
  // If it looks like a UUID, show first 8 chars
  if (/^[0-9a-f]{8}-/.test(id)) return id.slice(0, 8) + '…'
  return id
}

function shortenPath(fullPath: string): string {
  const home = fullPath.replace(/\\/g, '/')
  // Try to show ~/ relative path
  const parts = home.split('/')
  const homeIdx = parts.indexOf('.sorcerer')
  if (homeIdx >= 0) return '~/' + parts.slice(homeIdx).join('/')
  return fullPath
}

export function OrphanWorkspaceBanner() {
  const [orphans, setOrphans] = useState<OrphanWorkspace[]>([])
  const [orphanAgents, setOrphanAgents] = useState<OrphanAgent[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const loadSessions = useSessionStore((s) => s.loadSessions)
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    Promise.all([
      getApi().workspace.scanOrphans(),
      getFeatures().standaloneAgents ? getApi().workspace.scanOrphanAgents() : Promise.resolve([])
    ]).then(([workspaces, agents]: [OrphanWorkspace[], OrphanAgent[]]) => {
      setOrphans(workspaces)
      setOrphanAgents(agents)
    })
  }, [])

  if (orphans.length === 0 && orphanAgents.length === 0) return null

  const totalCount = orphans.length + orphanAgents.length

  const handleLink = async (orphan: OrphanWorkspace) => {
    setLinking(orphan.dirName)
    try {
      const project = await getApi().project.add()
      if (!project) {
        setLinking(null)
        return
      }

      // Validate the selected project matches the orphan workspace name
      const projectBasename = project.path.replace(/\\/g, '/').split('/').pop()
      if (projectBasename !== orphan.dirName) {
        addToast(`Expected "${orphan.dirName}" but selected "${projectBasename}"`, 'error')
        setLinking(null)
        return
      }

      // Sync worktrees to recover sessions
      const result = await getApi().project.syncWorktrees(project.id)
      await loadProjects()
      await loadSessions()

      setOrphans((prev) => prev.filter((o) => o.dirName !== orphan.dirName))
    } catch (err: any) {
      addToast(err.message || 'Failed to link project', 'error')
    } finally {
      setLinking(null)
    }
  }

  const handleDismiss = async (dirName: string) => {
    await getApi().workspace.dismissOrphan(dirName)
    setOrphans((prev) => prev.filter((o) => o.dirName !== dirName))
  }

  const handleDeleteWorkspace = async (orphan: OrphanWorkspace) => {
    setDeleting(orphan.dirName)
    try {
      await getApi().workspace.deleteOrphan(orphan.dirName)
      setOrphans((prev) => prev.filter((o) => o.dirName !== orphan.dirName))
    } catch (err: any) {
      addToast(err.message || 'Failed to delete workspace', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const handleImportAgent = async (orphan: OrphanAgent) => {
    setImporting(orphan.dirName)
    try {
      const data = orphan.manifest
        ? {
            id: orphan.dirName,
            name: orphan.manifest.name,
            description: orphan.manifest.description,
            system_prompt: orphan.manifest.system_prompt,
            mcp_config: orphan.manifest.mcp_config
          }
        : { id: orphan.dirName, name: orphan.agentName }
      await getApi().agent.add(data)
      await loadAgents()
      setOrphanAgents((prev) => prev.filter((o) => o.dirName !== orphan.dirName))
    } catch (err: any) {
      addToast(err.message || 'Failed to re-import agent', 'error')
    } finally {
      setImporting(null)
    }
  }

  const handleDismissAgent = async (dirName: string) => {
    await getApi().workspace.dismissOrphanAgent(dirName)
    setOrphanAgents((prev) => prev.filter((o) => o.dirName !== dirName))
  }

  const handleDeleteAgent = async (orphan: OrphanAgent) => {
    setDeleting(orphan.dirName)
    try {
      await getApi().workspace.deleteOrphanAgent(orphan.dirName)
      setOrphanAgents((prev) => prev.filter((o) => o.dirName !== orphan.dirName))
    } catch (err: any) {
      addToast(err.message || 'Failed to delete agent', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const handleDismissAll = async () => {
    await Promise.all([
      ...orphans.map((o) => getApi().workspace.dismissOrphan(o.dirName)),
      ...orphanAgents.map((o) => getApi().workspace.dismissOrphanAgent(o.dirName))
    ])
    setOrphans([])
    setOrphanAgents([])
  }

  return (
    <div className="orphan-banner">
      <div className="orphan-banner-header">
        <div className="orphan-banner-title">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
          </svg>
          <span>{totalCount} orphaned {totalCount === 1 ? 'item' : 'items'} found</span>
        </div>
        <button className="orphan-banner-dismiss-all" onClick={handleDismissAll}>
          Dismiss All
        </button>
      </div>

      {orphans.map((orphan) => (
        <div key={orphan.dirName} className="orphan-banner-item">
          <div className="orphan-banner-item-top">
            <span className="orphan-banner-name">{orphan.dirName}</span>
            <span className="orphan-banner-meta">
              {orphan.sessionCount} session{orphan.sessionCount !== 1 ? 's' : ''}
              <span className="orphan-banner-sep">·</span>
              {timeAgo(orphan.lastModified)}
            </span>
            <div className="orphan-banner-actions">
              <button
                className="orphan-banner-link"
                onClick={() => handleLink(orphan)}
                disabled={linking === orphan.dirName}
              >
                {linking === orphan.dirName ? 'Linking...' : 'Link Project'}
              </button>
              <button
                className="orphan-banner-delete"
                onClick={() => handleDeleteWorkspace(orphan)}
                disabled={deleting === orphan.dirName}
              >
                {deleting === orphan.dirName ? 'Deleting...' : 'Delete'}
              </button>
              <button
                className="orphan-banner-dismiss"
                onClick={() => handleDismiss(orphan.dirName)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="orphan-banner-path">{shortenPath(orphan.fullPath)}</div>
        </div>
      ))}

      {orphanAgents.map((orphan) => (
        <div key={orphan.dirName} className="orphan-banner-item">
          <div className="orphan-banner-item-top">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }}>
              <path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM5.5 6a.5.5 0 0 0 0 1h.01a.5.5 0 0 0 0-1H5.5zm5 0a.5.5 0 0 0 0 1h.01a.5.5 0 0 0 0-1h-.01z"/>
              <path d="M4.5 2A2.5 2.5 0 0 0 2 4.5v2.003C2 8.985 3.893 11 6.275 11h3.45C12.107 11 14 8.985 14 6.503V4.5A2.5 2.5 0 0 0 11.5 2h-7zM3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v2.003C13 8.45 11.514 10 9.725 10h-3.45C4.486 10 3 8.45 3 6.503V4.5z"/>
              <path d="M8 12a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1zM5 15h6v-2a3 3 0 0 0-6 0v2z"/>
            </svg>
            <span className="orphan-banner-name">
              {orphan.hasManifest ? orphan.agentName : truncateId(orphan.dirName)}
            </span>
            <span className="orphan-banner-meta">
              {!orphan.hasManifest && <span className="orphan-banner-label">no manifest</span>}
              {orphan.fileCount > 0 && <>{!orphan.hasManifest && <span className="orphan-banner-sep">·</span>}{orphan.fileCount} file{orphan.fileCount !== 1 ? 's' : ''}</>}
              <span className="orphan-banner-sep">·</span>
              {timeAgo(orphan.lastModified)}
            </span>
            <div className="orphan-banner-actions">
              {orphan.hasManifest && (
                <button
                  className="orphan-banner-link"
                  onClick={() => handleImportAgent(orphan)}
                  disabled={importing === orphan.dirName}
                >
                  {importing === orphan.dirName ? 'Importing...' : 'Re-import'}
                </button>
              )}
              <button
                className="orphan-banner-delete"
                onClick={() => handleDeleteAgent(orphan)}
                disabled={deleting === orphan.dirName}
              >
                {deleting === orphan.dirName ? 'Deleting...' : 'Delete'}
              </button>
              <button
                className="orphan-banner-dismiss"
                onClick={() => handleDismissAgent(orphan.dirName)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="orphan-banner-path">{shortenPath(orphan.fullPath)}</div>
        </div>
      ))}
    </div>
  )
}
