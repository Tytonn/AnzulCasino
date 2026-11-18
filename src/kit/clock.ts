/**
 * The server's clock in the browser (spec rule 8: browser countdowns are
 * display only, corrected by an offset from /api/time). The shell measures
 * the offset once per sign-in.
 *
 *   const now = useNow()                         // a Date, ticking every second
 *   const left = deadline - now.getTime()
 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'

import { api } from './api.ts'

interface ClockState {
  /** Server time minus browser time, in milliseconds. */
  offset: number
}

const useClock = create<ClockState>(() => ({ offset: 0 }))

/** Asks the server for its time and keeps the offset. */
export async function syncClock(): Promise<void> {
  const sent = Date.now()
  const { now } = await api.get<{ now: number }>('/api/time')
  const received = Date.now()
  // The server read its clock somewhere in the round trip; assume the middle.
  useClock.setState({ offset: now - (sent + received) / 2 })
}

/** The server's time now, in epoch milliseconds. */
export function serverNow(): number {
  return Date.now() + useClock.getState().offset
}

/** The server's time, re-rendering every `everyMs` (one second by default). */
export function useNow(everyMs = 1_000): Date {
  const offset = useClock((s) => s.offset)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return new Date(now + offset)
}

/** "3d 4h", "4h 12m", "12:04", for a countdown in milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
