// Shared steps, locators, and builders for Story and Scene tests: what a test
// does to the game, and the zombies, bullets, and guns it puts in. Named
// Models live in `model.fixture.ts`. `tools/lint/duplicateHelpers.ts`
// fails a helper copied between test files: add it here instead.
//
// A step is a function of Effect UI's cursor that returns it, so steps
// chain with `pipe`: `s.pipe(press('KeyD'), ticks(10, FRAME_MS))`. A Story
// step takes an `AppStory` (it sends Messages and reads `s.model`), a Scene
// step an `AppScene` (it clicks, fires, and delivers through the root's
// Subscriptions and Mounts), and a step for both (`RootStep`) only resolves
// Commands or checks. See "Porting a test" in docs/EFFECT_UI_PORT.md.

import {
  Array,
  Effect,
  Function,
  Option,
  Schema,
  type Scope,
  Struct,
} from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
import { HtmlCommand } from '@effect/ui/html'
import { HtmlScene } from '@effect/ui/html/testing'
import { type Steps, Story } from '@effect/ui/testing'

import { ApplicationNoDeps } from '../app/block'
import {
  AwaitFirstFrame,
  DecodeSprites,
  DetectInputDevice,
  DetectLocalPlayers,
  DetectOrientationLock,
  DetectScreenFit,
  DetectShareSheet,
  GenerateSeed,
  LoadFonts,
  LoadSave,
  LoadStyles,
  ReadRecordUnlock,
  ReadUpdateMarker,
  StartRecordingQueue,
  StartSummaryQueue,
} from '../app/boot'
import { Message } from '../app/message'
import {
  AudioState,
  type Bullet,
  Frenzy,
  GameEvent,
  type Model,
  Phase,
  Pierce,
  type RunStats,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '../app/model'
import { ReadBeatLink } from '../app/update/beatMyRun'
import { ReadRoomLink } from '../app/update/coop'
import { FocusLobbyControl, FoldLobby } from '../app/update/lobby'
import { CueMusic } from '../app/update/music'
import { HideSplash, ShowLoadProgress, WriteSave } from '../app/update/save'
import { SendRunSummary } from '../app/update/settle'
import { PlayPlaced, PlaySound } from '../app/update/sound'
import type { SoundEffect } from '../audio/audio'
import { SoundMessage } from '../audio/message'
import { ChangeLobby } from '../features/coop/steps'
import { RememberRoom } from '../features/coop/update'
import {
  GATE_MS,
  isPocketCardHeld,
  isPocketCardReading,
} from '../features/dare/pocketCard'
import { LobbyMessage } from '../features/lobby/message'
import type { LobbyControl } from '../features/lobby/model'
import {
  type HintId,
  LESSON_MIN_SHOWN_MS,
  shownHints,
} from '../features/onboarding/onboarding'
import { LoadMessage, SaveMessage } from '../platform/message'
import { floorToScreenDirection } from '../render/lens'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  RESTART_GRACE_MS,
  SCORE_PER_ZOMBIE,
  STICK_RADIUS_PX,
  ZOMBIE_MAX_HP,
} from '../shared/constants'
import { hypot } from '../shared/detMath'
import type { Calling } from '../shared/playerData'
import { FRIDGE_RULES } from '../world/fridge/leftovers'
import { TRAPS } from '../world/gear/traps'
import { START_LEVEL, levelOf } from '../world/level/arena'
import { KITCHEN_EXIT } from '../world/level/exits'
import type { Clearance } from '../world/level/pathing'
import { SLAM_MS } from '../world/run/arrival'
import { World } from '../world/schema/world'
import { Trap } from '../world/schema/worldSchema'
import { PURCHASE_RULES } from '../world/shop/purchase'
import { stepWorld } from '../world/step/stepWorld'
import { ZOMBIE_KINDS } from '../world/zombies/zombies'

// NOTE: the score is read from the kills, so a test that wants a score
// gives the run that many points of Groaners.
export const scoring =
  (score: number) =>
  (stats: RunStats): RunStats => ({
    ...stats,
    kills: {
      ...stats.kills,
      Shambler: stats.kills.Shambler + score / SCORE_PER_ZOMBIE,
    },
  })

// NOTE: any value as JSON, for a test that writes a save or compares two
// values by what they hold.
const encodeJson = Schema.encodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
)

export const jsonOf = (value: unknown): string =>
  Option.getOrThrow(encodeJson(value))

export const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

export const WIDE_SURFACE = { left: 0, top: 0, width: 1280, height: 720 }

