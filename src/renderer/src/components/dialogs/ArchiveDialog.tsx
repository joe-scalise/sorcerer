import { useState } from 'react'
import { Dialog, DialogActions, DialogButton } from '../Dialog'
import { useUIStore } from '../../stores/useUIStore'
import { useSessionStore } from '../../stores/useSessionStore'

export function ArchiveDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { sessions, archiveSession } = useSessionStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = activeDialog === 'archive-session'

  const targetSession = dialogTargetId
    ? sessions.find((s) => s.id === dialogTargetId)
    : undefined
  const targetName = targetSession?.name ?? 'this session'

  const handleConfirm = async () => {
    if (!dialogTargetId || loading) return
    setLoading(true)
    setError(null)
    try {
      await archiveSession(dialogTargetId)
      closeDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive this session. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setError(null)
      closeDialog()
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Archive session">
      <div className="dialog-confirm-body">
        <div className="dialog-confirm-icon dialog-confirm-icon--archive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </div>
        <p className="dialog-confirm-text">
          Archive <strong>{targetName}</strong>?
        </p>
        <p className="dialog-confirm-subtext">
          The session process will be stopped. Work will be auto-committed and pushed. You can restore it later.
        </p>
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </div>
      <DialogActions>
        <DialogButton onClick={handleClose} disabled={loading}>Cancel</DialogButton>
        <DialogButton variant="primary" onClick={handleConfirm} loading={loading}>Archive</DialogButton>
      </DialogActions>
    </Dialog>
  )
}
