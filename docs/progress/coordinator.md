# Coordinator status

Running status for the whole build. The coordinator owns this file; the Foundation thread keeps it current while Stage 1 runs.

Last updated: 2026-11-18 06:35 UTC

## Stage

**Stage 1: Foundation.** No lane may start until the Stage 1 exit check passes on a deploy preview and `foundation` is merged to `main` with Tyton's approval.

## Threads

| Thread | Lane | Branch | Stage | Status |
| --- | --- | --- | --- | --- |
| Foundation | foundation | `foundation` | Stage 1 | Deliverables 1 to 6 pushed (repo, database, accounts, wallet and ledger, config, season basics). Building deliverable 7 (live layer). Pull request #1 open as a draft. |

## Merged to main

- 2026-11-18: one starter commit (README only), with Tyton's approval, so `foundation` has a base. Commit message carries `[skip netlify]` so it costs no deploy credits.

## Netlify

- **Project:** `playanzul` (https://playanzul.netlify.app), team Tyton, created 2026-11-18 by Tyton from `Tytonn/AnzulCasino`. Production branch `main`, build settings left empty (`netlify.toml` sets them), functions directory `netlify/functions`.
- **Auto publishing is locked** (Tyton, 2026-11-18), so production only changes when Tyton publishes a deploy by hand. Deploy previews are not affected.
- **Credits and the lock** (Tyton, 2026-11-18): only a deploy that Tyton publishes to the live site is charged the 15 credits. Pushes to `main` still build while locked, cost nothing, and their deploy links open for testing. So merging to `main` is free; publishing is the step that costs, and Tyton chooses when. (Netlify's docs say "each successful production deploy consumes 15 credits" without covering the lock; the usage page under Usage & billing > Account usage insights > Credits shows the real count.)

## Blocked

- Nothing blocks the build. Deploy previews build on every push to pull request #1, but the build container cannot open them yet: its network blocks `*.netlify.app`. Tyton will allow the preview's hostname and the Ably hosts when he is at a computer (deferred on 2026-11-18, he was on his phone). Until then everything is tested locally.

## Needs from Tyton

All three can wait until Tyton is at a computer; local tests cover the work until then.

1. Ably: an API key in the Netlify environment variable `ABLY_API_KEY` (needed to test deliverable 7 on the preview). Steps in `docs/progress/foundation.md`.
2. `ADMIN_BOOTSTRAP_CODE` in Netlify, with a separate Deploy Previews value that Tyton shares with the Foundation thread (needed to create the first admin on the preview).
3. Network access for the build container: the preview hostname and the Ably hosts (an approval card from the Foundation thread).

## Decisions

| Date | Decision | By |
| --- | --- | --- |
| 2026-11-18 | Starting balance is **100** chips, not 10,000. | Tyton |
| 2026-11-18 | Every absolute chip amount in the Economy and Steal tables is scaled by 1/100. Percentages and rates are unchanged. Written into `docs/SPEC.md`. | Tyton ("just rebalance it") |
| 2026-11-18 | **Crash becomes its own lane** in the second wave (`lane/crash`, owns `crash`). Arcade keeps Mines and Plinko. Written into the lane tables in `docs/SPEC.md`. | Coordinator (Tyton delegated) |
| 2026-11-18 | Netlify plan is **Personal** (1,000 credits/month). Tyton can move to Pro (3,000) if it is really needed. | Tyton |
| 2026-11-18 | **Spec addition: typed bets.** Games > The room model. The shared bet box takes a number or shorthand ("all", "half", "5k", "2.5k"), keeps the cursor in the box after each round, and chips are only an animation. Built by Foundation in the game kit; every game lane uses it. | Tyton |
| 2026-11-18 | **Spec addition: roulette quick-bet box.** Games > Roulette. `<amount> <space>` syntax. Built by the roulette lane on the kit's amount parser. | Tyton |
| 2026-11-18 | **Starter commit on `main`** (README only), then `foundation`. | Tyton |
| 2026-11-18 | **Chips are tracked in whole hundredths** (still `bigint`, no floats). Payouts, steals and fines round down to a whole hundredth. Cents show only when an amount is not whole. Rule 2 in `docs/SPEC.md` amended. Bets may have cents too, so "all" really is all. | Tyton |
| 2026-11-18 | **Credits:** the database sleeps whenever nobody is playing, and merges stay batched. Tyton decides on auto-recharge himself. | Tyton |
| 2026-11-18 | **Spec addition: Ranks** (Economy > Ranks). Replace the flat daily bonus; streak bonus stays. Owner: **economy** lane. In code they are called tiers, because "rank" already means leaderboard place. | Tyton |
| 2026-11-18 | **Spec addition: Shop** (Steal, shields and vault > Shop). Ranks, shield charges, one extra steal attempt per game day. Owner: **heist** lane (the page); other lanes supply items through their manifests. | Tyton |
| 2026-11-18 | **Spec addition: Giveaways** (Economy > Giveaways). Chat drops, owner **economy**. Admin giveaways, owner **admin**. Rebuy stays. | Tyton |
| 2026-11-18 | **Netlify project `playanzul`** created from the repo; **auto publishing locked**, so production deploys go live only when Tyton publishes them. | Tyton |
| 2026-11-18 | **Spec addition: Simulation** (Tune it before the first season). About 2,000 games per player per month with frequent all-ins, plus the rank and giveaway report. Owner: **heist** lane. | Tyton |
| 2026-11-18 | **Spec addition: GIFs in chat** (Social layer > GIFs in chat). A Klipy GIF picker with search, trending and quick categories; GIFs load straight from Klipy; the key stays on the server behind one rate-limited endpoint; only Klipy URLs accepted; GIF replies to system posts. Owner: **social** lane, on a test key while building. Foundation only adds the `gif` chat kind and reserves `KLIPY_API_KEY`. | Tyton |

### What Foundation builds for the additions

Only the shared pieces, not the features:

- Ledger reasons `rank_purchase`, `rank_income`, `chat_drop`, `giveaway`, `steal_attempt_purchase` (the streak bonus keeps `daily_bonus`).
- Config keys for the tiers, chat drops, the extra steal attempt price and everything else in the spec, with defaults in one file.
- A `tier` column on each wallet, so shared screens (chat, leaderboard, online list, seats) can show the badge and name color. Only the economy lane writes it.
- A shop hook in the manifests, so any lane can supply shop items to the heist lane's Shop page.
- Name color and badge tokens per tier in the theme, and one shared player-name component that shows them.
- A `gif` kind for chat messages, with the Klipy id and URLs in `meta` (and `replyTo` for a GIF reply to a system post), and `KLIPY_API_KEY` in the server's environment variables. The picker, the search endpoint and the URL checks are the social lane's.

### Chip defaults after the 1/100 rebalance

| Setting | Spec value | New default |
| --- | --- | --- |
| `starting_balance` | 10,000 | 100 |
| `daily_bonus` | 500 | Replaced by Ranks (Base tier pays 5 a day) |
| `streak_step` / `streak_max` | 100 / 1,000 | 1 / 10 |
| challenge rewards | 150 to 400 | 2 to 4 |
| `rebuy_amount` / `rebuy_below` | 500 / 250 | 5 / 3 |
| `min_bet` | 10 | 1 |
| `steal_floor` | 2,500 | 25 |
| shield minimum price | 300 | 3 |
| all `*_pct` and `*_rate` values | unchanged | unchanged |

Provisional defaults with no number in the spec (the owning lane tunes them with the simulation): extra steal attempt price, chat drop frequency, pot size and winner count.

## Context

- The players are Tyton's friend group, the **Anzul** Discord server. That is where the names come from: the site is Anzul Casino, the Netlify project is `playanzul`. Use "Anzul" in the logo and the shell. No new features follow from this.
- **Branding** (shared by Tyton, 2026-11-18): the server icon is a white stylized "A" on black, its right stroke a curved sail shape, with a four-point sparkle on the left. The wordmark is "ANZUL" in heavy capitals. The Foundation thread redraws it as a clean SVG for the shell logo and favicon (deliverable 8). The screenshot itself is not shipped.

## Open questions

- **For the economy lane:** "unlocks day 1" most likely means the first game day of the season. The lane should confirm with Tyton before building the unlock countdown.

## Wave plan

- First wave (after Foundation merges): blackjack, roulette, heist, economy.
- Second wave: arcade (mines, plinko), crash, slots, social, admin. At most four lanes at once.
