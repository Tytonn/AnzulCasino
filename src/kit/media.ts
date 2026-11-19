/** Layout sizes, matching the breakpoints in src/index.css, and a hook to follow them. */
import { useSyncExternalStore } from 'react'

/** 768px and wider: the left rail; below it the phone layout. */
export const TABLET = '(min-width: 48rem)'
/** 1100px and wider: the right sidebar stays open. */
export const DESK = '(min-width: 68.75rem)'
/** 1280px and wider: the rail shows its labels. */
export const WIDE = '(min-width: 80rem)'
/** A touch screen: no hover, and the on-screen keyboard covers half the page. */
export const TOUCH = '(pointer: coarse)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
