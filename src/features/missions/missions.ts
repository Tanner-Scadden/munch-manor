import { Array, Function, Option, Record } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { isBotCrew, isHumanCrew } from '#domain/bots.ts'
import { isEndScreen, isGuided, isInRun, isOnHome } from '#domain/run.ts'
import { playedDifficultyOf } from '#platform/analytics/analyticsRun.ts'
import { drawIndex, shuffle } from '#shared/prng.ts'
import type { DayStamp } from '#shared/records/dayStamp.ts'
import {
  ALL_THREE_BONES,
  CHANDELIER_CRUSH_GOAL,
  MISSION_RULES,
  MISSION_SIZES,
  type MissionId,
  MissionId as MissionIds,
  type MissionReroll,
  type MissionSize,
  type SavedMissions,
  addProgress,
  bonesOfMission,
  claimMission,
  freezeOn,
  knownMissionOf,
  onDay,
  progressOf,
  rerollOn,
  stampDay,
} from '#shared/records/missionData.ts'
import { makeValueHasher } from '#shared/valueHash.ts'
import { dareItemsFoundOf } from '#world/dare/dare.ts'
import { isCallingOwned } from '#world/heroes/calling.ts'
import { levelOf } from '#world/level/arena.ts'
import { CELLAR_ROOM_ID } from '#world/level/plan.ts'
import { focusOf, leadSeatOf } from '#world/party/party.ts'
import { CaseState, GameEvent, Phase } from '#world/schema/worldSchema.ts'

import type { MissionGain, MissionRun } from './missionSchema.ts'

const { hashValue } = makeValueHasher({ cached: false })

const poolOf = (size: MissionSize): ReadonlyArray<MissionId> =>
  Array.filter(MissionIds.literals, id => MISSION_RULES[id].size === size)

const isEligible = (model: Model, id: MissionId): boolean => {
  switch (MISSION_RULES[id].gate) {
    case 'Anyone':
      return true
    case 'PlayedCoop':
      return model.missions.hasPlayedCoop
    case 'OwnsHandyman':
      return isCallingOwned('Handyman', model.boughtCosmetics)
  }
}

const dayOrderOf = (
  day: DayStamp,
  size: MissionSize,
): ReadonlyArray<MissionId> =>
  Array.match(poolOf(size), {
    onEmpty: () => [],
    onNonEmpty: pool => shuffle(hashValue([day, size]), pool)[1],
  })

const rolledFor = (
  model: Model,
  day: DayStamp,
  size: MissionSize,
): Option.Option<MissionId> =>
  Array.findFirst(dayOrderOf(day, size), id => isEligible(model, id))

const maybeRerollOn = (
  saved: SavedMissions,
  day: DayStamp,
): Option.Option<MissionReroll> =>
  saved.day === day ? Option.fromNullishOr(saved.reroll) : Option.none()

const rolledOn = (
  model: Model,
  day: DayStamp,
): ReadonlyArray<Option.Option<MissionId>> => {
  const frozen =
    model.missions.day === day
      ? Array.map(model.missions.rolled, knownMissionOf)
      : []
  return frozen.length === MISSION_SIZES.length
    ? frozen
    : Array.map(MISSION_SIZES, size => rolledFor(model, day, size))
}

export const missionsOn: {
  (day: DayStamp): (model: Model) => ReadonlyArray<MissionId>
  (model: Model, day: DayStamp): ReadonlyArray<MissionId>
} = Function.dual(
  2,
  (model: Model, day: DayStamp): ReadonlyArray<MissionId> => {
    const maybeReroll = maybeRerollOn(model.missions, day)
    return Array.getSomes(
      Array.map(rolledOn(model, day), (rolled, slot) =>
        Option.orElse(
          Option.flatMap(
            Option.filter(maybeReroll, reroll => reroll.slot === slot),
            reroll => knownMissionOf(reroll.mission),
          ),
          () => rolled,
        ),
      ),
    )
  },
)

