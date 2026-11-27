# `src/world/`

The shared game rules: exactly what the co-op room may load. A module here imports only `src/world/` and `src/shared/` (`bun run world:check`).

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File       | What it holds                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `names.ts` | Every name a player reads, keyed by id: guns and the tier word ladder, zombies, traps, power-ups, and shop goods |

## `cellar/`

| File                                  | What it holds                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cellar/bulb.ts`, `cellar/barrels.ts` | The cellar's bulb chain: the cellar lit for a while, its dark (zombies a little faster, the dare thing found only in the light); its barrels: one rolled west down the corridor, bowling over the zombies it meets |

## `dare/`

| File                                 | What it holds                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dare/dare.ts`, `dare/dareSchema.ts` | The dare: one thing to each room behind boards, the list rolled by difficulty into the rooms, the hunt, `isDareListDone`, `maybeThingRoom`; its Schemas                                                                   |
| `dare/finds.ts`                      | How each room finds its thing: walking onto it, or work (the parlour's rummage, the library's hollow book, the kitchen's dumbwaiter), with each style's time, reach, and readiness                                        |
| `dare/milestones.ts`                 | The milestones: each one's test off the saved journal, the shelf, and the escapes, the story page it opens and the list thing four of them open, and the pool a list rolls from (the house's six, then the opened things) |
| `dare/finale.ts`                     | The finale: the hungrier house, Uncle Chunk at the front door, his big key bursting out for the lock, stepping out, and `Escaped`                                                                                         |

## `dining/`

| File                   | What it holds                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dining/chandelier.ts` | The dining room's chandelier: a shot through it in a wave drops it into the table's gap, crushing the zombies under it, as the level's drop until the break |

## `feats/`

| File                               | What it holds                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feats/feats.ts`, `feats/cases.ts` | Feats: each seat's tally, fed from the tick's kills, hurts, waves, rooms, and the valve, and each feat's goal and progress; the display cases: the run's roll of prizes and feats, opening for the first seat to do its feat, and taking the prize |
| `feats/caseSpots.ts`               | Where the display cases stand: their spots off the rooms' maps, their boxes, feet, rooms, and looks, and whether a case's room is open                                                                                                             |

## `fridge/`

| File                                             | What it holds                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `fridge/leftovers.ts`, `fridge/fridgeWeapons.ts` | Mystery Leftovers: the fridge, its price, and its prizes; the fridge-only weapons |

## `gear/`

