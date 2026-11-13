# Progression plan

Decided with the owner on 2026-11-12, from a review of the game flow and the production analytics. The goal: make every run, even a short one, move the player forward, and give a reason to come back tomorrow, next week, and next month. Everything here is a plan to build; numbers are first passes, tuned with the balance tools and a playtest.

## Why

The production report on 2026-11-12 (163 games, most from before the escape update, so read it as a direction, not a measure):

- **People do not come back.** 73 games on October 31, then 24, 12, and single digits most days since.
- **Most runs die before the dare starts.** 55 of 92 solo deaths are on waves 1 to 3, and the median run is 2:06. The first room opens about wave 3.
- **A loss pays almost nothing.** A wave 3 death on Double Dare pays about 2 Bones; the first hero costs 60, about 30 such runs. The whole Bones catalog is about 1,120 Bones, some 37 Double Dare escapes.
- **Run 20 looks like run 2.** "Pool unlocks" in "Rank and Bones" was never built: every room, thing, and gun is there from the first run, so a rank adds nothing to a run.
- **Nothing is kept.** Feats reset each run, a thing brought out leaves no trace, and the story between runs is still proposed.
- **Nothing to do for the next ten minutes.** There is a run, and there are ranks far off, and nothing between.

## Decided (owner, 2026-11-12)

- **All seven pillars below**, in place of the earlier idea of side dares on the dare card: daily missions take their place.
- **Daily missions: three a day, counted across any runs.** One free reroll a day, Bones for each, a bonus stamp for all three, and no penalty for a missed day: no streak that punishes.
- **Unlocks gate only new content.** Today's rooms, things, guns, and prizes stay open to everyone ("Nothing that ships today is ever locked away" stands). Milestones open what is added from now on: more list things, hiding spots, case prizes, and story pages.
- **Leaving early is at the kitchen's back door.** Held like a purchase, in a break only. It pays the points for what was found, no escape bonus, and a CHICKEN stamp.
- **Before the store launch.** The owner wants all of it before December 15 to 18. See "Build order" for the order and the cut line if time runs out.
- **Still true.** No power between runs: everything here is variety, cosmetics, story, or a harder ladder. Nothing sells Bones or heroes.

## The pillars

### A. An early death still counts

- **Leaving early** (`src/world/`, a World rule the co-op room runs). A back door in the kitchen, a station like the boards: stand still or hold the interact key in a break, once at least one thing on the list is found (with nothing found it is only quitting). The run ends as a new outcome, `LeftEarly`, between Munched and Escaped: the points for waves and things found, no Uncle Chunk, no escape's 100, and a CHICKEN stamp on the end card and the shelf. In co-op the crew leaves together: the hold needs every standing player at the door, as READY needs everyone, so nobody is pulled out of a run they want. A new outcome is a protocol bump, a `RUN_SUMMARY_VERSION` bump, and a D1 migration.
- **Your best run's ghost on the end card.** Beside the tally, a faint line for the best run on this difficulty: "WAVE 3, your best WAVE 5, the spoon". Bests per difficulty are already saved; this adds the best run's things found.
- **One tip on a death,** from what landed the last bite (Hotfoots and Groaners land 93% of them): Rattles says one short line with the zombie's picture ("HOTFOOTS HATE PLANKS"), never the same twice in a row, and none once the player has escaped on that difficulty.
- **More pay early.** Every run pays at least 3 Bones, the first run of the day pays double, and the first escape on each difficulty pays a one-time 50. The hero prices stay; they arrive in the first session or two, not the thirtieth run. Bones and rank points stay increments through sync, as now.

### B. The Proof Shelf and the Dare Journal

