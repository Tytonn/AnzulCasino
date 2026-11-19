# Economy (Stage 2)

Branch `claude/project-thread-bwe5nz` (the session's branch; the spec names it `lane/economy`). Owns the names `economy` and `season`. Spec sections: Economy; Accounts and seasons.

Last updated: 2026-11-19 by the Economy thread.

## Status

Merged to `main` in pull request #6 on 2026-11-19, with Heist and Roulette. The follow-up pull request from the same branch (#9) makes the economy's top-bar buttons fit beside Heist's, gives Crime a pair of handcuffs so it no longer looks like Heist's Steals mask, and lays the rank card across the Shop. With shared changes batch 4 (pull request #11) and Heist's compact Steals and Shield (pull request #10), the top bar's six buttons fit at every width: they need 377px on desktop and 338px on a phone, sit beside the wallet at 1440, move under the header from 1280 down to 768, and fit in one row at 375. A later fix keeps the newer economy state when a refresh that read the state before a press lands after the press's answer: the Blackjack thread saw Work show as ready again once in a browser run, and a unit test now holds that race. The chat-drop timing test checks every possible draw once instead of averaging random ones, which missed about 1 run in 150. Unit, integration and browser tests pass locally at 1440 and 375, and the browser tests pass on deploy previews too (the chat drop and the Hall of Fame's sample season need the local database, so on a preview they are skipped or check what is there).

## What is built

The server decides every outcome, every chip moves through `server/lib/wallet.ts` with one ledger row, and nothing runs on a timer.

1. **Shared rules** (`shared/features/economy.ts`, `shared/features/season.ts`): types, input schemas, live events, and the pure math: rank income and its cap, the streak bonus, work, slut and crime draws, the challenge pool and progress, the drop split, unlock times, the final-day start.
2. **Tables** (`db/schema/economy.ts`, migration `20261119203212_economy_init`):
   - `economy_players`: when each player last collected rank income, and a version for live news.
   - `economy_drops`, `economy_drop_claims`: chat drops and who grabbed them. The next drop's time is a row nobody can read until it lands.
   - `economy_announcements`: one-time chat posts per season (each rank unlock, the final day, the end).
   - Cooldowns live on `wallets` (`work_ready_at`, `hustle_ready_at`, `crime_ready_at`, from the foundation).
3. **Endpoints** (`/api/economy/*`, served by `netlify/functions/economy-api.ts`):
   - `GET /api/economy/state`: the player's rank, income, streak, cooldowns, challenges, recent drops and activity.
   - `POST /api/economy/work`, `/hustle`, `/crime`: the three income buttons, with cooldowns checked in the database. Fines stop at an empty wallet.
   - `POST /api/economy/collect`: rank income since the last collect (capped at `tier_income_cap_hours`) and today's streak bonus.
   - `POST /api/economy/tier`: buys the next rank: unlocked, one per game day, never on the final day, collecting income at the old rate first.
   - `POST /api/economy/challenges/claim`: pays a finished challenge.
   - `POST /api/economy/drops/claim`: grabs a share of the open chat drop.
   - `GET /api/economy/hall-of-fame`: every finished season's frozen standings, and a season whose standings are still being settled.
4. **Season lifecycle, lazily** (`server/features/season/`): the two GETs move seasons on. The first request in the final day sets `final_day` and posts it; the first request after the end freezes the standings into `season_results` once no round is open (or `round_timeout_minutes` after the end), sets `ended` and posts the podium. Rank unlocks and chat drops land the same way. Each instance remembers when the next moment is due (`moments.ts`), so a request costs no extra query until then.
5. **Screens**:
   - `src/features/economy/`: the top-bar buttons (Collect, the joined Work · Slut · Crime group, Daily) with cooldowns and progress on the buttons, Crime drawn as handcuffs since the mask is Heist's Steals, 3.1rem wide on desktop and 2.75rem on a phone, fixed so a ticking countdown never moves its neighbours; the result card with the flavor line; the Daily panel (popover on desktop, sheet on a phone) with Collect, the streak, challenges, the rank row or every rank, and recent results; the Shop's rank card (`shop-items`), across the Shop's whole width with the ranks in two columns; the Grab button under a drop's chat post and the drop pill at the top of every page; Shift shortcuts (W, S, C, I, D).
   - `src/features/season/`: the final-day banner (countdown, what is off, a line that runs down with the day); the between-seasons banner (winner, the player's finish, the next season's start, or "being settled"); the podium screen, which opens by itself once per season and from the banner after that; and `/hall-of-fame` (latest season with podium and table, earlier seasons that open, most titles, empty and loading states, a podium replay).
6. **Tests**: `tests/economy/unit` (math, pools, wording), `tests/economy/integration` (every endpoint: parallel and replayed requests, hidden data, refusals, the lifecycle), `tests/economy/e2e` (the buttons, Collect, the Daily panel, a chat drop two players race for, the final day, the Hall of Fame and podium; at 1440 and 375).

## Decisions

- **"Unlocks day 1" means the season's first game day**, as `shared/config.ts` already describes the unlock-day settings. Bronze can be bought from the start, Silver from the third game day, and so on. The unlock days are config.
- **One Collect pays both** the rank income and today's streak bonus (two ledger rows, `rank_income` and `daily_bonus`).
- **The streak bonus** for day _n_ of a streak is `min(n × streak_step, streak_max)`: 1 chip on the first day, up to 10. A game day without a collect resets it.
- **Buying a rank collects the income so far first**, at the old rate, so a higher rank never pays for time before it was bought.
- **Work, slut and crime pay whole chips** when both ends of the range are whole chips, and hundredths otherwise. Fines are drawn the same way and stop at a zero wallet. All three are refused before the season starts and after it ends; they stay open on the final day.
- **Challenges only ask for what the season can deliver**: game-specific ones only for games played this season, and multiplier ones only where that multiplier has been reached this season. Rewards scale with difficulty from `challenge_reward_min` to `challenge_reward_max`.
- **A chat drop stays open until its shares are gone or the next drop lands.** Drops come at a random time between half and one and a half times `chat_drop_every_minutes` after the last one, and only on a player's request, so they land while someone is online.
- **The end of a season waits for open rounds.** Standings freeze once no round is open, or `round_timeout_minutes` after the end, whichever comes first. Places are numbered by net worth, then by who reached it first.
- **The final-day post says the time actually left**, since it goes up on the first request in the final day, which may come hours in.
- **The podium opens by itself once per season per player in each browser** (remembered in localStorage, or for the visit when storage is off). The banner's Podium button and the Hall of Fame's Replay open it again.
- **Before the first season starts nothing extra shows**: the top bar's clock and the Floor already say when it starts. The banner covers the final day and the time between seasons.

## Shared changes needed

1. ~~`shared/config.ts`: the full flavor-line pools.~~ Done in shared changes batch 2 (pull request #7); `shared/features/economy-lines.ts` is gone.
2. `src/shell/layout/TopBar.tsx`, `PhoneTopBar`: the phone's row of top-bar widgets shows whenever a lane has registered one, even when every widget draws nothing. Between seasons the economy's buttons go, which leaves an empty 44px row under the phone's header. Adding `empty:hidden` to that row's `div` fixes it for every lane. Done in shared changes batch 3 (pull request #8).

## Not done yet

- Nothing.

## Open questions

None that block the lane.
