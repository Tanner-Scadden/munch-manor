// Shared steps, locators, and builders for Story and Scene tests: what a test
// does to the game, and the zombies, bullets, and guns it puts in. Named
// Models live in `model.fixture.ts`. `tools/lint/duplicateHelpers.ts`
// fails a helper copied between test files: add it here instead.

import { Array, Match, Option, Struct } from 'effect'
import { Canvas, Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog, DialogBlock, RadioGroup } from '@foldkit/ui'

import { PARLOUR, levelOf } from './arena'
import type { SoundEffect } from './audio'
import { ApplicationComposition } from './composition'
import {
  FIXED_STEP_MS,
  RESTART_GRACE_MS,
  SCORE_PER_ZOMBIE,
  STICK_RADIUS_PX,
  ZOMBIE_MAX_HP,
} from './constants'
import { KITCHEN_EXIT } from './exits'
import { endOffer } from './home'
import { FRIDGE_RULES } from './leftovers'
import { PartRadioGroupBlock } from './lookRadios'
import { update } from './main'
import { Message } from './message'
import {
  type Bullet,
  Frenzy,
  GameEvent,
  type Model,
  Pierce,
  type RunStats,
  type ShareOutcome,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from './model'
import { ListenForTouchTaps, MeasureGameSurface, ShareFromClick } from './mount'
import { type HintId, LESSON_MIN_SHOWN_MS, shownHints } from './onboarding'
import { PURCHASE_RULES } from './purchase'
import { subscriptions } from './subscriptions'
import { TRAPS } from './traps'
import { ReadRoomLink } from './update/coop'
import { HideSplash, ShowLoadProgress, WriteSave } from './update/save'
import { PlaySound } from './update/sound'
import { view } from './view'
import { STARTING_PISTOL, gunsOf, mapGuns, maybeCarried } from './weapons'
import { World } from './world'
import { Arsenal, type CarriedGun, type Player, Trap } from './worldSchema'
import { ZOMBIE_KINDS } from './zombies'

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

export const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

export const WIDE_SURFACE = { left: 0, top: 0, width: 1280, height: 720 }

// NOTE: a phone held sideways and held upright.
export const PHONE_LANDSCAPE = { left: 0, top: 0, width: 844, height: 390 }

export const PHONE_PORTRAIT = { left: 0, top: 0, width: 390, height: 844 }

export const tick = (deltaTime: number) =>
  Story.message(Message.TickedFrame({ deltaTime }))

export const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

export const press = (code: string) =>
  Story.message(Message.PressedKey({ code }))

export const release = (code: string) =>
  Story.message(Message.ReleasedKey({ code }))

const FIRE_THUMB = 70

// NOTE: a thumb that lands on the aim stick and pushes it all the way to
// the right, the way a player faces at the start, so the trigger pulls
// (src/input.ts, the fire zone).
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

// NOTE: The Foldkit rule against building a child's Messages skips *.test.ts
// files. These helpers resolve the Dialog's Commands for those tests, so it is
// off here too.
/* oxlint-disable foldkit/no-child-message-construction-in-root */

export const showDialog = () =>
  Story.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  )

// NOTE: the root's Subscriptions, its children's included, so a Scene can
// emit a Message from one of them (Scene.Subscription.emit).
export const SCENE_SUBSCRIPTIONS = Scene.subscriptions(
  ApplicationComposition,
  subscriptions,
)

// NOTE: what every root Scene runs: the root's update, view, and
// Subscriptions.
export const ROOT = { update, view, subscriptions: SCENE_SUBSCRIPTIONS }

export const emitPressedKey = (code: string) =>
  Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.keyboard,
    Message.PressedKey({ code }),
  )

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

// NOTE: a frame walks the player into the stall, which opens the shop.
export const walkIntoStallInScene = () => [
  Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.frame,
    Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
  ),
  ...showDialogInScene(),
]

export const manorButton = Scene.role('button', { name: /^More:/ })

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

export const lookOptionIn = (groupName: string, name: string) =>
  Scene.within(lookGroup(groupName), Scene.role('radio', { name }))

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

/* oxlint-enable foldkit/no-child-message-construction-in-root */

// STORY STEPS

export const tap = (code: string) => Story.steps(press(code), release(code))

export const touchDown = (
  pointerId: number,
  clientX: number,
  clientY: number,
) =>
  Story.message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

