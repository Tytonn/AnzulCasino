# Foundation (Stage 1)

Branch `foundation`. Last updated 2026-11-18 by the Foundation thread (deliverable 8 pushed).

## What already exists

- **GitHub repo** `Tytonn/AnzulCasino`: empty. No commits and no branches, so there is no `main` to branch from.
- **Tyton's local folder** `C:\Users\techn\Downloads\anzulcasino`: empty.
- **Netlify**: not visible from the build container. Its network blocks `app.netlify.com` and `api.netlify.com`, and there is no Netlify token. Tyton created the project `playanzul` from this repo on 2026-11-18 and locked auto publishing.

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
- **`npm run dev` answers `/api/*` in-process** (`scripts/dev/dev-api.ts`), calling the same function handlers Netlify runs, loaded through Vite so edits apply on the next request. Netlify's own local emulation rebuilt and cold-started a function for every request, about 3 seconds each. `NETLIFY_FUNCTIONS=emulate npm run dev` brings the emulation back. Previews and production always run the real Netlify runtime.

## Cost guardrails

Netlify bills the database about 10 credits for every hour it is awake. It sleeps after 5 idle minutes, and on Personal that timer cannot change. So the code keeps the database asleep unless a player is doing something:

- No browser polling. Live news comes from Ably, which never touches the database.
- No timer touches the database more than once a day. Hourly net-worth snapshots are written lazily, when a player's chips move.
- A tab hidden for a few minutes closes its live connection, so idle tabs do not renew tokens. It reconnects and refetches on return.
- Heavy and repeated tests run locally. Previews get the checks the spec asks for.

## Needs from Tyton

1. ~~Permission for one starter commit on `main`.~~ Approved 2026-11-18.
2. ~~**Netlify project.**~~ Done 2026-11-18: `playanzul`, auto publishing locked. The steps were:
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

None for Tyton right now. Answered on 2026-11-18:

- **Rounding at the 100-chip scale:** chips are tracked in whole hundredths (`shared/chips.ts`), cents shown only when an amount is not whole. Bets may have cents, so "all" is all.
- **Credits on Personal:** keep the database asleep when nobody plays and keep merges batched. Tyton decides on auto-recharge.

## Done

- Saved the spec to `docs/SPEC.md` and added Tyton's additions from 2026-11-18: typed bets, roulette quick-bet box, chips in hundredths, the 1/100 rebalance, Ranks, Shop, Giveaways, the simulation report, and the Crash lane split.
- Installed Netlify's agent skills into `.claude/skills/`. Read the current Netlify Database, Functions, billing and Ably docs.
- **1. Repo setup.** TypeScript strict, ESLint, Prettier, the theme-token check, Vitest (unit and integration projects), Playwright at 1440px and 375px, the GitHub Action, `netlify.toml`, `CLAUDE.md`, a local Postgres setup script.
- **2. Database.** All 19 tables in `db/schema/core.ts`, one migration `20261118055222_core_init`. The deploy preview built and applied it.
- **3. Accounts.** Invite signup, admin bootstrap (once, under an advisory lock), login with throttling (5 failures per username per 15 minutes), logout, reset codes, profile edits, sessions (sha256 of a random token, 30 days, extended at most hourly), the session check and per-player rate limit on every route in one query.
- **4. Wallet and ledger.** `server/lib/wallet.ts` (`debit`, `credit`, `transfer`, `moveBetweenAccounts`, `lockWallets`, `ledgerMismatches`) and `server/lib/idempotency.ts` (`chipTransaction`). Tests prove 50 parallel bets cannot overdraw, parallel "all" bets take the wallet once, a repeated key changes nothing (also when sent 10 times at once), transfers in every direction never deadlock, and every balance equals its ledger sum. Removing the row lock or the lock order makes those tests fail.
- **5. Config.** `shared/config.ts` (every tunable number, unit, limits, description) and `server/lib/config.ts` (`loadConfig`, `changeConfig`, `pendingConfigChanges`), `GET /api/config`, and `shared/game-day.ts` (4:00 AM Central on the wall clock, tested across both daylight saving changes).
- **6. Season basics.** `server/lib/seasons.ts`: create (no overlaps), lazy start with starting balances, late joiners, `requireBetsOpen` by database time, `standings`. `GET /api/season`, `GET /api/leaderboard`, `GET`/`POST /api/seasons` (admin). `npm run db:seed:local` and the browser tests use the same sample data.
- **7. Live layer.** `shared/events.ts` types every event (lanes add theirs by extending the maps from their own files). `server/lib/live.ts` publishes after the commit to Ably, the local relay or nowhere, never failing a request, with a channel prefix per deploy. `GET /api/live/token` gives a token that can only listen, share presence on `presence`, and hear the player's own channel. A season start, a new season and a late joiner are announced, and `/api/season` and `/api/leaderboard` carry the same versions as the events. In the browser, `src/live/` has the client (each event once, resync on connect, on a lost resume and after a hidden tab, one online entry per player, recovery with a fresh token), the local and Ably transports (Ably loads only when used), and the hooks (`useLiveEvent`, `useResync`, `useOnlinePlayers`, `usePresenceRoom`, `usePlaying`, `useAwayAfter`, `useLiveStatus`). A browser test with two players proves presence, room changes, server news and leaving on the local relay. The Ably path waits for the preview and `ABLY_API_KEY`.
- **8. Shell.** Desktop (1440), tablet (768 to 1100, the sidebar behind a button) and phone (375, a tab bar with chat and the leaderboard as sheets) layouts on the `midnight` tokens: the left rail with who is in each room, the top bar (animated wallet and vault, a widget slot, the season clock, sound, the account menu), the ticker, and the sidebar with the live leaderboard (rows slide and show arrows when ranks change), who is online and where, and chat. The Floor has a card per room with who is inside and the last win. Rooms and pages that lanes have not built show a placeholder naming the lane. Sign-in, signup and reset pages, and a small admin setup page for invite codes, reset codes and seasons until the admin lane's panel lands. Server: `GET`/`POST /api/chat`, `DELETE /api/chat/:id` (admin), `GET /api/players`, `GET /api/ticker`, and `server/lib/chat.ts` (`systemPost`, `insertChatMessage`) for lanes. The shared UI kit is in `src/kit/` (API client with retries for keyed requests, toasts, avatars, player names with tier colors and badges, animated numbers, the server clock offset, sound settings, query hooks). Browser tests at 1440 and 375: two players see each other online and in which room, open each other's cards, chat both ways with mentions, and drop out of the list when a tab closes; logging in returns to the page asked for; the Floor, a room and setup render at both sizes.

