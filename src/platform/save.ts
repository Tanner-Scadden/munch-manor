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
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
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
import { cleanName } from '../domain/playerName'
import { unlocksAt } from '../domain/unlocks'
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
  noSavedBests,
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
} from '../shared/playerData'

// SAVE

// NOTE: the PlayerSave is one record per player, plain data, shaped like the
// player scope in PLATFORM.md. It is stored as the player row in on-device
// SQLite (see src/platform/store.ts). SAVE_KEY is the localStorage copy it used to
// live in: imported into SQLite once, then kept read-only as a fallback for
// one release. A new field goes in here with a version bump, and decodeSave
// migrates or drops the older version.
export const SAVE_KEY = 'munch-manor:save'

const saveEquivalence = Schema.toEquivalence(PlayerSave)

export const isSameSave: {
  (that: PlayerSave): (self: PlayerSave) => boolean
  (self: PlayerSave, that: PlayerSave): boolean
} = Function.dual(2, (self: PlayerSave, that: PlayerSave): boolean =>
  saveEquivalence(self, that),
)

// FROM THE MODEL

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

// NOTE: every Model field saveOf reads. Most Messages, every frame among
// them, leave all of these as the same references, so the save needs no
// rebuilding or comparing. Keep this in step with saveOf.
export const SAVED_FIELDS = [
  'lessons',
  'trapHint',
  'introSeen',
  'introducedKinds',
  'homeScreenTip',
  'soundSetting',
  'musicSetting',
  'shakeSetting',
  'shareStats',
  'cursorSetting',
  'appearance',
  'difficulty',
  'difficultyCard',
  'bests',
  'home',
  'seenPowerUps',
  'rotationSetting',
  'rumbleSetting',
  'playerName',
  'rank',
  'bonuses',
  'lastRunEnding',
  'calling',
  'boughtCosmetics',
  'seenUnlocks',
  'recordRuns',
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
    sound: model.soundSetting,
    music: model.musicSetting,
    shake: model.shakeSetting,
    shareStats: model.shareStats,
    cursor: model.cursorSetting,
  },
  appearance: model.appearance,
  difficulty: {
    chosen: model.difficulty.chosen,
    card: DifficultyCard.isAnyOf(['Seen'])(model.difficultyCard)
      ? 'Seen'
      : 'Unseen',
    nightmare: model.difficulty.nightmare === 'Locked' ? 'Locked' : 'Unlocked',
  },
  bests: savedBests(model.bests),
  home: {
    seenNewsDay: Option.getOrNull(model.home.maybeSeenNewsDay),
    openedEntries: model.home.openedEntries,
    ...(model.home.isTurnHintSeen ? { turnHintSeen: true } : {}),
  },
  seenPowerUps: model.seenPowerUps,
  rotation: model.rotationSetting,
  rumble: model.rumbleSetting,
  name: model.playerName,
  records: savedRunRecords(model.bests),
  rank: model.rank,
  bonuses: model.bonuses,
  lastRun: model.lastRunEnding,
  calling: model.calling,
  boughtCosmetics: model.boughtCosmetics,
  seenUnlocks: model.seenUnlocks,
  recordRuns: model.recordRuns,
  recordUnlock: model.recordUnlock,
})

// INTO THE MODEL

const restoreLesson =
  (saved: SavedLesson) =>
  (lesson: Lesson): Lesson =>
    saved === 'Learned' ? Lesson.Learned({ atMs: 0 }) : lesson

const restoreLessons = (lessons: Lessons, saved: SavedLessons): Lessons =>
  modifyFields(lessons, {
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

// NOTE: kinds are kept as strings in the save, so a renamed or removed kind
// is dropped here instead of throwing the whole save away.
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

// NOTE: things are kept as strings in the save, as kinds are, so a renamed
// thing drops out of the best run instead of throwing the save away.
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

// NOTE: only the known kinds are read back, the same way, so the count of a
// renamed or removed kind is dropped. The total stays as it was saved.
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

// NOTE: a day doubled or a difficulty escaped on, on any device or this
// one, stays so: the later day, and every difficulty.
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
})

