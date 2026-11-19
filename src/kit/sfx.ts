/**
 * The sound manager (spec: Sound and keys): short sounds for chips, cards,
 * wins, losses, steals and shield blocks, at the player's volume and mute.
 * They are synthesized with Web Audio, so there are no files to load or
 * license, and a theme can replace any of them later.
 *
 *   playSound('chip')     // a bet goes down
 *   playSound('win')      // a small win; 'bigwin' for the full celebration
 *
 * Browsers only allow sound after the player has clicked or typed, which is
 * always true by the time a game plays one.
 */
import { useSound } from './sound.ts'

export const SOUNDS = [
  'chip',
  'deal',
  'flip',
  'tick',
  'win',
  'bigwin',
  'loss',
  'steal',
  'block',
] as const
export type SoundName = (typeof SOUNDS)[number]

let context: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null
  context ??= new window.AudioContext()
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer
  const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

interface Tone {
  frequency: number
  /** Seconds after the sound starts. */
  at?: number
  duration: number
  gain?: number
  type?: OscillatorType
  /** Glide to this frequency over the tone. */
  glideTo?: number
}

function tone(ac: AudioContext, out: AudioNode, start: number, t: Tone) {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  const begin = start + (t.at ?? 0)
  const peak = t.gain ?? 0.3
  osc.type = t.type ?? 'sine'
  osc.frequency.setValueAtTime(t.frequency, begin)
  if (t.glideTo) osc.frequency.exponentialRampToValueAtTime(t.glideTo, begin + t.duration)
  env.gain.setValueAtTime(0.0001, begin)
  env.gain.exponentialRampToValueAtTime(peak, begin + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, begin + t.duration)
  osc.connect(env).connect(out)
  osc.start(begin)
  osc.stop(begin + t.duration + 0.02)
}

interface Noise {
  at?: number
  duration: number
  gain?: number
  /** Band-pass center, sweeping to `sweepTo` if given. */
  frequency: number
  sweepTo?: number
  q?: number
}

function hiss(ac: AudioContext, out: AudioNode, start: number, n: Noise) {
  const source = ac.createBufferSource()
  source.buffer = noise(ac)
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = n.q ?? 1.2
  const begin = start + (n.at ?? 0)
  filter.frequency.setValueAtTime(n.frequency, begin)
  if (n.sweepTo) filter.frequency.exponentialRampToValueAtTime(n.sweepTo, begin + n.duration)
  const env = ac.createGain()
  env.gain.setValueAtTime(0.0001, begin)
  env.gain.exponentialRampToValueAtTime(n.gain ?? 0.4, begin + 0.006)
  env.gain.exponentialRampToValueAtTime(0.0001, begin + n.duration)
  source.connect(filter).connect(env).connect(out)
  source.start(begin, Math.random() * 0.5)
  source.stop(begin + n.duration + 0.02)
}

const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1046.5
const E6 = 1318.5

const RECIPES: Record<SoundName, (ac: AudioContext, out: AudioNode, t: number) => void> = {
  // Two clay chips clicking together.
  chip(ac, out, t) {
    hiss(ac, out, t, { duration: 0.035, frequency: 3800, q: 3, gain: 0.5 })
    hiss(ac, out, t, { at: 0.045, duration: 0.03, frequency: 4400, q: 3, gain: 0.35 })
    tone(ac, out, t, { frequency: 2600, duration: 0.05, gain: 0.08, type: 'triangle' })
  },
  // A card sliding across felt.
  deal(ac, out, t) {
    hiss(ac, out, t, { duration: 0.14, frequency: 1800, sweepTo: 5200, q: 0.8, gain: 0.35 })
  },
  // A coin leaving the thumb: a bright ring.
  flip(ac, out, t) {
    tone(ac, out, t, { frequency: 1900, duration: 0.35, gain: 0.12 })
    tone(ac, out, t, { frequency: 2850, duration: 0.25, gain: 0.06 })
    hiss(ac, out, t, { duration: 0.03, frequency: 5000, q: 2, gain: 0.25 })
  },
  tick(ac, out, t) {
    tone(ac, out, t, { frequency: 1400, duration: 0.04, gain: 0.12, type: 'square' })
  },
  win(ac, out, t) {
    ;[C5, E5, G5].forEach((frequency, i) =>
      tone(ac, out, t, { frequency, at: i * 0.07, duration: 0.18, gain: 0.18, type: 'triangle' }),
    )
  },
  bigwin(ac, out, t) {
    ;[C5, E5, G5, C6].forEach((frequency, i) =>
      tone(ac, out, t, { frequency, at: i * 0.08, duration: 0.22, gain: 0.2, type: 'triangle' }),
    )
    for (const frequency of [C6, E6, G5 * 2]) {
      tone(ac, out, t, { frequency, at: 0.34, duration: 0.9, gain: 0.08, type: 'sine' })
    }
    hiss(ac, out, t, { at: 0.34, duration: 0.5, frequency: 7000, q: 0.7, gain: 0.08 })
  },
  loss(ac, out, t) {
    tone(ac, out, t, { frequency: 392, glideTo: 330, duration: 0.18, gain: 0.16, type: 'triangle' })
    tone(ac, out, t, {
      frequency: 294,
      glideTo: 220,
      at: 0.16,
      duration: 0.3,
      gain: 0.16,
      type: 'triangle',
    })
  },
  steal(ac, out, t) {
    hiss(ac, out, t, { duration: 0.32, frequency: 6000, sweepTo: 700, q: 1.5, gain: 0.35 })
    tone(ac, out, t, { frequency: 880, glideTo: 220, duration: 0.3, gain: 0.08, type: 'sawtooth' })
  },
  block(ac, out, t) {
    tone(ac, out, t, { frequency: 120, glideTo: 70, duration: 0.25, gain: 0.35 })
    tone(ac, out, t, { frequency: 1250, duration: 0.4, gain: 0.08, type: 'triangle' })
    hiss(ac, out, t, { duration: 0.06, frequency: 2500, q: 1, gain: 0.3 })
  },
}

/** Plays a sound at the player's volume, unless they muted sound. Never throws. */
export function playSound(name: SoundName): void {
  const { muted, volume } = useSound.getState()
  if (muted || volume <= 0) return
  try {
    const ac = audio()
    if (!ac) return
    const master = ac.createGain()
    // Loudness feels logarithmic: square the slider so 50% sounds like half.
    master.gain.value = (Math.min(volume, 100) / 100) ** 2
    master.connect(ac.destination)
    RECIPES[name](ac, master, ac.currentTime + 0.005)
  } catch (error) {
    console.warn('[sound] could not play', name, error)
  }
}
