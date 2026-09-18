import { useToastStore } from '../stores/useToastStore'

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const pauseToast = useToastStore((s) => s.pauseToast)
  const resumeToast = useToastStore((s) => s.resumeToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}${toast.dismissing ? ' toast--dismissing' : ''}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => pauseToast(toast.id)}
          onMouseLeave={() => resumeToast(toast.id)}
          onFocus={() => pauseToast(toast.id)}
          onBlur={() => resumeToast(toast.id)}
        >
          <span className="toast-message">{toast.message}</span>
          <button className="toast-dismiss" type="button" aria-label="Dismiss notification" onClick={() => removeToast(toast.id)}>&times;</button>
        </div>
      ))}
    </div>
  )
}
