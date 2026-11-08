# Precompiled images and faster screenshots: a plan

Status: proposal, not built. Written October 29, 2026, against `main` at `2e2e1f2e`, after the loading work in `b9b74b87` (plain loops in the PNG encoder), `91aae4b8` (the save opens while the game loads), and `503983fe` (load step marks in the splash audit). It builds on that work and does not redo it.

The owner asked two things:

1. "How can we pre-compile images more, and change them based on diffs for what's needed? Would also allow easier local development and maybe speed up other checks?"
2. "Why does getting a screenshot take so long?"

Short answer: every sprite is encoded as an uncompressed PNG data URL in JavaScript, on the main thread, every time any copy of the game's modules runs: each page load, each Vite full reload, each test file, and each screenshot scene. Moving that to one build-time atlas keyed by content removes it everywhere at once and shrinks the images about 70 times. Screenshots are slow mostly for reasons that have nothing to do with images (the guard queue, a fresh browser context and page load per scene, and fixed sleeps), so they get their own fixes in the last section.

## 1. What happens today

`src/art/png.ts` writes PNGs with stored (uncompressed) deflate blocks and returns base64 data URLs. `spriteShapes` and `bakeShapes` in `src/art/sprite.ts` turn pixel maps and fixed rectangle lists into one `Canvas.Image` each, and record every source so the warm-up canvases in `src/app/layers.ts` and the `DecodeSprites` load step in `src/app/boot.ts` can decode them before the splash goes. The patched Foldkit painter keeps one `HTMLImageElement` per distinct `src` for the life of the page (`patches/foldkit@0.169.0-canary.90746b32d2ca.patch`, `requestImage` in `canvas/paint.js`), and `crop` already works: `src/render/occluders.ts` crops the room image.

### Measurements

All numbers are from this laptop (Apple Silicon, 12 cores). The Bun numbers come from a throwaway script that loads `src/app/view.ts`, `src/app/main.ts`, and `src/commands.ts` with a Bun plugin wrapping `pngDataUrl`, `spriteShapes`, and `bakeShapes` with timers, then calls `spriteWarmUpSources(defaultAppearance)` and `roomShapes` for both level states. Load average was 4 to 10 during the runs because other agents were busy, so read the timings as plus or minus 20%.

| What                                                                                | Number                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| PNG encodes while the modules load                                                  | 2,291 calls                                           |
| Distinct images among them                                                          | 1,446 (845 calls, 37%, encode an image already built) |
| Time in `spriteShapes` (2,240 calls) plus `bakeShapes` (49 calls), Bun, no throttle | 107 ms, of which `pngDataUrl` is 56 ms                |
| Of that, the duplicate encodes                                                      | about 20 ms                                           |
| Building and baking both parlour rooms                                              | 23 ms (10 ms of it the encode)                        |
| Data URL text held for the warm-up list (1,442 sources)                             | 1.91 MB                                               |
| All distinct data URLs, rooms included                                              | 2.57 MB (each room 324 KB)                            |
| Data URL text allocated in total, duplicates included                               | 3.98 MB                                               |
| The pixel map strings in `src/` that all this comes from                            | about 12 KB                                           |
| Main JS chunk                                                                       | 583 KB (181 KB gzip)                                  |
| `bun run build`                                                                     | 0.9 s in Vite, 2.9 s wall                             |

Where the encodes come from (by the outermost `src/` frame): `sprite.ts` tables 1,414 calls (686 of them duplicates: mirrored and flash frames that come out identical, wear stages equal to the clean frame), `font.ts` 618 (144 duplicates), `screens.ts` 155, `hintIcons.ts` 41, `appearance.ts` 24, `stall.ts` 11, `powerupView.ts` 12, `room.ts` 5, and a handful from `bossView.ts`, `thumbArea.ts`, `hud.ts`, and `wavePreview.ts`. Everything except the rooms and the chosen look happens at import time.

What the same pixels cost as real image files (encoded with zlib level 9 and the best of the none, sub, and up filters, in Bun):

