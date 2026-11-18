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
2. **Together by default.** Nobody plays alone. Every room shows everyone in it, live.
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

The browser only asks. The function decides and saves, then tells Ably, and Ably tells every browser in the room.

| Layer | Choice | Notes |
| --- | --- | --- |
| Code | Your GitHub repo, TypeScript everywhere | A pull request gets a preview site. `main` is the live site |
| Frontend | React, Vite, single-page app | React Router. TanStack Query for server data. Zustand for live room state. Tailwind driven by theme tokens. Motion for animation. SVG or canvas for the wheel and plinko |
| API | Netlify Functions under `/api/*` | A Zod schema on every input |
| Database | Netlify Database, managed Postgres, with Drizzle | Migrations live in the repo and run on every deploy. Each preview gets its own database branch |
| Live updates | Ably | Functions publish, browsers subscribe. Presence powers the online list |
| Timed jobs | Netlify Scheduled Functions | Backup sweeps only. Nothing depends on a timer firing on time |
| Tests | Vitest and Playwright | Logic tests, and real-browser tests with screenshots |

If the repo already uses a different tool for one of these jobs, the foundation thread keeps it unless it blocks the spec, and records the choice in `docs/LANE_GUIDE.md`.

### How a bet travels

1. The browser sends an intent, such as hit, to the API with its session cookie and an idempotency key.
2. The function checks the session and the input, opens a transaction, locks the wallet, applies the rules with server randomness, writes the round and ledger rows, and commits.
3. The function publishes the public part to the room's channel and returns the full result to the caller.
4. Every browser in the room animates the event. The caller animates from the response and does not wait for the echo.

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
   _(Changed by Tyton, Nov 18, 2026.)_ Chips are tracked in whole hundredths of a chip: every amount is a `bigint` count of hundredths, so there are still no floats. Payouts, steals and fines round down to a whole hundredth. Show cents only when an amount is not a whole number (`107.50`, but `107`).
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

The game sits in the middle and the group wraps around it. It should feel like a room full of friends, not a chat log and not a solo app.

### Desktop shell (1100px and wider)

- **Left rail.** Logo, then the rooms (Blackjack, Roulette, Crash, Mines, Plinko, Slots), each with a count of who is inside. Below: Floor, Leaderboard, Shop, History, Profile. Admin for admins.
- **Top bar across the center.** Your wallet with an animated count, vault amount, shield charges as pips, steal attempts left, season countdown, sound toggle.
- **Center.** The current room, or the Floor.
- **Right sidebar, about 320px.** Compact leaderboard at the top, always visible: rank, avatar, name, net worth, an arrow when someone moves. Then who is online and where. Chat fills the rest.
- **Ticker.** A thin strip of results from every room. Click one to open that round.

### The Floor (home page)

A grid of room cards instead of a menu. Each card shows the avatars of who is inside and the last big result there. Click a card to walk in.

### Phone (under 768px)

- The room fills the screen. A bottom tab bar holds Floor, Chat, Leaderboard, Shop, Profile.
- Chat and leaderboard open as sheets over the room.
- Bet controls and action buttons sit within thumb reach. Every game must be fully playable one-handed.
- Between 768px and 1100px, the right sidebar collapses to a button.

### Themes

- All colors, fonts, corner sizes, shadows and animation speeds are tokens: CSS variables set on `:root[data-theme]`. Components use tokens only. No raw color values in components.
- Default theme is `midnight`: near-black background, softly layered surfaces, one bright accent color. Gold is reserved for wins and first place. Red means a loss.
- Chip amounts use tabular numerals everywhere, with thousands separators.
- A second theme, `vegas` (felt green, gold, red), comes later. Adding it must mean one new token file plus optional art swaps for table felt, card backs and slot symbols. Theme choice is saved per player.

### Motion

