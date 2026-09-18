import { useState } from 'react'
import { Dialog, DialogField, DialogActions, DialogButton } from '../Dialog'
import { useUIStore } from '../../stores/useUIStore'
import { useProjectStore } from '../../stores/useProjectStore'

/** Extract the last folder segment from a path */
function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const sep = trimmed.lastIndexOf('\\') !== -1 ? '\\' : '/'
  return trimmed.slice(trimmed.lastIndexOf(sep) + 1)
}

export function AddProjectDialog() {
  const { activeDialog, closeDialog } = useUIStore()
  const { addProject, addProjectByPath } = useProjectStore()
  const [nameOverride, setNameOverride] = useState('')
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = activeDialog === 'add-project'

  // Derive name: user override wins, otherwise extract from path
  const derivedName = folderName(path)
  const effectiveName = nameOverride.trim() || derivedName
  const canSubmit = !!path.trim() && !submitting

  const resetAndClose = () => {
    setNameOverride('')
    setPath('')
    setError(null)
    closeDialog()
  }

  const handleClose = () => {
    if (!submitting) resetAndClose()
  }

  const handleBrowse = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const project = await addProject()
      if (project) {
        // If user browsed, the backend already added it with folder name.
        // If they had a name override, update it.
        if (nameOverride.trim() && nameOverride.trim() !== project.name) {
          await useProjectStore.getState().updateProject(project.id, { name: nameOverride.trim() })
        }
        resetAndClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this project.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const project = await addProjectByPath(path.trim(), effectiveName || undefined)
      if (project) {
        resetAndClose()
      } else {
        setError('Could not add this folder. Check that the path exists and you have access, then try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this project.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Add Project">
      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <DialogField label="Path">
          <div className="dialog-path-row">
            <input
              className="dialog-input"
              type="text"
              placeholder="C:\Projects\my-app"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              required
            />
            <button type="button" className="dialog-browse-btn" onClick={handleBrowse}>
              Browse &amp; Add…
            </button>
          </div>
        </DialogField>
        <DialogField label="Project name">
          <input
            className="dialog-input"
            type="text"
            placeholder={derivedName || 'Folder name'}
            value={nameOverride}
            onChange={(e) => setNameOverride(e.target.value)}
          />
          <div className="dialog-hint" style={{ marginTop: 4, marginBottom: 0 }}>
            Defaults to folder name. Override if you want a different display name.
          </div>
        </DialogField>
        <div className="dialog-hint">
          Any folder works — git repos get worktree isolation and branch tracking.
        </div>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <DialogActions>
          <DialogButton onClick={handleClose} disabled={submitting}>Cancel</DialogButton>
          <DialogButton variant="primary" type="submit" loading={submitting} disabled={!canSubmit}>Add Project</DialogButton>
        </DialogActions>
        </fieldset>
      </form>
    </Dialog>
  )
}
