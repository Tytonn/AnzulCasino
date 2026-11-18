# Coordinator status

Running status for the whole build. The coordinator owns this file; the Foundation thread keeps it current while Stage 1 runs.

Last updated: 2026-11-18 09:15 UTC

## Stage

**Stage 1: Foundation.** No lane may start until the Stage 1 exit check passes on a deploy preview and `foundation` is merged to `main` with Tyton's approval.

## Threads

| Thread | Lane | Branch | Stage | Status |
| --- | --- | --- | --- | --- |
| Foundation | foundation | `foundation` | Stage 1 | All 11 deliverables pushed: repo, database, accounts, wallet and ledger, config, season basics, live layer, shell, game kit, the coin flip, and `docs/LANE_GUIDE.md`, plus the shared parts of every spec addition so far. 262 unit and integration tests and 11 browser tests (two players, 1440 and 375) pass locally. Left: the exit check on the deploy preview, which waits on Tyton's three items below. Pull request #1 open as a draft. |

## Merged to main

- 2026-11-18: one starter commit (README only), with Tyton's approval, so `foundation` has a base. Commit message carries `[skip netlify]` so it costs no deploy credits.

## Netlify

- **Project:** `playanzul` (https://playanzul.netlify.app), team Tyton, created 2026-11-18 by Tyton from `Tytonn/AnzulCasino`. Production branch `main`, build settings left empty (`netlify.toml` sets them), functions directory `netlify/functions`.
- **Auto publishing is locked** (Tyton, 2026-11-18), so production only changes when Tyton publishes a deploy by hand. Deploy previews are not affected.
- **Credits and the lock** (Tyton, 2026-11-18): only a deploy that Tyton publishes to the live site is charged the 15 credits. Pushes to `main` still build while locked, cost nothing, and their deploy links open for testing. So merging to `main` is free; publishing is the step that costs, and Tyton chooses when. (Netlify's docs say "each successful production deploy consumes 15 credits" without covering the lock; the usage page under Usage & billing > Account usage insights > Credits shows the real count.)

## Blocked

- **The Stage 1 exit check** waits on Tyton's three items below. Deploy previews build on every push to pull request #1, but the build container cannot open them yet: its network blocks `*.netlify.app`. Tyton will allow the preview's hostname and the Ably hosts when he is at a computer (deferred on 2026-11-18, he was on his phone). Everything the exit check covers passes locally on the local live relay.

## Needs from Tyton

All three are needed for the exit check, the last step of Stage 1.

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
| 2026-11-18 | **Spec addition: Giveaways** (Economy > Giveaways). Chat drops, owner **economy**. Admin giveaways, owner **admin**. Rebuy stays (superseded the same day: the rebuy is removed, see Work and crime). | Tyton |
| 2026-11-18 | **Netlify project `playanzul`** created from the repo; **auto publishing locked**, so production deploys go live only when Tyton publishes them. | Tyton |
| 2026-11-18 | **Spec addition: Simulation** (Tune it before the first season). About 2,000 games per player per month with frequent all-ins, plus the rank and giveaway report. Owner: **heist** lane. | Tyton |
| 2026-11-18 | **Spec addition: Russian roulette** (Games > Russian roulette). New lane `russian-roulette`, branch `lane/russian-roulette`, owns `russian-roulette`, second wave. Turn-based player against player, the one deliberate exception to "No turns". Solo mode against the house when nobody joins. | Tyton |
| 2026-11-18 | **Spec addition: Race** (Games > Race). New lane `race`, branch `lane/race`, owns `race`, second wave. One shared race about every 75 seconds, six runners, 5% edge, typed bets like roulette. | Tyton |
| 2026-11-18 | **Spec addition: Work and crime** (Economy > Work and crime), owner **economy**. **The rebuy is removed everywhere**; work replaces it. The editable flavor lines are an admin panel item for the **admin** lane. | Tyton |
| 2026-11-18 | **Correction to Work and crime:** work has a 5-minute cooldown and pays 2 to 6 chips; crime has a 15-minute cooldown, 45% to pay 8 to 25, else a fine of 2 to 8 that stops at a zero wallet. **No rank scaling** ("a lifeline for broke players, not a main income"). Both buttons reachable from every room, cooldown on the button. The simulation compares work income with Bronze and Silver rank income and suggests new values for those ranks if work makes them pointless. | Tyton |
| 2026-11-18 | **Third income command** after UnbelievaBoat's .slut, owner **economy**: between work and crime (more than work, safer than crime), its button's name is config, results private like work and crime, a pool of at least 40 flavor lines (joke-level, suggestive at most) written by the economy lane and editable in the admin panel, and in the simulation. In code it is `hustle`; the button's name `hustle_name` starts as "Slut". | Tyton |
| 2026-11-18 | **Final work, slut and crime values** (replace every earlier number): work every 5 minutes for 2 to 6; slut every hour, 65% for 20 to 50, else a 5 to 15 fine; crime every 2 hours, 45% for 60 to 150, else a 10 to 30 fine. Fines stop at a zero wallet, the three cooldowns are separate. Intent: the longer the cooldown, the bigger and riskier the payout; work earns the most per hour, the others the most per press (a unit test checks this at the defaults). The simulation presses all three whenever ready during play hours and reports the combined income against rank income at each tier. | Tyton |
| 2026-11-18 | **`crime_chat_min` moved from 23 to 140**, the same top of the range at the final 60 to 150 crime payout. | Coordinator |
| 2026-11-18 | **Work and crime in chat:** they never post in chat and only show the result to the player who pressed. The one exception: a crime payout at the top of its range (23 chips or more at current settings) posts a short line. The threshold is config (`crime_chat_min`, default 23). | Tyton |
| 2026-11-18 | **Race odds change every race:** each race draws six runners from a larger pool of named runners with their own strengths, so the favorite and the long shot differ every time. The house edge stays 5% whatever the field. | Tyton |
| 2026-11-18 | **Spec addition: GIFs in chat** (Social layer > GIFs in chat). A Klipy GIF picker with search, trending and quick categories; GIFs load straight from Klipy; the key stays on the server behind one rate-limited endpoint; only Klipy URLs accepted; GIF replies to system posts. Owner: **social** lane, on a test key while building. Foundation only adds the `gif` chat kind and reserves `KLIPY_API_KEY`. | Tyton |

### What Foundation builds for the additions

Only the shared pieces, not the features:

- Ledger reasons `rank_purchase`, `rank_income`, `chat_drop`, `giveaway`, `steal_attempt_purchase` (the streak bonus keeps `daily_bonus`).
- Config keys for the tiers, chat drops, the extra steal attempt price and everything else in the spec, with defaults in one file.
- A `tier` column on each wallet, so shared screens (chat, leaderboard, online list, seats) can show the badge and name color. Only the economy lane writes it.
- A shop hook in the manifests, so any lane can supply shop items to the heist lane's Shop page.
- Name color and badge tokens per tier in the theme, and one shared player-name component that shows them.
- A `gif` kind for chat messages, with the Klipy id and URLs in `meta` (and `replyTo` for a GIF reply to a system post), and `KLIPY_API_KEY` in the server's environment variables. The picker, the search endpoint and the URL checks are the social lane's.
- For work, slut and crime: config keys at the final values (`work_*`, `hustle_*` for the third command, `crime_*`, and `crime_chat_min`), ledger reasons `work`, `hustle_win`, `hustle_fine`, `crime_win`, `crime_fine`, and `work_ready_at`, `hustle_ready_at`, `crime_ready_at` on each wallet. The button name (`hustle_name`, a new text kind of setting) and the flavor lines (`work_lines`, `hustle_win_lines`, `hustle_fine_lines`, `crime_win_lines`, `crime_fine_lines`, a new list-of-lines kind) are config too, so the admin lane's config editor covers them with no extra table. The line pools are short starters; the economy lane writes the full ones (40 or more for the third command) and hands them over as a shared change. A `_min` above its `_max` is refused. The rebuy's config keys, ledger reason and `daily_state.rebuy_claimed` column are gone.
- For russian roulette: config keys for the join window, turn timer, solo edge and ante cap, and ledger reasons `pvp_ante` and `pvp_pot`. For race: config keys for the betting, running and result seconds (provisional 45, 20 and 10, so 75 in all) and the 5% edge.
- In the shell (deliverable 8, done): the `top-bar` slot in feature manifests shows on desktop and phone in every room, so the economy lane adds the work, slut and crime buttons without a shared edit.

### Chip defaults after the 1/100 rebalance

| Setting | Spec value | New default |
| --- | --- | --- |
| `starting_balance` | 10,000 | 100 |
| `daily_bonus` | 500 | Replaced by Ranks (Base tier pays 5 a day) |
| `streak_step` / `streak_max` | 100 / 1,000 | 1 / 10 |
| challenge rewards | 150 to 400 | 2 to 4 |
| `rebuy_amount` / `rebuy_below` | 500 / 250 | Removed with the rebuy (work replaces it) |
| `min_bet` | 10 | 1 |
| `steal_floor` | 2,500 | 25 |
| shield minimum price | 300 | 3 |
| all `*_pct` and `*_rate` values | unchanged | unchanged |

Provisional defaults with no number in the spec (the owning lane tunes them with the simulation): extra steal attempt price, chat drop frequency, pot size and winner count.

## Context

- The players are Tyton's friend group, the **Anzul** Discord server. That is where the names come from: the site is Anzul Casino, the Netlify project is `playanzul`. Use "Anzul" in the logo and the shell. No new features follow from this.
- **Branding** (shared by Tyton, 2026-11-18): the server icon is a white stylized "A" on black, its right stroke a curved sail shape, with a four-point sparkle on the left. The wordmark is "ANZUL" in heavy capitals. The Foundation thread redraws it as a clean SVG for the shell logo and favicon (deliverable 8). The screenshot itself is not shipped.

## Open questions

- **For Tyton:** should the coin flip stay on the Floor, and with what house edge? Asked with a decision card on 2026-11-18; the Foundation thread recommends keeping it at 2%. It runs at 2% (`coinflip_edge_pct`, provisional) until he answers.
- **For the economy lane:** "unlocks day 1" most likely means the first game day of the season. The lane should confirm with Tyton before building the unlock countdown.
- ~~**For the economy lane:** what counts as an "unusually large" work or crime amount.~~ Resolved by Tyton, see Decisions.
- ~~**For the race lane:** whether each runner's odds are fixed or drawn fresh for every race.~~ Resolved by Tyton, see Decisions. Still provisional: the 45/20/10-second split of the 75-second cycle.

## Wave plan

- First wave (after Foundation merges): blackjack, roulette, heist, economy.
- Second wave: arcade (mines, plinko), crash, slots, social, admin, russian-roulette, race. At most four lanes at once.
- Production refuses a migration numbered below one it has already applied. Publishing production after a whole wave has merged, rather than between lane merges, means lanes rarely have to renumber a migration (`docs/LANE_GUIDE.md`, Migration numbers).
