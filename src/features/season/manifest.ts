/**
 * The season's manifest (spec: Manifests): the final-day and between-seasons
 * banner, the podium screen and the Hall of Fame page. The server side is in
 * server/features/season/, behind the economy's API.
 */
import '../../theme/features/season.css'

import { defineFeature } from '../../shell/manifests.ts'
import { SeasonBanner } from './Banner.tsx'
import { SeasonOverlay } from './Overlay.tsx'

export default defineFeature({
  id: 'season',
  routes: [
    {
      path: '/hall-of-fame',
      title: 'Hall of Fame',
      page: () => import('./HallOfFame.tsx'),
    },
  ],
  slots: {
    banner: [{ id: 'season.banner', order: 10, component: SeasonBanner }],
    overlay: [{ id: 'season.overlay', order: 20, component: SeasonOverlay }],
  },
})
