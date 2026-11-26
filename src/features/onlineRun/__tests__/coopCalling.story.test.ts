import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlCommand } from '@effect/ui/html'
import { describe, expect, it, test } from '@effect/vitest'
import { makeReader, makeWriter } from '@munch/netcode'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { Screen as CoopScreen } from '../../../domain/coopRoom'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, readyAfterRead } from '../../../test/model.fixture'
import {
  type StoryStep,
  checkModel,
  exactStoryOf,
  modelAfter,
  resolveChangeLobby,
  resolveFocusCoop,
  send,
  steps,
  writeSave,
} from '../../../test/testing'
import { heldGun } from '../../../world/gear/weapons'
import { pointsForRank } from '../../../world/heroes/rank'
import {
  DEFAULT_ROOM_SETTINGS,
  readRoomSnapshot,
  roomSettingsOf,
  startRoomWorld,
  writeRoomSnapshot,
} from '../../../world/net/roomWorld'
import { focusOf, maybePlayerAt } from '../../../world/party/party'
import { freshRoom } from '../../coop/roomState'
import { ChangeLobby } from '../../coop/steps'
import { CODE, lobbyOf, memberOf } from '../../coop/testing'

const CREW = [0, 1, 2]

const settingsWith = roomSettingsOf('Campaign', 'Normal', [
  { slot: 0, calling: 'Handyman' },
  { slot: 2, calling: 'LineCook' },
])

const seatOf = (room: ReturnType<typeof startRoomWorld>, slot: number) =>
  Option.getOrThrow(maybePlayerAt(room.world, slot)).player

const room = startRoomWorld(CREW, 7, settingsWith)

describe('seating the callings', () => {
  test('a Handyman at slot 0 has one fewer heart and the pistol', () => {
    const lead = seatOf(room, 0)
    expect(lead.calling).toBe('Handyman')
    expect(lead.hp).toBe(PLAYER_MAX_HP - 1)
    expect(heldGun(lead.arsenal).kind).toBe('Pistol')
  })

  test('a Line Cook at slot 2 holds the Pressure Cooker, fully loaded', () => {
    const cook = seatOf(room, 2)
    expect(cook.calling).toBe('LineCook')
    expect(cook.hp).toBe(PLAYER_MAX_HP)
    const gun = heldGun(cook.arsenal)
    expect(gun.kind).toBe('Cooker')
    expect(gun.loaded).toBe(4)
  })

  test('a slot with no calling plays YOU, as do all when none came', () => {
    const middle = seatOf(room, 1)
    expect(middle.calling).toBe('You')
    expect(middle.hp).toBe(PLAYER_MAX_HP)
    expect(heldGun(middle.arsenal).kind).toBe('Pistol')
    const bare = startRoomWorld(CREW, 7, DEFAULT_ROOM_SETTINGS)
    expect(Array.map(CREW, slot => seatOf(bare, slot).calling)).toEqual([
      'You',
      'You',
      'You',
    ])
  })

  test('a seat keeps its place in the room when it takes a calling', () => {
    const bare = startRoomWorld(CREW, 7, DEFAULT_ROOM_SETTINGS)
    expect(seatOf(room, 2).x).toBe(seatOf(bare, 2).x)
    expect(seatOf(room, 2).y).toBe(seatOf(bare, 2).y)
  })

  test('a calling the game does not know is dropped, and the seat plays YOU', () => {
    const odd = roomSettingsOf('Campaign', 'Normal', [
      { slot: 1, calling: 'Wizard' },
      { slot: 2, calling: 'TrackStar' },
    ])
    expect(odd.callings).toEqual([{ slot: 2, calling: 'TrackStar' }])
    expect(seatOf(startRoomWorld(CREW, 7, odd), 1).calling).toBe('You')
  })

  test('the callings come over the wire to a client', () => {
    const writer = makeWriter()
    writeRoomSnapshot(writer, room)
    const read = readRoomSnapshot(makeReader(writer.finish()))
    expect(
      Array.map(
        CREW,
        slot =>
          Option.getOrThrow(maybePlayerAt(read.world, slot)).player.calling,
      ),
    ).toEqual(['Handyman', 'You', 'LineCook'])
  })
})

const tapCard = (calling: Calling) => send(Message.PickedCoopHero({ calling }))

const expectLobbySaved: StoryStep = s =>
  s.expectExact(ChangeLobby, HtmlCommand.Focus, WriteSave)

const settleLobbySaved = steps(resolveChangeLobby, resolveFocusCoop, writeSave)

