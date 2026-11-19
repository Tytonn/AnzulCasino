# Economy (Stage 2)

Branch `claude/project-thread-bwe5nz` (the session's branch; the spec names it `lane/economy`). Owns the names `economy` and `season`. Spec sections: Economy; Accounts and seasons.

Last updated: 2026-11-19 by the Economy thread.

## Plan

Everything the lane builds, in the order it lands. The server decides every outcome, every chip moves through `server/lib/wallet.ts` with one ledger row, and nothing runs on a timer.

1. **Shared rules** (`shared/features/economy.ts`, `shared/features/season.ts`): types, input schemas, live events, and the pure math: rank income accrual and its cap, the streak bonus, the payout ranges of work, slut and crime, the challenge pool and progress, the drop split, unlock times, final ranking order.
2. **Tables** (`db/schema/economy.ts`, one migration `<timestamp>_economy_init`):
   - `economy_income`: when each player last collected rank income.
   - `economy_drops`, `economy_drop_claims`: chat drops and who grabbed them. The next drop's time is a row nobody can read until it lands.
   - `economy_announcements`: one-time chat posts per season (each rank unlock, the final day, the end).
3. **Endpoints** (`/api/economy/*`, served by `netlify/functions/economy-api.ts`):
   - `GET /api/economy/state`: the player's ranks, income, streak, cooldowns, challenges, recent drops and activity.
   - `POST /api/economy/work`, `/hustle`, `/crime`: the three income buttons, cooldowns on the wallet row, fines stop at zero.
   - `POST /api/economy/collect`: rank income since the last collect (capped at `tier_income_cap_hours`) and today's streak bonus.
   - `POST /api/economy/tier`: buys the next rank: unlocked, one per game day, never in the final 24 hours, collecting income at the old rate first.
   - `POST /api/economy/challenges/claim`: pays a finished challenge, with progress worked out from the player's settled rounds for the game day.
   - `POST /api/economy/drops/claim`: grabs a share of the open chat drop.
   - `GET /api/economy/hall-of-fame`: every finished season's frozen standings.
4. **Season lifecycle, lazily** (no timers): the first request after the moment moves `seasons.status` to `final_day` and posts it in chat; after the end, once open rounds have settled (or `round_timeout_minutes` has passed), the standings are frozen into `season_results`, the status becomes `ended`, and the podium is posted. Rank unlocks and chat drops are announced the same way.
5. **Screens** (`src/features/economy/`, `src/features/season/`):
   - Top bar: Income (rank badge, live income, Collect), Work, the third button (`hustle_name`, "Slut") and Crime, each with an exact cooldown. A result card with the flavor line, private to the player.
   - The Daily panel (a popover on desktop, a sheet on a phone): collect, streak, today's challenges, the next rank with its unlock countdown, recent activity.
   - The rank card in the Shop (`shop-items` slot).
   - Chat drops: a Grab button under the drop's chat post, and a pill at the top of the page while a drop is open.
   - The final-day banner with its countdown, the season-over banner, the podium screen and `/hall-of-fame`.
6. **Tests**: unit (math, pools, expected values), integration (every endpoint: parallel and replayed requests, hidden data, refusals, the lifecycle), browser (two players at 1440 and 375).

## Decisions

- **"Unlocks day 1" means the season's first game day**, as `shared/config.ts` already describes the unlock-day settings. Bronze can be bought from the start, Silver from the third game day, and so on. The unlock days are config.
- **One Collect pays both** the rank income and today's streak bonus (two ledger rows, `rank_income` and `daily_bonus`).
- **The streak bonus** for day _n_ of a streak is `min(n × streak_step, streak_max)`: 1 chip on the first day, up to 10. A game day without a collect resets it.
- **Buying a rank collects the income so far first**, at the old rate, so a higher rank never pays for time before it was bought.
- **Work, slut and crime pay whole chips** when both ends of the range are whole chips (2 to 6 pays 2, 3, 4, 5 or 6), and hundredths otherwise. Fines are drawn the same way and stop at a zero wallet. All three are refused before the season starts and after it ends; they stay open on the final day.
- **Challenges only ask for what the season can deliver**: game-specific ones only for games that have been played this season, and multiplier ones only where that multiplier has been reached this season, so nobody gets "win 3x" on a day when only the coin flip exists. Rewards scale with difficulty from `challenge_reward_min` to `challenge_reward_max`.
- **A chat drop stays open until its shares are gone or the next drop lands.** Drops come at a random time between half and one and a half times `chat_drop_every_minutes` after the last one, and only appear on a player's request, so they only land while someone is online.
- **The end of a season waits for open rounds.** Standings freeze once no round is open, or `round_timeout_minutes` after the end, whichever comes first. Ranks are numbered by net worth, then by who reached it first.

## Shared changes needed

1. `shared/config.ts`: the full flavor-line pools from this lane (work, slut wins and fines, crime wins and fines) in place of the starters. Written in `shared/features/economy-lines.ts` until then.

## Not done yet

Everything above: work starts now.

## Open questions

None that block the lane.
