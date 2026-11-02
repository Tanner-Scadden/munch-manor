# The Foldkit patch

The game runs Foldkit's Block preview, `foldkit@0.169.0-canary.90746b32d2ca`, and draws every fixed sprite with `Canvas.Image`, which neither that canary nor any release ships. It is ported from the upstream pull request [foldkit/foldkit#1846](https://github.com/foldkit/foldkit/pull/1846) (commit `a9009a20`) as a Bun patch: `foldkit@0.169.0-canary.90746b32d2ca.patch` in this directory, listed under `patchedDependencies` in `package.json` and `bun.lock`. `bun install`, including `bun install --frozen-lockfile` in CI, applies it to `node_modules/foldkit`.

It adds:

- the `Image` shape (with `ImageCrop` and `ImageRendering`) to the Shape union and its declarations,
- the painter's `drawImage` path with a per-shape `imageSmoothingEnabled`,
- the page-wide image cache keyed by `src`,
- and the repaint of each canvas's latest scene when an image it drew finishes loading.

It also gives `Canvas.view` an optional `key`, the snabbdom key of its `<canvas>`, which upstream does not have. A canvas a lazy view hands back from its cache must be keyed among its siblings, or snabbdom can pair it by position, rebuild it into a new element, and leave the old one in the page (`src/cachedNodes.scene.test.ts` checks every cached VNode has a key). Dropping the patch needs that kept some other way, such as a keyed wrapper element.

On top of the port, the painter draws a pixelated image on whole canvas pixels: it rounds the image's edges on the canvas unless the transform rotates or skews. At a half pixel position, nearest neighbour sampling meets ties that a cropped atlas region and a whole image break differently, which showed as sprites shifted by a pixel. Dropping the patch for an upstream release loses this unless upstream does the same.

It also makes `modifyFields` (and `makeModifyFieldsFor`) in `struct/index.js` fast. Foldkit aliases Effect's `Struct.evolve`, which walks every key of the struct through `Reflect.ownKeys` and `propertyIsEnumerable`; on the game's large Model that was about half of a busy frame's `update`. The patch copies the struct with a spread, which keeps the same own enumerable keys in the same order, and then runs only the given transforms, on keys the struct has, as `evolve` does. The types are untouched. It is not upstream yet, so dropping the patch brings the slow path back.

Two more speedups for what the view builds every frame, neither upstream yet and neither changing an API (`src/foldkitPatch.test.ts` checks both):

- **Shapes skip `schema.make`.** A `taggedStruct` constructor (every Canvas shape and Message variant) already copies required keys of plain types without validating them. The patch in `schema/index.js` copies optional keys of plain types too, such as a `Rect`'s `fill`, and leaves out a key the input leaves out, as `make` does. A key with a constructor default still goes through `make`, and so does `undefined` for an exact optional key. Building `Rect`s through `make` was about 27 ms of a 2 s worst-case profile at 4x CPU throttle.
- **Inline styles are checked once.** `assertStyleIsRepresentable` in `domReflection.js` remembers each name and value that passed (up to 4,096, then it starts over) and each declaration name, and still checks every style for two spellings of one declaration. It was about 20 ms of the same profile.

The third cost of that profile, `brandViewResult` around every function return, is not in the patch: `tools/vite/viewIdentity.ts` wraps the Foldkit Vite plugin so it brands only modules that can make a vnode. The preview's `@foldkit/ui` ships already branded (its `dist` wraps each return in `__foldkitBrandViewResult`), which `bun run perf:check` shows costs nothing measurable, since only the menus' dialogs and tabs come from it.

It also makes the runtime draw a frame tick in the same animation frame, in `runtime/renderer.js` and `runtime/messageQueue.js`. Without it the game drew only every other display frame, with two ticks in each drawn one (motion in 33 ms steps), in single player and in co-op. Neither part is upstream yet; `bun run perf:check` reports both as drawn fps and the share of ticked frames drawn, and fails at 1x when that share drops under 0.9.

