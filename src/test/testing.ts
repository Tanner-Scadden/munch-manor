// Shared steps, locators, and builders for Story and Scene tests: what a test
// does to the game, and the zombies, bullets, and guns it puts in. Named
// Models live in `model.fixture.ts`. `tools/lint/duplicateHelpers.ts`
// fails a helper copied between test files: add it here instead.

import { Array, Effect, Function, Option, Schema, Struct } from 'effect'
import { Scene, Story } from 'foldkit'

import { Dialog, DialogBlock, RadioGroup } from '@foldkit/ui'

import { LobbyBinding } from '../app/bindings'
import { layer } from '../app/block'
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
  ReadUpdateMarker,
  StartSummaryQueue,
} from '../app/boot'
import { ApplicationBlock } from '../app/definition'
import { Message } from '../app/message'
import {
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
import {
  ListenForTouchTaps,
  MeasureGameSurface,
  ShareFromClick,
} from '../app/mount'
import { subscriptions, type update } from '../app/pureApp'
import { ReadRoomLink } from '../app/update/coop'
import { CueMusic } from '../app/update/music'
import { HideSplash, ShowLoadProgress, WriteSave } from '../app/update/save'
import { PlaySound, PlayTune } from '../app/update/sound'
import type { SoundEffect } from '../audio/audio'
import { Message as CoopMessage } from '../features/coop/message'
import { ChangeLobby, FocusCoopElement } from '../features/coop/steps'
import {
  GATE_MS,
  isPocketCardHeld,
  isPocketCardReading,
} from '../features/dare/pocketCard'
import { endOffer } from '../features/end/endOffer'
import type { ShareOutcome } from '../features/end/share'
import { Message as GuideMessage } from '../features/guide/message'
import { FocusGuideControl } from '../features/guide/steps'
import { Message as HeroPickerMessage } from '../features/heroes/message'
import { HeroPickerBinding } from '../features/lobby/bindings'
import { Message as LobbyMessage } from '../features/lobby/message'
import type { LobbyControl } from '../features/lobby/model'
import { FocusLobbyControl, FoldLobby } from '../features/lobby/steps'
import {
  type HintId,
  LESSON_MIN_SHOWN_MS,
  shownHints,
} from '../features/onboarding/onboarding'
import { PartRadioGroupBlock } from '../features/profile/blocks/look/lookRadios'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  RESTART_GRACE_MS,
  SCORE_PER_ZOMBIE,
  STICK_RADIUS_PX,
  ZOMBIE_MAX_HP,
} from '../shared/constants'
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

export const tick = (deltaTime: number) =>
  Story.message(Message.TickedFrame({ deltaTime }))

type TickStep = ReturnType<typeof tick>

export const ticks: {
  (deltaTime: number): (count: number) => Array.NonEmptyArray<TickStep>
  (count: number, deltaTime: number): Array.NonEmptyArray<TickStep>
} = Function.dual(
  2,
  (count: number, deltaTime: number): Array.NonEmptyArray<TickStep> =>
    Array.makeBy(count, () => tick(deltaTime)),
)

// NOTE: START WAVE, the break's button that starts the wave now.
export const startWave = Story.message(Message.ClickedStartWaveButton())

export const press = (code: string) =>
  Story.message(Message.PressedKey({ code }))

export const release = (code: string) =>
  Story.message(Message.ReleasedKey({ code }))

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

const firePushToward = (direction: Vector) =>
  Message.MovedPointer({
    pointerId: FIRE_THUMB,
    clientX: 600 + direction.x * STICK_RADIUS_PX,
    clientY: 200 + direction.y * STICK_RADIUS_PX,
  })

export const FIRE_PUSH = firePushToward({ x: 1, y: 0 })

export const holdFireToward = (direction: Vector) =>
  Story.steps(
    Story.message(FIRE_PRESS),
    Story.message(firePushToward(direction)),
  )

export const holdFire = holdFireToward({ x: 1, y: 0 })

export const FIRE_LIFT = Message.ReleasedPointer({ pointerId: FIRE_THUMB })

