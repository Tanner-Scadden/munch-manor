# Testing plan

The goal, in the owner's words: "How we can get our test suite really good. Standardized fixtures, tests are simple stories that can be defined. Test suite should be so much faster than what it is today."

This plan has five parts: what the suite costs today (measured), what the industry and the research say (with sources, proven practice kept apart from the bleeding edge), a standard fixture and story layer, the speed work, and a phased migration with effort, expected gains, and risks. The browser audits (shots, taps, and the rest) are covered in their own section. The screenshot pipeline's own speed is in `docs/IMAGES_PLAN.md` and is not repeated here.

**Status.** Recommendations 1 to 3 (section 4) are in: `isolate: false`, the `sim` tier (`*.sim.test.ts`, run by `bun run test:full` and CI), the Node environment by default, and the packages in the same run. Of 1,044 tests, 1,021 run in `bun run test` and 23 in the sim tier. At 5 workers, `bun run test` went from about 21 s to 6 to 8 s, and `test:full` takes about 21 s, most of it `pacing.sim.test.ts`. A nightly workflow runs `test:full` in a shuffled order. The store's two-device sync tests and the sync engine's status tests used to time out now and then: a scope switch landing while a session connected was missed (an engine bug, fixed), and real 250 ms timers dropped sessions under load. They now run on the TestClock and wait with `settle` from `@munch/sync-engine/testing`.

## 1. Today, measured

All numbers are from 2026-10-29 on the 12 core development laptop, at 4 vitest workers (what `bun run test` picks at normal load), with other agents' jobs running (load average 3 to 10). Times vary by about 10% between runs.

### The whole run

| Run                                   | Files | Tests | Wall  |
| ------------------------------------- | ----- | ----- | ----- |
| `bun run test`, all three vitest runs | 72    | 1030  | 30 s  |
| Main vitest run (`src/`, `tools/*`)   | 65    | 975   | 26 s  |
| `packages/sqlite-wasm-effect`         | 3     | 18    | 0.7 s |
| `packages/sync-engine`                | 4     | 37    | 1.8 s |

Vitest's own breakdown of the main run: tests 39 to 42%, import 31 to 36%, environment 10%, setup 8%, transform 7 to 8%. It reports that 469 modules were evaluated 21,417 times (35.5 s of import time summed across workers) and estimates that `isolate: false` would save about 8 s.

### Where the time goes

