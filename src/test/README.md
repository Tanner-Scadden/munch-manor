# `src/test/`

The shared test homes, for tests in every folder and the tools that play the game. A fixture only one folder's tests use sits in that folder's `__tests__/`.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                                           | What it holds                                                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `veteran.ts`, `testing.ts`, `model.fixture.ts` | A returning player's Model for tests and the balance bot; the shared Story steps and builders; the named Models tests start from                                                                                                             |
| `sceneTesting.ts`                              | The shared Scene steps and locators: what a Scene does to the root through its view, its Subscriptions, and its Mounts (`fromSubscription`, `emitPressedKey`, `emitFrame`, the surface's measure and presses), and the elements it looks for |
| `store.fixture.ts`                             | What the store tests start from: a save, a fake localStorage, one device's database, and an in-process server for linking devices                                                                                                            |
| `vitest-setup.ts`, `atlasHtml.setup.ts`        | Every test's setup: stand-in sprites in place of PNGs; the atlas HTML test's own stand-in atlas                                                                                                                                              |
| `testPng.ts`                                   | PNG data URLs read back into pixels for tests                                                                                                                                                                                                |
| `viewReading.ts`                               | Reading what a view draws in tests: a canvas shape tree's Rects (`rectsOf`) and Images (`imagesIn`), a rendered VNode's elements (`nodesOf`)                                                                                                 |
| `arsenals.ts`                                  | The arsenals tests build: the pistol alone or beside another gun, held either way, a change to the carried pistol, and the shotgun                                                                                                           |
| `roomTesting.ts`                               | Test helpers for a co-op room: scripted players, the room stepped tick by tick, clients over a fake network                                                                                                                                  |
| `lensTesting.ts`                               | The lens in tests: a walk straight along the floor through the turn (`walkToward`), the floor a camera shows (`floorSeenOf`), and points to six places (`nearly`)                                                                            |