export const releaseFire = Story.message(FIRE_LIFT)

export const showDialog = () =>
  Story.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  )

// NOTE: the root's Subscriptions, its children's included, so a Scene can
// emit a Message from one of them (Scene.Subscription.emit).
export const SCENE_SUBSCRIPTIONS = subscriptions

// NOTE: the root as a Block-aware Story and Scene take it:
// `Story.story(APPLICATION, Story.given(model), ...)`. A child's Message
// goes in by its Binding, or a grandchild's by its Binding path
// (`Story.messageIn([LobbyBinding, HeroPickerBinding], ...)`).
export const APPLICATION = { block: ApplicationBlock, layer }

// NOTE: a group of root Story steps (`Story.steps(...)`) held as a value
// apart from the Story it goes into, such as a table's row.
export type RootSteps = Story.StoryStepsStep<
  Model,
  (model: Model) => void,
  Parameters<typeof update>[1],
  never
>

// NOTE: a hero's card tapped in the single player lobby's hero picker.
export const tapLobbyHero = (calling: Calling) =>
  Story.messageIn(
    [LobbyBinding, HeroPickerBinding],
    HeroPickerMessage.ClickedCard({ calling }),
  )

// NOTE: co-op's own Commands a root Story reaches: focus moved in co-op's
// screens, and a change to the room's lobby sent.
export const resolveFocusCoop = () =>
  Story.Command.resolve(
    FocusCoopElement,
    CoopMessage.CompletedFocusCoopElement(),
  )

export const resolveChangeLobby = () =>
  Story.Command.resolve(ChangeLobby, CoopMessage.CompletedChangeLobby())

// NOTE: the guide's focus Command, on the Munchopedia's Finds page.
export const resolveGuideFocus = Story.Command.resolve(
  FocusGuideControl,
  GuideMessage.CompletedFocusControl(),
)

export const emitPressedKey = (code: string) =>
  Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.keyboard,
    Message.PressedKey({ code }),
  )

// THE INTRO

// NOTE: past the intro a run opens on (src/world/run/arrival.ts): a key
// skips it to the slam, and the slam's frames play out to the first break,
// which starts on the last of them.
const SLAM_FRAMES = SLAM_MS / MAX_FRAME_DELTA_MS

// NOTE: the dare card from the slam (src/features/dare/pocketCard.ts) read:
// frames until it takes a key, then a key. Endless has no card.
const GATE_FRAMES = Math.ceil(GATE_MS / MAX_FRAME_DELTA_MS)

const whileCard = (isDue: (current: Model) => boolean) => (message: Message) =>
  Story.messageWith((current: Model) =>
    isDue(current) ? message : Message.SuppressedContextMenu(),
  )
const whileCardReads = whileCard(isPocketCardReading)

const cardOpenFrames = () =>
  Array.makeBy(GATE_FRAMES, () =>
    whileCard(isPocketCardHeld)(
      Message.TickedFrame({ deltaTime: MAX_FRAME_DELTA_MS }),
    ),
  )

const readDareCard = Story.steps(
  ...cardOpenFrames(),
  whileCardReads(Message.PressedKey({ code: 'Escape' })),
)

// NOTE: the same by a tap, so a touch player stays on touch.
const readDareCardByTap = Story.steps(
  ...cardOpenFrames(),
  whileCardReads(
    Message.PressedPointer({
      pointerId: 9,
      device: 'Touch',
      clientX: 0,
      clientY: 0,
    }),
  ),
  Story.message(Message.ReleasedPointer({ pointerId: 9 })),
)

export const throughIntro = Story.steps(
  press('Escape'),
  ...ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCard,
)

// NOTE: the same by a tap, so a touch player stays on touch.
export const throughIntroByTap = Story.steps(
  Story.message(
    Message.PressedPointer({
      pointerId: 9,
      device: 'Touch',
      clientX: 0,
      clientY: 0,
    }),
  ),
  Story.message(Message.ReleasedPointer({ pointerId: 9 })),
  ...ticks(SLAM_FRAMES, MAX_FRAME_DELTA_MS),
  readDareCardByTap,
)

