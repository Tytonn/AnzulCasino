# Casino site build spec

Nov 17, 2026 · @Tyton Star

## How to use this doc

This doc is the single source of truth for the build. Export it as Markdown, save it in the repo as `docs/SPEC.md`, and add it to your project so every thread reads the same rules.

Build in three stages. The order matters more than anything else in this doc.

1. **Foundation: one thread.** Accounts, chips, the site shell, the live layer and a shared game kit. Nothing else starts until this is merged.
2. **Lanes: several threads at once.** Each thread builds one game or feature. Each owns its own folders and its own git branch, so they can't collide.
3. **Integration: one thread.** Polish across the whole site, tuning, security pass, launch checks.

Why not run everything in parallel from the start: every game needs the same wallet, login, layout and live channel. Six threads inventing those at once will produce six versions. Why not one thread for everything: a single long thread loses focus, and the games are independent once the foundation exists.

Running the threads:

- Start each thread with its prompt from **Prompts to paste**. Each thread starts with no memory of the others, so the repo is the shared memory.
- A lane never edits files outside its folders. If it needs a shared change, it writes the request in its pull request and tells you. You pass it to one thread that owns shared code.
- Each thread keeps a short log in `docs/progress/<lane>.md`. A new thread picking up that lane reads it first.
- Merge lanes into `main` one at a time. After each merge, tell the other lanes to pull `main` before they continue.
- Merge to `main` in batches. Each production deploy costs 15 Netlify credits and preview deploys cost none ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)).

## What we're building

A private casino site for about 10 friends, played in month-long seasons. Everyone starts a season with the same chips, and the final leaderboard decides who wins the pot. The pot is real money, but friends settle it between themselves, off the site. The site only ever handles play chips.

It replaces UnbelievaBoat in a Discord channel. That setup got one thing right, and the site must keep it: everyone plays at their own speed, and everyone watches it happen. What it got wrong: results are text boxes scrolling in a chat, shield timers glitch, and nothing feels like a game.

Priorities, in order:

1. **Fair and trusted.** Real money rides on the leaderboard. Every outcome is decided on the server and every chip movement is logged. The owner also plays, so nothing the owner does to chips or settings can be hidden.
2. **Together by default.** Nobody plays alone. Everyone plays in one shared stream and watches everyone else's games, live. _(Changed by Tyton, Nov 22, 2026: one stream instead of rooms.)_
3. **Fast.** A blackjack hand takes no longer than typing `.bj all` did.
4. **Polished.** Sleek, dark, animated, with sound. Two great games beat six flat ones.
5. **Fun for 10th place, fair for 1st.** Comebacks are possible, and leading is not a punishment.

Out of scope: payments of any kind, public signups, a Discord bot, native apps.

## Decisions made for you

Thirteen choices were still open when this spec was written. Each has a default below. Change any of them here before the foundation thread starts.

| Decision | Default | Why |
| --- | --- | --- |
| Prize | The site only ranks players. You settle the pot yourselves | Keeps real money off the site. Winner-take-all or a top-three split needs no code |
| All-in bets | Allowed | Your group already plays `.bj all`. Set `max_bet_pct` below 100 to cap bets |
| Blackjack shoe | Fresh six decks every hand | A shared running shoe lets a card counter gain an edge with money at stake |
| Roulette wheel | European, single zero | Lower house edge than a double-zero wheel |
| Chip gifting | Not allowed | Stops players feeding chips to one person |
| Steals near the end | Frozen for the final 24 hours | A last-minute steal should not decide the winner |
| Shields | Charges, not 24-hour timers | Nothing can expire early or late |
| Login | Username and password, with a single-use invite code | Separate accounts, as you asked. The code keeps strangers and second accounts out |
| Daily reset | 4:00 AM Central | A late-night session is not split in two |
| Starting chips | 100 | Close to the amounts your group plays with now |
| Live updates | Ably's free package | Netlify's own live server is one week old. See Stack and architecture |
| Between seasons | Games closed | Simplest. A practice mode can come later |
| Vegas theme | Later | The token system is built from day one so it is a small job |

## Stack and architecture

Netlify hosts the site, the API and the database. Ably carries the live updates. The code lives in your GitHub repo, and Netlify builds it on every push.

&#91;embedded content: request path · 4 parts, 4 steps\]

The browser only asks. The function decides and saves, then tells Ably, and Ably tells every browser watching.

| Layer | Choice | Notes |
| --- | --- | --- |
| Code | Your GitHub repo, TypeScript everywhere | A pull request gets a preview site. `main` is the live site |
| Frontend | React, Vite, single-page app | React Router. TanStack Query for server data. Zustand for live card and stream state. Tailwind driven by theme tokens. Motion for animation. SVG or canvas for the wheel and plinko |
| API | Netlify Functions under `/api/*` | A Zod schema on every input |
| Database | Netlify Database, managed Postgres, with Drizzle | Migrations live in the repo and run on every deploy. Each preview gets its own database branch |
| Live updates | Ably | Functions publish, browsers subscribe. Presence powers the online list |
| Timed jobs | Netlify Scheduled Functions | Backup sweeps only. Nothing depends on a timer firing on time |
| Tests | Vitest and Playwright | Logic tests, and real-browser tests with screenshots |

If the repo already uses a different tool for one of these jobs, the foundation thread keeps it unless it blocks the spec, and records the choice in `docs/LANE_GUIDE.md`.

### How a bet travels

1. The browser sends an intent, such as hit, to the API with its session cookie and an idempotency key.
2. The function checks the session and the input, opens a transaction, locks the wallet, applies the rules with server randomness, writes the round and ledger rows, and commits.
3. The function publishes the public part to the game's channel and returns the full result to the caller.
4. Every browser showing the round's card animates the event. The caller animates from the response and does not wait for the echo.

### Why Ably and not Netlify Server

