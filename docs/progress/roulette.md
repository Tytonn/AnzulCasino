# Roulette

Roulette is a card in the stream (spec: Games > Roulette, changed by Tyton on Nov 22, 2026 to match UnbelievaBoat). The room was built by the Roulette thread on branch `claude/project-thread-llyz59` (pull request #5). The shell thread converted it to the card on branch `claude/project-thread-d4tv4f`. Last updated 2026-11-22 by the shell thread.

## Done

- **One round at a time, started by its first bet** (`server/games/roulette/spins.ts`). There is no clock. A bet takes the table's lock, then the season's latest round. If that round is open, the bet joins it and moves its close to `roulette_close_after_seconds` (15) from now, never past `roulette_max_open_seconds` (60) after its first bet. If it is past its close but unsettled, the bet settles it first, then opens the next round. Two first bets at once make one round.
- **The draw and settlement.** The first settle after the close draws the number with `crypto.randomInt` and pays every bet in one transaction. Bettors' browsers call it at the close; the rest read the saved number. Every bet first settles closed rounds left behind, and the daily sweep (`netlify/functions/roulette-sweep.ts`) is the backup.
- **Its one card** (`server/lib/shared-rounds.ts`, `src/games/roulette/SharedCard.tsx`). The round's first bet writes one card for everyone, with the round on it. Later bets and the draw reach every screen as `shared.updated` on `room:roulette`. While betting is open, the card shows a live countdown that starts again with each bet, and every bet under its player's name. At the close it shows "No more bets" and the wheel spins (`spin.ts`, `Wheel.tsx`, `ball.ts`) on every screen. When the ball lands it shows the number and its color large, then every player's net, winners first (`Players.tsx`). It folds 8 seconds later to "Roulette · Round 12 · 17 Black · 3 players", which opens to the result (`SharedReplay.tsx`).
- **The command** (`commands.ts`, `typed.ts`). `.roulette 50 red` (or `.rl`) bets. Several bets can go in one line split by commas (`.roulette 50 red, 25 17`), and a place without an amount takes the one before it. The message box offers 50, half and all, plus red, black, odd and even. It asks for what is missing in plain words before anything is sent.
- **News waits for the ball.** From 1.2 seconds before the close until the ball lands, every bettor's news is held: the wallet, the leaderboard, the feed and big-result posts. A hold older than 10 seconds is taken again. The spin runs outside the card, so it carries on while the card moves from the pin back into the stream.
- **Tests:**
  - unit: payouts, the 36/37 return, a million draws, typed bets and the command's messages, and the result order;
  - integration, against Postgres: open, join, extend, the 60-second cap, early and parallel settles, one transaction, a bet after the close, parallel first bets, the sweep, replays, overspending, no secret or early number, and the stream's `sharedRound` and `mine`;
  - browser, at 1440 and 375 (`tests/roulette/e2e/card.spec.ts`): two players, the countdown restarting, a third player who opens the stream mid-round, the same number on all three screens, results winners first, the wallets, and the folded line.

## Not done yet

- Nothing in the lane.

## Decisions

- **No take-backs.** The spec now says a bet cannot be taken back, so the remove and clear endpoints are gone.
- **Typed spaces only.** The card has no felt to click, so splits, streets, corners and six lines cannot be bet any more. The rules engine and the API still know all 157 places, and old rounds replay on the felt (`Replay.tsx`, `Felt.tsx`, `layout.ts`).
- **Round numbers** count from 1 in each season, and a player's round keeps its round number as `detail.spin`. `shared_rounds.result` holds `{ number, spinMs }`: the spin time is fixed when the round opens, and the number is filled in by the draw.
- **The version** of a round's view is worked out from its rounds' steps and the settle (`sharedRoundVersion` in `shared/rounds.ts`), so nothing extra is stored.
- **The countdown's bar** runs against `roulette_close_after_seconds`. Once a round reaches its 60-second limit, the card says that new bets add no time.
- **Sounds and the celebration** play for bettors only: the launch, the bounces and the drop, a tick in the last three seconds, and your own result.
- **Lock order:** the table's advisory lock (bets only), then the round's row, then players' rounds and wallets in user id order. Settling never takes the table's lock.

## Open questions and notes for other lanes

- **Economy lane (season end).** A round still open at the season's end is settled by the next roulette request or the daily sweep. If the season end freezes standings, call `settleDueSpins(waitUntil, seasonId)` from `server/games/roulette/spins.ts` first.
- **Crash and race lanes.** A shared round's card is built from `postSharedCard`, `sharedRoundView` and `sharedRoundEvent`, and the manifest's `sharedCard` and `sharedReplay` (docs/LANE_GUIDE.md, section 8).