const slamFramesInScene = () =>
  Array.makeBy(SLAM_FRAMES, () =>
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: MAX_FRAME_DELTA_MS }),
    ),
  )

export const throughIntroInScene = () => [
  emitPressedKey('Escape'),
  ...slamFramesInScene(),
]

const cardOpenFramesInScene = () =>
  Array.makeBy(GATE_FRAMES, () =>
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: MAX_FRAME_DELTA_MS }),
    ),
  )

// NOTE: the dare card read in a Scene, by its frames and a key. A Scene
// cannot look first, so only a run with a list (not Endless) takes it.
export const readDareCardInScene = () => [
  ...cardOpenFramesInScene(),
  emitPressedKey('Escape'),
]

export const readDareCardByTapInScene = () => [
  ...cardOpenFramesInScene(),
  Scene.pointerDown(Scene.role('application', { name: 'Game surface' }), {
    pointerType: 'touch',
    pointerId: 9,
    clientX: 100,
    clientY: 100,
  }),
]

export const throughIntroByTapInScene = () => [
  Scene.pointerDown(Scene.role('application', { name: 'Game surface' }), {
    pointerType: 'touch',
    pointerId: 9,
    clientX: 100,
    clientY: 100,
  }),
  ...slamFramesInScene(),
]

// NOTE: the root's two Mounts: the surface's size, and the touch tap
// listener, whose tap Message changes nothing.
export const measureSurfaceAs = (
  surface: Readonly<{
    left: number
    top: number
    width: number
    height: number
  }>,
) =>
  Scene.Mount.resolveAll(
    [MeasureGameSurface, Message.MeasuredGameSurface(surface)],
    [ListenForTouchTaps, Message.TappedWithTouch()],
  )

export const measureSurface = measureSurfaceAs(SURFACE)

// NOTE: SHARE on an end screen carries a Mount (ShareFromClick) that
// reports how each tap's share ended.
export const shareMountSettles = (outcome: ShareOutcome) =>
  Scene.Mount.resolve(ShareFromClick, Message.SettledShare({ outcome }))

// NOTE: leaving an end screen ends SHARE's Mount. A fresh step each time:
// one acknowledgement step acknowledges once.
export const shareMountEnded = () => Scene.Mount.expectEnded(ShareFromClick)

// NOTE: a Scene given an end screen with its buttons up settles SHARE's
// Mount as a share that changed nothing; any other Model has no SHARE.
export const settleEndShareOf = (model: Model) =>
  endOffer(model) === 'MenuAndModes' ? [shareMountSettles('Cancelled')] : []

export const showDialogInScene = () => [
  Scene.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  ),
]

// NOTE: PLAY opens the lobby, which focuses START; START starts the run.
export const resolveFocusLobbyInScene = (control: LobbyControl = 'Start') =>
  Scene.Command.resolve(
    FocusLobbyControl({ control }),
    LobbyMessage.CompletedFocusControl(),
  )

export const foldLobbyInScene = () =>
  Scene.Command.resolve(FoldLobby(), LobbyMessage.CompletedFold())

export const openLobbyInScene = () => [
  Scene.click(Scene.role('button', { name: 'Play' })),
  resolveFocusLobbyInScene(),
]

// NOTE: START opens the run on its intro; `startRunInScene` goes on past it.
export const startIntoIntroInScene = () => [
  ...openLobbyInScene(),
  Scene.click(Scene.role('button', { name: 'Shake on it' })),
]

export const startRunInScene = () => [
  ...startIntoIntroInScene(),
  ...throughIntroInScene(),
  ...readDareCardInScene(),
]

export const manorButton = Scene.role('button', { name: /^More:/ })

export const pauseButton = Scene.role('button', { name: 'Pause' })

export const statusLine = Scene.role('status')

export const munchopediaDialog = Scene.role('dialog', { name: 'Munchopedia' })

// NOTE: deals the MANOR hand on the home menu.
export const openHandInScene = () => [
  Scene.click(manorButton),
  ...showDialogInScene(),
]

