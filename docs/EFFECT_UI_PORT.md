# The port to Effect UI

The game moves from the Foldkit 0.170 canary to Effect UI (`@effect/ui`, `@effect/ui-kit`), and from the 2D canvas to Pixi alone. This file is the contract every converted module follows. Effect UI's own guides are the authority: `repos/effect-ui/LLMS.md`, `repos/effect-ui/ai-docs/src/10_ui/*.ts` (read `10_basics.ts`, its fixture `fixtures/notes/components/NoteEditor.ts`, `21_view-functions.ts`, `24_mounts.ts`, `25_document-events.ts`, `27_state-ownership.ts`, and `50_testing.ts`), and the doc comments in `repos/effect-ui/packages/ui/src/*.ts`. Where this file and the guides disagree, the guides win; say so.

Typecheck with `npx effect-tsgo tsrs --noEmit` from the repo root (about 3 s), never `tsc`. The tree is mid-port, so filter its output to the files you own: `npx effect-tsgo tsrs --noEmit 2>&1 | grep 'src/app/update/home.ts'`.

## The root

- `src/app/definition.ts`: `ApplicationDef = Html.component({ name: 'Application', model: Model, message: Message, restore: false })`. The finished component is `ApplicationNoDeps = ApplicationDef.make({...})` and `Application = ApplicationNoDeps.pipe(Component.provide(...))` in `src/app/block.ts`.
- `src/app/update/step.ts` holds the Step vocabulary:
  - `App$<Cur>` is Effect UI's update `$` for the root; `UpdateStep = ($: App$) => Model | AppStep`.
  - `unchanged`, `modelStep(change)` (a plain `Model => Model`), `toModel(next)`, `combine([...steps])` (`$.combine`), `withInput`, `releaseInput`, `defineHandlers({...})`.
  - `stepWhen(isDue, step)` from `src/shared/stepWhen.ts`.

## Converting a Step

Foldkit's Step was `(model) => ({ model, commands })`. Effect UI's update is a `$` builder ("Building a component"):

| Foldkit                                                        | Effect UI                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `model => ({ model })`                                         | `$ => $.model`                                                            |
| `model => ({ model: f(model) })`                               | `$ => f($.model)`, or `modelStep(f)`                                      |
| `{ model: next, commands: [A(args), B()] }`                    | `$.set(next).run(A.make(args), B.make())`                                 |
| `UiStruct.evolve(model, {...})` then `{ model }`               | `$.evolve({...})`                                                         |
| `Update.combineSteps(model, [a, b])`, `combine(model, [a, b])` | `$.combine(a, b)`, or `combine([a, b])` as a Step                         |
| `makeStep(model => Update.combineSteps(model, [...]))`         | the Steps themselves, `combine([...])`                                    |
| `step(model)` read for its `.model`                            | `step($)`; a Step that needs another's Model runs after it in `$.combine` |
| a dual `(model, x) => Return`                                  | a Step factory `(x) => UpdateStep`, not dual                              |
| a handler `(model, message) => ...`                            | `($, message) => ...`                                                     |

A handler that does nothing returns `$.model`. A Step reads `$.model`, never a Model captured before an earlier Step in the same `$.combine` ran.

The after-message Steps (`afterMessage` in `src/app/update/settle.ts`) run once in `update` in `src/app/main.ts`: `($, message) => $.combine(handle, ...afterMessage(before, mode))`, where `handle` is `ApplicationDef.update({ ...every group's handlers })`. A handler never settles itself.

## Converting a Command

- Every `ApplicationBlock.makeCommand(...)` becomes one of:
  - `Command.make(name, { args }, args => effect)` when the body needs only the browser or nothing at all: focus, full screen, a sound through a module-level engine, a reload.
  - `class X extends Command.Service<X>()('app/X', { args, success: SomeMessageUnion, mode? }) { static readonly layer = this.toLayer(...) }` when it needs a service (`PlayerStore`, `CoopNet`, the network, the audio engine). Its `.layer` joins `CommandsLayer` in `src/app/layer.ts`.
