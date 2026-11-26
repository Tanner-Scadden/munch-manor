# `src/shared/`

Small pure helpers and names any layer reads, the World too.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                      | What it holds                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describeError.ts`        | A thrown value as an error's reason, and `BrowserError`, a browser API's failure                                                                                                                           |
| `dualArgs.ts`             | The cheap tests that tell a dual function's data-first call from its data-last one when an argument is optional                                                                                            |
| `soundEffect.ts`          | Sound effect names apart from the audio engine, so the step can name one                                                                                                                                   |
| `detMath.ts`              | `sin`, `cos`, `tan`, `atan`, `atan2`, `acos`, `exp`, and `hypot` from `+`, `-`, `*`, `/`, and `Math.sqrt`, the same bits in every engine, for the World and everything that feeds it (`munch/stable-math`) |
| `prng.ts`, `constants.ts` | The seeded random number generator and `unitOf`, a whole number hashed to 0 to 1 alike on every engine; the view size, speeds, and other tuning numbers                                                    |
| `sameList.ts`             | A rebuilt list kept as the old one when every element is the same (`sameIfUnchanged`, `appendOrSame`, `emptied`), so a write that changes nothing skips the World or Model copy                            |
| `evolve.ts`               | `evolveFor<Base>()`, `UiStruct.evolve` over a base shape for a rule typed over every Model that holds it, so each caller gets its own type back (the World's fields, a seat, a hint)                       |
| `stepWhen.ts`             | `stepWhen`, a Step run on a condition, for any component's update                                                                                                                                          |
| `valueHash.ts`            | One 32 bit hash for any value, equal exactly when the values are equal bit for bit, shared by the determinism tools and a recording's World hash                                                           |
| `nameKeys.ts`             | The key sets of the menus' names (maps, the shop guide's sections, house spots), apart from the client's Schemas so the World never reads one                                                              |
| `workCount.ts`            | A count of the costly passes (a flow field search, a scan of the whole map, a spawn route) for the work budget tests, never read by the game                                                               |

## `records/`

| File                                            | What it holds                                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records/playerData.ts`                         | `PlayerSave`'s Schemas, shared with the sync Worker and read by the World (the callings)                                                                                                                   |
| `records/missionData.ts`, `records/dayStamp.ts` | The daily missions' pool, goals, Bones, and saved record with its pure changes (progress, claims, the stamp, the reroll, the merge), shared with the sync Worker; the UTC day's stamp and the later of two |
| `records/sessionApi.ts`                         | What the client and the Worker's player log share: its paths, the store id of a player, the session and link code RPCs (`PlayerLogRpcs`), the redeem request and answer, and `newIdentity`                 |
| `records/proofData.ts`                          | The Proof Shelf's saved record: a stamp (wave, hero, crew, day, ending) per thing per difficulty, the first one kept (`shelve`, `mergeProof`), shared with the sync Worker                                 |
| `records/journalData.ts`                        | The Dare Journal's saved record (milestones, rooms opened and found in, heroes played, things found) with its union merge and increments, shared with the sync Worker                                      |
| `records/dareMarkData.ts`                       | The dare ladder's saved record, the best mark per difficulty, with its max-merge, shared with the sync Worker                                                                                              |
| `records/masteryData.ts`                        | Hero and gun mastery's saved record (points by hero, kills by gun) with its max merge and increments, and `MasterySkin`, shared with the sync Worker                                                       |
| `records/lookCodes.ts`                          | The look's older saved shapes read as the current one, and the look code the co-op lobby carries (up to nine words, the prop style last), shared with the sync Worker                                      |
| `records/rankCurve.ts`                          | The rank curve (front-loaded to rank 19, then the old one) and the Bones purse each rank with no other gift pays once, shared with the sync Worker                                                         |
