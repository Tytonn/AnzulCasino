/**
 * Draws what features put in a slot (see SlotProps in manifests.ts). One
 * broken component shows nothing instead of taking the page down.
 *
 *   <Slot name="shop-items" props={{}} />
 */
import { Component, type ReactNode } from 'react'

import { useMe } from '../kit/queries.ts'
import type { SlotName, SlotProps } from './manifests.ts'
import { slotEntries } from './registry.ts'

class SlotBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error(`[slot] ${this.props.id} failed`, error)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}

/** The slot's entries this player may see. */
export function useSlot<K extends SlotName>(name: K) {
  const me = useMe()
  return slotEntries(name).filter((entry) => !entry.adminOnly || me.role === 'admin')
}

export function Slot<K extends SlotName>({ name, props }: { name: K; props: SlotProps[K] }) {
  const entries = useSlot(name)
  return entries.map((entry) => {
    const Entry = entry.component
    return (
      <SlotBoundary key={entry.id} id={entry.id}>
        <Entry {...props} />
      </SlotBoundary>
    )
  })
}
