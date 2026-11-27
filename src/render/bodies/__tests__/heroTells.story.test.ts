import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import {
  BreakClock,
  type Model,
  Phase,
  Trap,
  defaultAppearance,
} from '#app/model.ts'
import { mendCues } from '#app/update/sound.ts'
import { BODIES, OUTFITS, playerPixels } from '#art/appearance.ts'
import { HAT_ART } from '#art/sprites/hatArt.ts'
import { Screen } from '#domain/coopRoom.ts'
import { freshRoom } from '#features/coop/roomState.ts'
import {
  CODE,
  lobbyOf,
  memberOf,
  playingSession,
} from '#features/coop/services/testing.ts'
import { coopNameShapes } from '#features/onlineRun/coopMarksView.ts'
import { advanceTells, mendedSpots } from '#render/bodies/heroTells.ts'
import type { Appearance, Calling } from '#shared/records/playerData.ts'
import { atSeat, crewInWave, playingModel } from '#test/model.fixture.ts'
import { TRAPS } from '#world/gear/traps.ts'
import { CALLINGS } from '#world/heroes/calling.ts'
import { playerOfCalling } from '#world/heroes/callingPlayer.ts'
import { START_LEVEL } from '#world/level/arena.ts'
import { DEFAULT_ROOM_SETTINGS, startRoomWorld } from '#world/net/roomWorld.ts'
import { modifyFocus } from '#world/party/party.ts'

const HEROES: ReadonlyArray<Calling> = Array.filter(
  CALLINGS,
  calling => calling !== 'You',
)

const HEAD_ROWS = 7

const lookWith = (patch: Partial<Appearance>): Appearance => ({
  ...defaultAppearance,
  ...patch,
})

const withCalling =
  (calling: Calling) =>
  (current: Model): Model =>
    modifyFocus(current, { player: () => playerOfCalling(calling) })

const runningRight = (current: Model): Model =>
  modifyFocus(current, {
    intent: intent => UiStruct.evolve(intent, { move: () => ({ x: 1, y: 0 }) }),
  })

const SECOND_MS = 1000
const FRAME_MS = 1000 / 60

const tellsFor = (start: Model, ms = SECOND_MS): Model =>
  Array.reduce(
    Array.makeBy(Math.round(ms / FRAME_MS), () => 0),
    start,
    current => advanceTells(current, FRAME_MS),
  )

const kindsOf = (current: Model): ReadonlyArray<string> =>
  Array.map(current.cosmetics.particles, ({ kind }) => kind)

describe('the body prop on the sprite', () => {
  test('YOU wears nothing over the player look', () => {
    const plain = playerPixels(defaultAppearance)
    expect(playerPixels(defaultAppearance, 'You')).toEqual(plain)
  })

  Array.forEach(HEROES, hero => {
    test(`${hero} wears a body prop in every pose, body, and outfit, with and without a hat`, () => {
      Array.forEach(BODIES, body =>
        Array.forEach(OUTFITS, outfit =>
          Array.forEach(['None', 'TopHat'] as const, hat => {
            const look = lookWith({ body, outfit, hat })
            const plain = playerPixels(look)
            const dressed = playerPixels(look, hero)
            const poses = [...dressed.idle, ...dressed.walk]
            const plainPoses = [...plain.idle, ...plain.walk]
            Array.forEach(poses, (frame, index) => {
              const bare = plainPoses[index] ?? []
              const below =
                HEAD_ROWS + 1 + (hat === 'None' ? 0 : HAT_ART[hat].above)
              expect(frame.slice(below)).not.toEqual(bare.slice(below))
              expect(frame).toHaveLength(bare.length)
            })
          }),
        ),
      )
    })

    test(`${hero}'s headgear is the default on a bare head, and a hat replaces it`, () => {
      const hatted = lookWith({ hat: 'TopHat' })
      const headRows = HAT_ART.TopHat.above + HEAD_ROWS
      expect(playerPixels(hatted, hero).idle[0].slice(0, headRows)).toEqual(
        playerPixels(hatted).idle[0].slice(0, headRows),
      )
      expect(playerPixels(defaultAppearance, hero).idle[0]).not.toEqual(
        playerPixels(defaultAppearance).idle[0],
      )
    })
  })
})

