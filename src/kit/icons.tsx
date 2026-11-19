/**
 * Icons drawn in code, in currentColor, on a 24-unit grid. Size them with a
 * class (size-5). Games may bring their own icon in their manifest.
 */
import type { ReactNode, SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement>
export type Icon = (props: IconProps) => ReactNode

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

// ---------------------------------------------------------------- avatars (shared/avatars.ts)

export const ChipIcon = svg(
  <>
    <path
      fillRule="evenodd"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Z"
    />
    <circle cx="12" cy="12" r="4.2" />
    <path d="M10.6 2.1h2.8v3.2h-2.8zM10.6 18.7h2.8v3.2h-2.8zM2.1 10.6h3.2v2.8H2.1zM18.7 10.6h3.2v2.8h-3.2z" />
  </>,
)
export const SpadeIcon = svg(
  <path d="M12 2.2c-2.7 3.6-8 6.6-8 11a4.2 4.2 0 0 0 6.7 3.4L9.4 21.5h5.2l-1.3-4.9A4.2 4.2 0 0 0 20 13.2c0-4.4-5.3-7.4-8-11Z" />,
)
export const HeartIcon = svg(
  <path d="M12 20.8 10.6 19.5C5.4 14.9 2.2 12 2.2 8.4A4.9 4.9 0 0 1 7.2 3.5c1.9 0 3.6.9 4.8 2.3a6.3 6.3 0 0 1 4.8-2.3 4.9 4.9 0 0 1 5 4.9c0 3.6-3.2 6.5-8.4 11.1Z" />,
)
export const ClubIcon = svg(
  <>
    <circle cx="12" cy="7.2" r="4.3" />
    <circle cx="7" cy="13.4" r="4.3" />
    <circle cx="17" cy="13.4" r="4.3" />
    <path d="M10.8 12h2.4l1.6 9.5H9.2Z" />
  </>,
)
export const DiamondIcon = svg(<path d="M12 2 20 12 12 22 4 12Z" />)
export const CrownIcon = svg(
  <path d="M3 7.5 7.6 11 12 4.5l4.4 6.5L21 7.5 19.3 17H4.7ZM4.8 18.6h14.4v2.2H4.8Z" />,
)
export const DiceIcon = svg(
  <path
    fillRule="evenodd"
    d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm1.5 3.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm-3.5 3.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z"
  />,
)
export const StarIcon = svg(
  <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z" />,
)
export const MoonIcon = svg(<path d="M20.5 14.6A8.8 8.8 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z" />)
export const BoltIcon = svg(<path d="M13.6 2 4.5 13.6h6.4L9.8 22l9.7-12.1h-6.6Z" />)
export const FlameIcon = svg(
  <path d="M12.6 2.2c.6 3.6 5.9 6.1 5.9 11.6a6.5 6.5 0 0 1-13 0c0-2.8 1.5-4.8 3.1-6 0 2.1.8 3.6 2.1 4.2-.6-3.7.4-6.9 1.9-9.8Z" />,
)
export const CloverIcon = svg(
  <>
    <circle cx="9.2" cy="7.4" r="3.7" />
    <circle cx="14.8" cy="7.4" r="3.7" />
    <circle cx="9.2" cy="13" r="3.7" />
    <circle cx="14.8" cy="13" r="3.7" />
    <path d="M11.2 15.5h1.6c.4 2.4 1.5 4.2 3.4 5.6l-.9 1c-2.3-1.6-3.6-3.8-4.1-6.6Z" />
  </>,
)

export const AVATAR_ICONS: Record<string, Icon> = {
  chip: ChipIcon,
  spade: SpadeIcon,
  heart: HeartIcon,
  club: ClubIcon,
  diamond: DiamondIcon,
  crown: CrownIcon,
  dice: DiceIcon,
  star: StarIcon,
  moon: MoonIcon,
  bolt: BoltIcon,
  flame: FlameIcon,
  clover: CloverIcon,
}

// ---------------------------------------------------------------- games

export const BlackjackIcon = svg(
  <>
    <path d="M8.3 3.4 15 5.2a1.6 1.6 0 0 1 1.1 2l-3.5 13a1.6 1.6 0 0 1-2 1.1L3.9 19.5a1.6 1.6 0 0 1-1.1-2l3.5-13a1.6 1.6 0 0 1 2-1.1Z" />
    <path
      opacity="0.55"
      d="M14.3 2.8h5.6a1.6 1.6 0 0 1 1.6 1.6v13.4a1.6 1.6 0 0 1-1.6 1.6h-3.7l2.2-8.4a3.2 3.2 0 0 0-2.2-3.9l-2.5-.7Z"
    />
  </>,
)
export const RouletteIcon = svg(
  <>
    <path
      fillRule="evenodd"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2Z"
    />
    <path d="M12 6.2 13.2 11h-2.4Zm0 11.6L10.8 13h2.4ZM6.2 12 11 10.8v2.4Zm11.6 0L13 13.2v-2.4Z" />
    <circle cx="12" cy="12" r="1.6" />
  </>,
)
export const CrashIcon = svg(
  <path d="M3 20.5h18v1.5H3ZM3.5 18.5C8 18 12.5 14.5 15.6 7.8l-2.2-.6 5.6-4.2.9 6.9-2-1.2C15 15.4 9.7 19.8 3.6 20.4Z" />,
)
export const MinesIcon = svg(
  <>
    <path d="m12 3 2.2 4.3L19 8l-3.4 3.3.8 4.7L12 13.8 7.6 16l.8-4.7L5 8l4.8-.7Z" opacity="0.5" />
    <circle cx="12" cy="13" r="6.2" />
    <path d="M11 3h2v3.5h-2Z" />
  </>,
)
export const PlinkoIcon = svg(
  <>
    <circle cx="12" cy="4.5" r="1.6" />
    <circle cx="8.5" cy="9" r="1.6" />
    <circle cx="15.5" cy="9" r="1.6" />
    <circle cx="5" cy="13.5" r="1.6" />
    <circle cx="12" cy="13.5" r="1.6" />
    <circle cx="19" cy="13.5" r="1.6" />
    <path d="M2.5 18h4v3.5h-4Zm5.5 0h3.2v3.5H8Zm4.8 0H16v3.5h-3.2Zm4.7 0h4v3.5h-4Z" opacity="0.6" />
  </>,
)
export const SlotsIcon = svg(
  <path
    fillRule="evenodd"
    d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11A2.5 2.5 0 0 1 4.5 4Zm.5 3v10h4V7Zm5 0v10h4V7Zm5 0v10h4V7ZM6 9.2h2l-1.2 5H5.6l1.1-3.8H6Zm5 0h2l-1.2 5h-1.2l1.1-3.8H11Zm5 0h2l-1.2 5h-1.2l1.1-3.8H16Z"
  />,
)
export const RussianRouletteIcon = svg(
  <path
    fillRule="evenodd"
    d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 12 5Zm-5.6 3.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm11.2 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM8 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
  />,
)
export const RaceIcon = svg(
  <>
    <path d="M5 2.5h1.7v19H5Z" />
    <path
      fillRule="evenodd"
      d="M6.7 3.5h13l-2.6 4 2.6 4h-13Zm2 1.4v2.2h2.2V4.9Zm4.4 0v2.2h2.2V4.9Zm-2.2 2.2v2.2h2.2V7.1Zm4.4 0v2.2h2.1L16 7.1Z"
    />
  </>,
)
export const CoinflipIcon = svg(
  <>
    <ellipse cx="12" cy="13.5" rx="8.5" ry="7.5" opacity="0.45" />
    <path
      fillRule="evenodd"
      d="M12 3a8.5 7.5 0 1 0 0 15 8.5 7.5 0 0 0 0-15Zm0 2.6a5.6 4.9 0 1 1 0 9.8 5.6 4.9 0 0 1 0-9.8Z"
    />
    <path d="M12 7.4 13 9.6l2.4.2-1.8 1.5.6 2.3L12 12.4l-2.2 1.2.6-2.3-1.8-1.5 2.4-.2Z" />
  </>,
)

// ---------------------------------------------------------------- pages and controls

export const FloorIcon = svg(
  <path d="M4 4h7v7H4Zm9 0h7v7h-7ZM4 13h7v7H4Zm9 0h7v7h-7Z" opacity="0.9" />,
)
export const TrophyIcon = svg(
  <path d="M7 3h10v2.2h3.2V8a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.8V17h3v2.5H8V17h3v-2.2A5 5 0 0 1 8.1 12h-.3a4 4 0 0 1-4-4V5.2H7Zm0 4.2H5.8V8A2 2 0 0 0 7 9.8Zm10 0v2.6A2 2 0 0 0 18.2 8v-.8ZM6 20.5h12V22H6Z" />,
)
export const BagIcon = svg(
  <path d="M8 7V6a4 4 0 0 1 8 0v1h3.2l.8 14H4l.8-14Zm2 0h4V6a2 2 0 0 0-4 0Zm-1.8 3.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm7.6 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />,
)
export const ClockIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7v5l3.2 2" />
  </>,
  'line',
)
export const PersonIcon = svg(
  <>
    <circle cx="12" cy="8" r="4.2" />
    <path d="M3.8 21a8.2 8.2 0 0 1 16.4 0Z" />
  </>,
)
export const ShieldIcon = svg(
  <path d="M12 2.5 20 5.6v5.9c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10V5.6Z" />,
)
/** A thief's mask: a steal attempt. */
export const MaskIcon = svg(
  <path
    fillRule="evenodd"
    d="M2 9.6C2.4 7.6 4.6 6.6 7.2 6.9 9 7.1 10.4 8.2 12 8.2s3-1.1 4.8-1.3c2.6-.3 4.8.7 5.2 2.7.4 3.2-1.6 7-5.2 7-2.2 0-3.4-2.2-4.8-2.2s-2.6 2.2-4.8 2.2C3.6 16.6 1.6 12.8 2 9.6ZM5 11.1c.9-1.3 3.3-1.6 4.9-.5-.5 1.6-2.3 2.4-3.7 1.9-.6-.2-1-.7-1.2-1.4Zm14 0c-.9-1.3-3.3-1.6-4.9-.5.5 1.6 2.3 2.4 3.7 1.9.6-.2 1-.7 1.2-1.4Z"
  />,
)
export const ScrollIcon = svg(
  <>
    <path d="M7 3.5h11a2.5 2.5 0 0 1 2.5 2.5v1.5H17v11a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-1H7Z" />
    <path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" stroke="var(--surface-1)" strokeWidth="1.6" />
  </>,
)
export const ChatIcon = svg(
  <path d="M5.5 3.5h13A2.5 2.5 0 0 1 21 6v9a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4h-.5A2.5 2.5 0 0 1 3 15V6a2.5 2.5 0 0 1 2.5-2.5Z" />,
)
export const VaultIcon = svg(
  <path
    fillRule="evenodd"
    d="M5 3h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-1v1.5h-3V20H9v1.5H6V20H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 4a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z"
  />,
)
export const SoundOnIcon = svg(
  <>
    <path d="M3.5 9h3.8L12 4.8v14.4L7.3 15H3.5Z" fill="currentColor" stroke="none" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4" />
  </>,
  'line',
)
export const SoundOffIcon = svg(
  <>
    <path d="M3.5 9h3.8L12 4.8v14.4L7.3 15H3.5Z" fill="currentColor" stroke="none" />
    <path d="m16 9.5 5 5m0-5-5 5" />
  </>,
  'line',
)
export const ArrowUpIcon = svg(<path d="m12 5 7 9h-4.5v5h-5v-5H5Z" />)
export const ArrowDownIcon = svg(<path d="m12 19-7-9h4.5V5h5v5H19Z" />)
export const CloseIcon = svg(<path d="m6 6 12 12M18 6 6 18" />, 'line')
export const SendIcon = svg(<path d="M3 11.2 20.5 3.5 15 21l-3.6-7.2Zm8.4 2.6 4.2-6.1" />)
export const SidebarIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M15 4v16" />
  </>,
  'line',
)
export const LogoutIcon = svg(<path d="M10 4H5.5v16H10M14.5 8l4 4-4 4M18.5 12H9" />, 'line')
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />, 'line')
export const HelpIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6" />
    <path d="M12 16.9h.01" strokeWidth="2.4" />
  </>,
  'line',
)
export const CopyIcon = svg(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5" />
  </>,
  'line',
)
export const SparkleIcon = svg(
  <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" />,
)