// NOTE: a phone held sideways and held upright.
export const PHONE_LANDSCAPE = { left: 0, top: 0, width: 844, height: 390 }

export const PHONE_PORTRAIT = { left: 0, top: 0, width: 390, height: 844 }

export const isPausedPhase = (current: Model): boolean =>
  Phase.isAnyOf(['Paused'])(current.phase)

// THE ROOT UNDER TEST

// NOTE: the root component as a Story and a Scene take it, with no props:
// `yield* Story.make(APPLICATION, {})`. Its Commands never run in a test,
// so it needs none of their services.
// NOTE: a component is a function Effect UI makes, with no data-last form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const APPLICATION = ApplicationNoDeps

// NOTE: the cursors over the root, and a step on each: a Story step sends
// Messages and reads the Model, a Scene step drives the view. A `RootStep`
// works in both, since it only uses what every cursor has (resolve, given,
// subscription, check).
export type AppStory = Story.Steps<typeof ApplicationNoDeps>

export type AppScene = HtmlScene.Steps<typeof ApplicationNoDeps>

export type StoryStep = (s: AppStory) => AppStory

export type SceneStep = (s: AppScene) => AppScene

export type RootStep = <S extends Steps.Steps<typeof ApplicationNoDeps>>(
  s: S,
) => S

// NOTE: a group of root Story steps held as a value apart from the Story
// it goes into, such as a table's row.
export type RootSteps = StoryStep

// NOTE: steps run one after another, as one step: the old `Story.steps(...)`.
export const steps =
  <S>(...each: ReadonlyArray<(s: S) => S>) =>
  (s: S): S =>
    Array.reduce(each, s, (current, step) => step(current))

// NOTE: the first key, tap, or click asks for the audio engine
// (AcquireAudioEngine, src/app/update/sound.ts), a Command every Story would
// have to resolve. A Model whose audio is still Locked is given as one
// already asking (Unlocking), the state the old Stories stayed in, so a
// press asks for nothing and no sound plays. A test about the unlock itself
// starts from `exactStoryOf`.
export const withAudioAsked = (model: Model): Model =>
  AudioState.isAnyOf(['Locked'])(model.audio)
    ? UiStruct.evolve(model, { audio: () => AudioState.Unlocking() })
    : model

// NOTE: a Story of the root started from `model` as it is, with init's
// Commands dropped (`given` before any acting step replaces init). Scoped:
// the end check (nothing pending) runs when the test's scope closes.
export const exactStoryOf = (
  model: Model,
): Effect.Effect<AppStory, never, Scope.Scope> =>
  Effect.map(Story.make(APPLICATION, {}), s => s.given(model))

// NOTE: a Story of the root started from `model` with its audio asked for
// (`withAudioAsked`): where nearly every Story starts.
export const storyOf = (
  model: Model,
): Effect.Effect<AppStory, never, Scope.Scope> =>
  exactStoryOf(withAudioAsked(model))

// NOTE: the same for a Scene, `exactSceneOf` with the Model as it is.
export const exactSceneOf = (
  model: Model,
): Effect.Effect<AppScene, never, Scope.Scope> =>
  Effect.map(HtmlScene.make(APPLICATION, {}), s => s.given(model))

export const sceneOf = (
  model: Model,
): Effect.Effect<AppScene, never, Scope.Scope> =>
  exactSceneOf(withAudioAsked(model))

// NOTE: the Model a Story's steps leave from `model`, in a scope of its
// own, so its end check runs before the Model is handed back: a step left
// pending fails it.
export const modelAfter: {
  (step: StoryStep): (model: Model) => Effect.Effect<Model>
  (model: Model, step: StoryStep): Effect.Effect<Model>
} = Function.dual(2, (model: Model, step: StoryStep): Effect.Effect<Model> =>
  Effect.scoped(Effect.map(storyOf(model), s => step(s).model)),
)

// STORY STEPS

export const send =
  (message: Message): StoryStep =>
  s =>
    s.send(message)

export const tick =
  (deltaTime: number): StoryStep =>
  s =>
    s.send(Message.TickedFrame({ deltaTime }))

const repeat =
  (count: number, step: StoryStep): StoryStep =>
  s => {
    for (let index = 0; index < count; index += 1) {
      step(s)
    }
    return s
  }

export const ticks: {
  (deltaTime: number): (count: number) => StoryStep
  (count: number, deltaTime: number): StoryStep
} = Function.dual(2, (count: number, deltaTime: number): StoryStep =>
  repeat(count, tick(deltaTime)),
)

