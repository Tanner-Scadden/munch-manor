import { Array, Match, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { Screen } from './coop/model'
import { freshRoom } from './coop/roomState'
import { CODE, lobbyOf, memberOf } from './coop/testing'
import {
  type CrewMember,
  SHARPSHOOTER_MIN_SHOTS,
  awardsOf,
  crewOf,
  hasAwards,
  mvpOf,
} from './crewAwards'
import { crewBoardShapes } from './crewBoardView'
import {
  awardsAtMs,
  beatSounds,
  crewDoneMs,
  doneMs,
  isBeatOver,
  sharedRunOf,
  skipBeat,
} from './endBeat'
import {
  CREW_BOARD_TOP_PX,
  END_BUTTONS_TOP_PX,
  crewCardBottomPx,
} from './endView'
import { update } from './main'
import { Life, type Model, Phase } from './model'
import {
  atSeat,
  crewInWave,
  home,
  pipeline,
  placeSeat,
  withSeatLife,
} from './model.fixture'
import { COOP_RULES, maybePlayerAt, modifyLeadSeat, playersOf } from './party'
import { badgeSprite } from './rankArt'
import { stepWorld } from './stepWorld'
import { ticks, zombieOf } from './testing'
import { WEAPONS } from './weapons'
import { withWorld } from './world'
import { type Intent, Pierce, type Seat, idleIntent } from './worldSchema'

// The crew board on a co-op end card (MULTIPLAYER.md, "The crew board"):
// each seat's run counted in the World, the awards those numbers win, and
// the card's beat and post.

const TICK_MS = FIXED_STEP_MS
const LEFT_X = 60
const RIGHT_X = 240
const ROW_Y = 104

const seatOf = (current: Model, slot: number): Seat =>
  Option.getOrThrow(maybePlayerAt(current, slot)).seat

// THE WORLD COUNTS

describe("each seat's run in the World", () => {
  test('going down counts a down, and a revive counts for whoever stood by', () => {
    const bitten = pipeline(
      placeSeat(0, RIGHT_X - 8, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y, 1),
      current =>
        modifyFields(current, {
          zombies: () => [zombieOf('Shambler', 900, RIGHT_X + 5, ROW_Y)],
        }),
    )(crewInWave(2))
    story(
      update,
      given(bitten),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).life._tag).toBe('Downed')
        expect(seatOf(current, 1).downs).toBe(1)
        expect(seatOf(current, 0).downs).toBe(0)
      }),
    )
    const downedBeside = pipeline(
      placeSeat(0, RIGHT_X - 8, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y, 0),
      withSeatLife(
        1,
        Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0 }),
      ),
    )(crewInWave(3))
    story(
      update,
      given(placeSeat(2, LEFT_X, ROW_Y)(downedBeside)),
      ...ticks(Math.ceil(COOP_RULES.reviveMs / TICK_MS), TICK_MS),
      model(current => {
        expect(seatOf(current, 1).life._tag).toBe('Standing')
        expect(seatOf(current, 0).revives).toBe(1)
        expect(seatOf(current, 1).revives).toBe(0)
        expect(seatOf(current, 2).revives).toBe(0)
      }),
    )
  })

  test('a shot fired counts for its shooter, and one that lands counts as a hit', () => {
    const firingSeatZero = new Map<number, Intent>([
      [0, { ...idleIntent, trigger: 'Held' }],
    ])
    const fired = withWorld(
      placeSeat(
        1,
        RIGHT_X,
        ROW_Y + 40,
      )(placeSeat(0, LEFT_X, ROW_Y)(crewInWave(2))),
      world => stepWorld(world, firingSeatZero).world,
    )
    expect(seatOf(fired, 0).shotsFired).toBe(1)
    expect(seatOf(fired, 1).shotsFired).toBe(0)

    const landing = pipeline(
      placeSeat(0, LEFT_X, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y + 40),
      current =>
        modifyFields(current, {
          zombies: () => [zombieOf('Shambler', 900, 150, ROW_Y, { hp: 99 })],
          bullets: () => [
            {
              id: 800,
              x: 140,
              y: ROW_Y,
              velocityX: 300,
              velocityY: 0,
              remainingMs: 1000,
              weapon: 'Pistol' as const,
              damage: WEAPONS.Pistol.damage,
              knockback: 0,
              glaze: 'Plain' as const,
              pierce: Pierce.Stops(),
              shooter: 1,
            },
          ],
        }),
    )(crewInWave(2))
    story(
      update,
      given(landing),
      ...ticks(2, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).shotsHit).toBe(1)
        expect(seatOf(current, 0).shotsHit).toBe(0)
      }),
    )
  })
})

