// Shared Scene steps and locators: what a Scene does to the root through
// its view, its Subscriptions, and its Mounts, and the elements it looks
// for. Story steps and builders live in `testing.ts`.

import { Array, Function, Match, Option, Record, Result, String } from 'effect'

import { Dialog, type DialogDismissReason, DialogEvents } from '@effect/ui-kit'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'

import { Message } from '../app/message'
import type { Model } from '../app/model'
import {
  ListenForTouchTaps,
  PressGameSurface,
  ShareFromClick,
  WatchGameSurface,
} from '../app/mount'
import { endOffer } from '../features/end/endOffer'
import type { ShareOutcome } from '../features/end/share'
import { Lobby } from '../features/lobby/block'
import { Events as LobbyEvents } from '../features/lobby/message'
import { InputMessage } from '../input/message'
import { PressHudSlot } from '../screens/game/touchControls'
import { MAX_FRAME_DELTA_MS } from '../shared/constants'
import {
  type AppScene,
  GATE_FRAMES,
  type RootStep,
  SLAM_FRAMES,
  SURFACE,
  type SceneStep,
  resolveFocusLobby,
  steps,
} from './testing'

// NOTE: a Message from one of the root's Subscriptions, by its key's name:
// `fromSubscription('Keyboard', Message.PressedKey({ code }))`. A keyed one
// (the frame, keyed by its pace) is found by its name before the colon.
export const fromSubscription: {
  (message: Message): (name: string) => RootStep
  (name: string, message: Message): RootStep
} = Function.dual(2, (name: string, message: Message): RootStep => s => {
  const key = Option.getOrThrowWith(
    Array.findFirst(
      s.subscriptions,
      active => active === name || String.startsWith(`${name}:`)(active),
    ),
    () =>
      new Error(
        `no Subscription ${name} is on: ${Array.join(s.subscriptions, ', ')}`,
      ),
  )
  return s.subscription(key, message)
})

export const emitPressedKey = (code: string): RootStep =>
  fromSubscription('Keyboard', Message.PressedKey({ code }))

// NOTE: one animation frame of `deltaTime`, through the root's frame
// Subscription (`Frame:"Play"` in a round, `Frame:"Menu"` on the title).
export const emitFrame = (deltaTime: number = MAX_FRAME_DELTA_MS): RootStep =>
  fromSubscription('Frame', Message.TickedFrame({ deltaTime }))

const framesInScene =
  (count: number): RootStep =>
  s => {
    for (let index = 0; index < count; index += 1) {
      emitFrame()(s)
    }
    return s
  }

// NOTE: the game surface's Mount: its place on the page, and a press on it
// (each a value of its Stream), and the touch tap listener acknowledged.
export const measureSurfaceAs =
  (
    surface: Readonly<{
      left: number
      top: number
      width: number
      height: number
    }>,
  ): SceneStep =>
  s =>
    s
      .mounted(WatchGameSurface, Message.MeasuredGameSurface(surface))
      .expectMount(ListenForTouchTaps({}))

export const measureSurface = measureSurfaceAs(SURFACE)

// NOTE: each gun slot's press Mount on the HUD (PressHudSlot), acknowledged
// running, for a Scene whose round shows the gun slots.
const HUD_SLOTS = ['First', 'Second', 'Melee'] as const

export const ackHudSlots: SceneStep = s =>
  Array.reduce(HUD_SLOTS, s, (current, slot) =>
    Array.isReadonlyArrayNonEmpty(
      current.all(withAttrs({ 'data-slot': slot })(byClass('gun-slot-button'))),
    )
      ? current.expectMount(PressHudSlot({ slot }))
      : current,
  )

// NOTE: the surface measured and the HUD's Mounts running.
export const measureHud: SceneStep = s => s.pipe(measureSurface, ackHudSlots)

// NOTE: a press on a gun slot, as its Mount reports a pointerdown: a mouse
// press mid-wave is a shot through it, a touch keeps the tap.
export const pressHudSlot =
  ({
    slot,
    ...press
  }: Readonly<{
    slot: (typeof HUD_SLOTS)[number]
    pointerId: number
    device: 'Touch' | 'Mouse'
  }>): SceneStep =>
  s =>
    s.mounted(
      PressHudSlot({ slot }),
      InputMessage.PressedHudSlot({ ...press, clientX: 0, clientY: 0 }),
    )

