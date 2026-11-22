# Heist lane

Branch `claude/project-thread-gh6sj0`. Spec: Steal, shields and vault, Shop, and Tune it before the first season. Last updated 2026-11-19 by the Heist thread.

## Done

- **Shared rules** in `shared/features/heist.ts`: the steal rate by rank gap, the daily loss cap, the take, the fine, shield and extra-attempt prices, the vault's room and typed vault amounts, season weeks, the order in which a target is refused (`checkTarget`) and the words for each refusal. The browser shows odds and reasons with the same functions the server decides with.
- **Endpoints** in `server/features/heist/`, served by `netlify/functions/heist-api.ts`:
  - `GET /api/heist/state`: your attempts, shield charges, immunity, weekly shields, vault move and loss cap, plus every other player's public defenses (immunity, cap left, whether you tried them today).
  - `GET /api/heist/steals`: the season's latest attempts.
  - `POST /api/heist/steal`, `/shield`, `/extra-attempt`, `/vault`: one keyed, locked transaction each.
- **Screens** in `src/features/heist/` (manifest: the `/shop` route and the `top-bar`, `profile-actions`, `overlay` and `shop-items` slots):
  - Top bar: two buttons built like the economy's beside them, an icon over one short value, 3.1rem wide on desktop and 2.75rem on a phone. Steals shows your attempts left as pips (opens the heist panel). Shield shows your charges as pips, or your immunity as a short countdown (`2h05`, `4:59`) with a bar draining along the bottom (opens Defend). The full story is in each button's label and tooltip.
  - The heist panel (right sheet on tablet and desktop, bottom sheet on phone): Rob (every player with what a steal would take, or why not), Defend (shield, immunity, today's losses against the cap, the vault) and Log (the season's attempts, live).
  - The steal dialog: you against them, the odds from config, then the vault being cracked while the request is out (the dial clicks through a combination; tap, Enter or Escape skips). The door swings open and chips burst out and fly to your wallet, the alarm goes off, or a shield slams down. Its news (leaderboard, ticker, chat) waits for the reveal.
  - The Shop page: every lane's `shop-items` (heist adds the shield charge and the extra attempt), the vault panel and how heists work, with the numbers from config. Keys: R picks a target, S buys a charge, E buys the extra attempt.
  - Alerts for the target the moment it lands: robbed, shield blocked, or caught (their fine is yours), each with Rob back.
  - Rob on another player's card, with the amount or the reason.
- **Tests**: 35 unit tests on the rules, 56 integration tests on the endpoints, and browser tests at 1440 and 375 (`tests/heist/e2e/heist.spec.ts`: the Shop, a shield charge, a vault move, the panel, and a steal from start to end with the target watching, whatever the outcome). On a preview they adapt to what earlier runs left behind (charges full, vault moved, attempts used).
- **The season simulation**: `node scripts/simulate-season.ts [--runs 1000] [--seed 1] [--json out.json]`. Results below.

## Decisions

- **No new tables and no migration.** Heist uses the core tables: `daily_state` (attempts, extra bought, stolen today, net worth at the reset, vault moved), `steals`, `shields` and `shield_purchases`.
- **Lock order.** Both wallets (lower id first, `lockWallets`), then both daily rows (by user id), then the target's shield row. Steals in both directions at once never deadlock (tested).
- **Net worth at the reset** is the sum of the target's ledger rows up to the later of the reset and their first ledger row, stored in `daily_state.net_worth_at_reset` the first time they are robbed that day. A player who joined after the reset is capped on what they started with.
- **Players level on the leaderboard rob each other at the base rate**: a gap of 0 is not "behind", so it is not the down rate.
- **A shield block** uses a charge and the attempt, pays no fine and starts immunity. Only the target's own channel ever says how many charges are left: the state, the steal response, chat and the feed never include another player's charges.
- **A steal's chat post is about the thief** (`meta.userId`), so the thief's tab holds it until their reveal finishes.
- **Vault amounts** read like a bet: `max` and `all` are as much as the move allows (the room on a deposit, the whole vault on a withdrawal), `half` is half of that.
- **The final 24 hours** refuse steals, shields, the extra attempt and vault moves with a plain message.

