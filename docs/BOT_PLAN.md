# Bot plan: a better scripted bot, and a bot that plays like you

Two tracks, planned 2026-11-11. The owner's read: Uncle Chunk and the zombies are easy for people, so low bot escape rates measure the bot, not the game. Neither track changes a difficulty knob.

## Track A: fix the scripted bot

The scripted bot stays the balance bot of record, deterministic from a seed, held to human limits (`tools/balance/bot/hand.ts`). It shares what it can with the teammate bots through `src/features/bots/`.

Where it stands (commit 686b32440, 100 runs each): escapes Easy 30%, Normal 12%, Hard 3%, Nightmare 1%. It now spends keys on the right rooms, fetches list things about 4 s after a room opens, cooks at the stove, and takes the pantry goodie. Chunk ends 54 to 75% of the fights he comes to.

Steps, cheapest first:

1. **An end report per run** (in progress): where the run stopped (wave, list progress, rooms and padlocks still shut, unspent keys, unclaimed cases), and for a Chunk fight, which attack hit the bot, its hearts over time, and its range to him. Every later step is judged by what it shows.
2. **The Chunk fight** (in progress): read his tells and step out of each attack, keep a safe range, circle the cover, use its best gun and the fridge weapons, take heals. Positioning goes in `src/features/bots/` so teammates get it.
3. **Plan backward from the list** (HTN style): the next thing, its room, that room's padlock, the keys, the feats or cases that pay them. A utility score picks between steps, with a danger map from zombie density.
4. **Search memory**: each room's spots, which were searched, and whether the cellar was lit, so no spot is searched twice.
5. **Room tools as tested skills** in `dareSearch.ts`: gramophone, shelf, chandelier, valve, barrels, soup pot, each with its Story test.
6. **Personas** (later): two or three human styles (careful, rusher) so balance numbers are a range, not one bot.

## Track B: a bot that plays like you (imitation learning)

Learn the owner's own play from recordings and use it as a human-like stand-in, first for balance, maybe later as the teammate bots.

### Why it fits this game

- The game is a pure, seeded function of each seat's per-tick `Intent` (`src/world/schema/entitySchema.ts:27`: a move vector, an optional aim direction, trigger, interact) and a few `SeatAction` presses (`src/world/step/stepWorld.ts:121`). That is a small action space, and a recording of it replays exactly.
- A recording needs only the seed, the run's settings, and the intent and presses per tick. Everything the bot "saw" is rebuilt by replaying, so a whole run is tens of kilobytes.
- The teammate bot is already a pure `World -> Intent` function (`teammateBot.ts`, `intentFor`), the exact slot a learned policy would take.
- The research agrees: EA SEED's Battlefield 1 agents started from 30 minutes of human play; MLMOVE (2024) learned human Counter-Strike movement with a small transformer at about 0.5 ms a step on one CPU core and was rated 16 to 59% more human-like than commercial bots; a 2025 tactical shooter paper did the same on modest CPU.

### The design: the plan is scripted, the hands are learned

Pure behaviour cloning fails at long plans from small data (it drifts into states the human never showed, the Quake "Cortex" agent died in 33 of 40 episodes). So:

