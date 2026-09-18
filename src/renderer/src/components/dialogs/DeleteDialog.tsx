import { useState } from 'react'
import { Dialog, DialogActions, DialogButton } from '../Dialog'
import { useUIStore } from '../../stores/useUIStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSessionStore } from '../../stores/useSessionStore'

export function DeleteDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { projects, removeProject } = useProjectStore()
  const { sessions, deleteSession } = useSessionStore()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = activeDialog === 'delete-session'

  // Find the target — could be a project or a session
  let targetName = 'this item'
  let targetType: 'project' | 'session' = 'session'

  if (dialogTargetId) {
    const project = projects.find((p) => p.id === dialogTargetId)
    if (project) {
      targetName = project.name
      targetType = 'project'
    } else {
      const session = sessions.find((s) => s.id === dialogTargetId)
      if (session) {
        targetName = session.name
        targetType = 'session'
      }
    }
  }

  const handleConfirm = async () => {
    if (!dialogTargetId || deleting) return
    setDeleting(true)
    setError(null)
    try {
      if (targetType === 'project') {
        await removeProject(dialogTargetId)
      } else {
        await deleteSession(dialogTargetId)
      }
      closeDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this item. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const handleClose = () => {
    if (!deleting) {
      setError(null)
      closeDialog()
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title={`Delete ${targetType}`} variant="danger">
      <div className="dialog-confirm-body">
        <div className="dialog-confirm-icon dialog-confirm-icon--danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p className="dialog-confirm-text">
          Are you sure you want to delete <strong>{targetName}</strong>?
          {targetType === 'project'
            ? ' This will remove the project and all its sessions.'
            : ' The git worktree and branch will be cleaned up.'}
        </p>
        <p className="dialog-confirm-subtext">Changes will be auto-committed and pushed before deletion.</p>
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </div>
      <DialogActions>
        <DialogButton onClick={handleClose} disabled={deleting}>Cancel</DialogButton>
        <DialogButton variant="danger" onClick={handleConfirm} loading={deleting}>Delete</DialogButton>
      </DialogActions>
    </Dialog>
  )
}