// NOTE: a finger or the mouse pressing the game surface, as its Mount
// reports a pointerdown.
export const pressSurface =
  (
    press: Readonly<{
      pointerId: number
      device: 'Touch' | 'Mouse'
      clientX: number
      clientY: number
    }>,
  ): SceneStep =>
  s =>
    s.mounted(WatchGameSurface, Message.PressedPointer(press))

const surfaceTap: SceneStep = pressSurface({
  pointerId: 9,
  device: 'Touch',
  clientX: 100,
  clientY: 100,
})

export const throughIntroInScene: SceneStep = steps(
  emitPressedKey('Escape'),
  framesInScene(SLAM_FRAMES),
)

// NOTE: the dare card read in a Scene, by its frames and a key. A Scene
// cannot look first, so only a run with a list (not Endless) takes it.
export const readDareCardInScene: SceneStep = steps(
  framesInScene(GATE_FRAMES),
  emitPressedKey('Escape'),
)

export const readDareCardByTapInScene: SceneStep = steps(
  framesInScene(GATE_FRAMES),
  surfaceTap,
)

export const throughIntroByTapInScene: SceneStep = steps(
  surfaceTap,
  framesInScene(SLAM_FRAMES),
)

// NOTE: SHARE on an end screen carries a Mount (ShareFromClick) that
// reports how each tap's share ended.
export const shareMountSettles =
  (outcome: ShareOutcome): SceneStep =>
  s =>
    s.mounted(ShareFromClick, Message.SettledShare({ outcome }))

// NOTE: SHARE's Mount acknowledged as running, with no share yet.
const shareMountRuns: SceneStep = s => s.expectMount(ShareFromClick({}))

// NOTE: a Scene given an end screen with its buttons up acknowledges
// SHARE's Mount; any other Model has no SHARE.
export const settleEndShareOf =
  (model: Model): SceneStep =>
  s =>
    endOffer(model) === 'MenuAndModes' ? shareMountRuns(s) : s

// NOTE: PLAY opens the lobby, which focuses START; START starts the run.
export const openLobbyInScene: SceneStep = steps(
  s => s.click(HtmlLocator.role('button', { name: 'Play' })),
  resolveFocusLobby(),
)

// NOTE: START opens the run on its intro; `startRunInScene` goes on past it.
// The lobby is a child, a leaf in the root's Scene, so START is its event.
export const startIntoIntroInScene: SceneStep = steps(openLobbyInScene, s =>
  s.childEmit(Lobby, 'lobby', LobbyEvents.RequestedStart()),
)

export const startRunInScene: SceneStep = steps(
  startIntoIntroInScene,
  throughIntroInScene,
  readDareCardInScene,
)

// LOCATORS

// NOTE: elements wearing a class, the old `Scene.selector('.name')`, and
// what a locator finds that also wears the given attributes
// (`withAttrs({ 'data-mode': 'Endless' })(byClass('home-play'))`).
const classesOf = (node: Locator.Node): ReadonlyArray<string> =>
  String.split(node.attrs?.['class'] ?? '', /\s+/)

export const byClass = (name: string): Locator.Locator => ({
  description: `.${name}`,
  all: root =>
    Array.filter(Locator.elements(root), node =>
      Array.contains(classesOf(node), name),
    ),
})

export const withAttrs =
  (attrs: Readonly<Record<string, string>>) =>
  (locator: Locator.Locator): Locator.Locator => ({
    description: `${locator.description}${Array.join(
      Array.map(Record.toEntries(attrs), ([key, value]) => `[${key}=${value}]`),
      '',
    )}`,
    all: root =>
      Array.filter(locator.all(root), node =>
        Array.every(
          Record.toEntries(attrs),
          ([key, value]) => node.attrs?.[key] === value,
        ),
      ),
  })