| Packing                                                                          | Bytes                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1,444 sprites as 1,444 separate deflated PNGs                                    | 208 KB (the per-file header and chunk overhead dominates: the median sprite is 180 pixels) |
| The same 1,444 sprites in one 1024x385 atlas, RGBA                               | 37.8 KB                                                                                    |
| The same atlas as an indexed PNG (only 170 colors are used)                      | 25.6 KB                                                                                    |
| Each room, 326x186, deflated RGBA (more than 256 colors, from the blended light) | 7.1 KB, against 324 KB as a data URL today                                                 |
| Today's data URLs, if shipped as a JS module, brotli 11                          | 49.5 KB                                                                                    |
| Encoding the atlas at build time                                                 | about 80 ms                                                                                |

So the whole sprite set is about 26 KB as one atlas plus 14 KB for the two rooms: smaller than the 1.9 MB of strings the game builds today by a factor of about 50, and only 3 requests.

### In the browser

`tools/audit/splash.ts` (slow 4G, 4x CPU throttle, through the guard) against the production build, and against the same build with `--minify false` so the CPU profile names the functions:

| Moment (slow 4G, 4x CPU)                | First visit         | Repeat visit |
| --------------------------------------- | ------------------- | ------------ |
| `load:modules` (every module has run)   | 3,342 ms            | 1,001 ms     |
| `load:FirstFrame`                       | 4,093 ms            | 1,739 ms     |
| `load:Sprites` (the 1,442 decodes done) | 4,367 ms            | 2,011 ms     |
| load event                              | 4,614 ms            | 2,293 ms     |
| Splash hides                            | 7,118 ms (the save) | 2,404 ms     |
| Longest task before hiding              | 1,152 ms            | 1,180 ms     |

In the unminified build's profile, the module evaluation task spends about 406 ms (4x throttled) inside `spriteShapes`, `bakeShapes`, and `roomShapes`, of which `pngDataUrl` is about 195 ms and base64 about 42 ms, in both visits. That is a third of the longest task. Then `DecodeSprites` waits about 275 ms (from `load:FirstFrame` to `load:Sprites`) for the decodes, and the load event fires only after the warm-up canvases' 1,442 images load. On a repeat visit, where the network is no longer the bottleneck, sprites are about 0.68 s of the 2.4 s to a playable game.

A decode benchmark in the same headless Chrome (median of 3) shows what an atlas does to the second half:

| Decode                                             | 1x CPU | 4x CPU |
| -------------------------------------------------- | ------ | ------ |
| Today's 1,444 data URLs, one `Image.decode()` each | 66 ms  | 276 ms |
| One atlas, RGBA PNG                                | 0.5 ms | 1.4 ms |
| One atlas, indexed PNG                             | 0.3 ms | 0.8 ms |
| One atlas through `createImageBitmap(blob)`        | 0.8 ms | 1.4 ms |
| The room as today's data URL                       | 1.5 ms | 5.4 ms |
| The room as a deflated PNG                         | 0.1 ms | 0.1 ms |

The loading work already landed is in these numbers: `b9b74b87` made the encoder about twice as fast with byte for byte the same output, and still about 1,400 separate images hold the load event. The atlas is the next step it pointed at.

### Tests

`bun run test` ran 65 files in 58 s with 2 workers (the budget allowed 2 at load 9.7). Vitest reported `469 modules were evaluated 21385 times · 37.63s total, 34% of tracked time`. 57 of the 60 test files in `src/` import a module that bakes sprites, and vitest evaluates the modules again for each file. Vitest's import breakdown for `src/render/__tests__/perf.scene.test.ts` (warm transform cache) shows `src/art/sprite.ts` at 113 to 164 ms of self time, `src/screens/game/overlay.ts` at 44 to 69 ms, and `src/art/font.ts` at 12 ms, out of 560 to 820 ms of imports for the file. A copy of the imports with `pngDataUrl` mocked to return a constant took 50 to 90 ms less per file, and the encoder is only half of the sprite cost. Sprite baking is therefore about 170 to 250 ms per test file, or roughly 10 to 14 s of CPU per suite run, about a quarter to a third of all import time. `docs/TESTING_PLAN.md` measured the same thing independently (`src/art/sprite.ts` 126 ms of its own per file, `src/screens/game/overlay.ts` 42 ms) and left the fix to this plan. It also proposes turning vitest's isolation off, which would pay the baking once per worker instead of once per file. The two plans stack: with isolation off, this plan's test gain shrinks to under a second, and its main value moves to page loads, dev reloads, and screenshots.

