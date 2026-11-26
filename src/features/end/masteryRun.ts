import { Array, Function, Option, Record } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  MASTERY_GUNS,
  POINTS_PER_THING,
  POINTS_PER_WAVE,
  unlocksBetween,
} from '#domain/mastery.ts'
import { isEndScreen, isGuided, isInRun, isOnHome } from '#domain/run.ts'
import { type SavedMastery, addToMastery } from '#shared/masteryData.ts'
import { dareItemsFoundOf } from '#world/dare/dare.ts'
import { focusOf } from '#world/party/party.ts'

const paidCount = (counts: Readonly<Record<string, number>>, key: string) =>
  Option.getOrElse(Record.get(counts, key), () => 0)

const earnedOf = (run: Model): SavedMastery => {
  const seat = focusOf(run)
  const waves = Math.max(
    0,
    run.stats.wavesCleared - run.runGains.masteryRun.wavesPaid,
  )
  const things = Math.max(
    0,
    dareItemsFoundOf(run) - run.runGains.masteryRun.thingsPaid,
  )
  const points = waves * POINTS_PER_WAVE + things * POINTS_PER_THING
  const guns = Record.filter(
    Record.fromEntries(
      Array.map(MASTERY_GUNS, (kind): readonly [string, number] => [
        kind,
        seat.feats.killsWith[kind] -
          paidCount(run.runGains.masteryRun.killsPaid, kind),
      ]),
    ),
    kills => kills > 0,
  )
  return {
    heroes: points > 0 ? { [seat.player.calling]: points } : {},
    guns,
  }
}

const killsPaidBy = (run: Model): Readonly<Record<string, number>> => {
  const { killsWith } = focusOf(run).feats
  return Record.fromEntries(
    Array.map(MASTERY_GUNS, (kind): readonly [string, number] => [
      kind,
      killsWith[kind],
    ]),
  )
}

export const earnMastery: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  const isEnded = !isEndScreen(before.phase) && isEndScreen(after.phase)
  const isLeft = isInRun(before.phase) && isOnHome(after.phase)
  if ((!isEnded && !isLeft) || isGuided(isEnded ? after : before)) {
    return after
  }
  const run = isEnded ? after : before
  const mastery = addToMastery(after.mastery, earnedOf(run))
  return UiStruct.evolve(after, {
    mastery: () => mastery,
    runGains: UiStruct.evolve({
      masteryRun: () => ({
        wavesPaid: run.stats.wavesCleared,
        thingsPaid: dareItemsFoundOf(run),
        killsPaid: killsPaidBy(run),
        unlocks: isEnded ? unlocksBetween(after.mastery, mastery) : [],
      }),
    }),
  })
})
