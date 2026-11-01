import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, RunMode, initialModel } from './model'
import { lastHeart, readyAfterRead } from './model.fixture'
import { noRank } from './rank'
import { WriteSave } from './update/save'
import { noKills } from './worldSchema'

// Rank and Bones (src/rank.ts, src/rankRun.ts): a run pays its points and
// Bones into the saved rank when it ends or is left, and sets what the end
// card's strip shows. The numbers are the design's: a Normal run that dies
// on wave 7 pays 60 points and 6 Bones, a Normal win 250 and 25.

const tickOnce = (model: Model): Model =>
  update(model, Message.TickedFrame({ deltaTime: FIXED_STEP_MS })).model

// NOTE: a run in `phase` that has cleared `wavesCleared` waves, on Normal.
const runAt = (phase: Phase, wavesCleared: number, bosses = 0): Model =>
  modifyFields(readyAfterRead, {
    phase: () => phase,
    mode: () => RunMode.Campaign(),
    stats: stats =>
      modifyFields(stats, {
        wavesCleared: () => wavesCleared,
        kills: () => ({ ...noKills, Boss: bosses }),
      }),
  })

const wave = (number: number): Phase =>
  Phase.Wave({ wave: number, elapsedMs: 4000, spawns: [] })

const diesOnWave7 = lastHeart(runAt(wave(7), 6))

// NOTE: the last wave of the campaign with nothing left to kill: the next
// tick clears it and wins.
const lastWave = runAt(wave(10), 9, 1)

const changesOf = (result: ReturnType<typeof update>) =>
  Array.flatMap(result.commands ?? [], command =>
    command.name === WriteSave.name &&
    command.args !== undefined &&
    'changes' in command.args &&
    Array.isArray(command.args['changes'])
      ? command.args['changes']
      : [],
  )

// NOTE: the end card's beat is over, so its buttons work.
const afterBeat = (model: Model): Model =>
  modifyFields(model, { screenMs: () => 60_000 })

const keepGoing = (won: Model): Model =>
  update(afterBeat(won), Message.ClickedKeepGoingButton()).model

const leave = (model: Model): Model => {
  const paused = update(model, Message.ClickedPauseButton()).model
  const asked = update(paused, Message.ClickedMenuButton()).model
  return update(asked, Message.ClickedLeaveRunButton()).model
}

describe('a death', () => {
  test('pays 10 points a wave cleared, and a Bone for each 10', () => {
    const ended = tickOnce(diesOnWave7)
    expect(ended.phase._tag).toBe('GameOver')
    expect(ended.rank).toMatchObject({ earnedPoints: 60, earnedBones: 6 })
    expect(ended.maybeRankGain).toEqual(
      Option.some({ pointsBefore: 0, gained: 60, bonesGained: 6 }),
    )
  })

  test('grows the save, as an increment', () => {
    const before = modifyFields(diesOnWave7, {
      rank: rank => ({ ...rank, earnedPoints: 90, earnedBones: 9 }),
    })
    const result = update(
      before,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    )
    expect(result.model.rank.earnedPoints).toBe(150)
    expect(changesOf(result)).toContainEqual({
      _tag: 'EarnedRank',
      points: 60,
      bones: 6,
    })
    expect(result.model.maybeRankGain).toEqual(
      Option.some({ pointsBefore: 90, gained: 60, bonesGained: 6 }),
    )
  })

  test('counts the points the veteran grant gave before the run', () => {
    const veteran = modifyFields(diesOnWave7, {
      rank: rank => ({ ...rank, veteranPoints: 400, veteranBones: 40 }),
    })
    expect(tickOnce(veteran).maybeRankGain).toEqual(
      Option.some({ pointsBefore: 400, gained: 60, bonesGained: 6 }),
    )
  })

  test('is multiplied by the difficulty and rounded down', () => {
    const on = (chosen: 'Easy' | 'Hard'): Model =>
      modifyFields(diesOnWave7, {
        difficulty: setting => modifyFields(setting, { chosen: () => chosen }),
      })
    expect(tickOnce(on('Hard')).rank.earnedPoints).toBe(90)
    expect(tickOnce(on('Easy')).rank.earnedPoints).toBe(45)
  })

  test('pays once: the end card ticking on pays nothing more', () => {
    const later = Array.reduce(
      Array.makeBy(30, () => 0),
      tickOnce(diesOnWave7),
      model => tickOnce(model),
    )
    expect(later.rank.earnedPoints).toBe(60)
  })
})

describe('a win', () => {
  test('pays the waves, the boss, and the campaign win', () => {
    const won = tickOnce(lastWave)
    expect(won.phase._tag).toBe('Victory')
    expect(won.rank).toMatchObject({ earnedPoints: 250, earnedBones: 25 })
    expect(won.maybeRankGain).toEqual(
      Option.some({ pointsBefore: 0, gained: 250, bonesGained: 25 }),
    )
  })

  test('keeping going pays only the endless waves it clears after', () => {
    const going = keepGoing(tickOnce(lastWave))
    expect(going.mode._tag).toBe('Endless')
    expect(going.rank.earnedPoints).toBe(250)
    // NOTE: two more waves cleared in endless, then the last heart goes.
    const diesInEndless = lastHeart(
      modifyFields(going, {
        phase: () => wave(13),
        stats: stats =>
          modifyFields(stats, { wavesCleared: count => count + 2 }),
      }),
    )
    const ended = tickOnce(diesInEndless)
    expect(ended.phase._tag).toBe('GameOver')
    expect(ended.rank.earnedPoints).toBe(270)
    expect(ended.maybeRankGain).toEqual(
      Option.some({ pointsBefore: 250, gained: 20, bonesGained: 2 }),
    )
  })

  test('keeping going and leaving at once pays nothing more', () => {
    const going = keepGoing(tickOnce(lastWave))
    const home = leave(going)
    expect(home.phase._tag).toBe('Ready')
    expect(home.rank.earnedPoints).toBe(250)
  })
})

describe('leaving a run', () => {
  test('pays the waves cleared so far like a death, once', () => {
    const left = leave(runAt(wave(4), 3))
    expect(left.phase._tag).toBe('Ready')
    expect(left.rank).toMatchObject({ earnedPoints: 30, earnedBones: 3 })
    expect(Option.isNone(left.maybeRankGain)).toBe(true)
    expect(
      update(left, Message.ClickedMenuButton()).model.rank.earnedPoints,
    ).toBe(30)
  })

  test('a run left from the end card pays nothing more', () => {
    const home = update(
      afterBeat(tickOnce(diesOnWave7)),
      Message.ClickedMenuButton(),
    ).model
    expect(home.phase._tag).toBe('Ready')
    expect(home.rank.earnedPoints).toBe(60)
  })

  test('the practice gate pays nothing', () => {
    // NOTE: a guided run cannot have cleared waves, so the stats are forced
    // to show that the gate itself pays nothing.
    const guided = modifyFields(initialModel, {
      stats: stats => modifyFields(stats, { wavesCleared: () => 3 }),
      phase: () =>
        Phase.Preparation({
          wave: 1,
          remainingMs: 9000,
          durationMs: PREPARATION_MS,
          spawns: [],
        }),
    })
    expect(leave(guided).rank).toEqual(noRank)
  })
})
