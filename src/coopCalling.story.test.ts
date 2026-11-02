import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { makeReader, makeWriter } from '@munch/netcode'

import { CoopBinding } from './bindings'
import { COOK_STARTING_LIDS } from './calling'
import { PLAYER_MAX_HP } from './constants'
import { Message as CoopMessage } from './coop/message'
import { Screen as CoopScreen } from './coop/model'
import { freshRoom } from './coop/roomState'
import { CODE, lobbyOf, memberOf } from './coop/testing'
import { update } from './main'
import type { Model } from './model'
import { heroesBoughtBy, readyAfterRead } from './model.fixture'
import { maybePlayerAt } from './party'
import { pointsForRank } from './rank'
import {
  DEFAULT_ROOM_SETTINGS,
  readRoomSnapshot,
  roomSettingsOf,
  roomWorldFor,
  startRoomWorld,
  writeRoomSnapshot,
} from './roomWorld'
import { heldGun } from './weapons'
import { Phase } from './worldSchema'

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
      toParentMessage(
        CoopBinding,
        CoopMessage.ClickedCallingPick({ calling: 'Handyman' }),
      ),
    )
    expect(result.model.calling).toBe('Handyman')
    expect(result.model.player.calling).toBe('Handyman')
    expect(Array.map(result.commands ?? [], command => command.name)).toContain(
      'Application/WriteSave',
    )
  })

  test('a hero the rank has not reached changes nothing at home', () => {
    const result = update(
      pointed(4),
      toParentMessage(
        CoopBinding,
        CoopMessage.ClickedCallingPick({ calling: 'LineCook' }),
      ),
    )
    expect(result.model.calling).toBe(pointed(4).calling)
  })
})