## Not done

Deliverables 9 to 11 and the exit check.

## Decisions

- Recorded in `docs/progress/coordinator.md` (starting chips 100, 1/100 rebalance, Crash lane split, Personal plan, the spec additions).
- Ably v3 over v2, because the current docs document v3.
- All previews and production share one Ably app. Channel names carry a prefix per deploy, so testing a preview never shows up on the live site.
- **Idempotency keys** travel in the `Idempotency-Key` header. A route that moves chips declares `idempotent: true` and runs its work in `chipTransaction()`, which claims the key with the transaction's first statement. A request that failed leaves its key free, because nothing happened.
- **Every share in config is in basis points** (100 is 1%), so 1.5% and 0.3% need no decimals. The key names stay as the spec wrote them (`steal_base_rate`, `max_bet_pct`).
- **The config table holds only the admin's changes**, never the defaults, so a better default in `shared/config.ts` applies everywhere the admin has not overridden it. Rows are never edited, so the table is also the change history.
- **The game day's reset (4 AM Central) is a constant, not config**: changing it mid-season would move every daily limit.
- **Season status vs phase.** The stored `status` records what was done (`scheduled` until starting balances are paid, then `active`; the economy lane adds `final_day` and `ended`). The phase (`upcoming`, `open`, `final_day`, `over`) comes from the clock, so it is exact without timers.
- **A season starts on the first request after its start time**, so no scheduled function wakes the database.
- **Disabled players** get no wallet at a season start and are left off the leaderboard. If re-enabled, they join like a late joiner.
- **`erasableSyntaxOnly`** is on, so Node runs any file directly. The heist lane's simulation can import `shared/config.ts`.
- **Work, slut and crime cooldowns live on the wallet row** (`work_ready_at`, `hustle_ready_at`, `crime_ready_at`; the third command is `hustle` in code): the press locks that row anyway to pay out, so the check and the new time are atomic with no second lock. They store when the button is ready again, so a config change never moves a countdown already running.
- **Flavor lines and the third button's name are config values**, of two new kinds: `lines` (a list of plain-text lines, at most 100 of 120 characters) and `text` (one name of up to 20 characters). They take effect at once, since they cannot change an outcome. The admin lane's config editor covers them, and no table is shared between the economy and admin lanes.
- **Ranges are guarded**: `CONFIG_PAIRS` lists every `_min`/`_max` pair, and `changeConfig` refuses a minimum above its maximum, so game code can draw from a range without checking it.
- **The rebuy is gone** (Tyton, Nov 18): its config keys and ledger reason are removed, and migration `20261118065153_core_work_crime` drops `daily_state.rebuy_claimed` (always false; production has no tables yet).
- **Manifests and slots.** Games declare `src/games/<id>/manifest.ts` (`defineGame`), features `src/features/<name>/manifest.ts` (`defineFeature`). Vite finds them with `import.meta.glob`, so adding a lane never edits the shell. Feature slots: `top-bar` (every room, desktop and phone, for the work, slut and crime buttons), `profile-actions`, `profile-sections`, `chat-composer` (the GIF picker), `chat-message`, `banner`, `overlay` and `shop-items`. A lane can add its own slot by extending `SlotProps`. A slot component that throws is hidden, not the page.
- **Every spec room and page exists from day one** (`src/shell/planned.ts`), with its icon and a placeholder naming the lane, so links and the rail are complete. A manifest with the same id or path replaces the placeholder.
- **Rounds carry a `summary` line and a `big_bet` flag** (migration `20261118072308_core_round_summary`), written at settle, so the ticker and History need no per-game code to describe a round.
- **Chat deletes are soft** (`deleted_at`), so the audit log can point at the message; the body never goes into the audit row. The list leaves deleted messages out. Chat is limited by the route (60 a minute) and by `chat_burst_count` per `chat_burst_seconds` (5 per 10 seconds).
- **The browser's leaderboard stays current from `standing.changed` events** without refetching: it re-sorts locally, keeps players the server ranked level (everyone at the season start) level until one of them moves, and refetches only for a player it does not know. Gold is for a sole leader.
- **Logging out reloads the page** on `/login`, so nothing of the player stays in memory on a shared device (caches, the live connection, every store). If the server cannot be reached, the player is told and stays signed in, because the session cookie would still be there.

## Shared changes for lanes to know

- Adding a config key or a ledger reason is a shared change: list it under "Shared changes needed" in the lane's pull request.