- Issue it with `X.make(args)` (`X.make()` for no args) inside `$.run(...)`.
- A body handles its failure itself (`Effect.match`, `Effect.orElseSucceed`) and returns a Message, or `Component.noop` when nothing is to be reported.
- Drop the Messages that only said "done" or "failed" and changed nothing (`CompletedFocusX`, `CompletedPlaySound`, `CompletedRegisterServiceWorker`, ...): the body logs a failure with `Effect.logWarning` and ends in `Component.noop`. Remove the dropped cases from their Message group and the handlers from their record.
- `mode: 'switch'` for a check whose newer run replaces the older; `'queue'` for writes that go in order (the save).
- Worked example: `src/app/update/version.ts`.

## Subscriptions and Mounts

- A Subscription is `Subscription.make(name, deps, () => stream)` (or `HtmlSubscription.*`: `onAnimationFrame`, `shortcuts`, document events, see `25_document-events.ts`), listed by `subscriptions: ({ model }) => [...]` with `cond && sub` for one that runs only while something holds.
- A Mount is `Mount.make(name, { args }, (node, args) => effect)` or `Mount.makeStream(...)`, placed with `.onMount(X(args))`. There is no `pointerup` or `pointermove` element event: a Mount listens for those.

## Views

- `h` is `Html.H<Message>`; a view returns `View.Content<Message>`. The root's aliases are `ApplicationViewBuilder` (`Html.H<Message>`) and `ApplicationHtml` (`View.Content<Message>`) in `src/app/definition.ts`; a feature imports them with `import type`, the one exception `munch/folder-imports` allows.
- Elements chain: `h.button.class('a', cond && 'b').attr('aria-label', x).attrs({...}).on('click', Message.X()).style({ camelCase: v }).id(id).key(k).disabled(b).value(v).onMount(M(args)).children(...)`; `h.p('text')` is `.children('text')`. `null`, `false`, and `undefined` render nothing.
- An attribute helper that returned Foldkit's attribute array becomes a decorator that takes the builder and returns it, as ui-kit's parts do: `const homeButton = <B extends HomeButtonBuilder>(b: B, button: HomeButton): B => b.id(...).attr(...)`, called `homeButton(h.button, 'Play').children(...)`.
- `h.lazy(view, ...args)` keeps a subtree that changes rarely (the menus) from being rebuilt every frame. The root view runs every frame, so any subtree that depends only on menu state goes through it.
- A modal is a native `<dialog>` the Model opens: `h.dialog.modal(isOpen).on('cancel', Closed()).on('close', Closed())` ("Who owns the state"). Tabs, radio groups, and other kit parts come from `@effect/ui-kit` where a plain element won't do.
- Kebab-case style keys become camelCase.

## Children

Props down, events up, no requests from parent to child ("Who owns the state", "Composition"):

- **The root owns what the root reads.** State that a root rule, `menuState`, the save, or a root test reads stays on the root's Model (a dialog's `isOpen`, whether the lobby is up, the co-op room). A child component gets it as props and asks for a change with an event; the root's handler applies the change.
- **A component owns what only it reads**: the Munchopedia's page, the guide's section, a picked slot, a tab, the Look tab's section. That state is the component's Model, its tests are its own Story and Scene.
- `requestOpen` becomes the root drawing the child or changing its props (or its `key`, to start it afresh); `informOf*` becomes a prop; `requestPressKey` becomes the child's own key Subscription (`HtmlSubscription.shortcuts`) or a root key handler.
- A child's events say what happened (`Picked`, `RequestedClose`, `RolledNameDice`); the parent maps them in `onEmit` to its own Messages, named verb first in the past tense after the child: `PickedLobbyHero`, `RequestedCloseHeroPicker`.
- A component is `XDef = Html.component({ name, props, model, message, events })`, finished `XNoDeps = XDef.make({...})`, and `X = XNoDeps.pipe(Component.provide(...))` when it runs Commands needing services. Its file names are Foldkit's: `block.ts` (now the component), `model.ts`, `message.ts`, `update.ts`, `view.ts`; `inMessage.ts`, `inMessageUpdate.ts`, `composition.ts`, `layer.ts`, and `bindings.ts` are deleted.
- Co-op's room is lifted to the root: its Messages join the root's union as a group, its Commands and Subscriptions become the root's, and its views are view functions over the root's `h`.