// NOTE: START WAVE, the break's button that starts the wave now.
export const startWave: StoryStep = send(Message.ClickedStartWaveButton())

export const press = (code: string): StoryStep =>
  send(Message.PressedKey({ code }))

export const release = (code: string): StoryStep =>
  send(Message.ReleasedKey({ code }))

export const tap = (code: string): StoryStep =>
  steps(press(code), release(code))

const FIRE_THUMB = 70

// NOTE: a thumb that lands on the aim stick and pushes it all the way to
// the right, the way a player faces at the start, so the trigger pulls
// (src/input/input.ts, the fire zone).
export const FIRE_PRESS = Message.PressedPointer({
  pointerId: FIRE_THUMB,
  device: 'Touch',
  clientX: 600,
  clientY: 200,
})

// NOTE: the aim stick pushed all the way toward a direction on the floor:
// the way the screen shows it through the lens (src/render/lens.ts), so the
// shot flies that way on the floor.
const firePushToward = (direction: Vector) => {
  const onScreen = floorToScreenDirection(direction)
  const length = Math.max(1e-9, hypot(onScreen.x, onScreen.y))
  return Message.MovedPointer({
    pointerId: FIRE_THUMB,
    clientX: 600 + (onScreen.x / length) * STICK_RADIUS_PX,
    clientY: 200 + (onScreen.y / length) * STICK_RADIUS_PX,
  })
}

export const FIRE_PUSH = firePushToward({ x: 1, y: 0 })

export const holdFireToward = (direction: Vector): StoryStep =>
  steps(send(FIRE_PRESS), send(firePushToward(direction)))

export const holdFire = holdFireToward({ x: 1, y: 0 })

export const FIRE_LIFT = Message.ReleasedPointer({ pointerId: FIRE_THUMB })

export const releaseFire: StoryStep = send(FIRE_LIFT)

export const touchDown: {
  (clientX: number, clientY: number): (pointerId: number) => StoryStep
  (pointerId: number, clientX: number, clientY: number): StoryStep
} = Function.dual(
  3,
  (pointerId: number, clientX: number, clientY: number): StoryStep =>
    send(
      Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
    ),
)

export const touchMove: {
  (clientX: number, clientY: number): (pointerId: number) => StoryStep
  (pointerId: number, clientX: number, clientY: number): StoryStep
} = Function.dual(
  3,
  (pointerId: number, clientX: number, clientY: number): StoryStep =>
    send(Message.MovedPointer({ pointerId, clientX, clientY })),
)

export const mouseDown: {
  (clientY: number): (clientX: number) => StoryStep
  (clientX: number, clientY: number): StoryStep
} = Function.dual(2, (clientX: number, clientY: number): StoryStep =>
  send(
    Message.PressedPointer({
      pointerId: 1,
      device: 'Mouse',
      clientX,
      clientY,
    }),
  ),
)

// NOTE: the frames, of `frameMs` each, that play `ms` of game time.
export const ticksFor: {
  (frameMs: number): (ms: number) => StoryStep
  (ms: number, frameMs: number): StoryStep
} = Function.dual(2, (ms: number, frameMs: number): StoryStep =>
  ticks(Math.round(ms / frameMs), frameMs),
)

// NOTE: how many fixed-step frames it takes to play at least `ms`.
export const tickCountFor = (ms: number): number =>
  Math.ceil(ms / FIXED_STEP_MS)

// NOTE: the ticks a countdown of `ms` takes to run out, counted the way the
// game counts it down: whole ticks of 1000/60 ms sum a hair short of a
// round number, so 800 ms takes 49 ticks, not 48.
export const countdownTicks = (ms: number): number =>
  ms <= 0 ? 0 : 1 + countdownTicks(ms - FIXED_STEP_MS)

// NOTE: fixed-step frames until the fridge's door is open.
export const FRIDGE_OPEN_TICKS =
  Math.ceil(FRIDGE_RULES.openMs / FIXED_STEP_MS) + 1

// NOTE: fixed-step frames that hold a stand-to-buy prompt until it buys.
export const HOLD_TICKS = Math.ceil(PURCHASE_RULES.holdMs / FIXED_STEP_MS) + 1

// NOTE: Enter held for `count` fixed-step frames, then let go: a hold to
// buy at whatever purchasable the player stands at.
export const holdEnter = (count: number): StoryStep =>
  steps(press('Enter'), ticks(count, FIXED_STEP_MS), release('Enter'))

// NOTE: Enter held at a purchasable until the hold buys, then let go.
export const holdToBuy: StoryStep = holdEnter(HOLD_TICKS)

