# Admin (Stage 2)

Branch `claude/project-thread-i6txqj` (the session's branch; the spec names it `lane/admin`). Owns the name `admin`. Spec sections: Admin and trust; Economy > Giveaways (admin giveaways); the work and crime names and lines (Admin panel).

Last updated: 2026-11-22 by the Admin thread.

## Status

Built and tested locally, and up for review as PR #18: the whole server side, the admin panel, the public Audit page, and their unit, integration and browser tests. Started 2026-11-22, after Tyton's direction change to a chat-first site. The shell thread ("Rebuild site as a game chat", branch `claude/project-thread-d4tv4f`) owns the new stream and the command settings (merged in PR #17); its handoff is in the project files (`shell/admin-handoff.md`). Both pages stand alone, so they work in the classic shell today and as a panel over the stream later.

## Done

### Server: `/api/admin/*` (served by `netlify/functions/admin-api.ts`)

Every route needs a session and is rate-limited; every change needs `auth: 'admin'`, is idempotent (one request key per intent, so a double click changes nothing), runs in one transaction and writes its audit row in it. Live news goes out after the commit.

| Route | Who | What |
| --- | --- | --- |
| `GET /api/admin/players` | admin | Every account, disabled ones too: role, last seen, wallet, vault and rank tier in the current season |
| `POST /api/admin/players/:id/disable`, `/enable` | admin | Disables an account and ends its sessions, or lets it back in. Never yourself |
| `POST /api/admin/chips` | admin | A manual adjustment with a required reason: one `admin_adjust` ledger row, a chat post naming the admin, the player, the amount and the reason, and a note to the player. Taking more than the wallet or vault holds is refused with the amount there |
| `POST /api/admin/giveaways` | admin | Chips to chosen players or everyone, the same amount each, or a pot split between them, rounded down to a whole chip. One `giveaway` ledger row each, one chat post with names and amounts, a note to each player |
| `GET /api/admin/config`, `POST /api/admin/config` | admin | Every setting in force, the changes waiting for the next reset, and who last changed each. A save sends several changes in one transaction through `changeConfig`, in whichever order works (a minimum and its maximum together, a word moved from one command to another), with an optional reason. A refusal names its key, so the editor shows it on that row |
| `POST /api/admin/seasons/:id/end` | admin | Ends the running season early: at once, or at a chosen time before its end. Posts in chat; an end at once also moves the season to its podium right away |
| `PATCH /api/admin/seasons/:id` | admin | Renames any season; changes the dates and starting chips of one that has not started, with the same overlap checks as creating one |
| `GET /api/admin/audit` | every player | The audit log, newest first, a page at a time, filtered by kind (chips, settings, seasons, accounts, chat), with names resolved, plus the setting changes waiting for the next reset |

Every audit row also goes out live as `audit.logged` on the feed channel. Invite codes, reset codes and new seasons use the foundation's `/api/invites` and `/api/seasons`, which audit what needs it. No new tables or migrations.

### Pages

- **`/admin`** (admins only), five tabs:
  - **Players**: each account's chips, vault, last visit and badges; Adjust chips (add or take, wallet or vault, a required reason, and the chat post and the player's note shown before saving); Reset code; Disable and Enable with an optional reason.
  - **Giveaway**: everyone or picked players, the same amount each or a pot split, a note, a summary (each, players, in all, what a split leaves over), the chat post, and a second yes before anything moves.
  - **Settings**: every key in `shared/config.ts`, by section, drawn by its unit (chips, percentages, counts and times with their unit, the prefix, a command's words as chips with its name starred, lines, the two stream switches). Each row shows its default, the value in force while a change waits for the reset, who changed it last, and Undo, Take it back and Use the default. Search, section links, a save bar with a reason, Ctrl or Cmd+S, and a warning before leaving with unsaved changes. A word two commands share, a number out of range or a bad prefix shows on its row before a save.
  - **Seasons**: every season with its phase; End early (now, or at a sooner time, with the chat post shown and a warning that it cannot be undone); Change or Rename; Schedule a season, starting by default right when the last one ends.
  - **Codes**: new invite codes with a message to send (the sign-up link and the code), used and unused codes.
- **`/audit`** (everyone): the setting changes coming at the next reset, then every admin action as a sentence ("Tyton gave Alice 10 chips"), with its reason, the numbers before and after, grouped by day, filtered by kind, new actions arriving live, older ones loading as you scroll.

### Tests

- Unit (47, `tests/admin/unit`): giveaway shares, every chat post and note, the input schemas, the settings editor (sections cover every key, names and descriptions in words, every unit typed and read back), the Audit page sentence for every action, and its live list (an entry lands once and in order, and a refresh read before an entry was saved never drops it).
- Integration (37, `tests/admin/integration`): every route against a real Postgres, as listed above.
- Browser (6 tests at 1440 and 375, `tests/admin/e2e`): a chip added and taken back while another player watches the Audit page, a giveaway reaching its player, a setting flipped, refused words caught, the leave warning, saved and put back, an invite code made and copied, the end-season dialog opened and cancelled, and a player kept out of the panel. Each leaves the chips and settings as it found them, so it runs again on a preview.

## Not done

- Nothing in the lane. On PR #18's deploy preview the first browser run passed 11 of 12; the twelfth caught the Audit page race described under Decisions, fixed with its unit tests in the commit that adds this note. The rerun is recorded on the pull request.

## Decisions

- **End early only moves the end earlier.** A season that has not started is edited instead; a season cannot be deleted, because its audit rows point at it.
- **Giveaways and adjustments need a running season**, since wallets belong to one; after the end, chips are final. A player without a wallet yet joins the season first, with the starting chips, as on their next visit.
- **A split pot rounds each share down to a whole chip**; the remainder is not given, and a pot too small for a chip each is refused.
- **Admin amounts are exact whole chips** (since 2026-11-22): a typed decimal point is refused with a plain answer instead of being rounded.
- **An admin can adjust their own chips**, in public like any other adjustment ("took 1 chip from their own wallet").
- **Config changes do not post in chat** (the spec lists them on the Audit page, ahead of time when they wait for the reset). Chip adjustments, giveaways and an early end do.
- **The invite message carries the code**, since the sign-up page does not read one from its address yet.
- **Live Audit entries survive a refresh already on its way.** A setting change refreshes the open Audit page (for the changes waiting for the reset), and on the preview a second save half a second later arrived live, then vanished when the first refresh came back without it. Each tab now keeps the newest 100 entries it heard live, and every first page fetched takes back any it missed (`withHeard` in `data.ts`); a setting change also restarts a refresh in flight, so the waiting list includes it.
- **"Starts at the reset" is decided by when a change was made, not by the page's clock** (`startsLater` in `audit-text.ts`): only a change that starts more than a second after it was saved waits. The page's clock ticks every 30 seconds, so a change that started at once used to read "Starts at the reset, in 0:03" until the next tick. The countdowns tick each second, and only while something waits.
- **The settings save bar sits above the classic shell's phone tab bar**, the way the kit's room layout does (`sticky bottom-[calc(3.6rem+…)]`). In the chat shell's panel it can sit at the bottom.

## Shared changes that would help (optional)

- The sign-up page could read `?code=` from its address, so an invite link fills in the code.
- The new shell's page panel keeps the data router, since the settings editor uses `useBlocker` to warn before leaving with unsaved changes.

## Open questions

None.
