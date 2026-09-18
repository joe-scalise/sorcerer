import { useState } from 'react'
import { Dialog, DialogActions, DialogButton } from '../Dialog'
import { useUIStore } from '../../stores/useUIStore'
import { useAgentStore } from '../../stores/useAgentStore'
import { useSessionStore } from '../../stores/useSessionStore'

export function DeleteAgentDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { agents, removeAgent } = useAgentStore()
  const { activeSessionId } = useSessionStore()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = activeDialog === 'delete-agent'
  const agent = dialogTargetId ? agents.find((a) => a.id === dialogTargetId) : undefined

  const handleDelete = async () => {
    if (!agent || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await removeAgent(agent.id)
      // Clear active session if it was the deleted agent
      if (activeSessionId === agent.id) {
        useSessionStore.setState({ activeSessionId: null })
      }
      closeDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this agent. Please try again.')
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
    <Dialog open={open} onClose={handleClose} title="Delete Agent" variant="danger">
      <div className="dialog-confirm-body">
        <div className="dialog-confirm-icon dialog-confirm-icon--danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p className="dialog-confirm-text">
          Are you sure you want to delete <strong>{agent?.name}</strong>?
          This will stop the agent and remove its configuration.
        </p>
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </div>
      <DialogActions>
        <DialogButton onClick={handleClose} disabled={deleting}>Cancel</DialogButton>
        <DialogButton variant="danger" onClick={handleDelete} loading={deleting}>Delete</DialogButton>
      </DialogActions>
    </Dialog>
  )
}
