# Foundation (Stage 1)

Branch `foundation`. Last updated 2026-11-18 by the Foundation thread.

## What already exists

- **GitHub repo** `Tytonn/AnzulCasino`: empty. No commits and no branches, so there is no `main` to branch from.
- **Tyton's local folder** `C:\Users\techn\Downloads\anzulcasino`: empty.
- **Netlify**: not visible from the build container. Its network blocks `app.netlify.com` and `api.netlify.com`, and there is no Netlify token. Whether a Netlify project exists, and what it is linked to, is a question for Tyton.

So nothing needs keeping or changing. Stage 1 starts from an empty repo.

## Stack

Versions checked on npm on 2026-11-18. Netlify and Ably facts come from their current docs and Netlify's agent skills, which are installed in `.claude/skills/` so every thread loads them.

| Job | Choice | Note |
| --- | --- | --- |
| Language | TypeScript 6.0, strict | 7.0 is out, but `typescript-eslint` supports only up to 6.0 |
| Frontend | React 19, Vite 8, React Router 8, TanStack Query 5, Zustand 5, Tailwind 4, Motion | As the spec says |
| API | Netlify Functions (modern `Request`/`Response` handlers) under `/api/*`, Zod 4 on every input | |
| Database | Netlify Database with Drizzle ORM and Drizzle Kit **1.0 beta** | The Netlify skill requires the beta: the stable release lacks the `netlify-db` adapter |
| Live | **Ably SDK v3**: `@ably/pubsub-server` in functions, `@ably/pubsub-device` in the browser | The Ably docs now document v3 (released Oct 29, 2026), which split the old `ably` package in two. It sits behind the wrappers, so switching back to v2 is a one-file change on each side |
| Tests | Vitest 5, Playwright | |
| Lint and format | ESLint 10 with typescript-eslint, Prettier | |
| Node | 24 on Netlify, CI and functions | |

## Changes to the spec's folder map

- **Migrations go in `netlify/database/migrations/`, not `db/migrations/`.** Netlify only applies migrations automatically from that folder. Lane migrations are named `<timestamp>_<lane>_<slug>`, because Netlify requires a `<number>_<slug>` name.
- **Netlify rejects a migration whose number is lower than one already applied.** A lane that adds a migration must regenerate it with a fresh timestamp just before its merge. The foundation creates every table in the Data model, so most lanes need none.
- **Foundation endpoints are `netlify/functions/core-*.ts`**, and the reference game is `coinflip-*.ts`, so no foundation file uses a lane's name (`season` belongs to the economy lane, `admin` to the admin lane).
- **The bet amount parser lives in `shared/`**, not only in `src/kit/`, so the server resolves "all" and "half" against the locked wallet. The kit re-exports it.

## Order of work

Each step ends with typecheck, lint and tests, then a look at the deploy preview at desktop (1440px) and phone (375px) widths with screenshots, before the next step starts.

