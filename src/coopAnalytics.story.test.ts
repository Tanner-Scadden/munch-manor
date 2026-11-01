import { Array, Option, Result, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import type { Lobby } from '@munch/netcode'

import { RunSummary } from './analytics'
import { crewRunKeyOf } from './analyticsRun'
import { CoopBinding } from './bindings'
import { Message as CoopMessage } from './coop/message'
import { Screen } from './coop/model'
import { freshRoom, maybeRoomOf } from './coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import { update } from './main'
import { Message } from './message'
import { Lesson, type Model, initialModel } from './model'
import { WAVE_3_BREAK } from './model.fixture'
import { modifyLeadSeat, withSeat } from './party'
import { type RoomWorld, startRoomWorld } from './roomWorld'
import { SendRunSummary } from './update/settle'
import { asVeteran } from './veteran'
import { startWaveEarly } from './waves'
import { Phase, RunMode } from './worldSchema'

// An online co-op run's summary (src/analyticsRun.ts): each player's own
// client sends one when the run ends, from its own seat, on the room's
// difficulty, by its own sharing setting. The room is faked with a
// session already holding a World, as in src/coopPlay.story.test.ts.

const VISIT_ID = '0123456789abcdef'

const OWN_SLOT = 1

const started = startRoomWorld([0, OWN_SLOT, 2], 7, {
  difficulty: 'Hard',
  mode: RunMode.Campaign(),
})

const fighting: RoomWorld = {
  ...started,
  world: withSeat(startWaveEarly(started.world), OWN_SLOT, world =>
    modifyLeadSeat(world, seat => ({
      ...seat,
      kills: 12,
      downs: 2,
      revives: 1,
    })),
  ),
}

const endedAs = (phase: Phase): RoomWorld => ({
  ...fighting,
  tick: 1,
  world: modifyFields(fighting.world, { phase: () => phase }),
})

// NOTE: a player whose own difficulty is not the room's, so the summary
// shows which it read.
const player: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  difficulty: setting => modifyFields(setting, { chosen: () => 'Easy' }),
  maybeVisitId: () => Option.some(VISIT_ID),
})

const playingLobby: Lobby = lobbyOf(
  [memberOf(0, 'Ana'), memberOf(1, 'Bo'), memberOf(2, 'Cy')],
  'Playing',
)

type Seated = Readonly<{ slot: number; lobby: Lobby }>

const OWN_SEAT: Seated = { slot: OWN_SLOT, lobby: playingLobby }

const inRoom = (
  model: Model,
  world: RoomWorld,
  { slot, lobby }: Seated = OWN_SEAT,
): Model =>
  modifyFields(model, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: Option.match(maybeRoomOf(coop), {
              onNone: () => ({
                ...freshRoom(CODE, slot),
                maybePlayerId: Option.some(`player-${slot}`),
                maybeLobby: Option.some(lobby),
                link: 'Online' as const,
                session: playingSession(world, slot),
              }),
              onSome: room => ({
                ...room,
                maybeLobby: Option.some(lobby),
                session: playingSession(world, slot),
              }),
            }),
          }),
      }),
  })

// NOTE: the run under way, drawn from the room once.
const midRun = (model: Model = player, seated: Seated = OWN_SEAT): Model =>
  update(
    inRoom(model, fighting, seated),
    Message.TickedRoomFrame({ nowMs: 100 }),
  ).model

// NOTE: the run key a seat's client sends at Game Over.
const keyAtGameOver = (seated: Seated): string | undefined => {
  const [summary] = summariesOf(
    update(
      inRoom(
        midRun(player, seated),
        endedAs(Phase.GameOver({ wave: 1 })),
        seated,
      ),
      Message.TickedRoomFrame({ nowMs: 200 }),
    ),
  )
  return summary?.party._tag === 'Crew' ? summary.party.runKey : undefined
}

const summariesOf = (
  result: ReturnType<typeof update>,
): ReadonlyArray<RunSummary> =>
  Array.filterMap(result.commands ?? [], command =>
    command.name === SendRunSummary.name &&
    command.args !== undefined &&
    'summary' in command.args
      ? Result.fromOption(
          Schema.decodeUnknownOption(RunSummary)(command.args['summary']),
          () => undefined,
        )
      : Result.failVoid,
  )