- Netlify released Netlify Server on November 10, 2026: a long-running Node server that supports WebSockets. It is in Early Access, free for now, and its APIs may change ([changelog](https://www.netlify.com/changelog/2026-11-10-netlify-server-early-access/)).
- It can run up to 3 instances, and each instance reaches only its own connections. There is no built-in way to broadcast across them ([real-time docs](https://docs.netlify.com/build/server/real-time/)).
- A month-long season with money on it should not sit on a week-old feature.
- Ably's free package allows 6,000,000 messages a month and 500 connections at once ([Ably Free package](https://ably.com/docs/pricing/free)). Ten players will use a small fraction.
- The live layer sits behind one small wrapper on each side (`src/live/`, `server/lib/live.ts`), so it can move to Netlify Server later without touching game code.

### Credits

A production deploy costs 15 credits and preview deploys cost none. Compute costs 10 credits per GB-hour and requests cost 2 credits per 10,000 ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)). Deploys are the cost to watch, so work in previews and merge in batches.

### Environment variables

`ABLY_API_KEY`, `ADMIN_BOOTSTRAP_CODE`, and whatever Netlify Database provides for the connection. The foundation thread lists the final set in `docs/LANE_GUIDE.md`.

_(Added Nov 18, 2026.)_ `KLIPY_API_KEY` for GIFs in chat (Social layer > GIFs in chat). Server only, like the others.

## Rules every thread follows

These rules apply to every line of code in every lane. The foundation thread copies them into `CLAUDE.md` so each thread loads them automatically.

### Fairness and chips

1. **The server decides everything.** The browser sends intents: bet 500, hit, cash out. It never sends an outcome, a balance, a multiplier or a card.
2. **Chips are whole numbers.** Store them as `bigint`. No floats in chip math. Payouts round down to a whole chip.
   _(Changed by Tyton, Nov 18, 2026, to hundredths of a chip with cents shown; changed back by Tyton, Nov 22, 2026, and the same day rescaled so a season starts with 1,000.)_ Chips are whole numbers, and a season starts with 1,000. Every amount is a `bigint` count of whole chips, and nothing shows decimals. Payouts, steals, fines, income and giveaway shares round down to a whole chip: a right call on a 30-chip coin flip pays 58, not 58.8.
3. **Every balance change is one ledger row**, written in the same database transaction as the thing that caused it. A wallet's balance must always equal the sum of its ledger rows. A test checks this.
4. **Lock before you spend.** Every transaction that moves chips locks the wallet row first (`SELECT ... FOR UPDATE`), then checks the balance. Two fast clicks must never spend the same chips twice.
5. **Every chip-moving request is idempotent.** The browser sends a unique key with it. A repeated key returns the first result and changes nothing.
6. **Randomness comes from Node's `crypto` on the server**, never `Math.random`. Map random bytes to a range without modulo bias (`crypto.randomInt`).
7. **Draw late.** Decide a hidden outcome at the moment it is revealed, not before. Where the rules need it earlier (a dealer hole card for the blackjack peek, a crash point), keep it in `game_rounds.secret`. No API response and no live event ever includes that column.
8. **Time is database time.** Cooldowns, round windows, the daily reset and the season end are compared against `now()` inside the transaction. Browser countdowns are display only, corrected by an offset from `/api/time`.
9. **Every tunable number lives in the `config` table**, read through one typed helper with defaults in one file. No magic numbers in game code.
10. **Every endpoint** requires a session, validates its input with a schema, and is rate-limited per user. Chat and names render as plain text, never as HTML.

### Repo and workflow

- Read `docs/SPEC.md`, `docs/LANE_GUIDE.md` and your lane's progress file before writing code.
- Work on your lane's branch and open a pull request early. Never push to `main`.
- Edit only your lane's folders. Shared code is read-only for lanes.
- Put your tables in your own schema file and your own migration files. Never edit another lane's migration. Prefer the JSON `detail` column on `game_rounds` over new tables.
- Avoid new dependencies. If one is essential, add it and say so in the pull request.
- Test on your pull request's deploy preview. Each preview gets its own copy of the database, so nothing you do there touches the live one ([Netlify Database docs](https://docs.netlify.com/build/data-and-storage/netlify-database.md)).
- Follow the current Netlify and Ably docs over memory. Install Netlify's agent skills first by opening [netlify.ai](https://netlify.ai/).
- Secrets live in Netlify environment variables only. Never in the repo, never in browser code.
- Before calling anything done, meet the **Quality bar** at the end of this doc.
- Update `docs/progress/<lane>.md` at the end of every working session: done, not done, decisions, open questions.

## Site layout and feel

_(Changed by Tyton, Nov 22, 2026: the site is one shared chat stream, and every game is a card in it, started by a command. This replaces the Floor, the room pages, the left rail, the separate chat panel and the ticker. Until every game has its card, the Floor and the rooms stay reachable under `/classic`. How cards and commands work is in Games > Cards and commands.)_

The stream is the table. Chat, every game and the casino's news share one ordered stream, and each game plays out on a live card in it that everyone watches. It should feel like a room full of friends at one table, not a chat log and not a solo app.

### Desktop (1100px and wider)

- **Header.** The logo, the stream's filters over the stream (Everything, Chat only, Games only), the season clock, the sound toggle and the account menu.
- **Left: the board.** The leaderboard, always visible: rank, avatar, name, net worth, an arrow when someone moves. Under it, who is online and what each is doing: "Bob · Blackjack", "Alice · chatting", "Carol · away".
- **Center: the stream.** Chat messages, game cards and announcements in one list, newest at the bottom, with the message box under it. Your own active card is pinned just above the box.
- **Right: You.** Your wallet and vault with animated counts, your rank and place, the features' buttons with their timers (work, slut, crime and Collect, shield charges as pips, steal attempts left), which can be pressed as well as typed, and links to every other page.

### Between 768 and 1100px

The stream and You. The board opens as a drawer from a button in the header.

### Phone (under 768px)

- The stream fills the screen under a slim strip: your wallet, your next timer ("Work 2:41"), and buttons for the board, You and the filter.
- The board and You open as sheets. On a phone You also holds the sound, log out and, for admins, setup.
- Your pinned card sits right above the message box, within thumb reach. Every game must be fully playable one-handed.

### Pages

The Shop, History, Profile, the Hall of Fame, Admin and Audit open as a panel over the stream: between the board and You on a desktop, under the strip on a phone. Escape or Back to the stream closes it, and the stream keeps running underneath.

### Themes

- All colors, fonts, corner sizes, shadows and animation speeds are tokens: CSS variables set on `:root[data-theme]`. Components use tokens only. No raw color values in components.
- Default theme is `midnight`: near-black background, softly layered surfaces, one bright accent color. Gold is reserved for wins and first place. Red means a loss.
- Chip amounts use tabular numerals everywhere, with thousands separators.
- A second theme, `vegas` (felt green, gold, red), comes later. Adding it must mean one new token file plus optional art swaps for table felt, card backs and slot symbols. Theme choice is saved per player.

### Motion

- Every state change animates. Cards deal and flip, chips slide, balances count up and down, leaderboard rows slide when ranks swap.
- Interface motion runs 150 to 250ms. Reveals run up to 600ms. Chips and cards use spring easing.
- Animation never blocks input. A fast player can act the moment the server answers, and running animations finish early.
- Celebrations scale with the win. A small win gets a quick tick. A win of 10x the bet or more, or any won all-in, gets the full treatment: particles, sound, and its card stays open in the stream with a gold edge. _(Changed by Tyton, Nov 22, 2026: the card replaces the chat post in the stream; the classic chat keeps the post until it goes.)_
- Honor `prefers-reduced-motion`.

### Sound and keys

- Short sounds for deal, chip, win, loss, steal and shield block. One volume control and a mute, remembered per player.
- Every game has keyboard shortcuts, shown as small hints on its card's buttons. They work while your card has the keys (Games > Cards and commands).

### States

- Loading shows skeletons shaped like the content, not spinners.
- Empty states are designed: an empty stream invites you to say hi or type a command.
- Errors are toasts in plain words that say what to do next.
- If the live connection drops, a small pill says reconnecting. The page recovers by itself.

## Accounts and seasons

Accounts are username and password with an invite code, and all play happens inside a season.

### Accounts

- **Sign up** needs a username, a password and an invite code. Usernames are 3 to 16 letters, digits or underscores, unique without regard to case. Passwords are at least 8 characters.
- **Invite codes** are single-use and created by an admin. No code, no account. This keeps strangers and second accounts out.
- **Passwords** are hashed with argon2id or Node's built-in scrypt. They are never stored or logged in plain text.
- **Sessions** are a random token in a cookie marked `HttpOnly`, `Secure` and `SameSite=Lax`. The database stores only a hash of the token. Sessions last 30 days and extend with use.
- **Login throttling:** 5 failed attempts per username per 15 minutes.
- **Forgotten password:** there is no email. An admin creates a one-time reset code for the player.
- **Profile:** display name, an avatar picked from a built-in set with a color, theme, sound setting. No image uploads in the first version.
- **Roles:** `player` and `admin`. The first account created with the `ADMIN_BOOTSTRAP_CODE` environment variable becomes the admin.

### Seasons

- A season has a name, a start time, an end time, a starting balance and a status: `scheduled`, `active`, `final_day`, `ended`.
- At the start, every player gets the starting balance as a `season_start` ledger row. A player who joins late gets the same amount.
- **Rank is net worth:** wallet plus vault. Ties go to whoever reached that net worth first.
- **Final day.** In the last 24 hours, steals, shield purchases and vault moves are switched off. Games stay open. A banner and countdown make this obvious all day.
- **The end is exact.** No game accepts a new bet at or after the end time, checked on the server. Rounds already open are settled. Final standings are copied into `season_results` and never change.
- **After the end,** the site shows a podium screen, and the Hall of Fame keeps every past season's standings.
- **Between seasons,** games are closed and the site shows results and the next start date.
- Every wallet, round, steal and counter is tied to a season, so a new season starts clean.

### The game day

Daily limits reset at 4:00 AM Central, so a late-night session is not split in two. One shared helper, `gameDay(now)`, returns the current game day. Everything daily uses it: bonus, challenges, steal attempts, loss caps, the vault move.

## Economy

Chips enter through the season start, the daily bonus, challenges and the rebuy. They leave through the house edge and shield purchases. They move between players only through steals. There is no gifting.

_(Updated Nov 18, 2026.)_ Chips also enter through rank income, chat drops and admin giveaways, and also leave through rank purchases and extra steal attempts. See Ranks and Giveaways below, and Shop in the steal section. Players still cannot give chips to each other.

_(Updated Nov 18, 2026.)_ The rebuy is removed. Work, slut and crime replace it: chips also enter through work and their successes, and leave through their fines. Russian roulette moves chips between the players at one table, with no house cut. See Work and crime below, and Russian roulette in Games.

The house edge slowly drains everyone, so the daily inflows are what keep a month-long season alive and give a broke player a way back.

_(Rebalanced by Tyton, Nov 18, 2026, and rescaled by Tyton, Nov 22, 2026.)_ The season starts with 1,000 chips. Every absolute chip amount below is ten times the Nov 18 value (which was the original divided by 100), so every ratio between them stays the same. The original value is in brackets. Percentages, chances, cooldowns and day counts are unchanged.

| Setting | Start value | What it does |
| --- | --- | --- |
| `starting_balance` | 1,000 (10,000) | Chips each player gets at season start |
| `daily_bonus` | Replaced by Ranks (500) | _(Nov 18, 2026: ranks replace the flat daily bonus. Base rank income is 50 a day. The streak bonus stays.)_ |
| `streak_step` / `streak_max` | +10 / 100 (+100 / 1,000) | Bonus grows by 10 per day in a row, up to 100. A missed day resets it |
| `challenges_per_day` | 3 | Small goals, each worth 20 to 40 chips (150 to 400) |
| `work_*` / `hustle_*` / `crime_*` | See Work and crime | _(Nov 18, 2026: the rebuy is removed. Work replaces it, see Work and crime.)_ |
| `min_bet` | 25 (10) | Smallest bet in any game. _(Tyton, Nov 22, 2026: 25, so a 1.96x coin flip pays a whole 49 at the smallest bet.)_ |
| `max_bet_pct` | 100 | Largest bet as a share of the wallet. 100 means all-in is allowed |
| `big_bet_pct` | 50 | A bet at or above this share of net worth is flagged as a big bet in the stream |

### Wallet

- A player has a **wallet** (spendable) and a **vault** (protected, see the steal section). Net worth is the two added together.
- Every change goes through the ledger with a reason: `season_start`, `bet`, `payout`, `refund`, `daily_bonus`, `challenge`, `steal_in`, `steal_out`, `fine_in`, `fine_out`, `shield_purchase`, `vault_deposit`, `vault_withdraw`, `admin_adjust`. _(Nov 18, 2026: `rebuy` removed with the rebuy.)_
- _(Added Nov 18, 2026.)_ Further reasons for the additions: `rank_purchase`, `rank_income`, `chat_drop`, `giveaway`, `steal_attempt_purchase`. The streak bonus keeps `daily_bonus`.
- _(Added Nov 18, 2026.)_ For work, slut and crime: `work`, `hustle_win`, `hustle_fine`, `crime_win`, `crime_fine`. For russian roulette between players: `pvp_ante` (a player's ante goes into the pot) and `pvp_pot` (the last player standing takes it). Its solo mode is an ordinary round with `bet` and `payout`, and a cancelled lobby returns the ante with `refund`.

### Challenges

- Each player gets three per game day, picked from a pool. Examples: win 3 blackjack hands, hit a single number in roulette, cash out above 3x in crash, play three different games.
- Progress is worked out by querying that player's settled rounds for the game day. No game needs challenge code inside it.
- A finished challenge shows a toast, and the player claims the chips with one click.

### Ranks

_(Added by Tyton, Nov 18, 2026. Owner: economy lane.)_

- Ranks replace the flat daily bonus. Every player has a rank that pays income. The streak bonus stays.
- Income accrues continuously at the rank's daily rate and is claimed with Collect (`.collect`, or its button in You). Uncollected income caps at 24 hours' worth. Compute it from saved timestamps against database time.
- Tiers (all config, for a starting balance of 1,000):
  - Base: free, income 50 per day
  - Bronze: unlocks day 1, costs 1,500, income 150 per day
  - Silver: unlocks day 3, costs 10,000, income 1,000 per day
  - Gold: unlocks day 6, costs 100,000, income 10,000 per day
  - Platinum: unlocks day 10, costs 1,000,000, income 100,000 per day
  - Diamond: unlocks day 14, costs 10,000,000, income 1,000,000 per day
  - Crown: unlocks day 18, costs 100,000,000, income 10,000,000 per day
- A rank cannot be bought before its unlock day. A player can buy only the next rank up, and at most one per game day. The price is removed from the game and does not count toward net worth.
- Ranks cannot be bought in the final 24 hours and cannot be stolen or sold.
- Each rank gives a badge and name color shown in chat, the leaderboard, the online list and the player's cards.
- Show a countdown to the next unlock in the shop and announce each unlock in chat.

Naming note: in code these ranks are called **tiers** (`tier`), because "rank" already means a player's place on the leaderboard.

### Giveaways

_(Added by Tyton, Nov 18, 2026.)_

- Chat drops (economy lane): at random times a pot appears in chat and the first few players to claim it split it. Frequency, pot size and number of winners are config. Claims are decided on the server, one per player per drop.
- Admin giveaways (admin lane): the admin can give chips to chosen players or split a pot among everyone. Each one posts in chat with names and amounts, and is written to the public audit page.
- _(Superseded Nov 18, 2026: the rebuy is removed. Work is how a broke player gets back in, see Work and crime.)_

### Work and crime

_(Added by Tyton, Nov 18, 2026, then changed by Tyton twice the same day: a third command, and final values. Owner: economy lane. The editable names and lines are an admin panel item for the admin lane. Work works at a zero balance, so it replaces the rebuy, which is removed.)_

Three income buttons: work, slut and crime. The final values, which replace the earlier ones (all config):

- Work: 5-minute cooldown, always pays 20 to 60 chips. Unchanged.
- Slut: 1-hour cooldown, 65% success paying 200 to 500 chips, otherwise a fine of 50 to 150.
- Crime: 2-hour cooldown, 45% success paying 600 to 1,500 chips, otherwise a fine of 100 to 300.
- _(Nov 22, 2026: ten times the Nov 18 values, with the rest of the economy, for the 1,000-chip start.)_
- Fines cannot take the wallet below zero. The three cooldowns are separate.
- The design intent: the longer the cooldown, the bigger and riskier the single payout. Work earns the most per hour, the other two earn the most per press.
- In the season simulation, model players pressing all three whenever they are ready during play hours, and report the combined income against rank income at each tier.

Still in force from the earlier versions:

- Work works at a zero balance.
- Do not scale these with rank. They are a lifeline for broke players, not a main income.
- Put the buttons where they are reachable from every room without leaving the game, with the cooldown shown on the button. _(Nov 22, 2026: they are the commands `.work`, `.slut` and `.crime`, and buttons in You with their timers.)_
- Each shows a short random flavor line with the result. The lines are editable in the admin panel.
- _(Changed by Tyton, Nov 22, 2026: work, slut and crime results are public. Each posts as a compact one-line item in the stream with the player's name, the flavor line and the amount, such as "tyton worked as a mildly successful content creator and earned 59". They show under Everything and Games only, not under Chat only, and players can react to them. The rest of this bullet is replaced.)_ Work and crime never post in chat. They only show a result to the player who pressed the button. The one exception: a crime payout at the top of its range (23 chips or more at current settings) posts a short line. _(Answered by Tyton, Nov 18, 2026. With the final values the top of the range is 140 chips or more: the config value `crime_chat_min`. Nov 22, 2026: 1,400 at the 1,000-chip start.)_
- Cooldowns are saved times checked against database time, shown as exact countdowns.
- All amounts are config.

The third command, as Tyton added it ("add the third income command after all, matching UnbelievaBoat's .slut"; its first numbers are replaced by the final values above):

- It sits between work and crime: more than work, safer than crime.
- The button's name is a config value so I can rename it.
- Results show in the activity feed like work and crime.
- Flavor lines: write a pool of at least 40, joke-level and suggestive at most, nothing crazy explicit. They are editable in the admin panel like the others.
- Include it in the season simulation with work and crime.

Naming note: in code the third command is **`hustle`** (config keys `hustle_*`, ledger reasons `hustle_win` and `hustle_fine`, `wallets.hustle_ready_at`). Its button's name is the config value `hustle_name`, which starts as "Slut".

### Keeping it balanced

The season simulation in the steal section also reports the total chip supply day by day. Use it to check that bonuses do not swamp winnings by week four.

## Games

Every game plays in the one shared stream: each player plays their own rounds at their own speed, each on its own card, and everyone sees everyone else's play live. Roulette and crash go one step further: one shared round, on one shared card, for everyone. _(Changed by Tyton, Nov 22, 2026: cards in the stream instead of rooms.)_

_(Updated Nov 18, 2026.)_ Race also runs one shared round for everyone. Russian roulette seats two to six players against each other at one table.

### Cards and commands

_(Changed by Tyton, Nov 22, 2026: this replaces the room model. Room pages, seats and the ticker go. Each game's classic room stays under `/classic` until its card ships, and the last step of the change removes them.)_

**Commands.** Anything typed after the prefix in the message box is a command; everything else is chat.

- Typing the prefix at the start of the box opens the command list: each command with its aliases, what to type after it, and one line on what it does. It narrows as you type, and arrows and Tab complete. After the command it prompts the next part: an amount with quick picks (the example, half, all), or a player.
- Amounts use the shared bet parser, resolved on the server against the locked wallet: `50`, `2.5k`, `5k`, `half`, `all`, `max`.
- Only the prefix followed by a letter counts as a command, so `...` and `.5` stay chat.
- A command that cannot run is never posted. Its text stays in the box, and a hint for that player alone shows just above it: "There is no .bjj. Did you mean .bj?" or ".bj needs a bet, like .bj 50 or .bj all." The server's refusals, such as too few chips or a cooldown, show the same way.
- The command's text is never posted as a message; the card it makes is the post. Up arrow in an empty box brings back what you sent.
- The prefix and every command's words are settings in the `commands` group, edited in the admin panel and taking effect at once. Each command is one list of words; the first is its name. The prefix is 1 to 3 symbols, never a letter, digit or space. The server refuses a change that gives two commands one word, or a word with spaces or symbols, in a plain sentence the editor shows.
- Descriptions and what a command takes live in its game's or feature's manifest, not in settings. Games still to come already have their settings, so their lanes need no shared change; until then `.help` lists them as coming soon.

| Command | Default words |
| --- | --- |
| Prefix | `.` |
| Blackjack | bj, blackjack |
| Roulette | roulette, rl |
| Coin flip | flip, coinflip, cf |
| Work | work, w |
| Slut | slut |
| Crime | crime |
| Collect | collect |
| Rob | rob, steal |
| Deposit, Withdraw | dep, deposit; with, withdraw |
| Balance | bal, balance |
| Leaderboard | lb, leaderboard, top |
| Shop | shop, store |
| Help | help, commands |
| Admin | admin |
| Games to come | mines, plinko, crash, slots, rr, race |

`shared/config.ts` holds the defaults; the admin panel shows what is set now.

**Cards.**

- **Every round gets a card.** The round helper writes a `card` chat message in the same transaction as the bet, so every game, present and future, lands in the stream with no chat code of its own. A shared round (roulette, crash, race, a lobby) posts one card when it is created.
- **Everyone watches.** A card shows the player, the game, the bet and the game itself as it plays, with the same animations as the game's table. Only its player gets the buttons; everyone else sees "Their move…". An ALL IN or BIG BET tag glows on it until the outcome shows.
- **Live.** Opening the site loads the last 100 items of the stream with each card's round in one request. Cards then move on the round events the server already publishes. Nothing polls, and no card payload or event carries a round's secret.
- **The result waits for the card.** A card's header and glow show the result only once the card has played it out. Its player's wallet, the leaderboard and any big-result post wait for it too.
- **Pinned.** Your active card sits just above the message box while it is open and for a few seconds after its result, and its place in the stream shows a slim "pinned below" line. A newer card of yours takes the pin from a finished one at once; an older one still open stays pinned, folded to its header, under the newer.
- **Keys.** The card a command opens takes the keys: for blackjack H, S, D and P, and Space or Enter to turn a slow card, finish an animation, or deal again at the same bet once the hand is over. A click in the box, Escape, or any key the card does not use goes back to typing.
- **Folding.** A finished card shows its result for a few seconds, then folds to one line ("Bob · Blackjack 50 · 18 beats 14 −50") that opens to the replay. A run of one player's finished rounds folds into one line ("Bob · 6 Blackjack hands · +45"), or each keeps its own line: the setting `stream_round_runs`.
- **Big moments.** A big win (`big_win_times` the stake or more) and any all-in stay open, with a gold or red edge and, for their player, the full celebration. The card replaces the big-result chat post in the stream.
- **Filters.** Everything, Chat only and Games only each ask the server for their own list, so Chat only still loads 100 messages on a busy night. Announcements such as drops, season news and rank unlocks show under all three; work, slut and crime results under Everything and Games only.
- **Private replies.** `.help`, hints, and `.bal` and `.lb` while the setting `stream_bal_lb` says so, appear at the bottom of the player's own stream, marked "Only you", and are never stored. With `stream_bal_lb` set to public, `.bal` and `.lb` post for everyone, with who asked and what they showed then.
- **Lobbies.** Russian roulette and Race follow the same model: a lobby card others join by its button or the command, then the game plays out on that card.

**Rounds.** These hold for every game, as they did for rooms.

- **No turns.** Nobody ever waits on another player. There is no separate solo mode either.
  _(Nov 18, 2026: russian roulette is the one deliberate exception. It is turn-based, player against player, and has a solo mode against the house when nobody joins.)_
- **Public events drive everyone else's view of a card:** bet placed, card dealt, tile opened, result. Hidden information is never in a public event.
- **Big bets get noticed.** An all-in, or a bet at or above `big_bet_pct` of net worth, gets the tag above before the outcome shows.
- **Bets are typed, not clicked.** _(Added by Tyton, Nov 18, 2026; Nov 22, 2026: in the message box.)_ The bet after a command accepts a number or shorthand: "all", "half", "5k", "2.5k". After a round ends the box takes typing again, so a player can type the next command and press Enter without touching the mouse. Chips are only an animation after the bet is placed.
- **Same round lifecycle everywhere:** `start` takes the stake, zero or more `action` calls follow, `settle` pays out. One open round per player per game.
- **Abandoned rounds settle safely.** If a player leaves mid-round, the server finishes it by the safest rule after a timeout: blackjack stands, mines cashes out. A refresh mid-round resumes the round where it was.

| Game | Build order | House edge | Shared round? |
| --- | --- | --- | --- |
| Blackjack | 1 | about 0.5% with good play | No, own hands side by side |
| Roulette | 1 | 2.7% (1 in 37) | Yes, one wheel |
| Mines | 2 | 2% | No |
| Plinko | 2 | 2% | No |
| Crash | 2 | 3% | Yes, one multiplier |
| Slots | 3 | 4% | No |
| Russian roulette _(added Nov 18, 2026)_ | 2 | None between players. 2% in solo mode | A lobby of 2 to 6 players |
| Race _(added Nov 18, 2026)_ | 2 | 5% | Yes, one race |

The edges for mines, plinko, crash and slots are config values. So are the russian roulette solo edge and the race edge.

### Blackjack

- **Rules.** Six decks, shuffled fresh for every hand. Dealer stands on all 17s. Blackjack pays 3 to 2. Double on any first two cards. Split once, double after split allowed, split aces get one card each. No surrender, no insurance. The dealer checks for blackjack when showing an ace or a ten-value card. A push returns the stake.
- **Dealing.** Cards are drawn one at a time from what is left of the six decks. The hole card is drawn at the reveal, except when the peek needs it at the deal.
- **Command.** `.bj 50` (or `.blackjack`, with `half`, `all`, `5k`) deals a hand on a card in the stream. _(Nov 22, 2026.)_
- **Speed.** Chips move the instant you confirm. Cards animate when the server answers. From a result, one key deals the next hand at the same bet.
- **Keys.** H hit, S stand, D double, P split, and Space or Enter to deal again at the same bet. _(Nov 22, 2026: M for the largest bet stays in the classic room; in the stream, type `.bj all`.)_
- **Everyone else** sees each card land on the hand's card, the hand total and the result.
- **Tests.** Every rule above, payouts for every outcome, and a simulation of basic strategy over a few million hands that lands near the expected edge.

### Roulette

- **Wheel.** European, numbers 0 to 36, single zero. One table and one wheel for everyone.
- **Clock.** Rounds run on a fixed cycle: 20 seconds of betting, 7 of spin, 3 of result. Round number is `floor((server time - season start) / cycle)`, so every browser is in the same round by definition. The times are config.
- **Bets and payouts.** Single number 35 to 1, split 17, street 11, corner 8, six line 5, dozen and column 2, red or black, odd or even, high or low 1 to 1. Several bets per round. Chips leave the wallet when placed. Bets can be cleared until betting closes.
- **The number.** It is drawn with `crypto.randomInt(37)` by the first request that arrives after betting closes, and saved in that round's row. A unique constraint on the round number means only one draw can win. Nobody, including the owner, can know it earlier, because it does not exist earlier.
- **Settlement.** The same transaction that saves the number pays every bet in the round. Browsers showing the round all call settle at the close time; the first one does the work and the rest read the saved result. A scheduled function sweeps any round left unsettled.
- **Empty rounds.** If nobody has a bet down at the close, the wheel does not spin and nothing is saved.
- **The table** shows every player's chips on the felt in their color. The wheel starts spinning at the close time on every screen and slows onto the number when it arrives.
- **Keys.** Click to place, right-click to remove, R repeat last round's bets, C clear. A strip shows the last 12 numbers.
- **Quick-bet box.** _(Added by Tyton, Nov 18, 2026.)_ Roulette has a quick-bet box that uses the same syntax as UnbelievaBoat: `<amount> <space>`. Examples: "200 odd", "600 2nd", "50 17", "all red". Spaces it accepts: a single number, dozens (1-12, 13-24, 25-36), columns (1st, 2nd, 3rd), halves (1-18, 19-36), odd, even, red, black. Typed bets appear as chips on the table. Clicking spots on the table still works. Splits, streets, corners and six lines are click-only.

### Mines

- A 5 by 5 grid. The player picks 1 to 24 mines and a stake, then opens tiles. Each safe tile raises the multiplier. Cash out any time. A mine loses the stake.
- **Multiplier** after `k` safe tiles with `m` mines: `(1 - edge)` times the product, for `i` from 0 to `k - 1`, of `(25 - i) / (25 - m - i)`.
- **Draw late.** No mine layout is stored. Each opened tile is a mine with probability `m / (25 - k)`. When the round ends, the remaining mines are placed at random on unopened tiles for the reveal.
- Everyone watching the card sees the grid fill in. The full layout shows to everyone only after the round ends.

### Plinko

- 8, 12 or 16 rows and low, medium or high risk. The server draws left or right for each row. The bucket is the count of rights.
- Each rows-and-risk pair has a symmetric payout table. A unit test computes the exact return from binomial odds for every table and fails outside 97.5% to 98.5%.
- Several balls can be in flight at once. Each is its own instant round, and the animation follows the server's path.

### Crash

- **One shared round.** A short betting window, then a multiplier climbs from 1.00x until it crashes. Cash out before the crash to win stake times the multiplier.
- **Crash point.** With `u` uniform in \[0, 1): `max(1.00, floor(100 * (1 - edge) / (1 - u)) / 100)`, capped at 1000x. This gives every cash-out target the same edge.
- **Curve.** The multiplier at `t` seconds is `e^(0.07 * t)`. Browsers compute it locally from the round's start time. The server never streams it.
- **Cash out.** The server's receive time decides. Before the crash moment, pay at the multiplier for that time. At or after it, the bet is lost. A player can set an auto cash-out target with the bet, which the server applies exactly.
- **Rounds without a server process.** A round is created by the first request that finds none running, under a database lock. The crash point is drawn then and kept in `secret`. A short-lived runner sleeps until the crash moment, then settles the round and publishes the crash. Use a Netlify Background Function for the runner and check the current docs for its limits.
- This is the hardest game to do well on serverless hosting. Build it last in its lane.

### Slots

- Five reels, three rows, ten fixed paylines, weighted reel strips, a wild and a scatter. Keep the first version simple: no bonus rounds.
- Target return is 96%. A test proves it by enumerating the reel strips or by a ten-million-spin simulation, within half a percent.
- Symbols and art come from the theme, so the Vegas skin can swap them.
- Each spin is a card. Everyone sees the reels spin and stop live. _(Nov 22, 2026: cards instead of a row of machines in a room.)_

### Russian roulette

_(Added by Tyton, Nov 18, 2026. Owner: russian-roulette lane. Turn-based player against player: the one deliberate exception to "No turns" in Cards and commands.)_

- A player opens a lobby by typing an ante. Others have 20 seconds to join at the same ante. Two to six players.
- Players take turns pulling the trigger on a six-chamber revolver, in seat order. A player who gets the bullet is out and loses the ante. Reload and continue until one player is left, who takes the whole pot. No house cut.
- Each pull is decided on the server at the moment of the pull. A turn timer pulls automatically after 10 seconds.
- If nobody joins, it becomes a solo game against the house: each survived pull raises a multiplier, and the player can cash out or keep going. House edge is config, starting at 2%.
- Everyone in the stream watches every pull on the lobby card. Make the tension the point: slow the animation before each result.
- Ante cap is config, starting at 20% of the player's net worth, so two players cannot use it to pass chips to each other. Report in the simulation notes if you see a better guard.

### Race

_(Added by Tyton, Nov 18, 2026. Owner: race lane.)_

- One race for everyone, on one shared card, on a fixed clock, about every 75 seconds: a betting window, then the race, then the result.
- Six runners with names and colors. Each has posted odds, and the payouts carry a 5% house edge. Favorites win more often and pay less.
- Race odds change every race. Each race draws a new field of six runners from a larger pool of named runners, each with their own strength, so there is a different favorite and a different long shot every time. Keep the house edge at 5% whatever the field. _(Answered by Tyton, Nov 18, 2026.)_
- Bets are typed like roulette: `<amount> <runner number>`, for example "200 3" or "all 5".
- The winner is drawn on the server when betting closes, never earlier. The race animation is then generated to end on that result, with lead changes along the way.
- If nobody has a bet down, the race does not run. Same settlement and backup-sweep pattern as roulette.
- Runner art comes from the theme. Start with simple animals drawn in code.

### Coin flip

_(Decided by Tyton, Nov 19, 2026: the reference game stays on the Floor. Owner: foundation. Nov 22, 2026: it becomes the first card after blackjack, `.flip 50 heads`, and the worked example in `docs/LANE_GUIDE.md`.)_

- Call heads or tails and type a bet. One request takes the bet and flips the coin, which the server draws after the stake is taken.
- A right call pays twice the bet less a 2% house edge (1.96x). The edge is config (`coinflip_edge_pct`).

## Steal, shields and vault

Stealing is the comeback tool: it pays most when a low-ranked player robs a high-ranked one, and a daily cap protects whoever is being robbed. Shields are limited extras, not a daily bill.

### What the numbers must achieve

- A trailing player can make a real jump by robbing a leader.
- First place can skip a day and lose a known, bounded amount.
- Nobody has to keep buying shields to survive.
- Nothing runs on a timer that can drift. Shields are charges, and every cooldown is an exact saved time.
- A last-minute steal never decides the season.

### Steal rules

1. Each player gets `steal_attempts_per_day` attempts per game day.
2. A target is chosen from the leaderboard or a profile. These targets are not selectable, and the reason is shown: yourself, a player under `steal_floor` net worth, a player with immunity, a player whose daily loss cap is used up, a player you already tried today, anyone during the final 24 hours.
   _(Added Nov 22, 2026, with whole chips; raised by Tyton the same day to a smallest steal.)_ Nor is a player a success would take less than `steal_min_take` (10 chips) from: their wallet is too small for the rate ("Small wallet"), or what is left of their daily cap is ("Hit daily cap"). The attempt is not used.
3. **Shield check.** If the target holds a shield charge, the steal is blocked. One charge is used, the attempt is used, no fine is paid, and the target gets immunity.
4. **Roll.** Otherwise the steal succeeds with probability `steal_success_pct`.
5. **Success.** Chips move from the target's wallet to the thief's wallet. The vault is never touched. The target gets immunity.
6. **Failure.** The thief pays `steal_fine_pct` of the thief's own wallet to the target, at least `steal_min_fine` (10 chips), or the whole wallet if it holds less. _(The smallest fine: Tyton, Nov 22, 2026.)_
7. Every attempt is saved and posted in the stream.

**The amount.** `gap` is the thief's rank minus the target's rank, read at the moment of the attempt. A positive gap means the target is ahead.

- If the gap is positive: `rate = min(steal_max_rate, steal_base_rate + steal_per_rank * gap)`.
- If the target is behind the thief: `rate = steal_down_rate`.
- `amount = floor(target wallet * rate)`, then limited to what is left of the target's daily cap. An amount under `steal_min_take` is not offered (rule 2).
- The daily cap is `daily_loss_cap_pct` of the target's net worth at the last daily reset, minus what was already stolen from them today.

The whole steal runs in one transaction that locks both wallets, lower player id first, so two steals can never deadlock or double-count.

| Setting | Start value | Meaning |
| --- | --- | --- |
| `steal_attempts_per_day` | 2 | Attempts per player per game day |
| `steal_success_pct` | 55 | Chance an unshielded steal works |
| `steal_base_rate` | 1.5% | Share of the target's wallet at the smallest gap |
| `steal_per_rank` | 0.3% | Added for each rank the target is ahead |
| `steal_max_rate` | 4% | Most a single steal can take |
| `steal_down_rate` | 0.5% | Rate when robbing someone ranked below you |
| `daily_loss_cap_pct` | 4% | Most of your net worth you can lose to steals in a game day |
| `steal_fine_pct` | 5% | Share of the thief's wallet paid to the target on a failed steal |
| `steal_min_fine` | 10 (added Nov 22, 2026) | Smallest fine for a failed steal, or the thief's whole wallet if it holds less |
| `immunity_hours` | 3 | Immunity after being robbed or after a shield block |
| `steal_floor` | 250 (2,500; rebalanced Nov 18, 2026, rescaled Nov 22, 2026) | Players under this net worth cannot be robbed |
| `steal_min_take` | 10 (added Nov 22, 2026) | Smallest steal. A player a success would take less from cannot be picked. Robbing someone ranked below you at 0.5% needs 2,000 in their wallet |
| `final_freeze_hours` | 24 | No steals this close to the season end |

**Worked example.** You are 10th with 4,000 chips. The leader has 60,000 in the wallet and nothing in the vault. The gap is 9, so the rate is the 4% maximum. A success moves 2,400 chips: you gain 60%, the leader loses 4%, gets 3 hours of immunity and has hit the daily cap. A failure costs you 200 chips, paid to the leader.

### Shields

- A shield is a **charge**, not a timer. One charge blocks one steal and then starts the immunity window.
- Hold at most `shield_max_charges` (2). Buy at most `shield_weekly_limit` (3) per season week.
- Price is 2% of the buyer's wallet, with a minimum of 300 chips. The chips are removed from the game. _(Rebalanced Nov 18, 2026: the minimum is 3 chips. Rescaled Nov 22, 2026: 30 chips.)_
- You shows charges as pips and immunity as an exact countdown.
- Shields cannot be bought in the final 24 hours.

### Vault

- Chips in the vault cannot be stolen and cannot be bet. They still count toward rank.
- The vault can hold up to `vault_cap_pct` (25%) of net worth, checked at the moment of deposit.
- One vault move per game day, deposit or withdrawal.

### Shop

_(Added by Tyton, Nov 18, 2026. The heist lane owns the page; other lanes supply items through their manifests.)_

- Sells ranks, shield charges, and one extra steal attempt per game day at a config price. The two free daily steal attempts stay.

### Tune it before the first season

These values are starting points. Build `scripts/simulate-season.ts` to test them: 10 bot players with different styles (steady grinder, all-in gambler, constant thief, leader who never logs in) over 30 days, run 1,000 times, reading the same config defaults the site uses.

It prints:

- How often the leader on day 20 wins the season.
- How much a leader loses to steals per week, average and worst case. With the start values, a leader robbed to the cap every day loses about 25% in a week. If that reads as too harsh, lower the cap first.
- How much a typical steal is worth to a bottom-half player, as a share of their own net worth.
- Chips moved by steals against chips won and lost at the tables. Gambling should stay the bigger number.
- Total chip supply by day.

_(Added by Tyton, Nov 18, 2026. Owner: heist lane.)_

- Players average about 2,000 games each over the month, roughly 70 a day, with frequent all-in bets. Model that.
- Report: the day each rank is first bought, how many players hold each rank at the end, the share of final net worth that came from rank income and from giveaways, and whether an early rank buyer beats a non-buyer.
- Flag it if the top rank is bought by most players or by none.

_(Added Nov 18, 2026, from Tyton's work and crime and russian roulette additions.)_

- Include work, slut and crime. Model players pressing all three whenever they are ready during play hours, and report the combined income against rank income at each tier. _(Tyton's final version. The earlier one also asked for new Bronze and Silver values if work made those ranks pointless.)_
- The russian roulette lane reports in its simulation notes whether a better guard than the ante cap stops two players from passing chips to each other.

## Social layer

The social layer is what makes ten separate players feel like one table: who is here, what just happened, and a record of all of it.

- **Online list.** Who is online, what they are playing, their rank, and a status such as in a hand, chatting or away. Away after 5 minutes without input. Click a name for a profile card with stats and a Steal button.
- **Chat.** One channel for everyone: the stream. Messages are plain text, up to 300 characters, limited to 5 per 10 seconds. The last 100 load on open and scrolling up loads more. Emoji reactions from a small set. A mention highlights for the person named. Admins can delete.
- **System posts in the stream,** styled apart from player messages: big wins and losses, steals and shield blocks, a new player in first place, a bonus streak milestone.
- **Reactions** on messages, cards and results, from the same small set as chat. _(Nov 22, 2026: replaces seat reactions.)_
- **Ticker.** _(Removed by Tyton, Nov 22, 2026: the stream does its job.)_
- **History.** A global page of rounds with filters for player, game, win or loss, and size. Each round opens a replay built from its saved detail: the cards in order, the roulette number and bets, the mines grid, the crash curve. Each game supplies its own replay view.
- **Profiles.** Net worth over the season as a line, biggest win and loss, win rate per game, total wagered, steals made and suffered, bonus streak, trophies from past seasons.
- **Leaderboard page.** The full table, everyone's net worth over time on one chart, and rank changes in the last 24 hours.
- **Notifications.** Toasts when you are robbed, when your shield blocks a steal, when you gain or lose a rank, and when the daily bonus is ready.
- **While you were away.** On login, one card sums up what happened to your chips and rank since your last visit.

No email or push notifications in the first version.

### GIFs in chat

_(Added by Tyton, Nov 18, 2026. Owner: social lane.)_

- Add a GIF picker to chat using the Klipy API, the same provider Discord uses. Read Klipy's current developer docs first and follow their attribution rules.
- The picker has a search box, trending GIFs and a few quick categories. Picking one sends it as a chat message.
- GIFs load directly from Klipy's servers, never through our site. A GIF message stores only the Klipy id and URLs.
- Keep the API key out of browser code: search goes through one small endpoint that is rate-limited per user and caches trending results.
- Only accept GIF URLs on Klipy's domains, checked on the server, so nobody can post arbitrary images or links.
- Players can also reply to a system post (big win, steal, rank unlock) with a GIF.
- Use a test key while building. Tell me when to request the production key and what to put in the request.

## Admin and trust

The owner runs the site and also plays for the pot, so every admin power is public by design.

### Admin panel

- **Seasons:** create, schedule, end early.
- **Invite codes:** create, see which are used and by whom.
- **Config:** every tunable value with its default and a one-line description.
- **Players:** create a password reset code, disable an account.
- **Chat:** delete messages.
- **Chips:** manual adjustment with a required reason.
- **Work and crime names and lines:** _(added Nov 18, 2026)_ edit the third button's name and the flavor lines shown with each result. They are config values, so the config editor covers them.

### The audit page

- Every admin action that touches chips, config or seasons writes a row to `audit_log` with before and after values.
- A read-only Audit page shows that log to every player. Manual chip adjustments also post in chat.
- There is no quiet path in the code. Adjustments go through the same ledger as everything else, with the reason `admin_adjust`.
- Config changes to steals and the economy take effect at the next daily reset, not instantly, and are listed on the Audit page ahead of time.

### What code cannot guarantee

Whoever controls the hosting account can read the database and change the code. No design removes that. The site limits it in three ways:

- **Draw late.** Most hidden outcomes do not exist until they are revealed, so there is nothing to look up. The exceptions are a live crash point and a peeked blackjack hole card.
- **Everything is on the record.** Every round, steal and ledger row is permanent and visible in History.
- **Open code.** Give the friend group read access to the GitHub repo so anyone can see the rules and every change to them.

## Data model

The foundation thread creates every table below. One generic `game_rounds` table serves all games, so a game lane rarely needs a table of its own.

| Table | Holds | Key columns |
| --- | --- | --- |
| `users` | Accounts | `username` (unique, case-insensitive), `password_hash`, `display_name`, `avatar`, `role`, `theme`, `disabled_at` |
| `sessions` | Logins | `user_id`, `token_hash`, `expires_at`, `last_seen_at` |
| `invite_codes` | Signup codes | `code`, `created_by`, `used_by`, `used_at` |
| `seasons` | Seasons | `name`, `starts_at`, `ends_at`, `starting_balance`, `status` |
| `wallets` | One per player per season | `balance`, `vault`, both `bigint` |
| `ledger` | Every chip movement | `user_id`, `account` (wallet or vault), `delta`, `balance_after`, `reason`, `ref_type`, `ref_id`, `created_at` |
| `game_rounds` | Every round of every game | `game`, `status` (open, settled, void), `stake`, `payout`, `multiplier`, `detail` (public JSON), `secret` (hidden JSON, cleared at settle), `shared_round_id`, `started_at`, `settled_at` |
| `shared_rounds` | Roulette and crash rounds | `game`, `round_no`, `state`, `opens_at`, `closes_at`, `result`, `secret`, `settled_at`; unique on season, game and round number |
| `daily_state` | Per player per game day | `bonus_claimed`, `streak`, `steal_attempts_used`, `stolen_today`, `net_worth_at_reset`, `vault_moved`, `challenges` |
| `steals` | Every steal attempt | `thief_id`, `target_id`, `outcome` (success, failed, blocked), `amount`, `fine`, both ranks |
| `shields` | Charges held | `charges`, `immune_until` |
| `shield_purchases` | For the weekly limit | `user_id`, `price`, `created_at` |
| `chat_messages` | Chat and system posts | `user_id` (empty for system), `kind`, `body`, `meta`, `deleted_at` |
| `config` | Tunable values | `key`, `value`, `description`, `effective_at`, `updated_by` |
| `audit_log` | Admin actions | `actor_id`, `action`, `target`, `before`, `after` |
| `season_results` | Frozen final standings | `final_rank`, `final_net_worth` |
| `net_worth_snapshots` | Hourly points for charts | `user_id`, `at`, `net_worth` |
| `idempotency_keys` | Replay protection | `user_id`, `key`, `response` |
| `rate_limits` | Request counters | `user_id`, `bucket`, `window_start`, `count` |

Notes:

- Every season-scoped table carries `season_id`.
- A partial unique index allows one open round per player per game.
- `game_rounds.detail` must hold enough to replay the round. Each game lane defines its own shape for it and exports the type.
- Lanes add tables only in their own schema file, with table names prefixed by the lane name.
- _(Added Nov 18, 2026.)_ `wallets` also holds `tier` (Ranks, written only by the economy lane) and `work_ready_at`, `hustle_ready_at` and `crime_ready_at` (Work and crime: when each button can next be pressed, compared with the database clock).

## Live events

The database is the truth and live events are only the news of it. A browser that misses events recovers by fetching the current state.

| Channel | Who can listen | Carries |
| --- | --- | --- |
| `presence` | Everyone | Who is online, what they are playing and their status |
| `chat` | Everyone | `chat.message` (chat, news and cards), `chat.deleted`, `chat.reaction` |
| `feed` | Everyone | `round.settled` summaries, `steal.result`, `rank.changed`, `season.state` |
| `room:<game>` | Everyone | `round.started`, `round.action` (public part only), `round.settled`, `seat.emote` |
| `room:roulette` | Everyone | Also `bet.placed`, `bet.cleared`, `round.closed`, `round.result` |
| `room:crash` | Everyone | Also `round.created`, `bet.placed`, `cashout`, `round.crashed` |
| `user:<id>` | That player only | `wallet.updated`, `robbed`, `shield.blocked`, `challenge.done`, `notification` |

Rules:

- **Only the server publishes.** Browser tokens allow listening and presence, nothing else. An emote goes to the API, which publishes it.
- **Tokens.** The browser gets a short-lived token from `/api/live/token`. It limits the private channel to that player.
- **Publish after the commit,** never before. If publishing fails, the request still succeeds.
- **Self-contained events.** Each carries an id, the server time, a version number and enough data to draw it without a fetch. The types live in `shared/events.ts` and both sides use them.
- **Recovery.** On connect, reconnect and tab focus, the browser refetches the stream, the open cards' rounds, wallet and leaderboard. Events older than the fetched state are dropped.
- **No per-frame data.** The crash multiplier and the roulette spin are computed in the browser from a start time.
- **No waiting on your own echo.** The player who acted animates from the API response.
- **Cards listen to their games.** _(Nov 22, 2026.)_ The `room:<game>` channels keep their names. A browser listens to the channel of every game whose open card it shows, and a card's round updates from its events whatever order they arrive in.

## Build plan

One thread builds the foundation, then up to eight lanes run side by side, then one thread integrates. Lanes cannot collide because each owns its own folders and plugs into the shell through a manifest file instead of editing shared code.

### Folder map

```text
docs/                      SPEC.md, LANE_GUIDE.md, progress/<lane>.md
shared/                    types and live event definitions for browser and server
db/schema/                 core.ts plus one file per lane
db/migrations/             core migrations plus lane-prefixed files
server/lib/                wallet, ledger, auth, config, rng, live publish, round helper
server/games/<game>/       pure rules engines
server/features/<name>/    feature logic
netlify/functions/         API endpoints, files named <lane>-*.ts
src/shell/                 layout, routing, the stream, the message box, the panels
src/kit/                   shared game components and hooks
src/live/                  live client wrapper
src/theme/                 tokens and themes
src/games/<game>/          the card, commands, replay and manifest.ts
src/features/<name>/       pages and manifest.ts
scripts/                   season simulation and tools
tests/<lane>/              unit, integration and browser tests
```

The foundation thread may adjust this to fit what is already in the repo. It records the final map in `docs/LANE_GUIDE.md`, and that file wins.

### Manifests: how lanes plug in without touching shared code

- Each game exports `src/games/<game>/manifest.ts` with its id, name, icon, card component, commands, replay view and how-to-play text. _(Nov 22, 2026: the card and commands replace the room component and Floor card, which stay for the classic rooms until they go.)_
- Each feature exports `src/features/<name>/manifest.ts` with its routes, nav items, commands, widgets for You (the `top-bar` slot) and the phone's strip (`stream-status`), and profile-card actions.
- The shell discovers manifests with `import.meta.glob`. Adding a game or a feature means adding a folder. No shared file changes.

### Stage 1: Foundation (one thread, branch `foundation`)

1. **Repo setup.** Inspect what exists. TypeScript in strict mode, lint, format, unit and browser test runners, a GitHub Action that runs typecheck, lint and tests on every pull request, Netlify config, the folder map, `CLAUDE.md`.
2. **Database.** Every table in the Data model, with migrations.
3. **Accounts.** Signup with invite code, login, logout, session check for every endpoint, admin bootstrap.
4. **Wallet and ledger library.** `debit`, `credit`, `transfer` with locking and idempotency. A test fires 50 bets at once and proves the wallet cannot be overdrawn. A test proves balance equals the ledger sum.
5. **Config.** The typed helper, the defaults file, seed data.
6. **Season basics.** Create a season, find the active one, give starting balances, refuse bets after the end time.
7. **Live layer.** Wrappers on both sides, the token endpoint, presence, typed events.
8. **Shell.** Layout for desktop and phone, theme tokens, top bar with animated wallet, sidebar with a working leaderboard, online list, basic chat and ticker, the Floor, routing, a placeholder page for every room and feature.
9. **Game kit.** Bet controls, seat, room layout, chip stack, animated number, win celebration, sound manager, a `useRoom(game)` hook, random helpers, and a server round helper that wraps start, action and settle with wallet, ledger, idempotency and publishing.
10. **Reference game.** A coin flip room built end to end on the kit. It proves the kit and is the template every lane copies.
11. **Lane guide.** `docs/LANE_GUIDE.md`: how to add a game or feature, using the coin flip as the worked example.

**Exit check.** On a deploy preview, two browsers logged in as different players see each other online, chat, play coin flip, and watch each other's seats and the leaderboard update live. All tests pass.

### Stage 2: Lanes (parallel threads)

A lane owns everything named after it: `src/games/<name>/` or `src/features/<name>/`, the matching `server/` folder, `netlify/functions/<name>-*.ts`, `db/schema/<name>.ts`, its migrations, `tests/<name>/` and `docs/progress/<name>.md`. Everything else is read-only.

| Lane | Branch | Builds | Owns the names |
| --- | --- | --- | --- |
| Blackjack | `lane/blackjack` | The blackjack card | `blackjack` |
| Roulette | `lane/roulette` | The shared-wheel roulette card | `roulette` |
| Heist | `lane/heist` | Steal, shields, vault, shop, season simulation | `heist`, plus `scripts/simulate-season.ts` |
| Economy | `lane/economy` | Daily bonus, streaks, challenges, work, slut and crime _(replaced the rebuy, Nov 18, 2026)_, final day, podium, Hall of Fame | `economy`, `season` |
| Arcade | `lane/arcade` | Mines, then Plinko _(Crash moved to its own lane, Nov 18, 2026)_ | `mines`, `plinko` |
| Slots | `lane/slots` | The slots card | `slots` |
| Social | `lane/social` | Chat upgrades, reactions, notifications, history and replays, profiles, leaderboard page | `social`, `history`, `profile` |
| Admin | `lane/admin` | Admin panel, config editor, Audit page | `admin` |
| Crash _(added Nov 18, 2026)_ | `lane/crash` | The shared-multiplier crash card | `crash` |
| Russian roulette _(added Nov 18, 2026)_ | `lane/russian-roulette` | The player-against-player russian roulette lobby card, with its solo mode | `russian-roulette` |
| Race _(added Nov 18, 2026)_ | `lane/race` | The shared race card | `race` |

_(Updated Nov 18, 2026.)_ Changes to the lanes above:

- **Crash gets its own lane** in the second wave: branch `lane/crash`, builds the crash card, owns the name `crash`. Arcade keeps Mines and Plinko and owns `mines` and `plinko`.
- **Economy** also builds Ranks and chat drops (see Economy > Ranks and Giveaways), and work, slut and crime in place of the rebuy (see Economy > Work and crime). The buttons plug into You through the economy manifest, and their commands into the message box.
- **Russian roulette** and **Race** are new lanes in the second wave (see Games > Russian roulette and Race).
- **Heist** also owns the Shop page and the new simulation report (see Steal, shields and vault > Shop and Tune it before the first season).
- **Admin** also builds admin giveaways (see Economy > Giveaways), and editing the work and crime names and lines (see Admin panel).
- **Social** also builds GIFs in chat (see Social layer > GIFs in chat).

- **First wave:** Blackjack, Roulette, Heist, Economy. These are the games your group plays most and the season mechanics.
- **Second wave:** Arcade, Slots, Social, Admin. _(Nov 18, 2026: plus Crash, Russian roulette and Race.)_
- Run as many at once as you can comfortably review. Four is a sensible ceiling.

**When a lane needs a shared change.** It does not make the change. It lists it under a heading named Shared changes needed in its pull request and progress file. You hand the list to one thread working on `main`, merge that, and the lanes pull.

**Merging.** One lane at a time. Check its deploy preview first. After each merge, every open lane pulls `main` and reruns its tests. If the lockfile conflicts, reinstall instead of editing it by hand.

### Stage 3: Integration (one thread, branch `integration`)

1. **Consistency pass.** Play every card side by side in the stream. Make spacing, motion, sound levels and wording match.
2. **Phone pass.** Play every game one-handed at 375px wide.
3. **Speed pass.** Load each card lazily, check bundle size, check that server round trips stay quick.
4. **Security pass.** For every endpoint: session, validation, rate limit, no hidden data in responses or events. Try to cheat from the browser console and with replayed and parallel requests.
5. **Tuning.** Run the season simulation with the owner and set the final config.
6. **Full run-through.** A browser test that plays a three-player mini-season from signup to podium.
7. **Launch list.** Environment variables set, admin account created, invite codes made, season scheduled, a database export taken.
8. **Trial season.** Two or three days with no money on it before the first real season.

## Prompts to paste

Each thread gets one prompt. Paste it as the first message of a new thread.

### Foundation thread

```text
You are building the foundation of a private casino site for a group of friends. The full spec is docs/SPEC.md in this repo. Read all of it before doing anything else.

Your job is Stage 1 (Foundation) from the Build plan, and nothing beyond it.

Start by:
1. Inspecting the repo and the Netlify setup that already exist. Keep what fits the spec. Tell me what you would change before changing it.
2. Installing Netlify's agent skills from https://netlify.ai/ and reading the current docs for Netlify Functions, Netlify Database and Ably. Where the docs differ from what you remember, the docs win.
3. Writing a short plan to docs/progress/foundation.md and showing it to me.

Then build the Stage 1 deliverables in order on the foundation branch. Open a pull request early and push often so I can watch the deploy preview. After each deliverable: run typecheck, lint and tests, open the preview in a browser, use what you built, take screenshots at desktop and phone widths, and fix what looks or feels off before moving on.

Follow every rule in "Rules every thread follows". If the spec is unclear or looks wrong, stop and ask me instead of guessing. Build no game other than the reference coin flip.

You will need things from me, such as an Ably API key and Netlify settings. When you reach that point, tell me exactly what to create and where to put it.

You are done when the Stage 1 exit check passes on the deploy preview. Finish by writing docs/LANE_GUIDE.md and updating docs/progress/foundation.md.
```

### Lane threads

Fill in the four blanks from the table below.

```text
You are building one lane of a private casino site for a group of friends. Read docs/SPEC.md, docs/LANE_GUIDE.md and every file in docs/progress/ before doing anything else.

Your lane: [LANE]. Your branch: [BRANCH]. Your spec sections: [SECTIONS].
You may create and edit only what your lane owns: [OWNS]. The Build plan explains what owning a name covers. Everything else is read-only.

Other threads are building other lanes right now. Do not touch their folders, do not rename or reshape shared code, and avoid new dependencies. If you need a change outside your lane, do not make it. List it under "Shared changes needed" in your pull request and your progress file, work around it if you can, and tell me.

Build on the game kit and copy the patterns of the reference coin flip. Work in this order:
1. A short plan in docs/progress/[LANE].md. Show it to me.
2. Rules and math as pure functions with unit tests, including a return-to-player test wherever the spec gives a house edge.
3. Server endpoints, with tests for parallel requests, replayed requests and hidden data.
4. The interface, plugged in through your manifest.
5. The polish pass.

The polish pass: use the deploy preview for several minutes at desktop and phone widths with two browsers logged in as different players. Watch the other player's view update live. Take screenshots. Compare against "Site layout and feel" and "Quality bar". Fix everything that feels slow, janky, unclear or plain. Repeat until you would be proud to show it.

Keep docs/progress/[LANE].md current. When you are done, give me a summary, the preview link, and any decisions I need to make.
```

| Lane | Branch | Spec sections | Owns |
| --- | --- | --- | --- |
| blackjack | `lane/blackjack` | Games: cards and commands, Blackjack | `blackjack` |
| roulette | `lane/roulette` | Games: cards and commands, Roulette | `roulette` |
| heist | `lane/heist` | Steal, shields and vault | `heist`, `scripts/simulate-season.ts` |
| economy | `lane/economy` | Economy; Accounts and seasons | `economy`, `season` |
| arcade | `lane/arcade` | Games: cards and commands, Mines, Plinko _(Crash moved to its own lane, Nov 18, 2026)_ | `mines`, `plinko` |
| slots | `lane/slots` | Games: cards and commands, Slots | `slots` |
| social | `lane/social` | Social layer | `social`, `history`, `profile` |
| admin | `lane/admin` | Admin and trust | `admin` |
| crash | `lane/crash` | Games: cards and commands, Crash _(added Nov 18, 2026)_ | `crash` |
| russian-roulette | `lane/russian-roulette` | Games: cards and commands, Russian roulette _(added Nov 18, 2026)_ | `russian-roulette` |
| race | `lane/race` | Games: cards and commands, Race _(added Nov 18, 2026)_ | `race` |

### Integration thread

```text
You are finishing a private casino site for a group of friends. Read docs/SPEC.md, docs/LANE_GUIDE.md and every file in docs/progress/ before doing anything else.

All lanes are merged. Your job is Stage 3 (Integration) from the Build plan, on the integration branch. You may edit any file.

Work through the Stage 3 list in order. For each item, write what you found and what you changed in docs/progress/integration.md. Use the deploy preview in a real browser for every pass, with at least two logged-in players, at desktop and phone widths, and take screenshots.

Do not add features. Fix, align, harden and tune. If something in the spec was never built or was built differently, list it for me instead of quietly building it.

You are done when every item in "Quality bar" holds for every card and feature, and the full run-through test passes on the deploy preview.
```

## Quality bar

A card or feature is done only when every line here is true.

- **Correct.** The rules match this spec. Unit tests cover them. Where there is a house edge, a test proves the return is within tolerance.
- **Safe.** Parallel requests cannot overdraw a wallet. A replayed request changes nothing. No response or live event contains hidden data, and a test checks the payloads. Every endpoint needs a session, validates input and is rate-limited.
- **Live.** A second browser sees the change within about a second. A refresh mid-round resumes the round. A dropped connection recovers without a reload.
- **Fast.** Something on screen responds within 100ms of any input. Server round trips are under half a second for 95% of requests. Nothing jumps as content loads.
- **Polished.** Every state change animates. Sounds play. Buttons have hover, pressed and disabled looks. Loading, empty and error states are designed. Keyboard shortcuts work. Reduced motion is honored.
- **Phone-ready.** Fully playable one-handed at 375px wide.
- **Clear.** A new player understands the card without help, and its command is in `.help` with one line on what it does. Payouts and odds are visible. Each game has a short how-to-play card.
- **On the record.** The round is saved with full detail, shows in the stream and History, folds to its line, and replays correctly.

## Sources

Checked on November 17, 2026.

- [Netlify: how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
- [Netlify Database docs](https://docs.netlify.com/build/data-and-storage/netlify-database.md)
- [Netlify Server is now available in Early Access](https://www.netlify.com/changelog/2026-11-10-netlify-server-early-access/)
- [Netlify Server real-time docs](https://docs.netlify.com/build/server/real-time/)
- [Ably Free package](https://ably.com/docs/pricing/free)