export const freezeMissionsFrom: {
  (before: Model): (model: Model) => Model
  (model: Model, before: Model): Model
} = Function.dual(2, (model: Model, before: Model): Model =>
  Option.match(model.maybeToday, {
    onNone: () => model,
    onSome: day => {
      const current = onDay(model.missions, day)
      if (
        before.saving.saveStatus === 'Unread' ||
        model.saving.saveStatus === 'Unread' ||
        (model.missions.day !== null && model.missions.day > day) ||
        Array.isReadonlyArrayNonEmpty(current.rolled)
      ) {
        return model
      }
      const rolled = Array.getSomes(rolledOn(before, day))
      return UiStruct.evolve(model, {
        missions: () => freezeOn(current, day, rolled),
      })
    },
  }),
)

export const maybeTodaysMissions = (
  model: Model,
): Option.Option<ReadonlyArray<MissionId>> =>
  Option.map(model.maybeToday, day => missionsOn(model, day))

const todaysRecordOf = (model: Model): SavedMissions =>
  Option.match(model.maybeToday, {
    onNone: () => model.missions,
    onSome: day =>
      model.missions.day !== null && model.missions.day > day
        ? model.missions
        : onDay(model.missions, day),
  })

export const isClaimed: {
  (id: MissionId): (model: Model) => boolean
  (model: Model, id: MissionId): boolean
} = Function.dual(2, (model: Model, id: MissionId): boolean =>
  Array.contains(todaysRecordOf(model).claimed, id),
)

export const isAllThreeDone = (model: Model): boolean =>
  Option.exists(model.maybeToday, day =>
    Array.contains(model.missions.stampedDays, day),
  )

export const isRerollUsed = (model: Model): boolean =>
  Option.isSome(
    Option.flatMap(model.maybeToday, day => maybeRerollOn(model.missions, day)),
  )

export const maybeRerollFor: {
  (slot: number): (model: Model) => Option.Option<MissionReroll>
  (model: Model, slot: number): Option.Option<MissionReroll>
} = Function.dual(
  2,
  (model: Model, slot: number): Option.Option<MissionReroll> =>
    Option.flatMap(model.maybeToday, day => {
      const current = missionsOn(model, day)
      return isRerollUsed(model) ||
        Option.exists(Array.get(current, slot), id => isClaimed(model, id))
        ? Option.none()
        : Option.flatMap(Array.get(MISSION_SIZES, slot), size => {
            const others = Array.filter(
              poolOf(size),
              id => isEligible(model, id) && !Array.contains(current, id),
            )
            const [, index] = drawIndex(
              hashValue([day, slot, model.rngState]),
              others.length,
            )
            return Option.map(Array.get(others, index), mission => ({
              slot,
              mission,
            }))
          })
    }),
)

type FrameTally = Readonly<{
  crushBest: number
  topTier: number
  fridgePulls: number
}>

type Crush = Readonly<{ isCrushing: boolean; count: number }>

const tallyEvents = (
  run: MissionRun,
  events: ReadonlyArray<GameEvent>,
  slot: number,
): FrameTally => {
  let crush: Crush = { isCrushing: false, count: 0 }
  let crushBest = run.crushBest
  let topTier = run.topTier
  let fridgePulls = run.fridgePulls
  for (const event of events) {
    if (GameEvent.isAnyOf(['ChandelierFell'])(event)) {
      crush = { isCrushing: true, count: 0 }
    } else if (crush.isCrushing && GameEvent.isAnyOf(['ZombieKilled'])(event)) {
      crush = { isCrushing: true, count: crush.count + 1 }
      crushBest = Math.max(crushBest, crush.count)
    } else if (!GameEvent.isAnyOf(['ZombieHit'])(event)) {
      crush = { isCrushing: false, count: 0 }
    }
    if (GameEvent.isAnyOf(['GunLeveled'])(event) && event.slot === slot) {
      topTier = Math.max(topTier, event.tier)
    }
    if (GameEvent.isAnyOf(['FridgeOpened'])(event)) {
      fridgePulls += 1
    }
  }
  return { crushBest, topTier, fridgePulls }
}