export const touchMove = (
  pointerId: number,
  clientX: number,
  clientY: number,
) => Story.message(Message.MovedPointer({ pointerId, clientX, clientY }))

export const mouseDown = (clientX: number, clientY: number) =>
  Story.message(
    Message.PressedPointer({ pointerId: 1, device: 'Mouse', clientX, clientY }),
  )

// NOTE: the frames, of `frameMs` each, that play `ms` of game time.
export const ticksFor = (ms: number, frameMs: number) =>
  ticks(Math.round(ms / frameMs), frameMs)

// NOTE: the Model one fixed-step frame later, for a test that plays frames
// by hand and looks at each.
export const nextFrame = (current: Model): Model =>
  update(current, Message.TickedFrame({ deltaTime: FIXED_STEP_MS })).model

// NOTE: the Model a Message leaves, for a test that starts from a Command's
// result, which no Subscription emits.
export const modelAfter = (model: Model, message: Message): Model =>
  update(model, message).model

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

// READING A MODEL

// NOTE: every event the Messages raise, frame by frame, in order.
export const eventsOver = (
  start: Model,
  messages: ReadonlyArray<Message>,
): ReadonlyArray<GameEvent> =>
  Array.reduce(
    messages,
    { current: start, events: Array.empty<GameEvent>() },
    ({ current, events }, sent) => {
      const next = update(current, sent).model
      return { current: next, events: [...events, ...next.frameEvents] }
    },
  ).events

export const zombieById = (current: Model, id: number): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.id === id),
  )

export const hasEvent = (current: Model, tag: GameEvent['_tag']): boolean =>
  Array.some(current.frameEvents, event => event._tag === tag)

export const tagsOf = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<string> => Array.map(events, ({ _tag }) => _tag)

export const hintIds = (current: Model): ReadonlyArray<HintId> =>
  Array.map(shownHints(current), ({ id }) => id)

export const isKitchenOpen = (current: Model): boolean =>
  Array.contains(levelOf(current).openExits, KITCHEN_EXIT)

export const WORLD_KEYS = Struct.keys(World.fields)

// READING A VIEW

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

// NOTE: every Rect in a shape tree, moved by its Groups' translations.
export const rectsOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
  offset: Readonly<{ x: number; y: number }>,
): ReadonlyArray<Canvas.Rect & Box> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Group', group =>
        rectsOf(group.shapes, {
          x: offset.x + (group.translate?.x ?? 0),
          y: offset.y + (group.translate?.y ?? 0),
        }),
      ),
      Match.tag('Rect', rect => [
        Canvas.Rect({ ...rect, x: rect.x + offset.x, y: rect.y + offset.y }),
      ]),
      Match.orElse(() => []),
    ),
  )

export const imagesIn = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Image> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Image', image => [image]),
      Match.tag('Group', ({ shapes: inner }) => imagesIn(inner)),
      Match.orElse(() => []),
    ),
  )

export type VNodeLike = Readonly<{
  sel?: string | undefined
  key?: PropertyKey | undefined
  data?:
    | Readonly<{
        attrs?: Readonly<Record<string, unknown>> | undefined
        props?: Readonly<Record<string, unknown>> | undefined
      }>
    | undefined
  children?: ReadonlyArray<VNodeLike | string> | undefined
}>

// NOTE: a rendered VNode and every element under it, depth first.
export const nodesOf = (root: VNodeLike): ReadonlyArray<VNodeLike> => {
  const found: Array<VNodeLike> = []
  const visit = (node: VNodeLike | string) => {
    if (typeof node === 'string') {
      return
    }
    found.push(node)
    node.children?.forEach(visit)
  }
  visit(root)
  return found
}

// LOCATORS

export const playButton = Scene.role('button', { name: 'Play' })

export const closeButton = Scene.role('button', { name: 'Close' })

export const settingsButton = Scene.role('button', { name: 'Settings' })

export const profileDialog = Scene.role('dialog', { name: 'Profile' })

export const modeButton = Scene.role('button', {
  name: 'Mode: Campaign. Switch to Endless',
})

export const playEndlessButton = Scene.selector(
  ".home-play[data-mode='Endless']",
)

export const difficultyButton = Scene.role('button', {
  name: 'Difficulty: Normal. Change it',
})

