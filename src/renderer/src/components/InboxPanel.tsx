import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { useInboxStore, type InboxDraft } from '../stores/useInboxStore'
import { useProjectStore } from '../stores/useProjectStore'
import { INBOX_BODY_LIMIT, INBOX_TITLE_LIMIT, type InboxItem, type InboxStatus } from '../../../shared/inbox'
import {
  ArchiveIcon,
  CheckIcon,
  ChevronIcon,
  DownloadIcon,
  InboxIcon,
  PinIcon,
  PlusIcon,
  RestoreIcon,
  TrashIcon
} from './icons'
import { downloadInboxCsv } from '../utils/inboxExport'
import { useToastStore } from '../stores/useToastStore'
import '../styles/inbox.css'

const views: { id: InboxStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archived' }
]

function ProjectPicker({
  value,
  onChange,
  label,
  disabled
}: {
  value: string | null
  onChange: (id: string | null) => void
  label: string
  disabled?: boolean
}) {
  const projects = useProjectStore((state) => state.projects)
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      disabled={disabled}
    >
      <option value="">No project</option>
      {value && !projects.some((project) => project.id === value) && (
        <option value={value}>Project no longer available</option>
      )}
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  )
}

function submitOnShortcut(event: KeyboardEvent<HTMLFormElement>) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault()
    event.currentTarget.requestSubmit()
  }
}

