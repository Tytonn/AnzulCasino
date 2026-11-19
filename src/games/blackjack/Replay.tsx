/** A finished hand as History and the ticker replay it: the table as it ended. */
import type { BlackjackDetail } from '../../../shared/games/blackjack.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { Table } from './Table.tsx'
import { finalFrame, PACE } from './timeline.ts'

const STILL = { lift: 0, turn: 0 }

export default function BlackjackReplay({ round }: { round: RoundView }) {
  const hand = round as RoundView<BlackjackDetail>
  if (!Array.isArray(hand.detail?.hands) || !Array.isArray(hand.detail?.dealer)) {
    return <p className="text-sm text-muted">This hand cannot be shown.</p>
  }
  return (
    <div className="table-felt rounded-lg border border-border p-2">
      <Table round={hand} frame={finalFrame(hand)} pace={PACE} slowPace={STILL} still />
    </div>
  )
}
