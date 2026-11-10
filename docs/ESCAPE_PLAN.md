# Escape the Manor: the build plan

How the Munch Manor dare gets built, layer by layer, as one stack of pull requests that lands in one big update. The story is in [`LORE.md`](../LORE.md), the rules in "Escape the manor" in [`GAME_DESIGN.md`](../GAME_DESIGN.md), and the flow in [`FLOW.md`](../FLOW.md). This file is the order of work, what each layer touches, and how each is checked. Written with the owner on 2026-11-10 from a Q&A and a survey of the code.

## How it ships

- **One stack, one merge.** The work is a stack of pull requests made with GitHub's `gh stack` extension (`gh extension install github/gh-stack`), one branch per layer, each based on the one below, all in one worktree. Each layer passes `typecheck`, `lint`, `test`, and `build` on its own, and `test:full` when it touches gameplay. Nothing merges to `main` until the whole stack is done and reviewed; then `gh stack merge` lands it, and production gets everything in one deploy.
- **No flag.** A `VITE_*` flag can only hide client code, and the World, the co-op wire, and the Worker ship as one in every build, so two rule sets cannot live side by side. The stack is the gate.
- **Co-op protocol 20.** The World goes on the co-op wire straight from its Schema, so the first layer that changes the World bumps `PROTOCOL_VERSION` and `MIN_PROTOCOL_VERSION` to 20 (`packages/netcode/src/Protocol.ts`, with its history note) and each later layer only re-pins `GOLDEN_DIGEST` in `src/world/net/__tests__/worldCodec.test.ts`. The deploy ends every co-op run in progress (a room's checkpoint will not decode), and older clients are refused and shown the update prompt. Kept runs from before are dropped quietly. That is expected for a release this size; say so in What's New.
- **Previews.** Every layer's pull request gets its own preview stage (`munch-manor-pr-<n>`), with the co-op dev page, so each layer can be played on a phone before the next is built on it.
- **Go easy on the laptop.** Every heavy job runs through the guard (`bun run balance`, `bun run heavy -- ...`), at most about three balance batches a layer, 100 runs to sort ideas and 200 to confirm. The full balance pass waits for layer 17.

## Decisions

From the owner, 2026-11-09 and 2026-11-10.

| Area         | Decision                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story        | The Munch Manor dare. Your friends write the dare card. The party never ended; the zombies are the guests and every daredevil who failed.                                                                                                                                                                                                   |
| Scope        | Everything in one update: the story and art, no shop, the escape goal, and rolled rooms. Leaving early comes later.                                                                                                                                                                                                                         |
| Rooms        | Five: a brand-new dining room (the start, with the front door), the kitchen, the parlour, the library, and the cellar. Rooms behind the boards roll from the pool.                                                                                                                                                                          |
| Shop         | None. Guns sit in display cases opened by feats of every kind (kill counts, skill, exploring, and things from the pool the dare did not ask for). Guns level up with kills.                                                                                                                                                                 |
| Guns         | Today's Barn Buster and Chatterbox in cases, plus two new ones: an antique hunting rifle and a blunderbuss.                                                                                                                                                                                                                                 |
| Ammo         | Endless. Magazines and reloads stay.                                                                                                                                                                                                                                                                                                        |
| Currency     | Skeleton keys, dropped by zombies (bigger zombies drop more), one shared ring in co-op. Spent on padlocked boards and the fridge.                                                                                                                                                                                                           |
| Stove, valve | Opened by feats, not keys.                                                                                                                                                                                                                                                                                                                  |
| Co-op feats  | Each player's own progress; a case opens for whoever finishes its feat.                                                                                                                                                                                                                                                                     |
| Heroes       | The Penny Pincher: zombies drop more keys for her, one fewer heart. The Handyman: found traps are sturdier and he repairs them free. Tuned with the balance bot.                                                                                                                                                                            |
| Broke        | Half the keys, and the fridge stays locked.                                                                                                                                                                                                                                                                                                 |
| Rattles      | Stays as a character with no stall: the first daredevil, from 1924, hollering hints in his bubble.                                                                                                                                                                                                                                          |
| Difficulty   | Renamed Dare, Double Dare, Triple Dare, Triple Dog Dare. It also sets the dare list's length (2, 3, 3, 4 things before Uncle Chunk's hat) and how much help you get.                                                                                                                                                                        |
| Power-ups    | Renamed and restyled as the house's things, each with a matching aura: Wind-Up Key, Family Silver, Dancing Shoes, Hat Pins, Dinner Gong, Pickled Heart. Same rules.                                                                                                                                                                         |
| The finale   | Uncle Chunk appears only at the front door once the rest of the list is found. Take his hat, hold the hall while the door unlocks, then walk out together: a player through the door is out of the fight and safe, and the run ends as an escape once no one stands in the house and one at least is through (the downed go out with them). |
| Waves        | They count up and ramp; no fixed count. The ten tuned waves become the start of the ramp.                                                                                                                                                                                                                                                   |
| Endless      | "Stay the night", picked on the dare card: no list, waves forever. No going back in after an escape.                                                                                                                                                                                                                                        |
| Tutorial     | Redone for the dare: wave 1 practice, then a guided first break (grab a key, open a case, read the dare card).                                                                                                                                                                                                                              |
| Rewards      | 10 points a wave, points for each dare item found, 50 for Uncle Chunk's hat, 100 for escaping, times the difficulty. A failed run still pays for what it found.                                                                                                                                                                             |
| Intro        | A cutscene: the car, the drive, the steps, the knock, HELLO?, the slam. Skippable up to the slam; the slam is never skipped and starts the run for the whole crew at once.                                                                                                                                                                  |
| Lobby        | PLAY is the dare; the lobby is the dare card. START shakes on it, BACK chickens out.                                                                                                                                                                                                                                                        |
| Art          | I draft every piece in the game's pixel style; the owner and Demi review it in Munch Studio with pinned notes, layer by layer.                                                                                                                                                                                                              |