// THE AWARDS

const member = (
  slot: number,
  fields: Partial<CrewMember> = {},
): CrewMember => ({
  slot,
  name: `P${slot + 1}`,
  rank: 1,
  kills: 0,
  revives: 0,
  downs: 0,
  earned: 0,
  spent: 0,
  shotsFired: 0,
  aim: 0,
  ...fields,
})

describe('the awards', () => {
  const crew = [
    member(0, { kills: 40, spent: 300, downs: 1 }),
    member(1, { kills: 55, revives: 3, shotsFired: 90, aim: 40 }),
    member(2, { kills: 55, downs: 4, shotsFired: 60, aim: 70 }),
  ]

  test('each goes to the best score, a tie to the lower seat', () => {
    expect(mvpOf(crew)).toEqual(Option.some(1))
    expect(awardsOf(crew, 0)).toEqual(['BigSpender'])
    expect(awardsOf(crew, 1)).toEqual(['Mvp', 'Medic'])
    expect(awardsOf(crew, 2)).toEqual(['Sharpshooter', 'MostMunched'])
  })

  test('nobody wins with nothing, and one lucky shot is no Sharpshooter', () => {
    const quiet = [
      member(0, { shotsFired: SHARPSHOOTER_MIN_SHOTS - 1, aim: 100 }),
      member(1, { shotsFired: SHARPSHOOTER_MIN_SHOTS, aim: 10 }),
    ]
    expect(awardsOf(quiet, 0)).toEqual([])
    expect(awardsOf(quiet, 1)).toEqual(['Sharpshooter'])
    expect(hasAwards([member(0), member(1)])).toBe(false)
  })

  test('a crew of one wins nothing', () => {
    expect(awardsOf([member(0, { kills: 9 })], 0)).toEqual([])
  })
})

// THE CARD

const seatRun =
  (slot: number, change: (seat: Seat) => Seat, earned = 0, balance = 0) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyLeadSeat(
        modifyFields(world, {
          wallet: wallet =>
            modifyFields(wallet, {
              earned: () => earned,
              balance: () => balance,
            }),
        }),
        change,
      ),
    )

const crewCard = pipeline(
  seatRun(0, seat => ({ ...seat, kills: 12, downs: 2 }), 400, 100),
  seatRun(
    1,
    seat => ({ ...seat, kills: 30, revives: 2, shotsFired: 50, shotsHit: 30 }),
    900,
    850,
  ),
  current =>
    modifyFields(current, {
      phase: () => Phase.GameOver({ wave: 5 }),
      screenMs: () => 0,
    }),
)(crewInWave(2))

// NOTE: the lobby's ranks, as each player sent them when they joined.
const withLobbyRanks = (current: Model): Model =>
  modifyFields(current, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: {
              ...freshRoom(CODE, 0),
              maybeLobby: Option.some(
                lobbyOf([
                  memberOf(0, 'Ana', false, '', false, 4),
                  memberOf(1, 'Bo', false, '', false, 27),
                ]),
              ),
            },
          }),
      }),
  })

