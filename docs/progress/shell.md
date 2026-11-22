# Shell: the chat-first site

The thread "Rebuild site as a game chat". Branch `claude/project-thread-d4tv4f`.
Plan, approved by Tyton on 2026-11-22: https://claude.ai/artifact/Sj3mrj6zpw6mghyJCGt9tc

## Tyton's changes to the plan (2026-11-22)

- Work, slut and crime results are public: one compact line each in the stream with the
  player's name, the flavor line and the amount ("tyton worked as a mildly successful
  content creator and earned 59"). They show under Everything and Games only, not Chat
  only, and players can react to them. `.help` and error hints stay private.
- Two switches in the admin panel, so he can try both on the preview: whether a run of one
  player's finished rounds folds into one line or each round keeps its own line
  (`stream_round_runs`), and whether `.bal` and `.lb` reply privately or post publicly
  (`stream_bal_lb`).
- Everything else in the plan stands, including the calls listed at its end.

## Done

- **Settings first, in their own pull request** (so the Admin lane builds against real
  keys): the `choice` and `words` config units, the `commands` and `stream` groups, the
  prefix and every command's words (games still to come included), the two stream
  switches, the server refusing a word that another command has, and a `config.changed`
  event on `feed` that makes open browsers fetch `/api/config` again. Tests in
  `tests/shell/`.
- **The server side of the stream** (commit 9253b96): `play.start()` writes each round's
  `card` message in the bet's transaction and the play response carries it
  (`PlayResult.card`); `GET /api/stream` pages each filter with every card's round and
  the player's open cards; work, slut and crime post a public one-line result
  (`SystemMeta.income`); `.bal` and `.lb` post a snapshot when `stream_bal_lb` is public
  (`/api/stream/lookup`); big-result posts on a player's own round carry `onCard` and the
  stream leaves them out. One migration, `20261122002643_shell_stream_cards`.
- **The new shell** (`src/shell/stream/`): `/` is the stream, with the board (leaderboard
  and who is online with what each is doing) and You (wallet, vault, rank, timers,
  pages) beside it on a desktop, You alone between 768 and 1100px with the board as a
  drawer, and on a phone a strip (wallet, `stream-status` slot, Board, You, filter) with
  both as sheets and the account actions in You. Every page opens as a panel over the
  stream (`PagePanel`), and Escape goes back. The classic Floor, rooms, rail and ticker
  are under `/classic` (`Shell`), untouched.
- **The message box** (`Composer.tsx`, `commands.ts`): commands with their words from the
  settings, the command list as you type, quick picks for amounts and players, `@`
  mentions, a hint for the player alone for an unknown command or a missing amount, Up
  and Down through what you sent, and type-to-focus that leaves the card's letters alone.
- **Cards** (`CardItem.tsx`, `fold.ts`, `pins.ts`, `Pinned.tsx`, `src/kit/cards.ts`): one
  store of every card's round, newest version wins; a card's header keeps the result
  until the card has shown it; your card pins above the box while open and 5 seconds
  after, a newer one takes the pin from a finished one; cards fold 4 seconds after the
  result, 20 seconds after settling if never shown; big wins and all-ins stay open with a
  glow; runs fold into one line by `stream_round_runs`; folded lines open to the replay.
- **Blackjack's card** (`src/games/blackjack/StreamCard.tsx`, `commands.ts`, `stream.ts`):
  `.bj 50`, H, S, D, P, Space or Enter to turn a slow card or deal again, the slow reveal,
  sounds and celebrations for the player alone, and the reveal hold handed from the
  command to the card.
- **Commands for the economy and the heist** through their existing endpoints, and the
  shell's own: `.bal`, `.lb`, `.shop`, `.help`, `.admin`, and stand-ins for games still to
  come.
- **Docs**: the spec's layout, room model, social layer, live events, manifests, lanes and
  quality bar now say stream, cards and commands (dated Nov 22, 2026); the lane guide has
  section 20 on cards and commands, and notes in sections 3, 6, 9, 13 and 19; one line in
  `CLAUDE.md`.
- **Tests**: unit tests for the parser, the cache, the rows, folding and the retold
  lines; integration tests for card rows, the stream's filters and pages, and the income
  lines; a browser test of the stream at 1440 and 375 (`tests/shell/e2e/stream.spec.ts`:
  two players, the command list, a hint, a hand played from the pinned card and watched
  live, Deal again, folding and the replay, `.help`, `.work`, the filters, the panels and
  a page over the stream). The older browser tests open the classic rooms at `/classic`.
