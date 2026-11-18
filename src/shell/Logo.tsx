/**
 * The Anzul mark: a white "A" whose right stroke is a curved sail, with a
 * four-point sparkle on the left, after the Anzul Discord server's icon. The
 * wordmark is ANZUL in heavy capitals. public/favicon.svg is the same mark.
 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      <g fill="currentColor">
        {/* The left leg. */}
        <path d="M30.6 6.5h6.2L19.2 57.5h-7.4Z" />
        {/* The sail: bowed out to the right, hollowed on the inside. */}
        <path d="M34.4 6.5C48 16.5 58.5 34 50.4 57.5h-7.6c2.6-16.6-.6-32.4-10.3-44.6Z" />
        {/* The crossbar. */}
        <path d="M21.6 38.2h21.1l-.2 5.4H19.8Z" />
        {/* The sparkle. */}
        <path d="M13 13.5c.7 5.2 3 7.6 8.2 8.3-5.2.7-7.5 3-8.2 8.2-.7-5.2-3-7.5-8.2-8.2 5.2-.7 7.5-3.1 8.2-8.3Z" />
      </g>
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-text">
      <LogoMark className="size-8 shrink-0" />
      {!compact && <span className="text-xl leading-none font-black tracking-[0.14em]">ANZUL</span>}
      <span className="sr-only">Anzul Casino</span>
    </span>
  )
}