// NOTE: fixed-step frames that stand the player at a counter long enough for
// its prompt to come up.
export const STAND_TICKS = Math.ceil(PURCHASE_RULES.standMs / FIXED_STEP_MS) + 1

// NOTE: 50 ms frames that keep a lesson's hint up for its shortest time.
export const SHOWN_TICKS = Math.ceil(LESSON_MIN_SHOWN_MS / 50)

// NOTE: 50 ms frames past the grace after a run ends, when a key or tap
// restarts.
export const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / 50)

// NOTE: a Story step that sends the Message `choose` picks from the Model it
// finds when the step runs, or nothing, for a sim whose players act on what
// they see: the bots that press READY in a break, aim at the nearest
// zombie, or let go of a key they hold.
export const messageIfAny =
  (choose: (current: Model) => Option.Option<Message>): StoryStep =>
  s =>
    Option.match(choose(s.model), {
      onNone: () => s,
      onSome: message => s.send(message),
    })

// NOTE: a change to the Model in the middle of a Story, as `given` makes one
// at its start, for a sim whose rule is its own and not the game's: every
// heart full again after each frame, or every zombie gone the frame it
// walks in. No Message makes it, so no handler runs. It throws while a
// Command is pending: settle them first.
export const changeModel =
  (change: (current: Model) => Model): StoryStep =>
  s =>
    s.given(change)

// NOTE: a check on the Model where the step stands, the old
// `Story.model(check)`.
export const checkModel =
  (check: (current: Model) => void): StoryStep =>
  s => {
    check(s.model)
    return s
  }

// Ticks that push each frame's Model onto `frames`, for tests that look at a
// whole fight after it is played.
export const recordTicks: {
  (deltaTime: number, frames: Array<Model>): (count: number) => StoryStep
  (count: number, deltaTime: number, frames: Array<Model>): StoryStep
} = Function.dual(
  3,
  (count: number, deltaTime: number, frames: Array<Model>): StoryStep =>
    repeat(count, s => {
      s.send(Message.TickedFrame({ deltaTime }))
      frames.push(s.model)
      return s
    }),
)

export const blastFrames = (
  frames: ReadonlyArray<Model>,
): ReadonlyArray<Model> =>
  Array.filter(frames, ({ frameEvents }) =>
    Array.some(frameEvents, GameEvent.guards.Exploded),
  )

// THE INTRO

// NOTE: past the intro a run opens on (src/world/run/arrival.ts): a key
// skips it to the slam, and the slam's frames play out to the first break,
// which starts on the last of them.
export const SLAM_FRAMES = SLAM_MS / MAX_FRAME_DELTA_MS

// NOTE: the dare card from the slam (src/features/dare/pocketCard.ts) read:
// frames until it takes a key, then a key. Endless has no card.
export const GATE_FRAMES = Math.ceil(GATE_MS / MAX_FRAME_DELTA_MS)

const whileCard =
  (isDue: (current: Model) => boolean) =>
  (step: StoryStep): StoryStep =>
  s =>
    isDue(s.model) ? step(s) : s

const cardOpenFrames: StoryStep = repeat(
  GATE_FRAMES,
  whileCard(isPocketCardHeld)(tick(MAX_FRAME_DELTA_MS)),
)

// NOTE: a touch thumb's tap on the surface.
const TOUCH_DOWN = Message.PressedPointer({
  pointerId: 9,
  device: 'Touch',
  clientX: 0,
  clientY: 0,
})

const TOUCH_UP = Message.ReleasedPointer({ pointerId: 9 })

const readDareCard: StoryStep = steps(
  cardOpenFrames,
  whileCard(isPocketCardReading)(press('Escape')),
)

// NOTE: the same by a tap, so a touch player stays on touch.
const readDareCardByTap: StoryStep = steps(
  cardOpenFrames,
  whileCard(isPocketCardReading)(steps(send(TOUCH_DOWN), send(TOUCH_UP))),
)

export const throughIntro: StoryStep = steps(
  press('Escape'),
  ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCard,
)

// NOTE: the same by a tap, so a touch player stays on touch.
export const throughIntroByTap: StoryStep = steps(
  send(TOUCH_DOWN),
  send(TOUCH_UP),
  ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCardByTap,
)

// COMMANDS

// NOTE: the args of a pending Command, typed by its definition's args
// Schema, for a test about a few of them.
type ArgsDefinition = Command.Definition.Any & Readonly<{ args: Schema.Top }>

