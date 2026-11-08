import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { LobbyBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { Message as HeroPickerMessage } from '../../../features/heroes/message'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { restoreSave, saveOf } from '../../../platform/save'
import type { Calling } from '../../../shared/playerData'
import { readyAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  openLobbyByKey,
  resolveFocusLobby,
  showDialog,
  tapLobbyHero,
  writeSave,
} from '../../../test/testing'
import { callingStandingOf } from '../../../world/heroes/calling'
import { bonesBalanceOf, pointsForRank } from '../../../world/heroes/rank'
import { focusOf } from '../../../world/party/party'
import { addBot } from '../../bots/bots'
import { HeroPickerBinding } from '../../lobby/bindings'
import { isHeroPickerUp } from '../../lobby/model'
import { startingCallingOf } from '../callingPick'

// Buying a hero with Bones (src/features/heroes/callingPick.ts, src/features/home/update.ts): a rank
// opens a hero for sale, a tap tries it on, BUY pays, and a pick that is not
// bought starts YOU.

const player = (
  rank: number,
  bones: number,
  bought: ReadonlyArray<string> = [],
): Model =>
  modifyFields(readyAfterRead, {
    rank: current => ({
      ...current,
      earnedPoints: pointsForRank(rank),
      earnedBones: bones,
    }),
    boughtCosmetics: () => bought,
  })

// NOTE: PLAY, then the hero card: the picker opens in the lobby.
const openPicker = Story.steps(
  Story.message(Message.ClickedPlayButton()),
  resolveFocusLobby(),
  Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
  showDialog(),
)

// NOTE: the picker opened at a rank that has reached a hero: the heroes
// reached are marked seen, and saved.
const openPickerWithUnlocks = Story.steps(openPicker, writeSave())

const clickBuy = Story.messageIn(
  [LobbyBinding, HeroPickerBinding],
  HeroPickerMessage.ClickedBuyButton(),
)

const withoutBots = (current: Model): Model =>
  modifyFields(current, {
    home: home => modifyFields(home, { bots: () => [] }),
  })

describe('a hero for sale', () => {
  it.effect('is locked below its rank: a tap tries nothing on', () =>
    Story.story(
      APPLICATION,
      Story.given(player(2, 500)),
      openPicker,
      tapLobbyHero('Handyman'),
      Story.model(tapped => {
        expect(tapped.lobby.heroPicker.maybeTrying).toEqual(Option.none())
        expect(tapped.calling).toBe('You')
        expect(callingStandingOf('Handyman', 2, [])).toBe('Locked')
      }),
    ),
  )

  it.effect('is tried on at its rank, and nothing is spent or picked yet', () =>
    Story.story(
      APPLICATION,
      Story.given(player(3, 500)),
      openPickerWithUnlocks,
      tapLobbyHero('Handyman'),
      Story.model(tapped => {
        expect(tapped.lobby.heroPicker.maybeTrying).toEqual(
          Option.some('Handyman'),
        )
        expect(tapped.calling).toBe('You')
        expect(tapped.boughtCosmetics).toEqual([])
        expect(isHeroPickerUp(tapped.lobby)).toBe(true)
      }),
    ),
  )

  it.effect('an owned hero ends a try-on and is the pick', () =>
    Story.story(
      APPLICATION,
      Story.given(player(6, 500, ['hero:TrackStar'])),
      openPickerWithUnlocks,
      tapLobbyHero('Handyman'),
      Story.model(tried => {
        expect(tried.lobby.heroPicker.maybeTrying).toEqual(
          Option.some('Handyman'),
        )
      }),
      tapLobbyHero('TrackStar'),
      writeSave(),
      closeDialog(),
      Story.model(picked => {
        expect(picked.lobby.heroPicker.maybeTrying).toEqual(Option.none())
        expect(picked.calling).toBe('TrackStar')
      }),
    ),
  )

  it.effect('BUY pays the price in Bones, keeps the hero, and picks it', () =>
    Story.story(
      APPLICATION,
      Story.given(player(3, 100)),
      openLobbyByKey,
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
      showDialog(),
      tapLobbyHero('Handyman'),
      writeSave(),
      clickBuy,
      writeSave(),
      closeDialog(),
      Story.model(current => {
        expect(current.boughtCosmetics).toEqual(['hero:Handyman'])
        expect(current.rank.spentBones).toBe(60)
        expect(bonesBalanceOf(current.rank)).toBe(40)
        expect(current.calling).toBe('Handyman')
        expect(focusOf(current).player.calling).toBe('Handyman')
        expect(current.lobby.heroPicker.maybeTrying).toEqual(Option.none())
      }),
    ),
  )

  it.effect(
    'with too few Bones, BUY changes nothing and the try-on stays',
    () =>
      Story.story(
        APPLICATION,
        Story.given(player(3, 59)),
        openPickerWithUnlocks,
        tapLobbyHero('Handyman'),
        clickBuy,
        Story.model(bought => {
          expect(bought.boughtCosmetics).toEqual([])
          expect(bought.rank.spentBones).toBe(0)
          expect(bought.lobby.heroPicker.maybeTrying).toEqual(
            Option.some('Handyman'),
          )
          expect(isHeroPickerUp(bought.lobby)).toBe(true)
        }),
      ),
  )

  it.effect('with exactly the price, BUY works and leaves nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(player(15, 200)),
      openPickerWithUnlocks,
      tapLobbyHero('LineCook'),
      clickBuy,
      writeSave(),
      closeDialog(),
      Story.model(bought => {
        expect(bought.boughtCosmetics).toEqual(['hero:LineCook'])
        expect(bonesBalanceOf(bought.rank)).toBe(0)
      }),
    ),
  )

  it.effect('BUY with no try-on buys nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(player(3, 500)),
      openPickerWithUnlocks,
      clickBuy,
      Story.model(bought => {
        expect(bought.boughtCosmetics).toEqual([])
      }),
    ),
  )

  // NOTE: a picker that believes an owned hero is still on trial, so BUY
  // reaches the root, which checks what is owned itself.
  it.effect('a hero already owned is not paid for again', () =>
    Effect.gen(function* () {
      const picking = yield* Story.story(
        APPLICATION,
        Story.given(player(3, 500, ['hero:Handyman'])),
        openPickerWithUnlocks,
      )
      const owned = modifyFields(picking, {
        lobby: lobby =>
          modifyFields(lobby, {
            heroPicker: picker =>
              modifyFields(picker, {
                maybeTrying: () => Option.some('Handyman'),
              }),
          }),
      })
      yield* Story.story(
        APPLICATION,
        Story.given(owned),
        clickBuy,
        Story.model(again => {
          expect(again.rank.spentBones).toBe(0)
          expect(again.boughtCosmetics).toEqual(['hero:Handyman'])
        }),
      )
    }),
  )
})

