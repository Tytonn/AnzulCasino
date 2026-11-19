/**
 * Heist's icons and small pieces of art, drawn in code like the kit's icons
 * (src/kit/icons.tsx): the thief's mask, the pips that count attempts and
 * shield charges, and the shield and vault art for the Shop's cards.
 */
import { motion } from 'motion/react'
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

/** A thief's domino mask: steals. */
export function MaskIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        d="M1.8 9.4c0-1.9 1.6-3.1 3.5-2.7 2.3.5 4.3 1.4 6.7 1.4s4.4-.9 6.7-1.4c1.9-.4 3.5.8 3.5 2.7 0 3.9-2.2 7.6-5.6 7.6-2 0-3.2-1.6-4.6-1.6s-2.6 1.6-4.6 1.6c-3.4 0-5.6-3.7-5.6-7.6Zm6.2-.3c-1.7 0-3.2.8-3.2 2 0 .9 1 1.6 2.5 1.6 1.7 0 3.2-.9 3.2-2 0-.9-1-1.6-2.5-1.6Zm8 0c-1.5 0-2.5.7-2.5 1.6 0 1.1 1.5 2 3.2 2 1.5 0 2.5-.7 2.5-1.6 0-1.2-1.5-2-3.2-2Z"
      />
    </svg>
  )
}

/** A lockpick crossing a key: the extra steal attempt. */
export function PickIcon(props: IconProps) {
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
      <circle cx="7.5" cy="7.5" r="3.6" />
      <path d="m10.1 10.1 9.4 9.4M16.2 16.2l2-2M13.6 13.6l1.6-1.6" />
      <path d="M4 20 17.5 6.5l1.7-.3-.3 1.7L5.4 21.4Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A padlock: closed for the final day. */
export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        d="M7 10V7.5a5 5 0 0 1 10 0V10h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2.3 0h5.4V7.5a2.7 2.7 0 0 0-5.4 0ZM12 13.5a1.6 1.6 0 0 0-.8 3V18h1.6v-1.5a1.6 1.6 0 0 0-.8-3Z"
      />
    </svg>
  )
}

/** A siren: a steal that failed. */
export function SirenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" {...props}>
      <path d="M6.5 18v-5.5a5.5 5.5 0 0 1 11 0V18Zm-2 1.5h15V22h-15ZM11 2h2v3h-2ZM3.3 5.5l1.4-1.4 2.1 2.1-1.4 1.4Zm14 .7 2.1-2.1 1.4 1.4-2.1 2.1Z" />
    </svg>
  )
}

/** An empty pip: an outline you can see on the top bar, not a hole. */
const EMPTY = 'var(--text-faint)'
const EMPTY_FILL = 'color-mix(in oklab, var(--text-faint) 14%, transparent)'

/** A row of pips: filled for what is left, hollow for what is used. */
export function Pips({
  filled,
  total,
  shape = 'dot',
  tone = 'accent',
  size = 'md',
  label,
}: {
  filled: number
  total: number
  shape?: 'dot' | 'shield'
  tone?: 'accent' | 'shield' | 'gold'
  size?: 'sm' | 'md' | 'lg'
  label?: string
}) {
  const color =
    tone === 'shield' ? 'var(--heist-shield)' : tone === 'gold' ? 'var(--gold)' : 'var(--accent)'
  const px = size === 'sm' ? 8 : size === 'lg' ? 16 : 10
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={label}>
      {Array.from({ length: Math.max(0, total) }, (_, i) => {
        const on = i < filled
        return shape === 'shield' ? (
          <motion.svg
            key={i}
            viewBox="0 0 24 24"
            width={px + 3}
            height={px + 3}
            initial={false}
            animate={{ scale: on ? 1 : 0.88 }}
            transition={{ type: 'spring', stiffness: 520, damping: 22 }}
            aria-hidden="true"
          >
            <path
              d="M12 2.5 20 5.6v5.9c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10V5.6Z"
              fill={on ? color : EMPTY_FILL}
              stroke={on ? color : EMPTY}
              strokeWidth={2.4}
              strokeLinejoin="round"
            />
          </motion.svg>
        ) : (
          <span
            key={i}
            className="relative block rounded-full"
            style={{
              width: px,
              height: px,
              backgroundColor: on ? undefined : EMPTY_FILL,
              boxShadow: `inset 0 0 0 ${px > 10 ? 2 : 1.5}px ${on ? color : EMPTY}`,
            }}
          >
            {/* The fill pops in when a pip is earned and shrinks away when spent. */}
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: color }}
              initial={false}
              animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}
            />
          </span>
        )
      })}
    </span>
  )
}

