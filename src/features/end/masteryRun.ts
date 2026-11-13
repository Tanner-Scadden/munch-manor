import { Array, Function, Option, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import {
  MASTERY_GUNS,
  POINTS_PER_THING,
  POINTS_PER_WAVE,
  unlocksBetween,
} from '../../domain/mastery'
import { isEndScreen, isGuided, isInRun, isOnHome } from '../../domain/run'
import { type SavedMastery, addToMastery } from '../../shared/masteryData'
import { dareItemsFoundOf } from '../../world/dare/dare'
import { focusOf } from '../../world/party/party'

// Reading a run into hero and gun mastery (src/domain/mastery.ts has the
// numbers). A run pays its mastery at the same moments it pays its rank
// (earnRank in ./rankRun.ts): when it ends, and when the player leaves it
// for the menu. A guided run pays nothing, as it pays no rank.

const paidCount = (counts: Readonly<Record<string, number>>, key: string) =>
  Option.getOrElse(Record.get(counts, key), () => 0)

// NOTE: what the run has earned past what it was paid already: points
// for its hero (the player's own seat's, in co-op too) from the waves it
// cleared and the dare things it found, and each gun's kills from the
// seat's own tally.
const earnedOf = (run: Model): SavedMastery => {
  const seat = focusOf(run)
  const waves = Math.max(0, run.stats.wavesCleared - run.masteryRun.wavesPaid)
  const things = Math.max(0, dareItemsFoundOf(run) - run.masteryRun.thingsPaid)
  const points = waves * POINTS_PER_WAVE + things * POINTS_PER_THING
  const guns = Record.filter(
    Record.fromEntries(
      Array.map(MASTERY_GUNS, (kind): readonly [string, number] => [
        kind,
        seat.feats.killsWith[kind] - paidCount(run.masteryRun.killsPaid, kind),
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

// NOTE: pays the run into the saved mastery, remembers what it paid, and,
// at the end screen, keeps what the payout opened for the end card's
// flips. Runs before earnRank in the after-message Steps, which both read
// the same moment.
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
  return modifyFields(after, {
    mastery: () => mastery,
    masteryRun: () => ({
      wavesPaid: run.stats.wavesCleared,
      thingsPaid: dareItemsFoundOf(run),
      killsPaid: killsPaidBy(run),
      unlocks: isEnded ? unlocksBetween(after.mastery, mastery) : [],
    }),
  })
})