- Merged `main` with the Admin lane (PR #18). Its settings save bar now sits at
  `bottom-3`: the stream shell has no tab bar under the page.
- Merged `main` again with PR #16 (a `main` deploy link explains itself). CI failed once
  on the blackjack lane's double-deal test: with random cards the first hand could end
  at the deal on a dealer blackjack, which frees the table for a second hand, so the
  rest were refused for the chips left instead of the open hand. The test now stacks a
  hand that stays open (reproduced with a stacked dealer blackjack first).
- **On the deploy preview** (PR #19): every browser test passes at both sizes, with the
  chat drop and live-layer tests skipped there by design. The first run caught phone cards
  still saying "Your keys" (half of a polish commit had never landed), and its rerun met
  the hand that failure left open, so the stream test now stands on any open hand of its
  player first. Tried by hand with `test` at 1440 and `test2` at 375. The phone strip's
  status now shows whole or not at all, instead of "Work read" at 375.

- Merged `main` with whole chips (PR #20) on 2026-11-22 and pushed it at Tyton's request.
  The preview's database held hundredths, so its season was restarted to give wallets
  whole chips; posts and rounds from before the switch read 100 times too large. The
  shell's tests count whole chips now, and the stream test stands on any hand of Alice's
  that a failed test leaves open, which held up the blackjack lane's test in one run.
  On the preview after the switch, every browser test passed but the roulette lane's
  two-player test, once: it reads the table through the proxy after the number lands,
  and by then the 3-second result had given way to the next spin's betting. It passed
  on a rerun. A 50-chip hand tried by hand read +50 on the card, the fold, the wallet
  and the board.
- Rescaled the economy from a 100-chip start to 1,000 at Tyton's request (2026-11-22),
  on this branch because the blackjack preview is where Tyton tries it. Every chip
  setting in `shared/config.ts` is ten times its old default (34 keys, `min_bet` now 10),
  the test accounts fill to 10,000, and percentages, chances, cooldowns and day counts
  are unchanged. The spec, `CLAUDE.md`, the lane guide, the lanes' tests and the season
  simulation (`docs/progress/heist.md`) match. Tests that count single chips at the
  roulette table set `min_bet` to 1 themselves; the others bet 10 or more. Two tests had
  passed only because every bet in them was refused (the coin flip room, and one stream
  test); they now check that their bets went down. On the preview, season 2 (100-chip
  start) was ended and a fresh test season started at 1,000 (sample players 1,000,
  `test` and `test2` 10,000); then 52 browser tests passed and 4 skipped (the chat drop
  and the live-layer tests need the local relay).
- Still rounding to 0 or 1 at the 1,000 scale, sent to Tyton with fixes: a steal on
  someone ranked below you (0.5%) took 1 chip from a 200 to 399 wallet; the failed-steal
  fine (5% of the thief's wallet) was 0 under 20 chips and 1 under 40; the 10-chip coin
  flip paid 19, not 19.6. Tyton took all three (2026-11-22), as config: `steal_min_take`
  10 (a target a success would take less from cannot be picked, and says why),
  `steal_min_fine` 10 (or the thief's whole wallet if it holds less), and `min_bet` 25
  in every game. The spec, the lane guide (section 15: check every payout for rounding
  at the smallest bet), the tests and the season simulation follow. The tests that bet
  10 now bet 25 or more; the blackjack and coin flip lanes' tests changed amounts only.

## Not done yet

- Tyton tries the preview with `test` and `test2` (link sent 2026-11-22); nothing merges
  before Tyton approves it. The test logins are players, and this branch's preview
  database already used the admin code on PR #17's preview, so Tyton needs the sample
  admin's login, or this thread, to flip the two Stream switches there.
- Then, in order: the coin flip as a card (and the lane guide's worked example, section
  6); merge the shell; roulette as one shared card per spin (shared-round cards in the
  round helper); heist on cards; economy cards (the chat drop with Grab, Daily in You);
  remove the classic interface (Floor, rooms, rail, ticker, the kit's room-only parts).
- With the coin flip step, make `room` optional in `GameManifest`, so lanes that start
  after the merge build no room.
- Under Chat only, your own `.work` result does not show (the public line is a game
  item). Consider a private echo if Tyton finds it confusing.

## Decisions

- The Admin lane owns the admin screens; this thread owns the keys, units, defaults,
  descriptions and checks (`/mnt/project-files/shell/admin-handoff.md`).
- `/audit` stays readable by every player; only `/admin` is admins only.
- The new shell keeps the `overlay` and `chat-message` slots mounted.
- The `top-bar` slot's widgets draw in You with `compact` false; the phone strip gets one
  short status from the new `stream-status` slot (economy's "Work 2:41").
- The command list hides games still to come for the prefix alone, and shows them once
  their word is typed (`soon`).
- Pages open in the stream shell, so `/shop`, `/admin` and the rest have no classic
  version; only the Floor and the rooms are under `/classic`.

## Open questions

- None.
