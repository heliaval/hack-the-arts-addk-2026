import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

const EASE = [0.23, 1, 0.32, 1] as const
const EXIT = [0.4, 0, 1, 1] as const
const CELL = { type: 'spring', stiffness: 520, damping: 34, mass: 0.45 } as const
const NUDGE = { type: 'spring', stiffness: 700, damping: 46, mass: 0.5 } as const
const NONE = { duration: 0 } as const
const SLIDE = { type: 'spring', stiffness: 700, damping: 46, mass: 0.5 } as const
const OPEN = { type: 'spring', stiffness: 620, damping: 38, mass: 0.6 } as const
const ROW_H = 28

// Delay before a hover-close actually fires, so moving the pointer across
// the ~6px gap between trigger and panel (or a brief pass-over) doesn't
// flicker the menu shut -- this is what "hover to open, not annoying"
// comes down to.
const HOVER_CLOSE_DELAY_MS = 150

export type DropdownItem = {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export type UseDropdownOptions = {
  items: DropdownItem[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  disabled?: boolean
  typeaheadDelay?: number
  defaultOpen?: boolean
}

export function useDropdown({
  items,
  value,
  defaultValue,
  onChange,
  disabled = false,
  typeaheadDelay = 600,
  defaultOpen = false,
}: UseDropdownOptions) {
  const uid = useId()
  const listId = `${uid}-list`
  const itemId = useCallback((i: number) => `${uid}-opt-${i}`, [uid])

  const [uncontrolled, setUncontrolled] = useState<string | null>(defaultValue ?? null)
  const selectedValue = value !== undefined ? value : uncontrolled
  const selectedIndex = items.findIndex((it) => it.value === selectedValue)

  const [open, setOpen] = useState(defaultOpen)
  const [activeIndex, setActiveIndex] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const viaKey = useRef(false)
  const buffer = useRef('')
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emit = useRef(onChange)
  emit.current = onChange

  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      const n = items.length
      if (n === 0) return -1
      let i = from
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n
        if (!items[i].disabled) return i
      }
      return from
    },
    [items],
  )

  const edge = useCallback((dir: 1 | -1) => step(dir === 1 ? -1 : items.length, dir), [step, items.length])

  const openMenu = useCallback(
    (index?: number) => {
      if (disabled || items.length === 0) return
      const usable = selectedIndex >= 0 && !items[selectedIndex].disabled
      viaKey.current = true
      setActiveIndex(index ?? (usable ? selectedIndex : edge(1)))
      setOpen(true)
    },
    [disabled, items, selectedIndex, edge],
  )

  const close = useCallback((restoreFocus = true) => {
    buffer.current = ''
    setOpen(false)
    setActiveIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const select = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || item.disabled) return
      if (value === undefined) setUncontrolled(item.value)
      emit.current?.(item.value)
      close()
    },
    [items, value, close],
  )

  const typeahead = useCallback(
    (char: string) => {
      if (bufferTimer.current) clearTimeout(bufferTimer.current)
      buffer.current += char.toLowerCase()
      bufferTimer.current = setTimeout(() => {
        buffer.current = ''
      }, typeaheadDelay)

      const q = buffer.current
      const n = items.length
      const from = activeIndex < 0 ? 0 : activeIndex
      const start = q.length > 1 ? from : from + 1
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n
        const it = items[i]
        if (!it.disabled && it.label.toLowerCase().startsWith(q)) {
          viaKey.current = true
          setActiveIndex(i)
          return
        }
      }
    },
    [items, activeIndex, typeaheadDelay],
  )

  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    const onWindowBlur = () => close(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, close])

  useEffect(() => {
    if (!open || activeIndex < 0 || !viaKey.current) return
    viaKey.current = false
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(
    () => () => {
      if (bufferTimer.current) clearTimeout(bufferTimer.current)
    },
    [],
  )

  const triggerProps = {
    ref: triggerRef,
    type: 'button' as const,
    disabled,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    onClick: () => (open ? close() : openMenu()),
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu(edge(-1))
      }
    },
  }

  const listProps = {
    ref: listRef,
    id: listId,
    role: 'listbox' as const,
    tabIndex: -1,
    'aria-activedescendant': activeIndex >= 0 ? itemId(activeIndex) : undefined,
    onKeyDown: (e: React.KeyboardEvent<HTMLUListElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        viaKey.current = true
        setActiveIndex((i) => step(i, dir))
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        viaKey.current = true
        setActiveIndex(edge(e.key === 'Home' ? 1 : -1))
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        select(activeIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        close()
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        typeahead(e.key)
      }
    },
  }

  const getItemProps = useCallback(
    (index: number) => ({
      id: itemId(index),
      role: 'option' as const,
      'aria-selected': index === selectedIndex,
      'aria-disabled': items[index]?.disabled ? (true as const) : undefined,
      ref: (el: HTMLLIElement | null) => {
        itemRefs.current[index] = el
      },
      onPointerMove: () => {
        if (items[index]?.disabled) return
        viaKey.current = false
        setActiveIndex(index)
      },
      onClick: () => select(index),
    }),
    [itemId, items, selectedIndex, select],
  )

  return {
    open,
    openMenu,
    close,
    select,
    activeIndex,
    selectedIndex,
    selectedItem: selectedIndex >= 0 ? items[selectedIndex] : null,
    itemId,
    rootRef,
    triggerProps,
    listProps,
    getItemProps,
  }
}