- Every state change animates. Cards deal and flip, chips slide, balances count up and down, leaderboard rows slide when ranks swap.
- Interface motion runs 150 to 250ms. Reveals run up to 600ms. Chips and cards use spring easing.
- Animation never blocks input. A fast player can act the moment the server answers, and running animations finish early.
- Celebrations scale with the win. A small win gets a quick tick. A win of 10x the bet or more, or any won all-in, gets the full treatment: particles, sound, a post in chat.
- Honor `prefers-reduced-motion`.

### Sound and keys

- Short sounds for deal, chip, win, loss, steal and shield block. One volume control and a mute, remembered per player.
- Every game has keyboard shortcuts, shown as small hints on the buttons.

### States

- Loading shows skeletons shaped like the content, not spinners.
- Empty states are designed: an empty room invites you to sit down.
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

The house edge slowly drains everyone, so the daily inflows are what keep a month-long season alive and give a broke player a way back.

_(Rebalanced by Tyton, Nov 18, 2026.)_ The season starts with 100 chips, so every absolute chip amount below is the original value divided by 100. The original value is in brackets. Percentages are unchanged.

| Setting | Start value | What it does |
| --- | --- | --- |
| `starting_balance` | 100 (10,000) | Chips each player gets at season start |
| `daily_bonus` | Replaced by Ranks (500) | _(Nov 18, 2026: ranks replace the flat daily bonus. Base rank income is 5 a day. The streak bonus stays.)_ |
| `streak_step` / `streak_max` | +1 / 10 (+100 / 1,000) | Bonus grows by 1 per day in a row, up to 10. A missed day resets it |
| `challenges_per_day` | 3 | Small goals, each worth 2 to 4 chips (150 to 400) |
| `rebuy_amount` / `rebuy_below` | 5 / 3 (500 / 250) | Once per game day, a player under 3 net worth can claim 5 |
| `min_bet` | 1 (10) | Smallest bet in any game |
| `max_bet_pct` | 100 | Largest bet as a share of the wallet. 100 means all-in is allowed |
| `big_bet_pct` | 50 | A bet at or above this share of net worth is flagged as a big bet in the room |

### Wallet

- A player has a **wallet** (spendable) and a **vault** (protected, see the steal section). Net worth is the two added together.
- Every change goes through the ledger with a reason: `season_start`, `bet`, `payout`, `refund`, `daily_bonus`, `challenge`, `rebuy`, `steal_in`, `steal_out`, `fine_in`, `fine_out`, `shield_purchase`, `vault_deposit`, `vault_withdraw`, `admin_adjust`.
- _(Added Nov 18, 2026.)_ Further reasons for the additions: `rank_purchase`, `rank_income`, `chat_drop`, `giveaway`, `steal_attempt_purchase`. The streak bonus keeps `daily_bonus`.

### Challenges

- Each player gets three per game day, picked from a pool. Examples: win 3 blackjack hands, hit a single number in roulette, cash out above 3x in crash, play three different games.
- Progress is worked out by querying that player's settled rounds for the game day. No game needs challenge code inside it.
- A finished challenge shows a toast, and the player claims the chips with one click.

### Ranks

_(Added by Tyton, Nov 18, 2026. Owner: economy lane.)_

- Ranks replace the flat daily bonus. Every player has a rank that pays income. The streak bonus stays.
- Income accrues continuously at the rank's daily rate and is claimed with a Collect button in the top bar. Uncollected income caps at 24 hours' worth. Compute it from saved timestamps against database time.
- Tiers (all config, for a starting balance of 100):
  - Base: free, income 5 per day
  - Bronze: unlocks day 1, costs 150, income 15 per day
  - Silver: unlocks day 3, costs 1,000, income 100 per day
  - Gold: unlocks day 6, costs 10,000, income 1,000 per day
  - Platinum: unlocks day 10, costs 100,000, income 10,000 per day
  - Diamond: unlocks day 14, costs 1,000,000, income 100,000 per day
  - Crown: unlocks day 18, costs 10,000,000, income 1,000,000 per day
