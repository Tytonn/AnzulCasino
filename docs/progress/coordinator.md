# Coordinator status

Running status for the whole build. The coordinator owns this file; the Foundation thread keeps it current while Stage 1 runs.

Last updated: 2026-11-18 05:30 UTC

## Stage

**Stage 1: Foundation.** No lane may start until the Stage 1 exit check passes on a deploy preview and `foundation` is merged to `main` with Tyton's approval.

## Threads

| Thread | Lane | Branch | Stage | Status |
| --- | --- | --- | --- | --- |
| Foundation | foundation | `foundation` | Stage 1 | Plan written. Building deliverable 1 locally. Nothing pushed yet: the repo has no `main` branch to branch from. |

## Merged to main

Nothing yet. The GitHub repo was empty on 2026-11-18 (no commits, no branches).

## Blocked

- **Pushing anything.** The repo has no `main`. A starter commit on `main` is needed before `foundation` can be pushed and a pull request opened. Asked Tyton on 2026-11-18.
- **Deploy previews.** Need the Netlify project linked to `Tytonn/AnzulCasino` (see Needs from Tyton).

## Needs from Tyton

1. OK to push one starter commit (README only) to `main`.
2. Netlify: confirm whether a Netlify project already exists. If not, import the repo once `main` exists. Steps are in `docs/progress/foundation.md`.
3. Ably: an API key in the Netlify environment variable `ABLY_API_KEY`. Steps are in `docs/progress/foundation.md`.
4. `ADMIN_BOOTSTRAP_CODE` in Netlify, with a separate Deploy Previews value that Tyton shares with the Foundation thread so it can create the first admin on the preview.

## Decisions

| Date | Decision | By |
| --- | --- | --- |
| 2026-11-18 | Starting balance is **100** chips, not 10,000. | Tyton |
| 2026-11-18 | Every absolute chip amount in the Economy and Steal tables is scaled by 1/100 to match. Percentages and rates are unchanged. Final defaults are listed below. | Tyton ("just rebalance it") |
| 2026-11-18 | **Crash becomes its own lane** in the second wave (`lane/crash`, owns `crash`). Arcade keeps Mines and Plinko. | Coordinator (Tyton delegated) |
| 2026-11-18 | Netlify plan is **Personal** (1,000 credits/month). Tyton can move to Pro (3,000) if it is really needed. | Tyton |
| 2026-11-18 | **Spec addition 1, typed bets.** Added to `docs/SPEC.md` under Games > The room model. The shared bet box takes a number or shorthand ("all", "half", "5k", "2.5k"), keeps the cursor in the box after each round so Enter places the next bet, and chips are only an animation. Built by Foundation in the game kit; every game lane uses it. | Tyton |
| 2026-11-18 | **Spec addition 2, roulette quick-bet box.** Added to `docs/SPEC.md` under Games > Roulette. `<amount> <space>` syntax ("200 odd", "600 2nd", "50 17", "all red"). Built by the roulette lane on top of the kit's amount parser. | Tyton |

### Chip defaults after the 1/100 rebalance

| Setting | Spec value | New default |
| --- | --- | --- |
| `starting_balance` | 10,000 | 100 |
| `daily_bonus` | 500 | 5 |
| `streak_step` / `streak_max` | 100 / 1,000 | 1 / 10 |
| challenge rewards | 150 to 400 | 2 to 4 |
| `rebuy_amount` / `rebuy_below` | 500 / 250 | 5 / 3 (2.5 rounded up; with whole chips "under 2.5" and "under 3" are the same) |
| `min_bet` | 10 | 1 |
| `steal_floor` | 2,500 | 25 |
| shield minimum price | 300 | 3 |
| all `*_pct` and `*_rate` values | unchanged | unchanged |

These become the code defaults in Stage 1 (deliverable 5). See the open question on rounding before they are final.

## Open questions

- **Rounding at the 100-chip scale** (raised by Foundation, 2026-11-18). Rounding payouts down to whole chips breaks the house-edge math for small bets and makes small steals and fines round to 0. Details and a recommendation are in `docs/progress/foundation.md` under Open questions.
- **Netlify credits on Personal** (raised by Foundation, 2026-11-18). The database bills about 10 credits for every hour it is awake. A live season will likely need more than 1,000 credits a month. Details in `docs/progress/foundation.md`.

## Wave plan

- First wave (after Foundation merges): blackjack, roulette, heist, economy.
- Second wave: arcade (mines, plinko), crash, slots, social, admin. At most four lanes at once.