// NOTE: an element's attribute in a Scene, `undefined` when it must not be
// there: the old `toHaveAttr` and `not.toHaveAttr`.
export const expectAttr: {
  (
    name: string,
    expected: string | undefined,
  ): (locator: Locator.Locator) => SceneStep
  (
    locator: Locator.Locator,
    name: string,
    expected: string | undefined,
  ): SceneStep
} = Function.dual(
  3,
  (
    locator: Locator.Locator,
    name: string,
    expected: string | undefined,
  ): SceneStep =>
    s =>
      s.check(() => {
        const actual = s.get(locator).attrs?.[name]
        if (actual !== expected) {
          throw new Error(
            `${locator.description} has ${name}=${globalThis.String(actual)}, wanted ${globalThis.String(expected)}`,
          )
        }
      }),
)

// NOTE: one property of an element's inline style in a Scene, the old
// `toHaveStyle`: `expectStyle(cluster, 'left', '25%')`.
const styleOf = (node: Locator.Node): Readonly<Record<string, string>> =>
  Record.fromEntries(
    Array.filterMap(String.split(node.attrs?.['style'] ?? '', ';'), entry =>
      Option.match(String.indexOf(':')(entry), {
        onNone: () => Result.failVoid,
        onSome: at =>
          Result.succeed([
            String.trim(String.slice(0, at)(entry)),
            String.trim(String.slice(at + 1)(entry)),
          ] as const),
      }),
    ),
  )

export const expectStyle: {
  (property: string, expected: string): (locator: Locator.Locator) => SceneStep
  (locator: Locator.Locator, property: string, expected: string): SceneStep
} = Function.dual(
  3,
  (locator: Locator.Locator, property: string, expected: string): SceneStep =>
    s =>
      s.check(() => {
        const actual = styleOf(s.get(locator))[property]
        if (actual !== expected) {
          throw new Error(
            `${locator.description} has ${property}: ${globalThis.String(actual)}, wanted ${expected}`,
          )
        }
      }),
)

// NOTE: an element wearing a class in a Scene, the old `toHaveClass`.
export const expectClass: {
  (name: string): (locator: Locator.Locator) => SceneStep
  (locator: Locator.Locator, name: string): SceneStep
} = Function.dual(
  2,
  (locator: Locator.Locator, name: string): SceneStep =>
    s =>
      s.check(() => {
        if (!Array.contains(classesOf(s.get(locator)), name)) {
          throw new Error(`${locator.description} does not wear .${name}`)
        }
      }),
)

export const manorButton = HtmlLocator.role('button', { name: /^More:/ })

export const pauseButton = HtmlLocator.role('button', { name: 'Pause' })

// NOTE: the corner's pause button tapped: the pause screen's press on the
// surface (PressGameSurface) acknowledged running.
export const pauseByButton: SceneStep = s =>
  s.click(pauseButton).expectMount(PressGameSurface())

// NOTE: the pause screen's help card takes a press as the surface does
// (PressGameSurface): its Mount acknowledged running.
export const pausePressRuns: SceneStep = s => s.expectMount(PressGameSurface())

// NOTE: a click, or a finger's tap: src/input/touchTaps.ts makes a tap a
// click on the button, as it does for a second finger while another holds
// the move stick.
export const clickOn =
  (locator: Locator.Locator): SceneStep =>
  s =>
    s.click(locator)

type ViewNode = AppScene['view']

// NOTE: every child component the view draws, outside any other child.
export const childrenOf = (node: ViewNode): ReadonlyArray<ViewNode> =>
  Match.value(node).pipe(
    Match.tag('Element', element =>
      Array.flatMap(element.children, childrenOf),
    ),
    Match.tag('Child', child => [child]),
    Match.orElse(() => []),
  )

// NOTE: the first of several matches, for a locator that matches more than
// one element where a test means the first (the root's two status lines).
export const firstOf = (locator: Locator.Locator): Locator.Locator => ({
  description: `the first ${locator.description}`,
  all: root => Array.take(locator.all(root), 1),
})

// NOTE: the root's status line, before the polite live region that also
// wears role status.
export const statusLine = firstOf(HtmlLocator.role('status'))

