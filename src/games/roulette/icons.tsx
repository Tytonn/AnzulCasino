/**
 * Roulette's own icons for its table buttons, drawn like the kit's
 * (src/kit/icons.tsx): a 24-unit grid in currentColor, sized with a class.
 */
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function line(children: ReactNode) {
  return function Drawn(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {children}
      </svg>
    )
  }
}

export const UndoIcon = line(
  <>
    <path d="M9 14 4.5 9.5 9 5" />
    <path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3" />
  </>,
)

export const ClearIcon = line(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </>,
)

export const RepeatIcon = line(
  <>
    <path d="M17.5 4.5 20 7l-2.5 2.5" />
    <path d="M4 12v-1.5A3.5 3.5 0 0 1 7.5 7H20" />
    <path d="M6.5 19.5 4 17l2.5-2.5" />
    <path d="M20 12v1.5a3.5 3.5 0 0 1-3.5 3.5H4" />
  </>,
)

export const DoubleIcon = line(
  <>
    <circle cx="9" cy="12" r="5.5" />
    <circle cx="15" cy="12" r="5.5" />
  </>,
)
