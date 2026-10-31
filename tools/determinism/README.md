# The determinism harness

The game's `update` must be deterministic: the same seed and the same Messages give the same game. This harness checks it three ways, with one scripted player and one gameplay hash:

| Check            | Command                                         | What it proves                                                                               |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Same engine      | `bun run test:full` (`determinism.sim.test.ts`) | Two runs in one engine hash the same on every frame. A few seconds, runs in CI on every push |
| Before and after | `bun run determinism:diff -- [ref]`             | A refactor changed no gameplay: the working tree plays exactly like where it left `ref`      |
| Cross engine     | `bun run determinism`                           | Bun, Node, headless Chrome, and workerd play the same run bit for bit                        |

The two heavy ones play whole runs, so they go through the guard like every heavy job (see `tools/heavy/README.md`).

## The script

`script.ts` is a returning player (`asVeteran`), seeded, playing the campaign or endless at Normal. Each frame it sends the input Messages for that frame, then `TickedFrame`. It moves in a fixed pattern, aims at the nearest walking zombie every fourth frame, holds the trigger, presses Enter through each Preparation, and closes the stall if it opens. God mode refills its hearts, so the room fills to the alive cap. It uses no trig of its own, so any difference comes from the game.

Frame lengths come from a pattern: `Fixed60` (every frame 1000/60 ms, the room's tick) or `Mixed` (60, 120, 30, and 40 Hz frames in a cycle, like a real display). The world steps in whole 60 Hz ticks with a carry (`advanceGame` in `src/simulation.ts`), so a 60 Hz frame is exactly one tick; `fixedStep.test.ts` checks that 30, 60, and 120 Hz frames play the same ticks.

## The gameplay hash

`hash.ts` hashes the fields that `fields.ts` classifies as `World` or `Gate`, into one 32 bit number, and each field on its own to name the one that diverged.

- **Which fields.** `fields.ts` classifies every Model field: `World` (gameplay the room owns), `Gate` (client state that steers gameplay in single player today, such as the shop, hit-stop, lessons, and raw input), `Derived` (the flow fields), `Cosmetic`, and `Client`. A field missing from the table is hashed as `World`, so a new field never hides a divergence; the cross-engine report lists it. Classify it when it lands. Fields under a future `model.world` are read as if top level, so the World split keeps the same hash.
- **Canonical order.** Fields and object keys are sorted by name, so the order a value was built in never matters. Arrays keep their order (the order of zombies is state). `_tag` is read even from the prototype, as `Option` keeps it there.
- **Exact numbers.** A number hashes its float64 bits: `0.1 + 0.2` and `0.3` differ, as do `0` and `-0`. Every NaN hashes the same.
- **Every engine the same.** Words are mixed with the MurmurHash3 block step through `Math.imul`, which is exact everywhere.
- **Cheap per tick.** The Model shares structure, so an unchanged object is the same reference. The hasher remembers each object's hash in a `WeakMap` and rehashes only what a tick touched: about 0.02 ms a tick in Bun against 0.19 ms for `update`, 0.04 ms for a full walk. The test compares the cached and the full hash every frame, which also catches an `update` that mutates the Model in place.

## The same engine check

`determinism.sim.test.ts` (in the sim tier, so `bun run test:full` and CI run it, not `bun run test`) plays 1,800 campaign frames twice and 900 endless frames with mixed frame lengths twice, and the second run sees a `Math.random` that returns other numbers and a `Date.now` and `performance.now` a day later. An `update` that reads the clock or `Math.random` fails it at once. It also checks that the whole Model, client fields included, ends the same, and the hash's own rules.

## Before and after

`beforeAfter.ts` checks out where `HEAD` left `ref` (`origin/main` by default), their merge base, into a temporary git worktree, so commits that landed on `ref` since do not read as a difference; `--tip` compares against `ref`'s tip instead. It copies this harness over it so both sides hash with the same code, installs the base's own dependencies from its lockfile and patches, plays the script on both in Bun, and reports the first frame and field that differ, with the first path inside the field and both values. Options: `--frames N` (default 7,200), `--seed`, `--mode Endless`, `--pattern Mixed`, `--every N`, `--no-hit-stop` (clear hit-stop after every frame on both sides, to compare a change to how hit-stop spends world time, such as the fixed step, on everything else). A refactor that means to change nothing must report no difference.

Since each side has its own `node_modules`, a change to a dependency, to a patch in `patches/`, or to a workspace package in `packages/` shows up too. The base installs with its own Bun cache (`munch-determinism-bun-cache` in the temp folder, kept between runs, so only the first run downloads), whose patched packages are deleted before each install: Bun names a patched copy by a hash that does not follow the patch's content, so a shared cache could hand the base the working tree's copy. Before playing, it checks each side's patched packages against its patches with `git apply --check --reverse`, and stops if the working tree's `node_modules` holds an older patched copy (see "Changing it" in `patches/README.md`).

## Cross engine

`crossEngine.ts` builds the harness (`build.ts`, into the gitignored `out/`) and plays the same run in:

- **Bun** (JavaScriptCore, Safari's engine): `cli.ts` directly.
- **Node** (V8): `out/cli.js`.
- **Chrome** (V8, a browser): `out/page.html` from a file URL with `--headless --dump-dom` and a throwaway profile. Set `CHROME` to use another binary.
- **workerd** (V8, the Durable Object runtime): `out/worker.js` served by `infra/node_modules/.bin/workerd` (from this checkout or the main one), or `WORKERD`.

For every pair that disagrees it finds the first frame, asks both engines for their state at that frame, and prints the fields that differ and the first path inside them. Options: `--frames N` (default 18,000, five minutes), `--seed`, `--mode Endless`, `--pattern Mixed`, `--every N`, `--det-math` (swap in `detMath.ts` first), `--engines bun,node`, `--no-build`, `--json`. It exits 1 when any two engines disagree.

### Today's result (2026-10-29, seed 1, 18,000 frames)

| Math             | Bun vs the V8s                                | Node 24 vs Chrome 156 and workerd                | Chrome vs workerd |
| ---------------- | --------------------------------------------- | ------------------------------------------------ | ----------------- |
| The engine's own | Frame 95, `intent.maybeAim.value.x`, last bit | Frame 188, `zombies[0].knockback.x` (`Math.exp`) | None              |
| `detMath.ts`     | None                                          | None                                             | None              |

So the game is deterministic in each engine, and across engines only the transcendental Math differs. Co-op does not need cross-engine agreement (the room is the only place the world runs); replays and verified boards would.

## The World in workerd

`bun run world:check` (`worldCheck.ts`, in CI) bundles `worldWorker.ts`, which holds only `stepWorld`, its wire, and `detMath.ts`, and fails if the bundle pulls in a client, UI, art, audio, camera, input, store, or sync module. It lists the files infra's typecheck reads (infra's own `effect-tsgo tsrs --listFilesOnly`) and fails on the same modules there, since an `import type` the bundle drops still pulls the client into the Worker's types. Then it plays a World mid-wave 600 ticks in Bun and in a local workerd (`worldWorkerd.capnp`), both with `detMath.ts`, with 1, 2, and 4 players (teammates seated mid-wave, each walking and firing their own way), and fails unless the two Worlds are the same.

## Files

| File                                              | What it holds                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `fields.ts`                                       | The Model field classes: the World and client split as data          |
| `hash.ts`                                         | The gameplay hash                                                    |
| `script.ts`                                       | The scripted player and the frame patterns                           |
| `run.ts`                                          | Plays the script and records checkpoints                             |
| `diff.ts`                                         | First divergent checkpoint, first differing path, exact JSON         |
| `request.ts`, `engine.ts`                         | What an engine is asked and what it answers                          |
| `cli.ts`, `page.ts`, `worker.ts`                  | The engine entries for Bun and Node, Chrome, and workerd             |
| `build.ts`, `workerd.capnp`                       | The bundles in `out/` and the workerd config                         |
| `crossEngine.ts`, `beforeAfter.ts`                | The two heavy checks                                                 |
| `detMath.ts`                                      | Deterministic `hypot`, `sin`, `cos`, `atan2`, and `exp`, for replays |
| `determinism.sim.test.ts`                         | The same engine check and the hash's rules                           |
| `worldCheck.ts`, `worldPlay.ts`, `worldWorker.ts` | The World's bundle check and its play in workerd                     |