- **A render a frame late.** A frame Subscription (the game's `animationFrames` and `roomFrameTimes` in `src/subscriptions.ts`, and Foldkit's own `Dom.animationFrameTicks` alike) offers its Message from a `requestAnimationFrame` callback, and the Message is processed in the microtasks right after it. Its update dirties the Model, and `scheduleRenderFrame` then calls `requestAnimationFrame(renderFramePlain)`. A callback requested while the frame's callbacks run belongs to the next frame, so the render ran a frame late, merged with the next tick, and the frame after had no render at all. Measured in the harness at 1x: 180 frames with a tick, 90 with a render, every render two ticks. The patch arms the next frame's render ahead: after a frame renders, it requests the next frame's callback from a task after this frame (a `MessageChannel` message), which puts it after every callback requested inside this frame, the frame ticks' included. In the next frame the tick runs first, its Message dirties the Model, and the armed callback draws it in that frame. An armed callback that finds nothing dirty does nothing and stops arming, so an idle page costs one empty callback. `scheduleRenderFrame` requests no frame of its own while one is armed.
- **A deferred drain that held the render.** Once drains in one task run past `DRAIN_BUDGET_MS` (5 ms), the queue defers the rest to a `MessageChannel` task, and `renderFramePlain` skips any frame where a drain is deferred (so it does not paint stale controlled inputs) and tries again a frame later. Under CPU load a co-op frame (the room tick plus its snapshot and sound Messages) crosses the budget, so about one ticked frame in four went undrawn at 6x. The deferral waits for the browser to get control back, and a running animation frame means it has, so the patch adds `drainDeferredNow` to the queue and the render frame calls it first: the deferred Messages run before the patch, and a drain that runs over the budget again still defers.

What upstream Foldkit should change, to report: (1) a render scheduled from inside an animation frame (by a Message from a `requestAnimationFrame` Subscription) should draw in that frame, not the next. Arming the next frame's callback ahead, as here, is one way; another is a runtime-owned frame clock that delivers `Dom.animationFrameTicks` and then renders in the same callback. Any app using `Dom.animationFrameTicks` draws at half the display rate today. (2) `renderFramePlain` should run a drain deferred for the budget before it renders, instead of postponing the frame, since the frame is the yield the deferral waits for.

Upstream keeps the cache in `canvas/imageCache.ts`. The patch puts it in `canvas/paint.js`, because Bun failed to apply a patch that adds a file.

A change to the patch rebuilds the site on deploy, since `patches/` is one of the inputs Alchemy watches (see `infra/README.md`).

## Changing it

Run `bun patch foldkit`, edit the files under `node_modules/foldkit/dist/`, then `bun patch --commit node_modules/foldkit`. Delete the `.bun-tag-*` hunk Bun writes at the top of the patch, and check that no hunk creates a new file.

Bun 1.3 names its cached copy of the patched package by a hash that does not follow the patch's content, so after a change `bun install` can keep linking the old patched copy from `~/.bun/install/cache` (CI starts with no cache, so it is not fooled). Check `node_modules/foldkit/dist` for the change. The folder's hash did not change with the render cadence change below (it stayed `_patch_hash=66044df4402ed56d`), and one folder serves every worktree, so rather than move it out from under the others, delete `node_modules/foldkit` and install with a cache of your own, `BUN_INSTALL_CACHE_DIR=/tmp/<some folder> bun install`, which applies the patch afresh and leaves the shared cache alone. A canary's folder is named by a hash of its prerelease tag, not the tag itself: `foldkit@0.169.0-<hash>@@@1_patch_hash=*`.

`bun run determinism:diff` shows whether a patch change changes gameplay: the base installs the old patch on its own, and the tool stops if the working tree's `node_modules` does not match the new one.

## Dropping it

Once a Foldkit release ships `Canvas.Image`, upgrade `foldkit`, delete `patches/`, remove `patchedDependencies` from `package.json`, and run `bun install`. The game uses only the upstream API, so no game code changes.

## Upgrading Foldkit before then

The patch is pinned to `foldkit@0.169.0-canary.90746b32d2ca`. A new version needs the patch redone against its `dist`.

First diff the new `dist` against the old one (`npm pack foldkit@<old>` and `foldkit@<new>`, then `diff -r`), then apply the old patch to a copy of the new `dist` with `patch -p1` and redo the hunks it rejects. Moving from 0.170.0 to the preview canary, every hunk applied but two: the `Shape` union in `canvas/shape.d.ts` (the canary names each shape's type, so the union reads `Rect | Circle | Path | Text | Image | Group`), and the `schema/index.js` fast path, which only moved because the canary added `callableTaggedStructs` between `getDirectPropertyNames` and `makeCallable`. The canary has none of the five parts, so the patch still carries all of them; #1846 is still open. Generate the patch with `git diff --no-index` between the pristine and the patched copy, each in a folder named `a` and `b`, so its paths read `a/dist/...` and `b/dist/...`.
