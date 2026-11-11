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

A win is an escape (`docs/ESCAPE_PLAN.md`, layer 17). The bot plays the dare (`bot/escape.ts`): in a break it buys open the boards toward a thing on the list (each room behind boards holds one thing, so it opens the rooms that hold one, the rooms on the way first), takes what a case opened for it holds when it beats the weaker of its two guns (or is the Laser Sight), and fetches every thing on the list it can reach the way its room finds it: it walks onto one, keeps still in reach of a worked one (the parlour's trunk, the library's hollow book, the kitchen's dumbwaiter) while no zombie is within 45 px, and for the dark cellar's thing yanks the bulb's chain in a wave first. It never works the other room tools. It fights Uncle Chunk where he comes in, dodging the Belly Slam's ring like the stomp's, and once his key opens the front door it walks out (no hat, no hold-out). Before READY it walks back to where it holds; a break past a minute sends it back, past a minute and a half it goes from wherever it stands. Two hearts down it pulls the fridge for the Sandwich too. The campaign report adds two Escape lines (when the list was done, when Chunk came (`chunkWave`), when he fell (`keyWave`), the wave escaped on, things found, cases opened, and how long his fight took (`chunkFightMs`)), a Finale line (Chunk came in X runs and ended Y (Z%), his fight S s), a line of the median wave each room opened on, and its tables run to wave 14 for the ramp.

## Callings

`CALLING=Handyman` (or `TrackStar`, `PennyPincher`, `LineCook`; `You` is the default) plays that calling, with rank enough to start it. For example `CALLING=TrackStar bun run balance 100`. The Line Cook starts with the Cooker alone, so the bot lobs it at the nearest zombie and makes its first buy a firearm. A calling should land within about 5 points of YOU's win share on Normal; see "Rank and Bones" in `GAME_DESIGN.md` for the last measure.

## Run modifiers

`MODS=BigCrowd,Broke,Glass` (any case, commas; the same set the lobby toggles) plays the run with those modifiers on. For example `MODS=Glass bun run balance -- --runs 100`. `FriendlyFire` is refused: the bot plays alone, and the modifier bites only with teammates. The measures and the bonuses they suggest are in `GAME_DESIGN.md`, "Run modifier bonuses".

## Portrait view

`VIEW=portrait` (for example `VIEW=portrait bun run balance -- --wave all --runs 100`) makes the bot see only the zombies inside the portrait camera's window on a 390x844 phone, 120 by 160 of the room at 3/2, which follows it and leans toward its aim, the way a phone held upright shows the room. It does not shoot what it cannot see, and flees only what it sees or what is within earshot (`NOTICE_PX`) past the window's edge. It gets the touch aim assist (`src/input/aimAssist.ts`) every tick its trigger is held, the way a phone does. `VIEW=touch` sees only the landscape phone's window, 240 by 135 of the room at 4/3, as a phone on its side plays, with the same aim assist. `NO_ASSIST=1` plays either without it. The nightly plays two portrait campaign passes (see below). See "Portrait play" in `GAME_DESIGN.md` for the comparison.

## The analytical model

`model.ts` reads the real tables: wave plans rolled for six seeds, the level's health scale, bounties and the clear bonus, shop prices and upgrade tiers. It buys the bot's loadout wave by wave, works out its sustained damage a second (magazine and reload included), and plays each wave as a flow of health through the holds, rests, quiet hurries, the alive cap, and the boss's entrance. `ASSUMPTIONS` holds the guesses: how much of each gun's fire lands, the upkeep a visit, and when hearts start costing money. They are calibration knobs, not measurements.

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
| `bot/shopping.ts`        | Shopping, the kitchen, the ammo window, the fridge, and the break's plan                                                                                                                     |
| `bot/snapshots.ts`       | Wave snapshots and the wave pass                                                                                                                                                             |
| `simulate.ts`            | The command line: campaign and snapshot passes, workers, the text report, `--json`                                                                                                           |
| `pacing.ts`, `pacing.sh` | Pacing per wave and per run, read off the World every frame (`docs/PACING_REPORT.md`); `bun run heavy -- --cpu sh tools/balance/pacing.sh <runs>`, then `bun tools/balance/pacing.ts report` |
| `summary.ts`             | Run summaries and their Schemas                                                                                                                                                              |
| `model.ts`               | The analytical model                                                                                                                                                                         |
| `targets.ts`             | The targets from `GAME_DESIGN.md`, as data                                                                                                                                                   |
| `suite.ts`               | The nightly's jobs, metrics, target verdicts, baseline drift, and report                                                                                                                     |
| `nightly.ts`             | The nightly's shell: runs the jobs and writes the files                                                                                                                                      |
| `baseline.json`          | The stored numbers the nightly compares against, written by the first nightly run                                                                                                            |
| `*.test.ts`              | The model and suite tests, run by `bun run test`; `snapshot.sim.test.ts`, the wave 2 smoke pass, by `bun run test:full`                                                                      |
