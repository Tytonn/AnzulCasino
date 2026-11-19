/** Blackjack's card on the Floor: an ace and a king, fanned. They spread a little on hover. */
import type { CSSProperties } from 'react'

import { CardBack, CardFace } from './Card.tsx'

export default function FloorArt() {
  return (
    <div
      aria-hidden="true"
      className="relative h-[calc(var(--bj-card-w)*1.4)] w-[calc(var(--bj-card-w)*1.9)]"
      style={{ '--bj-card-w': '52px' } as CSSProperties}
    >
      <div className="bj-card absolute top-1 left-0 origin-bottom -rotate-[16deg] opacity-80 transition-transform duration-250 group-hover:-translate-x-1 group-hover:-rotate-[22deg]">
        <CardBack flat />
      </div>
      <div className="bj-card absolute top-0 left-[22%] origin-bottom -rotate-[4deg] transition-transform duration-250 group-hover:-rotate-[8deg]">
        <CardFace card="As" />
      </div>
      <div className="bj-card absolute top-0.5 left-[46%] origin-bottom rotate-[9deg] transition-transform duration-250 group-hover:translate-x-1 group-hover:rotate-[15deg]">
        <CardFace card="Kh" />
      </div>
    </div>
  )
}
