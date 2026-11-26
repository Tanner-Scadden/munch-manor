import { Schema, Struct } from 'effect'
import { EventGroup, EventLog, EventRow } from 'effect/eventlog'

import { DayStamp } from '#shared/dayStamp.ts'
import { SavedJournal } from '#shared/journalData.ts'
import { SavedMastery } from '#shared/masteryData.ts'
import { MissionReroll, SavedMissions } from '#shared/missionData.ts'
import {
  Appearance,
  Calling,
  CursorSetting,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  PlayerSave,
  RecordRunsSetting,
  RotationSetting,
  RumbleSetting,
  RunEnding,
  SavedBests,
  SavedBestsByDifficulty,
  SavedCard,
  SavedHome,
  SavedOnboarding,
  SavedPowerUps,
  SavedRunRecords,
  SavedSeenUnlocks,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from '#shared/playerData.ts'
import { ProofEntry } from '#shared/proofData.ts'

export const PLAYER_ROW_KEY = 'me'

export const PlayerRowFields = Schema.Struct({
  id: Schema.String,
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
  cursor: CursorSetting,
  rotation: RotationSetting,
  rumble: RumbleSetting,
  recordRuns: RecordRunsSetting,
  name: PlayerName,
  calling: Calling,
  appearance: Appearance,
  chosen: Difficulty,
  card: SavedCard,
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  home: SavedHome,
  lastRun: RunEnding,
  seenPowerUps: SavedPowerUps,
})
export type PlayerRowFields = typeof PlayerRowFields.Type

export const PlayerRow = EventRow.make('PlayerRow', {
  key: 'id',
  schema: PlayerRowFields,
})

export const SeedSave = PlayerSave.mapFields(Struct.omit(['version']))
export type SeedSave = typeof SeedSave.Type

const SEED_KEY = 'seed'

export const SetEvents = EventGroup.empty.add(PlayerRow).add({
  tag: 'Seeded',
  primaryKey: () => SEED_KEY,
  payload: Schema.Struct({ save: SeedSave }),
})

export const EarnedEvents = EventGroup.empty
  .add({
    tag: 'RecordedRun',
    primaryKey: () => 'run',
    payload: Schema.Struct({
      runs: Schema.Finite,
      totalKills: Schema.Finite,
      kills: SavedBests.fields.killsByKind,
      bests: SavedBestsByDifficulty,
    }),
  })
  .add({
    tag: 'ReachedRecords',
    primaryKey: () => 'records',
    payload: Schema.Struct({ records: SavedRunRecords }),
  })
  .add({
    tag: 'EarnedRank',
    primaryKey: () => 'rank',
    payload: Schema.Struct({ points: Schema.Finite, bones: Schema.Finite }),
  })
  .add({
    tag: 'GrantedVeteranRank',
    primaryKey: () => 'veteran',
    payload: Schema.Struct({ points: Schema.Finite, bones: Schema.Finite }),
  })
  .add({
    tag: 'BoughtCosmetic',
    primaryKey: payload => payload.id,
    payload: Schema.Struct({ id: Schema.String }),
  })
  .add({
    tag: 'DoubledFirstRun',
    primaryKey: payload => payload.day,
    payload: Schema.Struct({ day: DayStamp, bones: Schema.Finite }),
  })
  .add({
    tag: 'EscapedFirst',
    primaryKey: payload => payload.difficulty,
    payload: Schema.Struct({ difficulty: Difficulty }),
  })
  .add({
    tag: 'PaidRankPurse',
    primaryKey: payload => `${payload.rank}`,
    payload: Schema.Struct({ rank: Schema.Finite }),
  })
  .add({
    tag: 'UnlockedNightmare',
    primaryKey: () => 'nightmare',
    payload: Schema.Struct({}),
  })
  .add({
    tag: 'UnlockedRecording',
    primaryKey: () => 'recording',
    payload: Schema.Struct({}),
  })
  .add({
    tag: 'SawUnlocks',
    primaryKey: () => 'unlocks',
    payload: Schema.Struct({ ids: SavedSeenUnlocks }),
  })
  .add({
    tag: 'ShelvedProof',
    primaryKey: payload => `${payload.entry.thing}:${payload.entry.difficulty}`,
    payload: Schema.Struct({ entry: ProofEntry }),
  })
  .add({
    tag: 'KeptJournal',
    primaryKey: () => 'journal',
    payload: Schema.Struct({ added: SavedJournal }),
  })
  .add({
    tag: 'GainedMastery',
    primaryKey: () => 'mastery',
    payload: Schema.Struct({ added: SavedMastery }),
  })
  .add({
    tag: 'ClimbedDareLadder',
    primaryKey: payload => payload.difficulty,
    payload: Schema.Struct({ difficulty: Difficulty, mark: Schema.Finite }),
  })

export const MissionEvents = EventGroup.empty
  .add({
    tag: 'ProgressedMissions',
    primaryKey: payload => payload.day,
    payload: Schema.Struct({
      day: DayStamp,
      progress: SavedMissions.fields.progress,
      coop: Schema.Boolean,
    }),
  })
  .add({
    tag: 'RolledMissions',
    primaryKey: payload => payload.day,
    payload: Schema.Struct({
      day: DayStamp,
      rolled: Schema.Array(Schema.String),
    }),
  })
  .add({
    tag: 'RerolledMission',
    primaryKey: payload => payload.day,
    payload: Schema.Struct({ day: DayStamp, reroll: MissionReroll }),
  })
  .add({
    tag: 'ClaimedMission',
    primaryKey: payload => `${payload.day}:${payload.mission}`,
    payload: Schema.Struct({ day: DayStamp, mission: Schema.String }),
  })
  .add({
    tag: 'StampedMissionDay',
    primaryKey: payload => payload.day,
    payload: Schema.Struct({ day: DayStamp }),
  })

export const PlayerLogSchema = EventLog.schema(
  SetEvents,
  EarnedEvents,
  MissionEvents,
)