- **The browser never polls.** The heist state is fetched once and kept current from live events: `steal.result` on the feed patches the log, the target's immunity and cap and the thief's attempts; `shield.blocked` sets your charges; `heist.changed` (your shield, extra attempt or vault in another tab) refetches. The 4:00 AM reset and the week's end roll over in the browser, so an idle tab never wakes the database.
- **Your own steal counts once.** The thief's tab gets no `heist.changed` for a steal (the feed tells their other tabs), the answer carries `attemptsUsed` (set, not added), and any refetch waits for your reveal to end.
- **The steal dialog is its own celebration.** It does not call the kit's `celebrate()` banner, which would sit on top of the dialog's own amount. A haul worth a tenth of your net worth or more is a "Big score": twice the chips, a gold glow and the big-win fanfare.
- **The top-bar buttons match the economy's** (merged PR #3 had wider pills with a STEALS or SHIELD caption, 62 to 102px): with seven buttons in the row, the shield was cut off at 1440. They now match the economy's sizes (PR #9: 3.1rem on desktop, 2.75rem on a phone), and the captions moved into the labels.
- **Out of attempts, the extra attempt is offered only for a player it would let you rob.** Anyone you already tried today, or who is immune or too poor, shows that reason on their card, in the Rob list and in the steal dialog instead. The browser tests found it on a preview whose database an earlier run had left with Alice out of attempts.
- **Opening the steal dialog closes the profile card and the panel** (stacked sheets would all close on one Escape). "Rob someone else" opens the panel again.
- **A steal too small to take a whole chip is not offered** (since 2026-11-22, when chips became whole again). `checkTarget` refuses it as `too_little`, shown as "Small wallet" with a plain reason, and the attempt is not used. At the 0.5% down rate that is any target below you with under 200 chips in the wallet; at the 1.5% base rate, under 67. Vault amounts round down like bets, and a vault move under a chip says "Type at least 1 chip."

## Season simulation (1,000 seasons, seed 1, config defaults)

_Rerun on 2026-11-22 with whole chips (first run 2026-11-19 in hundredths). Little moved. Payouts round down to a whole chip, so small bets pay a little less (a 10-chip coin flip win pays 19, not 19.6) and a little less is won at the tables; rank income now carries the part of a chip still building, like the site._

Ten bots: two steady grinders (small bets, vault, shields while top three), two all-in gamblers (15% of games all in), two constant thieves (every attempt plus the extra), a leader who stops logging in (gone once first on day 7 or later, or on day 12), a casual player, and two identical steady players of whom one buys every rank as early as possible and one never buys. About 2,000 games each a season (78 a day online), the three income buttons pressed whenever ready while online.

| Question | Result |
| --- | --- |
| The leader on day 20 wins the season | 52.4% |
| A week's leader loses to steals that week | average 8.9%, 95th percentile 19.0%, worst 24.9% (robbed to the cap every day is 24.9%) |
| A successful steal for a bottom-half player | median 54% of their net worth (middle half 16% to 210%: they are often nearly broke after an all-in) |
| Steals against the tables | 5,359 chips moved by steals a season against 1.18M won and lost at the tables: 0.5%. Gambling stays far bigger |
| Chip supply (median, end of day) | day 1: 1.7K, day 7: 3.7K, day 14: 6.1K, day 21: 7.9K, day 28: 9.7K, day 30: 10.3K |
| Bonuses against winnings in week four | 39.3K paid in (rank income 21.4K, buttons 16.7K, streak and challenges 0.8K, drops 0.4K) against 170K won at the tables: 23%. Bonuses do not swamp winnings |
| Where chips come from | work, slut and crime 58%, rank income 38%, streak and challenges 2.4%, chat drops 1.4%, starting balances 0.8% |
| Early rank buyer against the same player who never buys | ahead in 62% of seasons; median finish 218 against 121 |
| The leader who stops logging in | left in first place 14% of the time; then kept 56% of their net worth by the end (median, worst 45%) and still won 16% of those seasons |

Ranks: Bronze and Silver are bought on their unlock days (1 and 3) in every season, Gold in 93% (first on day 12, median), Platinum in 13% (day 22), Diamond in 0.5%, Crown never. At the end an average season has 6.3 Silver, 2.0 Gold and 0.1 Platinum holders. **Flag: Crown is bought by nobody in 1,000 seasons**, and Diamond almost never.

Work, slut and crime against rank income: the buttons pay about 104 chips for an hour online a day, 171 for two hours and 342 for four (measured: 297 a day for a player online that day). Bronze's 15 a day is 0.14x an hour of buttons, Silver's 100 is about 1x, Gold's 1,000 is about 10x.

What it suggests for the tuning session with Tyton (no config changed):

- **Diamond and Crown are out of reach.** Each rank costs 100 days of the income of the rank below it, so only big wins at the tables move a player up, and the climb stops at Silver or Gold for most and Platinum for a few. If the top ranks should be reachable by the season's best player, cut Diamond and Crown's prices about tenfold, or make each rank cost fewer days of the one below.
- **The buttons are the biggest source of chips**, more than rank income, and they reward hours online over play. That is the "lifeline" working for broke players, but a player who sits online four hours earns about three Silver ranks' worth a day.
- **Steals are a spice, not a strategy**: leaders lose about 9% a week, never more than the cap allows, and the tables move about 200 times more chips.
- **The vault protects players from their own all-ins** as much as from thieves: the two grinders, the only bots that use it, win about 80% of seasons between them.

## Not done yet

Nothing in the lane. The browser tests also pass against the deploy preview (4 of 4 on 2026-11-19; the first run signed up the sample players and started a season). The config changes the simulation suggests wait for the tuning session with Tyton.

## Shared changes needed

None. The ticker now shows steal attempts (batch 2, merged in PR #7).

## Open questions

None that block the lane. The simulation's flags above are for the tuning session (spec: Build order, step 5).
