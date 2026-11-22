/**
 * The economy's manifest (spec: Manifests): the top-bar buttons (Collect,
 * work, slut and crime, and the Daily panel), their commands, the work
 * timer in the phone's strip over the stream, the rank card
 * on the Shop page, the Grab button under chat drops, and the overlay that
 * keeps it all live.
 */
import '../../theme/features/economy.css'

import { defineFeature } from '../../shell/manifests.ts'
import { ECONOMY_COMMANDS } from './commands.ts'
import { DropGrab } from './Drops.tsx'
import { EconomyOverlay } from './Overlay.tsx'
import { RankCard } from './Ranks.tsx'
import { WorkStatus } from './StreamStatus.tsx'
import { CollectWidget, DailyWidget, JobsWidget } from './Widgets.tsx'

export default defineFeature({
  id: 'economy',
  commands: ECONOMY_COMMANDS,
  slots: {
    'top-bar': [
      { id: 'economy.collect', order: 10, component: CollectWidget },
      { id: 'economy.jobs', order: 20, component: JobsWidget },
      { id: 'economy.daily', order: 30, component: DailyWidget },
    ],
    'stream-status': [{ id: 'economy.work', order: 10, component: WorkStatus }],
    overlay: [{ id: 'economy.overlay', order: 10, component: EconomyOverlay }],
    'chat-message': [{ id: 'economy.drop', order: 10, component: DropGrab }],
    'shop-items': [{ id: 'economy.ranks', order: 20, component: RankCard }],
  },
})
