/**
 * A playing card: its face, its back, and the turns between them. The
 * table's cards deal in from the shoe, the hole card turns over, and on the
 * slow reveal a card rises face down, then turns slowly (Room.tsx sets the
 * phase). Sizes come from the --bj-card-w the table, a seat or the Floor
 * art sets (src/theme/games/blackjack.css).
 */
import { motion, useReducedMotion } from 'motion/react'

import {
  type Card,
  cardName,
  isRed,
  rankLabel,
  rankOf,
  type Suit,
  suitOf,
} from '../../../shared/games/blackjack.ts'
import { LogoMark } from '../../shell/Logo.tsx'
import type { SlowPhase } from './useTimeline.ts'

const SUIT_PATHS: Record<Suit, string> = {
  s: 'M12 1.8c-2.6 3.9-8.4 7-8.4 11.6a4.3 4.3 0 0 0 7.2 3.2c-.2 2-1 3.8-2.4 5.6h7.2c-1.4-1.8-2.2-3.6-2.4-5.6a4.3 4.3 0 0 0 7.2-3.2c0-4.6-5.8-7.7-8.4-11.6Z',
  h: 'M12 21.4C7.4 18 2.6 14.2 2.6 9a5 5 0 0 1 9.4-2.4A5 5 0 0 1 21.4 9c0 5.2-4.8 9-9.4 12.4Z',
  d: 'M12 1.6 20 12l-8 10.4L4 12Z',
  c: 'M12 2.2a4.4 4.4 0 0 0-3.8 6.6 4.4 4.4 0 1 0 2.6 7.6c-.3 2-1 3.7-2.4 5.4h7.2c-1.4-1.7-2.1-3.4-2.4-5.4a4.4 4.4 0 1 0 2.6-7.6A4.4 4.4 0 0 0 12 2.2Z',
}

export function SuitIcon({ suit, className = '' }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d={SUIT_PATHS[suit]} />
    </svg>
  )
}

const FACES = new Set(['J', 'Q', 'K'])

/** The printed side of a card. */
export function CardFace({ card }: { card: Card | null }) {
  if (!card) return <div className="bj-card-face" />
  const rank = rankOf(card)
  const suit = suitOf(card)
  const label = rankLabel(card)
  const corner = (
    <span className="flex flex-col items-center">
      <span className="bj-index">{label}</span>
      <SuitIcon suit={suit} className="mt-[6%] w-[0.62em]" />
    </span>
  )
  return (
    <div className="bj-card-face" data-red={isRed(card)}>
      <span className="absolute top-[5%] left-[7%] text-[length:max(calc(var(--bj-card-w)*0.27),10px)]">
        {corner}
      </span>
      <span className="absolute right-[7%] bottom-[5%] rotate-180 text-[length:max(calc(var(--bj-card-w)*0.27),10px)]">
        {corner}
      </span>
      <span className="absolute inset-0 grid place-items-center">
        {FACES.has(rank) ? (
          <span className="flex flex-col items-center rounded-[10%] border border-current/25 px-[14%] py-[8%]">
            <span className="text-[calc(var(--bj-card-w)*0.42)] leading-none font-black">
              {label}
            </span>
            <SuitIcon suit={suit} className="mt-[10%] w-[calc(var(--bj-card-w)*0.22)]" />
          </span>
        ) : (
          <SuitIcon suit={suit} className={rank === 'A' ? 'w-[52%]' : 'w-[40%] opacity-95'} />
        )}
      </span>
    </div>
  )
}

/** The back of a card. `flat` draws it on its own, not on the far side of a card that turns. */
export function CardBack({ flat = false }: { flat?: boolean }) {
  return (
    <div
      className="bj-card-back grid place-items-center"
      style={flat ? { transform: 'none' } : undefined}
    >
      <LogoMark className="w-[46%] opacity-70" />
    </div>
  )
}

export interface PlayingCardProps {
  /** The card, or null for a face-down card nobody knows yet (the hole card in play). */
  card: Card | null
  faceUp: boolean
  /** The slow reveal's phase for this card. */
  slow?: SlowPhase | null
  /** The slow reveal's lift and turn, in milliseconds. */
  liftMs?: number
  turnMs?: number
  /** The dealer checking under an ace or a ten, for this long. */
  peekMs?: number
  /** Comes onto the table face down and turns over as it lands, unless it stays down. */
  dealt?: boolean
  className?: string
}

/** How long an ordinary card takes to turn over. */
const TURN_MS = 380
/** A slow card turning at once, when the player taps. */
const QUICK_TURN_MS = 170

export function PlayingCard({
  card,
  faceUp,
  slow = null,
  liftMs = 900,
  turnMs = TURN_MS,
  peekMs = 0,
  dealt = false,
  className = '',
}: PlayingCardProps) {
  const reduced = useReducedMotion()
  const lifted = slow === 'lift' || slow === 'turn'
  // While it lifts, a slow card shows nothing of its face, even to a reader.
  const face = slow === 'lift' ? null : card
  const up = faceUp && slow !== 'lift'
  const turn = slow === 'turn' ? turnMs : slow === 'land' ? QUICK_TURN_MS : TURN_MS
  return (
    <div
      role="img"
      aria-label={up && face ? cardName(face) : 'A face-down card'}
      className={`bj-card ${lifted ? 'bj-card-lifted' : ''} ${className}`}
    >
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: '50% 100%' }}
        initial={false}
        animate={
          reduced
            ? { y: 0, scale: 1 }
            : peekMs > 0
              ? { rotateX: [0, 32, 32, 0], y: [0, -3, -3, 0] }
              : lifted
                ? { y: '-16%', scale: 1.1, rotate: -2 }
                : { y: 0, scale: 1, rotate: 0, rotateX: 0 }
        }
        transition={
          peekMs > 0
            ? { duration: peekMs / 1000, times: [0, 0.3, 0.72, 1], ease: 'easeInOut' }
            : lifted
              ? { duration: liftMs / 1000, ease: [0.45, 0, 0.2, 1] }
              : { type: 'spring', stiffness: 520, damping: 24 }
        }
      >
        <motion.div
          className="bj-card-turn"
          initial={dealt ? { rotateY: 180 } : false}
          animate={{ rotateY: up ? 0 : 180 }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: turn / 1000, ease: slow === 'turn' ? [0.6, 0, 0.25, 1] : 'easeOut' }
          }
        >
          <CardFace card={face} />
          <CardBack />
        </motion.div>
      </motion.div>
    </div>
  )
}
