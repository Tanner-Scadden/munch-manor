# Docs

What each doc is for. The code's own map is each layer's `README.md` under `src/`, and the rules the code follows are in [`AGENTS.md`](../AGENTS.md).

## The game

| Doc                                  | What it holds                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`GAME_DESIGN.md`](./GAME_DESIGN.md) | The vision, every decision ("Decided" is settled), how the game is built and tuned, and the open questions |
| [`LORE.md`](./LORE.md)               | The story: what the game says, what it hints at, and where it could go                                     |
| [`FLOW.md`](./FLOW.md)               | The game's flow as charts, for planning with collaborators                                                 |

## Platform and co-op

| Doc                                  | What it holds                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| [`PLATFORM.md`](./PLATFORM.md)       | Cloudflare: hosting, the two origins, analytics, the on-device save, sync, and updates |
| [`MULTIPLAYER.md`](./MULTIPLAYER.md) | Co-op: the netcode model, the rules, and what each phase built                         |
| [`MOBILE.md`](./MOBILE.md)           | The plan for the App Store and Google Play                                             |

## How the code is built

| Doc                                                  | What it holds                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [`EFFECT_UI_PORT.md`](./EFFECT_UI_PORT.md)           | The contract every module follows on Effect UI: read it before writing code |
| [`EFFECT_MACHINE_PLAN.md`](./EFFECT_MACHINE_PLAN.md) | The client's flows as effect-machine machines                               |
| [`EVENTLOG_MIGRATION.md`](./EVENTLOG_MIGRATION.md)   | The player save synced on `effect/eventlog`                                 |
| [`TESTING_PLAN.md`](./TESTING_PLAN.md)               | The test suite: its fixtures, stories, and speed work                       |
| [`IMAGES_PLAN.md`](./IMAGES_PLAN.md)                 | The prebuilt sprite atlas and faster screenshots                            |

## Plans and research

| Doc                                            | What it holds                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| [`ESCAPE_PLAN.md`](./ESCAPE_PLAN.md)           | How the escape the manor update was built, layer by layer              |
| [`PROGRESSION_PLAN.md`](./PROGRESSION_PLAN.md) | Progression: why every run moves the player forward                    |
| [`BOT_PLAN.md`](./BOT_PLAN.md)                 | A better scripted bot, and a bot that plays like you                   |
| [`INPUT_PLAN.md`](./INPUT_PLAN.md)             | Rebindable keys and controllers                                        |
| [`RELEASE_VIDEO.md`](./RELEASE_VIDEO.md)       | The launch video                                                       |
| [`PACING_REPORT.md`](./PACING_REPORT.md)       | Research: why a run's pacing felt flat                                 |
| [`ROOM_RESEARCH.md`](./ROOM_RESEARCH.md)       | Research: why the rooms felt the same, and the picks                   |
| [`ROOM_DRAFTS.md`](./ROOM_DRAFTS.md)           | Drafts of the house plan, the dining room, the library, and the cellar |

`media/` holds the pictures the README shows.