- **Scripted planner** (Track A's step 3) picks the goal: where to go next and why.
- **Learned policy** does the moment to moment: how to move, aim, fire, dodge, and kite, given the goal. This is where people are good and the scripted bot is bad.

### Steps

1. **Recorder.** A recording flag (dev `?record=1` first) logs the seed, settings, device, and per-tick intent and presses. A replay tool checks the recording plays back to the same World hash (`tools/determinism` has the hashing).
2. **Observations.** A pure `World -> number[]` view per seat: own state (hearts, gun, ammo, reload), the nearest zombies relative to you (sorted, fixed count), Chunk and his tell, the goal's direction from the planner, nearby walls and cover. Lives in `src/features/bots/`, tested.
3. **Training** on the M3 Pro (36 GB, 18 GPU cores) with MLX or PyTorch on the GPU, in `tools/learn/` (Python through `uv`, run through the heavy guard). A small network (an MLP or a small transformer over the zombie list, under a million weights) trains in minutes.
4. **Running it in TypeScript.** Export the weights; inference is plain `+` and `*` in float64 with ReLU in a fixed order, so it is bit-exact across Bun, Node, Chrome, and workerd (no `exp`, `tanh`, SIMD, or fused multiply-add; `tools/determinism/detMath.ts` if one is needed). Well under 1 ms a tick.
5. **Takeover sessions (human-gated DAgger).** Play beside the learned bot; when it drifts (stuck on a wall, eating a Chunk slam), take over, and only those fixes train the next round. Research shows this cures most of plain cloning's failures with far less play.
6. **Judging it.** How often it picks your action on held-out runs; its escape rates against your own real ones; and a blind test: Demi watches clips and guesses bot or person.
7. **Later.** Stronger or weaker personas by fine-tuning with a pull toward your play (Meta's piKL: strong but still human-like). Teammate bots only once it is small, deterministic, and passes `bun run world:check` and the determinism tools.

### What step 1 built (November 2026)

The recorder, the upload, and the replay, as "Recorded runs" in `PLATFORM.md` describes. One finding for the steps after it: the World is a pure function of the intents only within one engine family. `Math.sin` and `Math.cos` (a spread shot in the step, the bots' aim and runs) differ in the last bit between JavaScriptCore and V8, so the replay plays each recording in Bun and in Node and takes the one that matches. Training reads observations off the replayed World, so it should replay each run in its own engine too; a learned policy for the teammate bots would need `detMath.ts` in the step itself.

### How much play

About 30 to 60 minutes (5 to 10 runs) to see anything, 2 to 3 hours for a usable bot, then takeover rounds of 15 to 30 minutes each.

## Decided (owner, 2026-11-11)

- **Whose play:** the owner's only, to start. Others come later as their own personas.
- **Recording:** a RECORD MY RUNS toggle in Settings that uploads each run to new storage behind the Worker (an R2 bucket and an endpoint beside `/record`), tagged by player. Works on phones too.
- **Who sees the toggle:** hidden, unlocked by opening a secret `?record=1` link once on a device; uploads are tagged by player id so training picks the owner's.
- **The model's job:** the hands, not the plan. The scripted planner picks where to go; the model learns moving, aiming, dodging, and kiting.
- **Where it ends up:** the balance bot first; the teammate bots later, only once it is small, deterministic, and plays well beside people.
- **Takeover sessions:** yes, built once a first model exists.
- **Devices:** keyboard and mouse and touch both recorded, tagged by device.
- **Order:** Track A finishes its current pass on #180. Track B starts as its own branch and PR after #180 merges, beginning with the recorder.

## Sources

- Killzone 2 multiplayer bots (HTN): https://www.slideshare.net/guerrillagames/killzone-2-multiplayer-bots
- Exploring HTN planners: https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter12_Exploring_HTN_Planners_through_Example.pdf
- Exploration in NetHack (occupancy maps): https://arxiv.org/pdf/1711.03087
- Learning to Move Like Professional Counter-Strike Players: https://arxiv.org/pdf/2408.13934
- Human-like Bots for Tactical Shooters: https://www.researchgate.net/publication/387671140_Human-like_Bots_for_Tactical_Shooters_Using_Compute-Efficient_Sensors
- EA SEED, Imitation Learning with Concurrent Actions: https://www.ea.com/seed/news/seed-imitation-learning-concurrent-actions
- Cortex, compact behaviour cloning for Quake: https://arxiv.org/html/2607.22739v1
- Human-driven dataset augmentation (HG-DAgger, Minecraft): https://arxiv.org/pdf/2201.07719
- piKL, strong and human-like play: https://web.mit.edu/~gfarina/www/2022/human_like_pikl_icml22/human_like_pikl.icml22.pdf
- Human-regularized RL (Diplomacy): https://arxiv.org/pdf/2210.05492
- MLX on Apple silicon: https://developer.apple.com/videos/play/wwdc2024/10160/
