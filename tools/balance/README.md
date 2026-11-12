# Balance tools

Three layers of balance checks, cheapest first. Run the heavy ones through the guard (see `tools/heavy/README.md`), never `simulate.ts` or `nightly.ts` directly.

| Command                                        | Layer          | Time                       |
| ---------------------------------------------- | -------------- | -------------------------- |
| `bun run balance:model`                        | Analytical     | Under a second             |
| `bun run test`                                 | Model          | Part of the test suite     |
| `bun run test:full`                            | Smoke pass     | Part of the full tier (CI) |
| `bun run balance -- --wave 4 --runs 200`       | Wave snapshots | Seconds                    |
| `bun run balance -- --wave all --runs 100`     | Wave snapshots | About a minute             |
| `bun run balance [runs]`                       | Campaign bot   | Minutes                    |
| `bun run balance:nightly`                      | Everything     | About 20 minutes           |
| `bun run balance:nightly -- --update-baseline` | Everything     | Also rewrites the baseline |

## The human bot and AIM=sharp

The default bot plays like a person (`bot/hand.ts`, decided 2026-10-31: real players lost far more than the bot, on waves 1 to 4, to Groaners and Hotfoots). It waits about 300 ms after picking a target before it fires, its first flick misses by up to about 0.35 radians and settles over about 0.4 s, it aims where it saw a moving target a moment ago (fast sideways movers get away), it keeps its target unless another is much nearer or about to bite, it steps every 6 frames instead of 4, and it flees only the zombies near its aim or within earshot. Every limit is seeded, so a run replays exactly. `REACTION_MS`, `HUMAN_SHAKE`, `OVERSHOOT`, `SETTLE_FRAMES`, `LAG_FRAMES`, `SWITCH_RATIO`, `PANIC_PX`, `NOTICE_PX`, and `NOTICE_DEGREES` tune it.

`AIM=sharp` plays the old bot, which re-aims at once with only a little shake and knows where every zombie is: a skilled player's stand-in. Easy and Normal are tuned on the human bot, Hard and Nightmare on `AIM=sharp`, and the nightly sets `AIM` for every job.

## The escape

A win is an escape (`docs/ESCAPE_PLAN.md`, layer 17). The bot plays the dare (`bot/escape.ts`): in a break it buys open the boards toward a thing on the list, the padlock the hunt's plan opens next (`huntPlan` in `src/features/bots/dareSearch.ts`, planned backward from the list: the thing, its room, the nearest shut boards on the way, the keys they ask), takes what a case opened for it holds when it beats the weaker of its two guns (or is the Laser Sight), and fetches every thing on the list it can reach the way its room finds it: it walks onto one, keeps still in reach of a worked one (the parlour's trunk, the library's hollow book, the kitchen's dumbwaiter) while no zombie is within 45 px, and for the dark cellar's thing yanks the bulb's chain in a wave first. In a wave it shoots the dining room's chandelier down on 3 or more zombies in the party table's gap (`chandelierShot` in `src/features/bots/dareSearch.ts`), as the teammate bots do. It never works the other room tools. Its keys (`bot/shopping.ts`) go to the kitchen and to the rooms that hold a thing on the list, bought in a break only (a room opened mid-wave wakes a rush), never to a room with nothing on the list; the fridge gets the rest. A break's errands go in this order: the boards, a thing on the list in an open room, the stove's perk on its stronger gun once the kitchen kills light it, a case, the crates and traps, the fridge, the pantry's goodie. It runs these errands in a break only: walking to the stove or the pantry mid-fight cost escapes (Easy 25% against 30% in a break only, 100 runs, 2026-11-11). It fights Uncle Chunk where he comes in, reading his tells as the teammate bots do (`chunkDodge` in `src/features/bots/escape.ts`: out of a winding stomp's or slam's ring, still just outside it, off a charge's lane and a glob's mark), watching only the zombie nearest it in his fight and the two nearest elsewhere (`WATCHED`), and once his key opens the front door it walks out (no hat, no hold-out). Before READY it walks back to where it holds; a break past a minute sends it back, past a minute and a half it goes from wherever it stands. Two hearts down it pulls the fridge for the Sandwich too. The campaign report adds two Escape lines (when the list was done, when Chunk came (`chunkWave`), when he fell (`keyWave`), the wave escaped on, things found, cases opened, and how long his fight took (`chunkFightMs`)), a Finale line (Chunk came in X runs and ended Y (Z%), his fight S s), a line of the median wave each room opened on, and its tables run to wave 14 for the ramp.

## The end report