1. **Repo setup.** TypeScript strict, ESLint, Prettier, Vitest, Playwright, GitHub Action (typecheck, lint, unit, integration and browser tests on every pull request), `netlify.toml`, the folder map, `CLAUDE.md` with the Rules every thread follows.
2. **Database.** Every table in the Data model in `db/schema/core.ts`, generated migrations, the partial unique index for one open round per player per game.
3. **Accounts.** Signup with invite code, login, logout, sessions (hashed token, 30 days, sliding), login throttling, admin bootstrap, a session check on every endpoint.
4. **Wallet and ledger.** `debit`, `credit`, `transfer` with row locks and idempotency keys. Tests: 50 parallel bets cannot overdraw, a replayed key changes nothing, balance equals the ledger sum.
5. **Config.** Typed helper, one defaults file (the 1/100 values in `coordinator.md`), seed data.
6. **Season basics.** Create a season, find the active one, give starting balances (late joiners too), refuse bets at or after the end time using database time.
7. **Live layer.** `server/lib/live.ts` and `src/live/`, `/api/live/token`, presence, typed events in `shared/events.ts`, publish after commit, reconnect and refetch.
8. **Shell.** Desktop and phone layouts, theme tokens (`midnight`), top bar with animated wallet, sidebar with live leaderboard, online list, basic chat, ticker, the Floor, routing, placeholder pages for every room and feature.
9. **Game kit.** Typed bet box (Tyton's addition), seat, room layout, chip stack, animated number, win celebration, sound manager, `useRoom(game)`, server random helpers, and the server round helper (start, action, settle with wallet, ledger, idempotency and publishing).
10. **Reference game.** Coin flip, end to end on the kit.
11. **Lane guide.** `docs/LANE_GUIDE.md`, using the coin flip as the worked example.

Then the exit check on the deploy preview: two browsers as different players see each other online, chat, play coin flip, and watch each other's seats and the leaderboard update live. All tests pass.

## How I test

- **Locally in the container:** a real Postgres 16 for integration tests. The embedded database that Netlify's dev tools use (PGlite) runs one query at a time, so it cannot prove that locking stops double spends. Endpoints are tested by calling the function handlers directly.
- **A small local live relay** stands in for Ably in local dev and CI, behind the same wrapper, so two-browser tests run without an Ably key. The real Ably path is tested on the deploy preview.
- **On the deploy preview:** Playwright with two separate browser sessions, screenshots at 1440px and 375px.

## Cost guardrails

Netlify bills the database about 10 credits for every hour it is awake. It sleeps after 5 idle minutes, and on Personal that timer cannot change. So the code keeps the database asleep unless a player is doing something:

- No browser polling. Live news comes from Ably, which never touches the database.
- No timer touches the database more than once a day. Hourly net-worth snapshots are written lazily, when a player's chips move.
- A tab hidden for a few minutes closes its live connection, so idle tabs do not renew tokens. It reconnects and refetches on return.
- Heavy and repeated tests run locally. Previews get the checks the spec asks for.

## Needs from Tyton

1. **Permission for one starter commit on `main`** (a README), so `foundation` has a base and a pull request can open. Asked on a decision card.
2. **Netlify project.** If one already exists, tell me its name and which repo it is linked to. If not, once `main` exists:
   1. app.netlify.com > **Add new project** > **Import an existing project** > **GitHub** > `Tytonn/AnzulCasino`.
   2. Branch to deploy: `main`. Leave the build settings empty; `netlify.toml` sets them.
   3. Keep Deploy Previews on for pull requests (the default).
   4. The database provisions itself on the first deploy that includes `@netlify/database`. Nothing to click.
3. **Ably key** (needed at step 7):
   1. Sign up at ably.com (free package), create an app named `AnzulCasino`.
   2. In the app's **API Keys** tab, copy the **Root** key.
   3. In Netlify: **Project configuration** > **Environment variables** > **Add a variable** > `ABLY_API_KEY`, paste the key, tick **Contains secret values**, scope **Functions**, same value for all deploy contexts.
4. **Admin bootstrap code** (needed at step 3): in the same place, add `ADMIN_BOOTSTRAP_CODE`, secret, scope Functions. Choose **Different value for each deploy context**: a long private phrase for Production, and a separate throwaway phrase for Deploy Previews that you send me, so I can create the first admin on the preview.
5. **Network access for this build container** (needed when I first open a preview): I will ask with an approval card for the Ably hosts and the preview's hostname.

## Open questions

### Rounding at the 100-chip scale

The spec says payouts round down to a whole chip. With stakes of 1 to 20 chips, that rounding eats most of the edge math:

- A 1-chip bet can never profit at any multiplier under 2x. A crash cash-out at 1.9x or a mines cash-out at 1.1x pays back exactly 1.
- Plinko's 0.5x and 0.3x buckets pay 0 on a 1-chip ball, so the real return on small balls is far below the 98% the test checks.
- Blackjack's 3:2 on a 5-chip bet pays 7 instead of 7.5.
- Slots cannot split a bet under 10 chips across ten paylines.
- Steals at 0.5% to 4% of a 60-chip wallet take 0 to 2 chips. The 5% fine on a 15-chip wallet is 0.
- A coin flip paying 1.96x pays 1 on a 1-chip bet.

**Recommendation:** count chips to two decimal places, stored as whole hundredths (still integers, still no floats). Bets stay whole chips; payouts and steals keep their cents, shown as `107.50`. The alternative is whole chips with game minimums around 10 chips, which is 10% of a starting stack.

The code keeps the chip unit in one constant (`shared/chips.ts`), so either answer is a small change. I will build with whole chips, as the spec says, until this is decided.

### Netlify credits on Personal

- A live season will likely need more than 1,000 credits a month. If friends are on and off through about 6 hours of each day, the database alone is about 60 credits a day, or 1,800 a month. Functions add a few credits a day.
- The build itself uses credits too. Preview deploys are free, but their functions and database branches bill while anyone tests them, and four lanes testing at once is about 40 credits an hour.
- **When the balance reaches 0, Netlify pauses every site on the account.** A safety net: turn on auto-recharge (500 credits for $5 on Personal) or watch **Usage** weekly. Pro is not needed for the features; it only adds credits and a longer database sleep timer.

## Done

- Saved the spec to `docs/SPEC.md` and added Tyton's two additions (typed bets, roulette quick-bet box).
- Installed Netlify's agent skills into `.claude/skills/`.
- Read the current Netlify Database, Functions, billing and Ably docs.
- Started `docs/progress/coordinator.md`.

## Not done

Everything in the order of work above.

## Decisions

- Recorded in `docs/progress/coordinator.md` (starting chips 100, 1/100 rebalance, Crash lane split, Personal plan, the two spec additions).
- Ably v3 over v2, because the current docs document v3.
- All previews and production share one Ably app. Channel names carry a prefix per deploy, so testing a preview never shows up on the live site.
