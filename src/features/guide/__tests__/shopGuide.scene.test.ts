import { Effect } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { home } from '../../../test/model.fixture'
import { byClass, withAttrs } from '../../../test/sceneTesting'
import { modelAfter, send, steps } from '../../../test/testing'
import { EXIT_RULES } from '../../../world/level/exits'
import { SHOP_GUIDE_NAME } from '../../../world/names'
import { munchopediaPropsOf } from '../../munchopedia/__tests__/munchopedia.fixture'
import { FocusGuideControl, Munchopedia } from '../../munchopedia/block'
import { prizeUnlockId } from '../shopGuide'

type GuideScene = HtmlScene.Steps<typeof Munchopedia>

const guide = byClass('sg')
const findsTile = HtmlLocator.role('button', {
  name: new RegExp(`^${SHOP_GUIDE_NAME},`),
})
const entryOf = (id: string): Locator.Locator =>
  withAttrs({ 'data-entry': id })(byClass('sg-entry'))
const knownAs = (known: 'Known' | 'Unknown'): Locator.Locator =>
  withAttrs({ 'data-known': known })(byClass('sg-entry'))

const openFinds = (model: Model) =>
  Effect.gen(function* () {
    const opened = yield* modelAfter(
      model,
      steps(
        send(Message.ClickedManorButton()),
        send(Message.ClickedMunchopediaButton()),
      ),
    )
    const s = yield* HtmlScene.make(Munchopedia, munchopediaPropsOf(opened))
    return s
      .click(findsTile)
      .resolve(FocusGuideControl.make({ target: 'Back' }), Component.noop)
  })

describe('the Munchopedia Finds page', () => {
  it.effect(
    'the Finds tile opens the guide, sections switch, and Back returns to the zombies',
    () =>
      Effect.gen(function* () {
        const s: GuideScene = yield* openFinds(home)
        s.expect(guide)
          .toExist()
          .expect(entryOf('Pistol'))
          .toExist()
          .click(HtmlLocator.role('button', { name: 'House' }))
          .expect(entryOf('Boards'))
          .toExist()
          .expect(entryOf('Rattles'))
          .toExist()
          .expect(Locator.text(`${EXIT_RULES.kitchenKeys} keys`))
          .toExist()
          .expect(entryOf('Pistol'))
          .toBeAbsent()
          .click(HtmlLocator.role('button', { name: 'Back to the journal' }))
          .resolve(FocusGuideControl.make({ target: 'Opener' }), Component.noop)
          .expect(guide)
          .toBeAbsent()
          .expect(findsTile)
          .toExist()
      }),
  )

  it.effect('a gun shows its bars and its ladder of kills', () =>
    Effect.gen(function* () {
      const s = yield* openFinds(home)
      const shotgun = entryOf('Shotgun')
      s.expect(Locator.inside(shotgun, byClass('sg-name')))
        .toExist()
        .expect(
          Locator.inside(
            shotgun,
            HtmlLocator.role('img', { name: /^Power \d of 5/ }),
          ),
        )
        .toExist()
        .expect(Locator.inside(shotgun, byClass('sg-step')))
        .toHaveCount(3)
    }),
  )

  it.effect(
    'the fridge shows ??? until a prize is pulled, then its card fills in',
    () =>
      Effect.gen(function* () {
        const pulled: Model = UiStruct.evolve(home, {
          seenUnlocks: () => [prizeUnlockId('Freeze')],
        })
        const s = yield* openFinds(pulled)
        s.click(HtmlLocator.role('button', { name: 'Fridge' }))
          .expect(knownAs('Unknown'))
          .toHaveCount(4)
          .expect(knownAs('Known'))
          .toHaveCount(1)
          .expect(Locator.inside(entryOf('Freeze'), byClass('sg-bars')))
          .toExist()
          .expect(Locator.inside(entryOf('Cooker'), byClass('sg-bars')))
          .toBeAbsent()
          .expect(Locator.inside(entryOf('Cooker'), Locator.text('???')))
          .toExist()
      }),
  )
})