describe('the reset', () => {
  test('a rank 20 save from before owns only YOU: a saved Handyman starts YOU', () => {
    const old = modifyFields(player(20, 0), { calling: () => 'Handyman' })
    expect(old.boughtCosmetics).toEqual([])
    const restored = restoreSave(readyAfterRead, saveOf(old))
    expect(startingCallingOf(restored)).toBe('You')
    expect(focusOf(restored).player.calling).toBe('You')
  })

  test('the Bones balance is untouched, and a bought hero survives the save', () => {
    const bought = modifyFields(player(20, 321, ['hero:TrackStar']), {
      calling: () => 'TrackStar',
    })
    const restored = restoreSave(readyAfterRead, saveOf(bought))
    expect(bonesBalanceOf(restored.rank)).toBe(321)
    expect(startingCallingOf(restored)).toBe('TrackStar')
  })
})

describe('teammate bots', () => {
  test('pick only from the heroes the player owns', () => {
    const rolls = globalThis.Array.from({ length: 12 })
    const heroesOf = (start: Model): ReadonlyArray<Calling> =>
      Array.reduce(
        Array.map(rolls, () => 'You'),
        Array.empty<Calling>(),
        (picked, _roll, index) => {
          const seated = addBot(
            withoutBots(
              modifyFields(start, {
                cosmeticRngState: () => start.cosmeticRngState + index * 7919,
              }),
            ),
          )
          return [...picked, seated.home.bots[0]?.calling ?? 'You']
        },
      )
    expect(new Set(heroesOf(player(20, 0)))).toEqual(new Set(['You']))
    const mixed = new Set(heroesOf(player(20, 0, ['hero:LineCook'])))
    expect(
      Array.every([...mixed], calling => ['You', 'LineCook'].includes(calling)),
    ).toBe(true)
  })

  it.effect('their picker offers no try-on for a hero for sale', () =>
    Story.story(
      APPLICATION,
      Story.given(player(20, 500)),
      Story.message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedAddBotButton()),
      resolveFocusLobby(),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedBotHeroButton({ index: 0 }),
      ),
      showDialog(),
      writeSave(),
      tapLobbyHero('LineCook'),
      Story.model(tapped => {
        expect(tapped.lobby.heroPicker.maybeTrying).toEqual(Option.none())
        expect(tapped.home.bots[0]?.calling).not.toBe('LineCook')
      }),
    ),
  )
})
