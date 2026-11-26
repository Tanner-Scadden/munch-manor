import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlScene } from '@effect/ui/html/testing'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { addBot } from '../../../domain/bots'
import { LobbyMessage } from '../../../features/lobby/message'
import { restoreSave, saveOf } from '../../../platform/save'
import type { Calling } from '../../../shared/playerData'
import { readyAfterRead } from '../../../test/model.fixture'
import { byClass } from '../../../test/sceneTesting'
import {
  type StoryStep,
  modelAfter,
  openLobbyByKey,
  resolveFocusLobby,
  send,
  steps,
  storyOf,
  tapLobbyHero,
  writeSave,
} from '../../../test/testing'
import { callingStandingOf } from '../../../world/heroes/calling'
import {
  bonesBalanceOf,
  pointsForRank,
  rankOf,
  totalPointsOf,
} from '../../../world/heroes/rank'
import { focusOf } from '../../../world/party/party'
import { isHeroPickerUp } from '../../lobby/model'
import { HeroPicker } from '../block'
import { startingCallingOf } from '../callingPick'

// Buying a hero with Bones (src/features/heroes/callingPick.ts,
// src/app/update/lobby.ts): a rank opens a hero for sale, a tap tries it
// on, BUY pays, and a pick that is not bought starts YOU. The picker and
// the lobby hold no state: their taps reach the root as LobbyMessages.

const player = (
  rank: number,
  bones: number,
  bought: ReadonlyArray<string> = [],
): Model =>
  UiStruct.evolve(readyAfterRead, {
    rank: current => ({
      ...current,
      earnedPoints: pointsForRank(rank),
      earnedBones: bones,
    }),
    boughtCosmetics: () => bought,
  })

// NOTE: PLAY, then the hero card: the picker opens in the lobby.
const openPicker: StoryStep = steps(
  send(Message.ClickedPlayButton()),
  resolveFocusLobby(),
  send(LobbyMessage.RequestedLobbyHeroPicker()),
)

// NOTE: the picker opened at a rank that has reached a hero: the heroes
// reached are marked seen, and saved.
const openPickerWithUnlocks: StoryStep = steps(openPicker, writeSave)

// NOTE: the BUY pill on the hero tried on.
const clickBuy = (calling: Calling): StoryStep =>
  send(LobbyMessage.RequestedBuyLobbyHero({ calling }))

const withoutBots = (current: Model): Model =>
  UiStruct.evolve(current, {
    home: home => UiStruct.evolve(home, { bots: () => [] }),
  })