// NOTE: a card puts the hand away, then opens its own dialog.
export const pickCardInScene = (name: string | RegExp) => [
  Scene.click(Scene.role('button', { name })),
  ...closeDialogInScene(),
  ...showDialogInScene(),
]

export const closeDialog = () =>
  Story.Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  )

export const closeDialogInScene = () => [
  Scene.Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  ),
]

// NOTE: the Look tab's radio groups in a Scene: a group by its label, an
// option in it by name, and its little tabs.
export const lookGroup = (name: string) => Scene.role('radiogroup', { name })

export const lookOptionIn: {
  (name: string): (groupName: string) => Scene.Locator
  (groupName: string, name: string): Scene.Locator
} = Function.dual(2, (groupName: string, name: string): Scene.Locator =>
  Scene.within(lookGroup(groupName), Scene.role('radio', { name })),
)

export const lookSection = (name: string) => lookOptionIn('Parts', name)

export const resolveFocusOptionInScene = () =>
  Scene.Command.resolve(
    RadioGroup.test.FocusOption,
    PartRadioGroupBlock.Message.CompletedFocusOption(),
  )

export const openLookSection = (name: string) => [
  Scene.click(lookSection(name)),
  resolveFocusOptionInScene(),
]

export const resolveFocusOption = () =>
  Story.Command.resolve(
    RadioGroup.test.FocusOption,
    PartRadioGroupBlock.Message.CompletedFocusOption(),
  )

// STORY STEPS

export const tap = (code: string) => Story.steps(press(code), release(code))

type PointerStep = Story.MessageStep<Message>

export const touchDown: {
  (clientX: number, clientY: number): (pointerId: number) => PointerStep
  (pointerId: number, clientX: number, clientY: number): PointerStep
} = Function.dual(
  3,
  (pointerId: number, clientX: number, clientY: number): PointerStep =>
    Story.message(
      Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
    ),
)

export const touchMove: {
  (clientX: number, clientY: number): (pointerId: number) => PointerStep
  (pointerId: number, clientX: number, clientY: number): PointerStep
} = Function.dual(
  3,
  (pointerId: number, clientX: number, clientY: number): PointerStep =>
    Story.message(Message.MovedPointer({ pointerId, clientX, clientY })),
)

