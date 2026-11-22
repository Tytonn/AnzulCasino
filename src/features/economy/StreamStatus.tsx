/**
 * The economy's line in the phone's strip over the stream: when work is
 * ready again, such as "Work 2:41", or "Work ready" (spec: The stream >
 * Phone). The full set of timers is in the You panel.
 */
import { useNow } from '../../kit/clock.ts'
import { msUntil, shortWait, useEconomy } from './data.ts'

export function WorkStatus() {
  const { data: state } = useEconomy()
  const now = useNow().getTime()
  if (!state) return null
  const left = msUntil(state.cooldowns.work, now)
  return (
    <span
      data-economy-status
      className="text-xs whitespace-nowrap text-muted tabular-nums"
      aria-label={left > 0 ? `Work is ready in ${shortWait(left)}` : 'Work is ready'}
    >
      Work{' '}
      <span className={left > 0 ? 'text-text' : 'text-online'}>
        {left > 0 ? shortWait(left) : 'ready'}
      </span>
    </span>
  )
}
