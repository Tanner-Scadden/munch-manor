import { Array, Match } from 'effect'
import type { Canvas } from 'foldkit'
import {
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { screenCameraOf } from './camera'
import { isTurnHintShown } from './home'
import { TURN_HINT_TEXT } from './homeView'
import { MELEE_SLOT_INDEX, gunSlotBox, hudShapes, reloadFaceOf } from './hud'
import { update } from './main'
import { Message } from './message'
import { BreakClock, type Model, Phase, initialModel } from './model'
import { DISTANT_SPAWN, inPortrait } from './model.fixture'
import { restoreSave, saveOf } from './save'
import { screenOf, thumbAreaTop } from './screen'
import {
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  ROOT,
  measureSurfaceAs,
  rectsOf,
} from './testing'
import { asVeteran } from './veteran'
import { wavePreviewShapes } from './wavePreview'

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

const root = selector('.game-root')
const measure = (surface: typeof PHONE_PORTRAIT) => measureSurfaceAs(surface)

// NOTE: the surface's MeasureGameSurface Mount reports once per Scene, so a
// phone turning mid-scene is a new Scene on the Model the earlier
// measurements left, whose Mount then reports the new size.
const remeasured = (
  model: Model,
  surfaces: ReadonlyArray<typeof PHONE_PORTRAIT>,
): Model =>
  surfaces.reduce(
    (current, surface) =>
      update(current, Message.MeasuredGameSurface(surface)).model,
    model,
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

  test('the reload button sits in the row, past the melee slot', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(selector('.reload-button')).toHaveAttr('data-layout', 'Portrait'),
      expect(selector('.reload-button')).toHaveStyle('bottom', '0px'),
      expect(selector('.reload-button')).toHaveStyle('height', '100%'),
    )
  })

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

  test('the gun cluster buttons follow the guns into the thumb area', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(selector('.gun-cluster')).toHaveAttr('data-layout', 'Portrait'),
      expect(selector('.gun-cluster')).toHaveStyle(
        'bottom',
        '1.2820512820512822%',
      ),
      expect(
        within(selector('.gun-cluster'), role('group', { name: 'Your guns' })),
      ).toExist(),
      expect(role('button', { name: 'Pause' })).toExist(),
    )
  })
})

describe('turning the phone', () => {
  test('switches the layout live mid-wave and keeps fighting', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(root).toHaveStyle('--screen-w', '320'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
    scene(
      ROOT,
      given(remeasured(fighting, [PHONE_LANDSCAPE])),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(root).toHaveStyle('--screen-w', '180'),
      expect(root).toHaveStyle('--screen-h', '390'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
      expect(role('dialog', { name: 'Turn your phone sideways' })).toBeAbsent(),
      expect(role('group', { name: 'Your guns' })).toExist(),
      expect(root).toHaveStyle('--frame-top', '74'),
      expect(selector('.thumb-area')).toExist(),
    )
    scene(
      ROOT,
      given(remeasured(fighting, [PHONE_LANDSCAPE, PHONE_PORTRAIT])),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(root).toHaveStyle('--frame-top', '0'),
      expect(selector('.thumb-area')).toBeAbsent(),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
  })

  test('a keyboard and mouse keep the landscape layout in a tall window', () => {
    scene(
      ROOT,
      given(modifyFields(fighting, { lastDevice: () => 'KeyboardMouse' })),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
  })
})

describe('the world zoom on phones', () => {
  const worldCanvas = selector('.game-canvas')
  const worldWindow = selector('.world-window')

  test('a phone on its side draws 240 by 135 of the room over the whole screen', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(worldCanvas).toHaveAttr('width', '240'),
      expect(worldCanvas).toHaveAttr('height', '135'),
      expect(worldWindow).toHaveStyle('width', '100%'),
      expect(worldWindow).toHaveStyle('height', '100%'),
    )
  })

  test('a phone held upright draws 120 by 160 of the room in the window over the thumbs', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(worldCanvas).toHaveAttr('width', '120'),
      expect(worldCanvas).toHaveAttr('height', '160'),
      expect(worldWindow).toHaveStyle('height', `${(240 / 390) * 100}%`),
      expect(selector('.thumb-area')).toExist(),
    )
  })

  test('a keyboard and mouse draw the whole room, in a wide or a tall window', () => {
    Array.forEach([PHONE_LANDSCAPE, PHONE_PORTRAIT], surface => {
      scene(
        ROOT,
        given(modifyFields(fighting, { lastDevice: () => 'KeyboardMouse' })),
        measure(surface),
        expect(worldCanvas).toHaveAttr('width', '320'),
        expect(worldCanvas).toHaveAttr('height', '180'),
      )
    })
  })
})

describe('the portrait home menu', () => {
  test('keeps every slot: the player, the MORE deck, and PLAY alone with CO-OP, and no bests badge before a best', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(role('button', { name: /^More:/ })).toExist(),
      expect(role('region', { name: /^Your bests/ })).toBeAbsent(),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(role('button', { name: /^Play/ })).toExist(),
      expect(role('button', { name: /^Difficulty/ })).toBeAbsent(),
      expect(selector('.home-hero')).toExist(),
    )
  })
})

describe('the turn hint', () => {
  const turnHint = role('button', { name: TURN_HINT_TEXT })

  test('shows the tipping phone with its line on the portrait home menu', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_PORTRAIT),
      expect(turnHint).toExist(),
      expect(selector('.home-turn-hint')).toExist(),
      expect(selector('.home-turn-icon')).toExist(),
      expect(text(TURN_HINT_TEXT)).toExist(),
    )
  })

  test('goes when the phone turns, and does not come back when it turns upright again', () => {
    scene(
      ROOT,
      given(remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT])),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(turnHint).toBeAbsent(),
    )
    scene(
      ROOT,
      given(
        remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT, PHONE_LANDSCAPE]),
      ),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('goes on a tap and stays gone, leaving PLAY and the rest to tap', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_PORTRAIT),
      expect(role('button', { name: /^Play/ })).toExist(),
      click(turnHint),
      expect(turnHint).toBeAbsent(),
      expect(role('button', { name: /^Play/ })).toExist(),
    )
  })

  test('is not shown again once the save of a player who dismissed it is loaded', () => {
    const dismissed = update(
      remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT]),
      Message.ClickedTurnHint(),
    ).model
    const saved = saveOf(dismissed)
    vitestExpect(saved.home.turnHintSeen).toBe(true)
    const reloaded = remeasured(restoreSave(onTouch(Phase.Ready()), saved), [
      PHONE_PORTRAIT,
    ])
    vitestExpect(isTurnHintShown(reloaded)).toBe(false)
    vitestExpect(
      isTurnHintShown(remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT])),
    ).toBe(true)
    scene(
      ROOT,
      given(reloaded),
      measure(PHONE_PORTRAIT),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('is not on the landscape home menu', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_LANDSCAPE),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('is not shown mid-run in portrait', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('is not shown on a keyboard and mouse in a tall window', () => {
    scene(
      ROOT,
      given(
        modifyFields(onTouch(Phase.Ready()), {
          lastDevice: () => 'KeyboardMouse',
        }),
      ),
      measure(PHONE_PORTRAIT),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(turnHint).toBeAbsent(),
    )
  })
})

describe('the portrait door preview', () => {
  test('pins the markers of doors out of view to the window edge', () => {
    const breakAtWestWall = inPortrait(
      modifyFields(
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
      modifyFields(
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