| File                                                   | What it holds                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gear/traps.ts`, `gear/weapons.ts`, `gear/powerups.ts` | The trap table, placement, chewing, and repair; the weapon table, magazines, and reload; drops and boosts                                                            |
| `gear/crates.ts`                                       | The trap crates: one per open room, a Plank Pile or a Grumpy Gnome each break from their own stream, taken by walking on within the trap caps                        |
| `gear/knife.ts`, `gear/melee.ts`                       | The knife in the melee slot: its stab and the slash's share; a melee strike in an arc: who is in reach, the swing, kills, and the striker's pay                      |
| `gear/gunLevels.ts`                                    | Guns level up with kills: the tier a gun's kills reach, the HUD bar's share toward the next, and crediting a kill to the gun that made it, with its GunLeveled event |

## `heroes/`

| File                                           | What it holds                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `heroes/rank.ts`                               | Rank and Bones: points for a run, ranks, badge tiers, the veteran grant                                                                          |
| `heroes/calling.ts`, `heroes/callingPlayer.ts` | The callings' pure rules: unlock ranks, hearts, speed, magazines, prices, kill pay, the starting gun; the player a run starts with for a calling |

## `keys/`

| File           | What it holds                                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keys/keys.ts` | Skeleton keys, the crew's one ring (`keys`): drops by kind from each tick's kills (the Penny Pincher's, the kitchen's, and Broke's odds), a key a cleared wave and a wiped pack, spending, `heldKeys` |

## `kitchen/`

| File                                      | What it holds                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kitchen/kitchen.ts`                      | The kitchen's ovens to shoot and slippery soup                                                                                                                                                                                        |
| `kitchen/pantry.ts`                       | The pantry stash: once the kitchen is open, one goodie a break in front of the cupboard (cash, a Lid Stack, or a heart), the first to walk on takes it                                                                                |
| `kitchen/kitchenKeys.ts`                  | Kitchen key odds: a kill on a kitchen tile drops keys 1.25x as often (`isInKitchenAt`, read by the feats too)                                                                                                                         |
| `kitchen/backDoor.ts`                     | Leaving early: the kitchen's back door, held open in a break once a thing on the list is found (no keys), only while every standing player is at it, ending the run `LeftEarly`; never in Endless or once Uncle Chunk is in the house |
| `kitchen/soupPot.ts`                      | The kitchen's soup pot tipped: a puddle in front of it for a while that slips zombies as the old soup does                                                                                                                            |
| `kitchen/stove.ts`, `kitchen/gasValve.ts` | The kitchen's stove bench: the perk each break rolls, cooking the gun in hand, the climbing price; the gas valve: lighting the parlour fireplace, its flame zone, burns, and the owner's pay                                          |

## `level/`

| File                   | What it holds                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level/arena.ts`       | Built levels from their specs: the rooms laid on the plan, boarded exits, the tile flags, the level a state names, opening an exit                                                                                                           |
| `level/tileGrid.ts`    | The plan's symbols (walls, cover, doors) and the grid: tiles, indices, boxes, and the distance to a box                                                                                                                                      |
| `level/tileQueries.ts` | What a level says of a tile or a point (walkable, solid, the yard, soup), its doors and their spawn points, and rays: strikes, reach, sight, clear paths                                                                                     |
| `level/plan.ts`        | The house plans: each room's map, the slots (west, east, far) with their doors and exits as data, an arrangement of the parlour, library, and cellar put in them, the house spots, and the level specs                                       |
| `level/exits.ts`       | Buying a boarded exit open between waves: reach and price                                                                                                                                                                                    |
| `level/wakeUp.ts`      | A room opened wakes: a rush of about 10 s from its own doors on the round's planned spawns, mid-wave after the doors' warning, in a break at the next wave's start                                                                           |
| `level/leaks.ts`       | The roof leaks: two or three puddles rolled per open room off its map, on plain floor clear of cover, rugs, doorways, and narrow ways, built once per level; feet in one wade at `WADE_PACE`, a player's and a zombie's alike (`wadePaceAt`) |
| `level/rugs.ts`        | The rugs and runners on the rooms' floors, from each room's top left, and `rugsOf`, every one on the level: drawn by the room's art, kept off by the puddles                                                                                 |
| `level/pathing.ts`     | The flow field and zombie steering                                                                                                                                                                                                           |

## `library/`

| File                                             | What it holds                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `library/secretShelf.ts`                         | The library's secret shelf: a player who walks up to its glinting red book in a round swings it open, the Secret exit between the library and the room it is entered from                                                                  |
| `library/stacks.ts`, `library/revolvingShelf.ts` | The library's leaning stacks: toppled, a heap of books across an aisle that crushes the zombies under it and stands as a wall for a while; the opened secret shelf spun: its workers through the wall, the zombies near it flung and dazed |

## `net/`

| File                                    | What it holds                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `net/worldWire.ts`                      | The World as JSON for the determinism tools                                                                                           |
| `net/worldHash.ts`                      | `hashWorld`: one number for the World's own fields, which a recording keeps and its replay checks                                     |
| `net/roomWorld.ts`, `net/worldCodec.ts` | The netcode `World` over `stepWorld` a co-op room runs: seats, inputs and presses, interpolation, prediction; the World's binary wire |

## `parlour/`

| File                    | What it holds                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `parlour/gramophone.ts` | The parlour's gramophone: while it plays, Groaners and Kaboomers in the parlour waltz in slow circles toward the dance floor instead of chasing |

## `party/`

| File                                | What it holds                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `party/party.ts`, `party/revive.ts` | Co-op's players in the World: `seats` by slot: `seatStateAt`, `modifySeat`, `atSeat`, `forEachSeat`, `focusOf`; targets, money splits, trap owners; downed, revived, READY, friendly fire |
| `party/medic.ts`                    | The MEDIC call: a downed player's shout and its cooldown, the fresh call the bubble, edge badge, and bots read, SAVED! and CLUTCH!                                                        |

## `run/`

| File                   | What it holds                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run/lessons.ts`       | The lessons the step reads and writes: the practice gate and the breaks seen                                                                                                                    |
| `run/stats.ts`         | Run stats: kills, accuracy, run time, and the verdicts                                                                                                                                          |
| `run/modifiers.ts`     | Run modifiers: the set, its bonus, the lobby's mask, and the small rules (Broke's pay, Big Crowd's scale, Glass's heart)                                                                        |
| `run/dareLadder.ts`    | The dare ladder: the marks, the modifiers marks 1 to 4 turn on (`activeModifiersOf`), the house rules of 5 to 8 (Hotfoots, padlocks, the break clock, Uncle Chunk), and each house rule's bonus |
| `run/difficulty.ts`    | The difficulty table, the Nightmare unlock, the bests                                                                                                                                           |
| `run/arrival.ts`       | The intro's clock: a run starts Arriving, a skip jumps to the slam, and the slam begins the first break; the room runs it for the crew                                                          |
| `run/tutorialRules.ts` | The tutorial's World rules: the dare tour's break, its key on the floor and its easy case; the kitchen tour's held break clock, the free boards and pull                                        |

## `schema/`

| File                                       | What it holds                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/world.ts`, `schema/worldSchema.ts` | The World, `withWorld`, and `modifyWorldFields`; the World's Schemas apart from the client Model                                                |
| `schema/entitySchema.ts`                   | What moves and stands in the World (the player, zombies and the boss, bullets, pickups, the fridge, the level), re-exported by `worldSchema.ts` |
| `schema/wireNumber.ts`                     | How the co-op wire packs a number, named on its Schema (`PositionNumber`, `Heading`, ...)                                                       |

## `shop/`

| File                   | What it holds                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `shop/purchase.ts`     | Buying in the world by standing or holding, with keys off the crew's ring: offers, reach, the hold |
| `shop/shopUpgrades.ts` | What a gun's new tier changes, in a few words, for the level-up callout                            |

## `stations/`

| File                                                | What it holds                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stations/stations.ts`                              | Work stations, the room tools' set-up: a still player in reach works one and holds their fire, its set-up fills (each worker's share) and drains, then it fires and cools down; what each tool does as it fires and when it is ready        |
| `stations/toolRules.ts`, `stations/stationSpots.ts` | Every room tool's numbers in one table (set-up, cooldown, reach, how long its effect lasts, its own numbers) and whether a tool is on, read off its station's clock; where each station stands, off the rooms' maps, and whether it is open |
| `stations/knockDown.ts`                             | A tool's blow on the zombies it picks: hurt, knocked along, and dazed                                                                                                                                                                       |
| `stations/work.ts`                                  | What any work shares: a still player, and how fast unworked progress drains                                                                                                                                                                 |

## `step/`

| File                             | What it holds                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `step/simulation.ts`             | The pure step that advances the game one frame: intent, the player, wear, intensity, and the seats                        |
| `step/firing.ts`, `step/hits.ts` | Firing, reloading, bullets, lag compensation, and tracers; bullet hits, kills paid, and bites and pops on contact         |
| `step/stepWorld.ts`              | `stepWorld`, the co-op room's pure 60 Hz tick                                                                             |
| `step/collision.ts`              | Circles against the level: a walker pushed out of solid tiles and boxes, moved in small steps so it never tunnels through |
| `step/geometry.ts`               | Vectors, clamping, circle and segment checks                                                                              |
| `step/grid.ts`                   | The uniform grid, a counting sort rebuilt for each step that needs one, whose queries give indices in list order          |
| `step/combat.ts`                 | Strikes, wounds, and bursts on any list of targets                                                                        |
| `step/hitStop.ts`                | Hit-stop, the World's freeze on hits                                                                                      |

## `waves/`

| File                                                                | What it holds                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `waves/waves.ts`, `waves/doorRoute.ts`                              | Doors that join a wave, run phases, spawning, and clearing a wave; which door each pack comes through around planks                    |
| `waves/wavePlans.ts`, `waves/wavePacks.ts`, `waves/endlessWaves.ts` | The campaign's spawn tables and wave arc; rolling a group's packs and volleys onto doors; Endless waves, and rolling any wave's spawns |
| `waves/pacing.ts`                                                   | Sawtooth beats, telegraphs, door camping, intensity                                                                                    |
| `waves/doorWeights.ts`                                              | The spawn doors a wave weights 2:1 toward the players: their rooms' and the open rooms beside them, read at Preparation                |

## `zombies/`

| File                                                            | What it holds                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `zombies/zombieMotion.ts`                                       | Zombies steering, separating, and their footfalls                                                                                              |
| `zombies/zombieGrid.ts`                                         | The grid of grounded zombies and the widest body reach                                                                                         |
| `zombies/zombies.ts`, `zombies/actions.ts`                      | The zombie kind table (stats, behavior, deaths, sounds, wear); winded and dazed zombies getting up                                             |
| `zombies/frenzy.ts`, `zombies/chucker.ts`, `zombies/crawler.ts` | Horde frenzy and the pack bonus; the Big Leaguer's throws and shield; the Ankle Biter surfacing and clinging                                   |
| `zombies/lastZombie.ts`                                         | The wave's last zombie: once nothing is left to spawn, it hurries up to the players' walk over 2 s (`pacing.loneMs`)                           |
| `zombies/boss.ts`                                               | The boss's entrance, his second phase at half health with its party crashers, attacks (stomp, belly slam, belch, spit, charge), and health bar |
| `zombies/bossRules.ts`, `zombies/bossFight.ts`                  | The boss's numbers (`BOSS_RULES`); the fight's shared steps: his move and events, hurting a player, and his plates in flight and pooled        |