## Tests

- A Story is `const s = yield* Story.make(Component, props)` inside `it.effect(..., () => Effect.gen(function* () {...}))`, then `s.given(model)`, `s.send(message)`, `s.resolve(Command, message)`, `s.expectExact(...)`, `s.model`, `s.emitted(event)`, `s.childEmit(Child, event)`. A Scene is `HtmlScene.make(...)` from `@effect/ui/html/testing`. See `50_testing.ts`.
- Strict: a message step throws while a concurrent Command is pending, unless the Command's mode is `switch` or `queue` or the step says `keepPending`.
- The shared steps in `src/test/testing.ts` become functions over the cursor.

## Drawing

No 2D canvas anywhere. The world is the 3D `<munch-world>`; the HUD and overlay that `Canvas.view` drew are painted by Pixi through the `Draw` shapes (`src/render/draw.ts`), in a Mount. Sprite textures load from the atlas or a data URL straight into Pixi; nothing reads pixels back through a 2D context.

## Dialogs

A root menu dialog is ui-kit's `Dialog` through `dialogShellView` (`src/ui/dialog.ts`), open while the root's `rootDialog` machine (`src/app/rootDialog.ts`) holds it: Shut, or the one dialog up. Open one with `openRootDialog(name)` and close it with `closeRootDialog(name)` from `src/app/update/dialog.ts`; a close the dialog asks for arrives as `ClosedDialog({ dialog })`. Its insides take the kit's parts, `DialogParts`, in place of Foldkit's `Dialog.RenderInfo`:

| Foldkit `renderInfo`                       | ui-kit part                   |
| ------------------------------------------ | ----------------------------- |
| `h.h2.TODO_ATTR(...renderInfo.title)`      | `parts.title(h.h2)`           |
| `h.p.TODO_ATTR(...renderInfo.description)` | `parts.description(h.p)`      |
| `...renderInfo.closeButton` on a button    | `parts.close(h.button)`       |
| `...renderInfo.initialFocus`               | `parts.initialFocus(builder)` |

A child component's own dialog (the solo lobby's hero Dialog) is ui-kit's `Dialog` in the child's view, open on a prop or the child's Model. Content a parent puts inside a child (the menu panel's Done button inside the Munchopedia and the Proof Shelf) is a slot: the child declares `slots: ['done']` and places `h.slots.done` (`ai-docs/src/10_ui/fixtures/kit/Collapsible.ts`).

## Decorators

A Foldkit attribute helper becomes a part that takes a builder and returns it, typed as the kit types its parts: `<B extends View.PartTarget<'button'>>(b: B, ...): ReturnType<B['attr']>`, built from `b.attr(...)`, `.attrs({...})`, `.on(...)` (each returns the builder). `h.Style({ '--i': '1' })` becomes `.style({ '--i': '1' })` (custom properties keep their names), and other style keys become camelCase.

## The parallel conversion

The leaves are converted by several agents at once, each owning a disjoint set of files. Rules for each agent:

- Edit only the files you own. Never edit `src/app/main.ts`, `src/app/layer.ts`, `src/app/block.ts`, `src/app/entry.ts`, `src/app/definition.ts`, `src/app/update/step.ts`, `src/app/update/dialog.ts`, `src/app/dialogs.ts`, or `src/ui/dialog.ts`: list what they need in your report instead.
- `src/app/model.ts` and `src/app/message.ts` are shared: change only your own fields or Message group, with the Edit tool, reading the file again just before each edit.
- Leave tests (`__tests__/`, `*.test.ts`) alone: they are ported later. Do not run `bun run test`, `build`, `lint`, or any heavy job. Typecheck only, filtered to your files.
- No git commands that change the tree, the index, or the stash.
- Keep behavior exactly as it is. Where Foldkit's shape has no direct translation, choose what the Effect UI guides recommend and say so in the report.
- Report: the handler records to spread into `ApplicationDef.update` in `main.ts`, every `Command.Service` class whose `.layer` joins `CommandsLayer`, every root Subscription and Mount added or changed, Model fields and Message groups added or removed, files deleted, and anything left undone with its reason.

### Shared contracts