function InboxEditor({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  saving,
  error
}: {
  draft: InboxDraft
  setDraft: (changes: Partial<InboxDraft>) => void
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
  error?: string
}) {
  return (
    <form
      className="inbox-editor"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      onKeyDown={submitOnShortcut}
    >
      <label>
        Thought
        <input
          aria-label="Edit thought"
          value={draft.title}
          onChange={(event) => setDraft({ title: event.target.value })}
          maxLength={INBOX_TITLE_LIMIT}
          required
          disabled={saving}
          autoFocus
        />
      </label>
      <label>
        Details
        <textarea
          aria-label="Edit details"
          rows={5}
          value={draft.body}
          onChange={(event) => setDraft({ body: event.target.value })}
          maxLength={INBOX_BODY_LIMIT}
          disabled={saving}
          placeholder="Notes, questions, or a useful link…"
        />
      </label>
      <ProjectPicker
        label="Edit project"
        value={draft.project_id}
        onChange={(project_id) => setDraft({ project_id })}
        disabled={saving}
      />
      {error && (
        <p className="inbox-error" role="alert">
          {error}
        </p>
      )}
      <div className="inbox-editor-actions">
        <button className="inbox-text-button" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="inbox-primary-button" type="submit" disabled={saving || !draft.title.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function CaptureItem({ item, visible }: { item: InboxItem; visible: InboxItem[] }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const {
    editDraft,
    startEditing,
    setEditDraft,
    cancelEditing,
    saveEdit,
    updateItem,
    pendingIds,
    itemErrors
  } = useInboxStore()
  const projects = useProjectStore((state) => state.projects)
  const project = projects.find((entry) => entry.id === item.project_id)
  const busy = pendingIds.includes(item.id)
  const editing = editDraft?.id === item.id
  const otherEditing = Boolean(editDraft && !editing)
  const date = new Date(item.created_at)

  return (
    <article
      className={`inbox-item${item.pinned ? ' inbox-item--pinned' : ''}${item.status === 'done' ? ' inbox-item--done' : ''}`}
      aria-label={item.title}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-sorcerer-inbox')) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const id = event.dataTransfer.getData('application/x-sorcerer-inbox')
        const source = visible.find((entry) => entry.id === id)
        if (source && source.pinned === item.pinned && source.id !== item.id)
          void useInboxStore.getState().reorderItem(id, item.id)
      }}
    >
      {editing ? (
        <InboxEditor
          draft={editDraft!}
          setDraft={setEditDraft}
          onSubmit={() => {
            void saveEdit()
          }}
          onCancel={cancelEditing}
          saving={busy}
          error={itemErrors[item.id]}
        />
      ) : (
        <>
          <div className="inbox-item-heading">
            <button
              className="inbox-drag-handle"
              draggable
              aria-label={`Reorder: ${item.title}`}
              title="Drag to reorder; use arrow keys to move"
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-sorcerer-inbox', item.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const index = visible.findIndex((entry) => entry.id === item.id)
                const target = visible[index + (event.key === 'ArrowUp' ? -1 : 1)]
                if (target && target.pinned === item.pinned)
                  void useInboxStore.getState().reorderItem(item.id, target.id)
              }}
            >
              <svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
                <circle cx="4" cy="3" r="1" />
                <circle cx="8" cy="3" r="1" />
                <circle cx="4" cy="8" r="1" />
                <circle cx="8" cy="8" r="1" />
                <circle cx="4" cy="13" r="1" />
                <circle cx="8" cy="13" r="1" />
              </svg>
            </button>
            <button
              className="inbox-item-title"
              onClick={() => startEditing(item)}
              disabled={otherEditing || busy}
              title={otherEditing ? 'Save or cancel your current edit first' : 'Edit thought'}
            >
              {item.title}
            </button>
          </div>
          {item.body && <p className="inbox-item-body">{item.body}</p>}
          <div className="inbox-item-meta">
            {project && (
              <span className="inbox-project-name" title={project.name}>
                {project.name}
              </span>
            )}
            <time dateTime={date.toISOString()} title={date.toLocaleString()}>
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </time>
            <span className="inbox-item-actions">
              <button
                className={`inbox-icon-button${item.pinned ? ' is-active' : ''}`}
                aria-label={`${item.pinned ? 'Unpin' : 'Pin'}: ${item.title}`}
                title={item.pinned ? 'Unpin' : 'Pin'}
                aria-pressed={item.pinned}
                disabled={busy}
                onClick={() => {
                  void updateItem(item.id, { pinned: !item.pinned })
                }}
              >
                <PinIcon />
              </button>
              {item.status === 'open' ? (
                <button
                  className="inbox-icon-button"
                  aria-label={`Mark done: ${item.title}`}
                  title="Mark done"
                  disabled={busy}
                  onClick={() => {
                    void updateItem(item.id, { status: 'done' })
                  }}
                >
                  <CheckIcon />
                </button>
              ) : (
                <button
                  className="inbox-icon-button"
                  aria-label={`Restore: ${item.title}`}
                  title="Move to Open"
                  disabled={busy}
                  onClick={() => {
                    void updateItem(item.id, { status: 'open' })
                  }}
                >
                  <RestoreIcon />
                </button>
              )}
              {item.status !== 'archived' && (
                <button
                  className="inbox-icon-button"
                  aria-label={`Archive: ${item.title}`}
                  title="Archive"
                  disabled={busy}
                  onClick={() => {
                    void updateItem(item.id, { status: 'archived' })
                  }}
                >
                  <ArchiveIcon />
                </button>
              )}
              <button
                className="inbox-icon-button inbox-delete-button"
                type="button"
                aria-label={`Delete: ${item.title}`}
                title="Delete"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon />
              </button>
            </span>
          </div>
          {confirmDelete && (
            <div className="inbox-delete-confirm" role="group" aria-label={`Delete ${item.title}`}>
              <span>Delete permanently?</span>
              <button
                className="inbox-text-button"
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button
                className="inbox-text-button inbox-delete-confirm-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  void useInboxStore.getState().deleteItem(item.id)
                }}
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
          {itemErrors[item.id] && (
            <p className="inbox-error" role="alert">
              {itemErrors[item.id]}
            </p>
          )}
        </>
      )}
    </article>
  )
}

