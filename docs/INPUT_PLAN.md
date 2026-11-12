# Rebindable keys and controllers

Research, November 10, 2026. The owner asked: "I also want to add the ability for people to change the keyboard settings, and controller support! Look into how hard that would be."

Short answer: both are medium jobs, and neither touches the World, the co-op wire, or determinism. The input layer is already shaped for them. Controller play in a run is the cheapest valuable step, about 3 to 4 days. Rebinding is about a week, most of it in the many places a key is shown, not in the input itself.

This plan was written against the escape the manor stack (`docs/ESCAPE_PLAN.md`). That stack removes the shop and changes some actions, so build after it lands, or key everything below on action names so a dropped action is one row gone.

## What exists today

- **Keys become intent in one place.** `src/input/input.ts` keeps `pressedKeys` (by `KeyboardEvent.code`) in the Model's `input`, and `deriveIntent` turns keys, the mouse, and the two touch sticks into one `Intent` (`move`, `maybeAim`, `trigger`, `interact`). `refreshIntent` in `src/app/frame.ts` runs it each frame and adds aim assist on touch.
- **Keys become seat actions through one table.** `src/input/keyActions.ts` holds `ActionKeys` (swap, knife, reload, placeTrap, nextTrap, ready) and `PLAYER_ACTION_KEYS`. `keyActionOf(seat, keys, code)` already takes the keys as an argument, because the couch players each have their own block (`src/input/couch.ts`). Rebinding the actions is mostly passing the player's table instead of the constant.
- **Movement keys are constants**: `UP_KEY` to `RIGHT_KEY` in `input.ts`, plus `START_KEY`, `PAUSE_KEY`, `MENU_KEY`, and the menu arrows.
- **Touch already has twin sticks.** `Stick` and `stickDeflection` give a clamped deflection with a dead zone, and `stickAim` turns it into a direction. A gamepad stick is the same thing with no pointer, so the math is reused.
- **Co-op sends intent, not keys.** `src/app/update/coopPlay.ts` sends `inputOfIntent(focusOf(model).intent)` to the room, and presses go through `orInRun` as `SeatAction`s. Anything that feeds the same intent and the same presses works online with no protocol change.
- **The last device is known.** `model.lastDevice` is `'KeyboardMouse' | 'Touch'` (`InputDevice` in `src/input/inputSchema.ts`), read in 18 modules: key caps, help cards, hints, the purchase prompt, the touch controls, the phone's zoom (`src/render/screen.ts`), and the run summary.
- **Menus already move by key.** Arrows step focus (`maybeFocusStep`), Enter activates the focused button (the browser does it, `BUTTON_ACTIVATION_KEYS` in `src/app/subscriptions.ts`), Escape goes back, and each menu has letter hotkeys with caps (`HOME_KEYS`, `HAND_KEYS`, `LOBBY_KEYS`, co-op's `MODE_KEY` and friends).
- **Settings live in the save and sync.** `SavedSettings` in `src/shared/playerData.ts` (sound, music, shake, shareStats, cursor) syncs as one `ChangedSettings` change. Rotation is kept apart as its own last-write-wins `ChangedRotation` change (save version 8): the model for a new synced setting.
- **A key-grabbing extension watch exists** (`src/input/keyGrab.ts`): Vimium-style extensions swallow letter keys. Rebinding is a real fix for those players.

## 1. Rebinding the keyboard

### What changes

1. **A bindings Schema.** `KeyBindings` in `src/shared/playerData.ts`: one physical `code` per action. Actions: up, down, left, right, swap, knife, reload, placeTrap, nextTrap, interact (READY, hold to buy, MEDIC). Fire stays on the mouse, with an optional key as a stretch. `DEFAULT_KEY_BINDINGS` is today's table.
2. **The Model holds it.** A `keyBindings` field on the root Model, restored from the save.
3. **`input.ts` reads it.** `keyboardMove` and `interactOf` take the bindings instead of the constants. `deriveIntent` gains one argument. `playerKeyAction` in `keyActions.ts` passes the player's bindings to `keyActionOf`.
4. **Menu keys stay fixed.** Arrows, Enter, Escape, and the menus' letter hotkeys are not rebindable. They are a different context (no run is live), and moving them makes every menu's cap a variable for little gain.

### Where key names are hard-coded

| Place                                                                                           | What it names                                                        | Change                                                                                  |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/input/input.ts`                                                                            | WASD, Enter, E, C, Escape, H, L, arrows                              | Movement and interact read bindings; menu keys stay                                     |
| `src/input/keyActions.ts`                                                                       | Q, F, R, T, G, Enter                                                 | Defaults only; the table is passed in                                                   |
| `src/features/menus/pauseHelp.ts`                                                               | "Walk with WASD", "Q switches guns, R reloads", "Press F", "press T" | Lines built from the bindings                                                           |
| `src/art/hintIcons.ts`                                                                          | `keyIcon('T')`, `keyIcon('Q')`, the WASD picture                     | Key icons baked per letter; WASD picture per binding set or a plain "move keys" picture |
| `src/features/onboarding/onboarding.ts`                                                         | the trap hint's `KeyT` part                                          | Reads the bound key's icon                                                              |
| `src/features/shop/purchaseHud.ts`                                                              | "hold Enter to buy"                                                  | Reads the interact key (or goes with the shop in the escape stack)                      |
| `src/screens/game/hud.ts`                                                                       | the swap slot's Q badge                                              | Reads the swap key                                                                      |
| `src/screens/home/home.ts`, `homeView.ts`, `src/features/lobby/lobby.ts`, `src/features/coop/*` | menu hotkeys and caps                                                | None (fixed)                                                                            |
| `src/test/testing.ts` and Story tests                                                           | `press('KeyQ')` and friends                                          | None: tests run on the defaults                                                         |

About 8 shipped modules change for the keys a run reads, plus the Profile and the save.

### Conflicts and reserved keys

- **Reserved, never bindable:** Escape (pause and back), Tab (focus), Enter while a menu is up, the meta keys, F1 to F12, and any key with Ctrl, Command, or Alt (already left to the browser by `isLeftToPage` in `subscriptions.ts`).
- **Allowed with care:** Space and the arrows. `isKeptFromBrowser` already stops their scroll; a bound key must join that list so it never scrolls the page.
- **Conflicts:** binding a key already used by another action swaps the two, and the row flashes. That needs no error state and no dialog.
- **Run-time keys that are not actions** (H for the menu, the pause key) are checked too: binding one of them is refused with a shake.
- **Layouts.** The game reads `KeyboardEvent.code`, the physical key, so WASD stays in the same place on AZERTY. That is right for play, but the cap then says "W" where the key reads "Z". `navigator.keyboard.getLayoutMap()` gives the printed letter in Chromium only; elsewhere, show the code's QWERTY letter. Rebinding fixes the rest for anyone who cares.

### The settings UI

- A **CONTROLS** section in the Profile's Settings tab (`src/features/profile/`), shown only when `lastDevice` is `'KeyboardMouse'` (a phone never sees it).
- One row per action: its pixel icon, a short name, and the key cap. Focus or click a row, and it waits: "PRESS A KEY", with Escape cancelling. The next key down is the binding.
- **Capture inside the Profile's Dialog.** `isLeftToPage` sends keys typed inside a dialog to the page, not the game. The listening row needs its own key capture: a Foldkit `OnKeyDown` on the row (an `h.OnKeyDown`-style attribute) that sends `PressedBindingKey({ code })` to the Profile Block, which says it up as an OutMessage for the root to make, as the Look tab's picks do.
- **RESET** puts every key back, with a confirm press.
- Keep copy short: action names only, no sentences ("Show, don't explain").

### Saving and syncing

Two honest choices (a decision below):

- **Synced** with the save: a `keyBindings` column, a numbered scope migration, a `ChangedKeyBindings` mutation, its case in `changesBetween` and `runChange`, a `SAVE_VERSION` bump with a fallback to the defaults. Same shape as rotation. Phones carry it and never use it.
- **Per device:** kept in the store but outside the sync scope, like the summary queue. Simpler sync, but a player who rebinds once must do it again on a second computer, and the store has no "device settings" table yet, so it is new plumbing too.

Synced costs a little more and matches how every other setting works. Either way it goes through `PlayerStore` only.

### Showing the player's keys

- One helper, `keyCapOf(bindings, action)`, returns the cap text from a code (`KeyQ` to `Q`, `Space` to `SPACE`, `ArrowUp` to an arrow glyph). Every run-time cap reads it.
- The pixel font has letters; arrows and SPACE need a few glyphs.
- Help lines become small functions of the bindings ("{swap} switches guns"). Hint pictures for keys are baked per letter on first use, so each such sprite joins `src/art/spritePrecompile.ts` or the atlas test fails.

### Effort and risks

- **Files:** about 15 to 20 (input 3, save and sync 5, Profile Block 4 to 5, captions and hints 5, tests).
- **Time:** 4 to 6 days, with the Profile UI and the captions about half.
- **Risks:**
  - The key capture fights the dialog's own Escape and focus handling.
  - A sync migration is permanent: get the Schema right the first time (add actions as optional fields).
  - The hint and help art bakes key letters; a missed one shows the old key.
  - The escape stack renames or drops actions (trap keys, buying); a binding saved for a dropped action must decode and be ignored.

## 2. Controllers

### Polling in the Subscription model

The Gamepad API has no events for sticks and buttons, only `navigator.getGamepads()` read each frame, plus `gamepadconnected` and `gamepaddisconnected`.

- **A new Subscription,** `gamepad`, beside `frame` in `src/app/subscriptions.ts`. It runs a `requestAnimationFrame` loop (like `animationFrames`), reads the pads, and sends a Message **only when something changed**: `PolledGamepad({ index, axes, buttons })`, axes rounded to a few bits (1/64) so stick noise sends nothing.
- It is active when a pad is connected (the connect events, a second small stream) and the page is visible.
- `update` stays pure: the Message carries the numbers, and the Model's `input` gains a `gamepad` record. Button presses are edges, found in `update` by comparing the new buttons with the last ones, so a replay of Messages replays the game exactly.
- Reading `getGamepads` is a browser call: it lives in the Subscription only, as `performance.now` does.

### Into the existing intent

| Control                         | Becomes                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| Left stick (and d-pad in a run) | `move`, through the touch sticks' dead zone and clamp                      |
| Right stick                     | `maybeAim`, like `stickAim`; when centered, the aim holds its last heading |
| Right trigger (RT, R2)          | `trigger: 'Held'`, past a threshold of about 0.3                           |
| A (Cross)                       | interact: READY, hold to buy, MEDIC                                        |
| X (Square)                      | reload                                                                     |
| Y (Triangle)                    | swap                                                                       |
| B (Circle) or right bumper      | knife                                                                      |
| Left bumper                     | next trap                                                                  |
| Left trigger                    | place trap                                                                 |
| Start (Options)                 | pause                                                                      |

`deriveIntent` adds the pad's move to the keyboard's and the touch stick's, as it already sums keys and the move stick. The presses go through `keyActionOf`'s path as `SeatAction`s, so they get the same rules, the same parity test, and `orInRun` online. A `PadActions` table beside `ActionKeys` keeps it "one table" (`munch/key-action-once`).

### Aim assist

`withAimAssist` in `frame.ts` runs only when `lastDevice` is `'Touch'`. Extend it to a `'Gamepad'` device. A stick aims coarser than a mouse, the same reason it exists for thumbs. The same numbers are a fair start; tune with a pad in hand. It is part of the intent, so the World steps the same either way.

### Menus and dialogs

- Map the d-pad and the left stick (with repeat and a flick threshold) to the menus' focus steps, A to activate, B to back.
- The catch: Enter on a focused button works today because **the browser** clicks it. A gamepad's A sends no key, so it needs a Command that clicks the focused element (`document.activeElement`), the same for every menu. B maps to each menu's existing Escape path.
- Each Block (home, lobby, co-op, Profile, shop, Munchopedia, guide, hero picker) takes key presses already through an InMessage (`requestPressKey`). Feeding them a synthetic `ArrowDown`, `Escape`, or the click Command covers most menus without touching each one. The Profile's tabs and the Look tab's radio groups use Foldkit's own key handling on DOM events; those need a check, and maybe `Tab`-like steps.
- Focus must be visible on every screen with no mouse. Some menus show focus only for keyboard today; they read `isKeyboard(model)`, which a pad must count as.

### Glyphs and the last device

- `InputDevice` gains `'Gamepad'`. That touches the 18 readers, most of them a `'KeyboardMouse'` check that becomes "not touch". Matching it exhaustively flags each one in typecheck, which is the right kind of work list.
- The run summary records the device: a new value is a `RUN_SUMMARY_VERSION` bump and a D1 migration if it is kept.
- Glyph sets: Xbox (A B X Y, LB RB LT RT), PlayStation (shapes, L1 R1 L2 R2), and a generic set. `Gamepad.id` names the pad ("Xbox", "054c" for Sony, "DualSense", "Pro Controller"); guess from it, and fall back to Xbox, the most common on PC.
- A glyph is a small pixel sprite, drawn by the same key cap helpers once they take an "input" instead of a letter. Help lines and hints get a gamepad variant beside `keyboard` and `touch` in `pauseHelp.ts` and the hints.
- Switching: the last thing touched wins, as today (a pad press sets `'Gamepad'`, a mouse move sets `'KeyboardMouse'`). Ignore stick noise below the dead zone so a resting pad never steals the device.

### Co-op

- **Online:** one pad per client is free. The client's intent and presses are what the room gets; the room never knows a pad was used.
- **Couch:** `src/input/couch.ts` already gives seats 2 to 4 their own keys and intent, dev only behind `?local=N`. Pads make it real: each connected pad claims the next seat. It needs a join screen ("press A to join"), a shared camera that already exists, per-seat aim from the right stick (couch players aim where they walk today), and seats added to the solo lobby. `MULTIPLAYER.md` estimates couch co-op at 1 to 2 weeks; pads are most of the input half.

### Rumble

`gamepad.vibrationActuator.playEffect('dual-rumble', {...})` in Chrome and Edge, and recent Safari; Firefox has none. A Command fired from the frame's events (a bite, a boss slam, a Kaboomer). It needs a Settings toggle, and it is optional: about half a day.

### Browsers and quirks

- **Chrome, Edge, Firefox:** good, with the `standard` mapping for Xbox and PlayStation pads. Check `gamepad.mapping === 'standard'`; a non-standard pad gets a warning or a guess.
- **Safari on macOS and iOS (and iPadOS):** supports Xbox, PlayStation, and MFi pads through the Gamepad API, standard mapping. The installed iOS app (Capacitor, WKWebView) gets it too. Android WebView supports it.
- **A pad is invisible until a button is pressed** on the page (a privacy rule). The connect event fires then, so a pad held before load needs one press. Say nothing; just handle it.
- **Secure context only.** The site is HTTPS, so fine.
- **Hot plugging:** handle disconnect mid-run as a pause (as a blur pauses now), and reconnect without losing the seat.
- **Index gaps:** `getGamepads()` can return `null` slots; key a pad by its index, never assume slot 0.
- **Firefox and Safari** sometimes report the triggers as axes; normalize to 0 to 1.
- **Test tools:** a fake pad for Story tests is just the Message; a headless audit can stub `navigator.getGamepads`.

### Effort and risks

| Piece                                                              | Files    | Days   |
| ------------------------------------------------------------------ | -------- | ------ |
| Gameplay: polling, intent, presses, aim assist, `'Gamepad'` device | 8 to 10  | 3 to 4 |
| Menus: focus steps, A clicks, B backs, every Block checked         | 10 to 15 | 3 to 5 |
| Glyphs and help lines                                              | 8 to 12  | 2 to 3 |
| Couch co-op with pads, a real feature                              | 10+      | 5 to 8 |
| Rumble and its toggle                                              | 3 to 4   | 0.5    |

Risks:

- The menus are many Blocks with their own focus rules; one that ignores the synthetic keys strands a pad player. Plan an audit that walks every menu by pad.
- `InputDevice` gaining a value ripples through 18 modules and the run summary.
- Stick noise and polling must never send a Message per frame at rest, or the frame and the Message log grow.
- Pad support varies by browser and pad; a few odd pads will not work, and that is fine.
- A pad player in a run with no way to reach the menus is the worst case. Phase 1 must at least pause and quit with the pad.

## 3. Phased plan

1. **Controller in a run** (3 to 4 days). Move, aim, fire, every action, pause, aim assist, the `'Gamepad'` device. Start a run with the mouse or keyboard, then play the whole run on a pad, solo and online. A player who owns a pad gets the game the way twin-stick shooters feel best. Touch caps already hide for non-keyboard play, so prompts show nothing wrong, just nothing.
2. **Controller in the menus** (3 to 5 days). D-pad and stick move focus, A presses, B backs, on every screen. The game plays end to end from the couch with no keyboard. This is what makes it "controller support" on a TV or a Steam Deck.
3. **Glyphs** (2 to 3 days). Xbox and PlayStation button pictures in prompts, help, hints, and menu caps. The game teaches pad players in their own buttons.
4. **Rebinding the keyboard** (4 to 6 days). The CONTROLS section, saved and synced, every in-run cap showing the player's own keys. Lefties, AZERTY players, and Vimium users can play.
5. **Optional:** rumble (half a day), pad rebinding (2 days on top of phase 4's UI), and couch co-op with pads (1 to 2 weeks, with `MULTIPLAYER.md`'s couch plan).

Phase 1 is built (November 2026), with the rumble from 5 brought forward: `src/input/gamepad.ts` reads the pad, the `Gamepad` Subscription in `src/app/subscriptions.ts` polls it, its buttons press through the key table (`PAD_ACTION_KEYS` in `src/input/keyActions.ts`), and `src/input/rumble.ts` with `src/app/update/rumble.ts` rumble it. `tools/audit/pad.ts` plays a run with a stand-in pad.

Phases 1 to 3 are about 2 weeks. All four are about 3 weeks. None of it moves the World, so no balance work and no co-op protocol change.

## 4. Decisions for the owner

1. **Rebinding: synced or per device?**
   - Synced with the save, like rotation (recommended): set once, every computer has it; one more sync mutation.
   - Per device: no sync work, but new device-only store plumbing, and redo on each machine.
2. **Controller in the menus: phase 1 or later?**
   - Gameplay first, menus right after (recommended): a pad player can play in days; the mouse starts a run until phase 2.
   - Both together: no half state, but nothing ships for about 1.5 weeks.
3. **Which glyphs?**
   - Xbox and PlayStation, picked from the pad's id, Xbox as fallback (recommended).
   - Xbox only: cheaper, wrong for PlayStation players.
   - Xbox, PlayStation, and Switch: Switch pads on the web are rare and swap A and B.
4. **Couch co-op with controllers: a real feature?**
   - Not now; keep `?local=N` dev only, revisit after the escape the manor update (recommended).
   - Yes, after phase 3: 1 to 2 more weeks, and the lobby gains a "press A to join" seat row.
   - Keyboard-only couch: no, two people on one keyboard is a test tool, not a feature.
5. **Rebind controllers too, or keyboard only?**
   - Keyboard only, pads use a fixed standard layout (recommended): pads are already consistent.
   - Both: about 2 more days, mostly the second column in the UI.
6. **Rumble?**
   - Yes, with a Settings toggle, on by default (recommended): half a day, big feel for a shooter.
   - No.

## 5. Decided (owner, 2026-11-10 and 2026-11-11)

1. Bindings are synced with the save (a sync mutation), not kept per device.
2. Controller in a run first, then the menus by controller right after.
3. Xbox and PlayStation glyphs, picked from the pad's id, with Xbox as the fallback.
4. Couch co-op with pads is planned right after the glyphs phase.
5. Controllers cannot be rebound: pads use a fixed standard layout, and only the keyboard is rebindable.
6. Rumble is in: pads vibrate on a bite, a boss slam, or a blast, with a Settings toggle, on by default.

Work starts once the escape the manor update (PR #180) lands.
