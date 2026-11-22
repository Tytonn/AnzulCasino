# Lane guide

How this repo fits together, and how to add a game or a feature without touching anyone else's code. The Foundation thread wrote it at the end of Stage 1, with the coin flip as the worked example.

Read `docs/SPEC.md` first, then this guide, then every file in `docs/progress/`. Where this guide and the spec's folder map (Build plan > Folder map) differ, this guide wins. For everything else the spec is the source of truth. If either is unclear or looks wrong, ask Tyton instead of guessing.

_(Nov 22, 2026: Tyton moved the site to one chat stream. Every game is now a card in the stream, started by a command typed in the message box, never a room. Read section 20 before you build a game. The classic Floor and rooms stay under `/classic` until every game has its card, so sections 6 to 8 still show a room beside the server code that stays the same.)_

## Contents

1. [Start here](#1-start-here)
2. [Workflow](#2-workflow)
3. [Folder map](#3-folder-map)
4. [What your lane owns](#4-what-your-lane-owns)
5. [The rules, and what enforces them](#5-the-rules-and-what-enforces-them)
6. [Adding a game: the coin flip, step by step](#6-adding-a-game-the-coin-flip-step-by-step)
7. [Rounds with more than one move](#7-rounds-with-more-than-one-move)
8. [One round for the whole table](#8-one-round-for-the-whole-table)
9. [Adding a feature](#9-adding-a-feature)
10. [The server toolkit](#10-the-server-toolkit)
11. [Live events](#11-live-events)
12. [Data and migrations](#12-data-and-migrations)
13. [The browser kit](#13-the-browser-kit)
14. [Look and feel](#14-look-and-feel)
15. [Testing](#15-testing)
16. [Keeping costs down](#16-keeping-costs-down)
17. [Environment variables](#17-environment-variables)
18. [Commands](#18-commands)
19. [Notes for each lane](#19-notes-for-each-lane)
20. [The stream: cards and commands](#20-the-stream-cards-and-commands)

## 1. Start here

```bash
npm ci
npm run db:setup:local   # once per machine: local Postgres, the casino role, the dev, test and browser-test databases, .env
npm run db:seed:local    # admin, alice, bob and carol (password password123) and a running season
npm run dev              # the site, the API and the local live relay on http://localhost:8888
```

- **Two players at once:** sign in as alice in a normal window and as bob in a private window. Each window keeps its own session cookie.
- **Live updates locally** go through a small relay that `npm run dev` starts, so you need no Ably key. Deploy previews use Ably.
- **The API runs in-process** in `npm run dev`: it calls the same function handlers Netlify runs, and an edit applies on the next request. If you suspect a difference from Netlify, `NETLIFY_FUNCTIONS=emulate npm run dev` runs Netlify's own emulation (about 3 seconds a request).
- **Start clean** with `npm run db:reset:local`. It rebuilds the dev database from the migrations and the sample data.

### The stack as built

The spec's stack, with the versions and the few choices the spec left open:

| Job | Choice |
| --- | --- |
| Language | TypeScript 6, strict, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` (no enums, namespaces or parameter properties). Imports name the file with its `.ts` or `.tsx` extension |
| Browser | React 19, Vite 8, React Router 8, TanStack Query 5, Zustand 5, Tailwind 4, Motion |
| API | Netlify Functions with modern `Request`/`Response` handlers, under `/api/*`. Zod 4 on every input |
| Database | Netlify Database (Postgres) with Drizzle ORM and Drizzle Kit 1.0 beta, which Netlify's adapter needs |
| Live | Ably SDK v3: `@ably/pubsub-server` in functions, `@ably/pubsub-device` in the browser, behind `server/lib/live.ts` and `src/live/` |
| Tests | Vitest 5 (unit and integration projects), Playwright (desktop 1440 and phone 375) |
| Lint | ESLint 10 with typescript-eslint and the React hooks rules, Prettier, and `scripts/check-tokens.ts` for raw colors |
| Node | 24 |

The React hooks lint rules are strict: no component created during render, and no `ref.current` read during render. If you need to put a component in context, put a render function there instead (see `src/kit/seat-extras.ts`).

## 2. Workflow

- **Branch.** Work on `lane/<lane>`, cut from `main`. Open a draft pull request early and push often. Never push to `main`. Only Tyton merges.
- **Checks.** Every push to your pull request runs the GitHub Action: typecheck, lint, unit and integration tests, then the browser tests. Run `npm run check` before you push.
- **Deploy previews.** Netlify builds a preview for every pull request. Each preview gets its own copy of the database, made from production when the preview is first created, so nothing you do there touches the live site. A preview deploy costs no credits. A production publish costs 15, and Tyton decides when they happen.
- **Testing on a preview.** Until launch, production holds no players, so a new preview starts empty. Its admin code (the Deploy Previews value of `ADMIN_BOOTSTRAP_CODE`; ask Tyton) makes one admin there, once. Run the browser tests against it:

  ```sh
  E2E_BASE_URL=https://deploy-preview-<number>--playanzul.netlify.app \
  E2E_PASSWORD='<a password you pick>' E2E_ADMIN_CODE='<the preview admin code>' \
  npm run test:e2e
  ```

  The first run signs up admin, alice, bob and carol with your password and starts a season (`tests/e2e-helpers/preview-setup.ts`), so your tests find what they find locally. Later runs need only `E2E_BASE_URL` and the same `E2E_PASSWORD`. In a cloud build container the tests go through its `HTTPS_PROXY` by themselves, and if the preview answers with Netlify's own login page, the project has been made private: tell Tyton. Netlify also adds its review drawer to every preview, over a phone's tab bar; `signIn` blocks it, so a context you make yourself calls `hideNetlifyDrawer(context)`. To look around by hand, sign in as `test` or `test2` with the password `test` (section 15, Test accounts), as one of the sample players, or make yourself an invite code at `/setup`. The sign-in limits allow about two full runs per 15 minutes on one preview, so in between run only your own tests (`npx playwright test tests/<name>`). If your build container cannot open the preview, tell Tyton which hosts were blocked.
- **Progress file.** Update `docs/progress/<lane>.md` at the end of every working session: done, not done, decisions, open questions, and shared changes needed.
- **Shared changes.** If you need a change outside your lane, do not make it. List it under a heading named "Shared changes needed" in your pull request and your progress file, with the exact change you want, work around it if you can, and tell Tyton. One thread makes the batch of shared changes on `main`, and the lanes pull.
- **Merging.** Tyton merges one lane at a time after checking its preview. After each merge, every open lane pulls `main` and reruns its tests. If `package-lock.json` conflicts, run `npm install` to regenerate it instead of editing it by hand.
- **Dependencies.** Avoid new ones. If one is essential, add it and say why in the pull request.

## 3. Folder map

```text
docs/
  SPEC.md, LANE_GUIDE.md                the spec and this guide
  progress/<lane>.md                     one per lane, plus coordinator.md
shared/                                  types and rules the browser and the server both use (Foundation)
  games/<game>.ts                        a game's ids, detail type, input schemas and payout math (that lane)
  features/<name>.ts                     a feature's types and input schemas (that lane)
db/schema/
  core.ts                                every table in the spec's Data model (Foundation)
  <lane>.ts                              a lane's own tables, named <lane>_* (that lane)
netlify/
  database/migrations/<ts>_<slug>/       every migration; Netlify applies them on deploy (see section 12)
  functions/core-api.ts                  the foundation's endpoints (Foundation)
  functions/<name>-api.ts                a lane's endpoints: a thin file that exports its API (that lane)
server/
  lib/                                   HTTP, auth, wallet and ledger, config, seasons, rng, live, chat, audit, the round helper (Foundation)
  core/                                  accounts, invites, players, chat endpoints (Foundation)
  games/<game>/rules.ts                  a game's pure rules (that lane)
  games/<game>/api.ts                    a game's routes (that lane)
  features/<name>/                       a feature's logic and routes (that lane)
src/
  shell/                                 layout, routing, manifests, slots, placeholders, the classic top bar and sidebar (Foundation)
  shell/stream/                          the stream, the message box, the pinned card, the panels and the shell's commands (Foundation)
  kit/                                   the game kit and the shared UI pieces (Foundation)
  live/                                  the live client (Foundation)
  theme/midnight.css                     the theme's tokens (Foundation)
  theme/games/<game>.css                 a game's own colors (that lane)
  theme/features/<name>.css              a feature's own colors (that lane)
  games/<game>/manifest.ts, StreamCard.tsx, commands.ts
                                         a game's manifest, its card, its commands and their parts, and its classic Room.tsx until rooms go (that lane)
  features/<name>/manifest.ts, ...       a feature's manifest, pages and slot components (that lane)
scripts/                                 local databases, the dev server, the token check (Foundation); simulate-season.ts (heist)
tests/
  helpers/, e2e-helpers/                 shared test helpers (Foundation)
  foundation/, coinflip/                 the foundation's tests
  <name>/unit|integration|e2e/           a lane's tests; <name>/screenshots/ is ignored by git
```

Changes from the spec's folder map:

- **Migrations live in `netlify/database/migrations/`**, not `db/migrations/`. Netlify applies only that folder.
- **A lane's shared types live in `shared/games/<game>.ts` or `shared/features/<name>.ts`.** Both sides import them, and the lane owns them. Top-level `shared/*.ts` stays the foundation's.
- **`server/games/<game>/` holds the routes too** (`api.ts`), next to the pure rules (`rules.ts`). `netlify/functions/<name>-api.ts` only exports the API and lists its paths.
- **The foundation's endpoints are `core-*`**, and its server code outside `lib/` is in `server/core/`, so no foundation file uses a lane's name.
- **Each game or feature can own a colors file** in `src/theme/games/` or `src/theme/features/` (see section 14).
- **Test helpers** live in `tests/helpers/` (integration) and `tests/e2e-helpers/` (browser).

## 4. What your lane owns

Your lane's row in the spec (Build plan > Stage 2) lists the names it owns. For each name, you own:

- `src/games/<name>/` or `src/features/<name>/`
- `server/games/<name>/` or `server/features/<name>/`
- `shared/games/<name>.ts` or `shared/features/<name>.ts`
- `src/theme/games/<name>.css` or `src/theme/features/<name>.css`
- `netlify/functions/<name>-*.ts`, and the API paths `/api/<name>/*`
- `db/schema/<lane>.ts`, tables named `<lane>_*`, and migrations named `<timestamp>_<lane>_<slug>`
- `tests/<name>/`
- `docs/progress/<lane>.md`

The heist lane also owns `scripts/simulate-season.ts`.

Everything else is read-only: import it, never edit it. That covers top-level `shared/*.ts`, `server/lib/`, `server/core/`, `src/shell/`, `src/kit/`, `src/live/`, `src/theme/midnight.css`, `src/index.css`, `db/schema/core.ts`, every migration you did not write, `tests/helpers/`, `tests/e2e-helpers/`, the config files at the root, `.github/`, `CLAUDE.md`, `docs/SPEC.md`, this guide, and other lanes' folders.

These are shared changes, so list them instead of making them:

- A config key (name, group, unit, default, limits, one-line description) or a ledger reason.
- A token in `src/theme/midnight.css`, such as a new shared color.
- A change to the kit, the shell, the live layer or a server library.
- A column on a core table.
- An API path outside `/api/<name>/*`.

The foundation's API paths are `/api/auth/*`, `/api/me`, `/api/time`, `/api/config`, `/api/season`, `/api/seasons`, `/api/leaderboard`, `/api/invites`, `/api/live/*`, `/api/players`, `/api/ticker` and `/api/chat`. Do not add routes under them.

## 5. The rules, and what enforces them

The rules in `CLAUDE.md` apply to every line. Most of them are built into the toolkit, so the safe way is also the short way:

| Rule | What does it for you | What you still do |
| --- | --- | --- |
| 1. The server decides | Zod input schemas, `z.strictObject` | Accept intents only (a bet, a call, hit). Never an outcome, a balance, a multiplier or a card |
| 2. Whole chips | `shared/chips.ts`: `CHIP`, `chips()`, `mulDiv()`, `basisPoints()`, `formatChips()` | Keep chip math in `bigint`. Round payouts, steals and fines down to a whole chip with `mulDiv` or `basisPoints`, and expect small ones to come to 0. Chips cross the wire as plain whole numbers |
| 3. One ledger row per change | `server/lib/wallet.ts`: `debit`, `credit`, `transfer`, `moveBetweenAccounts` write the row | Never update `wallets.balance` or `vault` yourself |
| 4. Lock before you spend | `debit` and `transfer` lock the wallet and check the balance; the round helper does it for rounds | Call `lockWallet` first when your check reads the wallet row (a cooldown, a balance) |
| 5. Idempotent | `idempotent: true` on the route, then `playTransaction` or `chipTransaction`; `usePlay` and `requestKey()` in the browser | One key per intent. A retry reuses the key |
| 6. `crypto` randomness | `server/lib/rng.ts` | Never `Math.random` (ESLint blocks it on the server) |
| 7. Draw late | `game_rounds.secret`, `shared_rounds.secret`, cleared at settle | Draw at the moment of the reveal. Keep anything drawn early in `secret`, never in `detail` |
| 8. Database time | `ctx.now`, `dbNow()`, `now()` in SQL; `serverNow()` in the browser | Compare deadlines in SQL. Browser countdowns are display only |
| 9. Config | `shared/config.ts`, `play.config`, `loadConfig()` | No magic numbers in game code. Ask for a key as a shared change |
| 10. Session, schema, rate limit; plain text | `createApi` and `route` | Use `auth: 'user'` or `'admin'`. Render names and chat as text, never with `dangerouslySetInnerHTML` |

## 6. Adding a game: the coin flip, step by step

The coin flip is the template. It uses each piece of the kit once. Copy its files and rename.

_(Nov 22, 2026: steps 1 to 4, 7 and 8 hold for every game. Steps 5 and 6 still build the classic room: build your game's card and command as section 20 shows instead. The coin flip's own card comes next after blackjack's, and this section then walks through it.)_

| Step | Coin flip's file | What it holds |
| --- | --- | --- |
| 1 | `shared/games/coinflip.ts` | The id, the detail type, the input schema, the payout math |
| 2 | `server/games/coinflip/rules.ts` | The pure rules, with server randomness |
| 3 | `server/games/coinflip/api.ts` | The routes: the room and the play |
| 4 | `netlify/functions/coinflip-api.ts` | The function: exports the API, lists its paths |
| 5 | `src/games/coinflip/manifest.ts` | How the shell finds the room |
| 6 | `src/games/coinflip/Room.tsx`, `Coin.tsx` | The room, built on the kit |
| 7 | `src/theme/games/coinflip.css` | The coin's colors |
| 8 | `tests/coinflip/{unit,integration,e2e}/` | Rules and return to player; endpoints; two real browsers |

### Step 1: what both sides share

```ts
// shared/games/coinflip.ts
export const COINFLIP = 'coinflip'
export const SIDES = ['heads', 'tails'] as const
export type Side = (typeof SIDES)[number]

/** POST /api/coinflip/play */
export const CoinflipPlayInput = z.strictObject({
  bet: BetText, // what the player typed: "50", "2.5k", "half", "all", "max"
  call: z.enum(SIDES, { error: 'Call heads or tails.' }),
})

/** The public detail: enough to draw the round and to replay it. */
export interface CoinflipDetail {
  call: Side
  face: Side | null // null only between the bet and the flip
  edgePct: number // the edge when the bet was placed
}

export function coinflipPayout(stake: bigint, won: boolean, edgePct: number): bigint {
  if (!won) return 0n
  return mulDiv(stake, BigInt(2 * (10_000 - edgePct)), 10_000n) // rounds down
}
```

- The bet travels as text, and the server resolves it against the locked wallet, so "all" is the balance at that moment. `BetText` (from `shared/rounds.ts`) checks only its length.
- `z.strictObject` refuses unknown fields, so a body that tries to send a face fails.
- Write error messages in plain words that say what to do. They reach the player as toasts.
- The payout math lives here so the room can show "Win pays 1.96x" from the same function the server pays with.

### Step 2: the rules

```ts
// server/games/coinflip/rules.ts
export function flip(): Side {
  return pick(SIDES) // server/lib/rng.ts, node:crypto underneath
}
```

Keep rules pure: inputs and the random helpers in, a result out, no database. That is what makes the return-to-player test possible.

### Step 3: the routes

```ts
// server/games/coinflip/api.ts
export const coinflip = defineServerGame({ id: COINFLIP, name: 'Coin flip' })

export const coinflipRoutes = [
  route({
    method: 'GET',
    path: '/api/coinflip/room',
    auth: 'user',
    run: () => roomState(coinflip), // each seated player's latest round
  }),
  route({
    method: 'POST',
    path: '/api/coinflip/play',
    auth: 'user',
    idempotent: true,
    input: CoinflipPlayInput,
    run: (ctx) =>
      playTransaction(ctx, coinflip, async (play) => {
        const { bet, call } = ctx.input
        const edgePct = play.config.coinflip_edge_pct // read once, saved with the round
        const round = await play.start<CoinflipDetail>({ bet, detail: { call, face: null, edgePct } })
        const face = flip() // draw late: after the stake is taken
        const settled = await play.settle(round, {
          payout: coinflipPayout(round.stake, face === call, edgePct),
          detail: { call, face, edgePct },
          summary: SIDE_NAMES[face], // one line for the ticker and History
        })
        return play.result(settled) // the round as everyone sees it, and the wallet
      }),
  }),
]

export const coinflipApi = createApi(coinflipRoutes)
```

`playTransaction` does the rest in one transaction: it finds the season, claims the idempotency key, refuses bets outside the season, locks the wallet, resolves and checks the bet against `min_bet` and `max_bet_pct`, writes the round and both ledger rows, flags big bets and all-ins, and after the commit publishes the room events, the ticker, the leaderboard, the player's wallet, and the chat post for a big win or loss. A repeated key returns the first answer and changes nothing.

### Step 4: the function

```ts
// netlify/functions/coinflip-api.ts
import type { Config } from '@netlify/functions'
import { coinflipApi } from '../../server/games/coinflip/api.ts'

export default coinflipApi
export const config: Config = { path: ['/api/coinflip/*'] }
```

One function per name keeps one warm instance answering all of a game's requests. `npm run dev` finds new files in `netlify/functions/` on its own.

### Step 5: the manifest

```ts
// src/games/coinflip/manifest.ts
import '../../theme/games/coinflip.css'

export default defineGame({
  id: 'coinflip', // the room /room/coinflip, the channel room:coinflip, the API /api/coinflip/*
  name: 'Coin flip',
  order: 90, // place on the rail and the Floor
  icon: CoinflipIcon,
  room: () => import('./Room.tsx'), // loads when a player walks in
  howToPlay: ['Call heads or tails, type a bet and flip. ...', '...'],
})
```

Every spec game already has a placeholder, an icon, an order and a one-line pitch in `src/shell/planned.ts`. A manifest with the same id takes the placeholder's place. Optional fields: `pitch` (to change the Floor's line), `cardArt` (art for the Floor card's top half) and `replay` (a lazy component that redraws a saved round from its detail, for History and the ticker).

### Step 6: the room

```tsx
// src/games/coinflip/Room.tsx (trimmed)
export default function CoinflipRoom() {
  const reduced = useReducedMotion()
  const revealMs = reduced ? 150 : 600
  const room = useRoom<CoinflipDetail>(COINFLIP, { revealMs })
  const play = usePlay<CoinflipDetail>()
  const { data: config } = useConfig()
  const edge = config?.coinflip_edge_pct ?? 200
  const [call, setCall] = useState<Side>('heads')
  const coin = useRef<CoinHandle>(null)

  useShortcuts({ h: () => setCall('heads'), t: () => setCall('tails') })

  async function flip(bet: string) {
    coin.current?.toss() // something moves within 100ms
    playSound('flip')
    const result = await play.send('/api/coinflip/play', { bet, call }, { revealMs })
    const face = result?.round.detail.face
    if (!result || !face) return coin.current?.rest(room.mine?.detail.face ?? 'heads')
    coin.current?.land(face, revealMs, () => reveal(result.round)) // then celebrate or play 'loss'
  }

  return (
    <RoomLayout
      game={manifest}
      room={room}
      info={`Win pays ${formatMultiplier(winMultiplier(edge))} · ${formatShare(edge)} house edge`}
      seat={(seat) => <MiniCoin round={seat.round} />} // drawn on each other player's seat
      table={<Coin ref={coin} initialFace={room.mine?.detail.face ?? 'heads'} />} // your seat
      controls={
        <BetBox game={COINFLIP} label="Flip" busy={play.busy} onBet={(bet) => void flip(bet)}>
          {/* Heads [H] and Tails [T] as pressed buttons */}
        </BetBox>
      }
    />
  )
}
```

- **`useRoom(game, { revealMs })`** loads `GET /api/<game>/room` and keeps it current from `room:<game>` events. It gives `seats` (you first), `mine` (your latest round) and `open` (your open round, to resume after a refresh). Another player's result shows on their seat `revealMs` after it settled, so their seat spins while yours does.
- **`usePlay().send(path, body, { revealMs })`** sends one move at a time with a fresh idempotency key, answers at once from the response, and holds every piece of news that would give the result away (your seat, the top bar, the leaderboard, the ticker, the chat post) until the reveal ends. Errors become toasts, and it returns null. The path must start with `/api/<game>/`.
- **`RoomLayout`** draws the header with the how-to-play card (opened with `?`), the other players' seats, your seat with your table inside it, and the controls, which stay in thumb reach on a phone.
- **`BetBox`** is the typed bet box every game uses. It reads 50, 2.5k, half, all and max, shows mistakes as you type, remembers the last bet per game, and owns Enter, Space and M. After each round the cursor returns to the box on desktop.
- **The reveal** runs up to 600ms (`--speed-reveal`), 150ms under reduced motion. A new bet while the coin is landing finishes the landing at once, so a fast player never waits.

### Step 7: colors

The coin's silver is not a shared token, so it lives in the game's own file:

```css
/* src/theme/games/coinflip.css */
:root {
  --coin: #c9cfdb;
  --coin-shine: #f4f6fa;
  --coin-edge: #7d8597;
  --coin-ink: #3a4152;
}
```

### Step 8: tests

- **Unit** (`tests/coinflip/unit/rules.test.ts`): payouts and rounding, the multiplier shown, the exact return at every edge, a million real flips returning 98% within half a percent, and the input schema's messages.
- **Integration** (`tests/coinflip/integration/coinflip.test.ts`): both outcomes pay right and the ledger matches; the room, the ticker and one wallet update are published, with no `secret` anywhere; a replayed key changes nothing; 16 parallel "all" bets never overdraw; bad input is refused in plain words; no session or no key is refused; an all-in reaches chat; the room state; and the edge setting.
- **Browser** (`tests/coinflip/e2e/coinflip.spec.ts`): alice and bob sit at the table, flip (by keyboard on desktop, by taps on the phone), and watch each other's seats, the ticker and the leaderboard update, at 1440 and 375, with screenshots.

Section 15 lists what every game's tests must cover.

## 7. Rounds with more than one move

Blackjack, mines and russian roulette keep a round open across several requests. The round helper covers it:

```ts
// The first request: bet and deal.
playTransaction(ctx, blackjack, async (play) => {
  const round = await play.start<HandDetail, HandSecret>({ bet: ctx.input.bet, detail, secret })
  return play.result(round) // status 'open'
})

// Each later move.
playTransaction(ctx, blackjack, async (play) => {
  const round = await play.require<HandDetail, HandSecret>() // the player's open round, locked
  const next = await play.act(round, { detail, secret }) // saves the move, tells the room
  // or: await play.raise(round, { amount: round.stake, detail }) // a double down
  // or: await play.lower(round, { amount: oneBet, detail }) // one bet taken off the table
  // or: await play.settle(round, { payout, detail, summary: 'Blackjack' })
  return play.result(next)
})
```

- **One open round per player per game.** A second `start` is refused with "You already have a round going here". Keep a split hand or several bets in one round's detail.
- **Hidden state goes in `secret`**, such as a hole card for the peek. `act` keeps it unless you pass a new one (null clears it), `settle` and `refund` clear it, and no response or event carries it. Everything else is drawn at the moment it is revealed.
- **`raise` takes more stake** and checks only the wallet, since the first bet already passed the limits. To apply the bet limits to an extra bet, check it yourself with `checkBetAmount` from `shared/bet-amount.ts`.
- **`lower` hands part of the stake back** and keeps the round open, such as one roulette bet taken off before the close. It writes a `refund` ledger row, clears the all-in flag (chips are back in the wallet) and works out the big-bet flag again from what is left. It refuses nothing at all or the whole stake: to hand everything back, `refund` the round.
- **`refund`** closes a round with the stake handed back, such as a lobby nobody joined. It leaves the ticker and chat alone.
- **Resume after a refresh.** `room.open` is your open round from `GET /api/<game>/room`. Draw it as it was and let the player carry on.
- **Idle rounds settle safely** (spec: The room model). Call `finishIdleRounds(game, ctx.waitUntil, finish)` at the start of your room route. It finds rounds idle longer than `round_timeout_minutes` and hands each to `finish(play, round)`, which must settle or refund it by your game's safest rule. Calling it from the room route means no timer wakes the database.
- **Save the config a round depends on in its detail**, as the coin flip saves `edgePct`. An admin may change a value mid-round, and the replay must match what was paid.
- **The season's end** refuses new bets, but a round already open can still be played out.
- **Versions.** Every step adds one to the round's `steps`, and events carry `roundVersion(round)`, so browsers drop stale news. A round can take about a million steps.

## 8. One round for the whole table

Roulette, crash and race run one round that everyone bets into. The `shared_rounds` table holds it (`game`, `round_no`, `state`, `opens_at`, `closes_at`, the public `result`, a hidden `secret`, `settled_at`, unique on season, game and round number), and your lane writes its own game's rows with Drizzle. Each player's stake is still a `game_rounds` row, made with `play.start({ bet, detail, sharedRoundId })`, so the ledger, the ticker and the seats work as in every other room. A player's further bets on the same round go into that one game round with `play.raise`.

Your game's section in the spec says how its rounds move on: roulette and race on a fixed clock, settled by the first request after betting closes, and crash with a short-lived runner. Whatever the pattern:

- **Create the shared row once.** Insert it with `on conflict do nothing` on the unique key, then select it `for update`. Only one insert can win, so two requests never make two rounds. A bet needs the row first, because `game_rounds.shared_round_id` points at it.
- **Check the close under the lock.** A bet locks the shared row too (`for share` is enough) and is refused unless `now()` is before `closes_at`, so every bet either lands before the settle or is refused.
- **Settle it once.** Lock the shared row before you draw or settle. Save the result, then settle each player's round with `lockRound(tx, id)` and `settleRound(rt, game, round, outcome)`, inside `roundTransaction(ctx.waitUntil, (rt) => ...)`. A second request finds the result saved and only reads it.
- **Compare times in SQL.** `opens_at` and `closes_at` are checked against `now()`. Browsers draw the wheel, the race or the multiplier from those times and `serverNow()`, never from a stream of events.
- **Keep hidden things hidden.** A crash point lives in `shared_rounds.secret` until the crash. A roulette number or a race winner does not exist until it is drawn.
- **Hold the table's news until the reveal.** Every bettor's result reaches every screen at the close, seconds before the wheel lands. At the close, before any result can arrive, call `holdReveal({ players })` with the round's bettors, and call what it returns when the wheel lands. Until then their seats, the ticker, the leaderboard and big-result chat posts wait, on every screen (section 13).
- **A backup sweep** for rounds left unsettled may run as a scheduled function at most once a day (section 16).

Add the spec's extra room events (`bet.placed`, `round.closed`, `cashout` and so on) as in section 11.

## 9. Adding a feature

A feature plugs in with `src/features/<name>/manifest.ts`:

```ts
export default defineFeature({
  id: 'economy',
  routes: [{ path: '/hall-of-fame', title: 'Hall of Fame', page: () => import('./HallOfFame.tsx') }],
  nav: [], // extra rail links; the spec's own pages are already there
  slots: {
    'top-bar': [{ id: 'economy.work', order: 10, component: WorkButton }],
  },
})
```

- **Routes.** A route whose path matches a placeholder in `src/shell/planned.ts` takes the placeholder's place, and the rail link the placeholder had stays. A new path needs a `nav` item if it should be on the rail. `adminOnly: true` hides a page from players, but the server must still refuse them with `auth: 'admin'`.
- **Slots.** Each slot is a place in the shell that any feature can fill. A component that throws is hidden, not the page.

| Slot | Where | Props | Meant for |
| --- | --- | --- | --- |
| `top-bar` | You, beside the stream on a desktop and in the You sheet on a phone, with `compact` false. In the classic rooms, the top bar | `{ compact }`: true on a phone, and on desktop while the bar is short of room, so it should only make a widget smaller. On desktop the widgets sit beside the wallet. When they do not fit, the bar tightens first (compact widgets and clock, the sound toggle in the account menu), and only then moves them to a second line under the header; a phone always gives them that second line. A row too narrow for them scrolls sideways with a faded edge, so keep each widget small (about 2.75 to 3.1rem) | Work, slut and crime, shield pips, steal attempts |
| `profile-actions` | A player's profile card, not your own | `{ player }` | Steal |
| `profile-sections` | A player's profile card | `{ player }` | Season stats |
| `chat-composer` | Beside the chat box | `{ sent(message) }`: call it with what the server saved | The GIF picker |
| `chat-message` | Under each chat message, result line and card in the stream | `{ message }` | Reactions |
| `seat` | On every seat in every room | `{ game, userId, me }`; the seat is `relative`, so draw inside it | Seat emotes |
| `banner` | Above the stream, or above a page's panel | none | The final-day banner |
| `stream-status` | The phone's strip, after the wallet | none | One short status, such as "Work 2:41" |
| `overlay` | Mounted once for the session | none | Notification toasts, celebrations |
| `shop-items` | The Shop page (heist's) | none | Shields, ranks, the extra steal attempt |

- **Your own slot.** A lane can offer a slot of its own by extending `SlotProps` from its own file, and draw it with `<Slot name="..." props={...} />` from `src/shell/Slot.tsx`:

  ```ts
  declare module '../../shell/manifests.ts' {
    interface SlotProps {
      'heist.vault-panel': { wallet: number }
    }
  }
  ```

- **Server side.** A feature's routes live in `server/features/<name>/`, under `/api/<name>/*`, served by `netlify/functions/<name>-api.ts`, exactly like a game's.

## 10. The server toolkit

Everything here is in `server/lib/`. Import it; do not copy it.

### Endpoints: `http.ts`

`createApi(routes)` turns a list of `route({ method, path, auth, input, limit, idempotent, run })` into a function handler. Every route gets the session check, a rate limit per player and route (120 a minute unless `limit` says otherwise), input validation (the JSON body for POST and PATCH, the query string for GET and DELETE), the `Idempotency-Key` header check when `idempotent: true`, JSON with chip amounts as numbers, and plain-word errors.

`run(ctx)` receives `ctx.input`, `ctx.user` (`id`, `username`, `role` and the rest), `ctx.params` (from `:name` segments), `ctx.now` (the database's clock at the session check), `ctx.idempotencyKey`, `ctx.waitUntil(promise)` for work after the response, and `ctx.action`. Throw `ApiError`, or `badRequest`, `forbidden`, `notFound`, `conflict` or `tooMany` from `errors.ts`, with a message that tells the player what to do.

Lanes use `auth: 'user'` or `auth: 'admin'`. `public` is only for signing up and logging in.

### Chips: `wallet.ts` and `idempotency.ts`

- `lockWallet(tx, seasonId, userId)` locks the row and returns it. `readWallet(executor, ...)` reads without a lock, for display only.
- `debit`, `credit` (`{ seasonId, userId, amount, reason, refType?, refId?, meta?, account? }`), `transfer` (between players) and `moveBetweenAccounts` (wallet and vault) each write the ledger row and return the balances after it. `debit` refuses an overdraft with `InsufficientFunds`.
- `netWorth(wallet)` is the balance plus the vault.
- `ledgerMismatches(executor, seasonId)` lists wallets whose balance differs from their ledger. Tests expect it empty.
- Ledger reasons are in `shared/ledger.ts`. Adding one is a shared change.

A request that moves chips outside a game round runs in `chipTransaction`:

```ts
route({
  method: 'POST',
  path: '/api/economy/work',
  auth: 'user',
  idempotent: true,
  run: async (ctx) => {
    const season = await runningSeason()
    if (!season) throw conflict('There is no season running right now.', 'no_season')
    return chipTransaction(ctx, async (tx, afterCommit) => {
      await lockWallet(tx, season.id, ctx.user.id) // lock first, then check (rule 4)
      // ...check the cooldown against now() in SQL, draw with server/lib/rng.ts...
      const after = await credit(tx, { seasonId: season.id, userId: ctx.user.id, amount, reason: 'work' })
      afterCommit(() => publish(walletEvents(season.id, ctx.user.id, after)))
      return { balance: after.balance }
    })
  },
})
```

`walletEvents` gives the player's `wallet.updated` and their `standing.changed` on the leaderboard. Pass it the balances that `debit` or `credit` returned, or each side of a `transfer`.

### Rounds: `rounds.ts`

| Call | What it does |
| --- | --- |
| `defineServerGame({ id, name })` | Declares a game. `name` appears in chat posts |
| `playTransaction(ctx, game, play => ...)` | One player's request in one game, in one transaction, keyed |
| `play.start({ bet, detail, secret?, sharedRoundId? })` | Takes the stake and opens a round |
| `play.current()` / `play.require()` | The player's open round, locked, or null / or refused |
| `play.act(round, { detail, secret? })` | Saves a move and tells the room |
| `play.raise(round, { amount, detail, secret? })` | Takes more stake |
| `play.lower(round, { amount, detail, secret? })` | Hands part of the stake back; the round stays open |
| `play.settle(round, { payout, detail, summary, multiplier? })` | Pays out (stake included, rounded down) and closes it |
| `play.refund(round, { detail, summary })` | Hands the stake back and closes it |
| `play.result(round)` | The response: `{ round, wallet }` |
| `play.config`, `play.tx` | The config at the start of the request; the transaction |
| `roomState(game)` | The room route's answer |
| `finishIdleRounds(game, waitUntil, finish)` | Settles idle rounds by your safest rule |
| `roundTransaction(waitUntil, rt => ...)` | Round work no player keyed, such as a shared round's settle |
| `lockRound`, `readRound`, `raiseStake`, `lowerStake`, `settleRound`, `refundRound`, `roundView` | The pieces under `Play`, for that kind of work |

Big bets, all-ins, the ticker line and the chat post for a big result are automatic. `big_bet_pct`, `big_win_times` and the bet limits come from config.

### Config: `config.ts` and `shared/config.ts`

Read values with `play.config` in a round, or `await loadConfig(tx)` elsewhere. The values are typed: `chips` keys are `bigint` whole chips, `share` keys are basis points (100 is 1%), and the rest are numbers, text or lists of lines. Changes in the economy, ranks, giveaways, steals, shields and vault groups take effect at the next daily reset; the rest at once. Every key the spec names is already in `shared/config.ts`, including your game's edge and timings. Ask for anything else as a shared change.

### Seasons, time and game days

- `runningSeason()` is the season running now (it starts a season whose time has come). `currentSeason()` is that or else the last one that ended. Call either before your transaction.
- `requireBetsOpen(tx, seasonId)` refuses new bets outside the season by the transaction's clock. The round helper calls it for you.
- `standings(executor, seasonId)` is the leaderboard.
- `ctx.now` and `dbNow(executor)` are database time. `gameDay(now)`, `nextReset(now)`, `gameDayStart(day)` and `seasonDay(startsAt, now)` in `shared/game-day.ts` turn it into game days (4:00 AM Central).

### Randomness: `rng.ts`

`randomInt(min, max)` (max excluded), `randomBelow(n)`, `chance(numerator, denominator)`, `pick(items)`, `pickWeighted([[item, weight], ...])` (whole-number weights), `shuffle(items)`, `randomUnit()` (a float in [0, 1) for formulas such as a crash point), `randomToken()` and `randomCode()`. All of them use `node:crypto`, and the integer ones have no modulo bias. Pick among a fixed set of outcomes with the integer helpers, not by comparing `randomUnit()` with fractions.

### Chat, audit and notifications

- `systemPost(tx, body, meta)` saves a system post in your transaction and returns its event. Publish it after the commit (`rt.emit(post)` in a round, `afterCommit(() => publish([post]))` otherwise).
- `insertChatMessage` and `chatMessageEvent` in `chat.ts` cover other kinds.
- `writeAudit(executor, { actorId, action, target, before, after, reason })` records an admin action for the Audit page, in the same transaction as the action.
- A private message to one player: publish `liveEvent(userChannel(id), 'notification', { text, tone: 'info' | 'good' | 'bad' })`. The shell shows it as a toast.

## 11. Live events

The database is the truth, and live events are only the news of it. Only the server publishes, and only after the commit.

| Channel | Listens | Carries now |
| --- | --- | --- |
| `presence` | Everyone | Who is online, their room and status. The shell shares yours |
| `chat` | Everyone | `chat.message`, `chat.deleted` |
| `feed` | Everyone | `standing.changed`, `round.settled` (the ticker), `season.state`, `steal.result` (the ticker; the heist lane publishes it) |
| `room:<game>` | Everyone | `round.started`, `round.action`, `round.settled`, `seat.emote` |
| `user:<id>` | That player | `wallet.updated`, `notification` |

**Adding your events.** Declare them from your own shared file, by extending the channel's map:

```ts
// shared/games/roulette.ts
declare module '../events.ts' {
  interface RoomEvents {
    'bet.placed': { userId: string; spot: string; amount: number }
  }
}
```

**Publishing.** Build an event with `liveEvent(channel, name, data, version)`. Inside a round, queue it with `play.rt.emit(event)`. Inside `chipTransaction`, use `afterCommit(() => publish([event]))`. After a transaction of your own has returned, `ctx.waitUntil(publish([event]))`. `publish` never throws: a failed publish leaves browsers to catch up when they refetch.

**Versions.** The version must grow with every change to the thing the event is about, so a browser can drop news older than what it fetched: a round uses `roundVersion(round)`, a wallet its latest ledger id, a chat message its id. Give your own data a version the same way.

**Rules.** Each event carries enough to draw it without a fetch. No secrets: tests check every payload. No per-frame events: the browser draws a spin or a multiplier from a start time.

**In the browser** (`src/live/`): `useLiveEvent(channel, name, (data, envelope) => ...)` while mounted, `useResync(refetch)` to refetch whenever events may have been missed (on connect, reconnect and return to the tab), and `isNewer` to compare versions. `useRoom` already does this for rounds.

## 12. Data and migrations

### Use what exists first

- **A game's round state goes in `game_rounds.detail`**, typed by your shared file, and its hidden part in `secret`. Most games need no table.
- **Shared rounds go in `shared_rounds`** (section 8).
- **Core tables you write directly**, with Drizzle and inside a transaction. Chips still move only through `wallet.ts`.

| Table | Who writes it |
| --- | --- |
| `game_rounds` | Only the round helper (`server/lib/rounds.ts`) |
| `shared_rounds` | The game whose `game` it is |
| `wallets.balance`, `wallets.vault`, `ledger` | Only `server/lib/wallet.ts` |
| `wallets.tier`, `work_ready_at`, `hustle_ready_at`, `crime_ready_at` | Economy |
| `daily_state` | Economy: `bonus_claimed`, `streak`, `challenges`, `tier_bought`. Heist: `steal_attempts_used`, `extra_steal_bought`, `stolen_today`, `net_worth_at_reset`, `vault_moved`. Make the row with `insert ... on conflict do nothing`, then lock it, keyed by `gameDay(now)` |
| `steals`, `shields`, `shield_purchases` | Heist |
| `seasons.status` (`final_day`, `ended`), `season_results` | Economy. The foundation creates seasons and starts them |
| `chat_messages` | Through `server/lib/chat.ts` |
| `config` | Through `changeConfig` (the admin lane's editor) |
| `audit_log` | Through `writeAudit` |
| `net_worth_snapshots` | `wallet.ts`, hourly, when chips move |
| `users`, `sessions`, `invite_codes`, `idempotency_keys`, `rate_limits` | The foundation. The admin lane may disable players and end their sessions (`destroyAllSessions` in `auth.ts`) |

### Your own tables

Put them in `db/schema/<lane>.ts`, named `<lane>_*` (such as `social_reactions`), with chips as `bigint` and times as `timestamptz`. Then:

```bash
npm run db:generate -- --name <lane>_<slug>   # writes netlify/database/migrations/<timestamp>_<lane>_<slug>/
# npm run dev applies a new migration as soon as it appears; the test runs apply it too
```

Never run `drizzle-kit push` or `drizzle-kit migrate`, and never run DDL against a hosted database. Netlify applies the committed files on every deploy.

### Migration numbers

- **Once pushed, a migration is permanent.** Your preview's database has applied it. Never edit or delete it, and rename it only in the one case below. To change a table, add another migration.
- **Parallel lanes are fine.** Drizzle Kit keeps each migration's history inside its folder, so two lanes' migrations merge cleanly: after both are on `main`, `npm run db:generate` finds nothing to do and `npx drizzle-kit check` passes. (Checked by the foundation on Nov 18, 2026.)
- **Production refuses a migration numbered below one it has already applied.** Previews and local runs do not always catch this. So before your merge, pull `main` and look at the newest migration there. If it sorts after yours, rename your migration's folder to a fresh timestamp (`date -u +%Y%m%d%H%M%S`), keeping its files as they are, and tell Tyton in the pull request. Renaming breaks every database that applied the old name: run `npm run db:reset:local`, and expect your pull request's preview to fail with "removed after being applied". A new pull request from the same branch can keep the old preview's database (batch 3's preview still had the players batch 2's preview made), so it can fail the same way. If you still need a preview after renaming, ask Tyton to let you push your work to a new branch, and open a new pull request from that one: a branch's first preview starts from a fresh copy of production.
- **Keep it to one or two migrations per lane**, written late, once the shape has settled.

## 13. The browser kit

One import: `import { ... } from '../../kit/index.ts'`. Icons come from `src/kit/icons.tsx`.

| Export | What it is |
| --- | --- |
| `useRoom(game, { revealMs })` | The room: `seats`, `mine`, `open`, `loading`, `failed`, `retry`. `revealMs` is how long another player's result takes to land on their seat: a number, or `(round) => ms` when each round's reveal runs its own length |
| `usePlay()` | `send(path, body, { revealMs })` and `busy` |
| `holdReveal({ players })`, `afterReveal(player, fn)` | The reveal hold. News about the players it names (their seats, the top bar, the leaderboard, the ticker, chat posts about their results) waits until it is released. `usePlay` holds your own; a shared round holds its bettors from the close until the wheel lands |
| `applyRound`, `roomKey` | Put a round into the room's cache; the room's query key |
| `putRound`, `useCardRound`, `markShown`, `showCard`, `holdForCard`, `takeCardHold`, `claimKeys`, `CommandRefusal` | Cards in the stream, from `src/kit/cards.ts` (section 20): the card store, the moment a result has shown, showing your new card at once, the hold your command hands its card, the keys your card answers to, and a command's refusal |
| `RoomLayout` | The room: header, how-to-play, other seats, your seat with the table, controls |
| `BetBox` | The typed bet box, with ½, 2× and Max, and `children` for your own controls |
| `closedReason(season)` | Why bets are closed, or null |
| `Seat`, `EmptySeat`, `SeatSkeleton`, `seatOutcome`, `seatTag` | A seat and its states |
| `Button`, `Kbd` | Buttons with hover, pressed and disabled looks (`pressed` for toggles); the shortcut hint |
| `useShortcuts(map, { enabled })` | Letter keys for your game. They never fire while a text box has focus |
| `ChipStack`, `AnimatedNumber` | A stack of chips for an amount; a number that counts to its new value |
| `Avatar`, `PlayerName`, `TierBadge`, `tierColor` | A player, with their tier's color and badge |
| `Sheet` | A panel that slides in: `placement` bottom, right or center |
| `playSound(name)`, `SOUNDS` | chip, deal, flip, tick, win, bigwin, loss, steal, block, thud (a bust, a mine), sparkle (a big moment, such as 21) |
| `celebrate({ net, big, note })`, `isBigWin(round, bigWinTimes)` | The win celebration, scaled to the win |
| `toast.info`, `toast.good`, `toast.error` | Plain-word messages |
| `api`, `ApiError`, `errorMessage`, `requestKey` | The API client. Pass `{ key: requestKey() }` on a chip-moving request |
| `useMe`, `useWallet`, `useSeason`, `useConfig`, `useLeaderboard`, `usePlayers`, `usePlayer`, `applyWallet` | Shared data, kept live by the shell |
| `serverNow()`, `useNow()`, `formatCountdown(ms)` | The server's clock in the browser, for countdowns |
| `useMediaQuery`, `TABLET`, `DESK`, `WIDE`, `TOUCH` | Layout breakpoints and touch |

## 14. Look and feel

Read the spec's Site layout and feel and the Quality bar. In code:

- **Tokens only.** Use the token classes (`bg-surface-2`, `text-muted`, `text-gold`, `text-loss`, `border-border` and so on) and variables from `src/theme/midnight.css`. `npm run lint` fails on a raw color anywhere in `src/` outside `src/theme/`. `color-mix(in oklab, var(--accent) 20%, transparent)` is fine.
- **Colors for your game.** Put colors only your game uses in `src/theme/games/<game>.css` (or `features/<name>.css`), set on plain `:root`, and import the file from your manifest so it loads with the Floor. A later theme restyles them by setting the same names under `:root[data-theme='<theme>']`.
- **Gold is for wins and first place, red for losses.** Chip amounts use `formatChips` and tabular numerals.
- **Motion.** Interface motion runs 150 to 250ms (`--speed-fast`, `--speed-ui`, `--speed-slow`), reveals up to 600ms (`--speed-reveal`), and chips and cards use springs. Animation never blocks input: the player can act the moment the server answers, and a running animation finishes early. Motion's components honor reduced motion on their own (the app sets `MotionConfig`), but `animate()` calls and CSS animations do not: check `useReducedMotion()` for those, and keep a short reveal so the news and the animation still agree.
- **Sound and keys.** Play a sound for each moment that has one. Give every action a key and show it with `<Kbd>`. The bet box owns Enter, Space and M, the room owns `?` (how to play), and Escape leaves the bet box.
- **Phone.** Every game must be playable one-handed at 375px: controls in thumb reach (the room layout keeps them there), nothing wider than the screen, nothing that jumps as content loads.
- **States.** Skeletons shaped like the content, designed empty states, plain-word toasts that say what to do next.

## 15. Testing

```text
tests/<name>/unit/*.test.ts          pure rules: no database
tests/<name>/integration/*.test.ts   endpoints against a real Postgres
tests/<name>/e2e/*.spec.ts           real browsers at 1440 and 375
```

**Integration tests** get a database of their own per file:

```ts
const testDb = await useTestDatabase() // tests/helpers/db.ts
const seasonId = await createSeason(testDb) // tests/helpers/fixtures.ts
const id = await createPlayer(testDb)
await fundWallet(seasonId, id, 100n * CHIP)
const client = await loggedIn(rouletteApi, id) // tests/helpers/api.ts underneath
const res = await client.post('/api/roulette/bet', { bet: '5', spot: 'red' }, { 'idempotency-key': randomUUID() })
```

- `captureLive()` records every published event; `client.settle()` waits for the work a handler passed to `waitUntil`, such as the publishes.
- Each route allows 120 requests a minute, so a file that sends many clears `rate_limits` in `beforeEach`.
- Set `process.env.DATABASE_POOL_MAX` higher before `useTestDatabase()` for tests that fire many requests at once.

**What every game's tests must show** (spec: Quality bar):

- The rules match the spec, and where there is a house edge, the return to player is within tolerance: an exact calculation where one exists, and a large real simulation.
- Parallel bets cannot overdraw, and the balance still equals the ledger (`ledgerMismatches`).
- A replayed idempotency key returns the first answer and changes nothing.
- No response and no live event contains `secret` or anything drawn early.
- No session gets 401, bad input gets 400 in plain words, and a missing idempotency key is refused.
- Big results reach chat, and the round's detail replays it.
- Every payout is checked for rounding at the smallest bet (Tyton, Nov 22, 2026). Payouts round down to a whole chip, and `min_bet` is 25, so on a 25-chip bet a multiplier under 1.04x pays back the stake and nothing more, and 1.5x pays 37, not 37.5. A unit test pays `min_bet` at every multiplier the game can show (each crash or mines step, each plinko slot, each slots line), and the progress file lists any that come out at no profit or round away more than the house edge, with what you did about it.

**Browser tests** run one at a time against one fresh database with admin, alice, bob and carol (password `password123`) and a running season, in a desktop project (1440) and a phone project (375, touch). `openAs(browser, 'alice')` gives a signed-in page; close it with `player.close()`, which closes the tab the way a person does so the player leaves the online list at once (closing only `player.context` drops the connection, and on a preview Ably keeps the player online for 15 more seconds, into the next test). `onPhone(testInfo)` tells the projects apart, and `snap(page, '<name>', 'what', testInfo)` saves a screenshot in `tests/<name>/screenshots/`. Every lane's browser tests share those players, and on a preview they keep their chips and chat from run to run, so never assume a balance, an empty room or an empty chat, bet small, and finish any round you open.

**Test accounts** (Tyton, 2026-11-20): `test` and `test2`, password `test`, for trying a preview by hand. They work on deploy previews, branch deploys and in local development, and never on a production deploy, published or not, because those share the live database (`testAccountsOn` in `server/core/test-accounts.ts`, from Netlify's `context.deploy`, which routes get as `ctx.deploy`). A build of `main` opened by its own link is such a production deploy: Netlify applies migrations to the live database only when a deploy is published, so until then its requests answer "This deploy is not published..." (`isUnpublishedProduction` in `server/lib/deploy.ts`), and once the live database has tables, a failed sign-in as a test account there says they only work on deploy previews. Try things on a deploy preview, never on a deploy link of `main`. Signing in as either one creates both if they are missing, starts a 30-day test season if none is running, and fills both wallets back up to 10,000 chips (ten starting balances) with an `admin_adjust` ledger row, so a broke tester signs in again. They are players, not admins. Give Tyton these, not the sample players' preview password. A preview can therefore hold players your tests did not make, richer than the sample players: pick sample players by name (`SEED_PLAYERS`), never "the first one in the list", and do not expect one in the sidebar's five leaderboard rows (the phone's leaderboard sheet has everyone).

Run one lane's tests with `npx vitest run tests/<name>` and `npx playwright test tests/<name>`. Run everything with `npm run check` and `npm run test:e2e`.

## 16. Keeping costs down

Netlify bills the database for every hour it is awake. It sleeps after 5 idle minutes, so:

- **No polling.** Live news comes from Ably, which never touches the database.
- **Nothing wakes the database on a timer.** Settle and advance things lazily on the next request, or, for crash, from the runner a player's bet starts. A scheduled function that touches the database may run at most once a day, and only as a backup sweep.
- **Preview deploys are free; production publishes cost 15 credits each.** Work in previews.

## 17. Environment variables

| Name | Where | What |
| --- | --- | --- |
| `NETLIFY_DB_URL` | Netlify, automatic | The database for this deploy (a preview gets its own branch) |
| `ABLY_API_KEY` | Netlify, secret, functions | Live updates. Without it, previews publish nothing |
| `ADMIN_BOOTSTRAP_CODE` | Netlify, secret, functions; one value for production, another for previews | The invite code that creates the first admin, once |
| `KLIPY_API_KEY` | Netlify, secret, functions | GIF search for the social lane. A future content security policy must allow Klipy's domains |
| `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | `.env`, local only | The dev, test and browser-test databases (`npm run db:setup:local` writes them) |
| `LIVE_RELAY_URL`, `LIVE_RELAY_SECRET` | Local only, set by `npm run dev` | The local live relay |
| `DATABASE_POOL_MAX` | Optional | Connections per instance |
| `NETLIFY_FUNCTIONS=emulate` | Optional, local | Runs Netlify's own function emulation in `npm run dev` |
| `E2E_BASE_URL`, `E2E_PASSWORD`, `E2E_ADMIN_CODE` | Optional, set for one run | Run the browser tests against a deploy preview: its URL, the sample players' password there, and the preview admin code for the first run (section 2, Testing on a preview) |

Secrets live in Netlify only, never in the repo or in browser code. The server reads them with `env(name)` from `server/lib/env.ts`, and adding a name there is a shared change.

## 18. Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The site, the API and the live relay on http://localhost:8888. Applies new migrations as they appear |
| `npm run check` | Typecheck, lint (ESLint, Prettier, theme tokens), unit and integration tests |
| `npm run test:e2e` | Browser tests at 1440 and 375 on port 8899 with a fresh database, or on a deploy preview with `E2E_BASE_URL` (section 2) |
| `npm run format` | Prettier on everything |
| `npm run db:setup:local` | Once per machine: local Postgres, role, databases, `.env` |
| `npm run db:seed:local` | Sample players and a running season in the dev database. Safe to run twice |
| `npm run db:reset:local` | Rebuilds the dev database from the migrations and the sample data |
| `npm run db:generate -- --name <lane>_<slug>` | Writes a migration from `db/schema/` |

## 19. Notes for each lane

Starting points, not rules. Your spec sections decide.

- **Every game.** A card and a command first (section 20), with the rules, routes and tests of sections 6 to 8. Your command's setting is already in `shared/config.ts`. Check every payout for rounding at the smallest bet, 25 chips (section 15): crash, mines, plinko and slots show multipliers in hundredths, and the small ones can round to no profit.

- **Blackjack.** A multi-move round (section 7). Draw each card when it is dealt, from what is left of the six decks (the dealt cards are in the detail). Only a hole card the peek needs waits in `secret`. A double down or a split takes more stake with `play.raise`, and a split's two hands live in one round's detail. Pick the safe rule for `finishIdleRounds` and write it in your progress file. The slow reveal's threshold and timings are config (`blackjack_slow_reveal_pct`, `blackjack_slow_lift_ms`, `blackjack_slow_flip_ms`), and since a hand's reveal runs its own length, pass `useRoom` a `revealMs` function of the round.
- **Roulette.** A shared round on the clock (section 8). The quick-bet box parses amounts with `parseBetAmount` from `shared/bet-amount.ts`. A player's bets on one spin share one game round: `start` the first, `raise` the rest after checking each with `checkBetAmount`. Clearing every bet before the close fits `play.refund`, and taking one bet off fits `play.lower`. At the close, hold the spin's bettors with `holdReveal({ players })` until the wheel lands (section 8).
- **Crash.** A shared round with its crash point in `shared_rounds.secret`, drawn with `randomUnit()` by the formula in the spec. Cash-outs are decided by the server's receive time against the round's start, in SQL. The browser draws the curve from the start time and `serverNow()`, and the crash reveals everyone still in at once, so hold them with `holdReveal({ players })` until the curve has crashed on screen. The spec's runner is a Background Function: check the current Netlify docs for its limits.
- **Mines and Plinko.** Mines is a multi-move round: each opened tile is a mine with `chance(m, 25 - k)`, and the layout is placed only for the reveal. Plinko settles in one request like the coin flip, but several balls fly at once while `usePlay` sends one move at a time, so send each ball with `api.post(path, body, { key: requestKey() })` and the reveal hold from `src/kit/reveal.ts` (see how `src/kit/play.ts` uses it), or ask for a parallel option as a shared change.
- **Slots.** One request per spin, like the coin flip. The return-to-player test is the heart of it.
- **Russian roulette.** Chips between players use the `pvp_ante` and `pvp_pot` ledger reasons through `wallet.ts`. The solo mode and a cancelled lobby use the round helper like any game (`bet`, `payout`, `refund`). If you want the round helper to write the player-against-player reasons too, so those rounds reach the ticker and History by themselves, ask for it as a shared change. A turn timer that runs out is acted on by the next request after the deadline, like a roulette close.
- **Race.** A shared round on the clock, about every 75 seconds. Draw the field of six when the race is created and the winner with `pickWeighted` when betting closes, never earlier. Typed bets work like roulette's, and so does holding the bettors' news until the finish line (section 8).
- **Economy.** Work, slut and crime are `top-bar` slot widgets (`compact` on a phone), and commands in `src/features/economy/commands.ts` (`.work`, `.slut`, `.crime`, `.collect`); each result posts a public line (spec: Work and crime). Their cooldowns are the `*_ready_at` columns on the wallet, compared with `now()`. The daily bonus, streaks, challenges and the rank purchase use `daily_state`. Challenge progress comes from querying settled rounds, so no game needs challenge code. The final-day banner is a `banner` slot, and `/hall-of-fame` replaces its placeholder. The full flavor-line pools the lane wrote are the config defaults (`shared/config-lines.ts`), and `SystemMeta.drop` in `shared/chat.ts` types a chat drop's system post.
- **Heist.** `.rob`, `.dep` and `.with` are in `src/features/heist/commands.ts`. Steal from the `profile-actions` slot, the Shop page at `/shop` drawing the `shop-items` slot, the vault through `moveBetweenAccounts`, and shields in their core tables. `net_worth_at_reset` can be worked out from the ledger as of the reset. `scripts/simulate-season.ts` can import `shared/config.ts` and the rules directly.
  - **Steals in the ticker** (Steal rules, rule 7). `steal.result` is a core feed event, and its types `StealView` and `StealResult` are in `shared/steals.ts`, so the shell's ticker can listen before heist merges. Publish it after each attempt's commit, versioned by the steal id. `GET /api/ticker` reads the `steals` table, so a page load shows the latest attempts among the rounds. The ticker adds a live attempt after the thief's reveal (`afterReveal(thiefId, ...)`), so hold the thief, and the target if you like, with `holdReveal` while the steal plays. Clicking a steal in the ticker opens the thief's profile card, where the Rob button is. `MaskIcon` in `src/kit/icons.tsx` is a thief's mask.
- **Social.** The GIF picker is a `chat-composer` slot and reactions a `chat-message` slot. Seat emotes are a `seat` slot that publishes `seat.emote` through your API. History and replays find each game's `replay` with `gameById(id)?.manifest?.replay` from `src/shell/registry.ts`. The pages `/leaderboard`, `/history`, `/history/:roundId`, `/profile` and `/players/:username` replace their placeholders.
- **Admin.** `/admin` and `/audit` replace their placeholders. The config editor uses `changeConfig` and `pendingConfigChanges`, every action writes `writeAudit`, and the existing `/api/invites` and `/api/seasons` endpoints cover invite codes and seasons. The foundation's stopgap page `/setup` can go once the panel covers it (a shared change at integration).

## 20. The stream: cards and commands

_(Added Nov 22, 2026, with Tyton's move to one chat stream: spec, Site layout and feel, and Games > Cards and commands.)_ Every game is a card in the stream, started by a command typed in the message box. The server side of a game does not change: the round helper puts every round in the stream by itself. What a lane builds for the browser is a command and a card.

Blackjack is the first card and the one to copy until the coin flip's card takes over as the worked example in section 6.

| Piece | Blackjack's file | What it holds |
| --- | --- | --- |
| The command | `src/games/blackjack/commands.ts` | `.bj 50`: the setting that holds its words, what it takes, one line for the list, and what it runs |
| The request | `src/games/blackjack/stream.ts` | Deals the hand, shows its card at once, and holds the player's news until the card has dealt it |
| The card | `src/games/blackjack/StreamCard.tsx` | The game at stream size for everyone, with buttons and keys for its player |
| The manifest | `src/games/blackjack/manifest.ts` | `card`, `commands` and `roundName`, beside `replay` and `howToPlay` |
| The server | nothing new | The round helper writes the card with the round |

### The server: nothing to add

`play.start()` writes the round's card, a `chat_messages` row of kind `card` with `{ game, roundId }` as its meta (`CardMeta` in `shared/chat.ts`), in the same transaction as the bet, and publishes it on `chat` with the round's public view. The answer to the request that started the round carries it as `PlayResult.card`, with the round as it stands, so the player's browser shows the card without waiting for the echo. Later moves reach every card on the room events your game already publishes, and the newest version wins (`roundVersion`).

- `GET /api/stream?filter=all|chat|games` gives the newest 100 items of a filter with each card's round, and `before=<id>` pages back. The newest page also lists the player's own open cards (`mine`), so they pin again after a reload.
- A round's `detail` is on show to the whole stream, as it was to the whole room: never put anything there you would not show everyone. Hidden things stay in `secret`.
- A big win or a big loss still writes its system post (spec: Results travel). For a player's own round the post carries `onCard: true`, and the stream leaves it out, since the card shows the result.
- A shared round (roulette, crash, race, a lobby) gives no card to each bet. Its one shared card comes with the roulette conversion, which adds it to section 8's pattern.

### The command

```ts
// src/games/blackjack/commands.ts
export const BLACKJACK_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_blackjack', // the setting with its words: bj, blackjack
    args: 'bet', // what the list shows after the word
    example: '50', // the first quick pick, and the example in hints
    needs: 'amount', // refused in the box, before anything is sent, without one
    description: 'Deal a hand of blackjack at your bet.',
    run: ({ queryClient, me, args }) => dealHand(queryClient, me.id, args),
  },
]
```

- **The words are settings.** Every game in the spec already has its `command_<id>` setting in `shared/config.ts` (`command_russian_roulette` for `russian-roulette`), so the admin panel renames it with no code. A feature asks for a new key as a shared change. Until a game's manifest has commands, the shell lists a stand-in that says the game is coming soon.
- **Send what was typed.** `args` is the text after the word, such as `50`, `half` or `2.5k`. Send it as typed and let the server resolve it against the locked wallet with `parseBetAmount`, as the bet box did.
- **Refusing.** Throw a `CommandRefusal` (`src/kit/cards.ts`) with a sentence, or let an `ApiError` through: the text stays in the box and the sentence shows just above it, for that player alone. Nothing is posted.
- **Answering privately.** `context.reply({ label, content })` puts an "Only you" item at the bottom of the player's own stream. It is never stored.
- **Nothing else to post.** The command's text is never posted; the card is the post.
- `needs: 'player'` makes the box offer players after the word, as `.rob` does. `adminOnly` hides a command from players, and the server still refuses them.

### The request

```ts
// src/games/blackjack/stream.ts
export async function dealHand(queryClient: QueryClient, me: string, bet: string) {
  const release = holdReveal({ players: [me] }) // the wallet, the leaderboard and posts about you wait
  let handed = false
  try {
    const result = await api.post<PlayResult<BlackjackDetail>>(
      '/api/blackjack/deal',
      { bet },
      { key: requestKey() },
    )
    putRound(result.round) // the card store has the round before the card draws
    if (result.card) {
      holdForCard(result.round.id, release) // the card lets go once the cards are down
      handed = true
      showCard(result.card) // into the stream, pinned above the box, with the keys
    }
    afterReveal(me, () => {
      applyRound(queryClient, result.round)
      applyWallet(queryClient, result.wallet)
    })
  } finally {
    if (!handed) release(0)
  }
}
```

### The card

The stream draws each card's header (the player, the game, the bet, an ALL IN or BIG BET tag, and the result once it has shown) and hands the rest to your `card` component, loaded the first time one shows:

```ts
export interface CardProps<D = unknown> {
  round: RoundView<D> // the newest version: the page, the live events and your own answers
  message: ChatMessage // the card's chat row
  mine: boolean // your round: its buttons work for you
  pinned: boolean // above the message box, in thumb reach
  keys: boolean // it has the keyboard: its shortcuts work and the box waits
}
```

What blackjack's card does, and every card must:

- **Draw the game for everyone.** Reuse your table's parts at stream size (blackjack reuses `Table.tsx` and its timeline). Only `mine` gets working buttons; everyone else watches the game play, with a word such as "Their move…". Sounds and celebrations are for `mine` alone: ten hands at once would be noise.
- **Play each new version.** The card renders again with each newer `round`. Animate from what is on screen to the new version. A round that ended a while ago (blackjack uses 8 seconds) and never showed in this tab shows as it ended.
- **Say when the result has shown.** Call `markShown(round.id)` once the result is on screen. The header and the glow show the result only from then, the stream folds the card a few seconds later, and its pin lets go. A card that never calls it folds at the latest 20 seconds after its round settles.
- **Release the hold.** On first show, `takeCardHold(round.id)` gives you the hold your command left. Release it (`release(0)`) once the cards are down, so the player's news lands with the reveal and not before.
- **Send moves as the room did.** A move is `api.post(path, body, { key: requestKey() })` inside `holdReveal`, then `putRound(result.round)` and the animation: see `send()` in `StreamCard.tsx`.
- **Keys.** With `keys && mine`, give your shortcuts to `useShortcuts(map, { enabled: keys && mine })` and name the letters you use with `claimKeys(['h', 's', 'd', 'p'])`: any other letter goes back to typing in the box. Space and Enter are the card's too: turn a slow card, finish an animation, or play again. Escape and a click in the box take the keys back.
- **Play again.** While `pinned` and the round is over, offer the same bet again ("Deal again · 50", with Space). It calls the same request as the command.
- **Fit.** A card is at most 42rem wide, 375px on a phone, and pinned it sits above the box: keep the game short (blackjack's felt is 11 to 15rem tall) and the buttons in one row. The card's `article` is a size container, so use container queries (`@max-[24rem]:`) rather than screen sizes.

Without a `card`, the stream shows a plain card with the bet and the result.

### Folding, runs and big moments

The shell does these from `round`, `markShown` and the settings. A finished card folds to one line a few seconds after its result shows, a run of one player's finished rounds folds into one line (`stream_round_runs`), and a big win or an all-in stays open with a gold or red edge. A folded line opens to your manifest's `replay`, so every game needs one, and `roundName: ['hand', 'hands']` names the rounds in a run's line ("6 Blackjack hands").

### Testing a card

Write a browser test like `tests/shell/e2e/stream.spec.ts`: one player types the command and plays from the pinned card (keys on a desktop, taps on a phone), a second watches the same card live without its buttons, and the finished card folds to its line and opens to the replay. On a preview the stream keeps what earlier runs posted, so find your own items by round id: `[data-round="<id>"]` is a live card, `[data-folded="<id>"]` its folded line, and `[data-rounds~="<id>"]` a run's line that holds it. The message box is the combobox named "Message or command", the stream the log named "The stream: Everything", and a pinned card sits in the region named "Your game".
