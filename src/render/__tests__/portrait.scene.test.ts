import { Array, Effect, Match } from 'effect'
import { type Canvas, Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, test, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../app/message'
import { BreakClock, type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { wavePreviewShapes } from '../../features/hud/wavePreview'
import { restoreSave, saveOf } from '../../platform/save'
import { hudShapes } from '../../screens/game/hud'
import { isTurnHintShown } from '../../screens/home/home'
import { TURN_HINT_TEXT } from '../../screens/home/homeView'
import { DISTANT_SPAWN, inPortrait } from '../../test/model.fixture'
import {
  APPLICATION,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  measureSurfaceAs,
  modelAfterMessages,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { rectsOf } from '../../test/viewReading'
import { modifyFocus } from '../../world/party/party'
import { screenCameraOf } from '../camera'
import { MELEE_SLOT_INDEX, gunSlotBox, reloadFaceOf } from '../hudLayout'
import { screenOf, thumbAreaTop } from '../screen'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const boxesOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
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
  modifyFields(asVeteran(initialModel), {
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

const root = Scene.selector('.game-root')
const measure = (surface: typeof PHONE_PORTRAIT) => measureSurfaceAs(surface)

// NOTE: the surface's MeasureGameSurface Mount reports once per Scene, so a
// phone turning mid-scene is a new Scene on the Model the earlier
// measurements left, whose Mount then reports the new size.
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
    Scene.scene(
      APPLICATION,
      Scene.given(fighting),
      measure(PHONE_PORTRAIT),
      Scene.expect(Scene.selector('.reload-button')).toHaveAttr(
        'data-layout',
        'Portrait',
      ),
      Scene.expect(Scene.selector('.reload-button')).toHaveStyle(
        'bottom',
        '0px',
      ),
      Scene.expect(Scene.selector('.reload-button')).toHaveStyle(
        'height',
        '100%',
      ),
    ),
  )

  // NOTE: a 360 px phone held upright is the narrowest, at 2 CSS pixels to a
  // HUD pixel, so a 48 px target is 24 HUD pixels there.
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
    Scene.scene(
      APPLICATION,
      Scene.given(fighting),
      measure(PHONE_PORTRAIT),
      Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
      Scene.expect(Scene.selector('.gun-cluster')).toHaveAttr(
        'data-layout',
        'Portrait',
      ),
      Scene.expect(Scene.selector('.gun-cluster')).toHaveStyle(
        'bottom',
        '1.2820512820512822%',
      ),
      Scene.expect(
        Scene.within(
          Scene.selector('.gun-cluster'),
          Scene.role('group', { name: 'Your guns' }),
        ),
      ).toExist(),
      Scene.expect(Scene.role('button', { name: 'Pause' })).toExist(),
    ),
  )
})

describe('turning the phone', () => {
  it.effect('switches the layout live mid-wave and keeps fighting', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measure(PHONE_LANDSCAPE),
        Scene.expect(root).toHaveAttr('data-layout', 'Landscape'),
        Scene.expect(root).toHaveStyle('--screen-w', '388'),
        Scene.expect(root).toHaveStyle('--screen-h', '180'),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 3.'),
      )
      const wide = yield* remeasured(fighting, [PHONE_LANDSCAPE])
      yield* Scene.scene(
        APPLICATION,
        Scene.given(wide),
        measure(PHONE_PORTRAIT),
        Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
        Scene.expect(root).toHaveStyle('--screen-w', '180'),
        Scene.expect(root).toHaveStyle('--screen-h', '390'),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 3.'),
        Scene.expect(
          Scene.role('dialog', { name: 'Turn your phone sideways' }),
        ).toBeAbsent(),
        Scene.expect(Scene.role('group', { name: 'Your guns' })).toExist(),
        Scene.expect(root).toHaveStyle('--frame-top', '74'),
        Scene.expect(Scene.selector('.thumb-area')).toExist(),
      )
      const turned = yield* remeasured(fighting, [
        PHONE_LANDSCAPE,
        PHONE_PORTRAIT,
      ])
      yield* Scene.scene(
        APPLICATION,
        Scene.given(turned),
        measure(PHONE_LANDSCAPE),
        Scene.expect(root).toHaveAttr('data-layout', 'Landscape'),
        Scene.expect(root).toHaveStyle('--frame-top', '0'),
        Scene.expect(Scene.selector('.thumb-area')).toBeAbsent(),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 3.'),
      )
    }),
  )

  it.effect(
    'a keyboard and mouse keep the landscape layout in a tall window',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(fighting, { lastDevice: () => 'KeyboardMouse' }),
        ),
        measure(PHONE_PORTRAIT),
        Scene.expect(root).toHaveAttr('data-layout', 'Landscape'),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 3.'),
      ),
  )
})

