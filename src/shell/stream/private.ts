/**
 * Private items (spec: The stream > Private replies): what .help, and .bal
 * and .lb while they answer privately, show you alone, at the bottom of your
 * own stream, marked "only you". They are never stored, so a reload clears
 * them.
 */
import { create } from 'zustand'

import type { PrivateReply } from '../manifests.ts'

export interface PrivateItem {
  id: number
  /** The newest stream item when it was added: it shows right after that one. */
  afterId: number
  reply: PrivateReply
}

/** The most kept at once; the oldest go first. */
const KEEP = 12

interface Private {
  items: readonly PrivateItem[]
}

export const usePrivate = create<Private>(() => ({ items: [] }))

let nextId = 1

export function addPrivate(reply: PrivateReply, afterId: number): void {
  const item: PrivateItem = { id: nextId++, afterId, reply }
  usePrivate.setState((state) => ({ items: [...state.items, item].slice(-KEEP) }))
}

export function dismissPrivate(id: number): void {
  usePrivate.setState((state) => ({ items: state.items.filter((i) => i.id !== id) }))
}
