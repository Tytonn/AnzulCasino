/**
 * What other lanes draw on each seat, such as the social lane's seat
 * reactions (spec: Social layer: "Click a seat to float a quick emote over
 * it"). The shell's room page provides the `seat` slot through this context,
 * so the kit never imports the shell, and a seat drawn outside a room (a
 * test, a replay) simply has no extras.
 */
import { createContext, type ReactNode } from 'react'

export interface SeatExtrasProps {
  /** The room's game. */
  game: string
  /** Whose seat it is. */
  userId: string
  /** True on your own seat. */
  me: boolean
}

/** Draws the extras for one seat. */
export type SeatExtrasRender = (props: SeatExtrasProps) => ReactNode

export const SeatExtras = createContext<SeatExtrasRender | null>(null)
