/**
 * The wheel's own sounds, made with Web Audio like the kit's (src/kit/sfx.ts)
 * and played at the player's volume and mute: the ball flicked onto the
 * track, its roll as it slows, the clicks as it bounces over the frets, and
 * the clack as it drops into a pocket. Chips, wins and losses use the kit's.
 */
import { useSound } from '../../kit/sound.ts'

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
  const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

/** The player's volume as a gain, or null when sound is off. */
function level(): number | null {
  const { muted, volume } = useSound.getState()
  if (muted || volume <= 0) return null
  return (Math.min(volume, 100) / 100) ** 2
}

function out(ac: AudioContext, gain: number): GainNode {
  const master = ac.createGain()
  master.gain.value = gain
  master.connect(ac.destination)
  return master
}

interface Burst {
  /** Seconds from now. */
  at: number
  duration: number
  frequency: number
  sweepTo?: number
  q?: number
  gain: number
  type?: BiquadFilterType
}

function burst(ac: AudioContext, dest: AudioNode, b: Burst) {
  const source = ac.createBufferSource()
  source.buffer = noise(ac)
  const filter = ac.createBiquadFilter()
  filter.type = b.type ?? 'bandpass'
  filter.Q.value = b.q ?? 1.2
  const begin = ac.currentTime + 0.005 + b.at
  filter.frequency.setValueAtTime(b.frequency, begin)
  if (b.sweepTo) filter.frequency.exponentialRampToValueAtTime(b.sweepTo, begin + b.duration)
  const env = ac.createGain()
  env.gain.setValueAtTime(0.0001, begin)
  env.gain.exponentialRampToValueAtTime(b.gain, begin + Math.min(0.02, b.duration / 4))
  env.gain.exponentialRampToValueAtTime(0.0001, begin + b.duration)
  source.connect(filter).connect(env).connect(dest)
  source.start(begin, Math.random())
  source.stop(begin + b.duration + 0.05)
}

function knock(ac: AudioContext, dest: AudioNode, at: number, frequency: number, gain: number) {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  const begin = ac.currentTime + 0.005 + at
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(frequency, begin)
  osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, begin + 0.06)
  env.gain.setValueAtTime(0.0001, begin)
  env.gain.exponentialRampToValueAtTime(gain, begin + 0.004)
  env.gain.exponentialRampToValueAtTime(0.0001, begin + 0.08)
  osc.connect(env).connect(dest)
  osc.start(begin)
  osc.stop(begin + 0.1)
}

function play(recipe: (ac: AudioContext, dest: AudioNode) => void): void {
  const gain = level()
  if (gain === null) return
  try {
    const ac = audio()
    if (!ac) return
    recipe(ac, out(ac, gain))
  } catch (error) {
    console.warn('[roulette] could not play a sound', error)
  }
}

/** The ball flicked onto the track, then rolling for `rollMs` as it slows. */
export function playLaunch(rollMs: number): void {
  play((ac, dest) => {
    burst(ac, dest, { at: 0, duration: 0.35, frequency: 900, sweepTo: 4200, q: 0.9, gain: 0.32 })
    const seconds = Math.max(0.5, rollMs / 1000)
    // A low rumble that drops in pitch and fades as the ball slows.
    burst(ac, dest, {
      at: 0.1,
      duration: seconds,
      frequency: 2600,
      sweepTo: 420,
      q: 0.7,
      gain: 0.09,
    })
    burst(ac, dest, {
      at: 0.1,
      duration: seconds * 0.9,
      frequency: 180,
      sweepTo: 90,
      q: 0.8,
      gain: 0.12,
      type: 'lowpass',
    })
  })
}

/** One click of the ball on a fret, `delayMs` from now. */
export function playBounce(delayMs: number): void {
  play((ac, dest) => {
    const at = Math.max(0, delayMs / 1000)
    burst(ac, dest, { at, duration: 0.03, frequency: 3400, q: 4, gain: 0.35 })
    knock(ac, dest, at, 1500, 0.08)
  })
}

/** The ball dropping into its pocket, `delayMs` from now. */
export function playDrop(delayMs: number): void {
  play((ac, dest) => {
    const at = Math.max(0, delayMs / 1000)
    burst(ac, dest, { at, duration: 0.045, frequency: 2400, q: 3, gain: 0.45 })
    knock(ac, dest, at, 820, 0.2)
    burst(ac, dest, { at: at + 0.07, duration: 0.03, frequency: 3000, q: 4, gain: 0.18 })
  })
}
