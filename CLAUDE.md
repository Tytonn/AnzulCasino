# Anzul Casino

A private casino site for about 10 friends, played in month-long seasons with play chips. React and Vite in the browser, Netlify Functions and Netlify Database (Postgres with Drizzle) on the server, Ably for live updates.

## Read first

1. `docs/SPEC.md`: the source of truth. If it is unclear or looks wrong, ask Tyton instead of guessing.
2. `docs/LANE_GUIDE.md`: how the repo fits together and how to add a game or feature. It wins over the spec's folder map.
3. `docs/progress/<lane>.md` for your lane, and the other files in `docs/progress/`.

Netlify's agent skills are in `.claude/skills/`. Follow them and the current Netlify and Ably docs over memory.

## Rules every thread follows

Copied from `docs/SPEC.md`. They apply to every line of code in every lane.

### Fairness and chips

1. **The server decides everything.** The browser sends intents: bet 500, hit, cash out. It never sends an outcome, a balance, a multiplier or a card.
2. **Chips are whole numbers.** Store them as `bigint`. No floats in chip math. Payouts round down to a whole chip.
   _(Changed by Tyton, Nov 18, 2026.)_ Chips are tracked in whole hundredths of a chip: every amount is a `bigint` count of hundredths, so there are still no floats. Payouts, steals and fines round down to a whole hundredth. Show cents only when an amount is not a whole number (`107.50`, but `107`).
3. **Every balance change is one ledger row**, written in the same database transaction as the thing that caused it. A wallet's balance must always equal the sum of its ledger rows. A test checks this.
4. **Lock before you spend.** Every transaction that moves chips locks the wallet row first (`SELECT ... FOR UPDATE`), then checks the balance. Two fast clicks must never spend the same chips twice.
5. **Every chip-moving request is idempotent.** The browser sends a unique key with it. A repeated key returns the first result and changes nothing.
6. **Randomness comes from Node's `crypto` on the server**, never `Math.random`. Map random bytes to a range without modulo bias (`crypto.randomInt`).
7. **Draw late.** Decide a hidden outcome at the moment it is revealed, not before. Where the rules need it earlier (a dealer hole card for the blackjack peek, a crash point), keep it in `game_rounds.secret`. No API response and no live event ever includes that column.
8. **Time is database time.** Cooldowns, round windows, the daily reset and the season end are compared against `now()` inside the transaction. Browser countdowns are display only, corrected by an offset from `/api/time`.
9. **Every tunable number lives in the `config` table**, read through one typed helper with defaults in one file. No magic numbers in game code.
10. **Every endpoint** requires a session, validates its input with a schema, and is rate-limited per user. Chat and names render as plain text, never as HTML.

### Repo and workflow

- Read `docs/SPEC.md`, `docs/LANE_GUIDE.md` and your lane's progress file before writing code.
- Work on your lane's branch and open a pull request early. Never push to `main`.
- Edit only your lane's folders. Shared code is read-only for lanes.
- Put your tables in your own schema file and your own migration files. Never edit another lane's migration. Prefer the JSON `detail` column on `game_rounds` over new tables.
- Avoid new dependencies. If one is essential, add it and say so in the pull request.
- Test on your pull request's deploy preview. Each preview gets its own copy of the database, so nothing you do there touches the live one ([Netlify Database docs](https://docs.netlify.com/build/data-and-storage/netlify-database.md)).
- Follow the current Netlify and Ably docs over memory. Install Netlify's agent skills first by opening [netlify.ai](https://netlify.ai/).
- Secrets live in Netlify environment variables only. Never in the repo, never in browser code.
- Before calling anything done, meet the **Quality bar** at the end of `docs/SPEC.md`.
- Update `docs/progress/<lane>.md` at the end of every working session: done, not done, decisions, open questions.

## Commands

| Command | What it does |
| --- | --- |
| `npm run db:setup:local` | Once per machine: starts the local Postgres, creates the `casino` role and the dev, test and browser-test databases, writes `.env` |
| `npm run db:seed:local` | Adds sample players (admin, alice, bob, carol; password `password123`) and a running season to the dev database. Safe to run twice |
| `npm run dev` | The site, the functions and the local live relay on http://localhost:8888. Applies pending migrations to the dev database |
| `npm run check` | Typecheck, lint (ESLint, Prettier, theme tokens) and the unit and integration tests |
| `npm run test:e2e` | Browser tests at 1440px and 375px on their own server (port 8899) and a fresh database. `E2E_BASE_URL=<preview url>` runs them against a deploy preview |
| `npm run db:generate` | Writes a migration from the Drizzle schema into `netlify/database/migrations/` |

## Conventions that are easy to miss

- **Chips are hundredths.** Every amount in code, the database and the API is a `bigint` count of hundredths. Convert and format only with `shared/chips.ts`.
- **"Tier" in code, "Rank" on screen.** `rank` means a player's leaderboard place. The spec's purchasable Ranks are `tier` in code.
- **Database safety.** Never run `drizzle-kit push`, never run `drizzle-kit migrate` against a hosted database, and never run DDL through a direct connection. Migrations reach Netlify only as committed files that Netlify applies on deploy. The scripts in `scripts/db/` refuse any database that is not on localhost.
- **Migrations are permanent once applied.** Never edit or delete one that a deploy has applied. Lane migrations are named `<timestamp>_<lane>_<slug>`; regenerate yours with a fresh timestamp just before your merge, because Netlify rejects a migration numbered lower than one it has already applied.
- **No `Math.random` on the server.** ESLint blocks it in `server/`, `netlify/`, `shared/` and `db/`. Use `server/lib/rng.ts`.
- **Theme tokens only.** Components use the token classes and variables from `src/theme/`. Tailwind's own palette is switched off, and `npm run lint` fails on raw colors outside `src/theme/`.
- **Keep the database asleep.** Netlify bills the database for every hour it is awake. No browser polling, no scheduled function that touches the database more than once a day, and live news goes through Ably, which never wakes the database.
- **Production deploys cost credits.** Work in deploy previews. Only Tyton merges to `main`.
