/**
 * How a player looks everywhere: their avatar, their name in their tier's
 * color, and their tier's badge (spec: Economy > Ranks: "Each rank gives a
 * badge and name color shown in chat, the leaderboard, the online list and
 * the player's seat"). Use these instead of drawing names yourself.
 *
 *   <PlayerName player={usePlayer(userId)} />
 *   <Avatar player={player} size="md" />
 */
import type { CSSProperties } from 'react'

import { AVATAR_COLORS } from '../../shared/avatars.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import { isTier, type Tier, TIER_LABELS } from '../../shared/tiers.ts'
import { AVATAR_ICONS, ChipIcon } from './icons.tsx'

/** A player, or a leaderboard row: tier may be any string from the server. */
type Who = Pick<PlayerSummary, 'displayName' | 'avatar' | 'avatarColor'> & { tier: string }

const SIZES = {
  xs: 'size-5 [&>svg]:size-3',
  sm: 'size-7 [&>svg]:size-4',
  md: 'size-9 [&>svg]:size-5',
  lg: 'size-12 [&>svg]:size-7',
  xl: 'size-16 [&>svg]:size-9',
} as const

export type AvatarSize = keyof typeof SIZES

function avatarColor(color: string): string {
  return (AVATAR_COLORS as readonly string[]).includes(color) ? color : 'violet'
}

export function Avatar({
  player,
  size = 'sm',
  ring,
  className = '',
}: {
  player: Pick<Who, 'avatar' | 'avatarColor'> | undefined
  size?: AvatarSize
  /** A status ring: `playing` in gold, `online` in the online color. */
  ring?: 'playing' | 'online' | 'away'
  className?: string
}) {
  const Icon = (player && AVATAR_ICONS[player.avatar]) || ChipIcon
  const color = `var(--avatar-${avatarColor(player?.avatarColor ?? 'violet')})`
  const style: CSSProperties = {
    color,
    backgroundColor: `color-mix(in oklab, ${color} 20%, var(--surface-2))`,
    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${color} 55%, transparent)`,
  }
  const ringClass =
    ring === 'playing'
      ? 'outline-2 outline-offset-1 outline-gold'
      : ring === 'online'
        ? 'outline-2 outline-offset-1 outline-online'
        : ring === 'away'
          ? 'opacity-50'
          : ''
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`inline-grid shrink-0 place-items-center rounded-full ${SIZES[size]} ${ringClass} ${className}`}
    >
      <Icon />
    </span>
  )
}

/** The tier's color, for text: `style={{ color: tierColor(tier) }}`. */
export function tierColor(tier: string): string {
  return `var(--tier-${isTier(tier) ? tier : 'base'})`
}

/** One mark per tier, growing with it. Base has none. */
const BADGE_MARKS: Record<Exclude<Tier, 'base'>, string> = {
  bronze: 'M5 9.5 8 7l3 2.5',
  silver: 'M5 8 8 5.5 11 8M5 11 8 8.5l3 2.5',
  gold: 'M5 6.5 8 4l3 2.5M5 9.5 8 7l3 2.5M5 12.5 8 10l3 2.5',
  platinum: 'm8 4.2 1.1 2.4 2.6.3-1.9 1.8.5 2.6L8 10l-2.3 1.3.5-2.6-1.9-1.8 2.6-.3Z',
  diamond: 'M8 3.8 11.4 8 8 12.2 4.6 8Z',
  crown: 'M4.2 6.2 6.3 8 8 5l1.7 3 2.1-1.8-.8 5.2H5Z',
}

const FILLED: readonly Tier[] = ['platinum', 'diamond', 'crown']

export function TierBadge({ tier, className = '' }: { tier: string; className?: string }) {
  if (!isTier(tier) || tier === 'base') return null
  const color = tierColor(tier)
  const filled = FILLED.includes(tier)
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={`${TIER_LABELS[tier]} rank`}
      className={`size-4 shrink-0 ${className}`}
    >
      <title>{`${TIER_LABELS[tier]} rank`}</title>
      <path
        d="M8 1 14 4.5v7L8 15 2 11.5v-7Z"
        style={{
          fill: `color-mix(in oklab, ${color} 22%, var(--surface-1))`,
          stroke: color,
        }}
        strokeWidth="1"
      />
      <path
        d={BADGE_MARKS[tier]}
        style={filled ? { fill: color } : { stroke: color }}
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A name in its tier's color with the tier badge. An unknown player shows as "Someone". */
export function PlayerName({
  player,
  badge = true,
  className = '',
}: {
  player: Pick<Who, 'displayName' | 'tier'> | undefined
  badge?: boolean
  className?: string
}) {
  if (!player) return <span className={`text-faint ${className}`}>Someone</span>
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 align-bottom ${className}`}>
      <span className="truncate font-semibold" style={{ color: tierColor(player.tier) }}>
        {player.displayName}
      </span>
      {badge && <TierBadge tier={player.tier} />}
    </span>
  )
}
