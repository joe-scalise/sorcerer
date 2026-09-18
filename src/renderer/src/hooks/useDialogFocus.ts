import { useEffect, useRef } from 'react'

const openDialogs: HTMLElement[] = []
const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** Focus containment shared by standard dialogs and custom modal surfaces. */
export function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Capture during render, before React commits a child's autoFocus.
  const previousFocus = document.activeElement as HTMLElement | null

  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    openDialogs.push(dialog)
    const isTopmost = () => openDialogs.at(-1) === dialog
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
    // Preserve field autofocus. Otherwise focus the surface, avoiding destructive defaults.
    if (!dialog.contains(document.activeElement)) dialog.focus()

    const onKey = (event: KeyboardEvent) => {
      if (!isTopmost() || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements.at(-1)
        if (!first) {
          event.preventDefault()
          dialog.focus()
        } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    // A portalled select declares its owning modal to remain part of its focus scope.
    const onFocus = (event: FocusEvent) => {
      if (!isTopmost()) return
      const target = event.target as HTMLElement
      if (dialog.contains(target) || target.closest('[data-dialog-owner]')?.getAttribute('data-dialog-owner') === dialog.id) return
      dialog.focus()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      const wasTopmost = isTopmost()
      openDialogs.splice(openDialogs.indexOf(dialog), 1)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      if (wasTopmost && previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])
  return ref
}
