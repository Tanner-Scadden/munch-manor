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

const HUD_SLOTS = ['First', 'Second', 'Melee'] as const

export const ackHudSlots: SceneStep = s =>
  Array.reduce(HUD_SLOTS, s, (current, slot) =>
    Array.isReadonlyArrayNonEmpty(
      current.all(withAttrs({ 'data-slot': slot })(byClass('gun-slot-button'))),
    )
      ? current.expectMount(PressHudSlot({ slot }))
      : current,
  )

export const measureHud: SceneStep = s => s.pipe(measureSurface, ackHudSlots)

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

export const shareMountSettles =
  (outcome: ShareOutcome): SceneStep =>
  s =>
    s.mounted(ShareFromClick, Message.SettledShare({ outcome }))

const shareMountRuns: SceneStep = s => s.expectMount(ShareFromClick({}))

export const settleEndShareOf =
  (model: Model): SceneStep =>
  s =>
    endOffer(model) === 'MenuAndModes' ? shareMountRuns(s) : s

export const openLobbyInScene: SceneStep = steps(
  s => s.click(HtmlLocator.role('button', { name: 'Play' })),
  resolveFocusLobby(),
)

export const startIntoIntroInScene: SceneStep = steps(openLobbyInScene, s =>
  s.childEmit(Lobby, 'lobby', LobbyEvents.RequestedStart()),
)

export const startRunInScene: SceneStep = steps(
  startIntoIntroInScene,
  throughIntroInScene,
  readDareCardInScene,
)

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

export const pauseByButton: SceneStep = s =>
  s.click(pauseButton).expectMount(PressGameSurface())

export const pausePressRuns: SceneStep = s => s.expectMount(PressGameSurface())

export const clickOn =
  (locator: Locator.Locator): SceneStep =>
  s =>
    s.click(locator)

type ViewNode = AppScene['view']

export const childrenOf = (node: ViewNode): ReadonlyArray<ViewNode> =>
  Match.value(node).pipe(
    Match.tag('Element', element =>
      Array.flatMap(element.children, childrenOf),
    ),
    Match.tag('Child', child => [child]),
    Match.orElse(() => []),
  )

export const firstOf = (locator: Locator.Locator): Locator.Locator => ({
  description: `the first ${locator.description}`,
  all: root => Array.take(locator.all(root), 1),
})

export const statusLine = firstOf(HtmlLocator.role('status'))

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

export const button = (name: string | RegExp) =>
  HtmlLocator.role('button', { name })

export const lobbyMode = (name: string) => HtmlLocator.role('button', { name })

export const lockedNightmare = HtmlLocator.role('button', {
  name: 'Triple Dog Dare, locked. Escape on Triple Dare to unlock',
})

export const playEndlessButton = withAttrs({ 'data-mode': 'Endless' })(
  byClass('home-play'),
)

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

export const openHandInScene: SceneStep = s => s.click(manorButton)

export const pickCardInScene =
  (name: string | RegExp): SceneStep =>
  s =>
    s.click(HtmlLocator.role('button', { name }))

export const lookGroup = (name: string) =>
  HtmlLocator.role('radiogroup', { name })

export const lookOptionIn: {
  (name: string): (groupName: string) => Locator.Locator
  (groupName: string, name: string): Locator.Locator
} = Function.dual(2, (groupName: string, name: string): Locator.Locator =>
  Locator.inside(lookGroup(groupName), HtmlLocator.role('radio', { name })),
)

export const lookSection = (name: string) => lookOptionIn('Parts', name)