describe('the signature effects', () => {
  test('a running Track Star kicks up dust, a standing one does not', () => {
    const star = withCalling('TrackStar')(playingModel)
    expect(kindsOf(tellsFor(runningRight(star)))).toContain('Dust')
    expect(kindsOf(tellsFor(star))).toEqual([])
  })

  test('YOU running shows no tell', () => {
    expect(kindsOf(tellsFor(runningRight(playingModel)))).toEqual([])
  })

  test('a Line Cook with the Pressure Cooker in hand lets off steam', () => {
    expect(
      kindsOf(tellsFor(withCalling('LineCook')(playingModel), 4000)),
    ).toContain('Smoke')
    expect(
      kindsOf(tellsFor(withCalling('Handyman')(playingModel), 4000)),
    ).toEqual([])
  })

  const keyed = (calling: Calling, hasFound: boolean): Model =>
    modifyFocus(
      UiStruct.evolve(withCalling(calling)(playingModel), {
        cosmetics: UiStruct.evolve({
          tellWatch: () => ({
            traps: [],
            keysFound: [{ slot: 0, keysFound: 2 }],
          }),
        }),
      }),
      {
        seat: seat =>
          UiStruct.evolve(seat, { keysFound: () => (hasFound ? 3 : 2) }),
      },
    )

  test('keys found by the Penny Pincher glint a coin on her', () => {
    const kinds = kindsOf(advanceTells(keyed('PennyPincher', true), FRAME_MS))
    expect(kinds).toContain('Coin')
    expect(kinds).toContain('Spark')
  })

  test('no glint without a key found, or for a hero who is not the Penny Pincher', () => {
    expect(
      kindsOf(advanceTells(keyed('PennyPincher', false), FRAME_MS)),
    ).toEqual([])
    expect(kindsOf(advanceTells(keyed('You', true), FRAME_MS))).toEqual([])
  })

  const atTheTrap = (calling: Calling): Model =>
    modifyFocus(
      UiStruct.evolve(withCalling(calling)(playingModel), {
        phase: () =>
          Phase.Preparation({
            clock: BreakClock.Counting(),
            wave: 3,
            remainingMs: 15_000,
            durationMs: 15_000,
            spawns: [],
          }),
        traps: () => [
          Trap.Barricade({
            id: 5,
            door: 'West',
            hp: 30,
            maxHp: TRAPS.Barricade.hp,
            hitRemainingMs: 0,
          }),
        ],
        cosmetics: UiStruct.evolve({
          tellWatch: () => ({ traps: [{ id: 5, hp: 10 }], keysFound: [] }),
        }),
      }),
      {
        player: player =>
          UiStruct.evolve(player, {
            x: () => 14,
            y: () => START_LEVEL.doors.West.center.y,
          }),
      },
    )

  test('a trap a Handyman mends throws sparks and tinks as it passes a third', () => {
    const mended = atTheTrap('Handyman')
    expect(mendedSpots(mended, mended.cosmetics.tellWatch)).toHaveLength(1)
    const after = advanceTells(mended, FRAME_MS)
    expect(
      Array.filter(kindsOf(after), kind => kind === 'Spark').length,
    ).toBeGreaterThan(0)
    expect(Array.map(mendCues(mended, after), ({ sound }) => sound)).toEqual([
      'Tink',
    ])
    expect(mendCues(after, advanceTells(after, FRAME_MS))).toEqual([])
    expect(kindsOf(advanceTells(after, FRAME_MS))).toHaveLength(
      kindsOf(after).length,
    )
  })

  test('a mend by anyone else shows no tell', () => {
    const other = atTheTrap('You')
    expect(kindsOf(advanceTells(other, FRAME_MS))).toEqual([])
    expect(mendCues(other, advanceTells(other, FRAME_MS))).toEqual([])
  })

  test('a teammate Track Star running in a crew kicks up dust for everyone', () => {
    const crew = atSeat(crewInWave(3), 2, world =>
      modifyFocus(world, {
        player: () => playerOfCalling('TrackStar'),
        intent: intent =>
          UiStruct.evolve(intent, { move: () => ({ x: 0, y: 1 }) }),
      }),
    )
    expect(kindsOf(tellsFor(crew))).toContain('Dust')
    const calm = atSeat(crewInWave(3), 2, world =>
      modifyFocus(world, { player: () => playerOfCalling('Handyman') }),
    )
    expect(kindsOf(tellsFor(runningRight(calm)))).not.toContain('Smoke')
  })
})

describe('the hero icon on a teammate name tag', () => {
  const online = (calling: Calling): Model => {
    const crew = atSeat(crewInWave(2), 1, world =>
      modifyFocus(world, { player: () => playerOfCalling(calling) }),
    )
    const world = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    return UiStruct.evolve(crew, {
      coop: coop =>
        UiStruct.evolve(coop, {
          screen: () =>
            Screen.InRoom({
              room: {
                ...freshRoom(CODE, 0),
                maybePlayerId: Option.some('player-0'),
                maybeLobby: Option.some(
                  lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')], 'Playing'),
                ),
                link: 'Online',
                session: playingSession(world, 0),
              },
            }),
        }),
    })
  }

  const plateWidthOf = (current: Model): number => {
    const plate = Array.findFirst(
      coopNameShapes(current),
      shape => shape._tag === 'Rect' && shape.height === 6,
    )
    return Option.match(plate, {
      onNone: () => 0,
      onSome: shape => (shape._tag === 'Rect' ? shape.width : 0),
    })
  }

  test('a hero has a tiny icon before the name, YOU has none', () => {
    const bare = plateWidthOf(online('You'))
    expect(bare).toBeGreaterThan(0)
    Array.forEach(HEROES, hero => {
      expect(plateWidthOf(online(hero))).toBeGreaterThan(bare)
    })
  })
})
