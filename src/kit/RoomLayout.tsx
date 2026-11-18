/**
 * The room around a game (spec: The room model): its name and how-to-play
 * card, the other players' seats across the table, your own seat large in
 * the middle, and the bet controls at the bottom, within thumb reach on a
 * phone. It holds 1 to 10 players. Alone, you sit at a table with empty
 * seats, and a friend who walks in takes one.
 *
 *   <RoomLayout
 *     game={manifest}                 // name, icon, how to play
 *     room={room}                     // from useRoom
 *     info="Win pays 1.96x"           // payouts and odds, always visible
 *     table={<Coin ... />}            // your game, in your seat
 *     seat={(s) => <MiniCoin round={s.round} />}   // the others' game state
 *     controls={<BetBox ... />}
 *   />
 */
import { type ReactNode, useState } from 'react'

import { Button } from './Button.tsx'
import { HelpIcon, type Icon } from './icons.tsx'
import { Kbd, useShortcuts } from './Kbd.tsx'
import { TABLET, useMediaQuery } from './media.ts'
import type { Room, RoomSeat } from './room.ts'
import { EmptySeat, Seat, SeatSkeleton } from './Seat.tsx'
import { Sheet } from './Sheet.tsx'

/** Seats drawn across the table even when nobody sits in them. */
const MIN_OTHERS_WIDE = 3
const MIN_OTHERS_PHONE = 2

export interface RoomGame {
  id: string
  name: string
  /** The how-to-play card: a few short paragraphs. */
  howToPlay: readonly string[]
  icon?: Icon
}

export interface RoomLayoutProps<D> {
  /** The game's manifest, or anything with its id, name and how-to-play card. */
  game: RoomGame
  room: Room<D>
  /** Payouts and odds, under the name: "Win pays 1.96x". */
  info?: ReactNode
  /** Your game: the table in your seat. */
  table: ReactNode
  /** Another player's game state inside their seat. Leave out for just the bet and result. */
  seat?: (seat: RoomSeat<D>) => ReactNode
  /** The bet box, and any buttons the game needs during a round. */
  controls: ReactNode
}

function Failed({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface-1 p-6 text-center">
      <p className="font-semibold">The room did not load.</p>
      <p className="text-sm text-muted">Check your connection, then try again.</p>
      <Button variant="primary" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

export function RoomLayout<D>({ game, room, info, table, seat, controls }: RoomLayoutProps<D>) {
  const [help, setHelp] = useState(false)
  const tablet = useMediaQuery(TABLET)
  useShortcuts({ '?': () => setHelp(true) })

  const others = room.seats.filter((s) => !s.me)
  const mine = room.seats.find((s) => s.me)
  const minimum = tablet ? MIN_OTHERS_WIDE : MIN_OTHERS_PHONE
  const empty = Math.max(0, minimum - others.length)
  const GameIcon = game.icon

  return (
    <div
      data-room={game.id}
      className="flex flex-1 flex-col gap-3 px-3 pt-3 md:gap-4 md:px-6 md:pt-5"
    >
      <header className="flex min-w-0 items-center gap-2.5">
        {GameIcon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
            <GameIcon className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight font-bold md:text-xl">{game.name}</h1>
          {info && <p className="truncate text-xs text-muted md:text-sm">{info}</p>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHelp(true)}
          className="ml-auto"
          aria-haspopup="dialog"
        >
          <HelpIcon className="size-4" />
          <span className="max-sm:sr-only">How to play</span>
          <Kbd>?</Kbd>
        </Button>
      </header>

      <section
        aria-label="Other players"
        className="scroll-quiet -mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 *:w-36 *:shrink-0 *:snap-start md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] md:overflow-visible md:px-0 md:pb-0 md:*:w-auto"
      >
        {room.loading ? (
          Array.from({ length: minimum }, (_, i) => <SeatSkeleton key={i} />)
        ) : (
          <>
            {others.map((other) => (
              <Seat key={other.userId} seat={other}>
                {seat?.(other)}
              </Seat>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <EmptySeat key={`empty-${i}`} />
            ))}
          </>
        )}
      </section>

      <section aria-label="Your seat" className="flex min-h-56 flex-1 flex-col md:min-h-80">
        {room.failed ? (
          <Failed retry={room.retry} />
        ) : room.loading || !mine ? (
          <SeatSkeleton className="flex-1" />
        ) : (
          <Seat seat={mine} size="lg" className="table-felt flex-1">
            {table}
          </Seat>
        )}
      </section>

      <div className="sticky bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-10 -mx-3 bg-linear-to-t from-bg from-40% to-transparent px-3 pt-1 pb-3 md:bottom-0 md:-mx-6 md:px-6 md:pb-5">
        {controls}
      </div>

      <Sheet
        open={help}
        onClose={() => setHelp(false)}
        title={`How to play ${game.name}`}
        placement="center"
      >
        <div className="scroll-quiet space-y-3 overflow-y-auto px-4 pb-5 text-sm leading-relaxed text-muted">
          {game.howToPlay.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
