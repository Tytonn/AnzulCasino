/**
 * One player's bets on a round, replayed (History and the ticker): where the
 * ball landed, their chips on the felt as they were, and what each bet did.
 */
import { formatChips } from '../../../shared/chips.ts'
import { type RouletteDetail, spotById, spotReturn } from '../../../shared/games/roulette.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { usePlayer } from '../../kit/index.ts'
import { Felt, type FeltChip } from './Felt.tsx'
import { tableLayout } from './layout.ts'
import { NumberChip, numberWords } from './NumberChip.tsx'

const WIDE = tableLayout('wide')
const none = () => {}

export default function RouletteReplay({ round }: { round: RoundView }) {
  const detail = round.detail as RouletteDetail
  const player = usePlayer(round.userId)
  const color = `var(--avatar-${player?.avatarColor ?? 'violet'})`
  const { number, bets } = detail

  if (round.status === 'void' || bets.length === 0) {
    return (
      <p className="text-sm text-muted">
        Round {detail.spin} was called off before the wheel spun, and its chips went back.
      </p>
    )
  }

  const chips = new Map<string, FeltChip[]>(
    bets.map((b) => [b.spot, [{ userId: round.userId, color, amount: b.amount, me: true }]]),
  )
  const stake = BigInt(round.stake)
  const payout = BigInt(round.payout ?? 0)
  const net = payout - stake

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {number !== null ? (
          <NumberChip number={number} size="lg" />
        ) : (
          <span className="grid size-12 place-items-center rounded-lg bg-surface-3 text-muted">
            ?
          </span>
        )}
        <div className="leading-tight">
          <p className="text-lg font-bold">
            {number !== null ? numberWords(number) : 'Not drawn yet'}
          </p>
          <p className="text-xs text-muted">Round {detail.spin}</p>
        </div>
        {round.status === 'settled' && (
          <p
            className={`ml-auto text-lg font-bold tabular-nums ${
              net > 0n ? 'text-gold' : net < 0n ? 'text-loss' : 'text-muted'
            }`}
          >
            {net > 0n ? `+${formatChips(net)}` : net < 0n ? `−${formatChips(-net)}` : 'Even'}
          </p>
        )}
      </div>

      <Felt
        layout={WIDE}
        chips={chips}
        number={number}
        preview={[]}
        live={false}
        still
        onPlace={none}
        onRemove={none}
        onPoint={none}
      />

      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1 font-medium">Bet</th>
            <th className="py-1 text-right font-medium">Chips</th>
            <th className="py-1 text-right font-medium">Back</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => {
            const back =
              number === null ? null : spotReturn(spotById(b.spot), BigInt(b.amount), number)
            return (
              <tr key={b.spot} className="border-t border-border">
                <td className="py-1.5">{spotById(b.spot).name}</td>
                <td className="py-1.5 text-right">{formatChips(b.amount)}</td>
                <td
                  className={`py-1.5 text-right font-semibold ${
                    back === null ? 'text-faint' : back > 0n ? 'text-gold' : 'text-loss'
                  }`}
                >
                  {back === null ? '…' : back > 0n ? formatChips(back) : '0'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right">{formatChips(stake)}</td>
            <td className="py-1.5 text-right">
              {round.payout === null ? '…' : formatChips(payout)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
