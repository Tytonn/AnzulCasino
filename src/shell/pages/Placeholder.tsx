/**
 * Where a room or page will be, until its lane's manifest arrives (spec:
 * Shell: "a placeholder page for every room and feature").
 */
import { Link } from 'react-router'

import type { Icon } from '../../kit/icons.tsx'
import { useTitle } from '../title.ts'

export function Placeholder({
  title,
  pitch,
  lane,
  icon: Glyph,
}: {
  title: string
  pitch: string
  lane: string
  icon?: Icon
}) {
  useTitle(title)
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 grid size-20 place-items-center rounded-lg border border-border bg-surface-2 text-accent">
          {Glyph && <Glyph className="size-10" />}
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-muted">{pitch}</p>
        <p className="mt-6 inline-block rounded-full border border-border px-3 py-1 text-xs text-faint">
          Opening soon · built by the {lane} lane
        </p>
        <div className="mt-6">
          <Link to="/" className="text-sm text-accent hover:underline">
            Back to the Floor
          </Link>
        </div>
      </div>
    </div>
  )
}

export function NotFound() {
  useTitle('Not found')
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">Nothing here</h1>
        <p className="mt-2 text-muted">That page does not exist. The tables are this way.</p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong"
        >
          Go to the Floor
        </Link>
      </div>
    </div>
  )
}

export function AdminOnly() {
  useTitle('Admins only')
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">Admins only</h1>
        <p className="mt-2 text-muted">This page is for the people who run the casino.</p>
        <Link to="/" className="mt-6 inline-block text-sm text-accent hover:underline">
          Back to the Floor
        </Link>
      </div>
    </div>
  )
}