- **The Proof Shelf.** Your friends' treehouse, a place on the home screen beside the manor. Every thing you bring out goes on a shelf with a slot per thing per difficulty (6 things by 4 difficulties today), stamped with how you got it: the wave, the hero, the crew's names, ESCAPED or CHICKEN. Uncle Chunk's big key hangs over it once you fell him. Empty slots are dim outlines, as on the dare card. A tap on a slot shows the stamp and the thing's line of story (`DARE_LINES`).
- **The Dare Journal.** The Munchopedia becomes a journal of what you have seen: its zombie pages as now, plus rooms, things, heroes, and story pages. A page fills in by doing (first sight, first find, first escape).
- **Milestones open new content.** A table of milestones (the first escape, a thing found in every room, Uncle Chunk felled on Triple Dare, ...) each opening something new to the pool: a list thing, a hiding spot, a case prize, a story page. Story pages are guest book pages and Rattles' notes from 1924, read in order, telling why the party never ended. The story's last page is behind an escape on Triple Dog Dare.
- **Rank gives something every rank.** A gift, a Bones purse, or a journal page at each rank, front-loaded so ranks 2 to 10 come quickly. The end card already flips a card per unlock.
- **Saved** in the player scope: a `proof` table (thing, difficulty, first stamp; the first one kept), and milestones reached as a union-merged set like `seenUnlocks`. New scope migrations, new mutations, a `SAVE_VERSION` bump.

### C. Daily missions

- **Three a day, the same three for everyone**, rolled from the UTC date with the seeded generator, from a pool of short goals over any runs that day: "find 2 dare things", "40 kills with the Barn Buster", "revive a friend", "open the cellar", "an escape on Double Dare", "work 3 room tools". Each pays Bones (about 10, 15, 20 by size); all three add a stamp on the shelf.
- **One free reroll a day,** per player, rolled from the player's own seed for the day. A mission no longer possible for the player (a co-op goal for one who never plays co-op) is weighted out after a reroll.
- **No streaks that punish.** A missed day loses nothing. A calendar of stamps on the shelf counts the days done, never a run of them.
- **Where.** A small card on the home menu (three icons and bars), and on the end card a bar that fills when a run moves one.
- **Determinism.** `update` never reads the clock: the date comes in as a Message from a Subscription (as the version check does), and the Model holds `today`. Progress is counted from the run's own events when a run pays out (`rankRun.ts`), so a run's World is untouched.
- **Saved** as increments through sync (progress by date and mission, a claim once), so two devices playing the same day add up.

### D. Hero and gun mastery

