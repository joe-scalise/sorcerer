import React, { useId, useRef, type ReactNode } from 'react'
import { useUIStore } from '../stores/useUIStore'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  variant?: 'default' | 'danger'
}

export function Dialog({ open, onClose, title, children, variant = 'default' }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogClosing = useUIStore((s) => s.dialogClosing)
  const dialogRef = useDialogFocus(open, onClose)
  const titleId = useId()

  if (!open) return null

  return (
    <div
      className={`dialog-overlay ${dialogClosing ? 'dialog-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div ref={dialogRef} id={`${titleId}-dialog`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`dialog ${variant === 'danger' ? 'dialog--danger' : ''} ${dialogClosing ? 'dialog--closing' : ''}`}>
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="dialog-body">
          {children}
        </div>
      </div>
    </div>
  )
}

/* Reusable form pieces */
export function DialogField({ label, children, style }: { label: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="dialog-field" style={style}>
      <label className="dialog-label">{label}</label>
      {children}
    </div>
  )
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="dialog-actions">{children}</div>
}

export function DialogButton({ children, variant = 'secondary', onClick, type, disabled, loading }: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  onClick?: () => void
  type?: 'submit' | 'button'
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      className={`dialog-btn dialog-btn--${variant}`}
      onClick={onClick}
      type={type || 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}