export const restoreSave: {
  (save: PlayerSave): (model: Model) => Model
  (model: Model, save: PlayerSave): Model
} = Function.dual(2, (model: Model, save: PlayerSave): Model =>
  modifyFocus(
    modifyFields(model, {
      lessons: lessons => restoreLessons(lessons, save.onboarding.lessons),
      trapHint: hint =>
        save.onboarding.trapHint === 'Seen' ? TrapHint.Seen() : hint,
      introSeen: seen => (save.onboarding.intro === 'Seen' ? 'Seen' : seen),
      introducedKinds: kinds =>
        Array.union(kinds, knownKinds(save.onboarding.introducedKinds)),
      homeScreenTip: tip =>
        save.homeScreenTip === 'Dismissed' ? 'Dismissed' : tip,
      soundSetting: () => save.settings.sound,
      musicSetting: () => save.settings.music,
      shakeSetting: () => save.settings.shake,
      shareStats: () => save.settings.shareStats,
      cursorSetting: () => save.settings.cursor,
      // NOTE: a look worn but not owned (a purchase another device's Bones
      // outran) comes off.
      appearance: () =>
        lookInOwned(
          save.appearance,
          save.boughtCosmetics,
          rankOf(totalPointsOf(save.rank)),
        ),
      difficulty: setting =>
        modifyFields(setting, {
          chosen: () => save.difficulty.chosen,
          nightmare: nightmare =>
            save.difficulty.nightmare === 'Unlocked' && nightmare === 'Locked'
              ? 'Unlocked'
              : nightmare,
        }),
      difficultyCard: card =>
        save.difficulty.card === 'Seen' ? DifficultyCard.Seen() : card,
      bests: () => restoreBests(save.bests, save.records),
      home: home =>
        modifyFields(home, {
          maybeSeenNewsDay: () => Option.fromNullishOr(save.home.seenNewsDay),
          openedEntries: opened =>
            Array.union(opened, knownKinds(save.home.openedEntries)),
          isTurnHintSeen: isSeen => isSeen || save.home.turnHintSeen === true,
        }),
      seenPowerUps: seen => Array.union(seen, knownPowerUps(save.seenPowerUps)),
      rotationSetting: () => save.rotation,
      rumbleSetting: () => save.rumble,
      recordRuns: () => save.recordRuns,
      // NOTE: unlocked on any device, or on this one, stays unlocked.
      recordUnlock: unlock =>
        save.recordUnlock === 'Unlocked' ? 'Unlocked' : unlock,
      playerName: () => cleanName(save.name),
      rank: () => save.rank,
      bonuses: bonuses => mergeBonuses(bonuses, save.bonuses),
      lastRunEnding: () => save.lastRun,
      calling: () => save.calling,
      boughtCosmetics: () => save.boughtCosmetics,
      // NOTE: unlocks seen on any device stay seen. The baseline mark of a row
      // from before NEW badges stands for every unlock reached now.
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
      // NOTE: the player at home wears the calling the next run starts with.
      // A save that syncs in mid-run leaves the run's player alone.
      player: player =>
        model.phase._tag === 'Ready'
          ? playerOfCalling(callingForRun(save.calling, save.boughtCosmetics))
          : player,
    },
  ),
)

// RESET

// NOTE: the reset forgets only the tutorial: the lessons, the zombie cards,
// and the power-ups explained. The look, the settings, the difficulty, and
// the bests and kills are kept.
export const forgetTutorial = (model: Model): Model =>
  modifyFields(model, {
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

// LEGACY STORAGE

export class SaveStorageError extends Schema.TaggedError<
  SaveStorageError,
  { readonly brand: unique symbol }
>()('SaveStorageError', {
  reason: Schema.String,
}) {}

const toStorageError = (error: unknown): SaveStorageError =>
  SaveStorageError.make({ reason: String(error) })

// NOTE: the localStorage copy of the save, from before SQLite. Only
// src/platform/store.ts calls these: once to import it, and as the fallback when
// SQLite cannot keep the save. A save that is absent, corrupted, or from
// another version reads as no save.
//
// NOTE: kept for one release only. SQLite on OPFS shipped to production on
// 2026-10-29, so any release from 2026-10-30 on may remove these two, the
// SAVE_KEY import, and the localStorage backend in src/platform/store.ts. Without
// them a browser that opens SQLite in memory keeps the save for the tab
// only. PLATFORM.md ("The fallback, for one release") says the same.
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
