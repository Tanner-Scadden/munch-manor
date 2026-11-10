import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { makeReader, makeWriter } from '@munch/netcode'

import { CoopBinding } from '../../../app/bindings'
import type { Model } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { Screen as CoopScreen } from '../../../domain/coopRoom'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, readyAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  resolveChangeLobby,
  resolveFocusCoop,
  writeSave,
} from '../../../test/testing'
import { heldGun } from '../../../world/gear/weapons'
import { COOK_STARTING_LIDS } from '../../../world/heroes/calling'
import { pointsForRank } from '../../../world/heroes/rank'
import {
  DEFAULT_ROOM_SETTINGS,
  readRoomSnapshot,
  roomSettingsOf,
  startRoomWorld,
  writeRoomSnapshot,
} from '../../../world/net/roomWorld'
import { focusOf, maybePlayerAt } from '../../../world/party/party'
import { HeroPickerBinding } from '../../coop/bindings'
import { Message as CoopMessage } from '../../coop/message'
import { freshRoom } from '../../coop/roomState'
import { ChangeLobby, FocusCoopElement } from '../../coop/steps'
import { CODE, lobbyOf, memberOf } from '../../coop/testing'
import { Message as HeroPickerMessage } from '../../heroes/message'

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

const tapCard = (calling: Calling) =>
  Story.messageIn(
    [CoopBinding, HeroPickerBinding],
    HeroPickerMessage.ClickedCard({ calling }),
  )

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
          },
        }),
        heroPicker: { status: 'Open', maybeTrying: Option.none() },
      }),
    })

  it.effect("is the player's pick at home too, and saved", () =>
    Story.story(
      APPLICATION,
      Story.given(pointed(4)),
      tapCard('Handyman'),
      Story.Command.expectExact(ChangeLobby, FocusCoopElement, WriteSave),
      Story.model(current => {
        expect(current.calling).toBe('Handyman')
        expect(focusOf(current).player.calling).toBe('Handyman')
      }),
      resolveChangeLobby(),
      resolveFocusCoop(),
      writeSave(),
    ),
  )

  it.effect('a hero the rank has not reached changes nothing at home', () =>
    Story.story(
      APPLICATION,
      Story.given(pointed(4)),
      tapCard('LineCook'),
      Story.model(current => {
        expect(current.calling).toBe(pointed(4).calling)
      }),
    ),
  )
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

  it.effect("is the player's name at home too, and saved", () =>
    Story.story(
      APPLICATION,
      Story.given(naming),
      Story.messageIn(CoopBinding, CoopMessage.SubmittedName()),
      Story.Command.expectExact(ChangeLobby, FocusCoopElement, WriteSave),
      Story.model(current => {
        expect(current.playerName).toBe('Gravy Dave')
      }),
      resolveChangeLobby(),
      resolveFocusCoop(),
      writeSave(),
    ),
  )

  it.effect('a cancelled rename changes nothing at home', () =>
    Story.story(
      APPLICATION,
      Story.given(naming),
      Story.messageIn(CoopBinding, CoopMessage.ClickedNameCancel()),
      Story.model(current => {
        expect(current.playerName).toBe('Old')
      }),
      resolveFocusCoop(),
    ),
  )
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
        },
      }),
      heroPicker: {
        status: 'Open',
        maybeTrying: Option.some('TrackStar' as const),
      },
    }),
  })
  const clickBuy = Story.messageIn(
    [CoopBinding, HeroPickerBinding],
    HeroPickerMessage.ClickedBuyButton(),
  )

  it.effect(
    'spends the Bones once, saves, and the hero is the pick in the room',
    () =>
      Story.story(
        APPLICATION,
        Story.given(trying),
        clickBuy,
        Story.Command.expectExact(ChangeLobby, FocusCoopElement, WriteSave),
        Story.model(current => {
          expect(current.boughtCosmetics).toContain('hero:TrackStar')
          expect(current.rank.spentBones).toBe(100)
          expect(current.calling).toBe('TrackStar')
          expect(current.coop.calling).toBe('TrackStar')
          expect(current.coop.bones).toBe(50)
          expect(current.coop.bought).toContain('hero:TrackStar')
        }),
        resolveChangeLobby(),
        resolveFocusCoop(),
        writeSave(),
      ),
  )

  // NOTE: co-op's screen put back as it was before the buy, so the second
  // tap reaches the root again.
  it.effect('a second tap buys nothing more', () =>
    Effect.gen(function* () {
      const once = yield* Story.story(
        APPLICATION,
        Story.given(trying),
        clickBuy,
        resolveChangeLobby(),
        resolveFocusCoop(),
        writeSave(),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(once, {
            coop: coop => ({ ...coop, screen: trying.coop.screen }),
          }),
        ),
        clickBuy,
        Story.model(again => {
          expect(again.rank.spentBones).toBe(100)
        }),
      )
    }),
  )

  it.effect('the root checks the Bones itself, whatever co-op believes', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(trying, {
          rank: current => ({ ...current, earnedBones: 99 }),
        }),
      ),
      clickBuy,
      Story.model(current => {
        expect(current.rank.spentBones).toBe(0)
        expect(current.boughtCosmetics).not.toContain('hero:TrackStar')
      }),
    ),
  )

  it.effect('too few Bones buys nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(trying, {
          rank: current => ({ ...current, earnedBones: 99 }),
          coop: coop => ({ ...coop, bones: 99 }),
        }),
      ),
      clickBuy,
      Story.model(current => {
        expect(current.rank.spentBones).toBe(0)
        expect(current.boughtCosmetics).not.toContain('hero:TrackStar')
      }),
    ),
  )
})