export const mouseDown: {
  (clientY: number): (clientX: number) => PointerStep
  (clientX: number, clientY: number): PointerStep
} = Function.dual(2, (clientX: number, clientY: number): PointerStep =>
  Story.message(
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
  (frameMs: number): (ms: number) => Array.NonEmptyArray<TickStep>
  (ms: number, frameMs: number): Array.NonEmptyArray<TickStep>
} = Function.dual(
  2,
  (ms: number, frameMs: number): Array.NonEmptyArray<TickStep> =>
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

// NOTE: Enter held at a purchasable until the hold buys, then let go.
export const holdToBuy = Story.steps(
  press('Enter'),
  ...ticks(HOLD_TICKS, FIXED_STEP_MS),
  release('Enter'),
)
// NOTE: Enter held for `count` fixed-step frames, then let go: a hold to
// buy at whatever purchasable the player stands at.
export const holdEnter = (count: number) => [
  press('Enter'),
  ...ticks(count, FIXED_STEP_MS),
  release('Enter'),
]

// NOTE: fixed-step frames that stand the player at a counter long enough for
// its prompt to come up.
export const STAND_TICKS = Math.ceil(PURCHASE_RULES.standMs / FIXED_STEP_MS) + 1

// NOTE: 50 ms frames that keep a lesson's hint up for its shortest time.
export const SHOWN_TICKS = Math.ceil(LESSON_MIN_SHOWN_MS / 50)

// NOTE: 50 ms frames past the grace after a run ends, when a key or tap
// restarts.
export const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / 50)

export const writeSave = () =>
  Story.Command.resolve(WriteSave, Message.CompletedWriteSave())

export const resolvePlayed = (sound: SoundEffect) =>
  Story.Command.resolve(
    PlaySound,
    Message.CompletedPlaySound({ sound, outcome: 'Played' }),
  )

// NOTE: the boot splash's last Commands once the save is read: the load
// bar fills, the splash goes, and no room link is waiting.
export const finishSplash = Story.steps(
  Story.Command.resolve(
    ShowLoadProgress({ loaded: 5, total: 5 }),
    Message.CompletedShowLoadProgress(),
  ),
  Story.Command.resolve(HideSplash(), Message.CompletedHideSplash()),
  Story.Command.resolve(
    ReadRoomLink,
    Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
  ),
)

// NOTE: every Command init starts but the visit id, answered as a desktop
// with one player, no share sheet, no update waiting, and no save, with
// the load bar, the splash, and the room link they lead to, for a Story
// from `Story.init()` about something other than the boot itself
// (src/features/home/__tests__/menu.story.test.ts walks the boot step by
// step).
export const bootWithoutVisitId = Story.Command.resolveAll(
  [GenerateSeed(), Message.CompletedGenerateSeed({ seed: 1 })],
  [StartSummaryQueue(), Message.CompletedStartSummaryQueue()],
  [
    DetectInputDevice(),
    Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
  ],
  [
    DetectShareSheet(),
    Message.CompletedDetectShareSheet({ shareSheet: 'Unavailable' }),
  ],
  [
    DetectScreenFit(),
    Message.CompletedDetectScreenFit({ screenFit: 'Unknown' }),
  ],
  [
    DetectOrientationLock(),
    Message.CompletedDetectOrientationLock({ orientationLock: 'Unsupported' }),
  ],
  [DetectLocalPlayers(), Message.CompletedDetectLocalPlayers({ count: 1 })],
  [
    ReadUpdateMarker(),
    Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
  ],
  [LoadStyles(), Message.CompletedLoadStyles()],
  [LoadFonts(), Message.CompletedLoadFonts()],
  [AwaitFirstFrame(), Message.CompletedAwaitFirstFrame()],
  [DecodeSprites(), Message.CompletedDecodeSprites()],
  [LoadSave(), Message.CompletedLoadSave({ maybeSave: Option.none() })],
  ...Array.makeBy(
    5,
    index =>
      [
        ShowLoadProgress({ loaded: index + 1, total: 5 }),
        Message.CompletedShowLoadProgress(),
      ] as const,
  ),
  [HideSplash(), Message.CompletedHideSplash()],
  [ReadRoomLink, Message.CompletedReadRoomLink({ maybeCode: Option.none() })],
)

// NOTE: PLAY by Enter opens the single player lobby with START focused; Enter
// again starts the run with what the lobby holds. A test about something
// else than the lobby starts its run with `startRunFromHome`.
export const resolveFocusLobby = (control: LobbyControl = 'Start') =>
  Story.Command.resolve(
    FocusLobbyControl({ control }),
    LobbyMessage.CompletedFocusControl(),
  )

export const openLobbyByKey = Story.steps(press('Enter'), resolveFocusLobby())

export const startRunFromHome = Story.steps(
  openLobbyByKey,
  press('Enter'),
  throughIntro,
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

// LOCATORS

export const playButton = Scene.role('button', { name: 'Play' })

export const closeButton = Scene.role('button', { name: 'Close' })

export const settingsButton = Scene.role('button', { name: 'Settings' })

export const profileDialog = Scene.role('dialog', { name: 'Profile' })

export const lobbyScreen = Scene.role('region', { name: 'Lobby' })

export const homeUnderLobby = Scene.selector('.home-under-lobby')

export const lobbyStartButton = Scene.role('button', { name: 'Shake on it' })

export const lobbyBackButton = Scene.role('button', {
  name: 'Chicken out',
})

export const lobbyMode = (name: string) => Scene.role('button', { name })

export const lockedNightmare = Scene.role('button', {
  name: 'Triple Dog Dare, locked. Escape on Triple Dare to unlock',
})

export const playEndlessButton = Scene.selector(
  ".home-play[data-mode='Endless']",
)

// NOTE: KEEP GOING is gone (an escape ends the run); tests check it stays so.
export const keepGoingButton = Scene.selector(
  ".end-button[data-look='KeepGoing']",
)

export const retryButton = Scene.role('button', {
  name: 'Retry: a new dare',
})

export const endButtons = Scene.all.selector('.end-actions .end-button')

export const updateChip = Scene.role('button', {
  name: 'Update ready: tap to get it',
})

// Ticks that push each frame's Model onto `frames`, for tests that look at a
// whole fight after it is played.
type RecordStep = TickStep | ReturnType<typeof Story.model<Model>>

export const recordTicks: {
  (
    deltaTime: number,
    frames: Array<Model>,
  ): (count: number) => Array.NonEmptyArray<RecordStep>
  (
    count: number,
    deltaTime: number,
    frames: Array<Model>,
  ): Array.NonEmptyArray<RecordStep>
} = Function.dual(
  3,
  (
    count: number,
    deltaTime: number,
    frames: Array<Model>,
  ): Array.NonEmptyArray<RecordStep> =>
    Array.flatMap(
      ticks(count, deltaTime),
      (frame): Array.NonEmptyReadonlyArray<RecordStep> => [
        frame,
        Story.model((current: Model) => {
          frames.push(current)
        }),
      ],
    ),
)

export const blastFrames = (
  frames: ReadonlyArray<Model>,
): ReadonlyArray<Model> =>
  Array.filter(frames, ({ frameEvents }) =>
    Array.some(frameEvents, GameEvent.guards.Exploded),
  )

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

export const waitOutFreeze = (freezeMs: number) =>
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

// STORIES THAT RETURN A MODEL

// NOTE: the Model root Messages leave, played through a Block-aware Story,
// for a test that reads the outcome or a Scene that starts from it (the
// surface measured again, which only a Mount reports). The Story fails on
// a Command they leave pending.
export const modelAfterMessages: {
  (messages: ReadonlyArray<Message>): (model: Model) => Effect.Effect<Model>
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model>
} = Function.dual(2, (model: Model, messages: ReadonlyArray<Message>) =>
  Story.story(
    APPLICATION,
    Story.given(model),
    ...Array.map(messages, message => Story.message(message)),
  ),
)

// RUNS AND SOUNDS IN STORIES

// NOTE: a run started from home by PLAY and START, as a Story: its first
// Model, for a test that starts from there.
export const startedRun = (model: Model) =>
  Story.story(APPLICATION, Story.given(model), startRunFromHome)

// NOTE: a step that hands the sounds the pending Commands would play to a
// check, then plays them, for a frame whose sounds' variations hang on
// where they happen, so no exact Command can be named.
export const checkPendingSounds =
  (check: (sounds: ReadonlyArray<SoundEffect>) => void) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    const cues = Array.getSomes(
      Array.map(simulation.commands, command =>
        Story.Command.argsOf(PlaySound)(command),
      ),
    )
    check(Array.map(cues, ({ sound }) => sound))
    return Array.reduce(cues, simulation, (current, cue) =>
      Story.Command.resolve(
        PlaySound(cue),
        Message.CompletedPlaySound({ sound: cue.sound, outcome: 'Played' }),
      )(current),
    )
  }

// NOTE: a step that hands the args of every pending Command one
// Definition matches (`checkPendingArgs(Story.Command.argsOf(WriteSave))`) to a check, and
// leaves them pending, for a test about a few of a Command's args, where
// `Story.Command.expectExact` would need the whole value.
export const checkPendingArgs =
  <Args>(argsOf: (pending: Story.AnyCommand) => Option.Option<Args>) =>
  (check: (pending: ReadonlyArray<Args>) => void) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    check(
      Array.getSomes(
        Array.map(simulation.commands, command => argsOf(command)),
      ),
    )
    return simulation
  }