export const tallyMissionsFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (
    after.frameEvents === before.frameEvents ||
    !Array.isReadonlyArrayNonEmpty(after.frameEvents) ||
    (!isInRun(after.phase) && !isEndScreen(after.phase))
  ) {
    return after
  }
  const tally = tallyEvents(
    after.runGains.missionRun,
    after.frameEvents,
    leadSeatOf(after).slot,
  )
  return tally.crushBest === after.runGains.missionRun.crushBest &&
    tally.topTier === after.runGains.missionRun.topTier &&
    tally.fridgePulls === after.runGains.missionRun.fridgePulls
    ? after
    : UiStruct.evolve(after, {
        runGains: UiStruct.evolve({
          missionRun: run =>
            UiStruct.evolve(run, {
              crushBest: () => tally.crushBest,
              topTier: () => tally.topTier,
              fridgePulls: () => tally.fridgePulls,
            }),
        }),
      })
})

const ownCasesOf = (run: Model): number => {
  const slot = leadSeatOf(run).slot
  return Array.filter(run.cases, ({ state }) =>
    CaseState.match(state, {
      Locked: () => false,
      Opened: ({ by }) => by === slot,
      Emptied: ({ by }) => by === slot,
    }),
  ).length
}

const isCellarOpen = (run: Model): boolean =>
  Array.some(
    levelOf(run).rooms,
    room => room.id === CELLAR_ROOM_ID && room.isOpen,
  )

const toCount = (isDone: boolean): number => (isDone ? 1 : 0)

const MEASURES: Readonly<
  Record<MissionId, (run: Model, tally: MissionRun) => number>
> = {
  HotfootKills: run => focusOf(run).feats.killsOf.Runner,
  PullFridge: (_run, tally) => tally.fridgePulls,
  RunWithBot: run => toCount(isBotCrew(run)),
  PlayHandyman: run => toCount(focusOf(run).player.calling === 'Handyman'),
  ReviveFriend: run => (isHumanCrew(run) ? leadSeatOf(run).revives : 0),
  FindDareThings: run => dareItemsFoundOf(run),
  OpenCellar: run => toCount(isCellarOpen(run)),
  WorkRoomTools: run =>
    Array.reduce(
      Record.values(run.stations),
      0,
      (total, station) => total + station.timesWorked,
    ),
  OpenCase: ownCasesOf,
  ChandelierCrush: (_run, tally) =>
    toCount(tally.crushBest >= CHANDELIER_CRUSH_GOAL),
  BarnBusterKills: run => focusOf(run).feats.killsWith.Shotgun,
  GunToDeluxe: (_run, tally) => toCount(tally.topTier >= 2),
  EscapeDoubleDare: run =>
    toCount(
      Phase.isAnyOf(['Escaped'])(run.phase) &&
        playedDifficultyOf(run) !== 'Easy',
    ),
  SplatZombies: run => focusOf(run).feats.kills,
  LeaveEarly: run => toCount(Phase.isAnyOf(['LeftEarly'])(run.phase)),
}

const measureOf: {
  (id: MissionId): (run: Model) => number
  (run: Model, id: MissionId): number
} = Function.dual(2, (run: Model, id: MissionId): number =>
  MEASURES[id](run, run.runGains.missionRun),
)

type Paid = Readonly<{ saved: SavedMissions; bones: number }>

const claimEach = (
  saved: SavedMissions,
  day: DayStamp,
  ids: ReadonlyArray<MissionId>,
): Paid =>
  Array.reduce(ids, { saved, bones: 0 }, (paid, id) =>
    Option.match(claimMission(paid.saved, day, id), {
      onNone: () => paid,
      onSome: claimed => ({
        saved: claimed,
        bones: paid.bones + bonesOfMission(id),
      }),
    }),
  )

const stampOf = (paid: Paid, day: DayStamp): Paid =>
  Option.match(stampDay(paid.saved, day), {
    onNone: () => paid,
    onSome: stamped => ({
      saved: stamped,
      bones: paid.bones + ALL_THREE_BONES,
    }),
  })

