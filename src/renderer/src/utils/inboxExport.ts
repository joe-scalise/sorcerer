import type { InboxItem } from '../../../shared/inbox'
import type { Project } from '../types'

// Quote all fields for RFC-style CSV and prevent spreadsheet formula execution.
function csvField(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function inboxToCsv(items: InboxItem[], projects: Project[]): string {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const rows = items.map((item) => [
    item.title,
    item.body,
    item.project_id ? (names.get(item.project_id) ?? '') : '',
    item.status,
    item.pinned ? 'Yes' : 'No',
    new Date(item.created_at).toISOString()
  ])
  return (
    '\ufeff' +
    [['Title', 'Details', 'Project', 'Status', 'Pinned', 'Created'], ...rows]
      .map((row) => row.map(csvField).join(','))
      .join('\r\n') +
    '\r\n'
  )
}

export function downloadInboxCsv(items: InboxItem[], projects: Project[], view: string): void {
  const blob = new Blob([inboxToCsv(items, projects)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `sorcerer-inbox-${view}.csv`
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  } finally {
    // Keep the URL alive long enough for the browser's download to begin.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