- A rank cannot be bought before its unlock day. A player can buy only the next rank up, and at most one per game day. The price is removed from the game and does not count toward net worth.
- Ranks cannot be bought in the final 24 hours and cannot be stolen or sold.
- Each rank gives a badge and name color shown in chat, the leaderboard, the online list and the player's seat.
- Show a countdown to the next unlock in the shop and announce each unlock in chat.

Naming note: in code these ranks are called **tiers** (`tier`), because "rank" already means a player's place on the leaderboard.

### Giveaways

_(Added by Tyton, Nov 18, 2026.)_

- Chat drops (economy lane): at random times a pot appears in chat and the first few players to claim it split it. Frequency, pot size and number of winners are config. Claims are decided on the server, one per player per drop.
- Admin giveaways (admin lane): the admin can give chips to chosen players or split a pot among everyone. Each one posts in chat with names and amounts, and is written to the public audit page.
- Rebuy stays, so a broke player always has a way back in.

### Keeping it balanced

The season simulation in the steal section also reports the total chip supply day by day. Use it to check that bonuses do not swamp winnings by week four.

## Games

Every game is a shared room where each player plays their own rounds at their own speed and everyone sees everyone else's play live. Roulette and crash go one step further: one shared round for the whole table.

### The room model

- A room is a page, such as `/room/blackjack`. Entering it joins that room's live channel.
- **Seats.** Each player in the room has a seat: avatar, name, current bet, live game state. Your own seat is large and central. The others are smaller around it. The layout handles 1 to 10 seats.
- **No turns.** Nobody ever waits on another player. There is no separate solo mode either: alone, you sit at the same table with empty seats, and a friend who logs in appears next to you.
- **Public events drive the other seats:** bet placed, card dealt, tile opened, result. Hidden information is never in a public event.
- **Big bets get noticed.** An all-in, or a bet at or above `big_bet_pct` of net worth, makes that seat glow with a tag before the outcome shows.
- **Results travel.** Every settled round goes to the ticker. Big wins and big losses also post in chat.
- **Same bet controls everywhere:** amount box, half, double, max, repeat last bet. Enter or Space confirms.
- **Bets are typed, not clicked.** _(Added by Tyton, Nov 18, 2026.)_ The shared bet box accepts a number or shorthand: "all", "half", "5k", "2.5k". After a round ends the cursor is already in the box, so a player can type an amount and press Enter without touching the mouse. Chips are only an animation after the bet is placed.
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

The edges for mines, plinko, crash and slots are config values.

### Blackjack

- **Rules.** Six decks, shuffled fresh for every hand. Dealer stands on all 17s. Blackjack pays 3 to 2. Double on any first two cards. Split once, double after split allowed, split aces get one card each. No surrender, no insurance. The dealer checks for blackjack when showing an ace or a ten-value card. A push returns the stake.
- **Dealing.** Cards are drawn one at a time from what is left of the six decks. The hole card is drawn at the reveal, except when the peek needs it at the deal.
- **Speed.** Chips move the instant you confirm. Cards animate when the server answers. From a result, one key deals the next hand at the same bet.
- **Keys.** H hit, S stand, D double, P split, M set bet to max, Space deal or rebet.
- **Other seats** show each card as it lands, the hand total and the result.
- **Tests.** Every rule above, payouts for every outcome, and a simulation of basic strategy over a few million hands that lands near the expected edge.

### Roulette

