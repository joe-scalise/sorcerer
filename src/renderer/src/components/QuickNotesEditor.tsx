import { useEffect, useRef, useState } from 'react'
import { useToastStore } from '../stores/useToastStore'
import { noteKey, useQuickNotesDraftStore } from '../stores/useQuickNotesDraftStore'
import { CopyIcon, TrashIcon } from './icons'

interface QuickNotesEditorProps {
  parentId: string
  parentType: 'session' | 'agent'
  parentName: string
  onDeleted?: () => void
}

export function QuickNotesEditor({ parentId, parentType, parentName, onDeleted }: QuickNotesEditorProps) {
  const draft = useQuickNotesDraftStore((state) => state.drafts[noteKey(parentId, parentType)])
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { addToast } = useToastStore()
  const content = draft?.content ?? ''

  useEffect(() => {
    void useQuickNotesDraftStore.getState().load(parentId, parentType)
    return () => {
      void useQuickNotesDraftStore.getState().flush(parentId, parentType)
    }
  }, [parentId, parentType])

  useEffect(() => {
    if (draft?.loaded) textareaRef.current?.focus()
  }, [parentId, parentType, draft?.loaded])

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
    }).catch(() => {
      addToast('Failed to copy', 'error')
    })
  }

  const handleDelete = async () => {
    try {
      await useQuickNotesDraftStore.getState().remove(parentId, parentType)
      onDeleted?.()
    } catch {
      addToast('Failed to delete notes. Your notes have been kept.', 'error')
    }
  }

  const handleRetry = () => {
    const store = useQuickNotesDraftStore.getState()
    if (draft?.error?.startsWith('Could not delete')) void handleDelete()
    else if (draft?.loaded) void store.flush(parentId, parentType)
    else void store.load(parentId, parentType)
  }

  return (
    <div className="quick-notes-editor">
      <div className="quick-notes-toolbar">
        <span className="quick-notes-label">{parentName}</span>
        <div className="quick-notes-toolbar-actions">
          <button className="quick-notes-copy-btn" onClick={handleCopy} title="Copy notes" disabled={!draft?.loaded}>
            <CopyIcon />
            {copied ? 'Copied' : 'Copy'}
          </button>
          {content.length > 0 && (
            <button className="quick-notes-delete-btn" onClick={handleDelete} title="Delete notes" disabled={draft?.deleting}>
              <TrashIcon />
              {draft?.deleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
      {draft?.error ? (
        <div role="alert" className="quick-notes-status quick-notes-status--error">
          {draft.error} <button className="quick-notes-copy-btn" onClick={handleRetry}>Retry</button>
        </div>
      ) : (
        <span className="quick-notes-status" role="status">
          {!draft?.loaded ? 'Loading notes...' : draft.saving || draft.dirty ? 'Saving...' : content ? 'Saved' : 'Notes save automatically'}
        </span>
      )}
      <textarea
        ref={textareaRef}
        className="quick-notes-textarea"
        value={content}
        onChange={(event) => useQuickNotesDraftStore.getState().update(parentId, parentType, event.target.value)}
        onBlur={() => { void useQuickNotesDraftStore.getState().flush(parentId, parentType) }}
        disabled={!draft?.loaded || draft.deleting}
        aria-label={`Notes for ${parentName}`}
        placeholder="Type your notes here..."
        spellCheck={false}
      />
    </div>
  )
}
