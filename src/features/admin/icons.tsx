/**
 * The admin lane's icons, drawn like the kit's (src/kit/icons.tsx): in
 * currentColor on a 24-unit grid, sized with a class.
 */
import type { ReactNode } from 'react'

import type { IconProps } from '../../kit/icons.tsx'

function svg(children: ReactNode, fill: 'solid' | 'line' = 'solid') {
  return function Drawn(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill={fill === 'solid' ? 'currentColor' : 'none'}
        stroke={fill === 'line' ? 'currentColor' : 'none'}
        strokeWidth={fill === 'line' ? 1.8 : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {children}
      </svg>
    )
  }
}

/** Settings: a gear. */
export const GearIcon = svg(
  <path
    fillRule="evenodd"
    d="M10.3 2h3.4l.5 2.6a8 8 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a8 8 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a8 8 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a8 8 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a8 8 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a8 8 0 0 1 1.9-1.1ZM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"
  />,
)

/** A giveaway: a wrapped present. */
export const GiftIcon = svg(
  <>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5V11H3ZM4.5 12.5h6.7V21H6a1.5 1.5 0 0 1-1.5-1.5ZM12.8 12.5h6.7v7A1.5 1.5 0 0 1 18 21h-5.2Z" />
    <path d="M12 6.8C10.6 4 8.2 3 7 4.1c-1.2 1.1-.2 2.7 1.6 2.7ZM12 6.8c1.4-2.8 3.8-3.8 5-2.7 1.2 1.1.2 2.7-1.6 2.7Z" />
  </>,
)

/** A season: a calendar page. */
export const CalendarIcon = svg(
  <path
    fillRule="evenodd"
    d="M7 2.5h2v2h6v-2h2v2h1.5A2.5 2.5 0 0 1 21 7v11.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V7a2.5 2.5 0 0 1 2.5-2.5H7Zm-2 7v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-9Zm2.5 2.5h3v3h-3Z"
  />,
)

/** An invite or reset code: a key. */
export const KeyIcon = svg(
  <path
    fillRule="evenodd"
    d="M7 7a5 5 0 0 1 4.8 3.6H22v2.8h-2v3h-2.8v-3h-1.6v2h-2.8v-2h-1A5 5 0 1 1 7 7Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
  />,
)

/** Searching a list. */
export const SearchIcon = svg(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </>,
  'line',
)

/** Something waiting for the daily reset: an hourglass. */
export const HourglassIcon = svg(
  <path d="M6 2.5h12v2c0 3-1.8 5-4.2 7.5 2.4 2.5 4.2 4.5 4.2 7.5v2H6v-2c0-3 1.8-5 4.2-7.5C7.8 9.5 6 7.5 6 4.5Z" />,
)

/** A warning or a refusal. */
export const AlertIcon = svg(
  <path
    fillRule="evenodd"
    d="M10.3 3.6a2 2 0 0 1 3.4 0l8 13.9a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3Zm.6 4.9h2.2l-.3 6.3h-1.6Zm1.1 7.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z"
  />,
)

/** Undo a change. */
export const UndoIcon = svg(
  <>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" />
  </>,
  'line',
)
