# Blackjack (Stage 2)

Branch `claude/project-thread-7e0vog` (this thread can only push to that branch, so not `lane/blackjack`), pull request #4. Last updated 2026-11-19 by the Blackjack thread.

## Done

- **Rules** (`server/games/blackjack/rules.ts`, `shared/games/blackjack.ts`), as the spec has them: six fresh decks a hand, each card drawn at the moment it shows from what is left of them, dealer stands on all 17s, blackjack pays 3 to 2, double on any first two cards, split once with double after split, split aces one card each, no surrender, no insurance, the dealer peeks under an ace or a ten-value card. Only the hole card the peek needs is drawn early, into `game_rounds.secret`.
- **Endpoints** (`netlify/functions/blackjack-api.ts`): `GET /api/blackjack/room`, `POST /api/blackjack/deal` (`{ bet }`), `POST /api/blackjack/move` (`{ move, roundId, steps }`). Intents only. Double and split take their stake with `play.raise` after locking the wallet.
- **The slow reveal** (Tyton, 2026-11-19). On a bet over `blackjack_slow_reveal_pct` of the player's chips (default half), or any all-in, a hit or a double from a hard 12 or more comes out face down, lifts (`blackjack_slow_lift_ms`), then turns over (`blackjack_slow_flip_ms`). So does the dealer's hole card while a hand still waits on it. It depends on the spot, never the card, and the server has drawn the card before the animation starts. A tap or any key turns it over at once. After it lands: a gold flash and a sparkle for 21, a thud, a red pulse and a shake for a bust, a plain deal sound otherwise. The totals leave the card out until it has turned.
- **The room** (`src/games/blackjack/`): the felt measures its seat and sizes the cards to fit (`layout.ts`), so the whole table shows above the controls on a 375×812 phone and a 1366×768 laptop with friends seated. Cards fly in face down from the shoe and turn as they land, a split slides the second card to its own hand, a new deal sweeps the last hand to the discard pile first. Totals sit beside each hand; the result line sits between the rows where the felt lettering is. Hit, Stand, Double and Split (H, S, D, P) take the bet box's place during a hand, in two big rows on a narrow phone so the table keeps its size. Other seats show the player's cards, total and the dealer's card or total in one row. Floor card art and the History replay are in.
- **Tests**: rules and payouts for every outcome (`tests/blackjack/unit/rules.test.ts`), 4 million hands of basic strategy against the expected edge (`edge.test.ts`, about 12 s), the deal order, slow-reveal steps and timings (`timeline.test.ts`), the table layout (`layout.test.ts`), the endpoints against a real database with a stacked shoe (`tests/blackjack/integration`), and two players in real browsers at 1440 and 375 (`tests/blackjack/e2e`).
- **House edge**: 0.461% ± 0.018% over 40 million hands of basic strategy, which matches the published figure for these rules (about 0.46%). The test checks 4 million hands within 4.5 standard errors.

## Not done

- Tried on the deploy preview with two players: in progress when this was written.

## Decisions

- **Idle rule** (`finishIdleRounds`): a hand left longer than `round_timeout_minutes` stands. A split hand still owed its second card gets it first, then every unfinished hand stands and the dealer plays it out. The detail gets `idle: true`, and the result line says "(stood for an idle hand)". Standing never risks more chips and never needs a choice.
- Any two ten-value cards can be split (K and 10 included), as the spec says "split once" without limiting it to pairs of a rank.
- A hand that reaches 21 stands by itself. The hole card always turns over at the end of the hand, even after a bust, so the replay shows it.
- Double and split are refused once the season has ended (`season_over`), but a hand already dealt can still stand or hit to its end.
- Doubling and splitting check only the wallet, not `max_bet_pct`: the spec allows doubling any first two cards.
- The slow reveal counts as "over half" strictly: exactly half gets the kit's Big bet glow but not the slow reveal. A double from a hard 12 or more gets it too, since it is a hit.
- The dealer check under an ace or a ten takes the same time whatever is under it, so the pause gives nothing away.
- Other seats wait for `revealMs(round)` before they show a result, so nobody sees it before the player does; a deal adds the sweep time to stay on the safe side.
- No migrations: everything lives in `game_rounds.detail` and `secret`.
- The integration tests replace the shoe with a stacked one (`vi.mock` of the rules module) to deal exact cards; everything else runs for real.

## Open questions

None blocking.

## Shared changes needed

None now. The kit changes this lane needed (`holdReveal` for a player, `afterReveal`, `useRoom`'s `revealMs`, the slow-reveal config keys, the `thud` and `sparkle` sounds) landed in batch 1.