- **Wheel.** European, numbers 0 to 36, single zero. One table and one wheel for everyone.
- **Clock.** Rounds run on a fixed cycle: 20 seconds of betting, 7 of spin, 3 of result. Round number is `floor((server time - season start) / cycle)`, so every browser is in the same round by definition. The times are config.
- **Bets and payouts.** Single number 35 to 1, split 17, street 11, corner 8, six line 5, dozen and column 2, red or black, odd or even, high or low 1 to 1. Several bets per round. Chips leave the wallet when placed. Bets can be cleared until betting closes.
- **The number.** It is drawn with `crypto.randomInt(37)` by the first request that arrives after betting closes, and saved in that round's row. A unique constraint on the round number means only one draw can win. Nobody, including the owner, can know it earlier, because it does not exist earlier.
- **Settlement.** The same transaction that saves the number pays every bet in the round. Browsers in the room all call settle at the close time; the first one does the work and the rest read the saved result. A scheduled function sweeps any round left unsettled.
- **Empty rounds.** If nobody has a bet down at the close, the wheel does not spin and nothing is saved.
- **The table** shows every player's chips on the felt in their color. The wheel starts spinning at the close time on every screen and slows onto the number when it arrives.
- **Keys.** Click to place, right-click to remove, R repeat last round's bets, C clear. A strip shows the last 12 numbers.
- **Quick-bet box.** _(Added by Tyton, Nov 18, 2026.)_ Roulette has a quick-bet box that uses the same syntax as UnbelievaBoat: `<amount> <space>`. Examples: "200 odd", "600 2nd", "50 17", "all red". Spaces it accepts: a single number, dozens (1-12, 13-24, 25-36), columns (1st, 2nd, 3rd), halves (1-18, 19-36), odd, even, red, black. Typed bets appear as chips on the table. Clicking spots on the table still works. Splits, streets, corners and six lines are click-only.

### Mines

- A 5 by 5 grid. The player picks 1 to 24 mines and a stake, then opens tiles. Each safe tile raises the multiplier. Cash out any time. A mine loses the stake.
- **Multiplier** after `k` safe tiles with `m` mines: `(1 - edge)` times the product, for `i` from 0 to `k - 1`, of `(25 - i) / (25 - m - i)`.
- **Draw late.** No mine layout is stored. Each opened tile is a mine with probability `m / (25 - k)`. When the round ends, the remaining mines are placed at random on unopened tiles for the reveal.
- Other seats show the grid filling in. The full layout shows to everyone only after the round ends.

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
- The room is a row of machines. You see your neighbors' reels spin and stop live.

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
3. **Shield check.** If the target holds a shield charge, the steal is blocked. One charge is used, the attempt is used, no fine is paid, and the target gets immunity.
4. **Roll.** Otherwise the steal succeeds with probability `steal_success_pct`.
5. **Success.** Chips move from the target's wallet to the thief's wallet. The vault is never touched. The target gets immunity.
6. **Failure.** The thief pays `steal_fine_pct` of the thief's own wallet to the target.
7. Every attempt is saved, posted in chat and shown in the ticker.

**The amount.** `gap` is the thief's rank minus the target's rank, read at the moment of the attempt. A positive gap means the target is ahead.

- If the gap is positive: `rate = min(steal_max_rate, steal_base_rate + steal_per_rank * gap)`.
- If the target is behind the thief: `rate = steal_down_rate`.
- `amount = floor(target wallet * rate)`, then limited to what is left of the target's daily cap.
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
| `immunity_hours` | 3 | Immunity after being robbed or after a shield block |
| `steal_floor` | 25 (2,500; rebalanced Nov 18, 2026) | Players under this net worth cannot be robbed |
| `final_freeze_hours` | 24 | No steals this close to the season end |

**Worked example.** You are 10th with 4,000 chips. The leader has 60,000 in the wallet and nothing in the vault. The gap is 9, so the rate is the 4% maximum. A success moves 2,400 chips: you gain 60%, the leader loses 4%, gets 3 hours of immunity and has hit the daily cap. A failure costs you 200 chips, paid to the leader.

### Shields

- A shield is a **charge**, not a timer. One charge blocks one steal and then starts the immunity window.
- Hold at most `shield_max_charges` (2). Buy at most `shield_weekly_limit` (3) per season week.
- Price is 2% of the buyer's wallet, with a minimum of 300 chips. The chips are removed from the game. _(Rebalanced Nov 18, 2026: the minimum is 3 chips.)_
- The top bar shows charges as pips and immunity as an exact countdown.
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

