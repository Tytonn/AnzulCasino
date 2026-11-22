/**
 * The admin lane's manifest (spec: Manifests, Admin panel, Audit page): the
 * admin panel at /admin, the public Audit page at /audit, and the overlay
 * that keeps both live. The rail's Admin and Audit links are the shell's
 * planned ones (src/shell/planned.ts). The server side is in
 * server/features/admin/, behind /api/admin/*.
 */
import { defineFeature } from '../../shell/manifests.ts'
import { AdminLive } from './Live.tsx'

export default defineFeature({
  id: 'admin',
  routes: [
    {
      path: '/admin',
      title: 'Admin',
      page: () => import('./AdminPage.tsx'),
      adminOnly: true,
    },
    {
      path: '/audit',
      title: 'Audit log',
      page: () => import('./AuditPage.tsx'),
    },
  ],
  slots: {
    overlay: [{ id: 'admin.live', order: 50, component: AdminLive }],
  },
})