- **Hero mastery.** Each hero has a track filled by runs played as them (waves and things, not wins): outfit variants of their prop, then their reason for taking the dare (the Line Cook wants Grandma Munch's recipe), then a gold prop. YOU has one too. Cosmetic and story only.
- **Gun mastery.** Lifetime kills with each gun open its skins: a Gold skin of that gun at 1,000 kills, and more past it. Kills by gun are a new increment table beside `kills_by_kind`.
- **Shown** in the Profile: a row per hero and per gun with a bar and the next reward.

### E. The dare ladder

- **Dare marks** past the four difficulties, as Hades' heat: an escape on a difficulty opens its mark 1, and each mark adds one house rule on top of the last (the modifiers first: Big Crowd, Broke, Glass, then new rules as they are built). Each mark has its own badge, kept per difficulty, and a trim on the shelf.
- **Saved and shown** as the best mark per difficulty, so modifiers have a ladder that lasts, where today they reset each launch. The bonus comes from the modifiers as now.

### F. Your friends in the car

- **The intro's car remembers.** The car beat shows one line from your friends, by how the last run ended: "Back for seconds?" after a death, "Brave or dumb?" after a quick one, "Chicken!" after leaving early, "You actually did it" after an escape. A few words each, never the same twice in a row, from the cosmetic stream. The short intro (3.8 s) gets a short version. Client only.

### G. Beat my run

- **SHARE carries the run.** The link holds the run's seed, difficulty, modifiers, and the result (wave, things, time). Opening it offers BEAT MY RUN: the same house, the same list, the same rolls, with the friend's result to beat on the end card. Determinism already makes it the same house; the play decides the rest.
- **The daily leaderboard** waits for the daily scope (`PLATFORM.md`) and friends lists, after launch. "Not now" already allows a leaderboard with the daily challenge.

## Build order

The native builds have hard dates: Play's closed test starts by December 1 and Apple's submission by December 11 (owner, 2026-11-11). Live updates (`MOBILE.md`) carry later web builds into the installed apps, so a pillar can land after the native build as long as it needs no native change; none of these do.

Cheapest first, most value early. Each is one pull request with its tests, and balance where it touches the World.

1. **A's pay and the end card:** the Bones floor, first run of the day, first escape bonus, the best run's ghost, the death tip. Built 2026-11-12 (see "What the early pay built" in `GAME_DESIGN.md`); the date Subscription came with it, so C reads `maybeToday`.
2. **F: the friends in the car.** Small, and it gives A's outcomes a voice. Built 2026-11-12 (see "What the friends in the car built" in `GAME_DESIGN.md`); "Chicken!" came with step 4's leaving early.
3. **C: daily missions,** with the date Subscription that the first run of the day also reads. Built 2026-11-12 (see "What the daily missions built" in `GAME_DESIGN.md`).
4. **A's leaving early,** a World rule, protocol, analytics, and balance (`test:full`, a wave pass). Built 2026-11-13 (see "What leaving early built" in `GAME_DESIGN.md`): protocol 21, run summary version 8, D1 migration 0011, the `LeaveEarly` mission. The balance bot never leaves early, so no wave pass was needed. The Proof Shelf's CHICKEN stamp comes with step 5.
5. **B: the Proof Shelf,** then the Dare Journal, then rank gifts at every rank. The milestone table goes in here with its first new content: two list things and their hiding spots. The shelf was built 2026-11-13 (see "What the Proof Shelf built" in `GAME_DESIGN.md`): save version 24, scope migration 0019. The CHICKEN count is left for later.
6. **D: hero and gun mastery.**
7. **E: the dare ladder.**
8. **G: beat my run.**

**The cut line.** If December runs short, 1 to 5 are the launch set and 6 to 8 follow through live updates in the first weeks after, which also gives the store listing news to post.

## Settled in Q&A (owner, 2026-11-12, second round)

1. **The shelf** is a PROOF card in the home menu's MORE hand, opening the treehouse shelf as a panel like the Munchopedia; a trophy icon with a NEW pip when something lands on it. Home's layout is unchanged.
2. **Leaving early in co-op:** the whole crew at the door. The hold fills only while every standing player is at the back door, as READY needs everyone.
3. **Daily missions' pool** has all four kinds: kills and guns ("40 kills with the Barn Buster", "10 Hotfoots", "a gun to DELUXE"), dare and rooms ("find 2 dare things", "open the cellar", "escape on Double Dare", "leave early"), house tricks ("drop the chandelier on 3", "work 3 room tools", "pull the fridge", "open a display case"), and crew and heroes ("revive a friend", "play as the Handyman", "a run with a bot"). A co-op goal rolls only for a player who has played co-op.
4. **Four new list things,** each opened by a milestone: Uncle Chunk's napkin ring (engraved CHUNK, chewed; your first escape), Rattles' 1924 dare note (the same dare as yours; a thing found in every room), Grandma's false teeth (still chattering in a jar; Uncle Chunk felled on Triple Dare), and the party invitation ("You are cordially invited... forever."; 10 dare things found in all).
5. **The dare ladder:** marks 1 to 4 turn on Big Crowd, Broke, Glass, and Friendly Fire (Friendly Fire only with a crew); marks 5 and up add house rules: Hotfoots faster, dearer padlocks, a shorter break clock, and Uncle Chunk tougher, at mark 5 and up only (owner approved). Each mark has its own badge.
6. **Delivery:** a `gh stack` of pull requests, one per pillar in build order, each passing lint, test, and build. Nothing merges without the owner.
7. **Art:** drafted in the house style and pinned in Munch Studio for the owner and Demi to review.
8. **Bones:** as planned: at least 3 a run, double for the first run of the day, 50 for the first escape on each difficulty.

## Open questions

None left from the plan. New ones go to the owner in T3 Q&A, in groups of four.
