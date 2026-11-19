/**
 * A room: the game's own component from its manifest, loaded when a player
 * walks in, or its placeholder until the lane lands. Being here is shared
 * through presence, so the rail, the Floor and the online list show it.
 * Features draw on its seats through the `seat` slot.
 */
import { type ComponentType, Suspense } from 'react'

import { SeatExtras, type SeatExtrasProps } from '../../kit/seat-extras.ts'
import { usePresenceRoom } from '../../live/index.ts'
import type { GameEntry } from '../registry.ts'
import { Slot, useSlot } from '../Slot.tsx'
import { useTitle } from '../title.ts'
import { Placeholder } from './Placeholder.tsx'

const seatSlot = (props: SeatExtrasProps) => <Slot name="seat" props={props} />

function RoomSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6" aria-label="Loading the room">
      <div className="skeleton h-7 w-40" />
      <div className="skeleton min-h-72 flex-1" />
      <div className="skeleton h-16" />
    </div>
  )
}

/** `room` is the game's lazy room component, or null for a placeholder. */
export function RoomPage({ game, room: Room }: { game: GameEntry; room: ComponentType | null }) {
  usePresenceRoom(game.id)
  useTitle(game.name)
  const extras = useSlot('seat')
  if (!Room) {
    return <Placeholder title={game.name} pitch={game.pitch} lane={game.lane} icon={game.icon} />
  }
  return (
    <SeatExtras.Provider value={extras.length > 0 ? seatSlot : null}>
      <Suspense fallback={<RoomSkeleton />}>
        <Room />
      </Suspense>
    </SeatExtras.Provider>
  )
}