export const payMissions: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  const isEnded = !isEndScreen(before.phase) && isEndScreen(after.phase)
  const isLeft = isInRun(before.phase) && isOnHome(after.phase)
  const run = isEnded ? after : before
  if ((!isEnded && !isLeft) || isGuided(run)) {
    return after
  }
  return Option.match(
    Option.filter(
      after.maybeToday,
      day => after.missions.day === null || after.missions.day <= day,
    ),
    {
      onNone: () => after,
      onSome: day => payOn(run, after, day, isEnded),
    },
  )
})

const payOn = (
  run: Model,
  after: Model,
  day: DayStamp,
  isEnded: boolean,
): Model => {
  const ids = missionsOn(after, day)
  const start = onDay(after.missions, day)
  const measured = Record.fromEntries(
    Array.map(ids, id => [id, measureOf(run, id)] as const),
  )
  const added = Record.map(measured, (count, id) =>
    Math.max(
      0,
      count -
        Option.getOrElse(
          Record.get(run.runGains.missionRun.credited, id),
          () => 0,
        ),
    ),
  )
  const progressed = addProgress(start, day, added)
  const withCoop = isHumanCrew(run)
    ? { ...progressed, hasPlayedCoop: true }
    : progressed
  const paid = stampOf(claimEach(withCoop, day, ids), day)
  const moved = Array.map(
    Array.filter(ids, id => progressOf(paid.saved, id) > progressOf(start, id)),
    id => ({
      mission: id,
      from: progressOf(start, id),
      to: progressOf(paid.saved, id),
      goal: MISSION_RULES[id].goal,
      isDone:
        Array.contains(paid.saved.claimed, id) &&
        !Array.contains(start.claimed, id),
    }),
  )
  const gain: MissionGain = {
    moved,
    bones: paid.bones,
    isAllThree: paid.saved.stampedDays.length > start.stampedDays.length,
  }
  const paidModel = UiStruct.evolve(after, {
    missions: () => paid.saved,
    rank: rank =>
      paid.bones === 0
        ? rank
        : UiStruct.evolve(rank, { earnedBones: earned => earned + paid.bones }),
  })
  return isEnded
    ? UiStruct.evolve(paidModel, {
        runGains: UiStruct.evolve({
          missionRun: missionRun =>
            UiStruct.evolve(missionRun, {
              credited: credited =>
                Record.union(credited, measured, (_, latest) => latest),
            }),
          maybeMissionGain: () =>
            Array.isReadonlyArrayNonEmpty(moved)
              ? Option.some(gain)
              : Option.none(),
        }),
      })
    : paidModel
}

export const rerollMission: {
  (slot: number): (model: Model) => Model
  (model: Model, slot: number): Model
} = Function.dual(2, (model: Model, slot: number): Model =>
  Option.match(Option.all([model.maybeToday, maybeRerollFor(model, slot)]), {
    onNone: () => model,
    onSome: ([day, reroll]) =>
      UiStruct.evolve(model, {
        missions: missions => rerollOn(missions, day, reroll),
      }),
  }),
)

export type MissionRow = Readonly<{
  mission: MissionId
  slot: number
  count: number
  goal: number
  bones: number
  isDone: boolean
  canReroll: boolean
}>

export const missionRowsOf = (model: Model): ReadonlyArray<MissionRow> =>
  Option.match(maybeTodaysMissions(model), {
    onNone: () => [],
    onSome: missions =>
      Array.map(missions, (mission, slot) => {
        const goal = MISSION_RULES[mission].goal
        const isDone = isClaimed(model, mission)
        return {
          mission,
          slot,
          count: isDone
            ? goal
            : Math.min(goal, progressOf(todaysRecordOf(model), mission)),
          goal,
          bones: bonesOfMission(mission),
          isDone,
          canReroll: Option.isSome(maybeRerollFor(model, slot)),
        }
      }),
  })