## Defaults to review

Choices the plan makes that nobody has signed off yet. Each is easy to change before its layer is built.

- **The house plan.** Five fixed slots, each room built to its slot's footprint. The dining room in the middle, the front door in its south wall, the kitchen fixed to the north, and three slots (west, east, and one beyond the east room) that the parlour, library, and cellar roll into. Six arrangements per run.
- **Spawn doors.** The dining room gets four spawn doors named like the parlour's (North, West, East, South), so the ten tuned wave tables keep working; the front door and the exits are separate and never spawn.
- **Key costs and drops.** Starting points for the bot to tune: a Groaner drops a key one time in four, a Hotfoot one in three, a Kaboomer or Big Leaguer one, a Big Lug two, an Ankle Biter one; a room costs 3 to 5 keys by how deep it is, a fridge pull 2.
- **Gun levels.** Beefy at 40 kills with that gun, DELUXE at 120, 3000 at 250. A fridge weapon levels the same way.
- **Feats per case.** Each run rolls which gun and which feat go in which case, from per-difficulty pools, so the easy feats sit near the start.
- **The stove and the valve.** The stove cooks after 15 kills in the kitchen in this break and the last wave; the valve lights after 10 kills while standing in the kitchen. The Line Cook's starting lids (moot with endless ammo) become a stove that needs half the kills.
- **Traps and hearts.** A trap crate sits in each room and opens when the room does (a Plank Pile or a Grumpy Gnome); traps mend for free by standing at them in a break. Hearts come from drops (Pickled Heart), the pantry, and the fridge.
- **The Laser Sight** becomes a display case prize.
- **The fridge's Dud** refunds a key instead of cash. The pantry's cash goodie becomes a key.
- **The intro** is a World phase, `Arriving`, so the room in co-op sets the slam for everyone; single player plays the same phase.
- **Uncle Chunk's health** scales with the wave he arrives on, from today's wave 10 tuning, on the Endless curve.
- **Saves and stats.** Save version 17 drops `ammoTip` and the shop lesson and adds the new lessons. Run summary version 5 adds an `Escaped` outcome and keys spent in place of purchases, with D1 migration `0007`.
- **Names stay as tags.** Difficulty and power-up renames change only what a player reads. The tags in saves, sync, analytics, and the wire (`Easy`, `RapidFire`, ...) stay.

## The layers

Bottom to top. Each layer names its goal, what it changes, and how it is checked. Every layer also keeps the file tables in `CLAUDE.md` in step (lint fails a module no table names), adds its tests as Block-aware Stories and Scenes, and re-pins the wire digest when it changes the World.

### 1. Names

**Goal.** Players read the new difficulty and power-up names. No rule changes.