const crewOfThree = {
  _tag: 'Crew',
  size: 3,
  seatKills: 12,
  seatDowns: 2,
  seatRevives: 1,
  runKey: crewRunKeyOf(playingLobby),
}

describe("an online co-op run's summary", () => {
  test('the run is under way, and nothing is sent yet', () => {
    const running = midRun()
    expect(running.phase._tag).toBe('Wave')
    expect(
      summariesOf(
        update(
          inRoom(running, fighting),
          Message.TickedRoomFrame({ nowMs: 200 }),
        ),
      ),
    ).toEqual([])
  })

  test("Game Over sends one, from this player's seat on the room's difficulty", () => {
    const result = update(
      inRoom(midRun(), endedAs(Phase.GameOver({ wave: 1 }))),
      Message.TickedRoomFrame({ nowMs: 200 }),
    )
    expect(result.model.phase._tag).toBe('GameOver')
    const summaries = summariesOf(result)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      version: 3,
      visitId: VISIT_ID,
      mode: 'Campaign',
      difficulty: 'Hard',
      wave: 1,
      outcome: { _tag: 'GameOver' },
      party: crewOfThree,
    })
  })

  test('Victory sends one, and leaving from the end card sends no second', () => {
    const won = update(
      inRoom(midRun(), endedAs(Phase.Victory())),
      Message.TickedRoomFrame({ nowMs: 200 }),
    )
    expect(won.model.phase._tag).toBe('Victory')
    expect(summariesOf(won)).toEqual([
      expect.objectContaining({
        outcome: { _tag: 'Victory' },
        difficulty: 'Hard',
        party: crewOfThree,
      }),
    ])
    const left = update(
      won.model,
      toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom()),
    )
    expect(left.model.phase._tag).toBe('Ready')
    expect(summariesOf(left)).toEqual([])
  })

  test("leaving the room mid-run sends a Quit, with the room's difficulty", () => {
    const left = update(
      midRun(),
      toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom()),
    )
    expect(left.model.phase._tag).toBe('Ready')
    expect(Option.isNone(maybeRoomOf(left.model.coop))).toBe(true)
    expect(summariesOf(left)).toEqual([
      expect.objectContaining({
        outcome: { _tag: 'Quit' },
        difficulty: 'Hard',
        wave: 1,
        party: crewOfThree,
      }),
    ])
  })

  test('nothing is sent with sharing off', () => {
    const private_ = midRun(
      modifyFields(player, { shareStats: () => 'Off' as const }),
    )
    expect(
      summariesOf(
        update(
          inRoom(private_, endedAs(Phase.GameOver({ wave: 1 }))),
          Message.TickedRoomFrame({ nowMs: 200 }),
        ),
      ),
    ).toEqual([])
    expect(
      summariesOf(
        update(
          private_,
          toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom()),
        ),
      ),
    ).toEqual([])
  })

  test('every client in one run sends the same run key', () => {
    const own = keyAtGameOver(OWN_SEAT)
    expect(own).toMatch(/^[0-9a-f]{16}$/)
    expect(keyAtGameOver({ ...OWN_SEAT, slot: 0 })).toBe(own)
    expect(keyAtGameOver({ ...OWN_SEAT, slot: 2 })).toBe(own)
  })

  test('a rematch in the room, or another room, sends another key', () => {
    const own = keyAtGameOver(OWN_SEAT)
    const keyIn = (lobby: Partial<Lobby>) =>
      keyAtGameOver({ ...OWN_SEAT, lobby: { ...playingLobby, ...lobby } })
    expect(keyIn({ round: playingLobby.round + 1 })).not.toBe(own)
    expect(keyIn({ code: 'ZZZZ' })).not.toBe(own)
    expect(keyIn({ createdMs: 1 })).not.toBe(own)
  })

  test('the room closing as the run ends keeps the run key', () => {
    const closed: Seated = {
      ...OWN_SEAT,
      lobby: { ...playingLobby, status: 'Closed' },
    }
    const [summary] = summariesOf(
      update(
        inRoom(midRun(), endedAs(Phase.GameOver({ wave: 1 })), closed),
        Message.TickedRoomFrame({ nowMs: 200 }),
      ),
    )
    expect(summary?.party).toMatchObject({
      runKey: keyAtGameOver(OWN_SEAT),
    })
  })

  test('leaving mid-run sends the key the run had', () => {
    const left = update(
      midRun(),
      toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom()),
    )
    const [summary] = summariesOf(left)
    expect(summary?.party).toMatchObject({
      runKey: keyAtGameOver(OWN_SEAT),
    })
  })
})