export function InboxPanel() {
  const state = useInboxStore()
  const projects = useProjectStore((store) => store.projects)
  const captureRef = useRef<HTMLTextAreaElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const resizing = useRef(false)
  const [liveWidth, setLiveWidth] = useState(state.width)
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  const maxWidth = Math.max(280, Math.min(800, viewportWidth - (viewportWidth <= 900 ? 52 : 520)))
  const width = Math.min(liveWidth, maxWidth)
  const [detailsOpen, setDetailsOpen] = useState(Boolean(state.draft.body))
  const filter =
    state.projectFilter === '__unassigned' || projects.some((project) => project.id === state.projectFilter)
      ? state.projectFilter
      : ''
  const filtered = state.items.filter(
    (item) => !filter || (filter === '__unassigned' ? !item.project_id : item.project_id === filter)
  )
  const counts = Object.fromEntries(
    views.map(({ id }) => [id, filtered.filter((item) => item.status === id).length])
  )
  const visible = filtered
    .filter((item) => item.status === state.view)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (a.sort_order ?? -a.created_at) - (b.sort_order ?? -b.created_at) ||
        b.created_at - a.created_at ||
        a.id.localeCompare(b.id)
    )
  const openCount = state.items.filter((item) => item.status === 'open').length

  useEffect(() => {
    if (state.enabled) void state.loadItems()
  }, [state.enabled, state.loadItems])
  useEffect(() => {
    if (!state.enabled || state.collapsed) return
    const refresh = () => {
      if (!document.hidden) void useInboxStore.getState().loadItems()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 30_000)
    refresh()
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(interval)
    }
  }, [state.enabled, state.collapsed])
  useEffect(() => {
    if (!resizing.current) setLiveWidth(state.width)
  }, [state.width])
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    const onMove = (event: MouseEvent) => {
      if (resizing.current) setLiveWidth(Math.max(280, Math.min(maxWidth, window.innerWidth - event.clientX)))
    }
    const onUp = (event: MouseEvent) => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      state.setWidth(Math.max(280, Math.min(maxWidth, window.innerWidth - event.clientX)))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (resizing.current) {
        resizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [maxWidth, state.setWidth, state.enabled, state.collapsed])
  useEffect(() => {
    if (state.focusRequest && !state.collapsed) captureRef.current?.focus()
  }, [state.focusRequest, state.collapsed])

  const collapse = () => {
    state.setCollapsed(true)
    requestAnimationFrame(() => {
      if (useInboxStore.getState().collapsed) toggleRef.current?.focus()
    })
  }
  const capture = async (event: FormEvent) => {
    event.preventDefault()
    if (await state.capture()) {
      setDetailsOpen(false)
      captureRef.current?.focus()
    }
  }

  if (!state.enabled) return null

  return (
    <aside
      className={`inbox-panel${state.collapsed ? ' inbox-panel--collapsed' : ''}`}
      style={{ '--inbox-width': `${width}px` } as CSSProperties}
      aria-label="Personal inbox"
      data-inbox
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !(event.target instanceof HTMLSelectElement)) {
          event.preventDefault()
          event.stopPropagation()
          collapse()
        }
      }}
    >
      {!state.collapsed && (
        <div
          className="inbox-resize-handle"
          role="separator"
          aria-label="Resize inbox"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            resizing.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onDoubleClick={() => state.setWidth(320)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowLeft'
                ? width + 16
                : event.key === 'ArrowRight'
                  ? width - 16
                  : event.key === 'Home'
                    ? 280
                    : event.key === 'End'
                      ? maxWidth
                      : null
            if (next !== null) {
              event.preventDefault()
              event.stopPropagation()
              state.setWidth(Math.max(280, Math.min(maxWidth, next)))
            }
          }}
        />
      )}
      <div className="inbox-window-spacer" aria-hidden="true" />
      <div className="inbox-rail" hidden={!state.collapsed}>
        <button
          ref={toggleRef}
          className="inbox-icon-button inbox-rail-toggle"
          onClick={() => state.setCollapsed(false)}
          aria-label={`Open inbox${openCount ? ` (${openCount} open)` : ''}`}
          title="Open inbox (Ctrl+Shift+I)"
          aria-expanded="false"
          aria-controls="personal-inbox-content"
        >
          <InboxIcon />
          {openCount > 0 && <span className="inbox-rail-count">{openCount > 99 ? '99+' : openCount}</span>}
        </button>
      </div>
      <div id="personal-inbox-content" className="inbox-content" hidden={state.collapsed}>
        <header className="inbox-header">
          <div>
            <InboxIcon />
            <h2>Inbox</h2>
            <span className="inbox-count" aria-label={`${openCount} open captures`}>
              {openCount}
            </span>
          </div>
          <div className="inbox-header-actions">
            <button
              className="inbox-icon-button"
              type="button"
              aria-label="Export visible list as CSV"
              title="Export visible list as CSV"
              disabled={!state.loaded || visible.length === 0}
              onClick={() => {
                try {
                  downloadInboxCsv(visible, projects, state.view)
                } catch {
                  useToastStore.getState().addToast('Could not export the inbox. Please try again.', 'error')
                }
              }}
            >
              <DownloadIcon />
            </button>
            <button
              className="inbox-icon-button"
              type="button"
              onClick={() => state.setCaptureOpen(!state.captureOpen)}
              aria-label={state.captureOpen ? 'Collapse capture' : 'Expand capture'}
              title={state.captureOpen ? 'Collapse capture' : 'Expand capture'}
              aria-expanded={state.captureOpen}
              aria-controls="inbox-capture-form"
            >
              {state.captureOpen ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                </svg>
              ) : (
                <PlusIcon />
              )}
            </button>
            <button
              className="inbox-icon-button"
              onClick={collapse}
              aria-label="Collapse inbox"
              title="Collapse inbox"
              aria-expanded="true"
              aria-controls="personal-inbox-content"
            >
              <ChevronIcon />
            </button>
          </div>
        </header>
        <form
          id="inbox-capture-form"
          className="inbox-composer"
          hidden={!state.captureOpen}
          onSubmit={(event) => {
            void capture(event)
          }}
          onKeyDown={submitOnShortcut}
        >
          <textarea
            ref={captureRef}
            aria-label="Capture a thought"
            placeholder="What's on your mind?"
            rows={2}
            value={state.draft.title}
            onChange={(event) => state.setDraft({ title: event.target.value })}
            maxLength={INBOX_TITLE_LIMIT}
            required
          />
          {detailsOpen && (
            <textarea
              className="inbox-composer-details"
              aria-label="Capture details"
              placeholder="A little context, a question, a link…"
              rows={3}
              value={state.draft.body}
              onChange={(event) => state.setDraft({ body: event.target.value })}
              maxLength={INBOX_BODY_LIMIT}
            />
          )}
          <div className="inbox-composer-options">
            <ProjectPicker
              label="Capture project"
              value={state.draft.project_id}
              onChange={(project_id) => state.setDraft({ project_id })}
            />
            <button
              type="button"
              className="inbox-text-button"
              onClick={() => setDetailsOpen(!detailsOpen)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide details' : state.draft.body ? 'Show details' : '+ Details'}
            </button>
          </div>
          {state.createError && (
            <p className="inbox-error" role="alert">
              {state.createError}
            </p>
          )}
          <div className="inbox-composer-footer">
            <span>Ctrl + Enter to save</span>
            <button
              className="inbox-primary-button"
              type="submit"
              disabled={state.creating || !state.draft.title.trim()}
            >
              <PlusIcon />
              {state.creating ? 'Saving…' : 'Capture'}
            </button>
          </div>
        </form>
        <div className="inbox-navigation">
          <label className="inbox-project-filter">
            <span>Project</span>
            <select
              aria-label="Filter inbox by project"
              value={filter}
              onChange={(event) => state.setProjectFilter(event.target.value)}
            >
              <option value="">All projects</option>
              <option value="__unassigned">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <div className="inbox-views" role="group" aria-label="Inbox view">
            {views.map(({ id, label }) => (
              <button
                key={id}
                className={state.view === id ? 'is-selected' : ''}
                aria-pressed={state.view === id}
                onClick={() => state.setView(id)}
              >
                {label}
                <span>{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>
        {state.editDraft && !visible.some((item) => item.id === state.editDraft!.id) && (
          <div className="inbox-retained-edit">
            <p>You have an unfinished edit.</p>
            <InboxEditor
              draft={state.editDraft}
              setDraft={state.setEditDraft}
              onSubmit={() => {
                void state.saveEdit()
              }}
              onCancel={state.cancelEditing}
              saving={state.pendingIds.includes(state.editDraft.id)}
              error={state.itemErrors[state.editDraft.id]}
            />
          </div>
        )}
        {state.loadError && (
          <div className="inbox-load-error" role="alert">
            <p>{state.loadError}</p>
            <button
              className="inbox-text-button"
              onClick={() => {
                void state.loadItems()
              }}
              disabled={state.loading}
            >
              Try again
            </button>
          </div>
        )}
        <div className="inbox-list" aria-busy={state.loading && !state.loaded}>
          {!state.loaded && state.loading ? (
            <p className="inbox-loading" role="status">
              Loading your inbox…
            </p>
          ) : visible.length ? (
            visible.map((item) => <CaptureItem key={item.id} item={item} visible={visible} />)
          ) : (
            !state.loadError && (
              <div className="inbox-empty">
                <InboxIcon />
                <h3>
                  {state.view === 'open'
                    ? filter
                      ? 'No open items for this project.'
                      : 'No open items.'
                    : state.view === 'done'
                      ? 'Nothing marked done yet.'
                      : 'Nothing archived yet.'}
                </h3>
                {!filter && state.view === 'open' && (
                  <p>Keep ideas, to-dos, and loose ends here. Capture a thought above.</p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </aside>
  )
}
