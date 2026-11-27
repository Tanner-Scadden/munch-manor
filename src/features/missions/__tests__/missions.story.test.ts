import { Array, Effect, Option, Record, String } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import {
  checkSavedChanges,
  diesOnWave7,
  ended,
  frame,
  leave,
  runAt,
  wave,
} from '#features/end/__tests__/rank.fixture.ts'
import { MissionMessage } from '#features/missions/message.ts'
import {
  isClaimed,
  isRerollUsed,
  maybeRerollFor,
  missionRowsOf,
  missionsOn,
} from '#features/missions/missions.ts'
import {
  ALL_THREE_BONES,
  MISSION_RULES,
  type MissionId,
  type SavedMissions,
  noMissions,
} from '#shared/records/missionData.ts'
import { knowingDay, readyAfterRead } from '#test/model.fixture.ts'
import {
  changeModel,
  checkModel,
  send,
  storyOf,
  writeSave,
} from '#test/testing.ts'
import { modifyFocus } from '#world/party/party.ts'

const TODAY = '2026-11-12'

const withMissions = (model: Model, missions: SavedMissions): Model =>
  UiStruct.evolve(model, { missions: () => missions })

const DAYS = Array.flatMap(['2026-12', '2027-01'], month =>
  Array.makeBy(
    28,
    index => `${month}-${String.padStart(2, '0')(`${index + 1}`)}`,
  ),
)

describe('rolling the day', () => {
  it('every player gets the same three, a Small, a Medium, and a Large', () => {
    const one = missionsOn(readyAfterRead, TODAY)
    const other = missionsOn(
      UiStruct.evolve(readyAfterRead, { rngState: () => 987654321 }),
      TODAY,
    )
    expect(one).toEqual(other)
    expect(Array.map(one, id => MISSION_RULES[id].size)).toEqual([
      'Small',
      'Medium',
      'Large',
    ])
  })

  it('a new day rolls new ones', () => {
    const rolls = Array.map(DAYS, day =>
      Array.join(missionsOn(readyAfterRead, day), ','),
    )
    expect(Array.dedupe(rolls).length).toBeGreaterThan(5)
  })

  it('a co-op mission waits for a player who has played co-op', () => {
    const isRevive = (model: Model) =>
      Array.some(DAYS, day =>
        Array.contains(missionsOn(model, day), 'ReviveFriend'),
      )
    expect(isRevive(readyAfterRead)).toBe(false)
    expect(
      isRevive(
        withMissions(readyAfterRead, { ...noMissions, hasPlayedCoop: true }),
      ),
    ).toBe(true)
  })

  it.effect("a gate passed later that day leaves the day's three be", () => {
    const asCoop = (model: Model): Model =>
      UiStruct.evolve(model, {
        missions: missions => ({ ...missions, hasPlayedCoop: true }),
      })
    const day = Option.getOrThrow(
      Array.findFirst(DAYS, candidate =>
        Array.contains(
          missionsOn(asCoop(readyAfterRead), candidate),
          'ReviveFriend',
        ),
      ),
    )
    const before = missionsOn(readyAfterRead, day)
    return Effect.gen(function* () {
      const s = yield* storyOf(readyAfterRead)
      s.pipe(
        send(Message.ChangedToday({ day })),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'RolledMissions',
            day,
            rolled: before,
          })
        }),
        writeSave,
        changeModel(asCoop),
        send(Message.ChangedToday({ day })),
        checkModel(model => {
          expect(missionsOn(model, day)).toEqual(before)
          expect(model.missions.rolled).toEqual(before)
        }),
      )
    })
  })

  it.effect('the home card shows the three once the day is known', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyAfterRead)
      s.pipe(
        checkModel(model => {
          expect(missionRowsOf(model)).toEqual([])
        }),
        send(Message.ChangedToday({ day: TODAY })),
        checkModel(model => {
          expect(
            Array.map(missionRowsOf(model), ({ mission }) => mission),
          ).toEqual(missionsOn(model, TODAY))
        }),
        writeSave,
      )
    }),
  )
})

