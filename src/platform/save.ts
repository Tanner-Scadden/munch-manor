import {
  Array,
  Effect,
  Function,
  Option,
  Record,
  Result,
  Schema,
  pipe,
} from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../app/model'
import { savedDifficultyOf } from '../domain/beatMyRun'
import {
  CaseCard,
  DifficultyCard,
  type PlayerBests,
  QuestTour,
  RattlesIntro,
  Tour,
  freshLessons,
} from '../domain/clientSchema'
import { lookInOwned } from '../domain/closet'
import { CardEvent, stepDifficultyCard } from '../domain/difficultyCard'
import { cleanName } from '../domain/playerName'
import { unlocksAt } from '../domain/unlocks'
import { mergeDareMarks } from '../shared/dareMarkData'
import { mergeJournal } from '../shared/journalData'
import { mergeMastery } from '../shared/masteryData'
import { mergeMissions } from '../shared/missionData'
import {
  PlayerSave,
  SAVE_VERSION,
  SEEN_BASELINE,
  type SavedBestRun,
  type SavedBests,
  type SavedBonuses,
  type SavedDifficultyBests,
  type SavedLesson,
  type SavedLessons,
  type SavedRunRecord,
  type SavedRunRecords,
  type SavedTrapHint,
} from '../shared/playerData'
import { mergeProof } from '../shared/proofData'
import { DareKind } from '../world/dare/dareSchema'
import { callingForRun } from '../world/heroes/calling'
import { playerOfCalling } from '../world/heroes/callingPlayer'
import { rankOf, totalPointsOf } from '../world/heroes/rank'
import { modifyFocus } from '../world/party/party'
import { PickupKind, ZombieKind } from '../world/schema/entitySchema'
import {
  type BestRun,
  DebutCard,
  type DifficultyBests,
  type KillCounts,
  Lesson,
  type Lessons,
  TrapHint,
  noPractice,
} from '../world/schema/worldSchema'
import { decodeSave, encodeSave } from './saveVersions'

export {
  decodeSave,
  encodeSave,
  unpickedDifficulty,
  unvisitedHome,
} from './saveVersions'

export {
  PlayerSave,
  SAVE_VERSION,
  SavedBests,
  SavedLesson,
  SavedRunRecords,
  SavedTrapHint,
  noSavedBests,
} from '../shared/playerData'

export const SAVE_KEY = 'munch-manor:save'

const saveEquivalence = Schema.toEquivalence(PlayerSave)

export const isSameSave: {
  (that: PlayerSave): (self: PlayerSave) => boolean
  (self: PlayerSave, that: PlayerSave): boolean
} = Function.dual(2, (self: PlayerSave, that: PlayerSave): boolean =>
  saveEquivalence(self, that),
)

const savedLesson = (lesson: Lesson): SavedLesson =>
  Lesson.isAnyOf(['Learned'])(lesson) ? 'Learned' : 'Pending'

const savedTrapHint = (hint: TrapHint): SavedTrapHint =>
  TrapHint.isAnyOf(['Seen'])(hint) ? 'Seen' : 'Unseen'

const savedDifficultyBests = (
  bests: DifficultyBests,
): SavedDifficultyBests => ({
  fastestWinMs: Option.getOrNull(bests.maybeFastestWinMs),
  bestEndlessWave: Option.getOrNull(bests.maybeBestEndlessWave),
})

const savedRunRecord = (bests: DifficultyBests): SavedRunRecord => ({
  furthestWave: Option.getOrNull(bests.maybeFurthestWave),
  mostKills: Option.getOrNull(bests.maybeMostKills),
  bestRun: Option.getOrNull(bests.maybeBestRun),
})

const savedRunRecords = (bests: PlayerBests): SavedRunRecords => ({
  Easy: savedRunRecord(bests.byDifficulty.Easy),
  Normal: savedRunRecord(bests.byDifficulty.Normal),
  Hard: savedRunRecord(bests.byDifficulty.Hard),
  Nightmare: savedRunRecord(bests.byDifficulty.Nightmare),
})

const savedBests = (bests: PlayerBests): SavedBests => ({
  runsPlayed: bests.runsPlayed,
  totalKills: bests.totalKills,
  killsByKind: Record.filter(bests.killsByKind, count => count > 0),
  byDifficulty: {
    Easy: savedDifficultyBests(bests.byDifficulty.Easy),
    Normal: savedDifficultyBests(bests.byDifficulty.Normal),
    Hard: savedDifficultyBests(bests.byDifficulty.Hard),
    Nightmare: savedDifficultyBests(bests.byDifficulty.Nightmare),
  },
})

