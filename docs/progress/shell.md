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

## Not done yet

- The stream, the command box, cards, the Blackjack card, the side panels and phone
  sheets, the spec and lane guide changes. Next pull request, on the same branch.

## Decisions

- The Admin lane owns the admin screens; this thread owns the keys, units, defaults,
  descriptions and checks (`/mnt/project-files/shell/admin-handoff.md`).
- `/audit` stays readable by every player; only `/admin` is admins only.
- The new shell keeps the `overlay` and `chat-message` slots mounted.

## Open questions

- None.
