import { Array, Effect, Match } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, test, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../app/message'
import { Boss, BreakClock, type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { wavePreviewShapes } from '../../features/hud/wavePreview'
import { restoreSave, saveOf } from '../../platform/save'
import { hudShapes } from '../../screens/game/hud'
import { isTurnHintShown } from '../../screens/home/home'
import { TURN_HINT_TEXT } from '../../screens/home/homeView'
import { DISTANT_SPAWN, inPortrait } from '../../test/model.fixture'
import {
  ackHudSlots,
  byClass,
  expectAttr,
  expectStyle,
  measureSurfaceAs,
  statusLine,
} from '../../test/sceneTesting'
import {
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  type SceneStep,
  exactSceneOf,
  modelAfter,
  modelAfterMessages,
  send,
  steps,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { rectsOf } from '../../test/viewReading'
import { modifyFocus } from '../../world/party/party'
import { screenCameraOf } from '../camera'
import type * as Draw from '../draw'
import { MELEE_SLOT_INDEX, gunSlotBox, reloadFaceOf } from '../hudLayout'
import { screenOf, thumbAreaTop } from '../screen'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const boxesOf = (
  shapes: ReadonlyArray<Draw.Shape>,
  offset: Readonly<{ x: number; y: number }>,
): ReadonlyArray<Box> =>
  Array.flatMap(shapes, (shape): ReadonlyArray<Box> =>
    Match.value(shape).pipe(
      Match.tag('Group', group =>
        boxesOf(group.shapes, {
          x: offset.x + (group.translate?.x ?? 0),
          y: offset.y + (group.translate?.y ?? 0),
        }),
      ),
      Match.tag('Rect', 'Image', ({ x, y, width, height }) => [
        { x: x + offset.x, y: y + offset.y, width, height },
      ]),
      Match.orElse(() => []),
    ),
  )

const onTouch = (phase: Phase): Model =>
  UiStruct.evolve(asVeteran(initialModel), {
    lastDevice: () => 'Touch',
    phase: () => phase,
  })

const fighting = onTouch(
  Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
)

const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'

const gunSlotFills = (model: Model): ReadonlyArray<Box> =>
  Array.filter(
    rectsOf(hudShapes(model, screenOf(model), screenCameraOf(model)), {
      x: 0,
      y: 0,
    }),
    rect =>
      rect.fill === SLOT_FILL &&
      rect.width === gunSlotBox(screenOf(model), 0).width - 2,
  )

const root = byClass('game-root')
const measure =
  (surface: typeof PHONE_PORTRAIT): SceneStep =>
  s =>
    s.pipe(measureSurfaceAs(surface), ackHudSlots)

const remeasured = (
  model: Model,
  surfaces: ReadonlyArray<typeof PHONE_PORTRAIT>,
) =>
  modelAfterMessages(
    model,
    Array.map(surfaces, surface => Message.MeasuredGameSurface(surface)),
  )

describe('the portrait HUD and thumb area', () => {
  test('the guns sit in the thumb area under the world window', () => {
    const portrait = inPortrait(fighting)
    const screen = screenOf(portrait)
    const slots = gunSlotFills(portrait)
    vitestExpect(slots).toHaveLength(2)
    Array.forEach(slots, slot => {
      vitestExpect(slot.y).toBeGreaterThan(thumbAreaTop(screen))
      vitestExpect(slot.y + slot.height).toBeLessThanOrEqual(screen.height)
      vitestExpect(slot.x).toBeGreaterThanOrEqual(0)
      vitestExpect(slot.x + slot.width).toBeLessThanOrEqual(screen.width)
    })
  })

  test('the guns sit centered on the screen, in portrait and in landscape', () => {
    Array.forEach([inPortrait(fighting), fighting], current => {
      const screen = screenOf(current)
      const slots = gunSlotFills(current)
      const left = Math.min(...Array.map(slots, slot => slot.x))
      const right = Math.max(...Array.map(slots, slot => slot.x + slot.width))
      vitestExpect(
        Math.abs((left + right) / 2 - screen.width / 2),
      ).toBeLessThanOrEqual(1)
    })
  })

  it.effect('the reload button sits in the row, past the melee slot', () =>
    Effect.map(
      exactSceneOf(fighting),
      steps(
        measure(PHONE_PORTRAIT),
        expectAttr(byClass('reload-button'), 'data-layout', 'Portrait'),
        expectStyle(byClass('reload-button'), 'bottom', '0px'),
        expectStyle(byClass('reload-button'), 'height', '100%'),
      ),
    ),
  )

  test('the guns, the melee slot, and a square reload button fit one row, each a thumb wide', () => {
    const screen = screenOf(inPortrait(fighting))
    const thumb = 48 / 2
    const [first, second, melee] = Array.map([0, 1, MELEE_SLOT_INDEX], index =>
      gunSlotBox(screen, index),
    )
    const face = reloadFaceOf(screen)
    vitestExpect(face.width).toBe(face.height)
    vitestExpect(face.height).toBe(melee!.height)
    const reloadLeft = melee!.x + melee!.width + 3
    const reloadRight = reloadLeft + Math.max(thumb, face.width)
    vitestExpect(reloadRight).toBeLessThanOrEqual(screen.width - 2)
    Array.forEach([first!, second!, melee!], box => {
      vitestExpect(box.width).toBeGreaterThanOrEqual(thumb)
      vitestExpect(box.y).toBe(melee!.y)
    })
    vitestExpect(second!.x).toBeGreaterThan(first!.x + first!.width)
    vitestExpect(melee!.x).toBeGreaterThan(second!.x + second!.width)
  })

  test('the hearts, money, and wave label sit in the band above the world window', () => {
    const portrait = inPortrait(fighting)
    const screen = screenOf(portrait)
    const rects = boxesOf(
      hudShapes(portrait, screen, screenCameraOf(portrait)),
      {
        x: 0,
        y: 0,
      },
    )
    const topRects = Array.filter(rects, rect => rect.y < screen.world.y)
    const lowRects = Array.filter(
      rects,
      rect => rect.y >= screen.world.y + screen.world.height,
    )
    vitestExpect(
      Array.every(rects, rect => rect.x + rect.width <= screen.width),
    ).toBe(true)
    vitestExpect(Array.isReadonlyArrayNonEmpty(topRects)).toBe(true)
    vitestExpect(Array.isReadonlyArrayNonEmpty(lowRects)).toBe(true)
    vitestExpect(
      Array.filter(
        rects,
        rect =>
          rect.y >= screen.world.y &&
          rect.y + rect.height <= screen.world.y + screen.world.height,
      ),
    ).toHaveLength(0)
  })

  it.effect('the gun cluster buttons follow the guns into the thumb area', () =>
    Effect.map(
      exactSceneOf(fighting),
      steps(
        measure(PHONE_PORTRAIT),
        expectAttr(root, 'data-layout', 'Portrait'),
        expectAttr(byClass('gun-cluster'), 'data-layout', 'Portrait'),
        expectStyle(byClass('gun-cluster'), 'bottom', '1.2820512820512822%'),
        sc =>
          sc
            .expect(
              Locator.inside(
                byClass('gun-cluster'),
                HtmlLocator.role('group', { name: 'Your guns' }),
              ),
            )
            .toExist(),
        sc =>
          sc.expect(HtmlLocator.role('button', { name: 'Pause' })).toExist(),
      ),
    ),
  )
})

describe('turning the phone', () => {
  it.effect('switches the layout live mid-wave and keeps fighting', () =>
    Effect.gen(function* () {
      yield* Effect.map(
        exactSceneOf(fighting),
        steps(
          measure(PHONE_LANDSCAPE),
          expectAttr(root, 'data-layout', 'Landscape'),
          expectStyle(root, '--screen-w', '388'),
          expectStyle(root, '--screen-h', '180'),
          sc => sc.expect(statusLine).toHaveText('Fighting wave 3.'),
        ),
      )
      const wide = yield* remeasured(fighting, [PHONE_LANDSCAPE])
      yield* Effect.map(
        exactSceneOf(wide),
        steps(
          measure(PHONE_PORTRAIT),
          expectAttr(root, 'data-layout', 'Portrait'),
          expectStyle(root, '--screen-w', '180'),
          expectStyle(root, '--screen-h', '390'),
          sc => sc.expect(statusLine).toHaveText('Fighting wave 3.'),
          sc =>
            sc
              .expect(
                HtmlLocator.role('dialog', {
                  name: 'Turn your phone sideways',
                }),
              )
              .toBeAbsent(),
          sc =>
            sc
              .expect(HtmlLocator.role('group', { name: 'Your guns' }))
              .toExist(),
          expectStyle(root, '--frame-top', '74'),
          sc => sc.expect(byClass('thumb-area')).toExist(),
        ),
      )
      const turned = yield* remeasured(fighting, [
        PHONE_LANDSCAPE,
        PHONE_PORTRAIT,
      ])
      yield* Effect.map(
        exactSceneOf(turned),
        steps(
          measure(PHONE_LANDSCAPE),
          expectAttr(root, 'data-layout', 'Landscape'),
          expectStyle(root, '--frame-top', '0'),
          sc => sc.expect(byClass('thumb-area')).toBeAbsent(),
          sc => sc.expect(statusLine).toHaveText('Fighting wave 3.'),
        ),
      )
    }),
  )

  it.effect(
    'a keyboard and mouse keep the landscape layout in a tall window',
    () =>
      Effect.map(
        exactSceneOf(
          UiStruct.evolve(fighting, { lastDevice: () => 'KeyboardMouse' }),
        ),
        steps(
          measure(PHONE_PORTRAIT),
          expectAttr(root, 'data-layout', 'Landscape'),
          sc => sc.expect(statusLine).toHaveText('Fighting wave 3.'),
        ),
      ),
  )
})

describe('the world zoom on phones', () => {
  const worldView = byClass('world-view')
  const worldWindow = byClass('world-window')

  it.effect(
    'a 19.5:9 phone on its side draws 291 by 135 of the room over the whole screen',
    () =>
      Effect.map(
        exactSceneOf(fighting),
        steps(
          measure(PHONE_LANDSCAPE),
          expectAttr(root, 'data-layout', 'Landscape'),
          expectAttr(worldView, 'data-view-width', '291'),
          expectAttr(worldView, 'data-view-height', '135'),
          expectStyle(worldWindow, 'width', '100%'),
          expectStyle(worldWindow, 'height', '100%'),
        ),
      ),
  )

  it.effect(
    'a 16:9 phone on its side draws 240 by 135 of the room on a 320 screen',
    () =>
      Effect.map(
        exactSceneOf(fighting),
        steps(
          measure({ left: 0, top: 0, width: 667, height: 375 }),
          expectStyle(root, '--screen-w', '320'),
          expectAttr(worldView, 'data-view-width', '240'),
          expectAttr(worldView, 'data-view-height', '135'),
        ),
      ),
  )

  it.effect(
    'a phone held upright draws 120 by 160 of the room in the window over the thumbs',
    () =>
      Effect.map(
        exactSceneOf(fighting),
        steps(
          measure(PHONE_PORTRAIT),
          expectAttr(root, 'data-layout', 'Portrait'),
          expectAttr(worldView, 'data-view-width', '120'),
          expectAttr(worldView, 'data-view-height', '160'),
          expectStyle(worldWindow, 'height', `${(240 / 390) * 100}%`),
          sc => sc.expect(byClass('thumb-area')).toExist(),
        ),
      ),
  )

  it.effect(
    'a keyboard and mouse draw the whole room, in a wide or a tall window',
    () =>
      Effect.forEach([PHONE_LANDSCAPE, PHONE_PORTRAIT], surface =>
        Effect.map(
          exactSceneOf(
            UiStruct.evolve(fighting, { lastDevice: () => 'KeyboardMouse' }),
          ),
          steps(
            measure(surface),
            expectAttr(worldView, 'data-view-width', '320'),
            expectAttr(worldView, 'data-view-height', '180'),
          ),
        ),
      ),
  )
})

describe('the portrait home menu', () => {
  it.effect(
    'keeps every slot: the player, the MORE deck, and PLAY alone with CO-OP, and no bests badge before a best',
    () =>
      Effect.map(
        exactSceneOf(onTouch(Phase.Ready())),
        steps(
          measure(PHONE_PORTRAIT),
          expectAttr(root, 'data-layout', 'Portrait'),
          sc =>
            sc.expect(HtmlLocator.role('button', { name: /^More:/ })).toExist(),
          sc =>
            sc
              .expect(HtmlLocator.role('region', { name: /^Your bests/ }))
              .toBeAbsent(),
          sc =>
            sc.expect(HtmlLocator.role('group', { name: 'Play' })).toExist(),
          sc =>
            sc.expect(HtmlLocator.role('button', { name: /^Play/ })).toExist(),
          sc =>
            sc
              .expect(HtmlLocator.role('button', { name: /^Difficulty/ }))
              .toBeAbsent(),
          sc => sc.expect(byClass('home-hero')).toExist(),
        ),
      ),
  )
})

describe('the turn hint', () => {
  const turnHint = HtmlLocator.role('button', { name: TURN_HINT_TEXT })

  it.effect(
    'shows the tipping phone with its line on the portrait home menu',
    () =>
      Effect.map(
        exactSceneOf(onTouch(Phase.Ready())),
        steps(
          measure(PHONE_PORTRAIT),
          sc => sc.expect(turnHint).toExist(),
          sc => sc.expect(byClass('home-turn-hint')).toExist(),
          sc => sc.expect(byClass('home-turn-icon')).toExist(),
          sc => sc.expect(Locator.text(TURN_HINT_TEXT)).toExist(),
        ),
      ),
  )

  it.effect(
    'goes when the phone turns, and does not come back when it turns upright again',
    () =>
      Effect.gen(function* () {
        const upright = yield* remeasured(onTouch(Phase.Ready()), [
          PHONE_PORTRAIT,
        ])
        yield* Effect.map(
          exactSceneOf(upright),
          steps(
            measure(PHONE_LANDSCAPE),
            expectAttr(root, 'data-layout', 'Landscape'),
            sc => sc.expect(turnHint).toBeAbsent(),
          ),
        )
        const turnedBack = yield* remeasured(onTouch(Phase.Ready()), [
          PHONE_PORTRAIT,
          PHONE_LANDSCAPE,
        ])
        yield* Effect.map(
          exactSceneOf(turnedBack),
          steps(
            measure(PHONE_PORTRAIT),
            expectAttr(root, 'data-layout', 'Portrait'),
            sc => sc.expect(turnHint).toBeAbsent(),
          ),
        )
      }),
  )

  it.effect(
    'goes on a tap and stays gone, leaving PLAY and the rest to tap',
    () =>
      Effect.map(
        exactSceneOf(onTouch(Phase.Ready())),
        steps(
          measure(PHONE_PORTRAIT),
          sc =>
            sc.expect(HtmlLocator.role('button', { name: /^Play/ })).toExist(),
          sc => sc.click(turnHint),
          sc => sc.expect(turnHint).toBeAbsent(),
          sc =>
            sc.expect(HtmlLocator.role('button', { name: /^Play/ })).toExist(),
        ),
      ),
  )

  it.effect(
    'is not shown again once the save of a player who dismissed it is loaded',
    () =>
      Effect.gen(function* () {
        const upright = yield* remeasured(onTouch(Phase.Ready()), [
          PHONE_PORTRAIT,
        ])
        vitestExpect(isTurnHintShown(upright)).toBe(true)
        const dismissed = yield* modelAfter(
          upright,
          send(Message.ClickedTurnHint()),
        )
        const saved = saveOf(dismissed)
        vitestExpect(saved.home.turnHintSeen).toBe(true)
        const reloaded = yield* remeasured(
          restoreSave(onTouch(Phase.Ready()), saved),
          [PHONE_PORTRAIT],
        )
        vitestExpect(isTurnHintShown(reloaded)).toBe(false)
        yield* Effect.map(
          exactSceneOf(reloaded),
          steps(measure(PHONE_PORTRAIT), sc =>
            sc.expect(turnHint).toBeAbsent(),
          ),
        )
      }),
  )

  it.effect('is not on the landscape home menu', () =>
    Effect.map(
      exactSceneOf(onTouch(Phase.Ready())),
      steps(
        measure(PHONE_LANDSCAPE),
        sc => sc.expect(HtmlLocator.role('group', { name: 'Play' })).toExist(),
        sc => sc.expect(turnHint).toBeAbsent(),
      ),
    ),
  )

  it.effect('is not shown mid-run in portrait', () =>
    Effect.map(
      exactSceneOf(fighting),
      steps(
        measure(PHONE_PORTRAIT),
        expectAttr(root, 'data-layout', 'Portrait'),
        sc => sc.expect(turnHint).toBeAbsent(),
      ),
    ),
  )

  it.effect('is not shown on a keyboard and mouse in a tall window', () =>
    Effect.map(
      exactSceneOf(
        UiStruct.evolve(onTouch(Phase.Ready()), {
          lastDevice: () => 'KeyboardMouse',
        }),
      ),
      steps(
        measure(PHONE_PORTRAIT),
        sc => sc.expect(HtmlLocator.role('group', { name: 'Play' })).toExist(),
        sc => sc.expect(turnHint).toBeAbsent(),
      ),
    ),
  )
})

describe('the portrait wave preview', () => {
  test('pins the boss marker of a door out of view to the window edge', () => {
    const breakAtWestWall = inPortrait(
      modifyFocus(
        onTouch(
          Phase.Preparation({
            wave: 3,
            remainingMs: 15000,
            durationMs: 20000,
            spawns: Array.flatMap(
              ['North', 'East', 'West', 'South'] as const,
              door => [{ ...DISTANT_SPAWN, atMs: 1000, door }],
            ),
            clock: BreakClock.Counting(),
          }),
        ),
        { player: player => ({ ...player, x: 40, y: 90 }) },
      ),
    )
    const withChunk = UiStruct.evolve(breakAtWestWall, {
      boss: () =>
        Boss.Waiting({
          door: 'North',
          waitBelow: 20,
          hp: 300,
          guestHpScale: 1,
        }),
    })
    const screen = screenOf(withChunk)
    const rects = rectsOf(
      wavePreviewShapes(withChunk, screenCameraOf(withChunk)),
      { x: 0, y: 0 },
    )
    vitestExpect(rects.length).toBeGreaterThan(0)
    Array.forEach(rects, rect => {
      vitestExpect(rect.x).toBeGreaterThanOrEqual(screen.world.x)
      vitestExpect(rect.x + rect.width).toBeLessThanOrEqual(
        screen.world.x + screen.world.width,
      )
    })
  })

  test('points at no door during a wave', () => {
    const waveAtWestWall = inPortrait(
      modifyFocus(
        onTouch(
          Phase.Wave({
            wave: 3,
            elapsedMs: 500,
            spawns: Array.flatMap(
              ['North', 'East', 'West', 'South'] as const,
              door => [{ ...DISTANT_SPAWN, atMs: 1000, door }],
            ),
          }),
        ),
        { player: player => ({ ...player, x: 40, y: 90 }) },
      ),
    )
    vitestExpect(
      wavePreviewShapes(waveAtWestWall, screenCameraOf(waveAtWestWall)),
    ).toEqual([])
  })
})