1. **One file is the long pole.** `src/pacing.story.test.ts` takes 13.6 s on its own, and a file is vitest's unit of parallel work, so no worker count makes the run shorter than that file. One of its tests, "no wave leaves the room empty and unannounced for more than a second", plays every wave for five seeds and takes 7.8 s.
2. **Ten tests are over half the test time.** Out of 975 tests, 704 run in under 10 ms, and only 18 take 300 ms or more. Those 18 take 24.8 s of the 38.2 s spent in tests, and the 10 tests over 1 s take 21 s. All 18 are whole-wave replays: seed sweeps, "the same seed replays identically" double runs, the wave 2 balance smoke pass, and the in-engine determinism check.
3. **Every file imports the whole game again.** With `isolate: true` (the default), each of the 65 files evaluates its module graph from scratch. A Story file that imports `update` spends about 630 ms importing: `src/main.ts` 505 ms in total, `src/sprite.ts` 126 ms of its own (PNG encoding and base64 at module load), the `effect` barrel 90 ms (pulled in by Foldkit's Scene matchers in the setup file, for every file, Story files included), `src/screens.ts` 42 ms of its own, and `@foldkit/ui` 102 ms. A CPU profile of the same import in Bun puts about 90 ms in sprite and PNG work (base64 35 ms, `png.ts` 28 ms with `crc32` the top function, `sprite.ts` 24 ms) out of 300 ms.
4. **Every file pays for a DOM.** All files run in happy-dom. Only 26 of 65 files touch the DOM (Scene tests, plus a few Story tests that build elements, dispatch window events, or use localStorage). The other 39 could run in plain Node.

### The 20 slowest tests

| Time   | File             | Test                                                                        | Why it is slow                      |
| ------ | ---------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| 7.81 s | pacing.story     | no wave leaves the room empty and unannounced for more than a second        | 8 waves x 5 seeds, whole waves      |
| 2.94 s | pacing.story     | the preview matches every zombie on every campaign wave for several seeds   | seed sweep over all waves           |
| 1.66 s | balance/snapshot | the smoke pass clears wave 2 the same way every time                        | bot plays wave 2, three runs        |
| 1.45 s | horde.story      | a Tank fits through every doorway ... and reaches the player                | pathing replay per doorway          |
| 1.25 s | waves.story      | wave 1 can be cleared, leads to wave 2 preparation, and replays identically | whole wave, twice                   |
| 1.24 s | pacing.story     | wave 2's first pack walks in within 2 seconds of the wave starting          | wave replay per seed                |
| 1.22 s | determinism      | two campaign runs hash the same on every frame                              | 1800 frames, twice                  |
| 1.18 s | crawler.story    | a wave with Ankle Biters ... replays the same from the same seed            | whole wave, twice                   |
| 1.15 s | horde.story      | the preview matches the kinds that come out of each door and the floor      | seed sweep                          |
| 1.15 s | difficulty.story | the same seed on the same difficulty plays out the same                     | whole wave, twice                   |
| 0.86 s | pacing.story     | the preview matches every zombie that comes out of each door                | wave replay                         |
| 0.56 s | determinism      | two endless runs with mixed frame lengths hash the same                     | 900 frames, twice                   |
| 0.48 s | horde.story      | a fight with Exploder chains replays identically from the same seed         | fight, twice                        |
| 0.45 s | traps.story      | a wave with traps replays identically from the same seed                    | wave, twice                         |
| 0.38 s | store            | a linked device gets the look and kills, and its change comes back          | SQLite wasm, two in-process devices |
| 0.37 s | determinism      | the whole Model, client fields too, ends the same                           | 600 frames, twice                   |
| 0.33 s | pacing.story     | replaying the same seed and Messages gives the same spawns                  | replay, twice                       |
| 0.31 s | boss.story       | the same seed and the same frames play the same boss fight                  | boss fight, twice                   |
| 0.29 s | store            | power-ups seen on two devices at once are all kept                          | SQLite wasm                         |
| 0.27 s | store            | the live game's version 4 save moves from localStorage into SQLite ...      | SQLite wasm                         |

Not slow, and worth keeping in the default run: `tools/balance/model.test.ts` (34 tests, 10 ms), `tools/heavy/decision.test.ts` (74 tests, 10 ms), and `src/perf.scene.test.ts` (the shape and paint budgets, 140 ms).

There are 23 tests named "the same seed ..." or "replays identically" across 13 files. Each one plays its own feature twice and compares. The determinism harness in `tools/determinism/` already does that for a whole run, with a skewed clock and `Math.random`, and names the first field that diverges.

### Configuration today

- `vitest.config.ts`: `environment: 'happy-dom'` for every file, the default `forks` pool, `isolate: true`, one setup file (`src/vitest-setup.ts`, Foldkit's Scene matchers), Foldkit inlined, a 30 s timeout. Vitest 5's file system module cache (`fsModuleCache`) is already on by default.
- `tools/heavy/testRun.ts` runs three vitest processes one after another (the game, then each package) and passes no extra arguments, so `bun run test -- src/kaboomer.story.test.ts` does not narrow the run.
- CI (`.github/workflows/deploy.yml`) runs the same `bun run test`.

### Experiments (same suite, 4 workers, two runs each)

A throwaway config split the suite into a `node` project and a `happy-dom` project for the 26 DOM files, with the pool and isolation varied. All 975 tests passed in every configuration, including both `isolate: false` runs.

| Configuration                                            | Wall, run 1 | Wall, run 2 |
| -------------------------------------------------------- | ----------- | ----------- |
| Today's settings, node and happy-dom split               | 28.7 s      | 27.8 s      |
| Split, `pool: 'forks'`, `isolate: false`                 | 20.2 s      | 18.7 s      |
| Split, `pool: 'threads'`, `isolate: false`               | 19.9 s      | 18.6 s      |
| All happy-dom, `pool: 'threads'`, `isolate: false`       | 21.9 s      | 19.2 s      |
| Split, `isolate: false`, without the 3 long replay files | 9.5 s       | 7.9 s       |
| Split, `isolate: true`, without the 3 long replay files  | 21.1 s      |             |

The three long replay files left out were `pacing.story.test.ts`, `tools/determinism/determinism.test.ts`, and `tools/balance/snapshot.test.ts`, which hold 40 of the 975 tests. What these runs show:

- **Isolation is the biggest single cost.** Turning it off saves 8 to 9 s, as vitest predicted. Threads and forks are within noise of each other, so stay on `forks`, which is safer with WebAssembly and native code.
- **The long pole is the next biggest cost.** With isolation off, `pacing.story.test.ts` is the critical path. Moving the long replays out takes the run from about 19 s to about 8 s.
- **A Node environment helps a little.** It saves about 1 s with isolation off: happy-dom drops from 17% to 9% of tracked time.
- **Neither fix works alone.** Leaving out the long files without turning off isolation still costs 21 s, because import time then dominates.

After that, the slowest files are `horde.story` (4.0 s, of which 3.8 s is three replay tests), `boss.story` (1.8 s), `crawler.story` (1.7 s, of which 1.5 s is one double replay), and `store` (1.4 s, SQLite). The 12 tests still at 300 ms or more take 9.4 of the 19.7 s of test time.

### Duplicated setup

How the 60 test files in `src/` build their Models:

- 51 import `src/testing.ts`.
- They declare 413 top-level helpers of their own between them.
- `fighting` is used 194 times. It is redefined locally in 7 files, with more variants named `fightingModel`, `fightingWith`, `fightingWave`, `fightingInPortrait`, `inWave`, `onPhase`, and `preparing` (the last in 4 files).
- `modifyFields(initialModel | fighting, ...)` is spelled out 75 times, and `asVeteran` is used 73 times.
- Zombie builders: `zombieOf` and `zombieAt` are used 126 times, and files still declare their own copies (`kaboomerAt` in `kaboomer.story.test.ts` restates every field of `zombieOf`).
- Other helpers repeated across files: `withKills` (4 files), `touchDown` (4), `playButton` (4), `spawnAt` (3), `mouseDown` (3), `mainMenu` (3), and `closeDialog` (3).
- The harness in `tools/audit/harness/` has its own 1300 lines of Model building (`roomModel` in `room.ts`, `scenarioModel` in `scenario.ts`), driven by the `HarnessConfig` query string. It is a third fixture vocabulary, alongside `testing.ts` and the per-file helpers, and it lives with the page's own setup, so tests do not import it.

There are 559 `story(` calls and 138 `scene(` calls. Only 23 tests call `update` directly, so nearly every test already follows the Story or Scene style. What is missing is a shared vocabulary for the Given part, and steps sized in game time instead of spread frame arrays.

## 2. Research summary

### Proven and standard

**Vitest performance.**

- The guide lists, in order: profile the duration breakdown, turn off isolation where tests do not leak state (`isolate: false`, or per group through `projects`), choose the pool (`threads` with `isolate: false` is named the fastest; `forks` is the more compatible default), and use the cheapest environment. It gives happy-dom about 90 to 200 ms per import and jsdom 200 to 500 ms, with `node` as the default.
- Environments can be set per file (`// @vitest-environment`) or per project, and one tier can be run with `--project`.
- `--changed` and `vitest related <files>` run only the tests affected by a change, following static imports.
- `--shard` with the blob reporter and `--merge-reports` splits CI runs by file.
- The `fsModuleCache` keeps transformed modules between runs: the guide's example went from 8.75 s to 5.90 s.
- Sources: https://vitest.dev/guide/improving-performance, https://vitest.dev/guide/cli, https://vitest.dev/guide/projects, https://vitest.dev/guide/environment

**Fixtures.**

- An Object Mother is a factory of named, canned examples, such as "a wave 4 fight".
- Its known weakness is that many tests come to depend on its exact data (Fowler). Test Data Builders answer that with defaults plus `with...` overrides, so each test names only what it cares about.
- Meszaros's xUnit Test Patterns names the shapes: Fresh Fixture, Shared Fixture, and Creation Method. An immutable shared fixture is safe to share, which is our case: the Model is immutable.
- Vitest's `test.extend` gives lazy fixtures with scopes (`test`, `file`, `worker`). With isolation off, worker-scoped fixtures are shared across files.
- Sources: https://martinfowler.com/bliki/ObjectMother.html, http://www.natpryce.com/articles/000714.html (Nat Pryce, Test Data Builders; the site refused connections while we checked, so this summary is from the well known article), https://vitest.dev/guide/test-context

**Given-When-Then and tables.**

- Given-When-Then comes from Dan North and Chris Matts's BDD and is the same thing as Arrange-Act-Assert and the four-phase test. Its Then steps should be side-effect-free queries.
- Table-driven tests (the Go convention, `test.each` in vitest) make each case a named row, so a failure names its case.
- Sources: https://martinfowler.com/bliki/GivenWhenThen.html, https://dannorth.net/blog/introducing-bdd/, https://go.dev/wiki/TableDrivenTests

**The Elm architecture.**

- elm-program-test drives a whole program through its update and view with user-level steps ("click button", "expect view has") and says the result is "resilient even to drastic refactorings".
- The Redux docs say to prefer integration-style tests through the real store and reducers over unit tests of each piece, and to avoid mocking selectors.
- Foldkit's `story` and `scene` are the same idea. Story tests that replay Messages through the real `update` are our integration tier, and direct `update` calls should stay rare.
- Sources: https://github.com/avh4/elm-program-test, https://redux.js.org/usage/writing-tests, and `FOLDKIT.md` ("Testing")

**Snapshots and golden masters.**

- Snapshots are assertions. Kent C. Dodds warns that big ones (he cites one of 640 lines) get re-recorded without being read.
- Approval tests and Michael Feathers's characterization tests record what the code does now so a change shows up as a diff.
- A golden file must be small, readable, and reviewed. It must not be re-recorded by reflex.
- Sources: https://kentcdodds.com/blog/effective-snapshot-testing, https://approvaltests.com/, https://michaelfeathers.silvrback.com/characterization-testing

**Pyramid, trophy, and test sizes.**

- The pyramid (Cohn, via Fowler) says push each test as low as it can go.
- The trophy (Dodds) says most confidence per unit of time comes from integration tests.
- _Software Engineering at Google_ sizes tests by resources rather than scope: small is one process with no I/O and no sleep, medium is one machine, large is anything bigger. It asks for hermetic tests, and it shows a suite losing trust as its flaky rate nears 1%.
- For us, small tests are Story and Scene tests in Node. Medium tests are the SQLite and long replay tiers. Large tests are the browser audits.
- Sources: https://martinfowler.com/articles/practical-test-pyramid.html, https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications, https://abseil.io/resources/swe-book/html/ch11.html

**Mutation testing.**

- StrykerJS has a vitest runner. It runs only related tests per mutant, and its incremental mode reuses earlier results: the docs' example reran 234 of 3,965 mutants.
- Google runs mutation testing on diffs at code review and skips "arid" lines. The share of results developers found useful rose from 20% to 80% as they tuned it.
- This is the proven way to measure whether the suite would catch a bug. It automates our "break it once to see it fail" rule.
- Sources: https://stryker-mutator.io/docs/stryker-js/vitest-runner/, https://stryker-mutator.io/docs/stryker-js/incremental/, https://research.google/pubs/state-of-mutation-testing-at-google/

**Property-based testing.**

- fast-check generates inputs and shrinks a failure down to a minimal case, and `@fast-check/vitest` adds `test.prop`.
- Its model-based testing (`fc.commands` with `modelRun`) generates sequences of commands, which for us means sequences of Messages.
- On the Effect side, Effect 4 ships `effect/testing` (`TestClock`, `TestConsole`, `TestSchema`) and an `Arbitrary` module that derives generators from Schemas.
- Sources: https://fast-check.dev/docs/advanced/model-based-testing/, https://github.com/dubzzz/fast-check/tree/main/packages/vitest

### Bleeding edge

**Deterministic simulation testing.**

- FoundationDB built a deterministic simulation of the database before the database itself (Will Wilson, Strange Loop 2014).
- TigerBeetle's VOPR runs the real cluster code under injected faults at about 1000 times speed, around the clock.
- Antithesis sells the same thing as a service: a deterministic clock, deterministic randomness, many seeds, and exact replay of any failure.
- Games have long done the same with lockstep and desync detection. Age of Empires sends only commands over the network. Factorio writes a desync report, and its "heavy mode" saves and reloads every tick and compares the states.
- Our `update` is pure and our random source is seeded, so the game already is a deterministic simulation. What is missing is the seed sweep with invariants, and golden replays.
- Sources: https://thestrangeloop.com/2014/testing-distributed-systems-w-slash-deterministic-simulation.html, https://docs.tigerbeetle.com/concepts/safety/, https://antithesis.com/resources/deterministic_simulation_testing/, https://wiki.factorio.com/Desynchronization, https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond

**Swarm testing.**

- Each random run turns off a random subset of features, because some features hide bugs in others (Groce et al., ISSTA 2012: 42% more distinct crashes in C compilers).
- For us, a seed sweep should also vary which zombie kinds, guns, and traps are present.
- Source: https://www.cefns.nau.edu/~adg326/issta12.pdf

**Test selection.**

- Meta's Predictive Test Selection, learned from historical results, halved testing cost while still catching over 99.9% of faulty changes.
- Google's TAP found that failing tests are usually close to the change in the dependency graph.
- Vitest's `related` and `--changed` are the static, free version of this. Vitest 5 adds `experimental.recordDependencies`, which records the modules each file actually loaded.
- Sources: https://arxiv.org/abs/1810.05286, https://research.google.com/pubs/pub45861.html

**Vitest browser mode.**

- It runs tests in a real browser through Playwright.
- `toMatchScreenshot` compares a locator's screenshot to a reference in `__screenshots__` with pixelmatch. It writes reference, actual, and diff images, and takes mismatch tolerances.
- The docs say rendering depends on the GPU, fonts, OS, and browser version, and recommend creating references in one fixed environment (CI or Docker).
- Sources: https://vitest.dev/guide/browser/, https://vitest.dev/guide/browser/visual-regression-testing

**Other runners.**

- Bun's test runner is fast. Its docs name `--parallel --no-isolate` as the biggest win, the same lever as vitest's `isolate: false`. It is only Jest-compatible: no Foldkit Scene matchers through vitest's `expect`, no Vite `define`, no inlined dependency transforms. The only comparison we found is one blog post (22.5 s on vitest 1.6 against 3.2 s on Bun for 1,487 backend tests), not a controlled benchmark.
- Node's built-in `node:test` is stable but has no comparable ecosystem.
- Sources: https://bun.sh/docs/cli/test, https://nodejs.org/api/test.html

**AI-written tests.**

- Meta's TestGen-LLM kept only generated tests that built, passed reliably, and raised coverage: 75% built, 57% passed reliably, 25% raised coverage. Engineers accepted 73% of what it recommended.
- Meta's ACH writes mutants first and then tests that kill them.
- The documented risk is that LLM tests assert what the code does today rather than what it should do, which locks bugs in.
- For us: agents write most tests, so every new test needs an oracle a human would recognize (a design rule, a number from `GAME_DESIGN.md`, an invariant), plus the "break it once" check. Mutation testing is how we audit that at scale.
- Sources: https://arxiv.org/abs/2402.09171, https://arxiv.org/abs/2501.12862, https://arxiv.org/html/2410.21136v1

## 3. The proposal: one fixture vocabulary and game-time stories

### Principles

1. **One Given vocabulary.** Every test, the harness, and the browser audits build Models from the same named fixtures and builders. No test file declares its own `fighting`.
2. **Steps in game time.** A test says `forMs(340)` or `untilEvent('Exploded')`, not `...ticks(Math.floor(contactMs / FRAME_MS) - 1, FRAME_MS)`.
3. **Named Then checks.** Common assertions get names (`zombiesLeft(0)`, `fired(2)`, `reloading(PISTOL_RELOAD_MS)`). Anything else stays an inline `model(...)` step.
4. **Still Foldkit.** Every helper returns a Foldkit Story or Scene step, so `story`, `scene`, `Command.resolve`, and the typed Messages all keep working. The layer is a vocabulary, not a framework.
5. **Effect idioms.** Builders are plain `(model: Model) => Model` functions composed with `pipe`, built from `modifyFields`, and fixtures are immutable values. No classes, no mutable builders.
6. **Small tests stay small.** Long replays live in their own tier (section 4), where they are named as what they are: simulations.

### Layout

```
src/test/
  fixtures.ts    Room: named starting Models (Object Mother)
  build.ts       with...: Model => Model builders (Test Data Builders)
  actors.ts      zombies, bullets, pickups, guns by kind, with defaults from the tables
  steps.ts       When: tick, forMs, untilEvent, press, holdFire, tap, ...
  checks.ts      Then: zombiesLeft, fired, events, reloading, phaseIs, ...
  gameStory.ts   gameStory / gameScene: test(name, () => story(update, ...)) in one call
  golden.ts      golden replay files: read, compare, update
```

`src/testing.ts` becomes a re-export of `src/test/` while files migrate, then goes away.

### The DSL

```ts
// fixtures.ts: named rooms. Each is a value built once, immutable, safe to share.
export const Room = {
  home: asVeteran(initialModel),
  firstRun: initialModel,
  wave: (wave: number, elapsedMs = 0): Model => ...,         // the wave started, no spawns pending
  waveWithSpawns: (wave: number, spawns: ReadonlyArray<PlannedSpawn>): Model => ...,
  break: (wave: number, remainingMs = 20_000): Model => ...,
  endless: (wave: number): Model => ...,
  boss: (move: BossMove): Model => ...,
  gameOver: (wave: number): Model => ...,
  victory: Model,
} as const

// build.ts: builders, one concern each, composed with pipe.
pipe(
  Room.wave(4),
  withZombies(kaboomer({ id: 1, at: { x: 220, y: 60 }, hp: 3 })),
  withShotInto(1, { damage: 3 }),       // a bullet already inside zombie 1
  withPlayer({ at: Spot.center }),
  withGun(smg({ rounds: 90, loaded: 4 })),
  withPortrait,                         // a touch phone held upright
  withSeed(7),
)

// steps.ts: When. Each returns a Foldkit Story step.
tick()                    // one frame at FRAME_MS
forMs(340)                // whole frames covering 340 ms of game time
untilEvent('Exploded', { withinMs: 1000 })   // fails if it never happens
press('Space'), release('Space'), holdFire, releaseFire, tap(PLAY)

// checks.ts: Then. Each is a Foldkit model() step with a readable failure.
zombiesLeft(1), zombie(1, isFusing), fired(2), events(['Reloaded', 'Fired']),
reloading(PISTOL_RELOAD_MS), phaseIs('Preparation'), money(120)

// gameStory.ts: test + story in one call, update supplied.
gameStory(name, given(fixture), ...steps)
gameStory.each(rows)(name, row => [given(...), ...steps])
```

`forMs` and `untilEvent` are single Story steps: Foldkit allows a step that is a function from simulation to simulation. Each one runs `update` in a loop inside one step, instead of spreading hundreds of `Story.message` steps. That reads better, and it skips building a step array of a few hundred items.

To record what happens over time, a watcher collects frames as a step runs:

```ts
const blasts = watch(GameEvent.isAnyOf(['Exploded']))
gameStory('...', given(...), forMs(800, blasts), then(() => expect(blasts.atMs()).toHaveLength(2)))
```

### Scenarios as data, shared with the harness

The harness's `HarnessConfig` Schema (`?wave=8&start=wave&crowd=30&gun=smg`) already is a fixture language, decoded and validated. The plan:

- **Move the Model building into `src/test/`.** Take `roomModel` and `scenarioModel` out of `tools/audit/harness/room.ts` and `scenario.ts` and into `src/test/scenario.ts` as one pure function, `scenarioModel(config: HarnessConfig): Model`, with no `window`. The harness calls it. Tests call it too: `given(Scenario.of('wave=8&start=wave&crowd=30'))`, or `given(Scenario.make({ wave: 8, start: 'wave', crowd: 30 }))`.
- **One fixture behind the test and the screenshot.** A failing Story or Scene test and a screenshot of the same state then come from the same fixture. An audit scene (`shots34`'s "boss fight") and a Scene test of the boss band start from the same line of data.
- **Name the scenarios.** Shared scenarios go in a table, `src/test/scenarios.ts`, so `ONLY=boss` in an audit and `Scenario.named('boss')` in a test mean the same room.

### Three real tests, rewritten

**1. `kaboomer.story.test.ts`, "a shot Kaboomer pops a fifth of a second later".**

Today (`src/kaboomer.story.test.ts:130`): a local `kaboomerAt` that restates every Zombie field, a local `sceneWith`, and frame arithmetic.

```ts
gameStory(
  'a shot Kaboomer pops a fifth of a second later',
  given(
    pipe(
      Room.wave(4),
      withZombies(kaboomer({ id: 1, at: Spot.rightOfCenter(60), hp: 3 })),
      withShotInto(1, { damage: 3, knockback: 0 }),
    ),
  ),
  tick(),
  zombie(1, isFusing),
  forMs(BOMBER.shotFuseMs - FRAME_MS),
  zombiesLeft(1),
  forMs(2 * FRAME_MS + HIT_STOP_KILL_MAX_MS),
  zombiesLeft(0),
)
```

**2. `kaboomer.story.test.ts`, "chains still ripple, each caught Kaboomer a chain fuse after the last".**

Today (line 162): the test builds 80 pairs of `tick` and `model` steps by hand to push frame indexes into an array.

```ts
gameStory(
  'chains still ripple, each caught Kaboomer a chain fuse after the last, whatever his health',
  given(
    pipe(
      Room.wave(4),
      withZombies(
        kaboomer({ id: 1, at: { x: 220, y: 60 }, hp: 3 }),
        kaboomer({ id: 2, at: { x: 236, y: 60 }, hp: BOMBER.zombieDamage + 4 }),
      ),
      withShotInto(1, { damage: 3, knockback: 0 }),
    ),
  ),
  forMs(800, blasts),
  then(() => {
    const [first, second] = blasts.atMs()
    expect(blasts.atMs()).toHaveLength(2)
    expect(second - first).toBeGreaterThanOrEqual(BOMBER.chainFuseMs - FRAME_MS)
  }),
)
```

**3. `reload.story.test.ts`, "a reload takes the reload time, then the trigger fires again".**

Today (line 117): a local `fighting`, a local `withPistolLoaded`, a local `reloadingMs`, and a local `tagsOf`.

```ts
gameStory(
  'a reload takes the reload time, then the trigger fires again',
  given(pipe(Room.wave(3), withPistol({ loaded: 0 }))),
  holdFire,
  tick(),
  fired(0),
  reloading(PISTOL_RELOAD_MS - FRAME_MS),
  forMs(PISTOL_RELOAD_MS - 2 * FRAME_MS),
  reloading(FRAME_MS),
  tick(),
  events(['Reloaded', 'Fired']),
  model(({ player }) =>
    expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true),
  ),
)
```

**And a Scene test.** `endScreens.scene.test.ts`, "Game Over puts MENU first", with a shared screen fixture and shared locators (`src/test/locators.ts` holds `menuButton`, `campaignButton`, and the rest, which today are redeclared in 3 or 4 files each):

```ts
gameScene(
  'Game Over puts MENU first, then Campaign and Endless',
  given(pipe(Room.gameOver(4), withScreenMs(RESTART_GRACE_MS))),
  measureSurface,
  expectAll(Locate.endButtons).toHaveCount(3),
  expect(first(Locate.endButtons)).toHaveText('MENUBACK HOMEH'),
  expect(Locate.menuButton).toHaveClass('is-primary'),
  expect(Locate.updateNote).toBeAbsent(),
)
```

### Golden replays: our determinism as a test oracle

The determinism harness already plays a scripted veteran (`tools/determinism/script.ts`), hashes the gameplay fields every frame (`hash.ts`), and names the first divergent frame and field (`diff.ts`). Golden replays add one thing: the hashes are stored.

- **The files.** `tools/determinism/goldens/<name>.json` stores the run options (seed, mode, frame pattern, frame count), the hash every 60 frames, and the per-field hashes at the end. Each file stays well under 200 lines, so a diff is readable.
- **The test.** `golden.test.ts` plays each run and compares. On a mismatch it reports the first divergent checkpoint, then replays to that frame and names the field, as `determinism:diff` does today.
- **Updating.** `GOLDEN=update bun run test:full` rewrites the files. Like the balance baseline, a commit that updates a golden must say in its body which gameplay change it means.
- **Which runs.** Three or four campaign and endless runs at a few seeds, plus swarm variants that turn kinds, guns, and traps on and off, so the Ankle Biter, traps, the boss, and the Kaboomer are each covered. The 23 per-feature "replays identically" tests then collapse into the in-engine determinism check plus these goldens. Keep any per-feature test that checks something other than sameness.
- **What it catches.** Any change to gameplay, intended or not. That is the point of a characterization test: a refactor that means to change nothing must not move a golden.
- **What it misses.** Whether the gameplay is right. Story tests and invariants answer that.

Next to the goldens, a seed sweep checks invariants on every frame of many seeded runs, in the deterministic simulation testing style:

- No zombie stands inside a wall.
- Hearts, money, and ammunition never go negative.
- No wave sits empty and unannounced for more than a second (today's 7.8 s test).
- Every planned spawn appears.
- The phase only moves forward.

A failure prints the seed and the frame, and replays exactly. The default tier runs one seed. The sim tier runs a few. Nightly runs many, with swarm variants.

### Keeping "break it once to see it fail"

The rule stays as written in `AGENTS.md`. Two additions:

- **Named checks fail with the expected and actual values in game terms.** For example, "expected 1 zombie left, found 2: [Exploder #1 Fusing 120 ms]". A failure shows why without a debugger.
- **Mutation testing runs the rule mechanically.** Nightly StrykerJS in incremental mode on the gameplay core (`simulation.ts`, `combat.ts`, `waves.ts`, `pacing.ts`, `weapons.ts`, `traps.ts`) reports the mutants no test kills, which are code that no test checks. Start report-only, with no threshold.

## 4. Speed work

### Tiers

| Tier    | Command                                                       | When                                                                   | What                                                                                                                                                      | Target wall            |
| ------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Related | `bun run test -- --changed` or `bun run test:related <files>` | While editing                                                          | Fast-tier tests that import what changed                                                                                                                  | 1 to 3 s               |
| Fast    | `bun run test`                                                | Before every commit (the `AGENTS.md` rule)                             | All Story and Scene tests, model guardrails, perf scene budgets, one short golden, one-seed invariants, the packages                                      | under 8 s, aim for 5 s |
| Full    | `bun run test:full`                                           | CI on every push and pull request; locally when touching gameplay core | Fast, plus the sim tier: seed sweeps, long replays, goldens, the balance smoke pass, the determinism double runs, SQLite store tests                      | about 30 s in CI       |
| Nightly | `bun run test:nightly` (guarded)                              | Nightly, beside `balance:nightly`                                      | Full, plus many-seed sweeps with swarm variants, shuffled file order with isolation on, Stryker incremental, cross-engine determinism, the browser audits | minutes                |

The sim tier is made of files named `*.sim.test.ts`, in their own vitest project, so the split is visible in the file tree. A test moves into the sim tier when it plays more than about one wave of game time or takes more than 300 ms.

### Recommendations, with expected gains

Gains below are measured unless marked as an estimate.

1. **Turn off isolation (`isolate: false`).** Saves 8 to 9 s, from 28 s to 19 s, measured. All 975 tests already pass with it.
   - Guard against tests that depend on each other: the nightly run shuffles file order (`--sequence.shuffle`) with isolation on and with it off, and fails on any difference.
   - Code that mutates global state (`vi.spyOn` on `Date` or `Math.random`, `localStorage`) must restore it in `afterEach`, as `determinism.test.ts` already does.
2. **Move the long replays into the sim tier.** Taking out the 3 long files brings the fast run from about 19 s to about 8 s, measured. Moving the 12 remaining tests of 300 ms or more (9.4 s of test time, mostly "replays identically" and seed sweeps) should take the fast run to about 5 s (estimate). The 7.8 s dead air test keeps one seed per wave in the fast tier as an invariant check, and the five-seed sweep moves to the sim tier.
3. **Use projects: Node by default, happy-dom only where needed.** Saves about 1 s at today's size, measured, and more as Story files grow.
   - `*.scene.test.ts` and the few named Story files that touch the DOM go in the `dom` project. Everything else goes in `node`.
   - Also fold the two packages into the same vitest run as projects, instead of three processes one after another. That saves their startup (an estimated 1 s) and gives one summary.
   - With projects in place, `testRun.ts` passes its arguments through to vitest, so `bun run test -- --project node` and `bun run test -- --changed` work, and a `test:related` script runs `vitest related <files> --run` with the same worker budget.
4. **Golden replays and seed sweeps in place of the 23 per-feature double runs.** These cost about 6 s of test time today. A few goldens of about 0.5 s each in the full tier cover more ground for less (estimate). This also makes "is the game still deterministic" one place to look instead of 13.
5. **Related-test selection for the edit loop.** `vitest related` and `--changed` follow imports. Since nearly every test imports `main.ts`, a change to the gameplay core still selects most files, but a change to a view, a menu, or a tool selects few.
   - With isolation off, one file runs in about 1 s, most of it the 630 ms import.
   - Turn on `experimental.recordDependencies` once it is stable, so selection follows what each file actually loaded.
   - Keep `bun run test` (the full fast tier) as the gate before a commit. `related` is for the edit loop only.

Smaller items:

- **Lazy sprite baking.** `src/sprite.ts` spends 126 ms of its own at import, encoding PNGs and base64 for sprites built at module scope. `src/screens.ts` adds 42 ms.
  - With isolation off, that is paid once per worker, so it barely moves the full run. It is about a quarter of the import in a single-file `related` run, and it also delays game boot.
  - Build sprites on first use from a cache, as `appearance.ts` already does. That fits the `AGENTS.md` rule ("once at module scope or in a cache").
  - This overlaps with the images work in `docs/IMAGES_PLAN.md`, so do it there, once.
- **The `effect` barrel.** Foldkit's Scene matchers import `effect`'s index (90 ms). With isolation off this is paid once per worker. Not worth more work.
- **Stay on Vitest.** Bun's runner would lose the Foldkit matchers, Vite `define`, and dependency inlining, and the measured gains come from the same levers vitest already has (no isolation, Node environment). Vitest 5's `fsModuleCache` is already on.
- **Sharding** (`--shard` with blob reports) is only worth it if the CI full tier passes about a minute. It does not today.

### Expected result

| Step                                   | Fast tier wall (4 workers)           |
| -------------------------------------- | ------------------------------------ |
| Today, `bun run test`                  | 30 s                                 |
| `isolate: false` and projects          | about 19 s (measured 18.6 to 20.2 s) |
| Long replay files into the sim tier    | about 8 s (measured 7.9 to 9.5 s)    |
| Remaining 300 ms or slower tests moved | about 5 s (estimate)                 |
| Packages folded in as projects         | about 5 s, one process (estimate)    |

The full tier stays about where today's suite is, so CI time does not grow. Locally, the gate before a commit drops from 30 s to under 8 s, and agents running tests at once load the laptop for a sixth of the time.

## 5. Browser audits: what can move in-process, and how to tier the rest

The audits in `tools/audit/` drive the harness in headless Chrome. Some of what they check is about real layout and pixels and needs a browser. Some of it is about Messages, labels, and which screen shows what, and a Scene test can check that in milliseconds with no browser.

### Checks that can become Scene or Story tests

| Audit today                             | Check                                                                            | In-process replacement                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taps.ts`                               | Tapping a button sends exactly one Message, never a press on the surface         | A Scene sweep: for each screen fixture, find every `role('button')`, click it, and assert exactly one non-frame Message and none on the game surface. It runs in happy-dom in well under a second for every screen.                                                                                         |
| `shots33.ts`                            | Arrow and Tab order through the home buttons                                     | A Story or Scene table of key presses and the focused button after each, building on `focus.story.test.ts`.                                                                                                                                                                                                 |
| `shots26.ts` (not the e2e part)         | The update chip shows on the home menu only, and the end screens offer only MENU | Already partly in `version.scene.test.ts` and `endScreens.scene.test.ts`. Add one row per screen.                                                                                                                                                                                                           |
| `shots34.ts`, `shots31.ts`              | Which buttons and panels exist on each screen and device                         | Scene tests with `withPortrait` and `withTouch` fixtures assert presence, labels, and `aria-keyshortcuts`.                                                                                                                                                                                                  |
| `shots9.ts`, `shots17.ts`, `shots35.ts` | A rendering change looks the same                                                | A shape-list golden: the canvas view's shapes for a fixture, hashed (or summarised as kind, count, and a few positions) and compared, as `perf.scene.test.ts` already counts shapes. It catches drawing and depth-order changes without pixels. The pixel compare remains the final check for paint itself. |
| `save.ts`                               | The practice gate and mute survive a reload                                      | Mostly covered by `save.story.test.ts` and `store.test.ts`. Keep the browser run for the real storage only.                                                                                                                                                                                                 |

### Checks that stay in a browser

- **Real layout and pixels.** Button size of at least 48 px, overlap and coverage at center and edges (`elementFromPoint`), off-screen controls, pages that scroll, dialogs past the edge, the doorway lintel covering a zombie, the update chip's overlap with panels.
- **Real platform behavior.** OPFS and SQLite (`sqlite.ts`), the new build reload path (`shots26` e2e), splash timing (`splash.ts`), frame time (`perf:check`).

### Tiers for browser audits

| Tier           | What runs                                                                                                                              | When                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Local fast set | The geometry check on one landscape phone and one portrait phone, for the screens touched by the change (`ONLY`, `VIEWPORTS`)          | On a change to CSS, a view, or `screen.ts`, by hand                    |
| CI             | The geometry pass (`shots31`, `shots33`, `shots34`, `taps`) on the default viewports, failing on any problem; no pixel compares        | On a pull request that touches `src/*View.ts`, `*.css`, or `screen.ts` |
| Nightly        | Every audit and every viewport, pixel compares against the last night's set, `perf:check`, `sqlite.ts`, the e2e reload, and the splash | Nightly, through the guard                                             |

Pixel compares belong in one fixed environment, as Vitest's own visual testing guide says. A laptop with other agents running and a CI runner render differently, so references are made and compared nightly on one machine, not on every change.

### Vitest browser mode, and a warm browser

- **Use vitest browser mode for a small visual project.** With the Playwright provider and `toMatchScreenshot`, a visual check is a vitest test that mounts the real `view` from a shared fixture. One launched browser runs the whole project, and in watch mode it stays warm, so a rerun after an edit takes seconds instead of a fresh Chrome per script.
  - It fits the fixtures above: the same `Scenario` that a Scene test uses renders in the browser for its screenshot.
  - Keep it a separate `visual` project, off the fast tier, with references recorded in one fixed environment.
  - Start with the 5 or 6 screens whose geometry broke before (the gun cluster, portrait home, the boss band, the shop).
- **For the existing scripts, keep one browser warm.** A persistent Chrome reused by the audit scripts, with a new context per scene instead of a launch per script, gets most of the same win without a rewrite. That is pipeline work, and it is covered in `docs/IMAGES_PLAN.md`.

## 6. Phased plan

| Phase | Work                                                                                                                                                                                                                                                  | Effort                                 | Expected gain                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Vitest projects (`node` by default, `dom` for Scene files and the named DOM Story files, the packages folded in); `isolate: false`; `testRun.ts` passes its arguments through; a nightly shuffled run to catch order dependence                       | half a day                             | 30 s to about 19 s                                                                                              |
| 1     | Sim tier: `*.sim.test.ts` and a `sim` project; move the 3 long files and the 12 tests of 300 ms or more, keeping a one-seed version of each invariant in the fast tier; `bun run test:full`; CI runs `test:full`                                      | half a day to a day                    | about 19 s to 5 to 8 s for the fast tier; CI unchanged                                                          |
| 2     | Fixture layer `src/test/` (Room, builders, actors, steps, checks, `gameStory`, shared locators); migrate the 10 largest Story files first, and the rest when they are next touched; a lint rule or a review note against new local `fighting` helpers | 2 to 3 days, then as files are touched | Shorter tests (estimate 20 to 30% fewer lines in migrated files) and one place to change when the Model changes |
| 3     | Golden replays and the seed sweep with invariants; collapse the 23 per-feature double runs; move the harness's Model building into `src/test/scenario.ts`                                                                                             | 1 to 2 days                            | About 6 s of test time freed; one determinism oracle; tests and audits share fixtures                           |
| 4     | In-process audit checks (the tap sweep, focus orders, chip presence, shape-list goldens); audit tiers in CI and nightly                                                                                                                               | 2 days                                 | Most audit regressions caught in the fast tier in milliseconds; browser runs narrowed to geometry and pixels    |
| 5     | Bleeding edge: fast-check model-based tests over random Message sequences with the invariants; Stryker incremental nightly on the gameplay core; `recordDependencies` for selection; a vitest browser mode `visual` project                           | ongoing                                | Better checks on the suite itself rather than more speed                                                        |

Phases 0 and 1 are configuration and file moves, with no test logic changed, and give most of the speed. Phase 2 is the readability work the owner asked for, and it can go file by file.

## 7. Risks

- **Order dependence with `isolate: false`.** A test that leaves a mock, a timer, `localStorage`, or a module-level cache behind can break a later file only in some orders.
  - Mitigation: `afterEach` restores in the few files that touch globals, and a nightly run with shuffled order.
  - If needed, `isolate: true` for just the `dom` project. Only some of the Story files touch globals, so this costs little.
- **Bugs that only the sim tier catches.** A change that breaks a seed sweep passes the fast tier and fails in CI.
  - Mitigation: CI runs the full tier and blocks the deploy, as today.
  - `AGENTS.md` should say to run `test:full` when a change touches `simulation.ts`, `waves.ts`, `pacing.ts`, `combat.ts`, or the zombie and boss modules.
- **Goldens that churn.** Every intended gameplay change moves the goldens.
  - Mitigation: keep them few and small, and require the commit body to say why, as with the balance baseline.
  - Never re-record a golden in the same commit as a refactor that claims to change nothing.
- **A DSL that hides the test.** Builders that do too much make tests hard to read (Fowler's Object Mother warning).
  - Mitigation: each builder does one thing, fixtures have plain names, and any unusual setup stays inline in the test with `modifyFields`.
  - The DSL returns plain Foldkit steps, so a test can always drop down to `message` and `model`.
- **Shape-list goldens that only restate the code.** A hash of the shape list catches change, not correctness, like any characterization test.
  - Mitigation: use it for "this refactor changes nothing visible" and keep pixel and geometry checks for "this looks right".
- **AI-written tests with weak oracles.** Agents write most of the tests.
  - Mitigation: Then steps should name a rule from `GAME_DESIGN.md` or a constant, not a value copied from a run.
  - Keep "break it once".
  - Use nightly mutation testing to find code no test checks.
- **Measurement noise.** These numbers come from a shared laptop at load 3 to 10. Recheck the baseline and after Phase 1 on a quieter machine, through the heavy guard.
