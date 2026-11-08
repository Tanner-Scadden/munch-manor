import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { makeReader, makeWriter } from '@munch/netcode'

import { CoopBinding } from '../../../app/bindings'
import type { Model } from '../../../app/model'
import { Child, update } from '../../../app/pureApp'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import { heroesBoughtBy, readyAfterRead } from '../../../test/model.fixture'
import { heldGun } from '../../../world/gear/weapons'
import { COOK_STARTING_LIDS } from '../../../world/heroes/calling'
import { pointsForRank } from '../../../world/heroes/rank'
import {
  DEFAULT_ROOM_SETTINGS,
  readRoomSnapshot,
  roomSettingsOf,
  roomWorldFor,
  startRoomWorld,
  writeRoomSnapshot,
} from '../../../world/net/roomWorld'
import { focusOf, maybePlayerAt } from '../../../world/party/party'
import { Phase } from '../../../world/schema/worldSchema'
import { Message as CoopMessage } from '../../coop/message'
import { Screen as CoopScreen } from '../../coop/model'
import { freshRoom } from '../../coop/roomState'
import { CODE, lobbyOf, memberOf } from '../../coop/testing'

// A co-op room seats each player as the calling they brought (the lobby's
// member row, packages/netcode Lobby.ts): its hearts and its gun, per seat.

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

  test('a Line Cook at slot 2 holds the Pressure Cooker with fewer lids', () => {
    const cook = seatOf(room, 2)
    expect(cook.calling).toBe('LineCook')
    expect(cook.hp).toBe(PLAYER_MAX_HP)
    const gun = heldGun(cook.arsenal)
    expect(gun.kind).toBe('Cooker')
    expect(gun.rounds).toBe(COOK_STARTING_LIDS)
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

describe('KEEP GOING', () => {
  test('keeps the kept crew in the callings they played', () => {
    const won = modifyFields(room.world, { phase: () => Phase.Victory() })
    const rules = roomWorldFor(
      roomSettingsOf('KeepGoing', 'Normal', [
        { slot: 0, calling: 'TrackStar' },
        { slot: 1, calling: 'PennyPincher' },
      ]),
      Option.some(won),
    )
    const kept = rules.start(CREW, 99)
    expect(Array.map(CREW, slot => seatOf(kept, slot).calling)).toEqual([
      'Handyman',
      'You',
      'LineCook',
    ])
    expect(seatOf(kept, 0).hp).toBe(seatOf(room, 0).hp)
  })
})

describe('picking a hero in the lobby', () => {
  const pointed = (rank: number): Model =>
    modifyFields(readyAfterRead, {
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
            isPickingCalling: true,
          },
        }),
      }),
    })

  test("is the player's pick at home too, and saved", () => {
    const result = update(
      pointed(4),
      Child.message(
        CoopBinding,
        CoopMessage.ClickedCallingPick({ calling: 'Handyman' }),
      ),
    )
    expect(result.model.calling).toBe('Handyman')
    expect(focusOf(result.model).player.calling).toBe('Handyman')
    expect(Array.map(result.commands ?? [], command => command.name)).toContain(
      'Application/WriteSave',
    )
  })

  test('a hero the rank has not reached changes nothing at home', () => {
    const result = update(
      pointed(4),
      Child.message(
        CoopBinding,
        CoopMessage.ClickedCallingPick({ calling: 'LineCook' }),
      ),
    )
    expect(result.model.calling).toBe(pointed(4).calling)
  })
})

describe('renaming yourself in the lobby', () => {
  const naming: Model = modifyFields(readyAfterRead, {
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

  test("is the player's name at home too, and saved", () => {
    const result = update(
      naming,
      Child.message(CoopBinding, CoopMessage.SubmittedName()),
    )
    expect(result.model.playerName).toBe('Gravy Dave')
    expect(Array.map(result.commands ?? [], command => command.name)).toContain(
      'Application/WriteSave',
    )
  })

  test('a cancelled rename changes nothing at home', () => {
    const result = update(
      naming,
      Child.message(CoopBinding, CoopMessage.ClickedNameCancel()),
    )
    expect(result.model.playerName).toBe('Old')
  })
})

describe('buying a hero in the lobby', () => {
  // NOTE: rank 7 has reached the Track Star (100 Bones); 150 are earned.
  const trying: Model = modifyFields(readyAfterRead, {
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
          isPickingCalling: true,
          maybeTryingCalling: Option.some('TrackStar' as const),
        },
      }),
    }),
  })
  const buy = (model: Model) =>
    update(
      model,
      Child.message(CoopBinding, CoopMessage.ClickedBuyCallingButton()),
    )

  test('spends the Bones once, saves, and the hero is the pick in the room', () => {
    const result = buy(trying)
    expect(result.model.boughtCosmetics).toContain('hero:TrackStar')
    expect(result.model.rank.spentBones).toBe(100)
    expect(result.model.calling).toBe('TrackStar')
    expect(result.model.coop.calling).toBe('TrackStar')
    expect(result.model.coop.bones).toBe(50)
    expect(result.model.coop.bought).toContain('hero:TrackStar')
    expect(Array.map(result.commands ?? [], command => command.name)).toEqual(
      expect.arrayContaining(['Application/WriteSave']),
    )
  })

  test('a second tap buys nothing more', () => {
    const once = buy(trying).model
    const again = buy(
      modifyFields(once, {
        coop: coop => ({
          ...coop,
          screen: trying.coop.screen,
        }),
      }),
    )
    expect(again.model.rank.spentBones).toBe(100)
  })

  test('the root checks the Bones itself, whatever co-op believes', () => {
    const stale = modifyFields(trying, {
      rank: current => ({ ...current, earnedBones: 99 }),
    })
    const result = buy(stale)
    expect(result.model.rank.spentBones).toBe(0)
    expect(result.model.boughtCosmetics).not.toContain('hero:TrackStar')
  })

  test('too few Bones buys nothing', () => {
    const poor = modifyFields(trying, {
      rank: current => ({ ...current, earnedBones: 99 }),
      coop: coop => ({ ...coop, bones: 99 }),
    })
    const result = buy(poor)
    expect(result.model.rank.spentBones).toBe(0)
    expect(result.model.boughtCosmetics).not.toContain('hero:TrackStar')
  })
})