## Social layer

The social layer is what makes ten separate players feel like one room: who is here, what just happened, and a record of all of it.

- **Online list.** Who is online, which room they are in, their rank, and a status such as in a hand or idle. Away after 5 minutes without input. Click a name for a profile card with stats and a Steal button.
- **Chat.** One channel for everyone. Messages are plain text, up to 300 characters, limited to 5 per 10 seconds. The last 100 load on open and scrolling up loads more. Emoji reactions from a small set. A mention highlights for the person named. Admins can delete.
- **System posts in chat,** styled apart from player messages: big wins and losses, steals and shield blocks, a new player in first place, a bonus streak milestone.
- **Seat reactions.** Click a seat to float a quick emote over it. Rate-limited and not saved.
- **Ticker.** Every settled round from every room: player, game, stake, result.
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

## Live events

The database is the truth and live events are only the news of it. A browser that misses events recovers by fetching the current state.

| Channel | Who can listen | Carries |
| --- | --- | --- |
| `presence` | Everyone | Who is online, their room and status |
| `chat` | Everyone | `chat.message`, `chat.deleted`, `chat.reaction` |
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
- **Recovery.** On connect, reconnect and tab focus, the browser refetches room state, wallet and leaderboard. Events older than the fetched state are dropped.
- **No per-frame data.** The crash multiplier and the roulette spin are computed in the browser from a start time.
- **No waiting on your own echo.** The player who acted animates from the API response.

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
src/shell/                 layout, routing, top bar, sidebar
src/kit/                   shared game components and hooks
src/live/                  live client wrapper
src/theme/                 tokens and themes
src/games/<game>/          room UI and manifest.ts
src/features/<name>/       pages and manifest.ts
scripts/                   season simulation and tools
tests/<lane>/              unit, integration and browser tests
```

The foundation thread may adjust this to fit what is already in the repo. It records the final map in `docs/LANE_GUIDE.md`, and that file wins.

### Manifests: how lanes plug in without touching shared code

- Each game exports `src/games/<game>/manifest.ts` with its id, name, icon, room component, Floor card, replay view and how-to-play text.
- Each feature exports `src/features/<name>/manifest.ts` with its routes, nav items, top-bar widgets and profile-card actions.
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
| Blackjack | `lane/blackjack` | The blackjack room | `blackjack` |
| Roulette | `lane/roulette` | The shared-wheel roulette room | `roulette` |
| Heist | `lane/heist` | Steal, shields, vault, shop, season simulation | `heist`, plus `scripts/simulate-season.ts` |
| Economy | `lane/economy` | Daily bonus, streaks, challenges, rebuy, final day, podium, Hall of Fame | `economy`, `season` |
| Arcade | `lane/arcade` | Mines, then Plinko _(Crash moved to its own lane, Nov 18, 2026)_ | `mines`, `plinko` |
| Slots | `lane/slots` | The slots room | `slots` |
| Social | `lane/social` | Chat upgrades, reactions, notifications, history and replays, profiles, leaderboard page | `social`, `history`, `profile` |
| Admin | `lane/admin` | Admin panel, config editor, Audit page | `admin` |

_(Updated Nov 18, 2026.)_ Changes to the lanes above:

- **Crash gets its own lane** in the second wave: branch `lane/crash`, builds the crash room, owns the name `crash`. Arcade keeps Mines and Plinko and owns `mines` and `plinko`.
- **Economy** also builds Ranks and chat drops (see Economy > Ranks and Giveaways).
- **Heist** also owns the Shop page and the new simulation report (see Steal, shields and vault > Shop and Tune it before the first season).
- **Admin** also builds admin giveaways (see Economy > Giveaways).
- **Social** also builds GIFs in chat (see Social layer > GIFs in chat).

- **First wave:** Blackjack, Roulette, Heist, Economy. These are the games your group plays most and the season mechanics.
- **Second wave:** Arcade, Slots, Social, Admin. _(Nov 18, 2026: plus Crash.)_
- Run as many at once as you can comfortably review. Four is a sensible ceiling.

**When a lane needs a shared change.** It does not make the change. It lists it under a heading named Shared changes needed in its pull request and progress file. You hand the list to one thread working on `main`, merge that, and the lanes pull.

**Merging.** One lane at a time. Check its deploy preview first. After each merge, every open lane pulls `main` and reruns its tests. If the lockfile conflicts, reinstall instead of editing it by hand.

### Stage 3: Integration (one thread, branch `integration`)

1. **Consistency pass.** Open every room side by side. Make spacing, motion, sound levels and wording match.
2. **Phone pass.** Play every game one-handed at 375px wide.
3. **Speed pass.** Load each room lazily, check bundle size, check that server round trips stay quick.
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
| blackjack | `lane/blackjack` | Games: the room model, Blackjack | `blackjack` |
| roulette | `lane/roulette` | Games: the room model, Roulette | `roulette` |
| heist | `lane/heist` | Steal, shields and vault | `heist`, `scripts/simulate-season.ts` |
| economy | `lane/economy` | Economy; Accounts and seasons | `economy`, `season` |
| arcade | `lane/arcade` | Games: the room model, Mines, Plinko _(Crash moved to its own lane, Nov 18, 2026)_ | `mines`, `plinko` |
| slots | `lane/slots` | Games: the room model, Slots | `slots` |
| social | `lane/social` | Social layer | `social`, `history`, `profile` |
| admin | `lane/admin` | Admin and trust | `admin` |
| crash | `lane/crash` | Games: the room model, Crash _(added Nov 18, 2026)_ | `crash` |

### Integration thread

```text
You are finishing a private casino site for a group of friends. Read docs/SPEC.md, docs/LANE_GUIDE.md and every file in docs/progress/ before doing anything else.

