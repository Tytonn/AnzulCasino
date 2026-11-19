# Roulette (Stage 2)

Branch `claude/project-thread-llyz59`: the spec names `lane/roulette`, but this thread's environment can push only to its own branch. Last updated 2026-11-19 by the Roulette thread.

## Done

- **The rules both sides share** (`shared/games/roulette.ts`): the European wheel in order, the 157 places to bet (37 numbers, 60 splits, 12 streets and the two trios with zero, 22 corners and the first four, 11 six lines, dozens, columns and the six even-money bets), their ids and names, payouts, a round's bets, the spin clock, the API's inputs and the quick-bet box parser.
- **The server** (`server/games/roulette/`): spins in `shared_rounds`, bets, taking one bet off, clearing, the draw and payouts, the room and table routes, and the daily backup sweep (`netlify/functions/roulette-sweep.ts`).
- **Tests** (`tests/roulette/unit`, `tests/roulette/integration`): every spot's payout, an exact 36/37 return on every spot, a million real draws (uniformity and return), the quick-bet syntax with the spec's examples, the clock through a timing change, and the endpoints against Postgres: payouts, refunds, the ledger, parallel bets and settles, replayed keys, late bets, empty spins, hidden data and plain-word errors.

## Not done yet

- The room: wheel, felt, controls, celebrations and the replay view.
- Browser tests at 1440 and 375, and a pass on the deploy preview.

## Decisions

- **Payouts.** Every bet returns its stake times 36 divided by how many numbers it covers: 35, 17, 11, 8, 5, 2 and 1 to 1 as the spec lists. 36 divides by every bet's size, so nothing is ever rounded, and each bet returns exactly 36/37 (the spec's 2.7% edge).
- **Spot ids** travel and are saved: a number (`"17"`), a combination's numbers lowest first joined by dashes (`"17-20"`, `"0-1-2"`, `"13-14-15-16-17-18"`), `1st12`/`2nd12`/`3rd12`, `col1`/`col2`/`col3`, and `red`, `black`, `odd`, `even`, `low`, `high`.
- **One shared row per spin**, created by the spin's first bet with `on conflict do nothing`, so a spin nobody bets on saves nothing (spec: Empty rounds). Its `result` holds `{ timing, number }`: the timings it ran with, and the number once drawn. `state` goes `betting` to `settled`. `secret` is never used: the number does not exist until it is drawn.
- **The clock.** With no spin saved yet, spin n opens at season start + n times the cycle, the spec's formula. Once spins are saved, the schedule continues from the latest one at the timings in force now, so an admin changing the timings mid-season moves the wheel on from there instead of renumbering spins that already ran. Without a change it equals the spec's formula. The browser sends the spin it is betting on, and the server refuses any other with its clock attached, so a browser whose clock drifted puts itself right.
- **A player's bets on one spin are one game round**: the first bet starts it, and every later request raises it. Typed amounts are resolved on the server one after another against what is left, so "10 black, all red" bets the rest on red, and each bet passes the limits on its own. Taking one bet off uses `play.lower`; clearing every bet refunds the round.
- **Lock order**: the spin row (for share to bet, for update to settle), then a per-player advisory lock for bets (so two quick requests never both open a round), then players' rounds, then wallets in user id order. Settling never takes the advisory lock, so nothing waits in a circle.
- **Settling.** Browsers in the room call settle at the close; the first draws and pays everyone in one transaction and the rest read the saved result. Every roulette request also settles closed spins left behind (among the season's latest 50), so nothing waits on a timer. The daily sweep at 09:00 UTC is the backup and only runs on published deploys.
- **Room events.** `round.result` carries the number, the spin's times and the clock, and goes out before the players' `round.settled`. The spec also lists `bet.placed`, `bet.cleared` and `round.closed`: the round helper's `round.started`, `round.action` and `round.settled` (void after a clear) already carry every bet in each player's round, and the close is on the clock every browser shares, so they are not sent.
- **The quick-bet box** reads the spec's `<amount> <space>` and its examples. Also: several bets split by commas or semicolons ("50 red, 10 17"), the place first when only that reading works ("red 50"), friendly words ("green", "2nd dozen"), a lone number sets the chip size for clicking, and a lone place bets the chip size there. Combinations typed out get a plain-word note that they are click-only.
- **Rate limit**: bet and remove allow 240 requests a minute instead of 120, since clicking chips onto the felt is fast.

## Open questions and notes for other lanes

- **Economy lane (season end).** Spins still open at the season's end are settled by the next roulette request or the daily sweep, possibly after the standings freeze. If the season end freezes standings, call `settleDueSpins(waitUntil, seasonId)` from `server/games/roulette/spins.ts` first.
- **Race lane.** `round.result` is declared in the shared `RoomEvents` map with roulette's payload. If race wants an event of that name with a different shape, it needs another name, such as `race.result`.
- **Ably volume.** Each bet request publishes one room event, which Ably counts once per listener in the room. Fast clicking is batched in the browser into one request at a time.

## Shared changes needed

None outstanding. Batch 1 (`play.lower` and the player-scoped reveal hold) is merged in pull request #2.
