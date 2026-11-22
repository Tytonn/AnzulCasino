/**
 * Heist's manifest (spec: Steal, shields and vault, Shop): the Shop page,
 * the .rob, .dep and .with commands, the steal and shield widgets in the
 * top bar, Rob on a player's card, the shield and extra-attempt cards in
 * the Shop, and the overlay that holds the heist panel, the steal dialog
 * and the alerts.
 */
import '../../theme/features/heist.css'

import { defineFeature } from '../../shell/manifests.ts'
import { HEIST_COMMANDS } from './commands.ts'
import { HeistOverlay } from './Overlay.tsx'
import { ExtraAttemptItem, ShieldItem } from './ShopItems.tsx'
import { ShieldWidget, StealAction, StealsWidget } from './widgets.tsx'

export default defineFeature({
  id: 'heist',
  commands: HEIST_COMMANDS,
  routes: [{ path: '/shop', title: 'Shop', page: () => import('./ShopPage.tsx') }],
  slots: {
    'top-bar': [
      { id: 'heist.steals', order: 60, component: StealsWidget },
      { id: 'heist.shield', order: 61, component: ShieldWidget },
    ],
    'profile-actions': [{ id: 'heist.rob', order: 10, component: StealAction }],
    overlay: [{ id: 'heist.overlay', order: 10, component: HeistOverlay }],
    'shop-items': [
      { id: 'heist.shield', order: 20, component: ShieldItem },
      { id: 'heist.extra-attempt', order: 30, component: ExtraAttemptItem },
    ],
  },
})