// NOTE: rank (src/rankRun.ts): each client pays its own seat. The crew's
// waves are the run's, on the room's difficulty (Hard here); the awards and
// revives are the player's own. Seat 1 has the most kills, the revive, and
// the most downs, so it wins the MVP, Medic, and Most Munched awards.
describe("an online co-op run's rank", () => {
  // NOTE: the client tallies its own stats from the room's events, so the
  // four waves cleared are on its Model.
  const clearedFour = (model: Model): Model =>
    modifyFields(model, {
      stats: stats => modifyFields(stats, { wavesCleared: () => 4 }),
    })

  test("Game Over pays the crew's waves on the room's difficulty, plus the seat's awards and revives", () => {
    const ended = update(
      inRoom(clearedFour(midRun()), endedAs(Phase.GameOver({ wave: 5 }))),
      Message.TickedRoomFrame({ nowMs: 200 }),
    ).model
    // NOTE: 4 waves x 10 x 1.5 = 60, 3 awards x 10, 1 revive x 5.
    expect(ended.rank).toMatchObject({ earnedPoints: 95, earnedBones: 9 })
    expect(ended.maybeRankGain).toEqual(
      Option.some({ pointsBefore: 0, gained: 95, bonesGained: 9 }),
    )
  })

  test('keeping going after a win pays the endless waves only: the revives and awards were paid at Victory', () => {
    const won = update(
      inRoom(clearedFour(midRun()), endedAs(Phase.Victory())),
      Message.TickedRoomFrame({ nowMs: 200 }),
    ).model
    // NOTE: 4 waves and the win on Hard (60 + 150), 3 awards, 1 revive.
    expect(won.rank.earnedPoints).toBe(245)
    // NOTE: the same World goes on into endless, its seats keeping their
    // revives, and the client's own stats start over.
    const going: RoomWorld = {
      ...endedAs(Phase.Victory()),
      tick: 2,
      world: modifyFields(endedAs(Phase.Victory()).world, {
        mode: () => RunMode.Endless(),
        phase: () => WAVE_3_BREAK,
      }),
    }
    const kept = update(
      inRoom(won, going),
      Message.TickedRoomFrame({ nowMs: 300 }),
    ).model
    expect(kept.rankPaid).toMatchObject({ awardsPaid: 3, revivesPaid: 1 })
    const endlessEnd: RoomWorld = {
      ...going,
      tick: 3,
      world: modifyFields(going.world, {
        phase: () => Phase.GameOver({ wave: 13 }),
      }),
    }
    const ended = update(
      inRoom(
        modifyFields(kept, {
          stats: stats => modifyFields(stats, { wavesCleared: () => 2 }),
        }),
        endlessEnd,
      ),
      Message.TickedRoomFrame({ nowMs: 400 }),
    ).model
    // NOTE: 2 endless waves on Hard is 30, and nothing again for the revive
    // and the awards: 245 + 30.
    expect(ended.rank.earnedPoints).toBe(275)
  })

  test('a new run in the room starts from nothing paid', () => {
    const won = update(
      inRoom(clearedFour(midRun()), endedAs(Phase.Victory())),
      Message.TickedRoomFrame({ nowMs: 200 }),
    ).model
    const again: RoomWorld = {
      ...started,
      tick: 5,
      world: startWaveEarly(started.world),
    }
    const fresh = update(
      inRoom(won, again),
      Message.TickedRoomFrame({ nowMs: 500 }),
    ).model
    expect(fresh.rankPaid).toEqual({
      wavesPaid: 0,
      bossesPaid: 0,
      awardsPaid: 0,
      revivesPaid: 0,
    })
  })

  test('leaving mid-run pays the revives made, and no awards', () => {
    const left = update(
      midRun(),
      toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom()),
    ).model
    expect(left.phase._tag).toBe('Ready')
    expect(left.rank).toMatchObject({ earnedPoints: 5, earnedBones: 0 })
  })
})