export const lockedNightmare = Scene.role('button', {
  name: 'Nightmare, locked. Beat Hard to unlock',
})

export const keepGoingButton = Scene.role('button', {
  name: 'Keep going: carry on into endless from wave 11 with your money, guns, and traps',
})

export const retryButton = Scene.role('button', {
  name: 'Retry: a new campaign of 10 waves',
})

export const endButtons = Scene.all.selector('.end-actions .end-button')

export const updateChip = Scene.role('button', {
  name: 'Update ready: tap to get it',
})

// Ticks that push each frame's Model onto `frames`, for tests that look at a
// whole fight after it is played.
export const recordTicks = (
  count: number,
  deltaTime: number,
  frames: Array<Model>,
) =>
  Array.flatMap(ticks(count, deltaTime), frame => [
    frame,
    Story.model((current: Model) => {
      frames.push(current)
    }),
  ])

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

export const zombieOf = (
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

// NOTE: a grid of up to forty spots on open floor, ten across each of four
// rows that no furniture in the parlour touches, for tests that fill the
// room with zombies.
const OPEN_FLOOR_ROWS_Y: Array.NonEmptyReadonlyArray<number> = [
  74, 89, 104, 135,
]

export const openFloorSpot = (
  index: number,
): Readonly<{ x: number; y: number }> => ({
  x: 20 + (index % 10) * 30,
  y:
    OPEN_FLOOR_ROWS_Y[Math.floor(index / 10) % OPEN_FLOOR_ROWS_Y.length] ??
    OPEN_FLOOR_ROWS_Y[0],
})

export const zombieAt = (
  id: number,
  x: number,
  y: number,
  { hp = ZOMBIE_MAX_HP, ...options }: ZombieOptions = {},
): Zombie => zombieOf('Shambler', id, x, y, { hp, ...options })

type BulletOptions = Readonly<{ damage?: number; knockback?: number }>

export const bulletInto = (
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
})

// ARSENALS

// NOTE: the arsenals tests reach for most: the pistol alone, or the pistol
// in the first slot and another gun in the second, held either way.
export const pistolOnly = (pistol: CarriedGun = STARTING_PISTOL): Arsenal =>
  Arsenal.OneGun({ first: pistol })

export const holdingSecond = (
  second: CarriedGun,
  first: CarriedGun = STARTING_PISTOL,
): Arsenal => Arsenal.HoldingSecond({ first, second })

export const holdingFirst = (
  second: CarriedGun,
  first: CarriedGun = STARTING_PISTOL,
): Arsenal => Arsenal.HoldingFirst({ first, second })

// NOTE: changes the carried Pop Pistol, wherever it sits.
export const withPistol = (
  player: Player,
  change: (pistol: CarriedGun) => CarriedGun,
): Player =>
  modifyFields(player, {
    arsenal: arsenal =>
      mapGuns(arsenal, gun => (gun.kind === 'Pistol' ? change(gun) : gun)),
  })

export const pistolOf = (player: Player): CarriedGun =>
  Option.getOrThrow(maybeCarried(player, 'Pistol'))

// NOTE: the carried gun that is not the Pop Pistol, if any: what the old
// spare slot held.
export const maybeSpareGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Array.findFirst(gunsOf(arsenal), gun => gun.kind !== 'Pistol')

export const SHOTGUN: CarriedGun = {
  kind: 'Shotgun',
  rounds: 16,
  loaded: 6,
  tier: 0,
}

// THE ROOM

// NOTE: where a zombie or the player stands just inside a door.
export const BELOW_NORTH_DOOR = { x: 220, y: 27 }

export const BELOW_KITCHEN_DOOR = { x: 70, y: 26 }

// NOTE: a spot the player can always stand on: the parlour's middle.
export const PARLOUR_SPOT: Vector = { x: 160, y: 90 }

// NOTE: just right of the player at the parlour's center, where a shot
// leaves the gun.
export const MUZZLE_X = PARLOUR.width / 2 + 10

// NOTE: a zombie one shot from death in front of the gun.
export const doomed = zombieAt(100, MUZZLE_X, PARLOUR.height / 2, { hp: 1 })

export const westPlank = Trap.Barricade({
  id: 1,
  door: 'West',
  hp: TRAPS.Barricade.hp,
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