const isArgsOf =
  <D extends ArgsDefinition>(definition: D) =>
  (args: unknown): args is Command.Definition.Args<D> =>
    Schema.is(definition.args)(args)

type PendingCommand = AppStory['pending'][number]['command']

const isIssuedBy =
  (definition: Command.Definition.Any) =>
  (command: PendingCommand): boolean =>
    command.name === Command.nameOf(definition)

export const pendingArgsOf =
  <D extends ArgsDefinition>(definition: D) =>
  (
    pending: ReadonlyArray<Readonly<{ command: PendingCommand }>>,
  ): ReadonlyArray<Command.Definition.Args<D>> =>
    Array.filter(
      Array.map(
        Array.filter(pending, ({ command }) => isIssuedBy(definition)(command)),
        ({ command }) => command.args,
      ),
      isArgsOf(definition),
    )

// NOTE: a step that hands the args of every pending Command `definition`
// issued to a check, and leaves them pending, for a test about a few of a
// Command's args, where `expectExact` would need the whole value:
// `checkPendingArgs(WriteSave)(writes => ...)`.
export const checkPendingArgs =
  <D extends ArgsDefinition>(definition: D) =>
  (check: (args: ReadonlyArray<Command.Definition.Args<D>>) => void) =>
  <S extends Steps.Steps<typeof ApplicationNoDeps>>(s: S): S => {
    check(pendingArgsOf(definition)(s.pending))
    return s
  }

const countPending = (
  pending: ReadonlyArray<Readonly<{ command: PendingCommand }>>,
  definition: Command.Definition.Any,
): number =>
  Array.length(
    Array.filter(pending, ({ command }) => isIssuedBy(definition)(command)),
  )

// NOTE: resolves every pending Command `definition` issued, oldest first,
// with `result`.
const resolveEvery =
  <D extends Command.Definition.Any>(
    definition: D,
    result: Command.Result<D>,
  ): RootStep =>
  s => {
    const count = countPending(s.pending, definition)
    for (let index = 0; index < count; index += 1) {
      s.resolve(definition, result)
    }
    return s
  }

// NOTE: the same as a step, none at all included (Foldkit's
// `Story.Command.resolveAll`): `resolveAll(SendRunSummary)(Component.noop)`.
export const resolveAll =
  <D extends Command.Definition.Any>(definition: D) =>
  (result: Command.Result<D>): RootStep =>
    resolveEvery(definition, result)

export const writeSave: RootStep = s =>
  s.resolve(WriteSave, SaveMessage.CompletedWriteSave())

// NOTE: a sound played, reporting nothing (only a sound dropped under a
// suspended engine reports, src/app/update/sound.ts).
export const resolvePlayed: RootStep = s => s.resolve(PlaySound, Component.noop)

// NOTE: a step that hands the sounds the pending Commands would play (a
// placed one's too, such as a leak's drip) to a check, then plays them, for
// a frame whose sounds' variations hang on where they happen, so no exact
// Command can be named.
export const checkPendingSounds =
  (check: (sounds: ReadonlyArray<SoundEffect>) => void): RootStep =>
  s => {
    check([
      ...Array.map(pendingArgsOf(PlaySound)(s.pending), ({ sound }) => sound),
      ...Array.map(pendingArgsOf(PlayPlaced)(s.pending), ({ sound }) => sound),
    ])
    resolveEvery(PlaySound, Component.noop)(s)
    return resolveEvery(PlayPlaced, Component.noop)(s)
  }

// NOTE: plays whatever sounds the last frame left pending.
export const playPendingSounds: RootStep = checkPendingSounds(
  Function.constVoid,
)

// NOTE: completes every sound, music cue, and save write left pending, each
// with what its handler answers on success, for a Story that plays many
// frames of a run (a whole wave, a replay) and is about the World, not its
// Commands. Any other pending Command stays, so the Story still fails on
// one it did not expect.
export const settleRunCommands: RootStep = s => {
  resolveEvery(PlaySound, Component.noop)(s)
  resolveEvery(PlayPlaced, Component.noop)(s)
  resolveEvery(CueMusic, Component.noop)(s)
  return resolveEvery(WriteSave, SaveMessage.CompletedWriteSave())(s)
}

// NOTE: a sound dropped while the engine was suspended, the one sound
// result that changes the Model.
export const droppedSound = (sound: SoundEffect) =>
  SoundMessage.CompletedPlaySound({ sound, outcome: 'DroppedWhileSuspended' })

