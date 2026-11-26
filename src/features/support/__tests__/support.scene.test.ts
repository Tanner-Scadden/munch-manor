import { Array, Effect, Option, String } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, test, expect as vitestExpect } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { PressGameSurface } from '../../../app/mount'
import { ClickSupportLink } from '../../../app/update/home'
import { HAND_DIALOG_ID } from '../../../domain/clientSchema'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  fighting,
  home,
  inPortrait,
  withNewerBuild,
  withoutSupportLink,
} from '../../../test/model.fixture'
import {
  byClass,
  emitPressedKey,
  expectAttr,
  expectClass,
  measureHud,
  measureSurface,
  measureSurfaceAs,
  openHandInScene,
  settleEndShareOf,
  showDialog,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type AppScene,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  type SceneStep,
  sceneOf,
  steps,
} from '../../../test/testing'
import { pause } from '../../../world/waves/waves'
import menuCss from '../../home/menu.css?raw'

const TEST_LINK = 'https://buy.stripe.com/test_coffee'

const coffeeLink = HtmlLocator.role('link', { name: /buy rattles a coffee/i })
const homeCoffee = HtmlLocator.role('link', {
  name: /^Buy Rattles a coffee/,
})

const supportAnchor: Locator.Locator = {
  description: 'a.home-support',
  all: root =>
    Array.filter(byClass('home-support').all(root), node => node.tag === 'a'),
}

const nthOf = (locator: Locator.Locator, index: number): Locator.Locator => ({
  description: `${locator.description} #${index}`,
  all: root => Array.take(Array.drop(locator.all(root), index), 1),
})

const cornerRow = (index: number) =>
  nthOf(
    Locator.inside(byClass('home-corner'), byClass('home-corner-row')),
    index,
  )

const cornerButtonIn = (row: number, index: number) =>
  nthOf(Locator.inside(cornerRow(row), byClass('home-corner-button')), index)

const cornerButtonsIn = (row: number) =>
  Locator.inside(cornerRow(row), byClass('home-corner-button'))

const withLink = (model: Model): Model =>
  UiStruct.evolve(model, {
    release: UiStruct.evolve({ maybeSupportUrl: () => Option.some(TEST_LINK) }),
  })

const onPhase = (phase: Phase, screenMs: number): Model =>
  UiStruct.evolve(home, { phase: () => phase, screenMs: () => screenMs })

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

const settleScene = (model: Model): SceneStep =>
  Phase.matchOrElse(
    model.phase,
    {
      Wave: () => measureHud,
      Paused: () =>
        steps(measureSurface, (s: AppScene) =>
          s.expectMount(PressGameSurface()),
        ),
    },
    () => steps(measureSurface, settleEndShareOf(model)),
  )

describe('the coffee button', () => {
  it.effect.each(SHOWN_ON)(
    'is not drawn on %s while the link is empty',
    ([_name, model]) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withoutSupportLink(model))
        s.pipe(measureSurface, settleEndShareOf(model))
          .expect(coffeeLink)
          .toBeAbsent()
      }),
  )

  it.effect.each(SHOWN_ON)(
    'opens the link in a new tab from %s',
    ([_name, model]) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withLink(model))
        s.pipe(measureSurface, settleEndShareOf(model))
          .expect(coffeeLink)
          .toExist()
          .pipe(
            expectAttr(coffeeLink, 'href', TEST_LINK),
            expectAttr(coffeeLink, 'target', '_blank'),
            expectAttr(coffeeLink, 'rel', 'noopener noreferrer'),
          )
      }),
  )

  it.effect.each(NEVER_ON)('is never drawn on %s', ([_name, model]) =>
    Effect.gen(function* () {
      const s = yield* sceneOf(model)
      s.pipe(settleScene(model))
        .expect(coffeeLink)
        .toBeAbsent()
        .expect(homeCoffee)
        .toBeAbsent()
    }),
  )
})

const MIN_TAP_PX = 48

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

const fullCorner = (model: Model): Model =>
  UiStruct.evolve(withNewerBuild(withLink(model)), {
    release: UiStruct.evolve({ installOffer: () => 'Ready' }),
    settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
  })

const LAYOUTS = [
  ['landscape', fullCorner(home), PHONE_LANDSCAPE, 'Landscape'],
  [
    'portrait',
    fullCorner(
      inPortrait(UiStruct.evolve(home, { lastDevice: () => 'Touch' as const })),
    ),
    PHONE_PORTRAIT,
    'Portrait',
  ],
] as const

describe('the coffee in the home corner', () => {
  it.effect(
    'is a real link to the tip jar that opens in a new tab, named for Rattles',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withLink(home))
        s.pipe(measureSurface)
          .expect(homeCoffee)
          .toExist()
          .pipe(
            expectAttr(homeCoffee, 'href', TEST_LINK),
            expectAttr(homeCoffee, 'target', '_blank'),
            expectAttr(homeCoffee, 'rel', 'noopener noreferrer'),
            expectAttr(homeCoffee, 'title', 'Buy Rattles a coffee'),
          )
          .expect(supportAnchor)
          .toExist()
      }),
  )

  it.effect('is absent from the home menu while the link is empty', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withoutSupportLink(home))
      s.pipe(measureSurface)
        .expect(byClass('home-settings'))
        .toExist()
        .expect(homeCoffee)
        .toBeAbsent()
        .expect(byClass('home-support'))
        .toBeAbsent()
    }),
  )

  it.effect('is not drawn in a run, even with the link', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withLink(fighting))
      s.pipe(measureHud).expect(homeCoffee).toBeAbsent()
    }),
  )

  it.effect('is no TIP JAR card in the hand', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withLink(home))
      s.pipe(measureSurface, openHandInScene, showDialog(HAND_DIALOG_ID))
        .expect(byClass('hand-card'))
        .toExist()
        .expect(HtmlLocator.role('link', { name: /tip jar/i }))
        .toBeAbsent()
        .expect(withAttrs({ 'data-card': 'Support' })(byClass('hand-card')))
        .toHaveCount(0)
    }),
  )

  it.effect('B clicks the coffee link, and does nothing without a link', () =>
    Effect.gen(function* () {
      const linked = yield* sceneOf(withLink(home))
      linked
        .pipe(measureSurface, emitPressedKey('KeyB'))
        .expectExact(ClickSupportLink.make())
        .resolve(ClickSupportLink, Component.noop)
      const unlinked = yield* sceneOf(withoutSupportLink(home))
      unlinked.pipe(measureSurface, emitPressedKey('KeyB')).expectNone()
    }),
  )

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
      Effect.gen(function* () {
        const s = yield* sceneOf(model)
        s.pipe(measureSurfaceAs(surface))
          .expect(Locator.attr('data-layout', layout))
          .toExist()
          .expect(cornerButtonsIn(0))
          .toHaveCount(3)
          .pipe(
            expectClass(cornerButtonIn(0, 0), 'home-fullscreen'),
            expectAttr(cornerButtonIn(0, 1), 'id', 'home-support'),
            expectAttr(cornerButtonIn(0, 2), 'id', 'home-settings'),
          )
          .expect(cornerButtonsIn(1))
          .toHaveCount(2)
          .pipe(
            expectAttr(cornerButtonIn(1, 0), 'id', 'home-gift'),
            expectAttr(cornerButtonIn(1, 1), 'id', 'home-install'),
          )
      }),
  )
})