export const SAVED_FIELDS = [
  'lessons',
  'trapHint',
  'introSeen',
  'introducedKinds',
  'homeScreenTip',
  'settings',
  'appearance',
  'difficulty',
  'difficultyCard',
  'bests',
  'home',
  'seenPowerUps',
  'playerName',
  'rank',
  'bonuses',
  'lastRunEnding',
  'missions',
  'proof',
  'journal',
  'mastery',
  'dareMarks',
  'calling',
  'boughtCosmetics',
  'seenUnlocks',
  'recordUnlock',
] as const satisfies ReadonlyArray<keyof Model>

export const hasSaveFieldsChanged: {
  (after: Model): (before: Model) => boolean
  (before: Model, after: Model): boolean
} = Function.dual(2, (before: Model, after: Model): boolean =>
  Array.some(SAVED_FIELDS, field => before[field] !== after[field]),
)

export const saveOf = (model: Model): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: savedLesson(model.lessons.move),
      fire: savedLesson(model.lessons.fire),
      startWave: savedLesson(model.lessons.startWave),
      swap: savedLesson(model.lessons.swap),
      pickup: savedLesson(model.lessons.pickup),
      timedBreaks: savedLesson(model.lessons.timedBreaks),
      openBreak: savedLesson(model.lessons.openBreak),
      dareTour: savedLesson(model.lessons.dareTour),
      dareKey: savedLesson(model.lessons.dareKey),
      rattles: savedLesson(model.lessons.rattles),
      displayCase: savedLesson(model.lessons.displayCase),
      dareCard: savedLesson(model.lessons.dareCard),
      gunLevel: savedLesson(model.lessons.gunLevel),
    },
    trapHint: savedTrapHint(model.trapHint),
    introducedKinds: model.introducedKinds,
    intro: model.introSeen,
  },
  homeScreenTip: model.homeScreenTip,
  settings: {
    sound: model.settings.soundSetting,
    music: model.settings.musicSetting,
    shake: model.settings.shakeSetting,
    shareStats: model.settings.shareStats,
    cursor: model.settings.cursorSetting,
  },
  appearance: model.appearance,
  difficulty: {
    chosen: savedDifficultyOf(model),
    card: DifficultyCard.$is('Seen')(model.difficultyCard) ? 'Seen' : 'Unseen',
    nightmare: model.difficulty.nightmare === 'Locked' ? 'Locked' : 'Unlocked',
  },
  bests: savedBests(model.bests),
  home: {
    seenNewsDay: Option.getOrNull(model.home.maybeSeenNewsDay),
    openedEntries: model.home.openedEntries,
    ...(model.home.isTurnHintSeen ? { turnHintSeen: true } : {}),
  },
  seenPowerUps: model.seenPowerUps,
  rotation: model.settings.rotationSetting,
  rumble: model.settings.rumbleSetting,
  name: model.playerName,
  records: savedRunRecords(model.bests),
  rank: model.rank,
  bonuses: model.bonuses,
  lastRun: model.lastRunEnding,
  missions: model.missions,
  proof: model.proof,
  journal: model.journal,
  mastery: model.mastery,
  dareMarks: model.dareMarks,
  calling: model.calling,
  boughtCosmetics: model.boughtCosmetics,
  seenUnlocks: model.seenUnlocks,
  recordRuns: model.settings.recordRuns,
  recordUnlock: model.recordUnlock,
})

const restoreLesson =
  (saved: SavedLesson) =>
  (lesson: Lesson): Lesson =>
    saved === 'Learned' ? Lesson.Learned({ atMs: 0 }) : lesson

const restoreLessons = (lessons: Lessons, saved: SavedLessons): Lessons =>
  UiStruct.evolve(lessons, {
    move: restoreLesson(saved.move),
    fire: restoreLesson(saved.fire),
    startWave: restoreLesson(saved.startWave),
    swap: restoreLesson(saved.swap),
    pickup: restoreLesson(saved.pickup),
    timedBreaks: restoreLesson(saved.timedBreaks),
    openBreak: restoreLesson(saved.openBreak),
    dareTour: restoreLesson(saved.dareTour),
    dareKey: restoreLesson(saved.dareKey),
    rattles: restoreLesson(saved.rattles),
    displayCase: restoreLesson(saved.displayCase),
    dareCard: restoreLesson(saved.dareCard),
    gunLevel: restoreLesson(saved.gunLevel),
  })

