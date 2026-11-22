/**
 * The app: the router, the query cache and the toasts. The stream is the
 * home page, and pages open over it; the classic Floor (/classic) and rooms
 * keep their own layout until every game has its card. Pages and rooms from
 * manifests are found by the registry; the shell holds a placeholder for
 * every planned one until its lane lands.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { type ComponentType, lazy, useEffect } from 'react'
import { createBrowserRouter, Navigate, type RouteObject, RouterProvider } from 'react-router'

import { ApiError, onSignedOut } from '../kit/api.ts'
import { queryKeys, useMe } from '../kit/queries.ts'
import { Toaster } from '../kit/toast.tsx'
import { Shell } from './layout/Shell.tsx'
import { LoginPage, ResetPage, SignupPage } from './pages/Auth.tsx'
import { FloorPage } from './pages/Floor.tsx'
import { AdminOnly, NotFound, Placeholder } from './pages/Placeholder.tsx'
import { RoomPage } from './pages/Room.tsx'
import { SetupPage } from './pages/Setup.tsx'
import { games, type PageEntry, pages } from './registry.ts'
import { SignedIn } from './SignedIn.tsx'
import { StreamHome, StreamShell } from './stream/StreamShell.tsx'
import { useTitle } from './title.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events keep shared data fresh, and nothing polls (the database
      // sleeps when nobody plays).
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status > 0 && error.status < 500),
    },
  },
})

function FeaturePage({ entry, page: Page }: { entry: PageEntry; page: ComponentType }) {
  const me = useMe()
  useTitle(entry.title)
  if (entry.adminOnly && me.role !== 'admin') return <AdminOnly />
  return <Page />
}

function pageRoute(entry: PageEntry): RouteObject {
  const path = entry.path.replace(/^\//, '')
  // A lane's page loads the first time it is opened.
  if (entry.route)
    return { path, element: <FeaturePage entry={entry} page={lazy(entry.route.page)} /> }
  const planned = entry.planned
  return {
    path,
    element: (
      <Placeholder
        title={entry.title}
        pitch={planned?.pitch ?? ''}
        lane={planned?.lane ?? 'a'}
        icon={planned?.icon}
      />
    ),
  }
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/reset', element: <ResetPage /> },
  {
    element: <SignedIn />,
    children: [
      // The stream is home; every page opens over it (spec: The stream).
      {
        element: <StreamShell />,
        children: [
          { index: true, element: <StreamHome /> },
          { path: 'setup', element: <SetupPage /> },
          ...pages.map(pageRoute),
          { path: '*', element: <NotFound /> },
        ],
      },
      // The classic Floor and rooms, until every game has its card.
      {
        element: <Shell />,
        children: [
          { path: 'classic', element: <FloorPage /> },
          ...games.map((game) => ({
            path: `room/${game.id}`,
            // Each room loads the first time someone walks in. A game built
            // after the stream has no room: it plays in the stream.
            element:
              game.manifest && !game.manifest.room ? (
                <Navigate to="/" replace />
              ) : (
                <RoomPage
                  game={game}
                  room={game.manifest?.room ? lazy(game.manifest.room) : null}
                />
              ),
          })),
        ],
      },
    ],
  },
])

export function App() {
  // A session that ends anywhere sends the player to the login page.
  useEffect(
    () =>
      onSignedOut(() => {
        queryClient.setQueryData(queryKeys.me, null)
      }),
    [],
  )
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  )
}