### Local development

`vite` is ready in about 300 ms. The Foldkit Vite plugin answers every hot update with a full reload (`handleHotUpdate` sends `full-reload` and keeps the Model), so editing one pixel map runs every module again: all 2,291 encodes, then 1,442 image decodes behind the splash, for a one pixel change.

## 2. What the industry does

### Proven and standard

- **Pack sprites into atlases at build time.** Every 2D engine does this. Unity's Sprite Atlas exists because "Unity has to create and send a separate draw call to the GPU for each texture" ([Unity manual](https://docs.unity3d.com/Manual/sprite/atlas/atlas-introduction.html)), and it recommends separate atlases for things that are used at different times. PixiJS loads a sheet's JSON and PNG once and hands out frames as textures ([PixiJS Spritesheet](https://pixijs.download/release/docs/assets.Spritesheet.html)), and its AssetPack tool packs folders into sheets and manifests at build time ([AssetPack](https://pixijs.io/assetpack/)). Phaser reads TexturePacker style JSON hash or array atlases, and its atlas creator offers padding and extrusion against bleeding ([Phaser texture atlas creator](https://editor.phaser.io/tools/texture-atlas-creator)). The win is for many small images drawn together; a single big background gains nothing from an atlas, which matches the rooms here.
- **Import and cache keyed by the source's hash.** Godot keeps imported assets in `.godot/imported/` as `name-<hash>.ctex` with an `.md5` beside it, reimports only when the source's checksum changes, and recommends not committing that folder ([Godot import process](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html)). Turborepo and Nx do the same for whole tasks: a hash of declared inputs keys the cached outputs, which only works when the task is deterministic ([Turborepo caching](https://turborepo.com/docs/core-concepts/caching)). The game's sprite builder is deterministic by construction (its encoder is already byte for byte stable), so it fits.
- **Hashed asset file names and long caching.** Vite emits imported assets with a content hash in the name, inlines small ones as data URLs below `build.assetsInlineLimit` (4 KB by default), and offers `?url`, `?inline`, `?no-inline`, and `?raw` ([Vite static assets](https://vite.dev/guide/assets)). A plugin can emit its own asset with `this.emitFile` and expose data through a virtual module (`resolveId` plus `load`, with the `\0` prefix by convention) ([Vite plugin API](https://vite.dev/guide/api-plugin)). The service worker precache from the offline work (`71809c45`, not yet on `main`) builds its list from the bundle, so an emitted atlas joins it with no extra code, and a hashed name is what cache first wants (the same idea as Workbox's revisioned precache: [workbox-precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)).
- **Optimize the PNGs losslessly.** oxipng is the standard lossless optimizer, multithreaded, with palette and bit depth reduction and an optional Zopfli pass (`-o max -Z`) ([oxipng](https://docs.rs/crate/oxipng/latest), [zopflipng](https://github.com/google/zopfli/blob/master/README.zopflipng)). Indexed (palette) PNG is the classic win for pixel art with few colors; for this atlas it is 32% smaller than RGBA. Lossless WebP is about 26% smaller than PNG on typical images ([Google WebP](https://developers.google.com/speed/webp)), but for tiny palette art an indexed PNG often wins, and every browser that runs the game decodes both. At 26 KB total the format choice is worth a few KB at most.
- **Decode before first use.** `HTMLImageElement.decode()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)) is what `DecodeSprites` already uses. With one atlas it waits on one decode instead of 1,442.

### Bleeding edge, or worth knowing

- **Vite 8 is Rolldown.** The repo is on Vite 8.3.5, which bundles with Rolldown only and kept the plugin API ([Vite 8 announcement](https://vite.dev/blog/announcing-vite8)). Rolldown hook filters (`filter: { id: /.../ }`) skip the Rust to JS call for modules a plugin does not care about ([Rolldown hook filters](https://rolldown.rs/apis/plugin-api/hook-filters)). The Environment API, including running modules in a module runner from a plugin ([Vite environment runtimes](https://vite.dev/guide/api-environment-runtimes)), works but is not yet stable, so the plan does not depend on it.
- **Bun macros** (`import { x } from './x.ts' with { type: 'macro' }`) run a function at bundle time and inline its result ([Bun macros](https://bun.com/docs/bundler/macros)). They only run in Bun's own bundler, and the game is bundled by Vite and tested by vitest, so a macro would never run on either path. [unplugin-macros](https://github.com/unplugin/unplugin-macros) brings the same syntax to Vite, but a macro must return a value that can be inlined into JS, and an atlas belongs in a file, not in the bundle. Not recommended.
- **Off the main thread decoding.** `createImageBitmap(blob)` in a worker, `ImageDecoder` from WebCodecs, and `OffscreenCanvas` can decode or draw away from the main thread ([MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap), [ImageDecoder](https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)), but browsers disagree on which path really avoids blocking ([Web Performance Calendar 2025](https://calendar.perfplanet.com/2025/non-blocking-image-canvas/)). With one 26 KB atlas there is little left to move, and Foldkit's cache holds `HTMLImageElement`s, so this would need a patch change for a gain of a few milliseconds. Not worth it.
- **GPU texture compression** (KTX2 with Basis Universal) ships textures the GPU can sample without a full decode. It is block based and lossy: ETC1S "causes obvious block compression artifacts" and UASTC is the quality mode ([Khronos KTX artist guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md)). Hard edged pixel art is the worst case, Canvas 2D cannot use it at all (only WebGL and WebGPU can), and the transcoder is a wasm module bigger than every sprite combined. Wrong fit.
- **Build-time WebAssembly encoders** (the jSquash and Squoosh codecs, oxipng compiled to wasm) let a Vite plugin optimize PNGs with no native binary on CI. Nice for a later optimization pass; zlib from `node:zlib` already gets the atlas to 26 KB.
- **Incremental builds keyed on diffs.** At the scale here (1,446 sprites, 80 ms to encode the whole atlas) per sprite incremental encoding costs more in bookkeeping than it saves. The diff that matters is "did the set of sprite keys change?": if not, reuse the cached atlas byte for byte. That is the Godot and Turborepo idea applied at the level where it pays.
- **Dev server lazy generation.** Serving a generated asset from `configureServer` middleware and rebuilding it in the background on change is a standard Vite plugin pattern; combined with a runtime fallback it means dev never waits on the atlas.

## 3. The proposal

### Shape

Pixel maps stay as TypeScript data and stay the source of truth. Nothing about how art is written changes.

1. **A content key for every sprite.** `spriteShapes(pixels, palette, anchor)` computes a key from its inputs: a small FNV-1a hash over the width, the height, the rows, and the palette colors the rows use. Hashing about 12 KB of strings costs well under a millisecond in total. `bakeShapes` takes an optional name (`room:Parlour:Kitchen`, `stall:awning`) and a thunk, so a named bake can skip building its thousands of `Rect` shapes when the atlas has it; an unnamed bake hashes its runs.
2. **A manifest lookup.** A generated manifest maps keys to `{ x, y, width, height }` in an atlas. On a hit, `spriteShapes` returns `Canvas.Image({ src: atlasUrl, crop, x, y, width, height, rendering: 'Pixelated' })`. No runs, no fills, no encoding. This uses the patch's existing `ImageCrop`, the same path `src/render/occluders.ts` already uses, so Foldkit needs nothing new.
3. **A fallback that is today's code.** On a miss the sprite is encoded at runtime exactly as now, and recorded. In development that is what makes the atlas optional; in production a scene test makes a miss at load a failure (below).
4. **One identical image is built once.** A `Map` from key to shapes in `sprite.ts` removes the 845 duplicate encodes even on the fallback path. This is a one day change worth doing first on its own.
5. **A generator, `tools/sprites/build.ts`.** It loads the game's modules in Bun with recording on (the throwaway measurement script already does this with no DOM), then reaches the sprites that are built lazily: the default look's frames, `roomShapes` for every level state in `LEVEL_SPECS`, fire frames, every hint icon. Modules that build sprites lazily export a small `precompile()` list for it. It packs the images with a shelf or MaxRects packer and a 1 pixel transparent gutter, sorted by key so the output is deterministic, and writes:
   - `sprites-<hash>.png`: the boot atlas, indexed when it has 256 colors or fewer (it has 170), else RGBA, about 26 KB.
   - `room-<level>-<exits>-<hash>.png`: one file per room state, about 7 KB each. The rooms stay separate files because they are big, appear one at a time, and are already cropped by the occluders.
   - `sprites.json`: the manifest.
6. **A Vite plugin, `munch-manor:sprites`.**
   - `build`: runs the generator in `buildStart`, emits the PNGs with `this.emitFile` (hashed names, picked up by the service worker's precache list), and serves the manifest and the URLs through `virtual:sprite-atlas`.
   - `serve`: runs the generator once at startup in the background and serves the files from middleware. Until it finishes, or after an edit, misses fall back to runtime encoding, so an edit to one pixel map costs one sprite's encode on the reload, not 2,291. A watcher reruns the generator, debounced, so the next reload hits the atlas again.
   - Cache: `node_modules/.cache/munch-sprites/`, keyed by the sorted list of sprite keys plus the generator's version. If the keys did not change, the old PNGs are reused byte for byte, and CI can keep the folder with `actions/cache` (optional: a cold run is about a second).
7. **Generated, not committed.** Several agents work in parallel worktrees, and a committed binary atlas would conflict whenever two of them touch any art. Godot gives the same advice for its import cache. The generator is fast and deterministic, so building it is cheaper than merging it.
8. **Tests get handles, not images.** Under vitest, `spriteShapes` returns the same `Canvas.Image` with `src: 'sprite:<key>'` and keeps the pixel map in a registry, without encoding. `src/test/testPng.ts` grows a `spritePixels(shape)` that renders from the registry (it is used by three test files today: `sprite.scene.test.ts`, `character.story.test.ts`, `exits.story.test.ts`). Shape counts and paint operation counts in `src/render/__tests__/perf.scene.test.ts` do not change: one `drawImage` per sprite either way.
9. **The load step shrinks to one decode.** `DecodeSprites` decodes the boot atlas and the current room. The warm-up canvases in `src/app/layers.ts` draw two images instead of 1,442 in chunks of 64, and `recordedSpriteSources` only matters for fallback sprites.

### Atlas or separate files

An atlas, plus a separate file per room.

- One request and one decode instead of 1,446, and 26 KB instead of 208 KB, because the per file PNG overhead is bigger than the median sprite.
- One entry in Foldkit's page-wide image cache instead of 1,446 `HTMLImageElement`s, each with its own decoded bitmap.
- Drawing a cropped region of one image costs the same as drawing a whole small image in Canvas 2D, and on a GPU-backed canvas it avoids switching textures between sprites, the reason Unity and PixiJS batch by atlas.
- Crisp scaling holds. `rendering: 'Pixelated'` turns smoothing off per draw, crops are whole pixels, and each sprite sits in a 1 pixel frame of its own edge pixels, so a scaled or rotated draw (the boss's tells, shed armor) never samples a neighbor and draws the same pixels as the sprite's own image would.
- 1024 pixels wide stays far under every phone's texture limit.

### Sprites that change with the player

The character's look has 2 bodies, 4 hair styles, 5 hair colors, 6 skin tones, and 6 shirts: 1,440 looks of about 24 images each. Precomputing all of them (about 35,000 images) is out. Swapping palettes on the GPU or through a canvas at runtime is more code than the problem deserves. The plan: the default look goes in the atlas, and any other look is encoded at runtime on demand, as today, through the existing 16 look cache in `src/art/appearance.ts`. That is about 24 small encodes, a few milliseconds, when the saved look loads or the picker shows a look, never the 2,291 at boot. A later option is to put the saved look's frames in a small IndexedDB or OPFS cache keyed by the look, if it ever shows in a profile.

The HTML icons (`src/art/icons.ts` and `src/art/shopArt.ts` build SVG data URLs for CSS) are a few dozen small strings and cost little; they can join the generator later as SVG or PNG files for consistency, but they are not on the critical path.

### Rules that change

- "Draw fixed art as sprite images" stays, and gets easier: build sprites at module scope as now, and the generator finds them. A new rule: a sprite built lazily belongs in its module's `precompile()` list.
- A new test, `src/sprites.scene.test.ts`, boots the game as the production build would and fails if any sprite reached at load is missing from the manifest, so a forgotten `precompile()` is caught before it ships a runtime encode.
- `bun run perf:check` should see no change in frame time (the same number of `drawImage` calls). The splash audit gets a budget: no `pngDataUrl` calls before `load:Sprites` in a production build.

### Effect on size and loading

- JS: about the same. The pixel maps stay (they are the keys) and the encoder stays for the fallback; the generated manifest adds about 30 KB raw and maybe 8 KB gzip. A later step could strip pixel maps that are only ever looked up, with a Rolldown transform, but 12 KB is not worth the complexity now.
- New files: one 26 KB atlas and 7 KB per room state, all hashed and cached forever, all in the offline precache.
- Memory: about 4 MB of data URL strings and 1,446 image elements go away.

## 4. Expected gains

| Where                                                        | Today                                                                     | After                                                               | How sure                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| Main thread at load, Bun desktop                             | 107 ms of sprite building                                                 | under 5 ms (key hashing and lookups)                                | Measured, then estimated for the lookup |
| Main thread at load, Chrome with 4x CPU throttle             | about 406 ms of sprite building in the longest task                       | under 20 ms                                                         | Measured in the CPU profile             |
| The `Sprites` load step, 4x CPU                              | about 275 ms waiting on 1,442 decodes                                     | about 2 ms for the atlas and the room                               | Measured                                |
| Repeat visit to a playable game, slow 4G, 4x CPU             | 2.4 s                                                                     | about 1.7 s                                                         | Estimate from the two rows above        |
| Bytes of image data built and held                           | 2.57 MB of data URLs (3.98 MB allocated)                                  | about 40 KB of PNG, fetched and cached                              | Measured                                |
| Test suite CPU                                               | 10 to 14 s of sprite baking per run                                       | close to 0                                                          | Measured per file, multiplied           |
| Test suite wall time, isolation on (today)                   | 58 s with 2 workers on a loaded machine                                   | about 5 to 7 s less with 2 workers, 2 to 3 s less with 4            | Estimate                                |
| Test suite wall time, isolation off (`docs/TESTING_PLAN.md`) | the baking runs once per worker                                           | under 1 s less                                                      | Estimate                                |
| Editing a pixel map in `bun dev`                             | 2,291 encodes and 1,442 decodes on the full reload                        | 1 encode on the reload, then the atlas catches up in the background | Design                                  |
| Each screenshot scene's boot                                 | about 100 ms of building and 66 ms of decoding at 1x CPU, again per scene | one decode                                                          | Measured, see section 6                 |

## 5. Phases

| Phase | What                                                                                                                                                                                     | Effort      | Gain                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| 0     | Build each distinct sprite once: a key to shapes map in `sprite.ts`.                                                                                                                     | half a day  | 37% of encodes gone, about 20 ms desktop, more on phones |
| 1     | Content keys, the manifest lookup with the runtime fallback, and test handles. The fallback means this ships with no atlas yet.                                                          | 1 to 2 days | Test suite 10 to 14 s of CPU                             |
| 2     | The generator and the Vite plugin for build: atlas, rooms, manifest, cache, the service worker list, the missing sprite test. `DecodeSprites` and the warm-up drop to one or two images. | 2 to 3 days | Load: all encoding and 1,441 decodes gone                |
| 3     | The dev server side: middleware, background regeneration, misses logged once.                                                                                                            | 1 day       | Edits to art reload fast                                 |
| 4     | Optional: oxipng or a wasm optimizer in the generator, the HTML icons as files, the saved look cached on device.                                                                         | 1 day each  | A few KB, small                                          |

Each phase stands alone and passes `typecheck`, `lint`, `test`, and `build`. Phases 0 and 1 change no pixels; check every phase with `shots9.ts` and `shots17.ts` with `COMPARE` (zero pixels may differ), since the art must come out byte for byte the same.

## 6. Why a screenshot takes so long

### Where the time goes

Measured on October 29, 2026, through the guard (`bun run heavy -- ...`), against the harness dev server and against the same harness built with `vite build` and served statically. One scene's steps were timed with a throwaway Playwright script that does what `shots34.ts` does for one unit (390x844 at 3x, touch, `nodev`).

**The queue comes first.** In this session a `shots34.ts` run waited about 22 minutes in the guard before it started, a one-off timing script about 24 minutes, and a `splash.ts` run gave up after the guard's 30 minute limit. The cause was the same each time: a nightly balance batch (`--update-baseline`) held the lock, a Timing job (`splash.ts`) was waiting for it, and the guard's fairness rule makes every later arrival wait behind a waiting Timing job, including Shared jobs that fit the load budget and could have run beside the balance batch. Once started, the same jobs took 11 to 76 seconds.

**One full `shots34.ts` run** (95 scenes: 19 scenes on 5 phones, 3 at once) took 76 s once running: 2.4 s per scene per browser context, or 0.8 s of wall time per screenshot.

**One scene**, step by step:

| Step                                                | Dev server harness                                                                                                      | Built harness                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Launch Chrome (once per script)                     | 180 to 280 ms                                                                                                           | 180 to 280 ms                                                                           |
| New browser context and page                        | 95 to 135 ms                                                                                                            | 90 to 135 ms                                                                            |
| `page.goto` to the load event                       | 420 to 515 ms (250 requests, about 22 MB of unbundled modules per page, since every context starts with an empty cache) | about 500 ms (6 requests, 431 KB, one 280 ms evaluation task that includes the sprites) |
| From the load event to the canvas plus two frames   | 340 to 380 ms                                                                                                           | about 60 ms                                                                             |
| `wait(1200)` after the load in `shots34.ts`         | 1,200 ms                                                                                                                | 1,200 ms                                                                                |
| `wait(500)` after a click, for the six panel scenes | 500 ms                                                                                                                  | 500 ms                                                                                  |
| `settleAnimations`                                  | 0 ms in a wave, 230 ms on the shop, 1,315 ms on the home menu                                                           | the same                                                                                |
| The page's checks (`page.evaluate`)                 | tens of ms                                                                                                              | tens of ms                                                                              |
| `page.screenshot`                                   | 52 to 82 ms                                                                                                             | 53 to 81 ms                                                                             |
| Close the context                                   | 5 to 8 ms                                                                                                               | 5 to 7 ms                                                                               |

So a typical scene is about 2.4 s: half of it the fixed sleep, a third loading and booting a fresh page (of which about 100 ms of sprite building and 66 ms of decoding at 1x CPU, and more when the machine is loaded), the rest settling animations. The screenshot itself is 3% of it. Across the run, the fixed 1,200 ms sleep alone is 114 s of the 228 s of scene time, about 38 s of the 76 s of wall time. The dev server adds about 300 ms per scene over a built harness, and transfers 22 MB per page.

### Fixes, in order of payoff

1. **Let Shared jobs backfill the queue.** A Shared job that fits the load budget should start when the job ahead of it is a Timing job that cannot start yet anyway (the lock is held by a CPU job it must not share with). This is backfill scheduling as batch schedulers do it ([Slurm's backfill scheduler](https://slurm.schedmd.com/sched_config.html)): a later small job runs in a gap as long as it does not delay the first job's start. Here a Shared job may delay a Timing job by at most its own length, so cap it: backfill only when the Shared job's expected length (from its last runs) is shorter than the CPU job's expected remaining time, or simply let a Timing job that has waited more than N minutes stop further backfill. Gain: the 20 to 30 minute waits seen here go to zero whenever a long balance batch is running. Change: `tools/heavy/decision.ts`, with its tests.
2. **Wait for a signal, not a timer.** The harness already has `freeze=N` and sets `window.__isFrozen` (`shots17.ts` waits on it). Add a `window.__isReady` that the harness sets after the first frame painted with every image it drew loaded (the patched Foldkit already calls back when an image finishes loading), and have every shots script wait for it instead of `wait(1200)` and `wait(500)`. For CSS animations, take the screenshot with Playwright's `animations: 'disabled'`, which fast-forwards finite animations to their end ([Playwright `page.screenshot`](https://playwright.dev/docs/api/class-page#page-screenshot)), and keep `settleAnimations` only where a check measures a box mid animation. Gain: about 1.2 to 2.5 s per scene, about 40 to 50 s of a 76 s `shots34.ts` run.
3. **A built harness, cached by content.** Build the harness once (`vite build tools/audit/harness`, about 1 s) into a folder named by a hash of `src/`, `tools/audit/harness/`, and the lockfile, and serve it statically, as `perf:check` already does on 4179. Every script reuses it until the hash changes. Gain: about 300 ms per scene and 22 MB less traffic per page; no dev server to start or keep alive per agent; and the built harness is what the precompiled atlas from this plan lands in.
4. **One page per viewport, scenes switched in place.** The harness builds its Model from the query (`HarnessConfig`). Add `window.__loadScene(query)`, which decodes the query, builds the Model, and dispatches one harness-only Message that replaces it, and reset the bits of the DOM a new page would reset (focus, open dialogs, scroll). Scripts then open one page per viewport (or per worker) and call it per scene. Gain: the context, `goto`, and boot (about 0.6 to 0.9 s) per scene. Risk: state leaking between scenes, so keep a fresh page per viewport and compare a sample of scenes against fresh loads in CI. This builds on the testing plan's proposal to move the harness's Model building into `src/test/scenario.ts`.
5. **A warm screenshot server.** A small long-lived process (`tools/audit/shotd.ts`) that holds Chrome, the built harness, and a page per viewport, and answers "shoot this query on this viewport" over a local socket. Agents call it through the guard as a Shared job, so it still respects the budget. Gain for the common agent case of one to five shots: no Chrome launch, no build, no page load, about 0.2 to 0.3 s per shot. `docs/TESTING_PLAN.md` points here for "keep one browser warm"; vitest browser mode with `toMatchScreenshot` is the other way to get a warm browser for visual tests ([Vitest browser mode](https://vitest.dev/guide/browser/)).
6. **Precompiled sprites** (sections 3 to 5). Every page load in every scene stops building about 1,446 images and decoding 1,442 of them: about 170 ms per scene at 1x, much more when the laptop is loaded, and the first frame no longer waits on image loads.
7. **A render path with no browser, for canvas-only checks.** Foldkit shapes are data: `sceneShapes(model)` in `src/app/layers.ts` returns the whole canvas scene. A small rasterizer in TypeScript for the shapes the game uses most (whole pixel `Rect`, `Image` with `crop`, `Group` with a translate) can paint a scene into an RGBA buffer and write it with `src/art/png.ts` in Bun, in tens of milliseconds, from a Story test or a script. `Text`, `Path`, and `Circle` need either more rasterizer or a Canvas 2D implementation such as [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) (Skia). This cannot check HTML, CSS, or layout, so the button and panel checks keep the browser, but depth order, sprites, and the HUD on the canvas could be checked this way. It overlaps the testing plan's shape-list goldens; do those first.

### Targets

| Case                                             | Today, once running                                       | Target                                                            |
| ------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Waiting in the guard behind a long balance batch | up to 30 min, then gives up                               | under 1 min when the Shared job fits the budget                   |
| One screenshot of one scene from a cold command  | about 3 s (launch, page, sleep, settle) plus a dev server | under 2 s with fixes 2 and 3; under 0.5 s through the warm server |
| A full `shots34.ts` run (95 shots)               | 76 s                                                      | under 30 s with fixes 2 and 3; about 15 s with fix 4 too          |

Fixes 1 to 3 are each about a day, need no game changes, and get most of the way. Fix 4 needs a harness Message and care with leftover state. Fix 5 is a day once 3 and 4 exist. Fix 7 is the long term direction for canvas-only checks.

## 7. Risks

- **A sprite missing from the atlas** ships a runtime encode, not a broken picture, thanks to the fallback. The missing sprite test turns it into a failure in CI.
- **Hash collisions** between two different sprites would draw the wrong art. 64 bits of FNV-1a over 1,446 keys makes that vanishingly unlikely, and the generator can check for it while it packs (it holds the pixels).
- **Generator drift from the runtime.** The generator imports the same modules the game runs, so the art cannot fork. The one risk is a sprite built from state the generator never reaches, which is the `precompile()` list's job and the missing sprite test's.
- **Bleeding at atlas edges** on scaled or rotated draws: a 1 pixel frame of each sprite's own edge pixels (a transparent gutter dropped the edge pixels of rotated sprites), checked with the `lineup=boss` and `lineup=armor` harness scenes, which scale and rotate.
- **Foldkit upgrades.** The plan uses only `Canvas.Image` with `crop`, which is in the upstream pull request the patch ports, so it survives dropping the patch.
- **The offline precache** must list the atlas files. Its build check already fails if the list drifts from the files written.
