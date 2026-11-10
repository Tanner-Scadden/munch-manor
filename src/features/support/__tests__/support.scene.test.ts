import { Effect, Option, String } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, test, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { ClickSupportLink } from '../../../app/update/home'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  fighting,
  home,
  inPortrait,
  withNewerBuild,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  emitPressedKey,
  measureSurface,
  measureSurfaceAs,
  openHandInScene,
  settleEndShareOf,
} from '../../../test/testing'
import { pause } from '../../../world/waves/waves'
import menuCss from '../../home/menu.css?raw'

const TEST_LINK = 'https://buy.stripe.com/test_coffee'

const coffeeLink = Scene.role('link', { name: /buy the shopkeeper a coffee/i })
const homeCoffee = Scene.role('link', { name: /^Buy Rattles a coffee/ })

const withLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.some(TEST_LINK) })

const withoutLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.none() })

const onPhase = (phase: Phase, screenMs: number): Model =>
  modifyFields(home, { phase: () => phase, screenMs: () => screenMs })

const escaped = onPhase(Phase.Escaped({ wave: 10 }), RESTART_GRACE_MS)

const SHOWN_ON: ReadonlyArray<readonly [string, Model]> = [
  ['the escape', escaped],
]

const NEVER_ON: ReadonlyArray<readonly [string, Model]> = [
  ['a wave', withLink(fighting)],
  ['the pause screen', withLink(pause(fighting))],
  [
    'Game Over',
    withLink(onPhase(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
  ],
  [
    'the escape before the restart grace',
    withLink(onPhase(Phase.Escaped({ wave: 10 }), 0)),
  ],
]

describe('the coffee button', () => {
  it.effect.each(SHOWN_ON)(
    'is not drawn on %s while the link is empty',
    ([_name, model]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(withoutLink(model)),
        measureSurface,
        ...settleEndShareOf(model),
        Scene.expect(coffeeLink).toBeAbsent(),
      ),
  )

  it.effect.each(SHOWN_ON)(
    'opens the link in a new tab from %s',
    ([_name, model]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(withLink(model)),
        measureSurface,
        ...settleEndShareOf(model),
        Scene.expect(coffeeLink).toExist(),
        Scene.expect(coffeeLink).toHaveAttr('href', TEST_LINK),
        Scene.expect(coffeeLink).toHaveAttr('target', '_blank'),
        Scene.expect(coffeeLink).toHaveAttr('rel', 'noopener noreferrer'),
      ),
  )

  it.effect.each(NEVER_ON)('is never drawn on %s', ([_name, model]) =>
    Scene.scene(
      APPLICATION,
      Scene.given(model),
      measureSurface,
      ...settleEndShareOf(model),
      Scene.expect(coffeeLink).toBeAbsent(),
      Scene.expect(homeCoffee).toBeAbsent(),
    ),
  )
})

// THE HOME CORNER

const MIN_TAP_PX = 48

// NOTE: the body of the first rule for exactly this selector in menu.css.
const ruleOf = (selectorText: string): string => {
  const maybeStart = String.indexOf(`\n${selectorText} {`)(menuCss)
  vitestExpect(Option.isSome(maybeStart), `${selectorText} has a rule`).toBe(
    true,
  )
  const rest = String.slice(Option.getOrThrow(maybeStart))(menuCss)
  return String.slice(0, Option.getOrThrow(String.indexOf('}')(rest)))(rest)
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
  it.effect(
    'is a real link to the tip jar that opens in a new tab, named for Rattles',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(withLink(home)),
        measureSurface,
        Scene.expect(homeCoffee).toExist(),
        Scene.expect(homeCoffee).toHaveAttr('href', TEST_LINK),
        Scene.expect(homeCoffee).toHaveAttr('target', '_blank'),
        Scene.expect(homeCoffee).toHaveAttr('rel', 'noopener noreferrer'),
        Scene.expect(homeCoffee).toHaveAttr('title', 'Buy Rattles a coffee'),
        Scene.expect(Scene.selector('a.home-support')).toExist(),
      ),
  )

  it.effect('is absent from the home menu while the link is empty', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withoutLink(home)),
      measureSurface,
      Scene.expect(Scene.selector('.home-settings')).toExist(),
      Scene.expect(homeCoffee).toBeAbsent(),
      Scene.expect(Scene.selector('.home-support')).toBeAbsent(),
    ),
  )

  it.effect('is not drawn in a run, even with the link', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withLink(fighting)),
      measureSurface,
      Scene.expect(homeCoffee).toBeAbsent(),
    ),
  )

  it.effect('is no TIP JAR card in the hand', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withLink(home)),
      measureSurface,
      ...openHandInScene(),
      Scene.expect(Scene.role('link', { name: /tip jar/i })).toBeAbsent(),
      Scene.expectAll(
        Scene.all.selector('.hand-card[data-card="Support"]'),
      ).toHaveCount(0),
    ),
  )

  it.effect('B clicks the coffee link, and does nothing without a link', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(withLink(home)),
        measureSurface,
        emitPressedKey('KeyB'),
        Scene.Command.resolve(
          ClickSupportLink(),
          Message.CompletedClickSupportLink(),
        ),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(withoutLink(home)),
        measureSurface,
        emitPressedKey('KeyB'),
        Scene.Command.expectNone(),
      )
    }),
  )

  // NOTE: Scene's page has no layout engine, so the sizes are read from
  // menu.css and the places from the DOM: every corner control is a
  // `.home-corner-button` at least 48 px square, the coffee sits just left
  // of the gear in the top row, and the gift and the install tile in the
  // row under it, rows stacked in a column. A flex row and a column never
  // overlap their children. tools/audit/taps.ts, shots33.ts, and shots34.ts
  // check the same in a real browser.
  test('the corner buttons are at least 48 px', () => {
    const root = String.slice(
      Option.getOrThrow(String.indexOf(':root {')(menuCss)),
    )(menuCss)
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

  it.effect.each(LAYOUTS)(
    'in %s the coffee stands just left of the gear, apart from the gift and the install tile',
    ([_name, model, surface, layout]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(model),
        measureSurfaceAs(surface),
        Scene.expect(Scene.selector(`[data-layout='${layout}']`)).toExist(),
        Scene.inside(
          Scene.nth(Scene.all.selector('.home-corner .home-corner-row'), 0),
          Scene.expectAll(
            Scene.all.selector('.home-corner-button'),
          ).toHaveCount(3),
          Scene.expect(
            Scene.nth(Scene.all.selector('.home-corner-button'), 0),
          ).toHaveClass('home-fullscreen'),
          Scene.expect(
            Scene.nth(Scene.all.selector('.home-corner-button'), 1),
          ).toHaveId('home-support'),
          Scene.expect(
            Scene.nth(Scene.all.selector('.home-corner-button'), 2),
          ).toHaveId('home-settings'),
        ),
        Scene.inside(
          Scene.nth(Scene.all.selector('.home-corner .home-corner-row'), 1),
          Scene.expectAll(
            Scene.all.selector('.home-corner-button'),
          ).toHaveCount(2),
          Scene.expect(
            Scene.nth(Scene.all.selector('.home-corner-button'), 0),
          ).toHaveId('home-gift'),
          Scene.expect(
            Scene.nth(Scene.all.selector('.home-corner-button'), 1),
          ).toHaveId('home-install'),
        ),
      ),
  )
})
