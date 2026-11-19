/**
 * The season's icons, drawn like the kit's (src/kit/icons.tsx): in
 * currentColor on a 24-unit grid, sized with a class.
 */
import type { ReactNode } from 'react'

import type { IconProps } from '../../kit/icons.tsx'

function svg(children: ReactNode) {
  return function Drawn(props: IconProps) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
        {children}
      </svg>
    )
  }
}

/** The final day: an hourglass running out. */
export const HourglassIcon = svg(
  <path
    fillRule="evenodd"
    d="M5 2.5h14V4h-1.3v2.2a5.7 5.7 0 0 1-2.9 5l-.4.3.4.3a5.7 5.7 0 0 1 2.9 5V20H19v1.5H5V20h1.3v-3.2a5.7 5.7 0 0 1 2.9-5l.4-.3-.4-.3a5.7 5.7 0 0 1-2.9-5V4H5Zm3.1 1.5v2.2c0 .5.1 1 .3 1.4h7.2c.2-.4.3-.9.3-1.4V4ZM12 13.6l-1.9 1.1a3.4 3.4 0 0 0-1.6 2.1L12 15.5l3.5 1.3a3.4 3.4 0 0 0-1.6-2.1Z"
  />,
)

/** The end of a season: a chequered flag. */
export const FlagIcon = svg(
  <path
    fillRule="evenodd"
    d="M4.5 2.5h1.7V3c3.3-1.5 6.4 1.4 9.6.2.9-.4 1.9-.7 3.7-.7v11.1c-1.8 0-2.8.3-3.7.7-3.2 1.2-6.3-1.7-9.6-.2v7.4H4.5Zm1.7 3v3.4c1.1-.4 2.2-.4 3.2-.2V5.3c-1-.2-2.1-.2-3.2.2Zm3.2 3.2v3.4c1 .2 2 .7 3.1 1v-3.4c-1.1-.3-2.1-.8-3.1-1Zm3.1 1V6.3c-1.1-.3-2.1-.8-3.1-1v3.4c1 .2 2 .7 3.1 1Zm0 0c1.1.3 2.2.4 3.4 0V6.3c-1.2.4-2.3.3-3.4 0Zm3.4 0v3.4c.6-.2 1.3-.4 2.2-.5V8.8c-.9.1-1.6.3-2.2.7Z"
  />,
)

/** A medal on a ribbon, for the Hall of Fame. */
export const MedalIcon = svg(
  <>
    <path d="M6.5 2h4l2 4.4-2.6 2.4ZM17.5 2h-4l-1.4 3 2 4.3 3.4-2.9Z" />
    <path
      fillRule="evenodd"
      d="M12 8.5a6.75 6.75 0 1 1 0 13.5 6.75 6.75 0 0 1 0-13.5Zm0 2.6.9 2.3 2.5.1-1.9 1.6.6 2.4-2.1-1.4-2.1 1.4.6-2.4-1.9-1.6 2.5-.1Z"
    />
  </>,
)

/** Opens and closes a past season. */
export const ChevronIcon = svg(
  <path d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z" />,
)
