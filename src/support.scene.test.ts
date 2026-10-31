import { Option } from 'effect'
import {
  Command,
  all,
  expect,
  expectAll,
  given,
  inside,
  nth,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import menuCss from './menu.css?raw'
import { Message } from './message'
import { type Model, Phase } from './model'
import { fighting, home, inPortrait, withNewerBuild } from './model.fixture'
import {
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  ROOT,
  emitPressedKey,
  measureSurface,
  measureSurfaceAs,
  openHandInScene,
  settleEndShareOf,
} from './testing'
import { ClickSupportLink } from './update/home'
import { view } from './view'
import { pause } from './waves'

const TEST_LINK = 'https://buy.stripe.com/test_coffee'

const coffeeLink = role('link', { name: /buy the shopkeeper a coffee/i })
const homeCoffee = role('link', { name: /^Buy Rattles a coffee/ })

const withLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.some(TEST_LINK) })

const withoutLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.none() })

const onPhase = (phase: Phase, screenMs: number): Model =>
  modifyFields(home, { phase: () => phase, screenMs: () => screenMs })

const victory = onPhase(Phase.Victory(), RESTART_GRACE_MS)

const SHOWN_ON: ReadonlyArray<readonly [string, Model]> = [['Victory', victory]]

const NEVER_ON: ReadonlyArray<readonly [string, Model]> = [
  ['a wave', withLink(fighting)],
  ['the pause screen', withLink(pause(fighting))],
  [
    'Game Over',
    withLink(onPhase(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
  ],
  ['Victory before the restart grace', withLink(onPhase(Phase.Victory(), 0))],
]

describe('the coffee button', () => {
  test.each(SHOWN_ON)(
    'is not drawn on %s while the link is empty',
    (_name, model) => {
      scene(
        { update, view },
        given(withoutLink(model)),
        measureSurface,
        ...settleEndShareOf(model),
        expect(coffeeLink).toBeAbsent(),
      )
    },
  )

  test.each(SHOWN_ON)('opens the link in a new tab from %s', (_name, model) => {
    scene(
      { update, view },
      given(withLink(model)),
      measureSurface,
      ...settleEndShareOf(model),
      expect(coffeeLink).toExist(),
      expect(coffeeLink).toHaveAttr('href', TEST_LINK),
      expect(coffeeLink).toHaveAttr('target', '_blank'),
      expect(coffeeLink).toHaveAttr('rel', 'noopener noreferrer'),
    )
  })

  test.each(NEVER_ON)('is never drawn on %s', (_name, model) => {
    scene(
      { update, view },
      given(model),
      measureSurface,
      ...settleEndShareOf(model),
      expect(coffeeLink).toBeAbsent(),
      expect(homeCoffee).toBeAbsent(),
    )
  })
})

// THE HOME CORNER

const MIN_TAP_PX = 48

// NOTE: the body of the first rule for exactly this selector in menu.css.
const ruleOf = (selectorText: string): string => {
  const start = menuCss.indexOf(`\n${selectorText} {`)
  vitestExpect(start, `${selectorText} has a rule`).toBeGreaterThanOrEqual(0)
  return menuCss.slice(start, menuCss.indexOf('}', start))
}

const pxOf = (rule: string, property: string): number =>
  Number(new RegExp(`${property}:\\s*(\\d+)px`).exec(rule)?.[1] ?? 'NaN')

// NOTE: the whole corner showing: full screen, the coffee, the gear, the
// update gift, and the install tile.
const fullCorner = (model: Model): Model =>
  modifyFields(withNewerBuild(withLink(model)), {
    installOffer: () => 'Ready',
    screenFit: () => 'Fullscreen',
  })

const LAYOUTS = [
  ['landscape', fullCorner(home), PHONE_LANDSCAPE, 'Landscape'],
  [
    'portrait',
    fullCorner(
      inPortrait(modifyFields(home, { lastDevice: () => 'Touch' as const })),
    ),
    PHONE_PORTRAIT,
    'Portrait',
  ],
] as const

describe('the coffee in the home corner', () => {
  test('is a real link to the tip jar that opens in a new tab, named for Rattles', () => {
    scene(
      ROOT,
      given(withLink(home)),
      measureSurface,
      expect(homeCoffee).toExist(),
      expect(homeCoffee).toHaveAttr('href', TEST_LINK),
      expect(homeCoffee).toHaveAttr('target', '_blank'),
      expect(homeCoffee).toHaveAttr('rel', 'noopener noreferrer'),
      expect(homeCoffee).toHaveAttr('title', 'Buy Rattles a coffee'),
      expect(selector('a.home-support')).toExist(),
    )
  })

  test('is absent from the home menu while the link is empty', () => {
    scene(
      ROOT,
      given(withoutLink(home)),
      measureSurface,
      expect(selector('.home-settings')).toExist(),
      expect(homeCoffee).toBeAbsent(),
      expect(selector('.home-support')).toBeAbsent(),
    )
  })

  test('is not drawn in a run, even with the link', () => {
    scene(
      ROOT,
      given(withLink(fighting)),
      measureSurface,
      expect(homeCoffee).toBeAbsent(),
    )
  })

  test('is no TIP JAR card in the hand', () => {
    scene(
      ROOT,
      given(withLink(home)),
      measureSurface,
      ...openHandInScene(),
      expect(role('link', { name: /tip jar/i })).toBeAbsent(),
      expectAll(all.selector('.hand-card[data-card="Support"]')).toHaveCount(0),
    )
  })

  test('B clicks the coffee link, and does nothing without a link', () => {
    scene(
      ROOT,
      given(withLink(home)),
      measureSurface,
      emitPressedKey('KeyB'),
      Command.resolve(ClickSupportLink(), Message.CompletedClickSupportLink()),
    )
    scene(
      ROOT,
      given(withoutLink(home)),
      measureSurface,
      emitPressedKey('KeyB'),
      Command.expectNone(),
    )
  })

  // NOTE: Scene's page has no layout engine, so the sizes are read from
  // menu.css and the places from the DOM: every corner control is a
  // `.home-corner-button` at least 48 px square, the coffee sits just left
  // of the gear in the top row, and the gift and the install tile in the
  // row under it, rows stacked in a column. A flex row and a column never
  // overlap their children. tools/audit/taps.ts, shots33.ts, and shots34.ts
  // check the same in a real browser.
  test('the corner buttons are at least 48 px', () => {
    const root = menuCss.slice(menuCss.indexOf(':root {'))
    vitestExpect(pxOf(root, '--menu-tap')).toBeGreaterThanOrEqual(MIN_TAP_PX)
    const button = ruleOf('.home-corner-button')
    vitestExpect(button).toMatch(/width: max\(var\(--menu-tap\),/)
    vitestExpect(button).toMatch(/height: max\(var\(--menu-tap\),/)
    const coffee = ruleOf('.home-stage .home-support')
    vitestExpect(coffee).not.toMatch(/(^|\s)(width|height|padding):/)
    vitestExpect(ruleOf('.home-corner')).toMatch(/flex-direction: column/)
    vitestExpect(ruleOf('.home-corner-row')).toMatch(/display: flex/)
    vitestExpect(
      pxOf(ruleOf('.home-corner-row'), 'gap'),
    ).toBeGreaterThanOrEqual(4)
  })

  test.each(LAYOUTS)(
    'in %s the coffee stands just left of the gear, apart from the gift and the install tile',
    (_name, model, surface, layout) => {
      scene(
        ROOT,
        given(model),
        measureSurfaceAs(surface),
        expect(selector(`[data-layout='${layout}']`)).toExist(),
        inside(
          nth(all.selector('.home-corner .home-corner-row'), 0),
          expectAll(all.selector('.home-corner-button')).toHaveCount(3),
          expect(nth(all.selector('.home-corner-button'), 0)).toHaveClass(
            'home-fullscreen',
          ),
          expect(nth(all.selector('.home-corner-button'), 1)).toHaveId(
            'home-support',
          ),
          expect(nth(all.selector('.home-corner-button'), 2)).toHaveId(
            'home-settings',
          ),
        ),
        inside(
          nth(all.selector('.home-corner .home-corner-row'), 1),
          expectAll(all.selector('.home-corner-button')).toHaveCount(2),
          expect(nth(all.selector('.home-corner-button'), 0)).toHaveId(
            'home-gift',
          ),
          expect(nth(all.selector('.home-corner-button'), 1)).toHaveId(
            'home-install',
          ),
        ),
      )
    },
  )
})