// NOTE: the boot splash's last Commands once the save is read: the load
// bar fills, the splash goes, and no room link or SHARE link is waiting.
export const finishSplash: RootStep = s =>
  s
    .resolve(ShowLoadProgress.make({ loaded: 5, total: 5 }), Component.noop)
    .resolve(HideSplash, LoadMessage.CompletedHideSplash())
    .resolve(
      ReadRoomLink,
      Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
    )
    .resolve(
      ReadBeatLink,
      Message.CompletedReadBeatLink({ maybeDare: Option.none() }),
    )

// NOTE: every Command init starts but the visit id, answered as a desktop
// with one player, no share sheet, no update waiting, and no save, with
// the load bar, the splash, and the room link they lead to, for a Story
// from `Story.make` with no `given`, about something other than the boot
// itself (src/features/home/__tests__/menu.story.test.ts walks the boot
// step by step).
export const bootWithoutVisitId: RootStep = s => {
  s.resolve(GenerateSeed, Message.CompletedGenerateSeed({ seed: 1 }))
    .resolve(StartSummaryQueue, Component.noop)
    .resolve(
      ReadRecordUnlock,
      Message.CompletedReadRecordUnlock({ unlock: 'Locked' }),
    )
    .resolve(StartRecordingQueue, Component.noop)
    .resolve(
      DetectInputDevice,
      Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
    )
    .resolve(
      DetectShareSheet,
      Message.CompletedDetectShareSheet({ shareSheet: 'Unavailable' }),
    )
    .resolve(
      DetectScreenFit,
      Message.CompletedDetectScreenFit({ screenFit: 'Unknown' }),
    )
    .resolve(
      DetectOrientationLock,
      Message.CompletedDetectOrientationLock({
        orientationLock: 'Unsupported',
      }),
    )
    .resolve(
      DetectLocalPlayers,
      Message.CompletedDetectLocalPlayers({ count: 1 }),
    )
    .resolve(
      ReadUpdateMarker,
      Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
    )
    .resolve(LoadStyles, Message.CompletedLoadStyles())
    .resolve(LoadFonts, Message.CompletedLoadFonts())
    .resolve(AwaitFirstFrame, Message.CompletedAwaitFirstFrame())
    .resolve(DecodeSprites, Message.CompletedDecodeSprites())
    .resolve(LoadSave, Message.CompletedLoadSave({ maybeSave: Option.none() }))
  resolveEvery(ShowLoadProgress, Component.noop)(s)
  return s
    .resolve(HideSplash, LoadMessage.CompletedHideSplash())
    .resolve(
      ReadRoomLink,
      Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
    )
    .resolve(
      ReadBeatLink,
      Message.CompletedReadBeatLink({ maybeDare: Option.none() }),
    )
}

// NOTE: focus moved onto a lobby control, and the lobby folded back into
// PLAY. Both are `switch` Commands, so a Story may go on with one pending,
// but it must settle it before it ends.
export const resolveFocusLobby =
  (control: LobbyControl = 'Start'): RootStep =>
  s =>
    s.resolve(FocusLobbyControl.make({ control }), Component.noop)

export const foldLobby: RootStep = s =>
  s.resolve(FoldLobby, LobbyMessage.CompletedLobbyFold())

// NOTE: a hero's card tapped in the single player lobby's hero picker: the
// Lobby component's PickedHero, as the root hears it.
export const tapLobbyHero = (calling: Calling): StoryStep =>
  send(LobbyMessage.PickedLobbyHero({ calling }))

// NOTE: co-op's change to the room's lobby, sent.
export const resolveChangeLobby: RootStep = s =>
  s.resolve(ChangeLobby, Component.noop)

// NOTE: co-op's focus moved (src/features/coop/steps.ts's `focusCoop`): an
// HtmlCommand.focus, answered as found. It reports nothing back.
export const resolveFocusCoop: RootStep = s =>
  s.resolve(HtmlCommand.Focus, { found: true })

// NOTE: co-op's room remembered (or forgotten) on this device, reporting
// nothing back.
export const resolveRememberRoom: RootStep = s =>
  s.resolve(RememberRoom, Component.noop)

// NOTE: a run summary handed to the store, which reports nothing back.
export const resolveSentSummary: RootStep = s =>
  s.resolve(SendRunSummary, Component.noop)

// NOTE: no Command is asked for.
export const expectNoCommand: StoryStep = s => s.expectNone()

// NOTE: PLAY by Enter opens the single player lobby with START focused; Enter
// again starts the run with what the lobby holds. A test about something
// else than the lobby starts its run with `startRunFromHome`.
export const openLobbyByKey: StoryStep = steps(
  press('Enter'),
  resolveFocusLobby(),
)