export type DropdownProps = {
  items: DropdownItem[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  emptyLabel?: string
  className?: string
  defaultOpen?: boolean
}

/** Trigger opens on hover (with a short close-delay so crossing the gap
 * between button and panel doesn't flicker it shut), keyboard/click still
 * work for accessibility -- see HOVER_CLOSE_DELAY_MS above. */
export function Dropdown({
  items,
  value,
  defaultValue,
  onChange,
  label = 'options',
  placeholder = 'select',
  disabled = false,
  emptyLabel = 'nothing to choose',
  className = '',
  defaultOpen = false,
}: DropdownProps) {
  const reduced = useReducedMotion()
  const { open, openMenu, close, activeIndex, selectedIndex, selectedItem, rootRef, triggerProps, listProps, getItemProps } =
    useDropdown({ items, value, defaultValue, onChange, disabled, defaultOpen })

  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearHoverClose = useCallback(() => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
  }, [])
  const handleMouseEnter = useCallback(() => {
    clearHoverClose()
    if (!disabled) openMenu()
  }, [clearHoverClose, disabled, openMenu])
  const handleMouseLeave = useCallback(() => {
    clearHoverClose()
    hoverCloseTimer.current = setTimeout(() => close(false), HOVER_CLOSE_DELAY_MS)
  }, [clearHoverClose, close])
  useEffect(() => clearHoverClose, [clearHoverClose])

  const cell = reduced ? NONE : CELL

  return (
    <div
      ref={rootRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn('relative inline-block text-left', className)}
    >
      <button
        {...triggerProps}
        className={cn(
          'flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-transparent px-2 font-mono text-xs text-foreground outline-none transition-colors disabled:opacity-50',
          open ? 'border-accent/60' : 'hover:border-foreground/30',
        )}
      >
        <span className="sr-only">
          {label}: {selectedItem ? selectedItem.label : placeholder}
        </span>
        <span aria-hidden>{selectedItem ? selectedItem.label : placeholder}</span>
        <motion.svg
          aria-hidden
          viewBox="0 0 12 12"
          className="size-2.5 shrink-0 text-muted-foreground"
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduced ? NONE : NUDGE}
        >
          <path
            d="M3 4.75 6 7.75 9 4.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4, transition: reduced ? NONE : { duration: 0.1, ease: EXIT } }}
            transition={reduced ? NONE : { ...OPEN, opacity: { duration: 0.1, ease: EASE } }}
            style={{ transformOrigin: 'top left' }}
            className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[96px] whitespace-nowrap rounded-sm border border-border bg-popover p-1 shadow-sm"
          >
            <ul
              {...listProps}
              aria-label={label}
              className={cn(
                'relative max-h-[216px] overflow-y-auto outline-none [scrollbar-gutter:stable]',
                '[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]',
                '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent',
                '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border',
              )}
            >
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-7 rounded-[2px] bg-muted"
                initial={false}
                animate={{ y: activeIndex < 0 ? 0 : activeIndex * ROW_H, opacity: activeIndex < 0 ? 0 : 1 }}
                transition={reduced ? NONE : { ...SLIDE, opacity: { duration: 0.1, ease: EASE } }}
              />
              {items.map((item, i) => {
                const picked = i === selectedIndex
                return (
                  <li
                    key={item.value}
                    {...getItemProps(i)}
                    className={cn(
                      'relative flex h-7 cursor-default select-none items-center rounded-[2px] px-2 font-mono text-xs',
                      item.disabled ? 'text-muted-foreground/50' : 'text-foreground',
                    )}
                  >
                    <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
                    <motion.span
                      aria-hidden
                      initial={false}
                      animate={{ opacity: picked ? 1 : 0, scale: picked ? 1 : 0.7 }}
                      transition={cell}
                      className="relative ml-2 flex size-2.5 shrink-0 items-center justify-center"
                    >
                      <span className="size-1.5 rounded-full bg-accent" />
                    </motion.span>
                  </li>
                )
              })}
              {items.length === 0 && (
                <li role="presentation" className="flex h-7 items-center px-2 font-mono text-xs text-muted-foreground">
                  {emptyLabel}
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default Dropdown