// NOTE: plays whatever sounds the last frame left pending, so a Story of
// frames ends with every Command resolved.
export const playPendingSounds = checkPendingSounds(Function.constVoid)

// NOTE: completes every sound, music cue, and save write left pending, each
// with the Message its handler answers on success, for a Story that plays
// many frames of a run (a whole wave, a replay) and is about the World, not
// its Commands. Any other pending Command stays, so the Story still fails on
// one it did not expect.
export const settleRunCommands = <StoryModel, StoryMessage, OutMessage>(
  simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> =>
  Array.reduce(simulation.commands, simulation, (current, command) =>
    Option.match(Story.Command.argsOf(PlaySound)(command), {
      onSome: cue =>
        Story.Command.resolve(
          PlaySound(cue),
          Message.CompletedPlaySound({ sound: cue.sound, outcome: 'Played' }),
        )(current),
      onNone: () =>
        Option.match(Story.Command.argsOf(CueMusic)(command), {
          onSome: cue =>
            Story.Command.resolve(
              CueMusic(cue),
              Message.CompletedCueMusic({ mood: cue.mood }),
            )(current),
          onNone: () =>
            Option.match(Story.Command.argsOf(PlayTune)(command), {
              onSome: placement =>
                Story.Command.resolve(
                  PlayTune(placement),
                  Message.CompletedPlaySound({
                    sound: 'MusicBox',
                    outcome: 'Played',
                  }),
                )(current),
              onNone: () =>
                Option.isSome(Story.Command.argsOf(WriteSave)(command))
                  ? writeSave()(current)
                  : current,
            }),
        }),
    }),
  )

// NOTE: a Message the game takes at any moment and answers with nothing (a
// right click's menu kept shut), what `messageIfAny` sends when its choice
// is to send nothing.
const IDLE = Message.SuppressedContextMenu()

// NOTE: a Story step that sends the Message `choose` picks from the Model it
// finds when the step runs, or nothing, for a sim whose players act on what
// they see (`Story.messageWith` always sends one): the bots that press READY
// in a break, aim at the nearest zombie, or let go of a key they hold.
export const messageIfAny = (
  choose: (current: Model) => Option.Option<Message>,
) =>
  Story.messageWith((current: Model) =>
    Option.getOrElse(choose(current), () => IDLE),
  )

// NOTE: a change to the Model in the middle of a Story, as `Story.given`
// makes one at its start, for a sim whose rule is its own and not the
// game's: every heart full again after each frame, or every zombie gone the
// frame it walks in. No Message makes it, so no handler runs.
export const changeModel =
  (change: (current: Model) => Model) =>
  <StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<Model, StoryMessage, OutMessage>,
  ): Story.StorySimulation<Model, StoryMessage, OutMessage> => ({
    ...simulation,
    model: change(simulation.model),
  })