// NOTE: PLAY by a tap opens the lobby with START focused.
export const openLobbyByTap: StoryStep = steps(
  send(Message.ClickedPlayButton()),
  resolveFocusLobby(),
)

export const startRunFromHome: StoryStep = steps(
  openLobbyByKey,
  press('Enter'),
  throughIntro,
)

// NOTE: Escape on the Profile, as the native dialog's cancel reports it.
export const closeProfile: StoryStep = send(
  Message.ClosedDialog({ dialog: 'Profile' }),
)

// STORIES THAT RETURN A MODEL

// NOTE: the Model root Messages leave, played through a Story, for a test
// that reads the outcome or a Scene that starts from it. The Story fails on
// a Command they leave pending.
export const modelAfterMessages: {
  (messages: ReadonlyArray<Message>): (model: Model) => Effect.Effect<Model>
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model>
} = Function.dual(
  2,
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model> =>
    modelAfter(model, steps(...Array.map(messages, send))),
)

// NOTE: a run started from home by PLAY and START, as a Story: its first
// Model, for a test that starts from there.
export const startedRun = (model: Model): Effect.Effect<Model> =>
  modelAfter(model, startRunFromHome)

// NOTE: the Model root Messages leave, played through a Story with every
// sound, cue, and save write they raise completed after each one
// (`settleRunCommands`), for a replay or a sim that reads where a run got
// to.
export const playedThrough: {
  (messages: ReadonlyArray<Message>): (model: Model) => Effect.Effect<Model>
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model>
} = Function.dual(
  2,
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model> =>
    modelAfter(model, s =>
      Array.reduce(messages, s, (current, message) =>
        settleRunCommands(current.send(message)),
      ),
    ),
)

// NOTE: every event the Messages raise, frame by frame, in order, played
// through a Story from `start`. Each frame's events are read off the Model
// it leaves (a frame's `frameEvents` hold that frame's only).
export const eventsOver: {
  (
    messages: ReadonlyArray<Message>,
  ): (start: Model) => Effect.Effect<ReadonlyArray<GameEvent>>
  (
    start: Model,
    messages: ReadonlyArray<Message>,
  ): Effect.Effect<ReadonlyArray<GameEvent>>
} = Function.dual(
  2,
  (
    start: Model,
    messages: ReadonlyArray<Message>,
  ): Effect.Effect<ReadonlyArray<GameEvent>> =>
    Effect.scoped(
      Effect.map(storyOf(start), s =>
        Array.flatMap(messages, message => {
          settleRunCommands(s.send(message))
          return s.model.frameEvents
        }),
      ),
    ),
)

// READING A MODEL

// NOTE: a run still being played: a break or a wave, for a sim that plays
// until it ends.
export const isPlaying = (current: Model): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(current.phase)

export const zombieById: {
  (id: number): (current: Model) => Zombie
  (current: Model, id: number): Zombie
} = Function.dual(2, (current: Model, id: number): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.id === id),
  ),
)

export const hasEvent: {
  (tag: GameEvent['_tag']): (current: Model) => boolean
  (current: Model, tag: GameEvent['_tag']): boolean
} = Function.dual(2, (current: Model, tag: GameEvent['_tag']): boolean =>
  Array.some(current.frameEvents, event => event._tag === tag),
)

export const tagsOf = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<string> => Array.map(events, ({ _tag }) => _tag)

export const hintIds = (current: Model): ReadonlyArray<HintId> =>
  Array.map(shownHints(current), ({ id }) => id)

export const isKitchenOpen = (current: Model): boolean =>
  Array.contains(levelOf(current).openExits, KITCHEN_EXIT)

export const WORLD_KEYS = Struct.keys(World.fields)

// BUILDERS

type ZombieOptions = Readonly<{
  speed?: number
  hp?: number
  maxHp?: number
  frenzy?: Frenzy
}>

const makeZombie = (
  kind: ZombieKind,
  id: number,
  x: number,
  y: number,
  {
    speed = 0,
    hp = ZOMBIE_KINDS[kind].hp,
    maxHp = hp,
    frenzy = Frenzy.Calm(),
  }: ZombieOptions = {},
): Zombie => ({
  id,
  kind,
  x,
  y,
  speed,
  hp,
  maxHp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy,
})

// NOTE: data first when the kind leads: a kind is a string, an id a number.
export const zombieOf: {
  (
    id: number,
    x: number,
    y: number,
    options?: ZombieOptions,
  ): (kind: ZombieKind) => Zombie
  (
    kind: ZombieKind,
    id: number,
    x: number,
    y: number,
    options?: ZombieOptions,
  ): Zombie
} = Function.dual((args: IArguments) => typeof args[0] === 'string', makeZombie)

