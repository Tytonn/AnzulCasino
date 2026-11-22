/**
 * Every room and page in the spec, so the rail, the Floor and the router know
 * them before their lanes land. Until a lane's manifest arrives, each one
 * opens a placeholder that names who builds it. A manifest with the same
 * game id, or a route with the same path, takes its place.
 */
import {
  BagIcon,
  BlackjackIcon,
  CoinflipIcon,
  CrashIcon,
  FloorIcon,
  type Icon,
  MinesIcon,
  PersonIcon,
  PlinkoIcon,
  RaceIcon,
  RouletteIcon,
  RussianRouletteIcon,
  ScrollIcon,
  ShieldIcon,
  SlotsIcon,
  TrophyIcon,
  ClockIcon,
  CrownIcon,
} from '../kit/icons.tsx'

export interface PlannedGame {
  id: string
  name: string
  order: number
  icon: Icon
  /** The lane that builds it. */
  lane: string
  /** One line for its placeholder and Floor card. */
  pitch: string
}

export const PLANNED_GAMES: readonly PlannedGame[] = [
  {
    id: 'blackjack',
    name: 'Blackjack',
    order: 10,
    icon: BlackjackIcon,
    lane: 'blackjack',
    pitch: 'Beat the dealer to 21.',
  },
  {
    id: 'roulette',
    name: 'Roulette',
    order: 20,
    icon: RouletteIcon,
    lane: 'roulette',
    pitch: 'One wheel, everyone bets.',
  },
  {
    id: 'crash',
    name: 'Crash',
    order: 30,
    icon: CrashIcon,
    lane: 'crash',
    pitch: 'Cash out before it crashes.',
  },
  {
    id: 'mines',
    name: 'Mines',
    order: 40,
    icon: MinesIcon,
    lane: 'arcade',
    pitch: 'Pick tiles, dodge the mines.',
  },
  {
    id: 'plinko',
    name: 'Plinko',
    order: 50,
    icon: PlinkoIcon,
    lane: 'arcade',
    pitch: 'Drop a ball through the pegs.',
  },
  {
    id: 'slots',
    name: 'Slots',
    order: 60,
    icon: SlotsIcon,
    lane: 'slots',
    pitch: 'Spin the reels.',
  },
  {
    id: 'russian-roulette',
    name: 'Russian roulette',
    order: 70,
    icon: RussianRouletteIcon,
    lane: 'russian-roulette',
    pitch: 'Last one standing takes the pot.',
  },
  {
    id: 'race',
    name: 'Race',
    order: 80,
    icon: RaceIcon,
    lane: 'race',
    pitch: 'Back a runner every 75 seconds.',
  },
  {
    id: 'coinflip',
    name: 'Coin flip',
    order: 90,
    icon: CoinflipIcon,
    lane: 'foundation',
    pitch: 'Heads or tails.',
  },
]

export interface PlannedPage {
  path: string
  title: string
  lane: string
  icon: Icon
  /** On the rail among the page links, or only linked from elsewhere. */
  nav: 'main' | 'more' | 'none'
  order: number
  adminOnly?: boolean
  pitch: string
}

export const PLANNED_PAGES: readonly PlannedPage[] = [
  {
    path: '/leaderboard',
    title: 'Leaderboard',
    lane: 'social',
    icon: TrophyIcon,
    nav: 'main',
    order: 10,
    pitch: 'The full table, everyone’s net worth over time, and the last day’s moves.',
  },
  {
    path: '/shop',
    title: 'Shop',
    lane: 'heist',
    icon: BagIcon,
    nav: 'main',
    order: 20,
    pitch: 'Shields, ranks and extra steal attempts.',
  },
  {
    path: '/history',
    title: 'History',
    lane: 'social',
    icon: ClockIcon,
    nav: 'main',
    order: 30,
    pitch: 'Every round from every room, with replays.',
  },
  {
    path: '/profile',
    title: 'Profile',
    lane: 'social',
    icon: PersonIcon,
    nav: 'main',
    order: 40,
    pitch: 'Your season: net worth over time, best wins, steals, trophies.',
  },
  {
    path: '/admin',
    title: 'Admin',
    lane: 'admin',
    icon: ShieldIcon,
    nav: 'main',
    order: 50,
    adminOnly: true,
    pitch: 'Seasons, invite codes, config, players and chips.',
  },
  {
    path: '/audit',
    title: 'Audit',
    lane: 'admin',
    icon: ScrollIcon,
    nav: 'more',
    order: 60,
    pitch: 'Every admin action, in public.',
  },
  {
    path: '/hall-of-fame',
    title: 'Hall of Fame',
    lane: 'economy',
    icon: CrownIcon,
    nav: 'more',
    order: 70,
    pitch: 'Every past season’s podium and standings.',
  },
  {
    path: '/history/:roundId',
    title: 'Round',
    lane: 'social',
    icon: ClockIcon,
    nav: 'none',
    order: 0,
    pitch: 'One round, replayed from its saved detail.',
  },
  {
    path: '/players/:username',
    title: 'Player',
    lane: 'social',
    icon: PersonIcon,
    nav: 'none',
    order: 0,
    pitch: 'A player’s season: net worth, best wins, steals and trophies.',
  },
]

/**
 * The Floor's own link, first on the classic rail. The stream took the
 * home page, so the Floor and its rooms live under /classic until the last
 * game has its card (Tyton, Nov 22, 2026).
 */
export const FLOOR_NAV = { to: '/classic', label: 'Floor', icon: FloorIcon, order: 0 }
