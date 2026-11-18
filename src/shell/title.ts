import { useEffect } from 'react'

/** Sets the browser tab's title: "Blackjack · Anzul Casino". */
export function useTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · Anzul Casino` : 'Anzul Casino'
  }, [title])
}