- Difficulty labels and blurbs in `src/world/run/difficulty.ts` (`DIFFICULTIES[d].name`), the lock note, the home question (`src/screens/home/homeView.ts`), the co-op picks (`src/features/coop/picksView.ts`), the end card's unlock line, the status text (`src/app/view.ts`), and the share words (`SHOUTED` in `src/features/end/share.ts`).
- Power-up names and lines in `PICKUP_NAMES` (`src/world/names.ts`) and `PICKUPS` (`src/world/gear/powerups.ts`); the callouts bake from them.
- Server messages that name Nightmare (`infra/worker/gameRoom.ts`).

**Checks.** Scene tests for the labels; a test that no player-facing string still says Easy, Normal, Hard, or Nightmare.

### 2. Endless ammo

**Goal.** No gun runs out; magazines and reloads stay.

- `maybeRoundLimit` returns none for every gun (`src/world/gear/weapons.ts`); `hasEndlessRounds` and its callers simplify. Fridge weapons' charges and dents become magazines.
- Remove the ammo window (`src/world/shop/ammoCounter.ts`, `Purchasable.Ammo`, `SeatAction.BuyAmmo`, the `CounterSale` cosmetic), the ammo shop rows, and the pantry's lids. The HUD shows the magazine only (`src/screens/game/hud.ts`); `src/features/hud/ammoWarning.ts` keeps the last-shots tick for a magazine and loses the rest.
- Save version 17 drops `ammoTip` (`src/shared/playerData.ts`, `migrateV16` in `src/platform/save.ts`).
- Protocol 20 (action codes shift; `roomWorld.test.ts` pins them).

**Checks.** `reload.story`, the ammo warning and HUD tests, `seatAction.parity`, a balance batch on wave snapshots to see the guns' power with free ammo.

### 3. Guns level up with kills

**Goal.** Beefy, DELUXE, and 3000 are earned by kills with that gun.

