# `src/input/`

Keyboard, mouse, and touch.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                           | What it holds                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aimAssist.ts`                 | The portrait aim assist                                                                                                                                                                                      |
| `inputSchema.ts`, `message.ts` | The input's Schemas (the surface, sticks, buttons, devices, the Model's `input`); the input's Messages as `InputMessage` (`inputCases`) and the run's buttons as `RunButtonMessage` (`runButtonCases`)       |
| `input.ts`, `thumbArea.ts`     | Keyboard, mouse, and touch input; the portrait thumb area                                                                                                                                                    |
| `couch.ts`                     | Players 2 to 4 at one keyboard (dev-only `?local=N`): their keys, intents, and shared camera                                                                                                                 |
| `gamepad.ts`, `rumble.ts`      | A controller in the standard layout: its buttons as codes, the sticks as move and aim, the dead zone, the polled record and its new presses; the rumble a frame's events call for (a bite, a stomp, a blast) |
| `padFocus.ts`                  | A controller's menu moves on the page: the nearest control the way the stick points, clicking what has focus, turning a tab strip or page, and a dialog's Escape                                             |
| `keyActions.ts`                | The keys that press a seat action, one table for single player, co-op's client, and the couch, with READY's key held to buy at a purchasable; a controller's menu buttons (`PAD_MENU_KEYS`)                  |
| `touchTaps.ts`                 | Touch taps made into clicks from each finger's pointer events, mounted on the root (`ListenForTouchTaps` in `mount.ts`)                                                                                      |
| `keyGrab.ts`, `noZoom.ts`      | Letter keys a browser extension swallows; no pinch zoom on iOS                                                                                                                                               |