- **The hero picker** (`src/features/heroes/block.ts`, bound by the solo lobby and by co-op): a component `HeroPicker` with props `{ look: Appearance, chosen: Calling, trying: Calling | null, rank, bought: SavedBoughtCosmetics, bones, fresh: ReadonlyArray<string>, layout: 'Panel' | 'Overlay' }`, events `Picked({ calling })`, `RequestedBuy({ calling })`, `RequestedClose()`, and its own close keys as a Subscription (`spikes/effect-ui/src/heroes/HeroPicker.ts` is the model). The parent owns whether it is drawn, the hero tried on, and every rule; it holds no state.
- **The Munchopedia** (`src/features/munchopedia/block.ts`): component `Munchopedia`, props `{ page: MunchopediaPage, journal, mastery, proof, fresh, killsByKind, openedEntries, seenUnlocks, screenMs }`, events `ChangedPage({ page })` and `OpenedEntry({ kind })`, slot `done`. The page is the root's (`munchopediaPage`); the guide's state is its own.
- **The Proof Shelf** (`src/features/proof/block.ts`): component `ProofShelf`, props `{ proof, things, stampedDays, maybeToday, fresh, dareMarks }`, no events, slot `done`; the slot picked is its Model, and its arrow keys are its own Subscription. It mounts afresh each time the panel opens on it.
- **The audio engine** is a service (`AudioEngine`), and a sound is a Command on it; a feature's Step names the sound Command, never the engine.
- **A Step another agent owns** keeps its name and arguments: a Step value (`tapSound`, `unlockAudio`, `releaseInput`) is an `UpdateStep`, a factory (`playSounds(cues)`, `openRootDialog(name)`) returns one, and a Foldkit dual Step `(model, x) => Return` becomes the factory `(x) => UpdateStep`. Call it as that, even while its module is still being converted.

## Porting a test

A test is `it.effect('...', () => Effect.gen(function* () { ... }))` from `@effect/vitest`, and every Story or Scene is yielded: the end check (nothing pending, every Mount and event acknowledged) runs as the test's scope closes. The shared steps are in `src/test/testing.ts` (Stories) and `src/test/sceneTesting.ts` (Scenes). Each one is a function of the cursor, `(s) => s`, and `steps(a, b, ...)` runs several as one. The six tests ported first are worked examples: `src/app/__tests__/story.test.ts`, `src/features/heroes/__tests__/heroBuy.story.test.ts`, `src/world/gear/__tests__/traps.story.test.ts`, `src/features/onlineRun/__tests__/coopAnalytics.story.test.ts`, `src/features/hud/__tests__/mobileHud.scene.test.ts`, and `src/features/lobby/__tests__/story.test.ts`.

### Stories