// NOTE: a grid of up to forty spots on open floor, ten across each of four
// rows that no furniture in the dining room touches, for tests that fill the
// room with zombies.
const OPEN_FLOOR_ROWS_Y: Array.NonEmptyReadonlyArray<number> = [40, 52, 89, 129]

export const openFloorSpot = (
  index: number,
): Readonly<{ x: number; y: number }> => ({
  x: 20 + (index % 10) * 30,
  y:
    OPEN_FLOOR_ROWS_Y[Math.floor(index / 10) % OPEN_FLOOR_ROWS_Y.length] ??
    OPEN_FLOOR_ROWS_Y[0],
})

// NOTE: data first when the third argument is a number: `y` after `id` and
// `x`, where data last has the options there.
export const zombieAt: {
  (x: number, y: number, options?: ZombieOptions): (id: number) => Zombie
  (id: number, x: number, y: number, options?: ZombieOptions): Zombie
} = Function.dual(
  (args: IArguments) => typeof args[2] === 'number',
  (
    id: number,
    x: number,
    y: number,
    { hp = ZOMBIE_MAX_HP, ...options }: ZombieOptions = {},
  ): Zombie => makeZombie('Shambler', id, x, y, { hp, ...options }),
)

type BulletOptions = Readonly<{ damage?: number; knockback?: number }>

// NOTE: data first when the id leads: an id is a number, a zombie is not.
export const bulletInto: {
  (target: Zombie, options?: BulletOptions): (id: number) => Bullet
  (id: number, target: Zombie, options?: BulletOptions): Bullet
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (
    id: number,
    { x, y }: Zombie,
    { damage = 1, knockback = 110 }: BulletOptions = {},
  ): Bullet => ({
    id,
    x,
    y,
    velocityX: 1,
    velocityY: 0,
    remainingMs: 900,
    weapon: 'Pistol',
    damage,
    knockback,
    glaze: 'Plain',
    pierce: Pierce.Stops(),
  }),
)

// THE ROOM

// NOTE: where a zombie or the player stands just inside a door.
export const BELOW_NORTH_DOOR = { x: 280, y: 27 }

export const BELOW_KITCHEN_DOOR = { x: 70, y: 26 }

// NOTE: a spot the player can always stand on: the start spot at the
// dining room's table, where every run starts.
export const START_SPOT: Vector = START_LEVEL.start

// NOTE: both widths a zombie paths at (src/world/level/pathing.ts).
export const CLEARANCES: ReadonlyArray<Clearance> = ['Narrow', 'Wide']

// NOTE: the cellar's middle lane by the barrels, once the library and the
// cellar are open.
export const CELLAR_SPOT: Vector = { x: 760, y: 125 }

// NOTE: just right of the player on the start spot, where a shot leaves
// the gun.
export const MUZZLE_X = START_SPOT.x + 10

// NOTE: a zombie one shot from death in front of the gun.
export const doomed = zombieAt(100, MUZZLE_X, START_SPOT.y, { hp: 1 })

export const westPlank = Trap.Barricade({
  id: 1,
  door: 'West',
  hp: TRAPS.Barricade.hp,
  maxHp: TRAPS.Barricade.hp,
  hitRemainingMs: 0,
})

export const FRAME_MS = FIXED_STEP_MS

// NOTE: one fixed-step frame.
export const FIXED_FRAME = Message.TickedFrame({ deltaTime: FRAME_MS })

// NOTE: hit-stop counts whole ticks: a freeze lasts its length rounded to
// whole ticks, and the world does not step on any of them.
export const freezeTicks = (freezeMs: number): number =>
  Math.round(freezeMs / FRAME_MS)

export const waitOutFreeze = (freezeMs: number): StoryStep =>
  ticks(freezeTicks(freezeMs), FRAME_MS)

// NOTE: a tiny seeded generator, so a test's cases are the same on every
// run.
export const randoms = (seed: number) => {
  let state = seed
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// NOTE: `count` ticks of a co-op room's step from `world`, with no input:
// a room never stops for hits, so its ticks run on the clock.
export const steppedWorld: {
  (count: number): (world: World) => World
  (world: World, count: number): World
} = Function.dual(2, (world: World, count: number): World =>
  Array.reduce(
    Array.makeBy(count, () => 0),
    world,
    current => stepWorld(current, new Map()).world,
  ),
)