`END_REPORT=1 bun run balance 100` adds the end report (`endReport.ts`, recorded by `bot/runEnd.ts`). Each run gets a line on where it stopped: Escaped, DiedToChunk (he stood when it fell), DiedListDone (the list done, Chunk not in yet), DiedHunting, or TimedOut. The line also gives the wave, the hunt plan's step (`Save 38` is 38 keys short of the next padlock, see `huntPlan` in `src/features/bots/dareSearch.ts`), the list found, things still behind boards or hidden in an open room, boards still shut on the list, keys left, cases opened for the bot and not taken, and cases still locked. Each Uncle Chunk fight gets a line too: the bot's hearts and its distance to him every other second, its share of the fight inside his slam's reach (56 px), with 3 or more other zombies within 48 px, and aimed at him, and the hearts each attack and each crowd kind took. Then the batch's tally of both, and three more (`bot/ledger.ts`): the cases left waiting against the guns carried; the keys a run found by source (kills, cleared waves, wiped packs, the pantry, the Dud) and spent (boards, the fridge), the chandelier's drops, the ring found and held at each break, and what the runs that died hunting found, pulled, and held; and the hearts the crowd took outside his fight on waves 5 and 6 and on every wave, by kind and by what the bot was doing (fighting, reloading, fetching, working a find), with each one's share of the time and hearts a minute, and the median crowd within 48 px.

What it showed on Normal (100 runs, 2026-11-11, before this pass's fight changes):

- Half the runs (48) died hunting, on wave 5 (median), a thing behind boards in 98% of them with 37 keys left (a padlock asks 40, 75, then 90). Runners and Shamblers killed 36 of the 48. The bot was short on keys because it died, not because it spent them: a fridge pull is 2 keys and the stove asks none.
- Chunk came in 48 runs, fell in 12, and killed the bot in 36. The bot held about 57 px from him, in his slam's reach 47% of the fight. His bite took 35 hearts, his Belly Slam and globs 8 each. The crowd took 121 (Runners 69, Shamblers 35), and many fights began with 1 to 3 hearts left.
- Keeping 80 px off him cut his bites to 3 but brought his globs (28) and charges (11), since past 70 px he spits and charges, and the crowd stood nearer than him, so the bot shot him less. Escapes fell from 12 to 8, and to 9 at 62 px. The balance bot keeps its 52 px berth; the teammate bots keep 62 px (`CHUNK_KEEP_PX`).
- A dodge that froze through every wind-up, a belch's and a spit's as well as a stomp's and a slam's, cut Normal to 4 escapes: the bot stood still while the crowd walked in, and his bite took 48 hearts. Read only for a stomp or a slam, Normal came back to 15.
- Watching the two nearest zombies outside his fight (`WATCHED`), against one, and a Heart sought from 170 px both cost escapes: the Heart drew the bot past him. It seeks every pickup from 90 px.

After this pass (100 runs each, 2026-11-11, Hard and Nightmare `AIM=sharp`): Easy 42, Normal 15, Hard 1, Nightmare 4 escapes. On Normal Chunk came in 55 runs and fell in 15; the bot held 58 px, in his slam's reach 46%, crowded 5% of the fight, and lost a median 0 hearts in his first 10 s. Hunting deaths were still 44, 32 of them a padlock away (the plan's `Save`, a median 30 keys short) with 45 keys left. On Hard and Nightmare hunting took 74 and 92 runs. So the next wall is surviving waves 5 and 6 with keys enough for the second padlock, not the fight with him.

A third pass (2026-11-11) added the key ledger, the crowd tally, and the case tally, and asked what they show. On Normal (200 runs):

- Keys come as a person's do. A run found 171 (kills 134, wiped packs 28, cleared waves 6, the pantry 3) and spent 120 on boards and 7 on the fridge. Feats open cases, which hold guns, not keys, and READY early pays rank, not keys. The ring held a median 58 at the wave 5 and 6 breaks and 99 at wave 7's, so the runs that die hunting (90, 61 of them a median 31 keys short of the next padlock, holding 49) die before the keys come in, not because the fridge took them (9 a run).
- The crowd took 593 hearts on waves 5 and 6 outside his fight: Runners 265, Shamblers 130, Throwers 111. The bot fights 72% of that time (1.6 hearts a minute) and reloads 25% of it (2.2 a minute), and half its hearts go with 1 zombie or none within 48 px: the fast ones it never kites clear of, not a mob.
- The cases left waiting hold a fresh Rifle (173), Shotgun (72), or Blunderbuss (55), while it carries a levelled SMG or Cooker, which `gunValue` rates higher. Leaving them is the bot's valuation, not a bug.
- Three fight ideas each cost escapes on Normal (100 runs, against 15): swapping to the other gun under pressure instead of reloading (10), ordering threats by seconds to reach rather than distance (10), and a wider berth from Runners (9). None is kept.
- The chandelier as a skill (`chandelierShot`, shared with the teammate bots) drops it 6.3 times a run, in every run, and moves escapes within the noise (14 of 100 against 15). It stays, as a skill a person uses.

