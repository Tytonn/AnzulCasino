/**
 * The game kit (spec: Build plan, deliverable 9): everything a room needs,
 * in one import. The coin flip in src/games/coinflip/ uses each piece, and
 * docs/LANE_GUIDE.md walks through it.
 *
 *   import { BetBox, RoomLayout, usePlay, useRoom } from '../../kit/index.ts'
 *
 * Icons for a game's manifest come straight from './icons.tsx'.
 */

// The room and its moves.
export { applyRound, type Room, type RoomOptions, type RoomSeat, roomKey, useRoom } from './room.ts'
export { type SendOptions, usePlay } from './play.ts'
export { afterReveal, holdReveal } from './reveal.ts'

// What a room is drawn with.
export { BetBox, type BetBoxProps, closedReason } from './BetBox.tsx'
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button.tsx'
export { ChipStack, chipsFor } from './ChipStack.tsx'
export { RoomLayout, type RoomGame, type RoomLayoutProps } from './RoomLayout.tsx'
export { EmptySeat, Seat, type SeatOutcome, seatOutcome, SeatSkeleton, seatTag } from './Seat.tsx'
export { SeatExtras, type SeatExtrasProps, type SeatExtrasRender } from './seat-extras.ts'
export { Sheet } from './Sheet.tsx'
export { AnimatedNumber } from './AnimatedNumber.tsx'
export { Avatar, PlayerName, TierBadge, tierColor } from './PlayerName.tsx'

// Feel: sound, celebration, keys, toasts.
export { playSound, type SoundName, SOUNDS } from './sfx.ts'
export { celebrate, isBigWin } from './celebrate.tsx'
export { isShortcut, Kbd, type Shortcuts, useShortcuts } from './Kbd.tsx'
export { toast } from './toast.tsx'

// Data every page shares.
export { api, ApiError, errorMessage, requestKey } from './api.ts'
export {
  applyWallet,
  useConfig,
  useLeaderboard,
  useMe,
  usePlayer,
  usePlayers,
  useSeason,
  useWallet,
} from './queries.ts'
export { formatCountdown, serverNow, useNow } from './clock.ts'
export { DESK, TABLET, TOUCH, useMediaQuery, WIDE } from './media.ts'
