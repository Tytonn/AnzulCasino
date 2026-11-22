/** A finished flip as History and a folded card replay it: the coin as it landed, and the call. */
import { formatChips } from '../../../shared/chips.ts'
import { type CoinflipDetail, SIDE_NAMES, SIDES } from '../../../shared/games/coinflip.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { StillCoin } from './Coin.tsx'

export default function CoinflipReplay({ round }: { round: RoundView }) {
  const flip = round as RoundView<CoinflipDetail>
  const face = flip.detail?.face
  const call = flip.detail?.call
  if (!face || !SIDES.includes(face) || !call || !SIDES.includes(call)) {
    return <p className="text-sm text-muted">This flip cannot be shown.</p>
  }
  const net = (flip.payout ?? 0) - flip.stake
  return (
    <div className="flex items-center gap-3">
      <StillCoin face={face} className="size-10 text-[4px]" />
      <p className="text-sm text-muted">
        Called <span className="text-text">{SIDE_NAMES[call]}</span>, landed{' '}
        <span className="text-text">{SIDE_NAMES[face]}</span>
        {net > 0 ? `: paid ${formatChips(flip.payout ?? 0)} on ${formatChips(flip.stake)}.` : '.'}
      </p>
    </div>
  )
}
