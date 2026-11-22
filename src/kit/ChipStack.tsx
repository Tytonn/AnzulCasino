/**
 * A stack of chips for a bet (spec: The room model: "Chips are only an
 * animation after the bet is placed"). The stack grows with the size of the
 * bet, slides in when a bet is placed and leaves when it is paid or lost.
 *
 *   <ChipStack amount={round.stake} />
 */
import { AnimatePresence, motion } from 'motion/react'

const COLORS = ['var(--accent)', 'var(--gold)', 'var(--avatar-cyan)', 'var(--avatar-pink)']

/** 1 chip for a small bet up to 6 for a huge one: the stack grows with each 10x. */
export function chipsFor(amount: number): number {
  if (amount <= 0) return 0
  return Math.max(1, Math.min(6, Math.floor(Math.log10(Math.max(1, amount))) + 1))
}

export function ChipStack({
  amount,
  size = 'md',
  className = '',
}: {
  /** Chips. Zero or less draws nothing. */
  amount: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const count = chipsFor(amount)
  const width = size === 'sm' ? 18 : size === 'lg' ? 34 : 26
  const step = width * 0.16
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width, height: width * 0.62 + step * 5 }}
    >
      <AnimatePresence initial={false}>
        {Array.from({ length: count }, (_, i) => (
          <motion.span
            key={i}
            className="absolute left-0 block rounded-[50%]"
            style={{
              width,
              height: width * 0.62,
              bottom: i * step,
              backgroundColor: COLORS[i % COLORS.length],
              boxShadow: `inset 0 -2px 0 color-mix(in oklab, var(--bg) 45%, transparent), inset 0 0 0 ${Math.max(2, width / 9)}px color-mix(in oklab, var(--text) 35%, transparent)`,
            }}
            initial={{ y: -24, opacity: 0, scale: 0.8 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 30, delay: i * 0.035 }}
          />
        ))}
      </AnimatePresence>
    </span>
  )
}