| Foldkit                                            | Effect UI                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Story.story(APPLICATION, Story.given(m), a, b)`   | `const s = yield* storyOf(m)`, then `steps(a, b)(s)`, or `yield* modelAfter(m, steps(a, b))` for the Model it leaves       |
| `Story.given(m)` with no audio asked               | `exactStoryOf(m)` (and `exactSceneOf(m)`): `storyOf` and `sceneOf` start with the audio asked for, as Foldkit's helper did |
| `Story.message(msg)`                               | `send(msg)`, or `s.send(msg)`                                                                                              |
| `Story.model(m => expect(...))`                    | `checkModel(m => expect(...))`, or read `s.model` after the steps                                                          |
| `Story.Command.expectExact(X(args))`               | `s.expectExact(X.make(args))`; `s.expectNone()` for nothing pending                                                        |
| `Story.Command.resolve(X(args), Msg)`              | `s.resolve(X.make(args), Msg)`, or `s.resolve(X, Msg)` for the oldest pending `X`                                          |
| a Command that reports nothing                     | `s.resolve(X, Component.noop)`                                                                                             |
| `Story.Command.resolveAll(X, Msg)`                 | `resolveAll(X)(Msg)`, which also passes with none pending                                                                  |
| reading a pending Command's args                   | `checkPendingArgs(X)(args => ...)`, or `pendingArgsOf(X)(s.pending)`                                                       |
| `messageIn(binding, ...)`, a Block's bound Message | the root's own Message: co-op's are flat in its group, the lobby's are `LobbyMessage.*` (`PickedLobbyMode`, ...)           |

A `switch` or `queue` Command may stay pending across steps, but the Story still ends with it resolved: `writeSave` and `settleRunCommands` resolve the usual ones. The shared steps keep their names: `tick`, `ticks(n)`, `press(code)`, `release(code)`, `tap(code)`, `finishSplash`, `openLobbyByKey`, `startRunFromHome`, `recordTicks`.

### Focus and dialogs

- **Focus.** Foldkit's focus Command is now a root Command the Story resolves: `resolveFocusLobby(control = 'Start')` resolves `FocusLobbyControl`, `resolveFocusCoop` resolves `HtmlCommand.Focus` with `{ found: true }`, and leaving the lobby issues `FocusHomeButton`, resolved with `Component.noop`. `foldLobby` and `tapLobbyHero` stay.
- **Dialogs in a Story.** There are no Show and Close Commands left to resolve: a root dialog opens in the Model (`openRootDialog`), so the old `showDialog` and `closeDialog` steps are gone. A close the dialog asks for is `send(Message.ClosedDialog({ dialog: 'Profile' }))`; `closeProfile` is that step.
- **Dialogs in a Scene.** ui-kit's Dialog draws its panel only once its own Model is mounted, which its Mount sets on the page and a Scene never runs. `showDialog(id)` gives it that Model; `requestDialogClose(id, reason)` sends its `RequestedClose` event (`'escape-key'`, `'close-press'`, ...) and hides it again. A click on its close part throws in a Scene, so use this instead. The ids are in `src/domain/clientSchema.ts` (`PROFILE_DIALOG_ID`, `PANEL_DIALOG_ID`, `HAND_DIALOG_ID`, `HOME_SCREEN_STEPS_ID`, `UPDATE_GREETING_ID`).

### Children

A child component is a leaf in its parent's Story and Scene: its insides are not drawn there. Test what it draws and sends on its own, `yield* HtmlScene.make(Child, props)` or `yield* Story.make(Child, props)` with `s.send(m).emitted(Event)`; a Block's `OutMessage` is now one of its `Events`. Test the parent's rule by sending the root Message the event maps to. For a child drawn as the root draws it, build its props with the root's own function (`profilePropsOf(model)` in `src/app/profileView.ts`), from a Model a Story left (`modelAfter`).

### Scenes

| Foldkit                               | Effect UI                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Scene.selector('.x')`                | `byClass('x')`, or `withAttrs({ ... })`                                                                       |
| `Scene.role('button', { name })`      | `HtmlLocator.role('button', { name })`: it must match exactly one element; `firstOf(locator)` takes the first |
| a role under an `aria-hidden` subtree | `HtmlLocator.role(role, { name, hidden: true })` (the home menu under the lobby, the install guide's list)    |
| `Scene.within(a, b)`, `Scene.inside`  | `Locator.inside(a, b)`                                                                                        |
| `toHaveAttr(l, name, value)`          | `expectAttr(l, name, value)`, `undefined` for absent                                                          |
| `toHaveStyle(l, property, value)`     | `expectStyle(l, property, value)`                                                                             |
| `toHaveClass(l, name)`                | `expectClass(l, name)`                                                                                        |
| `toContainText(l, text)`              | `s.expect(l).toHaveText(/text/)`                                                                              |
| `Scene.click(l)`                      | `s.click(l)`                                                                                                  |

A Scene acknowledges every Mount it draws before its next step. The game surface's are steps: `measureSurface` (or `measureSurfaceAs({ left, top, width, height })`) and `pressSurface({ pointerId, device, clientX, clientY })`; the HUD's gun slots are `measureHud`, `ackHudSlots` (again after a wave starts, which mounts them anew), and `pressHudSlot({ slot, pointerId, device })`; `pauseByButton` taps pause and acknowledges the surface's press Mount. A Subscription's Message is `fromSubscription(name, message)`, with `emitPressedKey(code)` and `emitFrame(deltaTime?)` for the keys and the frame.

`src/test/viewReading.ts` reads Effect UI's view nodes (`Locator.Node`): `nodesOf`, `rectsOf`, and `imagesIn`.
