/**
 * A panel over the page: a bottom sheet on a phone (chat, leaderboard), a
 * drawer from the right between 768 and 1100px (the sidebar), or a centered
 * card (a profile). Escape, the backdrop and the close button close it.
 */
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'

import { CloseIcon } from '../../kit/icons.tsx'

type Placement = 'bottom' | 'right' | 'center'

const PANEL: Record<Placement, string> = {
  bottom:
    'inset-x-0 bottom-0 max-h-[88dvh] h-[88dvh] rounded-t-lg border-t pb-[env(safe-area-inset-bottom)]',
  right: 'inset-y-0 right-0 w-[min(22rem,92vw)] border-l',
  center:
    'left-1/2 top-1/2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border max-h-[85dvh]',
}

const MOTION = {
  bottom: { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } },
  right: { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } },
  center: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
  },
} as const

export function Sheet({
  open,
  onClose,
  title,
  placement,
  children,
  hideTitle = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  placement: Placement
  children: ReactNode
  hideTitle?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      before?.focus?.()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0 bg-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            {...MOTION[placement]}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            className={`absolute flex flex-col overflow-hidden border-border bg-surface-1 shadow-pop outline-none ${PANEL[placement]}`}
          >
            <header
              className={`flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2 ${hideTitle ? 'absolute top-0 right-0 z-10' : ''}`}
            >
              {placement === 'bottom' && (
                <span className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border-strong" />
              )}
              {!hideTitle && <h2 className="text-base font-semibold">{title}</h2>}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text active:scale-95"
              >
                <CloseIcon className="size-5" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
