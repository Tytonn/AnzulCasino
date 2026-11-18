/**
 * Logging in, signing up with an invite code, and setting a new password
 * with a reset code from an admin (spec: Accounts). The server checks
 * everything; the forms only help.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'

import type { Me } from '../../../shared/accounts.ts'
import { USERNAME_PATTERN } from '../../../shared/accounts.ts'
import { api, errorMessage } from '../../kit/api.ts'
import { queryKeys, useSession } from '../../kit/queries.ts'
import { Logo } from '../Logo.tsx'
import { useTitle } from '../title.ts'

function safeNext(next: string | null): string {
  // Only paths on this site, never another address.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function AuthLayout({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
}) {
  useTitle(title)
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accent) 55%, transparent), transparent 65%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="text-sm text-muted">The casino for the Anzul crew.</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-1 p-6 shadow-card">
          <h1 className="mb-5 text-xl font-semibold">{title}</h1>
          {children}
        </div>
        <div className="mt-5 text-center text-sm text-muted">{footer}</div>
      </div>
    </main>
  )
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  hint,
  value,
  onChange,
}: {
  label: string
  name: string
  type?: string
  autoComplete: string
  hint?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 w-full rounded-md border border-border bg-surface-2 px-3 text-text placeholder:text-faint focus:border-accent focus:outline-none"
      />
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

function useSignIn(path: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent, body: Record<string, string>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.post<{ user: Me }>(path, body)
      // A new player: start from clean caches.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.me[0] })
      queryClient.setQueryData(queryKeys.me, user)
      void navigate(safeNext(params.get('next')), { replace: true })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return { submit, busy, error }
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-2 h-11 w-full rounded-md bg-accent font-semibold text-on-accent transition hover:bg-accent-strong active:scale-[0.98] disabled:opacity-60"
    >
      {busy ? 'One moment…' : children}
    </button>
  )
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p
      role="alert"
      className="rounded-sm border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-text"
    >
      {error}
    </p>
  )
}

/** Already signed in: go to the site. */
function useSignedInRedirect() {
  const session = useSession()
  const [params] = useSearchParams()
  return session.data ? <Navigate to={safeNext(params.get('next'))} replace /> : null
}

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { submit, busy, error } = useSignIn('/api/auth/login')
  const redirect = useSignedInRedirect()
  if (redirect) return redirect
  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          New here?{' '}
          <Link className="text-text underline" to="/signup">
            Sign up with an invite code
          </Link>
          <br />
          <Link className="mt-2 inline-block text-faint hover:text-muted" to="/reset">
            Forgot your password?
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e, { username, password })}>
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={setUsername}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <ErrorNote error={error} />
        <Submit busy={busy}>Log in</Submit>
      </form>
    </AuthLayout>
  )
}

export function SignupPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const { submit, busy, error } = useSignIn('/api/auth/signup')
  const redirect = useSignedInRedirect()
  if (redirect) return redirect
  const badName = username.length > 0 && !USERNAME_PATTERN.test(username.trim())
  return (
    <AuthLayout
      title="Sign up"
      footer={
        <>
          Have an account?{' '}
          <Link className="text-text underline" to="/login">
            Log in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => void submit(e, { username, password, inviteCode })}
      >
        <Field
          label="Invite code"
          name="inviteCode"
          autoComplete="one-time-code"
          value={inviteCode}
          onChange={setInviteCode}
          hint="An admin gives you one. Each code works once."
        />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={setUsername}
          hint={
            badName
              ? 'Use 3 to 16 letters, digits or underscores.'
              : 'Others see it in chat. 3 to 16 letters, digits or underscores.'
          }
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint="At least 8 characters."
        />
        <ErrorNote error={error} />
        <Submit busy={busy}>Create my account</Submit>
      </form>
    </AuthLayout>
  )
}

export function ResetPage() {
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const { submit, busy, error } = useSignIn('/api/auth/reset')
  const redirect = useSignedInRedirect()
  if (redirect) return redirect
  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <>
          Remembered it?{' '}
          <Link className="text-text underline" to="/login">
            Log in
          </Link>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        There is no email here. Ask an admin for a reset code, then enter it below.
      </p>
      <form className="space-y-4" onSubmit={(e) => void submit(e, { username, code, password })}>
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={setUsername}
        />
        <Field
          label="Reset code"
          name="code"
          autoComplete="one-time-code"
          value={code}
          onChange={setCode}
        />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint="At least 8 characters."
        />
        <ErrorNote error={error} />
        <Submit busy={busy}>Save and log in</Submit>
      </form>
    </AuthLayout>
  )
}
