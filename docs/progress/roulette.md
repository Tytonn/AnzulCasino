# Roulette (Stage 2)

Branch `claude/project-thread-llyz59`: the spec names `lane/roulette`, but this thread's environment can push only to its own branch. Last updated 2026-11-19 by the Roulette thread.

## Done

- **The rules both sides share** (`shared/games/roulette.ts`): the European wheel in order, the 157 places to bet (37 numbers, 60 splits, 12 streets and the two trios with zero, 22 corners and the first four, 11 six lines, dozens, columns and the six even-money bets), their ids and names, payouts, a round's bets, the spin clock, the API's inputs and the quick-bet box parser.
- **The server** (`server/games/roulette/`): spins in `shared_rounds`, bets, taking one bet off, clearing, the draw and payouts, the room and table routes, and the daily backup sweep (`netlify/functions/roulette-sweep.ts`).
- **Tests** (`tests/roulette/unit`, `tests/roulette/integration`): every spot's payout, an exact 36/37 return on every spot, a million real draws (uniformity and return), the quick-bet syntax with the spec's examples, the clock through a timing change, and the endpoints against Postgres: payouts, refunds, the ledger, parallel bets and settles, replayed keys, late bets, empty spins, hidden data and plain-word errors.
- **The room** (`src/games/roulette/`): the wheel and the ball run from the server's clock (`ball.ts`, `Wheel.tsx`), so every screen shows the same spin and the ball comes to rest in the drawn pocket exactly at the landing. The felt (`Felt.tsx`, `layout.ts`) shows every player's chips in their color, lights what a place covers, drops a marker on the number, makes winning chips glow with what they won and sweeps the rest off. The bet panel (`Controls.tsx`) has the quick-bet box with a live reading of what you typed (and the places it would bet lit on the felt), a rack of five chip sizes, undo, clear, repeat and double, and the countdown along its top (`Status.tsx`). Seats show other players' bets on the spin. Sounds for the ball, the frets and the drop (`sounds.ts`), a tick in the last three seconds when you have chips down, and the kit's celebration for big wins.
- **Phone and desktop.** From 760 pixels of table the wheel stands beside the felt; below that the wheel is small beside the status, and on a phone the felt turns upright, the bet panel stays at the bottom, and the wheel comes up big from the close until just after it lands (tap to see the table). Click or tap to bet; right-click, or hold a finger on a chip, takes it off.
- **The replay view** (`Replay.tsx`) for History and the ticker: where the ball landed, your chips on the felt as they were, and what each bet did.
- **Browser tests** (`tests/roulette/e2e/roulette.spec.ts`, at 1440 and 375): two players at one wheel, one clicking and one typing, see each other's chips, watch the same number land and are each paid by it; and bets undone and cleared with the keys and the buttons. All four pass locally.

## Not done yet

- Nothing in the lane. The replay view is ready, and shows once the social lane's History page opens it (the ticker's lines already link to `/history/<round>`).
- On the deploy preview (pull request #5) the four browser tests pass at 1440 and 375, against the preview's own functions, database and Ably (2026-11-19).

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
- **Instant chips.** A click puts the chip on the felt at once. Moves go to the server one request at a time, and clicks that pile up meanwhile go out together in the next request, so fast clicking never waits on the network and never doubles a chip. A refusal takes those chips back off with a toast in plain words and reloads the room. Undo, clear, repeat and double are moves like any other.
- **No spoilers.** From 1.2 seconds before the close until the ball lands on screen, the bettors' news is held with the kit's reveal hold, renewed every 10 seconds since a hold lets go by itself after 15. The seats, the ticker, the wallet and the chat all wait for the wheel.
- **Chip sizes.** Five chips from a ladder (1, 5, 10, 25, 50, 100, 250, 500, 1k and up), starting at the table's minimum and climbing while a chip is at most a quarter of your chips. The size you pick, the last spin's bets (for Repeat) and your last typed bet are remembered on the device. A lone amount typed in the box becomes your chip size.
- **Keys.** Enter or Space bets what is typed, U or Backspace undoes, C clears, R repeats the last spin's bets, D doubles. After each spin the cursor is back in the box, except on touch screens, where a typed bet empties the box and a "Last bet" button brings it back.
- **Seats** name combination bets by their numbers to fit (`17/20`, `17/18/20/21`, `13-18`), and show three bets and a count of the rest.

## Open questions and notes for other lanes

- **Economy lane (season end).** Spins still open at the season's end are settled by the next roulette request or the daily sweep, possibly after the standings freeze. If the season end freezes standings, call `settleDueSpins(waitUntil, seasonId)` from `server/games/roulette/spins.ts` first.
- **Race lane.** `round.result` is declared in the shared `RoomEvents` map with roulette's payload. If race wants an event of that name with a different shape, it needs another name, such as `race.result`.
- **Ably volume.** Each bet request publishes one room event, which Ably counts once per listener in the room. Fast clicking is batched in the browser into one request at a time.

## Shared changes needed

None blocking. Batch 1 (`play.lower` and the player-scoped reveal hold) is merged in pull request #2.

- Optional, cosmetic: on a 375 pixel phone a seat's footer cuts the stake short when the result is long (`2..  +385 20.25x`). In `src/kit/Seat.tsx`, giving the stake's `<span className="truncate tabular-nums">` a `shrink-0` (or letting the footer wrap) keeps the stake whole.