After it (Hard and Nightmare `AIM=sharp`): escapes Easy 43 of 100, Normal 23 of 200 (12%), Hard 1 of 100, Nightmare 3 of 100, each within the noise of before.

## Callings

`CALLING=Handyman` (or `TrackStar`, `PennyPincher`, `LineCook`; `You` is the default) plays that calling, with rank enough to start it. For example `CALLING=TrackStar bun run balance 100`. The Line Cook starts with the Cooker alone, so the bot lobs it at the nearest zombie and makes its first buy a firearm. A calling should land within about 5 points of YOU's win share on Normal; see "Rank and Bones" in `GAME_DESIGN.md` for the last measure.

## Run modifiers

`MODS=BigCrowd,Broke,Glass` (any case, commas; the same set the lobby toggles) plays the run with those modifiers on. For example `MODS=Glass bun run balance -- --runs 100`. `FriendlyFire` is refused: the bot plays alone, and the modifier bites only with teammates. The measures and the bonuses they suggest are in `GAME_DESIGN.md`, "Run modifier bonuses".

## Portrait view

`VIEW=portrait` (for example `VIEW=portrait bun run balance -- --wave all --runs 100`) makes the bot see only the zombies inside the portrait camera's window on a 390x844 phone, 120 by 160 of the room at 3/2, which follows it and leans toward its aim, the way a phone held upright shows the room. It does not shoot what it cannot see, and flees only what it sees or what is within earshot (`NOTICE_PX`) past the window's edge. It gets the touch aim assist (`src/input/aimAssist.ts`) every tick its trigger is held, the way a phone does. `VIEW=touch` sees only the landscape phone's window, 240 by 135 of the room at 4/3, as a 16:9 phone on its side plays, with the same aim assist, and `VIEW=wide` the 291 by 135 window of a 19.5:9 or wider phone, whose screen widens to 388. `NO_ASSIST=1` plays either without it. The nightly plays two portrait campaign passes (see below). See "Portrait play" in `GAME_DESIGN.md` for the comparison.

## The analytical model

`model.ts` reads the real tables: wave plans rolled for six seeds, the level's health scale, bounties and the clear bonus, shop prices and upgrade tiers. It buys the bot's loadout wave by wave, works out its sustained damage a second (magazine and reload included), and plays each wave as a flow of health through the holds, rests, quiet hurries, the alive cap, and the boss's entrance. `ASSUMPTIONS` (`modelAssumptions.ts`) holds the guesses: how much of each gun's fire lands, the upkeep a visit, and when hearts start costing money. They are calibration knobs, not measurements.

`model.test.ts` tests the math on hand-made tables and holds the guardrails from `GAME_DESIGN.md`, wave length ceilings included. A guardrail not met yet is a `test.todo` that prints today's value.

## Wave snapshots

`simulate.ts --wave n|all` plays single waves. A snapshot is the model on the first frame of a wave's Preparation in a campaign run the bot played. Slot k of `--slots` (10) uses the first of the seeds k, k + 10, k + 20, and so on whose run reached the wave. Run i of a wave starts from slot i mod 10, rolls the wave again from its own seed, and plays it to the next Preparation or the end. Besides cleared and hearts it reports the median length (held to `WAVE_LENGTH_TARGETS`) and the quiet seconds: no zombie alive, nothing at a door or the boss's door, and spawns still to come (held to `QUIET_TARGET`).

Snapshots are derived by playing, not saved as fixtures. A fixture would be a whole Model, which changes shape whenever the game does, so it would go stale with every new field or zombie kind. Playing to the wave start costs one partial run per slot, a few seconds, and is cached for the life of the process, so `--wave all` derives each slot's run once. Workers split a pass by slot, so no two derive the same run.

## The nightly suite

`nightly.ts` runs these jobs one after another, each through `simulate.ts --json` with the guard's `WORKERS`: Normal default, Normal `SWAP=1`, Easy, Hard, Nightmare, endless on Normal, the portrait passes (200 runs each), and the snapshot pass for every wave on Normal (100 runs a wave). Easy, Normal, endless, the portrait passes, and the snapshots play the human bot; Hard and Nightmare play `AIM=sharp`. It decodes each summary with the Schemas in `summary.ts`, adds the model's numbers, judges the targets in `targets.ts`, compares everything with `baseline.json`, and writes `reports/<YYYY-MM-DD>.md` (gitignored). The summary at the top lists what is in target, what drifted past its noise tolerance, what is out of target, and which portrait passes win too far from landscape. It exits 0 and prints the report's path. `--runs n` and `--wave-runs n` shrink the jobs for a quick try. Every job sets `VIEW`, so a `VIEW` in your shell does not leak into the landscape jobs.

