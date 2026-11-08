import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { Child, update } from '../../../app/pureApp'
import { Message as HeroPickerMessage } from '../../../features/heroes/message'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { restoreSave, saveOf } from '../../../platform/save'
import type { Calling } from '../../../shared/playerData'
import { readyAfterRead } from '../../../test/model.fixture'
import {
  closeDialog,
  modelAfter,
  openLobbyByKey,
  showDialog,
  writeSave,
} from '../../../test/testing'
import { callingStandingOf } from '../../../world/heroes/calling'
import { bonesBalanceOf, pointsForRank } from '../../../world/heroes/rank'
import { focusOf } from '../../../world/party/party'
import { addBot } from '../../bots/bots'
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

const inPicker = (start: Model): Model =>
  modelAfter(
    modelAfter(start, Message.ClickedPlayButton()),
    Child.lobby(LobbyMessage.ClickedHeroButton()),
  )

const tapOf = (calling: Calling) =>
  Child.lobbyHero(HeroPickerMessage.ClickedCard({ calling }))

const tap = (current: Model, calling: Calling): Model =>
  modelAfter(current, tapOf(calling))

const withoutBots = (current: Model): Model =>
  modifyFields(current, {
    home: home => modifyFields(home, { bots: () => [] }),
  })

describe('a hero for sale', () => {
  test('is locked below its rank: a tap tries nothing on', () => {
    const tapped = tap(inPicker(player(2, 500)), 'Handyman')
    expect(tapped.lobby.heroPicker.maybeTrying).toEqual(Option.none())
    expect(tapped.calling).toBe('You')
    expect(callingStandingOf('Handyman', 2, [])).toBe('Locked')
  })

  test('is tried on at its rank, and nothing is spent or picked yet', () => {
    const tapped = tap(inPicker(player(3, 500)), 'Handyman')
    expect(tapped.lobby.heroPicker.maybeTrying).toEqual(Option.some('Handyman'))
    expect(tapped.calling).toBe('You')
    expect(tapped.boughtCosmetics).toEqual([])
    expect(isHeroPickerUp(tapped.lobby)).toBe(true)
  })

  test('an owned hero ends a try-on and is the pick', () => {
    const tried = tap(inPicker(player(6, 500, ['hero:TrackStar'])), 'Handyman')
    expect(tried.lobby.heroPicker.maybeTrying).toEqual(Option.some('Handyman'))
    const picked = tap(tried, 'TrackStar')
    expect(picked.lobby.heroPicker.maybeTrying).toEqual(Option.none())
    expect(picked.calling).toBe('TrackStar')
  })

  test('BUY pays the price in Bones, keeps the hero, and picks it', () => {
    story(
      update,
      given(player(3, 100)),
      openLobbyByKey,
      message(Child.lobby(LobbyMessage.ClickedHeroButton())),
      showDialog(),
      message(tapOf('Handyman')),
      writeSave(),
      message(Child.lobbyHero(HeroPickerMessage.ClickedBuyButton())),
      writeSave(),
      closeDialog(),
      model(current => {
        expect(current.boughtCosmetics).toEqual(['hero:Handyman'])
        expect(current.rank.spentBones).toBe(60)
        expect(bonesBalanceOf(current.rank)).toBe(40)
        expect(current.calling).toBe('Handyman')
        expect(focusOf(current).player.calling).toBe('Handyman')
        expect(current.lobby.heroPicker.maybeTrying).toEqual(Option.none())
      }),
    )
  })

  test('with too few Bones, BUY changes nothing and the try-on stays', () => {
    const bought = modelAfter(
      tap(inPicker(player(3, 59)), 'Handyman'),
      Child.lobbyHero(HeroPickerMessage.ClickedBuyButton()),
    )
    expect(bought.boughtCosmetics).toEqual([])
    expect(bought.rank.spentBones).toBe(0)
    expect(bought.lobby.heroPicker.maybeTrying).toEqual(Option.some('Handyman'))
    expect(isHeroPickerUp(bought.lobby)).toBe(true)
  })

  test('with exactly the price, BUY works and leaves nothing', () => {
    const bought = modelAfter(
      tap(inPicker(player(15, 200)), 'LineCook'),
      Child.lobbyHero(HeroPickerMessage.ClickedBuyButton()),
    )
    expect(bought.boughtCosmetics).toEqual(['hero:LineCook'])
    expect(bonesBalanceOf(bought.rank)).toBe(0)
  })

  test('BUY with no try-on buys nothing', () => {
    const bought = modelAfter(
      inPicker(player(3, 500)),
      Child.lobbyHero(HeroPickerMessage.ClickedBuyButton()),
    )
    expect(bought.boughtCosmetics).toEqual([])
  })

  test('a hero already owned is not paid for again', () => {
    const owned = modifyFields(inPicker(player(3, 500, ['hero:Handyman'])), {
      lobby: lobby =>
        modifyFields(lobby, {
          heroPicker: picker =>
            modifyFields(picker, {
              maybeTrying: () => Option.some('Handyman'),
            }),
        }),
    })
    const again = modelAfter(
      owned,
      Child.lobbyHero(HeroPickerMessage.ClickedBuyButton()),
    )
    expect(again.rank.spentBones).toBe(0)
    expect(again.boughtCosmetics).toEqual(['hero:Handyman'])
  })
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

  test('their picker offers no try-on for a hero for sale', () => {
    const picking = modelAfter(
      modelAfter(
        modelAfter(player(20, 500), Message.ClickedPlayButton()),
        Child.lobby(LobbyMessage.ClickedAddBotButton()),
      ),
      Child.lobby(LobbyMessage.ClickedBotHeroButton({ index: 0 })),
    )
    const tapped = modelAfter(picking, tapOf('LineCook'))
    expect(tapped.lobby.heroPicker.maybeTrying).toEqual(Option.none())
    expect(tapped.home.bots[0]?.calling).not.toBe('LineCook')
  })
})
