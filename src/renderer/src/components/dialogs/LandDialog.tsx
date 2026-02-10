import { Dialog, DialogActions, DialogButton } from '../Dialog'
import { useUIStore } from '../../stores/useUIStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { useToastStore } from '../../stores/useToastStore'

export function LandDialog() {
  const { activeDialog, dialogTargetId, closeDialog } = useUIStore()
  const { sessions, landOnMain } = useSessionStore()
  const { addToast } = useToastStore()

  const open = activeDialog === 'land-session'

  const session = dialogTargetId ? sessions.find((s) => s.id === dialogTargetId) : undefined
  const sessionName = session?.name ?? 'this session'

  const handleConfirm = async () => {
    if (!dialogTargetId) return
    try {
      await landOnMain(dialogTargetId)
      addToast(`"${sessionName}" landed on main`, 'success')
    } catch (err: any) {
      addToast(err?.message || 'Failed to land on main', 'error')
    }
    closeDialog()
  }

  return (
    <Dialog open={open} onClose={closeDialog} title="Land on main">
      <div className="dialog-confirm-body">
        <div className="dialog-confirm-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M6 9v9" />
            <path d="M9 6h6a3 3 0 0 1 3 3v6" />
          </svg>
        </div>
        <p className="dialog-confirm-text">
          Land <strong>{sessionName}</strong> onto main? This will squash-merge all commits into a single commit on main.
        </p>
        <p className="dialog-confirm-subtext">The worktree and branch will be cleaned up after merging.</p>
      </div>
      <DialogActions>
        <DialogButton onClick={closeDialog}>Cancel</DialogButton>
        <DialogButton variant="primary" onClick={handleConfirm}>Land</DialogButton>
      </DialogActions>
    </Dialog>
  )
}
