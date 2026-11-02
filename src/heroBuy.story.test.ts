import { Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { addBot } from './bots'
import { callingStandingOf } from './calling'
import { startingCallingOf } from './callingPick'
import { update } from './main'
import { Message } from './message'
import type { Model } from './model'
import { readyAfterRead } from './model.fixture'
import type { Calling } from './playerData'
import { bonesBalanceOf, pointsForRank } from './rank'
import { restoreSave, saveOf } from './save'
import {
  closeDialog,
  modelAfter,
  openLobbyByKey,
  showDialog,
  writeSave,
} from './testing'

// Buying a hero with Bones (src/callingPick.ts, src/update/home.ts): a rank
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
    Message.ClickedLobbyHeroButton(),
  )

const tapOf = (calling: Calling) =>
  Message.ClickedCallingCardButton({ calling })

const tap = (current: Model, calling: Calling): Model =>
  modelAfter(current, tapOf(calling))

const withoutBots = (current: Model): Model =>
  modifyFields(current, {
    home: home => modifyFields(home, { bots: () => [] }),
  })

describe('a hero for sale', () => {
  test('is locked below its rank: a tap tries nothing on', () => {
    const tapped = tap(inPicker(player(2, 500)), 'Handyman')
    expect(tapped.home.maybeTryingCalling).toEqual(Option.none())
    expect(tapped.calling).toBe('You')
    expect(callingStandingOf('Handyman', 2, [])).toBe('Locked')
  })

  test('is tried on at its rank, and nothing is spent or picked yet', () => {
    const tapped = tap(inPicker(player(3, 500)), 'Handyman')
    expect(tapped.home.maybeTryingCalling).toEqual(Option.some('Handyman'))
    expect(tapped.calling).toBe('You')
    expect(tapped.boughtCosmetics).toEqual([])
    expect(tapped.panel).toBe('Calling')
  })

  test('an owned hero ends a try-on and is the pick', () => {
    const tried = tap(inPicker(player(6, 500, ['hero:TrackStar'])), 'Handyman')
    expect(tried.home.maybeTryingCalling).toEqual(Option.some('Handyman'))
    const picked = tap(tried, 'TrackStar')
    expect(picked.home.maybeTryingCalling).toEqual(Option.none())
    expect(picked.calling).toBe('TrackStar')
  })

  test('BUY pays the price in Bones, keeps the hero, and picks it', () => {
    story(
      update,
      given(player(3, 100)),
      openLobbyByKey,
      message(Message.ClickedLobbyHeroButton()),
      showDialog(),
      message(tapOf('Handyman')),
      writeSave(),
      message(Message.ClickedBuyCallingButton()),
      writeSave(),
      closeDialog(),
      model(current => {
        expect(current.boughtCosmetics).toEqual(['hero:Handyman'])
        expect(current.rank.spentBones).toBe(60)
        expect(bonesBalanceOf(current.rank)).toBe(40)
        expect(current.calling).toBe('Handyman')
        expect(current.player.calling).toBe('Handyman')
        expect(current.home.maybeTryingCalling).toEqual(Option.none())
      }),
    )
  })

  test('with too few Bones, BUY changes nothing and the try-on stays', () => {
    const bought = modelAfter(
      tap(inPicker(player(3, 59)), 'Handyman'),
      Message.ClickedBuyCallingButton(),
    )
    expect(bought.boughtCosmetics).toEqual([])
    expect(bought.rank.spentBones).toBe(0)
    expect(bought.home.maybeTryingCalling).toEqual(Option.some('Handyman'))
    expect(bought.panel).toBe('Calling')
  })

  test('with exactly the price, BUY works and leaves nothing', () => {
    const bought = modelAfter(
      tap(inPicker(player(15, 200)), 'LineCook'),
      Message.ClickedBuyCallingButton(),
    )
    expect(bought.boughtCosmetics).toEqual(['hero:LineCook'])
    expect(bonesBalanceOf(bought.rank)).toBe(0)
  })

  test('BUY with no try-on buys nothing', () => {
    const bought = modelAfter(
      inPicker(player(3, 500)),
      Message.ClickedBuyCallingButton(),
    )
    expect(bought.boughtCosmetics).toEqual([])
  })

  test('a hero already owned is not paid for again', () => {
    const owned = modifyFields(inPicker(player(3, 500, ['hero:Handyman'])), {
      home: home =>
        modifyFields(home, {
          maybeTryingCalling: () => Option.some('Handyman'),
        }),
    })
    const again = modelAfter(owned, Message.ClickedBuyCallingButton())
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
    expect(restored.player.calling).toBe('You')
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
    const rolls = Array.from({ length: 12 })
    const heroesOf = (start: Model): ReadonlyArray<Calling> =>
      rolls
        .map<Calling>(() => 'You')
        .reduce<ReadonlyArray<Calling>>((picked, _roll, index) => {
          const seated = addBot(
            withoutBots(
              modifyFields(start, {
                cosmeticRngState: () => start.cosmeticRngState + index * 7919,
              }),
            ),
          )
          return [...picked, seated.home.bots[0]?.calling ?? 'You']
        }, [])
    expect(new Set(heroesOf(player(20, 0)))).toEqual(new Set(['You']))
    const mixed = new Set(heroesOf(player(20, 0, ['hero:LineCook'])))
    expect(
      [...mixed].every(calling => ['You', 'LineCook'].includes(calling)),
    ).toBe(true)
  })

  test('their picker offers no try-on for a hero for sale', () => {
    const picking = modelAfter(
      modelAfter(
        modelAfter(player(20, 500), Message.ClickedPlayButton()),
        Message.ClickedLobbyAddBotButton(),
      ),
      Message.ClickedLobbyBotHeroButton({ index: 0 }),
    )
    const tapped = modelAfter(picking, tapOf('LineCook'))
    expect(tapped.home.maybeTryingCalling).toEqual(Option.none())
    expect(tapped.home.bots[0]?.calling).not.toBe('LineCook')
  })
})