describe('picking a hero in the lobby', () => {
  const pointed = (rank: number): Model =>
    UiStruct.evolve(readyAfterRead, {
      rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
      boughtCosmetics: () => heroesBoughtBy(rank),
      coop: coop => ({
        ...coop,
        rank,
        bought: heroesBoughtBy(rank),
        screen: CoopScreen.InRoom({
          room: {
            ...freshRoom(CODE, 0),
            maybePlayerId: Option.some('player-0'),
            maybeLobby: Option.some(
              lobbyOf([memberOf(0, 'Ana', false, '', false, rank)]),
            ),
          },
        }),
        heroPick: { isOpen: true, maybeTrying: Option.none() },
      }),
    })

  it.effect("is the player's pick at home too, and saved", () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(pointed(4))
      s.pipe(
        tapCard('Handyman'),
        expectLobbySaved,
        checkModel(current => {
          expect(current.calling).toBe('Handyman')
          expect(focusOf(current).player.calling).toBe('Handyman')
        }),
        settleLobbySaved,
      )
    }),
  )

  it.effect('a hero the rank has not reached changes nothing at home', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(pointed(4))
      s.pipe(
        tapCard('LineCook'),
        checkModel(current => {
          expect(current.calling).toBe(pointed(4).calling)
        }),
      )
    }),
  )
})

describe('renaming yourself in the lobby', () => {
  const naming: Model = UiStruct.evolve(readyAfterRead, {
    playerName: () => 'Old',
    coop: coop => ({
      ...coop,
      screen: CoopScreen.InRoom({
        room: {
          ...freshRoom(CODE, 0),
          maybePlayerId: Option.some('player-0'),
          maybeLobby: Option.some(lobbyOf([memberOf(0, 'Old')])),
          maybeNameDraft: Option.some('Gravy Dave '),
        },
      }),
    }),
  })

  it.effect("is the player's name at home too, and saved", () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(naming)
      s.pipe(
        send(Message.SubmittedCoopName()),
        expectLobbySaved,
        checkModel(current => {
          expect(current.playerName).toBe('Gravy Dave')
        }),
        settleLobbySaved,
      )
    }),
  )

  it.effect('a cancelled rename changes nothing at home', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(naming)
      s.pipe(
        send(Message.ClickedCoopNameCancel()),
        checkModel(current => {
          expect(current.playerName).toBe('Old')
        }),
        resolveFocusCoop,
      )
    }),
  )
})

describe('buying a hero in the lobby', () => {
  const trying: Model = UiStruct.evolve(readyAfterRead, {
    rank: current => ({
      ...current,
      earnedPoints: pointsForRank(7),
      earnedBones: 150,
      spentBones: 0,
    }),
    coop: coop => ({
      ...coop,
      rank: 7,
      bones: 150,
      screen: CoopScreen.InRoom({
        room: {
          ...freshRoom(CODE, 0),
          maybePlayerId: Option.some('player-0'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana', false, '', false, 7)]),
          ),
        },
      }),
      heroPick: {
        isOpen: true,
        maybeTrying: Option.some<Calling>('TrackStar'),
      },
    }),
  })
  const clickBuy = send(Message.RequestedBuyCoopHero({ calling: 'TrackStar' }))

  it.effect(
    'spends the Bones once, saves, and the hero is the pick in the room',
    () =>
      Effect.gen(function* () {
        const s = yield* exactStoryOf(trying)
        s.pipe(
          clickBuy,
          expectLobbySaved,
          checkModel(current => {
            expect(current.boughtCosmetics).toContain('hero:TrackStar')
            expect(current.rank.spentBones).toBe(100)
            expect(current.calling).toBe('TrackStar')
            expect(current.coop.calling).toBe('TrackStar')
            expect(current.coop.bones).toBe(50)
            expect(current.coop.bought).toContain('hero:TrackStar')
          }),
          settleLobbySaved,
        )
      }),
  )

  it.effect('a second tap buys nothing more', () =>
    Effect.gen(function* () {
      const once = yield* modelAfter(trying, steps(clickBuy, settleLobbySaved))
      const s = yield* exactStoryOf(
        UiStruct.evolve(once, {
          coop: coop => ({ ...coop, screen: trying.coop.screen }),
        }),
      )
      s.pipe(
        clickBuy,
        checkModel(again => {
          expect(again.rank.spentBones).toBe(100)
        }),
      )
    }),
  )

  it.effect('the root checks the Bones itself, whatever co-op believes', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(
        UiStruct.evolve(trying, {
          rank: current => ({ ...current, earnedBones: 99 }),
        }),
      )
      s.pipe(
        clickBuy,
        checkModel(current => {
          expect(current.rank.spentBones).toBe(0)
          expect(current.boughtCosmetics).not.toContain('hero:TrackStar')
        }),
      )
    }),
  )

  it.effect('too few Bones buys nothing', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(
        UiStruct.evolve(trying, {
          rank: current => ({ ...current, earnedBones: 99 }),
          coop: coop => ({ ...coop, bones: 99 }),
        }),
      )
      s.pipe(
        clickBuy,
        checkModel(current => {
          expect(current.rank.spentBones).toBe(0)
          expect(current.boughtCosmetics).not.toContain('hero:TrackStar')
        }),
      )
    }),
  )
})