All lanes are merged. Your job is Stage 3 (Integration) from the Build plan, on the integration branch. You may edit any file.

Work through the Stage 3 list in order. For each item, write what you found and what you changed in docs/progress/integration.md. Use the deploy preview in a real browser for every pass, with at least two logged-in players, at desktop and phone widths, and take screenshots.

Do not add features. Fix, align, harden and tune. If something in the spec was never built or was built differently, list it for me instead of quietly building it.

You are done when every item in "Quality bar" holds for every room and feature, and the full run-through test passes on the deploy preview.
```

## Quality bar

A room or feature is done only when every line here is true.

- **Correct.** The rules match this spec. Unit tests cover them. Where there is a house edge, a test proves the return is within tolerance.
- **Safe.** Parallel requests cannot overdraw a wallet. A replayed request changes nothing. No response or live event contains hidden data, and a test checks the payloads. Every endpoint needs a session, validates input and is rate-limited.
- **Live.** A second browser sees the change within about a second. A refresh mid-round resumes the round. A dropped connection recovers without a reload.
- **Fast.** Something on screen responds within 100ms of any input. Server round trips are under half a second for 95% of requests. Nothing jumps as content loads.
- **Polished.** Every state change animates. Sounds play. Buttons have hover, pressed and disabled looks. Loading, empty and error states are designed. Keyboard shortcuts work. Reduced motion is honored.
- **Phone-ready.** Fully playable one-handed at 375px wide.
- **Clear.** A new player understands the room without help. Payouts and odds are visible. Each game has a short how-to-play card.
- **On the record.** The round is saved with full detail, shows in the ticker and History, and replays correctly.

## Sources

Checked on November 17, 2026.

- [Netlify: how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
- [Netlify Database docs](https://docs.netlify.com/build/data-and-storage/netlify-database.md)
- [Netlify Server is now available in Early Access](https://www.netlify.com/changelog/2026-11-10-netlify-server-early-access/)
- [Netlify Server real-time docs](https://docs.netlify.com/build/server/real-time/)
- [Ably Free package](https://ably.com/docs/pricing/free)
