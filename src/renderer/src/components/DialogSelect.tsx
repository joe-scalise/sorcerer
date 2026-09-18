import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronIcon } from './icons'

export interface DialogSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface DialogSelectProps {
  value: string
  onChange: (value: string) => void
  options: DialogSelectOption[]
  disabled?: boolean
  placeholder?: string
  style?: CSSProperties
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function findNextEnabled(options: DialogSelectOption[], startIndex: number, direction: 1 | -1) {
  if (options.length === 0) return -1
  let index = startIndex
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return -1
}

export function DialogSelect({ value, onChange, options, disabled = false, placeholder, style }: DialogSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()

  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value]
  )
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null
  const triggerLabel = selectedOption?.label || placeholder || ''

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const onResize = () => setOpen(false)
    const onScroll = (event: Event) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return
      setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const nextIndex =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : options.findIndex((option) => !option.disabled)
    setHighlightedIndex(nextIndex)
  }, [open, options, selectedIndex])

  useEffect(() => {
    if (!open || highlightedIndex < 0) return
    const option = optionRefs.current[highlightedIndex]
    option?.focus()
    option?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedIndex])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) {
      setMenuPosition(null)
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const menuRect = menuRef.current.getBoundingClientRect()
    const viewportPadding = 12
    const gap = 6
    const availableWidth = window.innerWidth - viewportPadding * 2
    const width = Math.min(Math.max(triggerRect.width, 160), availableWidth)
    const left = clamp(triggerRect.left, viewportPadding, window.innerWidth - viewportPadding - width)

    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding - gap
    const spaceAbove = triggerRect.top - viewportPadding - gap
    const preferredHeight = Math.min(menuRect.height || 0, 280) || 280
    const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, Math.min(280, openUpward ? spaceAbove : spaceBelow))
    const renderedHeight = Math.min(menuRect.height || preferredHeight, maxHeight)
    const top = openUpward
      ? Math.max(viewportPadding, triggerRect.top - gap - renderedHeight)
      : Math.min(triggerRect.bottom + gap, window.innerHeight - viewportPadding - renderedHeight)

    setMenuPosition({ top, left, width, maxHeight })
  }, [open, options.length, highlightedIndex])

  const selectValue = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveHighlight = (direction: 1 | -1) => {
    const start = highlightedIndex >= 0 ? highlightedIndex : selectedIndex >= 0 ? selectedIndex : -1
    const next = findNextEnabled(options, start, direction)
    if (next >= 0) setHighlightedIndex(next)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const start = selectedIndex >= 0 ? selectedIndex - direction : direction === 1 ? -1 : 0
      const next = findNextEnabled(options, start, direction)
      if (next >= 0) setHighlightedIndex(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(-1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (highlightedIndex >= 0 && !options[highlightedIndex]?.disabled) {
        selectValue(options[highlightedIndex].value)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'Tab') {
      // Move from the trigger in normal tab order after closing the portalled list.
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="dialog-select" style={style}>
      <button
        ref={triggerRef}
        type="button"
        className={`dialog-input dialog-select__trigger ${open ? 'dialog-select__trigger--open' : ''}`}
        onClick={() => !disabled && setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
      >
        <span className={`dialog-select__label ${selectedOption ? '' : 'dialog-select__label--placeholder'}`}>
          {triggerLabel}
        </span>
        <ChevronIcon className={`dialog-select__icon ${open ? 'dialog-select__icon--open' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className="dialog-select__menu"
          role="listbox"
          data-dialog-owner={triggerRef.current?.closest('[role="dialog"]')?.id}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          style={menuPosition ? {
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight
          } : undefined}
        >
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = index === highlightedIndex
            return (
              <button
                key={`${option.value}-${index}`}
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={[
                  'dialog-select__option',
                  selected ? 'dialog-select__option--selected' : '',
                  highlighted ? 'dialog-select__option--highlighted' : '',
                  option.disabled ? 'dialog-select__option--disabled' : ''
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                onClick={() => !option.disabled && selectValue(option.value)}
                disabled={option.disabled}
              >
                {option.label}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