// NOTE: ui-kit's Dialog shows its portal once its own TrackDialog mount
// reports it shown, which a Scene never runs. This gives the root's Dialog
// at `id` (`PROFILE_DIALOG_ID`, `HOME_SCREEN_STEPS_ID`, ...) the Model it
// has once shown, so what is inside it is in the accessibility tree. Open
// the dialog first (its `DialogState` field, by a click or a Message).
export const dialogModel = (isShown: boolean) => ({
  mounted: isShown,
  started: isShown,
  nestedOpen: 0,
  trigger: null,
  reason: null,
  openMethod: null,
  closeMethod: null,
})

export const showDialog =
  (id: string): SceneStep =>
  s =>
    s.givenChild(Dialog, id, dialogModel(true))

// NOTE: the root's Dialog at `id` asking to close, as its close button,
// Escape, or a press outside would make it ask: a Scene doesn't run the
// Dialog's own update, so the event stands in for the press. The root
// answers with ClosedDialog, and the Dialog is given the Model it has once
// its exit has played (a dialog still open stays shown on its prop).
export const requestDialogClose: {
  (reason: DialogDismissReason): (id: string) => SceneStep
  (id: string, reason: DialogDismissReason): SceneStep
} = Function.dual(
  2,
  (id: string, reason: DialogDismissReason): SceneStep =>
    s =>
      s
        .childEmit(Dialog, id, DialogEvents.RequestedClose({ reason }))
        .givenChild(Dialog, id, dialogModel(false)),
)

export const munchopediaDialog = HtmlLocator.role('dialog', {
  name: 'Dare Journal',
})

export const playButton = HtmlLocator.role('button', { name: 'Play' })

export const closeButton = HtmlLocator.role('button', { name: 'Close' })

export const settingsButton = HtmlLocator.role('button', { name: 'Settings' })

export const profileDialog = HtmlLocator.role('dialog', { name: 'Profile' })

export const lobbyScreen = HtmlLocator.role('region', { name: 'Lobby' })

export const homeUnderLobby = byClass('home-under-lobby')

export const lobbyStartButton = HtmlLocator.role('button', {
  name: 'Shake on it',
})

export const lobbyBackButton = HtmlLocator.role('button', {
  name: 'Chicken out',
})

// NOTE: a button by its accessible name.
export const button = (name: string | RegExp) =>
  HtmlLocator.role('button', { name })

export const lobbyMode = (name: string) => HtmlLocator.role('button', { name })

export const lockedNightmare = HtmlLocator.role('button', {
  name: 'Triple Dog Dare, locked. Escape on Triple Dare to unlock',
})

export const playEndlessButton = withAttrs({ 'data-mode': 'Endless' })(
  byClass('home-play'),
)

// NOTE: KEEP GOING is gone (an escape ends the run); tests check it stays so.
export const keepGoingButton = withAttrs({ 'data-look': 'KeepGoing' })(
  byClass('end-button'),
)

export const retryButton = HtmlLocator.role('button', {
  name: 'Retry: a new dare',
})

export const endButtons = Locator.inside(
  byClass('end-actions'),
  byClass('end-button'),
)

export const updateChip = HtmlLocator.role('button', {
  name: 'Update ready: tap to get it',
})

// NOTE: deals the MANOR hand on the home menu: its dialog opens on the
// Model, with no Command to resolve.
export const openHandInScene: SceneStep = s => s.click(manorButton)

// NOTE: a card puts the hand away and opens its own dialog.
export const pickCardInScene =
  (name: string | RegExp): SceneStep =>
  s =>
    s.click(HtmlLocator.role('button', { name }))

// NOTE: the Look tab's radio groups in a Scene: a group by its label, an
// option in it by name, and its little tabs.
export const lookGroup = (name: string) =>
  HtmlLocator.role('radiogroup', { name })

export const lookOptionIn: {
  (name: string): (groupName: string) => Locator.Locator
  (groupName: string, name: string): Locator.Locator
} = Function.dual(2, (groupName: string, name: string): Locator.Locator =>
  Locator.inside(lookGroup(groupName), HtmlLocator.role('radio', { name })),
)

export const lookSection = (name: string) => lookOptionIn('Parts', name)
