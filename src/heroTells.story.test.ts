import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { BODIES, OUTFITS, playerPixels } from './appearance'
import { CALLINGS } from './calling'
import { playerOfCalling } from './callingPlayer'
import { Screen } from './coop/model'
import { freshRoom } from './coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import { coopNameShapes } from './coopMarksView'
import { HAT_ART } from './hatArt'
import { advanceTells, mendedSpots } from './heroTells'
import { GameEvent, type Model, Trap, defaultAppearance } from './model'
import {
  FIGHTING_PHASE,
  atSeat,
  crewInWave,
  playingModel,
} from './model.fixture'
import type { Appearance, Calling } from './playerData'
import { DEFAULT_ROOM_SETTINGS, startRoomWorld } from './roomWorld'
import { STALL_BOX } from './shop'
import { mendCues } from './update/sound'

// The heroes' tells (src/heroTells.ts, src/appearance.ts, and the name tags):
// each hero wears its trade on the body under any hat and shows a small
// effect to the whole crew. YOU shows nothing.

const HEROES: ReadonlyArray<Calling> = CALLINGS.filter(
  calling => calling !== 'You',
)

// NOTE: the blank row and the six rows of the face.
const HEAD_ROWS = 7

const lookWith = (patch: Partial<Appearance>): Appearance => ({
  ...defaultAppearance,
  ...patch,
})

const withCalling =
  (calling: Calling) =>
  (current: Model): Model =>
    modifyFields(current, { player: () => playerOfCalling(calling) })

const runningRight = (current: Model): Model =>
  modifyFields(current, {
    intent: intent => modifyFields(intent, { move: () => ({ x: 1, y: 0 }) }),
  })

const SECOND_MS = 1000
const FRAME_MS = 1000 / 60

// NOTE: a second of frames of the tells alone, the way the frame makes them.
const tellsFor = (start: Model, ms = SECOND_MS): Model =>
  Array.reduce(
    Array.makeBy(Math.round(ms / FRAME_MS), () => 0),
    start,
    current => advanceTells(current, FRAME_MS),
  )

const kindsOf = (current: Model): ReadonlyArray<string> =>
  Array.map(current.particles, ({ kind }) => kind)

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
              // NOTE: below the face something changed: the prop.
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

  const paid = (calling: Calling, hasKill: boolean): Model =>
    modifyFields(withCalling(calling)(playingModel), {
      wallet: wallet => modifyFields(wallet, { earned: () => 8 }),
      tellWatch: () => ({ traps: [], earned: [{ slot: 0, earned: 2 }] }),
      frameEvents: () =>
        hasKill
          ? [
              GameEvent.ZombieKilled({
                x: 10,
                y: 10,
                direction: { x: 1, y: 0 },
                bounty: 6,
                kind: 'Shambler',
              }),
            ]
          : [],
    })

  test('a kill that pays the Penny Pincher glints a coin on him', () => {
    const kinds = kindsOf(advanceTells(paid('PennyPincher', true), FRAME_MS))
    expect(kinds).toContain('Coin')
    expect(kinds).toContain('Spark')
  })

  test('no glint without a kill, or for a hero who is not the Penny Pincher', () => {
    expect(
      kindsOf(advanceTells(paid('PennyPincher', false), FRAME_MS)),
    ).toEqual([])
    expect(kindsOf(advanceTells(paid('You', true), FRAME_MS))).toEqual([])
  })

  const atTheStall = (calling: Calling): Model =>
    modifyFields(withCalling(calling)(playingModel), {
      phase: () => FIGHTING_PHASE,
      player: player =>
        modifyFields(player, {
          x: () => (STALL_BOX.left + STALL_BOX.right) / 2,
          y: () => STALL_BOX.bottom + 6,
        }),
      traps: () => [
        Trap.Barricade({ id: 5, door: 'West', hp: 30, hitRemainingMs: 0 }),
      ],
      tellWatch: () => ({ traps: [{ id: 5, hp: 10 }], earned: [] }),
    })

  test('a trap mended with a Handyman at the stall throws sparks and tinks once', () => {
    const mended = atTheStall('Handyman')
    expect(mendedSpots(mended, mended.tellWatch)).toHaveLength(1)
    const after = advanceTells(mended, FRAME_MS)
    expect(
      Array.filter(kindsOf(after), kind => kind === 'Spark').length,
    ).toBeGreaterThan(0)
    expect(mendCues(mended, after).map(({ sound }) => sound)).toEqual(['Tink'])
    // NOTE: seen now, so the next frame makes no more.
    expect(mendCues(after, advanceTells(after, FRAME_MS))).toEqual([])
    expect(kindsOf(advanceTells(after, FRAME_MS))).toHaveLength(
      kindsOf(after).length,
    )
  })

  test('a repair with no Handyman at the stall shows nothing', () => {
    const other = atTheStall('You')
    expect(kindsOf(advanceTells(other, FRAME_MS))).toEqual([])
    expect(mendCues(other, advanceTells(other, FRAME_MS))).toEqual([])
  })

  test('a teammate Track Star running in a crew kicks up dust for everyone', () => {
    const crew = atSeat(crewInWave(3), 2, world =>
      modifyFields(world, {
        player: () => playerOfCalling('TrackStar'),
        intent: intent =>
          modifyFields(intent, { move: () => ({ x: 0, y: 1 }) }),
      }),
    )
    expect(kindsOf(tellsFor(crew))).toContain('Dust')
    const calm = atSeat(crewInWave(3), 2, world =>
      modifyFields(world, { player: () => playerOfCalling('Handyman') }),
    )
    expect(kindsOf(tellsFor(runningRight(calm)))).not.toContain('Smoke')
  })
})

describe('the hero icon on a teammate name tag', () => {
  const online = (calling: Calling): Model => {
    const crew = atSeat(crewInWave(2), 1, world =>
      modifyFields(world, { player: () => playerOfCalling(calling) }),
    )
    const world = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    return modifyFields(crew, {
      coop: coop =>
        modifyFields(coop, {
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
