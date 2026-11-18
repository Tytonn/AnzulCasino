/**
 * Finds every manifest (spec: Manifests) and merges them with the planned
 * rooms and pages. Adding a game or a feature means adding a folder.
 */
import type { Icon } from '../kit/icons.tsx'
import { CoinflipIcon } from '../kit/icons.tsx'
import type {
  FeatureManifest,
  FeatureRoute,
  GameManifest,
  NavItem,
  SlotEntry,
  SlotName,
  SlotProps,
} from './manifests.ts'
import { PLANNED_GAMES, PLANNED_PAGES, type PlannedPage } from './planned.ts'

type Module<T> = { default: T }

const gameModules = import.meta.glob<Module<GameManifest>>('../games/*/manifest.ts', {
  eager: true,
})
const featureModules = import.meta.glob<Module<FeatureManifest>>('../features/*/manifest.ts', {
  eager: true,
})

export interface GameEntry {
  id: string
  name: string
  order: number
  icon: Icon
  /** Null while the room is still a placeholder. */
  manifest: GameManifest | null
  lane: string
  pitch: string
}

function buildGames(manifests: readonly GameManifest[]): GameEntry[] {
  const byId = new Map<string, GameEntry>()
  for (const planned of PLANNED_GAMES) byId.set(planned.id, { ...planned, manifest: null })
  for (const manifest of manifests) {
    const planned = byId.get(manifest.id)
    byId.set(manifest.id, {
      id: manifest.id,
      name: manifest.name,
      order: manifest.order,
      icon: manifest.icon ?? planned?.icon ?? CoinflipIcon,
      manifest,
      lane: planned?.lane ?? manifest.id,
      pitch: manifest.howToPlay[0] ?? planned?.pitch ?? '',
    })
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export const features: readonly FeatureManifest[] = Object.values(featureModules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id))

export const games: readonly GameEntry[] = buildGames(
  Object.values(gameModules).map((m) => m.default),
)

export function gameById(id: string | undefined): GameEntry | undefined {
  return id === undefined ? undefined : games.find((g) => g.id === id)
}

export interface PageEntry {
  path: string
  title: string
  adminOnly: boolean
  /** The lane's page, or null for a placeholder. */
  route: FeatureRoute | null
  planned: PlannedPage | null
}

function buildPages(): PageEntry[] {
  const byPath = new Map<string, PageEntry>()
  for (const planned of PLANNED_PAGES) {
    byPath.set(planned.path, {
      path: planned.path,
      title: planned.title,
      adminOnly: planned.adminOnly ?? false,
      route: null,
      planned,
    })
  }
  for (const feature of features) {
    for (const route of feature.routes ?? []) {
      const planned = byPath.get(route.path)?.planned ?? null
      byPath.set(route.path, {
        path: route.path,
        title: route.title,
        adminOnly: route.adminOnly ?? planned?.adminOnly ?? false,
        route,
        planned,
      })
    }
  }
  return [...byPath.values()]
}

export const pages: readonly PageEntry[] = buildPages()

export interface RailLink extends NavItem {
  icon: Icon | undefined
  group: 'main' | 'more'
}

function buildNav(): RailLink[] {
  const links: RailLink[] = []
  for (const planned of PLANNED_PAGES) {
    if (planned.nav === 'none') continue
    links.push({
      to: planned.path,
      label: planned.title,
      icon: planned.icon,
      order: planned.order,
      adminOnly: planned.adminOnly,
      group: planned.nav,
    })
  }
  for (const feature of features) {
    for (const item of feature.nav ?? []) {
      if (links.some((l) => l.to === item.to)) continue
      links.push({ ...item, icon: item.icon, group: 'main' })
    }
  }
  return links.sort((a, b) => a.order - b.order)
}

export const railLinks: readonly RailLink[] = buildNav()

/** Everything features put in one slot, in order. */
export function slotEntries<K extends SlotName>(name: K): readonly SlotEntry<SlotProps[K]>[] {
  const found: SlotEntry<SlotProps[K]>[] = []
  for (const feature of features) {
    const entries = feature.slots?.[name] as readonly SlotEntry<SlotProps[K]>[] | undefined
    if (entries) found.push(...entries)
  }
  return found.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
