/**
 * The economy's icons, drawn like the kit's (src/kit/icons.tsx): in
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

/** Work: a briefcase. */
export const WorkIcon = svg(
  <>
    <path
      fillRule="evenodd"
      d="M9 4.6A1.6 1.6 0 0 1 10.6 3h2.8A1.6 1.6 0 0 1 15 4.6V6h4.5A2.5 2.5 0 0 1 22 8.5v3.1l-8.1 2.1a7.6 7.6 0 0 1-3.8 0L2 11.6V8.5A2.5 2.5 0 0 1 4.5 6H9Zm1.7.1V6h2.6V4.7Z"
    />
    <path d="m2 13.4 7.7 2a9.2 9.2 0 0 0 4.6 0l7.7-2v5.1a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5Z" />
  </>,
)

/** The hustle button (Slut by default): a pair of lips. */
export const HustleIcon = svg(
  <>
    <path d="M2.3 11.6C4.8 8 7.9 6.2 10 7.2c.9.4 1.4 1.1 2 1.1s1.1-.7 2-1.1c2.1-1 5.2.8 7.7 4.4-3.9-.8-7-.4-9.7.5-2.7-.9-5.8-1.3-9.7-.5Z" />
    <path d="M2.4 12.9c3.9-.6 7 0 9.6.9 2.6-.9 5.7-1.5 9.6-.9-2.4 3.9-5.7 5.6-9.6 5.6s-7.2-1.7-9.6-5.6Z" />
  </>,
)

/**
 * Crime: a pair of handcuffs, hanging from their chain. Not a mask: that is
 * Heist's steal, which sits beside Crime in the top bar.
 */
export const CrimeIcon = svg(
  <>
    <path
      fillRule="evenodd"
      d="M1.5 15.2a4.8 4.8 0 1 0 9.6 0 4.8 4.8 0 1 0-9.6 0Zm2.8 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0Zm8.6 0a4.8 4.8 0 1 0 9.6 0 4.8 4.8 0 1 0-9.6 0Zm2.8 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z"
    />
    <rect x="5.9" y="7.6" width="5" height="4" rx="1" transform="rotate(20 8.4 9.6)" />
    <rect x="13.1" y="7.6" width="5" height="4" rx="1" transform="rotate(-20 15.6 9.6)" />
    <circle cx="10" cy="6.3" r="1.5" />
    <circle cx="12" cy="5.3" r="1.5" />
    <circle cx="14" cy="6.3" r="1.5" />
  </>,
)

/** Income and Collect: a stack of chips. */
export const IncomeIcon = svg(
  <>
    <ellipse cx="12" cy="6.2" rx="7.2" ry="3.2" />
    <path d="M4.8 8.9v2.4c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2V8.9c-1.5 1.4-4.2 2.2-7.2 2.2s-5.7-.8-7.2-2.2Z" />
    <path d="M4.8 14v2.4c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2V14c-1.5 1.4-4.2 2.2-7.2 2.2S6.3 15.4 4.8 14Z" />
  </>,
)

/** Daily challenges: a calendar page with a tick. */
export const DailyIcon = svg(
  <path
    fillRule="evenodd"
    d="M7 2h2v2h6V2h2v2h1.5A2.5 2.5 0 0 1 21 6.5v12a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-12A2.5 2.5 0 0 1 5.5 4H7Zm-2 7v9.5c0 .3.2.5.5.5h13c.3 0 .5-.2.5-.5V9Zm11.3 2.2 1.4 1.4-6.2 6.2-3.7-3.7 1.4-1.4 2.3 2.3Z"
  />,
)

/** A chat drop: a bag of chips. */
export const DropIcon = svg(
  <>
    <path d="M8.6 2.5h6.8l-1.9 3.2h-3Z" />
    <path
      fillRule="evenodd"
      d="M10.1 6.6h3.8c3.8 2.3 6.8 6.3 6.8 9.8 0 3.3-2.8 5.2-8.7 5.2s-8.7-1.9-8.7-5.2c0-3.5 3-7.5 6.8-9.8Zm1.9 5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"
    />
  </>,
)

/** A tick, for something done. */
export const TickIcon = (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

/** A padlock, for a rank that has not opened yet. */
export const LockIcon = svg(
  <path
    fillRule="evenodd"
    d="M7.5 9V7.5a4.5 4.5 0 0 1 9 0V9h.5A2 2 0 0 1 19 11v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2 0h5V7.5a2.5 2.5 0 0 0-5 0Zm2.5 4a1.5 1.5 0 0 0-.8 2.8V18h1.6v-2.2A1.5 1.5 0 0 0 12 13Z"
  />,
)
