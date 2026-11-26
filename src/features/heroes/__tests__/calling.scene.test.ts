import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { defaultAppearance } from '#domain/clientSchema.ts'
import { HeroPicker, type HeroPickerProps } from '#features/heroes/block.ts'
import { startingCallingOf } from '#features/heroes/callingPick.ts'
import { Events } from '#features/heroes/message.ts'
import { Lobby } from '#features/lobby/block.ts'
import { HERO_DIALOG_ID } from '#features/lobby/lobby.ts'
import { Events as LobbyEvents, LobbyMessage } from '#features/lobby/message.ts'
import {
  type LobbyProps,
  initialLobby,
  isHeroPickerUp,
  openedLobby,
} from '#features/lobby/model.ts'
import type { Calling } from '#shared/records/playerData.ts'
import { heroesBoughtBy, home } from '#test/model.fixture.ts'
import { button, byClass, firstOf, withAttrs } from '#test/sceneTesting.ts'
import {
  modelAfter,
  openLobbyByKey,
  send,
  steps,
  tapLobbyHero,
} from '#test/testing.ts'
import { pointsForRank } from '#world/heroes/rank.ts'
import { noModifiers } from '#world/run/modifiers.ts'

const atRank = (rank: number, calling: Calling) =>
  UiStruct.evolve(home, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

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
