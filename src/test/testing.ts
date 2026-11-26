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

export const scoring =
  (score: number) =>
  (stats: RunStats): RunStats => ({
    ...stats,
    kills: {
      ...stats.kills,
      Shambler: stats.kills.Shambler + score / SCORE_PER_ZOMBIE,
    },
  })

const encodeJson = Schema.encodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
)

export const jsonOf = (value: unknown): string =>
  Option.getOrThrow(encodeJson(value))

export const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

export const WIDE_SURFACE = { left: 0, top: 0, width: 1280, height: 720 }

export const PHONE_LANDSCAPE = { left: 0, top: 0, width: 844, height: 390 }

export const PHONE_PORTRAIT = { left: 0, top: 0, width: 390, height: 844 }

export const isPausedPhase = (current: Model): boolean =>
  Phase.isAnyOf(['Paused'])(current.phase)

export type AppStory = Story.Steps<typeof ApplicationNoDeps>

export type AppScene = HtmlScene.Steps<typeof ApplicationNoDeps>

export type StoryStep = (s: AppStory) => AppStory

export type SceneStep = (s: AppScene) => AppScene

export type RootStep = <S extends Steps.Steps<typeof ApplicationNoDeps>>(
  s: S,
) => S

export type RootSteps = StoryStep

export const steps =
  <S>(...each: ReadonlyArray<(s: S) => S>) =>
  (s: S): S =>
    Array.reduce(each, s, (current, step) => step(current))

export const withAudioAsked = (model: Model): Model =>
  AudioState.$is('Locked')(model.audio)
    ? UiStruct.evolve(model, { audio: () => AudioState.Unlocking })
    : model

export const exactStoryOf = (
  model: Model,
): Effect.Effect<AppStory, never, Scope.Scope> =>
  Effect.map(Story.make(ApplicationNoDeps, {}), s => s.given(model))

export const storyOf = (
  model: Model,
): Effect.Effect<AppStory, never, Scope.Scope> =>
  exactStoryOf(withAudioAsked(model))

export const exactSceneOf = (
  model: Model,
): Effect.Effect<AppScene, never, Scope.Scope> =>
  Effect.map(HtmlScene.make(ApplicationNoDeps, {}), s => s.given(model))

export const sceneOf = (
  model: Model,
): Effect.Effect<AppScene, never, Scope.Scope> =>
  exactSceneOf(withAudioAsked(model))

export const modelAfter: {
  (step: StoryStep): (model: Model) => Effect.Effect<Model>
  (model: Model, step: StoryStep): Effect.Effect<Model>
} = Function.dual(2, (model: Model, step: StoryStep): Effect.Effect<Model> =>
  Effect.scoped(Effect.map(storyOf(model), s => step(s).model)),
)

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

export const startWave: StoryStep = send(Message.ClickedStartWaveButton())

export const press = (code: string): StoryStep =>
  send(Message.PressedKey({ code }))

export const release = (code: string): StoryStep =>
  send(Message.ReleasedKey({ code }))

export const tap = (code: string): StoryStep =>
  steps(press(code), release(code))

const FIRE_THUMB = 70

export const FIRE_PRESS = Message.PressedPointer({
  pointerId: FIRE_THUMB,
  device: 'Touch',
  clientX: 600,
  clientY: 200,
})

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

export const ticksFor: {
  (frameMs: number): (ms: number) => StoryStep
  (ms: number, frameMs: number): StoryStep
} = Function.dual(2, (ms: number, frameMs: number): StoryStep =>
  ticks(Math.round(ms / frameMs), frameMs),
)

export const tickCountFor = (ms: number): number =>
  Math.ceil(ms / FIXED_STEP_MS)

export const countdownTicks = (ms: number): number =>
  ms <= 0 ? 0 : 1 + countdownTicks(ms - FIXED_STEP_MS)

export const FRIDGE_OPEN_TICKS =
  Math.ceil(FRIDGE_RULES.openMs / FIXED_STEP_MS) + 1

export const HOLD_TICKS = Math.ceil(PURCHASE_RULES.holdMs / FIXED_STEP_MS) + 1

export const holdEnter = (count: number): StoryStep =>
  steps(press('Enter'), ticks(count, FIXED_STEP_MS), release('Enter'))

export const holdToBuy: StoryStep = holdEnter(HOLD_TICKS)

export const STAND_TICKS = Math.ceil(PURCHASE_RULES.standMs / FIXED_STEP_MS) + 1

export const SHOWN_TICKS = Math.ceil(LESSON_MIN_SHOWN_MS / 50)

export const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / 50)

export const messageIfAny =
  (choose: (current: Model) => Option.Option<Message>): StoryStep =>
  s =>
    Option.match(choose(s.model), {
      onNone: () => s,
      onSome: message => s.send(message),
    })

export const changeModel =
  (change: (current: Model) => Model): StoryStep =>
  s =>
    s.given(change)

export const checkModel =
  (check: (current: Model) => void): StoryStep =>
  s => {
    check(s.model)
    return s
  }

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