const imageSources = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<string> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Image', image => [image.src]),
      Match.tag('Group', inner => imageSources(inner.shapes)),
      Match.orElse(() => []),
    ),
  )

const boardImages = (current: Model): ReadonlyArray<string> => {
  const drawn = crewBoardShapes(
    current,
    'Munched',
    crewDoneMs('Munched'),
    30,
    160,
  )
  return imageSources([...drawn.panel, ...drawn.rows])
}

describe("each player's rank on the board", () => {
  test('the crew reads each rank off the lobby, and 1 without one', () => {
    expect(Array.map(crewOf(crewCard), ({ rank }) => rank)).toEqual([1, 1])
    expect(
      Array.map(crewOf(withLobbyRanks(crewCard)), ({ rank }) => rank),
    ).toEqual([4, 27])
  })

  test("the board draws each player's badge by their rank's tier", () => {
    const wood = imageSources(badgeSprite('Wood'))
    const bronze = imageSources(badgeSprite('Bronze'))
    const bare = boardImages(crewCard)
    const ranked = boardImages(withLobbyRanks(crewCard))
    expect(bare.filter(src => wood.includes(src))).toHaveLength(2)
    expect(bare.filter(src => bronze.includes(src))).toHaveLength(0)
    expect(ranked.filter(src => wood.includes(src))).toHaveLength(1)
    expect(ranked.filter(src => bronze.includes(src))).toHaveLength(1)
  })
})

describe('the crew card in short landscape', () => {
  test("the board and the rank strip's bar end above the buttons", () => {
    expect(crewCardBottomPx(true)).toBeLessThan(END_BUTTONS_TOP_PX - 4)
    expect(crewCardBottomPx(false)).toBeLessThan(crewCardBottomPx(true))
  })

  test("the board's panel is drawn where the card says it ends", () => {
    const drawn = crewBoardShapes(
      crewCard,
      'Munched',
      crewDoneMs('Munched'),
      CREW_BOARD_TOP_PX,
      160,
    )
    const bottoms = Array.flatMap(drawn.panel, shape =>
      shape._tag === 'Rect' ? [shape.y + shape.height] : [],
    )
    expect(Math.max(...bottoms)).toBeLessThanOrEqual(crewCardBottomPx(false))
  })
})

describe("the crew's card", () => {
  test('reads every seat off the World', () => {
    expect(crewOf(crewCard)).toEqual([
      member(0, { kills: 12, downs: 2, earned: 400, spent: 300 }),
      member(1, {
        kills: 30,
        revives: 2,
        earned: 900,
        spent: 50,
        shotsFired: 50,
        aim: 60,
      }),
    ])
    expect(crewOf(home)).toEqual([])
    expect(Array.map(playersOf(crewCard), ({ slot }) => slot)).toEqual([0, 1])
  })

  test('its beat runs on to the awards, and a press skips there', () => {
    expect(crewDoneMs('Munched')).toBeGreaterThan(doneMs('Munched'))
    expect(
      isBeatOver(modifyFields(crewCard, { screenMs: () => doneMs('Munched') })),
    ).toBe(false)
    const skipped = skipBeat(crewCard)
    expect(skipped.screenMs).toBe(crewDoneMs('Munched'))
    expect(isBeatOver(skipped)).toBe(true)
  })

  test('the awards land with a fanfare', () => {
    const atMs = awardsAtMs('Munched')
    expect(beatSounds(crewCard, atMs - 1, atMs)).toContain('PowerUp')
    expect(beatSounds(crewCard, atMs - 20, atMs - 1)).not.toContain('PowerUp')
  })

  test('its post crowns the MVP and brags about your own award', () => {
    const run = sharedRunOf(crewCard)
    expect(run.crew).toBe(2)
    expect(run.maybeMvp).toEqual(Option.some({ name: 'P2', kills: 30 }))
    expect(run.maybeOwnAward).toEqual(Option.some('BigSpender'))
  })
})