describe('a hero for sale', () => {
  it.effect('is locked below its rank: a tap tries nothing on', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(2, 500))
      s.pipe(openPicker, tapLobbyHero('Handyman'))
      expect(s.model.lobby.maybeTrying).toEqual(Option.none())
      expect(s.model.calling).toBe('You')
      expect(callingStandingOf('Handyman', 2, [])).toBe('Locked')
    }),
  )

  it.effect('is tried on at its rank, and nothing is spent or picked yet', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(3, 500))
      s.pipe(openPickerWithUnlocks, tapLobbyHero('Handyman'))
      expect(s.model.lobby.maybeTrying).toEqual(Option.some('Handyman'))
      expect(s.model.calling).toBe('You')
      expect(s.model.boughtCosmetics).toEqual([])
      expect(isHeroPickerUp(s.model.lobby)).toBe(true)
    }),
  )

  it.effect('an owned hero ends a try-on and is the pick', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(6, 500, ['hero:TrackStar']))
      s.pipe(openPickerWithUnlocks, tapLobbyHero('Handyman'))
      expect(s.model.lobby.maybeTrying).toEqual(Option.some('Handyman'))
      s.pipe(tapLobbyHero('TrackStar'), writeSave)
      expect(s.model.lobby.maybeTrying).toEqual(Option.none())
      expect(s.model.calling).toBe('TrackStar')
      expect(isHeroPickerUp(s.model.lobby)).toBe(false)
    }),
  )

  it.effect('BUY pays the price in Bones, keeps the hero, and picks it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(3, 100))
      s.pipe(
        openLobbyByKey,
        send(LobbyMessage.RequestedLobbyHeroPicker()),
        tapLobbyHero('Handyman'),
        writeSave,
        clickBuy('Handyman'),
        writeSave,
      )
      expect(s.model.boughtCosmetics).toEqual(['hero:Handyman'])
      expect(s.model.rank.spentBones).toBe(60)
      expect(bonesBalanceOf(s.model.rank)).toBe(40)
      expect(s.model.calling).toBe('Handyman')
      expect(focusOf(s.model).player.calling).toBe('Handyman')
      expect(s.model.lobby.maybeTrying).toEqual(Option.none())
      expect(isHeroPickerUp(s.model.lobby)).toBe(false)
    }),
  )

  it.effect(
    'with too few Bones, BUY changes nothing and the try-on stays',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(player(3, 59))
        s.pipe(
          openPickerWithUnlocks,
          tapLobbyHero('Handyman'),
          clickBuy('Handyman'),
        )
        expect(s.model.boughtCosmetics).toEqual([])
        expect(s.model.rank.spentBones).toBe(0)
        expect(s.model.lobby.maybeTrying).toEqual(Option.some('Handyman'))
        expect(isHeroPickerUp(s.model.lobby)).toBe(true)
      }),
  )

  it.effect('with exactly the price, BUY works and leaves nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(15, 200))
      s.pipe(
        openPickerWithUnlocks,
        tapLobbyHero('LineCook'),
        clickBuy('LineCook'),
        writeSave,
      )
      expect(s.model.boughtCosmetics).toEqual(['hero:LineCook'])
      expect(bonesBalanceOf(s.model.rank)).toBe(0)
    }),
  )

  // NOTE: the picker shows BUY only on a try-on, so with none there is no
  // BUY to tap. A child is a leaf in the root's Scene, so this is a Scene
  // of the picker itself, with the props the lobby hands it.
  it.effect('with no try-on, the picker offers no BUY', () =>
    Effect.gen(function* () {
      const open = yield* modelAfter(player(3, 500), openPickerWithUnlocks)
      const s = yield* HtmlScene.make(HeroPicker, {
        look: open.appearance,
        chosen: startingCallingOf(open),
        trying: null,
        rank: rankOf(totalPointsOf(open.rank)),
        bought: open.boughtCosmetics,
        bones: bonesBalanceOf(open.rank),
        fresh: open.freshUnlocks,
        layout: 'Panel',
      })
      s.expect(byClass('calling-card'))
        .toExist()
        .expect(byClass('calling-buy'))
        .toBeAbsent()
    }),
  )

  // NOTE: a BUY that reaches the root for a hero already owned: the root
  // checks what is owned itself.
  it.effect('a hero already owned is not paid for again', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(3, 500, ['hero:Handyman']))
      s.pipe(openPickerWithUnlocks, clickBuy('Handyman'))
      expect(s.model.rank.spentBones).toBe(0)
      expect(s.model.boughtCosmetics).toEqual(['hero:Handyman'])
    }),
  )
})

describe('the reset', () => {
  test('a rank 20 save from before owns only YOU: a saved Handyman starts YOU', () => {
    const old = UiStruct.evolve(player(20, 0), { calling: () => 'Handyman' })
    expect(old.boughtCosmetics).toEqual([])
    const restored = restoreSave(readyAfterRead, saveOf(old))
    expect(startingCallingOf(restored)).toBe('You')
    expect(focusOf(restored).player.calling).toBe('You')
  })

  test('the Bones balance is untouched, and a bought hero survives the save', () => {
    const bought = UiStruct.evolve(player(20, 321, ['hero:TrackStar']), {
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
      Array.map(rolls, (_roll, index): Calling => {
        const seated = addBot(
          withoutBots(
            UiStruct.evolve(start, {
              cosmetics: UiStruct.evolve({
                cosmeticRngState: () =>
                  start.cosmetics.cosmeticRngState + index * 7919,
              }),
            }),
          ),
        )
        return seated.home.bots[0]?.calling ?? 'You'
      })
    expect(new Set(heroesOf(player(20, 0)))).toEqual(new Set(['You']))
    const mixed = new Set(heroesOf(player(20, 0, ['hero:LineCook'])))
    expect(
      Array.every([...mixed], calling => ['You', 'LineCook'].includes(calling)),
    ).toBe(true)
  })

  it.effect('their picker offers no try-on for a hero for sale', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(player(20, 500))
      s.pipe(
        send(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedAddLobbyBot()),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 0 })),
        writeSave,
        tapLobbyHero('LineCook'),
      )
      expect(s.model.lobby.maybeTrying).toEqual(Option.none())
      expect(s.model.home.bots[0]?.calling).not.toBe('LineCook')
    }),
  )
})