/** The shield on the Shop's card and the Defend tab: a steel blue crest that glows. */
export function ShieldArt({ charges, max }: { charges: number; max: number }) {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-auto" aria-hidden="true">
      <defs>
        <linearGradient id="heist-shield-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--heist-shield)" />
          <stop offset="1" stopColor="var(--heist-shield-deep)" />
        </linearGradient>
        <radialGradient id="heist-shield-halo">
          <stop offset="0" stopColor="var(--heist-shield)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--heist-shield)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#heist-shield-halo)" />
      <path
        d="M60 14 94 27v25c0 21.5-14.5 37.4-34 42.6C40.5 89.4 26 73.5 26 52V27Z"
        fill="url(#heist-shield-face)"
        stroke="var(--heist-steel-light)"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M60 22v64.5C44.6 81.6 34 69 34 52V32.4Z"
        fill="var(--heist-steel-light)"
        opacity="0.16"
      />
      <path
        d="m47 53 9 9 17-18"
        fill="none"
        stroke="var(--heist-steel-light)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={charges > 0 ? 0.95 : 0.35}
      />
      {Array.from({ length: max }, (_, i) => {
        const x = 60 + (i - (max - 1) / 2) * 16
        return (
          <circle
            key={i}
            cx={x}
            cy={106}
            r={5}
            fill={i < charges ? 'var(--heist-shield)' : 'transparent'}
            stroke={i < charges ? 'var(--heist-shield)' : EMPTY}
            strokeWidth={2}
          />
        )
      })}
    </svg>
  )
}

/** The extra attempt's card: a mask over a lockpick. */
export function ExtraAttemptArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-auto" aria-hidden="true">
      <defs>
        <radialGradient id="heist-extra-halo">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#heist-extra-halo)" />
      <g transform="translate(18 70) rotate(-40)">
        <rect x="0" y="-3" width="84" height="6" rx="3" fill="var(--heist-steel)" />
        <path d="M84 -3h8l4 6h-12Z" fill="var(--heist-steel-light)" />
        <rect x="-4" y="-7" width="22" height="14" rx="4" fill="var(--heist-steel-dark)" />
      </g>
      <g transform="translate(20 30) scale(3.3)">
        <MaskPath />
      </g>
      <g transform="translate(86 78)">
        <circle r="15" fill="var(--accent)" />
        <path d="M0-7v14M-7 0h14" stroke="var(--on-accent)" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  )
}

function MaskPath() {
  return (
    <path
      fillRule="evenodd"
      fill="var(--text)"
      d="M1.8 9.4c0-1.9 1.6-3.1 3.5-2.7 2.3.5 4.3 1.4 6.7 1.4s4.4-.9 6.7-1.4c1.9-.4 3.5.8 3.5 2.7 0 3.9-2.2 7.6-5.6 7.6-2 0-3.2-1.6-4.6-1.6s-2.6 1.6-4.6 1.6c-3.4 0-5.6-3.7-5.6-7.6Zm6.2-.3c-1.7 0-3.2.8-3.2 2 0 .9 1 1.6 2.5 1.6 1.7 0 3.2-.9 3.2-2 0-.9-1-1.6-2.5-1.6Zm8 0c-1.5 0-2.5.7-2.5 1.6 0 1.1 1.5 2 3.2 2 1.5 0 2.5-.7 2.5-1.6 0-1.2-1.5-2-3.2-2Z"
    />
  )
}