const isZombieKind = Schema.is(ZombieKind)

const knownKinds = (kinds: ReadonlyArray<string>): ReadonlyArray<ZombieKind> =>
  Array.filterMap(kinds, kind =>
    isZombieKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const isPickupKind = Schema.is(PickupKind)

const knownPowerUps = (
  kinds: ReadonlyArray<string>,
): ReadonlyArray<PickupKind> =>
  Array.filterMap(kinds, kind =>
    isPickupKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const isDareKind = Schema.is(DareKind)

const restoreBestRun = (saved: SavedBestRun): BestRun => ({
  wave: saved.wave,
  things: Array.filterMap(saved.things, thing =>
    isDareKind(thing) ? Result.succeed(thing) : Result.failVoid,
  ),
})

const restoreDifficultyBests = (
  saved: SavedDifficultyBests,
  record: SavedRunRecord,
): DifficultyBests => ({
  maybeFastestWinMs: Option.fromNullishOr(saved.fastestWinMs),
  maybeBestEndlessWave: Option.fromNullishOr(saved.bestEndlessWave),
  maybeFurthestWave: Option.fromNullishOr(record.furthestWave),
  maybeMostKills: Option.fromNullishOr(record.mostKills),
  maybeBestRun: Option.map(
    Option.fromNullishOr(record.bestRun),
    restoreBestRun,
  ),
})

const savedKillsOf =
  (killsByKind: Readonly<Record<string, number>>) =>
  (kind: ZombieKind): number =>
    Option.getOrElse(Record.get(killsByKind, kind), () => 0)

const restoreKills = (
  killsByKind: Readonly<Record<string, number>>,
): KillCounts => {
  const killsOf = savedKillsOf(killsByKind)
  return {
    Shambler: killsOf('Shambler'),
    Runner: killsOf('Runner'),
    Tank: killsOf('Tank'),
    Exploder: killsOf('Exploder'),
    Thrower: killsOf('Thrower'),
    Crawler: killsOf('Crawler'),
    Boss: killsOf('Boss'),
  }
}

const restoreBests = (
  saved: SavedBests,
  records: SavedRunRecords,
): PlayerBests => ({
  runsPlayed: saved.runsPlayed,
  totalKills: saved.totalKills,
  killsByKind: restoreKills(saved.killsByKind),
  byDifficulty: {
    Easy: restoreDifficultyBests(saved.byDifficulty.Easy, records.Easy),
    Normal: restoreDifficultyBests(saved.byDifficulty.Normal, records.Normal),
    Hard: restoreDifficultyBests(saved.byDifficulty.Hard, records.Hard),
    Nightmare: restoreDifficultyBests(
      saved.byDifficulty.Nightmare,
      records.Nightmare,
    ),
  },
})

const mergeBonuses = (
  kept: SavedBonuses,
  saved: SavedBonuses,
): SavedBonuses => ({
  doubledDay:
    kept.doubledDay === null ||
    (saved.doubledDay !== null && saved.doubledDay > kept.doubledDay)
      ? saved.doubledDay
      : kept.doubledDay,
  escapedOn: Array.union(kept.escapedOn, saved.escapedOn),
  purses: saved.purses,
})

export const restoreSave: {
  (save: PlayerSave): (model: Model) => Model
  (model: Model, save: PlayerSave): Model
} = Function.dual(2, (model: Model, save: PlayerSave): Model =>
  modifyFocus(
    UiStruct.evolve(model, {
      lessons: lessons => restoreLessons(lessons, save.onboarding.lessons),
      trapHint: hint =>
        save.onboarding.trapHint === 'Seen' ? TrapHint.Seen() : hint,
      introSeen: seen => (save.onboarding.intro === 'Seen' ? 'Seen' : seen),
      introducedKinds: kinds =>
        Array.union(kinds, knownKinds(save.onboarding.introducedKinds)),
      homeScreenTip: tip =>
        save.homeScreenTip === 'Dismissed' ? 'Dismissed' : tip,
      settings: UiStruct.evolve({
        soundSetting: () => save.settings.sound,
        musicSetting: () => save.settings.music,
        shakeSetting: () => save.settings.shake,
        shareStats: () => save.settings.shareStats,
        cursorSetting: () => save.settings.cursor,
        rotationSetting: () => save.rotation,
        rumbleSetting: () => save.rumble,
        recordRuns: () => save.recordRuns,
      }),
      appearance: () =>
        lookInOwned(
          save.appearance,
          save.boughtCosmetics,
          rankOf(totalPointsOf(save.rank)),
        ),
      difficulty: setting =>
        UiStruct.evolve(setting, {
          chosen: () => save.difficulty.chosen,
          nightmare: nightmare =>
            save.difficulty.nightmare === 'Unlocked' && nightmare === 'Locked'
              ? 'Unlocked'
              : nightmare,
        }),
      difficultyCard: card =>
        save.difficulty.card === 'Seen'
          ? stepDifficultyCard(card, CardEvent.Remembered)
          : card,
      bests: () => restoreBests(save.bests, save.records),
      home: home =>
        UiStruct.evolve(home, {
          maybeSeenNewsDay: () => Option.fromNullishOr(save.home.seenNewsDay),
          openedEntries: opened =>
            Array.union(opened, knownKinds(save.home.openedEntries)),
          isTurnHintSeen: isSeen => isSeen || save.home.turnHintSeen === true,
        }),
      seenPowerUps: seen => Array.union(seen, knownPowerUps(save.seenPowerUps)),
      recordUnlock: unlock =>
        save.recordUnlock === 'Unlocked' ? 'Unlocked' : unlock,
      playerName: () => cleanName(save.name),
      rank: () => save.rank,
      bonuses: bonuses => mergeBonuses(bonuses, save.bonuses),
      lastRunEnding: () => save.lastRun,
      missions: missions => mergeMissions(missions, save.missions),
      proof: proof => mergeProof(proof, save.proof),
      journal: journal => mergeJournal(journal, save.journal),
      mastery: mastery => mergeMastery(mastery, save.mastery),
      dareMarks: marks => mergeDareMarks(marks, save.dareMarks),
      calling: () => save.calling,
      boughtCosmetics: () => save.boughtCosmetics,
      seenUnlocks: seen =>
        Array.union(
          seen,
          Array.contains(save.seenUnlocks, SEEN_BASELINE)
            ? [
                ...Array.filter(save.seenUnlocks, id => id !== SEEN_BASELINE),
                ...unlocksAt(rankOf(totalPointsOf(save.rank))),
              ]
            : save.seenUnlocks,
        ),
    }),
    {
      player: player =>
        model.phase._tag === 'Ready'
          ? playerOfCalling(callingForRun(save.calling, save.boughtCosmetics))
          : player,
    },
  ),
)

export const forgetTutorial = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: () => freshLessons,
    practice: () => noPractice,
    trapHint: () => TrapHint.Unseen(),
    introSeen: () => 'Unseen',
    firstBreakQuest: () => QuestTour.Waiting(),
    rattlesIntro: () => RattlesIntro.Waiting(),
    kitchenTour: () => Tour.Waiting(),
    introducedKinds: () => [],
    debutCard: () => DebutCard.Hidden(),
    caseCard: () => CaseCard.Hidden(),
    seenPowerUps: () => [],
  })

export class SaveStorageError extends Schema.TaggedError<
  SaveStorageError,
  { readonly brand: unique symbol }
>()('SaveStorageError', {
  reason: Schema.String,
}) {}

const toStorageError = (error: unknown): SaveStorageError =>
  SaveStorageError.make({ reason: String(error) })

export const readLegacySave: Effect.Effect<
  Option.Option<PlayerSave>,
  SaveStorageError
> = pipe(
  Effect.try({
    try: () => Option.fromNullishOr(localStorage.getItem(SAVE_KEY)),
    catch: toStorageError,
  }),
  Effect.map(Option.flatMap(decodeSave)),
)

export const writeLegacySave = (
  save: PlayerSave,
): Effect.Effect<void, SaveStorageError> =>
  pipe(
    encodeSave(save),
    Option.match({
      onNone: () => Effect.void,
      onSome: json =>
        Effect.try({
          try: () => localStorage.setItem(SAVE_KEY, json),
          catch: toStorageError,
        }),
    }),
  )