The portrait passes are Normal default and Easy, each with `VIEW=portrait` (`PORTRAIT_PAIRS` in `targets.ts`). Each is held to the same win target as its landscape twin, and the report's Portrait section puts them side by side: their table, a line per pair with the win gap, and deaths by wave for both. A gap over 8 points (`PORTRAIT_GAP_TOLERANCE`, about two standard errors of the difference of two 200 run shares) is listed in the summary. Each pass costs over two minutes, so `SWAP=1` stays landscape only, and Hard and Nightmare do too, since their win shares are too close to zero to show a gap in 200 runs. For a one-off portrait check of another bot, run it by hand: `VIEW=portrait SWAP=1 bun run balance 200`.

The baseline is written when it is missing or with `--update-baseline`. `--extend-baseline` adds only the metrics the baseline has never seen, such as a new job's, and keeps every stored number. The tolerances in `suite.ts` sit at the noise of the batch sizes: about 5 points for a share over 200 runs and 8 over 100.

## Files

| File                     | What it holds                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot.ts`                 | A campaign run: the bot's frame loop and what it logs, and the seeds                                                                                                                         |
| `bot/basics.ts`          | The Model, the bot's options, its keys, and what it sees                                                                                                                                     |
| `bot/state.ts`           | `BotState`, the plans and logs one run carries, made fresh for each run                                                                                                                      |
| `bot/logs.ts`            | The logs a run fills as it plays, and the wave timeline                                                                                                                                      |
| `bot/results.ts`         | `RunResult` and `WaveRun` as Schemas: what a run reports, and what a worker writes and the main process decodes                                                                              |
| `bot/hand.ts`            | The human hand: reaction time, aim that trails and overshoots, sticky targets, what it notices; `AIM=sharp` skips it                                                                         |
| `bot/dodging.ts`         | Pickups, the floor's and the boss's tells, kiting and engaging                                                                                                                               |
| `bot/route.ts`           | The way between the rooms, and whether a point is floor a player stands on                                                                                                                   |
| `bot/escape.ts`          | The escape: the list, the rooms that hold it, the display cases, the front door                                                                                                              |
| `bot/guns.ts`            | The guns it carries and which one a new gun replaces                                                                                                                                         |
| `bot/fighting.ts`        | The Pan's stance, the knife, where it walks in a wave, aiming and firing                                                                                                                     |
| `bot/fridgeFighting.ts`  | The fridge weapons' plans: the Cooker, the Pan, and Brain Freeze                                                                                                                             |
| `bot/shopping.ts`        | Keys for the rooms, the fridge, the pantry and the stove, the crates and traps, the wave's errands, and the break's plan                                                                     |
| `bot/snapshots.ts`       | Wave snapshots and the wave pass                                                                                                                                                             |
| `bot/runEnd.ts`          | What the end report reads: where a run stopped, off its last frame, and each Uncle Chunk fight's trace                                                                                       |
| `bot/ledger.ts`          | What the end report reads of a run's keys (where each came from and went) and of the crowd's bites outside his fight (the kind, what the bot was doing, how many stood near)                 |
| `endReport.ts`           | The end report (`END_REPORT=1`): each run's end and Chunk fights, and the batch's tally                                                                                                      |
| `simulate.ts`            | The command line: campaign and snapshot passes, workers, the text report, `--json`                                                                                                           |
| `pacing.ts`, `pacing.sh` | Pacing per wave and per run, read off the World every frame (`docs/PACING_REPORT.md`); `bun run heavy -- --cpu sh tools/balance/pacing.sh <runs>`, then `bun tools/balance/pacing.ts report` |
| `summary.ts`             | Run summaries and their Schemas                                                                                                                                                              |
| `model.ts`               | The analytical model: the waves rolled, the economy, the rows, time to kill, and printing                                                                                                    |
| `modelAssumptions.ts`    | The model's guesses (`ASSUMPTIONS`)                                                                                                                                                          |
| `modelShop.ts`           | The model's prices in keys, the loadout, and the shopping list a visit buys                                                                                                                  |
| `modelFlow.ts`           | A wave played as a flow of health through the holds, rests, quiet hurries, the alive cap, and the boss                                                                                       |
| `targets.ts`             | The targets from `GAME_DESIGN.md`, as data                                                                                                                                                   |
| `suite.ts`               | The nightly's jobs, metrics, target verdicts, baseline drift, and report                                                                                                                     |
| `nightly.ts`             | The nightly's shell: runs the jobs and writes the files                                                                                                                                      |
| `baseline.json`          | The stored numbers the nightly compares against, written by the first nightly run                                                                                                            |
| `*.test.ts`              | The model and suite tests, run by `bun run test`; `snapshot.sim.test.ts`, the wave 2 smoke pass, by `bun run test:full`                                                                      |