export const SLAM_FRAMES = SLAM_MS / MAX_FRAME_DELTA_MS

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

const readDareCardByTap: StoryStep = steps(
  cardOpenFrames,
  whileCard(isPocketCardReading)(steps(send(TOUCH_DOWN), send(TOUCH_UP))),
)

export const throughIntro: StoryStep = steps(
  press('Escape'),
  ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCard,
)

export const throughIntroByTap: StoryStep = steps(
  send(TOUCH_DOWN),
  send(TOUCH_UP),
  ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCardByTap,
)

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

export const resolveAll =
  <D extends Command.Definition.Any>(definition: D) =>
  (result: Command.Result<D>): RootStep =>
    resolveEvery(definition, result)

export const writeSave: RootStep = s =>
  s.resolve(WriteSave, SaveMessage.CompletedWriteSave())

export const resolvePlayed: RootStep = s => s.resolve(PlaySound, Component.noop)

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

export const playPendingSounds: RootStep = checkPendingSounds(
  Function.constVoid,
)

export const settleRunCommands: RootStep = s => {
  resolveEvery(PlaySound, Component.noop)(s)
  resolveEvery(PlayPlaced, Component.noop)(s)
  resolveEvery(CueMusic, Component.noop)(s)
  return resolveEvery(WriteSave, SaveMessage.CompletedWriteSave())(s)
}

export const droppedSound = (sound: SoundEffect) =>
  SoundMessage.CompletedPlaySound({ sound, outcome: 'DroppedWhileSuspended' })

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

export const resolveFocusLobby =
  (control: LobbyControl = 'Start'): RootStep =>
  s =>
    s.resolve(FocusLobbyControl.make({ control }), Component.noop)

export const foldLobby: RootStep = s =>
  s.resolve(FoldLobby, LobbyMessage.CompletedLobbyFold())

export const tapLobbyHero = (calling: Calling): StoryStep =>
  send(LobbyMessage.PickedLobbyHero({ calling }))

export const resolveChangeLobby: RootStep = s =>
  s.resolve(ChangeLobby, Component.noop)

export const resolveFocusCoop: RootStep = s =>
  s.resolve(HtmlCommand.Focus, { found: true })

export const resolveRememberRoom: RootStep = s =>
  s.resolve(RememberRoom, Component.noop)

export const resolveSentSummary: RootStep = s =>
  s.resolve(SendRunSummary, Component.noop)

export const expectNoCommand: StoryStep = s => s.expectNone()

export const openLobbyByKey: StoryStep = steps(
  press('Enter'),
  resolveFocusLobby(),
)

export const openLobbyByTap: StoryStep = steps(
  send(Message.ClickedPlayButton()),
  resolveFocusLobby(),
)

export const startRunFromHome: StoryStep = steps(
  openLobbyByKey,
  press('Enter'),
  throughIntro,
)

export const closeProfile: StoryStep = send(
  Message.ClosedDialog({ dialog: 'Profile' }),
)

export const modelAfterMessages: {
  (messages: ReadonlyArray<Message>): (model: Model) => Effect.Effect<Model>
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model>
} = Function.dual(
  2,
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model> =>
    modelAfter(model, steps(...Array.map(messages, send))),
)

export const startedRun = (model: Model): Effect.Effect<Model> =>
  modelAfter(model, startRunFromHome)

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

const OPEN_FLOOR_ROWS_Y: Array.NonEmptyReadonlyArray<number> = [40, 52, 89, 129]

export const openFloorSpot = (
  index: number,
): Readonly<{ x: number; y: number }> => ({
  x: 20 + (index % 10) * 30,
  y:
    OPEN_FLOOR_ROWS_Y[Math.floor(index / 10) % OPEN_FLOOR_ROWS_Y.length] ??
    OPEN_FLOOR_ROWS_Y[0],
})

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

export const BELOW_NORTH_DOOR = { x: 280, y: 27 }

export const BELOW_KITCHEN_DOOR = { x: 70, y: 26 }

export const START_SPOT: Vector = START_LEVEL.start

export const CLEARANCES: ReadonlyArray<Clearance> = ['Narrow', 'Wide']

export const CELLAR_SPOT: Vector = { x: 760, y: 125 }

export const MUZZLE_X = START_SPOT.x + 10

export const doomed = zombieAt(100, MUZZLE_X, START_SPOT.y, { hp: 1 })

export const westPlank = Trap.Barricade({
  id: 1,
  door: 'West',
  hp: TRAPS.Barricade.hp,
  maxHp: TRAPS.Barricade.hp,
  hitRemainingMs: 0,
})

export const FRAME_MS = FIXED_STEP_MS

export const FIXED_FRAME = Message.TickedFrame({ deltaTime: FRAME_MS })

export const freezeTicks = (freezeMs: number): number =>
  Math.round(freezeMs / FRAME_MS)

export const waitOutFreeze = (freezeMs: number): StoryStep =>
  ticks(freezeTicks(freezeMs), FRAME_MS)

export const randoms = (seed: number) => {
  let state = seed
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

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