describe("the day's reroll", () => {
  const openPanel = send(MissionMessage.ClickedMissionsButton())

  it.effect('the dice swaps one mission for another of its size, once', () => {
    const start = knowingDay(readyAfterRead, TODAY)
    const [first, second] = missionsOn(start, TODAY)
    const reroll = Option.getOrThrow(maybeRerollFor(start, 0))
    return Effect.gen(function* () {
      const s = yield* storyOf(start)
      s.pipe(
        openPanel,
        send(MissionMessage.ClickedRerollButton({ slot: 0 })),
        checkModel(model => {
          const [rerolled, kept] = missionsOn(model, TODAY)
          expect(rerolled).not.toBe(first)
          expect(rerolled).toBe(reroll.mission)
          expect(
            Option.map(
              Option.fromNullishOr(rerolled),
              id => MISSION_RULES[id].size,
            ),
          ).toEqual(Option.some('Small'))
          expect(kept).toBe(second)
          expect(isRerollUsed(model)).toBe(true)
          expect(maybeRerollFor(model, 1)).toEqual(Option.none())
        }),
        send(MissionMessage.ClickedRerollButton({ slot: 1 })),
        checkModel(model => {
          expect(missionsOn(model, TODAY)[1]).toBe(second)
        }),
        checkSavedChanges(changes => {
          expect(changes).toContainEqual({
            _tag: 'RerolledMission',
            day: TODAY,
            reroll,
          })
        }),
        writeSave,
      )
    })
  })

  it.effect('is the same on every device for the same save', () =>
    Effect.sync(() => {
      const start = knowingDay(readyAfterRead, TODAY)
      expect(maybeRerollFor(start, 2)).toEqual(maybeRerollFor(start, 2))
      expect(Option.isSome(maybeRerollFor(start, 2))).toBe(true)
    }),
  )

  it.effect('does nothing with the panel shut', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(knowingDay(readyAfterRead, TODAY))
      s.pipe(
        send(MissionMessage.ClickedRerollButton({ slot: 0 })),
        checkModel(model => {
          expect(isRerollUsed(model)).toBe(false)
        }),
      )
    }),
  )
})

const splatDay = (model: Model, others: ReadonlyArray<MissionId>): Model =>
  withMissions(knowingDay(model, TODAY), {
    ...noMissions,
    day: TODAY,
    rolled: knowingDay(model, TODAY).missions.rolled,
    reroll: { slot: 2, mission: 'SplatZombies' },
    progress: Record.fromEntries(
      Array.map(others, id => [id, MISSION_RULES[id].goal] as const),
    ),
    claimed: [...others],
  })

const withKills = (model: Model, kills: number): Model =>
  modifyFocus(model, {
    feats: feats => UiStruct.evolve(feats, { kills: () => kills }),
  })

const othersOn = (model: Model): ReadonlyArray<MissionId> =>
  Array.take(missionsOn(knowingDay(model, TODAY), TODAY), 2)

describe('a run pays the missions', () => {
  it.effect('its count goes toward the mission, short of the goal', () =>
    Effect.gen(function* () {
      const start = withKills(splatDay(diesOnWave7, othersOn(diesOnWave7)), 40)
      const after = yield* ended(start)
      expect(after.missions.progress['SplatZombies']).toBe(40)
      expect(isClaimed(after, 'SplatZombies')).toBe(false)
      expect(after.rank.earnedBones).toBe(start.rank.earnedBones + 6 * 2)
      expect(after.runGains.maybeMissionGain).toEqual(
        Option.some({
          moved: [
            {
              mission: 'SplatZombies',
              from: 0,
              to: 40,
              goal: 150,
              isDone: false,
            },
          ],
          bones: 0,
          isAllThree: false,
        }),
      )
    }),
  )

  it.effect(
    'one that meets its goal pays its Bones, and the three pay the bonus',
    () => {
      const start = withKills(splatDay(diesOnWave7, othersOn(diesOnWave7)), 160)
      return Effect.gen(function* () {
        const s = yield* storyOf(start)
        s.pipe(
          frame,
          checkModel(after => {
            expect(after.missions.progress['SplatZombies']).toBe(150)
            expect(isClaimed(after, 'SplatZombies')).toBe(true)
            expect(after.missions.stampedDays).toEqual([TODAY])
            expect(after.rank.earnedBones).toBe(
              start.rank.earnedBones + 12 + 20 + ALL_THREE_BONES,
            )
            expect(
              Option.map(
                after.runGains.maybeMissionGain,
                ({ bones, isAllThree }) => ({
                  bones,
                  isAllThree,
                }),
              ),
            ).toEqual(Option.some({ bones: 45, isAllThree: true }))
          }),
          checkSavedChanges(changes => {
            expect(changes).toContainEqual({
              _tag: 'ProgressedMissions',
              day: TODAY,
              progress: { SplatZombies: 150 },
              coop: false,
            })
            expect(changes).toContainEqual({
              _tag: 'ClaimedMission',
              day: TODAY,
              mission: 'SplatZombies',
            })
            expect(changes).toContainEqual({
              _tag: 'StampedMissionDay',
              day: TODAY,
            })
          }),
          writeSave,
        )
      })
    },
  )

  it.effect('a run left for home pays what it counted too', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withKills(splatDay(runAt(wave(2), 1, 0), othersOn(readyAfterRead)), 30),
      )
      s.pipe(
        leave,
        checkModel(left => {
          expect(left.missions.progress['SplatZombies']).toBe(30)
          expect(left.runGains.maybeMissionGain).toEqual(Option.none())
        }),
        writeSave,
      )
    }),
  )

  it.effect('a day not known yet pays nothing', () =>
    Effect.gen(function* () {
      const after = yield* ended(withKills(diesOnWave7, 160))
      expect(after.missions).toEqual(noMissions)
      expect(after.runGains.maybeMissionGain).toEqual(Option.none())
    }),
  )
})
