import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { defaultAppearance } from '../../../domain/clientSchema'
import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, home } from '../../../test/model.fixture'
import { button, byClass, firstOf, withAttrs } from '../../../test/sceneTesting'
import {
  modelAfter,
  openLobbyByKey,
  send,
  steps,
  tapLobbyHero,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'
import { noModifiers } from '../../../world/run/modifiers'
import { Lobby } from '../../lobby/block'
import { HERO_DIALOG_ID } from '../../lobby/lobby'
import { Events as LobbyEvents, LobbyMessage } from '../../lobby/message'
import {
  type LobbyProps,
  initialLobby,
  isHeroPickerUp,
  openedLobby,
} from '../../lobby/model'
import { HeroPicker, type HeroPickerProps } from '../block'
import { startingCallingOf } from '../callingPick'
import { Events } from '../message'

// The lobby's hero card and the picker it opens (src/features/lobby/view.ts,
// src/features/heroes/callingCards.ts). The lobby and the picker are each a
// child component, drawn here on their own from the props the root hands
// them; the root's side of a pick is its LobbyMessages, and Y opening the
// picker is in calling.story.test.ts.

const atRank = (rank: number, calling: Calling) =>
  UiStruct.evolve(home, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

// NOTE: the lobby as the root draws it for a player of this rank wearing
// this hero, with the hero picker open or not.
const lobbyAt = (
  rank: number,
  calling: Calling,
  isHeroPickerOpen: boolean,
): LobbyProps => ({
  lobby: UiStruct.evolve(openedLobby(initialLobby), {
    isHeroPickerOpen: () => isHeroPickerOpen,
  }),
  picks: {
    mode: 'Campaign',
    difficulty: { chosen: 'Normal', nightmare: 'Locked' },
    modifiers: noModifiers,
    easyBreakSeconds: 0,
    dareMark: 0,
    bestMark: 0,
    bots: [],
    botSeats: 3,
    lock: 'Open',
  },
  name: 'Pal',
  look: defaultAppearance,
  rank,
  calling,
  isHeroNew: false,
  bought: heroesBoughtBy(rank),
  bones: 0,
  fresh: [],
  isKeyboard: true,
})

// NOTE: the picker as the lobby draws it: a player of this rank with these
// Bones and heroes bought, and a hero tried on or none.
const pickerAt = (
  rank: number,
  bones: number,
  bought: ReadonlyArray<string>,
  trying: Calling | null,
): HeroPickerProps => ({
  look: defaultAppearance,
  chosen: 'You',
  trying,
  rank,
  bought,
  bones,
  fresh: [],
  layout: 'Panel',
})

// NOTE: ui-kit's Dialog draws its panel once its own Model says it is
// shown, which its Mount sets on the page and a Scene never runs.
const SHOWN_DIALOG = {
  mounted: true,
  started: true,
  nestedOpen: 0,
  trigger: null,
  reason: null,
  openMethod: null,
  closeMethod: null,
}

const card = (calling: Calling) =>
  withAttrs({ 'data-calling': calling })(byClass('calling-card'))

// NOTE: a card's first perk or drawback line.
const lineOf = (calling: Calling, sign: 'Perk' | 'Drawback') =>
  firstOf(
    Locator.inside(
      Locator.inside(
        card(calling),
        withAttrs({ 'data-sign': sign })(byClass('calling-special')),
      ),
      byClass('calling-special-line'),
    ),
  )

const handymanPill = button(/^Hero: Handyman\./)

const lockedTrackStar = HtmlLocator.role('button', {
  name: /^Track Star, locked\. Reach rank 6 to unlock/,
})

const shortBuy = HtmlLocator.role('button', {
  name: 'Buy for 60 Bones, too few',
})

// NOTE: an attribute of what a child's Scene draws (`expectAttr` steps the
// root's Scene).
const attrOf = (node: Locator.Node, name: string): string | undefined =>
  node.attrs?.[name]

describe('the hero card', () => {
  it.effect(
    'shows the calling picked, with its key, and opens the picker',
    () =>
      Effect.gen(function* () {
        const s = yield* HtmlScene.make(Lobby, lobbyAt(3, 'Handyman', false))
        expect(attrOf(s.get(handymanPill), 'aria-keyshortcuts')).toBe('Y')
        expect(attrOf(s.get(handymanPill), 'aria-haspopup')).toBe('dialog')
        s.click(handymanPill).emitted(LobbyEvents.RequestedHeroPicker())
        const open = yield* HtmlScene.make(Lobby, lobbyAt(3, 'Handyman', true))
        open
          .givenChild(Dialog, HERO_DIALOG_ID, SHOWN_DIALOG)
          .expect(HtmlLocator.role('dialog', { name: 'Hero' }))
          .toExist()
      }),
  )
})

describe('the picker', () => {
  it.effect(
    'deals five cards: the unlocked ones to pick and the locked ones dark with their rank',
    () =>
      Effect.gen(function* () {
        const s = yield* HtmlScene.make(
          HeroPicker,
          pickerAt(3, 0, heroesBoughtBy(3), null),
        )
        s.expect(withAttrs({ 'data-lock': 'Owned' })(byClass('calling-card')))
          .toExist()
          .expect(
            HtmlLocator.role('button', {
              name: /^Handyman\. Plus: Traps 50% sturdier/,
            }),
          )
          .toExist()
          .expect(
            HtmlLocator.role('button', {
              name: /^Line Cook, locked\. Reach rank 15 to unlock/,
            }),
          )
          .toExist()
          .expect(Locator.inside(byClass('calling-need'), byClass('rank-chip')))
          .toExist()
        expect(attrOf(s.get(lockedTrackStar), 'aria-disabled')).toBe('true')
      }),
  )

  it.effect(
    'each card reads its specials, perks and drawbacks, locked or not',
    () =>
      Effect.gen(function* () {
        const s = yield* HtmlScene.make(
          HeroPicker,
          pickerAt(3, 0, heroesBoughtBy(3), null),
        )
        s.expect(lineOf('Handyman', 'Perk'))
          .toHaveText('Traps 50% sturdier')
          .expect(lineOf('Handyman', 'Drawback'))
          .toHaveText('4 max hearts')
          .expect(
            Locator.inside(
              withAttrs({ 'data-lock': 'Locked' })(card('TrackStar')),
              Locator.inside(
                withAttrs({ 'data-sign': 'Drawback' })(
                  byClass('calling-special'),
                ),
                byClass('calling-special-line'),
              ),
            ),
          )
          .toHaveText('Mags 5% smaller')
      }),
  )

  it.effect(
    'picking an unlocked calling closes the picker and changes the card',
    () =>
      Effect.gen(function* () {
        const s = yield* HtmlScene.make(
          HeroPicker,
          pickerAt(3, 0, heroesBoughtBy(3), null),
        )
        s.click(HtmlLocator.role('button', { name: /^Handyman\./ })).emitted(
          Events.Picked({ calling: 'Handyman' }),
        )
        const picked = yield* modelAfter(
          atRank(3, 'You'),
          steps(
            openLobbyByKey,
            send(LobbyMessage.RequestedLobbyHeroPicker()),
            tapLobbyHero('Handyman'),
          ),
        )
        expect(isHeroPickerUp(picked.lobby)).toBe(false)
        expect(startingCallingOf(picked)).toBe('Handyman')
        const lobby = yield* HtmlScene.make(
          Lobby,
          lobbyAt(3, startingCallingOf(picked), false),
        )
        lobby.expect(handymanPill).toExist()
      }),
  )

  it.effect('a locked card is disabled, so a tap on it picks nothing', () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(
        HeroPicker,
        pickerAt(3, 0, heroesBoughtBy(3), null),
      )
      expect(attrOf(s.get(lockedTrackStar), 'aria-disabled')).toBe('true')
      const tried = yield* modelAfter(
        atRank(3, 'You'),
        steps(
          openLobbyByKey,
          send(LobbyMessage.RequestedLobbyHeroPicker()),
          tapLobbyHero('TrackStar'),
        ),
      )
      expect(startingCallingOf(tried)).toBe('You')
    }),
  )
})

