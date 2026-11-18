/**
 * The site's buttons (spec: Quality bar: "Buttons have hover, pressed and
 * disabled looks"). Use these in games so every room feels the same.
 *
 *   <Button variant="primary" size="lg" onClick={deal}>Deal <Kbd>Enter</Kbd></Button>
 *   <Button pressed={call === 'heads'} onClick={() => setCall('heads')}>Heads</Button>
 */
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'gold'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-card hover:bg-accent-strong disabled:hover:bg-accent',
  secondary:
    'border border-border bg-surface-2 text-text hover:border-border-strong hover:bg-surface-3 disabled:hover:border-border disabled:hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-text',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text disabled:hover:bg-transparent',
  gold: 'bg-gold text-on-gold shadow-card hover:brightness-110 disabled:hover:brightness-100',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** For a toggle, such as a side to bet on: sets aria-pressed and the pressed look. */
  pressed?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  pressed,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  )
}