describe('the world zoom on phones', () => {
  const worldCanvas = Scene.selector('.game-canvas')
  const worldWindow = Scene.selector('.world-window')

  it.effect(
    'a 19.5:9 phone on its side draws 291 by 135 of the room over the whole screen',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measure(PHONE_LANDSCAPE),
        Scene.expect(root).toHaveAttr('data-layout', 'Landscape'),
        Scene.expect(worldCanvas).toHaveAttr('width', '291'),
        Scene.expect(worldCanvas).toHaveAttr('height', '135'),
        Scene.expect(worldWindow).toHaveStyle('width', '100%'),
        Scene.expect(worldWindow).toHaveStyle('height', '100%'),
      ),
  )

  it.effect(
    'a 16:9 phone on its side draws 240 by 135 of the room on a 320 screen',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measure({ left: 0, top: 0, width: 667, height: 375 }),
        Scene.expect(root).toHaveStyle('--screen-w', '320'),
        Scene.expect(worldCanvas).toHaveAttr('width', '240'),
        Scene.expect(worldCanvas).toHaveAttr('height', '135'),
      ),
  )

  it.effect(
    'a phone held upright draws 120 by 160 of the room in the window over the thumbs',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measure(PHONE_PORTRAIT),
        Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
        Scene.expect(worldCanvas).toHaveAttr('width', '120'),
        Scene.expect(worldCanvas).toHaveAttr('height', '160'),
        Scene.expect(worldWindow).toHaveStyle(
          'height',
          `${(240 / 390) * 100}%`,
        ),
        Scene.expect(Scene.selector('.thumb-area')).toExist(),
      ),
  )

  it.effect(
    'a keyboard and mouse draw the whole room, in a wide or a tall window',
    () =>
      Effect.forEach([PHONE_LANDSCAPE, PHONE_PORTRAIT], surface =>
        Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFields(fighting, { lastDevice: () => 'KeyboardMouse' }),
          ),
          measure(surface),
          Scene.expect(worldCanvas).toHaveAttr('width', '320'),
          Scene.expect(worldCanvas).toHaveAttr('height', '180'),
        ),
      ),
  )
})

describe('the portrait home menu', () => {
  it.effect(
    'keeps every slot: the player, the MORE deck, and PLAY alone with CO-OP, and no bests badge before a best',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onTouch(Phase.Ready())),
        measure(PHONE_PORTRAIT),
        Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
        Scene.expect(Scene.role('button', { name: /^More:/ })).toExist(),
        Scene.expect(
          Scene.role('region', { name: /^Your bests/ }),
        ).toBeAbsent(),
        Scene.expect(Scene.role('group', { name: 'Play' })).toExist(),
        Scene.expect(Scene.role('button', { name: /^Play/ })).toExist(),
        Scene.expect(
          Scene.role('button', { name: /^Difficulty/ }),
        ).toBeAbsent(),
        Scene.expect(Scene.selector('.home-hero')).toExist(),
      ),
  )
})

describe('the turn hint', () => {
  const turnHint = Scene.role('button', { name: TURN_HINT_TEXT })

  it.effect(
    'shows the tipping phone with its line on the portrait home menu',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onTouch(Phase.Ready())),
        measure(PHONE_PORTRAIT),
        Scene.expect(turnHint).toExist(),
        Scene.expect(Scene.selector('.home-turn-hint')).toExist(),
        Scene.expect(Scene.selector('.home-turn-icon')).toExist(),
        Scene.expect(Scene.text(TURN_HINT_TEXT)).toExist(),
      ),
  )

  it.effect(
    'goes when the phone turns, and does not come back when it turns upright again',
    () =>
      Effect.gen(function* () {
        const upright = yield* remeasured(onTouch(Phase.Ready()), [
          PHONE_PORTRAIT,
        ])
        yield* Scene.scene(
          APPLICATION,
          Scene.given(upright),
          measure(PHONE_LANDSCAPE),
          Scene.expect(root).toHaveAttr('data-layout', 'Landscape'),
          Scene.expect(turnHint).toBeAbsent(),
        )
        const turnedBack = yield* remeasured(onTouch(Phase.Ready()), [
          PHONE_PORTRAIT,
          PHONE_LANDSCAPE,
        ])
        yield* Scene.scene(
          APPLICATION,
          Scene.given(turnedBack),
          measure(PHONE_PORTRAIT),
          Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
          Scene.expect(turnHint).toBeAbsent(),
        )
      }),
  )

  it.effect(
    'goes on a tap and stays gone, leaving PLAY and the rest to tap',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onTouch(Phase.Ready())),
        measure(PHONE_PORTRAIT),
        Scene.expect(Scene.role('button', { name: /^Play/ })).toExist(),
        Scene.click(turnHint),
        Scene.expect(turnHint).toBeAbsent(),
        Scene.expect(Scene.role('button', { name: /^Play/ })).toExist(),
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
        const dismissed = yield* Story.story(
          APPLICATION,
          Story.given(upright),
          Story.message(Message.ClickedTurnHint()),
        )
        const saved = saveOf(dismissed)
        vitestExpect(saved.home.turnHintSeen).toBe(true)
        const reloaded = yield* remeasured(
          restoreSave(onTouch(Phase.Ready()), saved),
          [PHONE_PORTRAIT],
        )
        vitestExpect(isTurnHintShown(reloaded)).toBe(false)
        yield* Scene.scene(
          APPLICATION,
          Scene.given(reloaded),
          measure(PHONE_PORTRAIT),
          Scene.expect(turnHint).toBeAbsent(),
        )
      }),
  )

  it.effect('is not on the landscape home menu', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onTouch(Phase.Ready())),
      measure(PHONE_LANDSCAPE),
      Scene.expect(Scene.role('group', { name: 'Play' })).toExist(),
      Scene.expect(turnHint).toBeAbsent(),
    ),
  )

  it.effect('is not shown mid-run in portrait', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fighting),
      measure(PHONE_PORTRAIT),
      Scene.expect(root).toHaveAttr('data-layout', 'Portrait'),
      Scene.expect(turnHint).toBeAbsent(),
    ),
  )

  it.effect('is not shown on a keyboard and mouse in a tall window', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(onTouch(Phase.Ready()), {
          lastDevice: () => 'KeyboardMouse',
        }),
      ),
      measure(PHONE_PORTRAIT),
      Scene.expect(Scene.role('group', { name: 'Play' })).toExist(),
      Scene.expect(turnHint).toBeAbsent(),
    ),
  )
})

describe('the portrait door preview', () => {
  test('pins the markers of doors out of view to the window edge', () => {
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
    const screen = screenOf(breakAtWestWall)
    const rects = rectsOf(
      wavePreviewShapes(breakAtWestWall, screenCameraOf(breakAtWestWall)),
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
