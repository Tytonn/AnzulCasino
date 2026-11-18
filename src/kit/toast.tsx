/**
 * Toasts (spec: States): short notes in plain words that say what happened
 * or what to do next. The shell draws them; anything can raise one.
 *
 *   toast.error(errorMessage(error))
 *   toast.good('Shield up. The next steal is blocked.')
 */
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'

export type ToastTone = 'info' | 'good' | 'bad'

export interface Toast {
  id: number
  text: string
  tone: ToastTone
}

interface ToastState {
  toasts: Toast[]
  push(text: string, tone: ToastTone): number
  dismiss(id: number): void
}

const MAX_TOASTS = 4
let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(text, tone) {
    // The same note twice in a row shows once.
    const last = get().toasts.at(-1)
    if (last && last.text === text && last.tone === tone) return last.id
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, text, tone }].slice(-MAX_TOASTS) }))
    setTimeout(() => get().dismiss(id), tone === 'bad' ? 6_000 : 4_000)
    return id
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))

export const toast = {
  info: (text: string) => useToasts.getState().push(text, 'info'),
  good: (text: string) => useToasts.getState().push(text, 'good'),
  error: (text: string) => useToasts.getState().push(text, 'bad'),
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-border-strong',
  good: 'border-gold/60',
  bad: 'border-loss/60',
}

const TONE_DOT: Record<ToastTone, string> = {
  info: 'bg-accent',
  good: 'bg-gold',
  bad: 'bg-loss',
}

/** Drawn once by the shell. Above the phone's tab bar, bottom right on desktop. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            onClick={() => dismiss(t.id)}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border bg-surface-3 px-4 py-3 text-left text-sm shadow-pop ${TONE_CLASS[t.tone]}`}
          >
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
            <span className="min-w-0 flex-1">{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
