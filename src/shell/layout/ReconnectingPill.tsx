/** A small pill while the live connection is down (spec: States). The page recovers by itself. */
import { AnimatePresence, motion } from 'motion/react'

import { useLiveStatus } from '../../live/index.ts'

export function ReconnectingPill() {
  const status = useLiveStatus()
  return (
    <AnimatePresence>
      {status === 'reconnecting' && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border-strong bg-surface-3 px-3 py-1.5 text-xs font-medium text-muted shadow-pop"
        >
          <span className="size-2 animate-pulse rounded-full bg-gold" />
          Reconnecting
        </motion.div>
      )}
    </AnimatePresence>
  )
}