- `CarriedGun` gains a kill count; `UPGRADE_TIERS` trades `price` for a kill threshold (`src/world/gear/weapons.ts`); kills credit the gun that made them (`src/world/step/hits.ts`, `melee.ts` for the knife's own count if wanted).
- The shop stops selling upgrades; `shopUpgrades.ts` text becomes the level-up callout.
- A level-up fanfare and the gun slot's tier mark (`src/render/hudLayout.ts`, `hud.ts`).

**Checks.** Story: kills level a gun, a swapped gun keeps its level, a fridge weapon levels. Wire digest re-pinned.

### 4. Display cases and feats

**Goal.** Guns come out of display cases opened by feats. The shop stops selling guns.

- A feat engine in `src/world/feats/` (new folder): a `Feat` union (Kills, KillsWith, KillsOf, NoHitWave, Streak, OwnBlast, OpenedRoom, LitFire, KeyFromMarked, Delivered) with per-seat progress, the counters fed from the step's events (`ZombieKilled`, hits, waves).
- A `cases` list in the World (keyed, in `KEYED_LISTS`): where each stands, what it holds, its feat, who opened it. Hand-picked case spots per room, like the pantry's (`src/world/kitchen/pantry.ts`). A case opens for whoever finishes its feat in co-op.
- The stove and the gas valve unlock by feats through the same engine (`src/world/kitchen/stove.ts`, `gasValve.ts`), no longer bought.
- The Laser Sight moves into a case.
- Art: the glass case, the gun rack, the trophy case; the feat icon and ring on each lock; the opening.

**Checks.** Stories for each feat kind, solo and co-op (per-seat progress); `seatAction.parity`; perf scene budget with cases in the room.

### 5. Two new guns

**Goal.** The hunting rifle and the blunderbuss, in cases.

- Rows in the weapon table (`src/world/gear/weapons.ts`), names (`src/world/names.ts`), sprites turned to aim (`src/art/sprites/guns.ts`), bullet looks, sounds (`src/audio/audioRecipes.ts`), shop guide and Munchopedia entries.
- The rifle: slow, heavy, pierces a line. The blunderbuss: a wide short spray and a big shove.

**Checks.** Stories for pierce and spray; wave snapshot batches with each gun; atlas test.

### 6. Found traps and hearts

**Goal.** Traps and hearts come from the house, ahead of the shop's removal.

- A trap crate per room (`src/world/gear/traps.ts`, a new crate entity), opened when the room is; free repairs by standing at a trap in a break.
- Hearts only from drops, the pantry, and the fridge. Glass's rules carry over.
- The Handyman's new perk (sturdier found traps, free repairs) in `src/world/heroes/calling.ts` and `src/domain/callingSpecials.ts`.
- As built: a crate stands in the parlour and, once open, the kitchen (`src/world/gear/crates.ts`), open in breaks from wave 2. Each break every crate rolls a fresh find (a Plank Pile three times in five), taken or not, so a find nobody may carry never sticks; walking on takes it within the trap caps. Standing still at a damaged trap in a break mends it, broken to whole in 1.5 s. The Handyman's traps have half again the health, and he mends twice as fast. Rattles keeps guns, ammo, upgrades, and the sight until layer 7.

**Checks.** Trap stories (`traps.story`, `crates.story`), the Handyman's card, Glass's sweep.

### 7. Skeleton keys, and no shop

**Goal.** The shop and money are gone; zombies drop skeleton keys spent on boards and the fridge.

- The World's money becomes one shared key ring: `Wallet` leaves `SeatState`; a `keys` count on the World; the money section of `src/world/party/party.ts` becomes key drops; bounties become drop chances by kind (`src/world/zombies/zombies.ts`, `combat.ts`, `hits.ts`, `frenzy.ts`, `waves.ts`); kitchen kill pay goes.
- `Purchasable` costs keys through `offersOf` and the hold (`src/world/shop/purchase.ts`): exits (`exits.ts`, padlocks with a number), the fridge (`leftovers.ts`, Dud refunds a key). The stove and valve already moved to feats.
- Delete the shop: `src/world/shop/shop.ts` (but `refill` and `grant`, moved), `src/features/shop/` (the shop dialog Block, the stall), `src/app/update/shop.ts`, its Bindings and Composition entries, `menuState`'s Shop, the shop guide's Shop page, and the `Buy` and `LeaveCounter` seat actions. `purchaseView.ts` and `purchaseHud.ts` stay, with a key in place of the coin.
- The Penny Pincher's new perk, Broke as half the keys, the pantry's key goodie.
- Rattles keeps his art and bubble for hints (`src/screens/game/stallBubble.ts`, `src/features/kitchen/kitchenCall.ts`); his stall, shop lines, and the coffee button's name are reworded.
- The end card's tally and the crew awards: keys found in place of cash, a Key Keeper award in place of Big Spender (`src/features/end/`).
- Teammate bots stop shopping (`src/features/bots/teammateBot.ts`).
- The first break's quest becomes "grab a key, open a case" for now (`src/features/onboarding/firstBreakQuest.ts`); the kitchen tour gives the first keys (`src/world/run/tutorialRules.ts`).
- Run summary version 5 (`keysSpent`, `casesOpened` in place of `purchases`), D1 migration `0007`, the report's queries.
- The balance bot's shopping (`tools/balance/bot/shopping.ts`) is replaced by a stub that opens rooms and cases, enough for `test:full`; the real bot is layer 17.

**Checks.** The hardest layer to keep green: party, fridge, exits, kitchen, modifiers, heroes, end, onboarding, and bot tests all move. `bun run determinism`, `world:check`, `mp:e2e`.

### 8. The house as a grid of rooms

**Goal.** The level engine places rooms on a two-dimensional plan, with no change a player sees.

- `LevelSpec` rooms get an origin column and row (`src/world/level/arena.ts`), so a room can sit west of the start; `buildLevel` composes them; door ids grow a `Front` door (`DoorId`, `DOOR_SYMBOLS`, `DOOR_OUTWARD`, `doorRoute.ts`, `wavePacks.ts`, trap lays, door art).
- Nothing reads `PARLOUR` directly: the start spot, the crew's seats, and `rollWave`'s default doors come from the level (`worldSchema.ts`, `party.ts`, `endlessWaves.ts`, `wavePlans.ts`).
- Room art bakes per room, not per set of open exits (`src/render/room/`, `src/art/spritePrecompile.ts`), so rolled rooms do not multiply images.
- `bun run perf:check` with the bigger map; the flow field and the alive cap measured again.

**Checks.** `arena.story`, `pathing`, `exits.story`, the camera tests, `determinism:diff` shows no change in play.

### 9. The dining room

**Goal.** Runs start in the new dining room; the parlour becomes a room you open.

- The dining room's map, cover (the long table), doors, spawn doors, the front door, and art (`src/render/room/`): reviewed in Munch Studio before it is wired.
- The kitchen attached to its north; the parlour into a slot; the start spot at the table.
- Test fixtures that assume the parlour (`PARLOUR_SPOT`, `RUG_CENTER`, the bot's `ROOM_CENTER`) move to the start room.
- A wave snapshot pass on the new start room.

**Checks.** Story and Scene tests from the new start, `shots34.ts` and `PORTRAIT=1 taps.ts` audits, perf.

### 10. The library and the cellar

**Goal.** Two new rooms, each with one twist, in fixed slots first.

- The library: tight aisles and a bookshelf that swings open as a secret door between two slots.
- The cellar: dark, lit near each player; the light is a baked mask, cheap per frame. Wine racks as cover.
- Their art, Munchopedia pages, and case spots and hiding spots.

**Checks.** Perf scene budget for the cellar's light, pathing through the secret door, audits.

### 11. Rolled rooms

**Goal.** The parlour, library, and cellar roll into the three slots each run.

- A house stream (a salted seed, like the fridge's) rolls the arrangement at run start (`src/app/runReset.ts`, `src/world/net/roomWorld.ts` `freshWorld`).
- A cloche over the doorway lifts as the boards come down.
- `GAME_DESIGN.md`'s "Not now" moves "Procedurally generated manors" to say hand-made rooms roll.
- The teammate bots and the balance bot route by the level, not by fixed spots.

**Checks.** Stories for every arrangement, `determinism` across engines, co-op rooms agree on the arrangement.

### 12. The dare

**Goal.** A run is an escape: find the dare list, then the finale.

- The pool of the house's things (`src/world/dare/`, new folder): each thing with its one way to get it: hidden in a spot, carried by a marked zombie, locked in a case, cooked at the stove, found by its sound, or behind boards. The list rolls by difficulty from its own salted stream; the hiding spots too.
- Carrying and delivering things; a thing off the list opens a case (the `Delivered` feat).
- The dare card in the HUD: empty outlines that fill (`src/render/hudLayout.ts`, `src/screens/game/hud.ts`), in portrait and landscape.
- The escape ramp: a campaign run no longer ends at wave 10 (`clearWave` in `src/world/waves/waves.ts`); past it, waves come from the Endless generator. Uncle Chunk never comes by wave number in an escape.
- The finale: with the list done, Uncle Chunk comes through the front door (`src/world/zombies/boss.ts`, a fixed door in place of `pickDoor`), his health from the wave he arrives on. Taking his hat starts the hold-out: the front door unlocks on a clock while the waves press; then it opens and the run ends when every standing player is through.
- An `Escaped` phase in place of `Victory` for the campaign (`Phase`, `isWonRun`, `isRunOver`, the end card, share text, music); Triple Dog Dare unlocks with a Triple Dare escape (`NightmareLock`, `infra/worker/syncCore.ts`).
- Rewards per item (`src/world/heroes/rank.ts`, `src/features/end/rankRun.ts`).
- Endless ("stay the night") has no list and keeps Uncle Chunk every tenth wave.
- The difficulty dial: list length and help (sparkle on Dare, a doodled hint a break on Double Dare, a marked carrier on Triple Dare, the house hungrier from the first find on Triple Dog Dare). Rattles hollers the hints.
- As built: hiding spots are each room's drafted marks (`roomSpotsOf`), so they follow the rooms into their slots, and a thing rolls into a spot or a case by its room's depth (1 for the dining room, 3 behind one set of boards, 6 behind two), so most of the hunt needs keys. The guest book's page is locked in a display case behind boards and falls out when the case opens; Grandma's recipe cooks out of the stove the first break a player earns the stove's feat; a thing off the list brought to a locked case opens it for that player (`src/world/dare/dareCases.ts`). Uncle Chunk never comes before wave 6 on Dare and Double Dare or wave 8 on Triple Dare and Triple Dog Dare (`FINALE_RULES.chunkFromWave`), since a first balance batch escaped most Double Dare runs at wave 3. On Triple Dog Dare the house is hungrier from the first thing found.

**Checks.** Stories for each way to get a thing, the finale end to end, co-op escapes with a downed teammate carried out, `test:full`, `mp:e2e`, the co-op audit.

### 13. The intro

**Goal.** The cutscene from the dare card to the slam.

- An `Arriving` phase at run start in the World (`startRun` in `src/app/runFlow.ts`, `startRoomWorld` in `src/world/net/roomWorld.ts`), ending on the slam; the room sets it in co-op so every screen slams together.
- The beats drawn as a client cosmetic read off the phase's clock, like the end card's beat (`src/features/end/endBeat.ts`): the car, the chewed sign, the daredevils' cars, the party hat and flashlight, the knock and the knock back, the coats and the waving hand, HELLO? and the place card, the slam. Any press skips to the slam; full the first time, the knock and the slam after.
- The dare card in your pocket opens after the slam and folds into the HUD; the first wave starts once it is read.
- Its music and sounds (`src/app/update/music.ts`, `src/audio/`).

**Checks.** Scene tests for the beats and the skip, a co-op test that the slam lands on one room tick for every client, audits on phones.

### 14. The dare card lobby

**Goal.** PLAY is the dare; the lobby is the card.

- The solo lobby's view and styles (`src/features/lobby/view.ts`, `lobby.css`, apart from co-op's classes): who goes in, coming as, who you drag along, the stakes, extra dares, get out or stay the night, shake on it, chicken out.
- The co-op lobby's link as "I dare you"; the home menu's PLAY as the card; the first-run difficulty question in the new words.
- Every line by key, mouse, and touch, in portrait and landscape; animations move only the art inside.

**Checks.** Lobby Story and Scene tests, `taps.ts` on portrait, the motion test.

### 15. The art

**Goal.** The house's look, drafted for review in Munch Studio.

- The zombies restyled as guests and daredevils, kind by kind, with their wear stages (`src/art/sprites/zombieArt.ts`, `bossArt.ts` for Uncle Chunk's tuxedo).
- The power-ups' pickups and themed auras in place of today's colored circle (`src/art/sprites/pickups.ts`, `auraShapes` in `src/render/powerupView.ts`), and their bullet looks.
- Munchopedia bios for the new story; Rattles' hint lines.

**Checks.** The atlas test, the perf scene budget, a Studio review round per kind.

### 16. The tutorial

**Goal.** A new player learns the dare by doing it.

- Wave 1 stays the practice wave; the guided first break becomes: grab a skeleton key, open a case with an easy feat, read the dare card (`src/features/onboarding/`).
- New lessons in the save (version 17, with layer 2's change).

**Checks.** Onboarding Stories from a new save, an audit of a first run on a phone.

### 17. Balance

**Goal.** The numbers, tuned for the new game.

- The balance model and the bot rewritten for no shop, keys, levels, cases, and the escape (`tools/balance/model.ts`, `tools/balance/bot/`): the bot opens rooms, chases its feats, hunts the list, and walks out the door.
- Targets for an escape's length per difficulty, key costs and drops, gun levels, Uncle Chunk by arrival wave, the heroes' new perks, and Broke.
- `bun run balance:nightly -- --update-baseline` once, said in the commit body.

**Checks.** The model's guardrails in `tools/balance/model.test.ts`, the nightly report, `test:full`.

### 18. Release

**Goal.** Ready to land.

- `CHANGELOG.md`: one fun day's entry for the update, and What's New.
- `GAME_DESIGN.md`'s "Decided" rewritten for the new game; `LORE.md` and `FLOW.md` marked built; `CLAUDE.md`'s tables checked.
- Audits on the top layer's preview: `live-check.ts`, `offline.ts`, `coop.ts` with three pages, `mp:e2e`, `perf:check`, `determinism`, portrait taps.
- `gh stack merge`.

## Risks

- **Layer 7 is huge.** The shop and money reach about a hundred files and their tests. If it grows past a reviewable size, split it: keys replace money first (with the shop's prices in keys for one layer), then the shop's removal.
- **Frame time.** A five-room house, the cellar's light, and cases in every room. `perf:check` on layers 8, 10, and 15.
- **Balance time.** No shop changes the whole curve. Guard budgets mean layer 17 takes days, not hours.
- **Art volume.** Five rooms, seven zombie kinds, six auras, two guns, the intro's beats. Studio review rounds are the pace setter.
- **Co-op.** Every World change moves the wire; the pinned digest and `mp:e2e` catch drift in each layer.
- **Save and stats continuity.** Version 17 and summary version 5 must accept the old shapes; the report keeps reading old rows.

## Open questions

- Which things go in the dare pool, and each one's way to get it.
- The feat pools per difficulty, and which feats suit which guns.
- What Rattles says now, and whether his look changes for 1924.
- Each room's twist in detail (the library's secret door, the cellar's dark).