describe('a hero for sale', () => {
  it.effect(
    'shows its price, and a tap tries it on with a BUY pill that buys',
    () =>
      Effect.gen(function* () {
        const s = yield* HtmlScene.make(HeroPicker, pickerAt(6, 100, [], null))
        s.expect(withAttrs({ 'data-lock': 'ForSale' })(card('Handyman')))
          .toExist()
          .expect(Locator.inside(card('Handyman'), byClass('calling-price')))
          .toExist()
          .expect(withAttrs({ 'data-lock': 'Locked' })(card('LineCook')))
          .toExist()
          .expect(byClass('calling-balance'))
          .toHaveText(/100/)
          .expect(byClass('calling-buy'))
          .toBeAbsent()
          .click(
            HtmlLocator.role('button', {
              name: /^Handyman, for sale, 60 Bones/,
            }),
          )
          .emitted(Events.Picked({ calling: 'Handyman' }))
        const trying = yield* HtmlScene.make(
          HeroPicker,
          pickerAt(6, 100, [], 'Handyman'),
        )
        trying
          .expect(withAttrs({ 'data-trying': 'true' })(byClass('calling-card')))
          .toExist()
          .click(HtmlLocator.role('button', { name: 'Buy for 60 Bones' }))
          .emitted(Events.RequestedBuy({ calling: 'Handyman' }))
      }),
  )

  it.effect('with too few Bones the BUY pill is disabled and red', () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(
        HeroPicker,
        pickerAt(6, 10, [], 'Handyman'),
      )
      expect(attrOf(s.get(shortBuy), 'data-short')).toBe('true')
      s.expect(shortBuy).toBeDisabled()
    }),
  )
})
