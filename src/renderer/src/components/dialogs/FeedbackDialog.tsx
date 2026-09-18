import React, { useEffect, useMemo, useState } from 'react'
import { getApi } from '../../api/client'
import { useUIStore } from '../../stores/useUIStore'
import { useToastStore } from '../../stores/useToastStore'
import { Dialog, DialogActions, DialogButton, DialogField } from '../Dialog'

const FEEDBACK_ISSUE_URL = 'https://github.com/joe-scalise/sorcerer/issues/new'

function buildFeedbackTitle(feedback: string): string {
  const trimmed = feedback.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'Feedback'
  const preview = trimmed.length > 72 ? `${trimmed.slice(0, 69).trimEnd()}...` : trimmed
  return `Feedback: ${preview}`
}

function buildFeedbackBody(feedback: string, contactEmail: string, version: string, platform: string): string {
  return [
    '## Feedback',
    feedback.trim(),
    '## Metadata',
    `- Contact: ${contactEmail.trim() || 'Not provided'}`,
    `- Sorcerer Version: ${version}`,
    `- Platform: ${platform}`
  ].join('\n\n')
}

export function FeedbackDialog() {
  const { activeDialog, closeDialog } = useUIStore()
  const addToast = useToastStore((s) => s.addToast)
  const open = activeDialog === 'feedback'

  const [feedback, setFeedback] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = useMemo(() => feedback.trim().length > 0 && !submitting, [feedback, submitting])

  useEffect(() => {
    if (!open) return
    getApi().settings.get('gravatar_email').then((email: string | undefined) => {
      setContactEmail(email || '')
    }).catch(() => {})
  }, [open])

  const resetDraft = () => {
    setFeedback('')
    setContactEmail('')
  }

  const handleClose = () => {
    if (submitting) return
    resetDraft()
    closeDialog()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedFeedback = feedback.trim()
    if (!trimmedFeedback) return

    setSubmitting(true)
    try {
      const title = buildFeedbackTitle(trimmedFeedback)
      const body = buildFeedbackBody(trimmedFeedback, contactEmail, __APP_VERSION__, getApi().system.platform)
      const url = `${FEEDBACK_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
      await getApi().window.openExternal(url)
      addToast('Opened GitHub issue draft for your feedback.', 'success')
      resetDraft()
      closeDialog()
    } catch (error) {
      console.error('[feedback-dialog] failed to open issue draft:', error)
      addToast('Could not open the feedback draft. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Give Feedback">
      <form onSubmit={handleSubmit}>
        <div className="dialog-hint" style={{ marginBottom: 12 }}>
          This opens a prefilled Sorcerer GitHub issue draft in your browser so you can review and submit it.
        </div>
        <DialogField label="Feedback">
          <textarea
            className="dialog-input dialog-textarea feedback-dialog-textarea"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What is working well? What should change?"
            rows={6}
            autoFocus
          />
        </DialogField>
        <DialogField label="Contact Email (optional)">
          <input
            className="dialog-input"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </DialogField>
        <div className="dialog-hint" style={{ marginTop: 10 }}>
          Add screenshots or extra context after the GitHub page opens if needed.
        </div>
        <DialogActions>
          <DialogButton onClick={handleClose} disabled={submitting}>Cancel</DialogButton>
          <DialogButton variant="primary" type="submit" loading={submitting} disabled={!canSubmit}>Open Draft</DialogButton>
        </DialogActions>
      </form>
    </Dialog>
  )
}
