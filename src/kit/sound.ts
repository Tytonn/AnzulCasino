/**
 * The player's sound setting (spec: Sound and keys): one volume and a mute,
 * remembered per player. The game kit plays sounds through it.
 */
import { create } from 'zustand'

import { api } from './api.ts'

interface SoundState {
  muted: boolean
  /** 0 to 100. */
  volume: number
}

export const useSound = create<SoundState>(() => ({ muted: false, volume: 70 }))

/** Changes the setting now and saves it to the player's profile. */
export async function saveSound(change: Partial<SoundState>): Promise<void> {
  useSound.setState(change)
  await api.patch('/api/me', {
    ...(change.muted === undefined ? {} : { soundMuted: change.muted }),
    ...(change.volume === undefined ? {} : { soundVolume: change.volume }),
  })
}
