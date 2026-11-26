# `src/audio/`

The audio engine, the music, and every sound's recipe.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                                                    | What it holds                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio.ts`, `music.ts`                                  | The audio engine resource and synthesis; the tunes and scheduler                                                                                                                                      |
| `soundRecipe.ts`, `audioRecipes.ts`, `zombieRecipes.ts` | How a sound is written: tone and noise layers, pitch points, envelopes; every sound effect's recipe; the zombies' and the boss's                                                                      |
| `introRecipes.ts`                                       | The intro's sounds: the car, its radio, the knocks, the door's creak, and the slam                                                                                                                    |
| `roomToolRecipes.ts`                                    | The room tools' own sounds: the gramophone's waltz and the soup pot's splosh                                                                                                                          |
| `actionRecipes.ts`                                      | The hands-on actions' own sounds: a CPR push's soft thump and a hammer's knock on a board                                                                                                             |
| `weatherRecipes.ts`                                     | The storm's own sounds: thunder rolling in after a lightning strike, a roof leak's drip, and a foot wading through its puddle                                                                         |
| `audioFlow.ts`                                          | The audio engine's states as an effect-machine machine (`audioMachine`, `stepAudio`): locked, unlocking, suspended, ready, or unavailable, so a late engine or resume after a failure changes nothing |
| `message.ts`                                            | The mute and music buttons, the audio engine, and each sound and tune as `SoundMessage` (`soundCases`)                                                                                                |
