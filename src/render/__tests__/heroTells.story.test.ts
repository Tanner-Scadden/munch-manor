import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  GameEvent,
  type Model,
  Phase,
  Trap,
  defaultAppearance,
} from '../../app/model'
import { mendCues } from '../../app/update/sound'
import { BODIES, OUTFITS, playerPixels } from '../../art/appearance'
import { HAT_ART } from '../../art/sprites/hatArt'
import { Screen } from '../../domain/coopRoom'
import { freshRoom } from '../../features/coop/roomState'
import {
  CODE,
  lobbyOf,
  memberOf,
  playingSession,
} from '../../features/coop/testing'
import { coopNameShapes } from '../../features/onlineRun/coopMarksView'
import type { Appearance, Calling } from '../../shared/playerData'
import { atSeat, crewInWave, playingModel } from '../../test/model.fixture'
import { TRAPS } from '../../world/gear/traps'
import { CALLINGS } from '../../world/heroes/calling'
import { playerOfCalling } from '../../world/heroes/callingPlayer'
import {
  DEFAULT_ROOM_SETTINGS,
  startRoomWorld,
} from '../../world/net/roomWorld'
import { modifyFocus } from '../../world/party/party'
import { advanceTells, mendedSpots } from '../heroTells'

// The heroes' tells (src/render/heroTells.ts, src/art/appearance.ts, and the name tags):
// each hero wears its trade on the body under any hat and shows a small
// effect to the whole crew. YOU shows nothing.

const HEROES: ReadonlyArray<Calling> = Array.filter(
  CALLINGS,
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
    modifyFocus(current, { player: () => playerOfCalling(calling) })

const runningRight = (current: Model): Model =>
  modifyFocus(current, {
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
    modifyFocus(
      modifyFields(withCalling(calling)(playingModel), {
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
                  maybeKiller: Option.none(),
                  source: 'Other',
                }),
              ]
            : [],
      }),
      { wallet: wallet => modifyFields(wallet, { earned: () => 8 }) },
    )

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

  // NOTE: standing still at a Plank Pile in a break, mending it past a
  // third of its health since the last frame.
  const atTheTrap = (calling: Calling): Model =>
    modifyFocus(
      modifyFields(withCalling(calling)(playingModel), {
        phase: () =>
          Phase.Preparation({
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
        tellWatch: () => ({ traps: [{ id: 5, hp: 10 }], earned: [] }),
      }),
      {
        player: player =>
          modifyFields(player, {
            x: () => 14,
            y: () => 90,
          }),
      },
    )

  test('a trap a Handyman mends throws sparks and tinks as it passes a third', () => {
    const mended = atTheTrap('Handyman')
    expect(mendedSpots(mended, mended.tellWatch)).toHaveLength(1)
    const after = advanceTells(mended, FRAME_MS)
    expect(
      Array.filter(kindsOf(after), kind => kind === 'Spark').length,
    ).toBeGreaterThan(0)
    expect(Array.map(mendCues(mended, after), ({ sound }) => sound)).toEqual([
      'Tink',
    ])
    // NOTE: seen now, so the next frame makes no more.
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
          modifyFields(intent, { move: () => ({ x: 0, y: 1 }) }),
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