// NOTE: the Model root Messages leave, played through a Block-aware Story
// with every sound, cue, and save write they raise completed
// (`settleRunCommands`), for a replay or a sim that reads where a run got to.
export const playedThrough: {
  (messages: ReadonlyArray<Message>): (model: Model) => Effect.Effect<Model>
  (model: Model, messages: ReadonlyArray<Message>): Effect.Effect<Model>
} = Function.dual(2, (model: Model, messages: ReadonlyArray<Message>) =>
  Story.story(
    APPLICATION,
    Story.given(model),
    ...Array.map(messages, message => Story.message(message)),
    settleRunCommands,
  ),
)

// NOTE: every event the Messages raise, frame by frame, in order, played
// through a Block-aware Story from `start`. Each frame's events are read
// off the Model it leaves (a frame's `frameEvents` hold that frame's only),
// gathered in an array the Story alone fills, as `recordTicks` gathers its
// Models.
export const eventsOver: {
  (
    messages: ReadonlyArray<Message>,
  ): (start: Model) => Effect.Effect<ReadonlyArray<GameEvent>>
  (
    start: Model,
    messages: ReadonlyArray<Message>,
  ): Effect.Effect<ReadonlyArray<GameEvent>>
} = Function.dual(2, (start: Model, messages: ReadonlyArray<Message>) =>
  Effect.suspend(() => {
    const events: Array<GameEvent> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...Array.flatMap(messages, sent => [
        Story.message(sent),
        Story.model((current: Model) => {
          events.push(...current.frameEvents)
        }),
      ]),
      settleRunCommands,
    ).pipe(Effect.as<ReadonlyArray<GameEvent>>(events))
  }),
)

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
