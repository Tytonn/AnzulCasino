# Heist lane

Branch `claude/project-thread-gh6sj0`. Spec: Steal, shields and vault, Shop, and Tune it before the first season. Last updated 2026-11-19 by the Heist thread.

## Done

- **Shared rules** in `shared/features/heist.ts`: the steal rate by rank gap, the daily loss cap, the take, the fine, shield and extra-attempt prices, the vault's room and typed vault amounts, season weeks, the order in which a target is refused (`checkTarget`) and the words for each refusal. The browser shows odds and reasons with the same functions the server decides with.
- **Endpoints** in `server/features/heist/`, served by `netlify/functions/heist-api.ts`:
  - `GET /api/heist/state`: your attempts, shield charges, immunity, weekly shields, vault move and loss cap, plus every other player's public defenses (immunity, cap left, whether you tried them today).
  - `GET /api/heist/steals`: the season's latest attempts.
  - `POST /api/heist/steal`, `/shield`, `/extra-attempt`, `/vault`: one keyed, locked transaction each.
- **Tests**: 35 unit tests on the rules and 41 integration tests on the endpoints (`tests/heist/`).

## Decisions

- **No new tables and no migration.** Heist uses the core tables: `daily_state` (attempts, extra bought, stolen today, net worth at the reset, vault moved), `steals`, `shields` and `shield_purchases`.
- **Lock order.** Both wallets (lower id first, `lockWallets`), then both daily rows (by user id), then the target's shield row. Steals in both directions at once never deadlock (tested).
- **Net worth at the reset** is the sum of the target's ledger rows up to the later of the reset and their first ledger row, stored in `daily_state.net_worth_at_reset` the first time they are robbed that day. A player who joined after the reset is capped on what they started with.
- **Players level on the leaderboard rob each other at the base rate**: a gap of 0 is not "behind", so it is not the down rate.
- **A shield block** uses a charge and the attempt, pays no fine and starts immunity. Only the target's own channel ever says how many charges are left: the state, the steal response, chat and the feed never include another player's charges.
- **A steal's chat post is about the thief** (`meta.userId`), so the thief's tab holds it until their reveal finishes.
- **Vault amounts** read like a bet: `max` and `all` are as much as the move allows (the room on a deposit, the whole vault on a withdrawal), `half` is half of that.
- **The final 24 hours** refuse steals, shields, the extra attempt and vault moves with a plain message.

## Not done yet

- The screens: the top-bar widget, the steal dialog and its reveal, the Shop page, the vault panel, the alerts when you are robbed.
- `scripts/simulate-season.ts` and its report.
- Browser tests at 1440 and 375.

## Shared changes needed

- **The ticker shows steal attempts** (spec rule 7: "Every attempt is saved, posted in chat and shown in the ticker"). The ticker draws only rounds today. The `steal.result` feed event carries every attempt (thief, target, outcome, amount, fine), and `GET /api/heist/steals` lists the latest ones.

## Open questions

None yet.
