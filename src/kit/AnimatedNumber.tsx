/**
 * A number that counts to its new value (spec: Motion: "balances count up and
 * down"). It never blocks input: a new value restarts the count from where
 * it is. With reduced motion it jumps.
 *
 *   <AnimatedNumber value={wallet.balance} />            // chips, as hundredths
 *   <AnimatedNumber value={multiplier} format={(n) => `${(n / 100).toFixed(2)}x`} />
 */
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'

import { formatChips } from '../../shared/chips.ts'

export type Trend = 'up' | 'down' | null

export function AnimatedNumber({
  value,
  format = formatChips,
  className = '',
  flash = true,
}: {
  value: number
  /** Turns the in-between value into text. Defaults to chips. */
  format?: (value: number) => string
  className?: string
  /** Tints the number gold going up and red going down, for a moment. */
  flash?: boolean
}) {
  const reduced = useReducedMotion()
  const shown = useMotionValue(value)
  const text = useTransform(shown, (v) => format(Math.round(v)))

  const [previous, setPrevious] = useState(value)
  const [trend, setTrend] = useState<Trend>(null)
  if (value !== previous) {
    setPrevious(value)
    setTrend(value > previous ? 'up' : 'down')
  }

  useEffect(() => {
    if (reduced) {
      shown.jump(value)
      return
    }
    const distance = Math.abs(value - shown.get())
    const controls = animate(shown, value, {
      duration: distance === 0 ? 0 : Math.min(0.6, 0.25 + Math.log10(distance + 1) / 12),
      ease: [0.22, 1, 0.36, 1],
    })
    return () => controls.stop()
  }, [shown, value, reduced])

  useEffect(() => {
    if (!trend) return
    const timer = setTimeout(() => setTrend(null), 700)
    return () => clearTimeout(timer)
  }, [trend, value])

  const tint = flash && trend === 'up' ? 'text-gold' : flash && trend === 'down' ? 'text-loss' : ''
  return (
    <motion.span className={`tabular-nums transition-colors duration-250 ${tint} ${className}`}>
      {text}
    </motion.span>
  )
}
