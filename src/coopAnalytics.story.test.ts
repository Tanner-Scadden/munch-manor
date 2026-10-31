import { Array, Option, Result, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { RunSummary } from './analytics'
import { CoopBinding } from './bindings'
import { Message as CoopMessage } from './coop/message'
import { Screen } from './coop/model'
import { freshRoom, maybeRoomOf } from './coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import { update } from './main'
import { Message } from './message'
import { Lesson, type Model, initialModel } from './model'
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

const inRoom = (model: Model, world: RoomWorld): Model =>
  modifyFields(model, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: Option.match(maybeRoomOf(coop), {
              onNone: () => ({
                ...freshRoom(CODE, OWN_SLOT),
                maybePlayerId: Option.some(`player-${OWN_SLOT}`),
                maybeLobby: Option.some(
                  lobbyOf(
                    [memberOf(0, 'Ana'), memberOf(1, 'Bo'), memberOf(2, 'Cy')],
                    'Playing',
                  ),
                ),
                link: 'Online' as const,
                session: playingSession(world, OWN_SLOT),
              }),
              onSome: room => ({
                ...room,
                session: playingSession(world, OWN_SLOT),
              }),
            }),
          }),
      }),
  })

// NOTE: the run under way, drawn from the room once.
const midRun = (model: Model = player): Model =>
  update(inRoom(model, fighting), Message.TickedRoomFrame({ nowMs: 100 })).model

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
      version: 2,
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
})
