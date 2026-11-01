import { Array, Effect, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

// @vitest-environment happy-dom
import { FIXED_STEP_MS } from './constants'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from './home'
import { isPracticeGateHeld } from './lessons'
import { update } from './main'
import { Message } from './message'
import {
  BreakClock,
  DebutCard,
  DifficultyCard,
  Lesson,
  Loading,
  type Model,
  Phase,
  RunTally,
  TrapHint,
  freshLessons,
  initialModel,
  noBests,
  noKills,
} from './model'
import { DISTANT_SPAWN, loadingSave } from './model.fixture'
import { shownHints } from './onboarding'
import { noSavedRunRecords } from './playerData'
import { PlayerChange, changesBetween } from './playerSync'
import { grantedVeteran, noRank } from './rank'
import {
  type PlayerSave,
  SAVED_FIELDS,
  SAVE_KEY,
  SAVE_VERSION,
  decodeSave,
  encodeSave,
  hasSaveFieldsChanged,
  noSavedBests,
  readLegacySave,
  restoreSave,
  saveOf,
  unpickedDifficulty,
  unvisitedHome,
  writeLegacySave,
} from './save'
import { finishSplash, showDialog, tick } from './testing'
import { FocusTutorialReset, WriteSave } from './update/save'
import { ZOMBIE_KIND_ORDER } from './zombies'

const learnedSave: PlayerSave = {
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Learned',
      swap: 'Learned',
      pickup: 'Learned',
      timedBreaks: 'Learned',
      openBreak: 'Learned',
    },
    trapHint: 'Seen',
    ammoTip: 'Seen',
    introducedKinds: ZOMBIE_KIND_ORDER,
  },
  homeScreenTip: 'Dismissed',
  settings: {
    sound: 'Muted',
    music: 'Off',
    shake: 'Off',
    shareStats: 'Off',
    cursor: 'Thin',
  },
  appearance: {
    body: 'Slim',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Deep',
    shirtColor: 'Teal',
    outfit: 'Overalls',
    print: 'Rainbow',
    beard: true,
    glasses: true,
  },
  difficulty: { chosen: 'Hard', card: 'Seen', nightmare: 'Unlocked' },
  bests: {
    runsPlayed: 12,
    totalKills: 341,
    killsByKind: { Shambler: 200, Runner: 90, Tank: 11, Exploder: 40 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: 402_000, bestEndlessWave: 12 },
      Hard: { fastestWinMs: null, bestEndlessWave: 9 },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: {
    seenNewsDay: 'October 28, 2026',
    openedEntries: ['Shambler', 'Runner'],
  },
  seenPowerUps: ['RapidFire', 'Burp'],
  rotation: 'Landscape',
  name: 'Snackula',
  records: {
    Easy: { furthestWave: null, mostKills: null },
    Normal: { furthestWave: 7, mostKills: 140 },
    Hard: { furthestWave: 4, mostKills: 66 },
    Nightmare: { furthestWave: null, mostKills: null },
  },
  rank: {
    earnedPoints: 340,
    earnedBones: 34,
    veteranPoints: 150,
    veteranBones: 15,
    isVeteranGranted: true,
    spentBones: 5,
  },
  calling: 'TrackStar',
}

// NOTE: the look as saves before version 10 kept it, a Female or Male
// body and five parts, and the closest current look it reads as: a Broad
// body in a tee.
const LEGACY_LOOK = {
  body: 'Female',
  hairStyle: 'Ponytail',
  hairColor: 'Pink',
  skinTone: 'Deep',
  shirtColor: 'Teal',
}

const MIGRATED_LOOK: PlayerSave['appearance'] = {
  body: 'Broad',
  hairStyle: 'Ponytail',
  hairColor: 'Pink',
  skinTone: 'Deep',
  shirtColor: 'Teal',
  outfit: 'Tee',
  print: 'Plain',
  beard: false,
  glasses: false,
}

const versionNineSave = { ...learnedSave, appearance: LEGACY_LOOK }

// NOTE: a save from before version 12 has no run records yet.
const migratedSave: PlayerSave = {
  ...learnedSave,
  appearance: MIGRATED_LOOK,
  records: noSavedRunRecords,
  rank: noRank,
  calling: 'You',
}

const { name: _name, ...versionEightSave } = versionNineSave

// NOTE: a save from before the display name has none, and one from before
// the cursor setting comes back with the bold cursor, whatever the fixture
// above keeps for round trips.
const unnamedSave: PlayerSave = { ...migratedSave, name: '' }

const boldCursorSave: PlayerSave = {
  ...unnamedSave,
  settings: { ...learnedSave.settings, cursor: 'Bold' },
}

const neverSeenSave: PlayerSave = { ...boldCursorSave, seenPowerUps: [] }

const { cursor: _cursor, ...SETTINGS_BEFORE_CURSOR } = learnedSave.settings

const versionSixSave = {
  ...versionEightSave,
  settings: SETTINGS_BEFORE_CURSOR,
}

const { seenPowerUps: _seenPowerUps, ...versionFiveSave } = versionSixSave

const { home: _home, ...versionThreeSave } = versionFiveSave

const { bests: _bests, ...versionTwoSave } = versionThreeSave

const read: Model = modifyFields(loadingSave, {
  loading: () => Loading.Loaded(),
  saveStatus: () => 'Read',
})

describe('the schema', () => {
  test('a save round trips through JSON', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    expect(decodeSave(json)).toEqual(Option.some(learnedSave))
  })

  test('the difficulty round trips through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).difficulty).toEqual(
      learnedSave.difficulty,
    )
  })

  test('the save of a fresh model round trips too', () => {
    const fresh = saveOf(initialModel)
    const json = Option.getOrThrow(encodeSave(fresh))
    expect(decodeSave(json)).toEqual(Option.some(fresh))
  })

  const SETTINGS_BEFORE_SHARING = { sound: 'Muted', music: 'Off', shake: 'Off' }

  const sharingLearnedSave: PlayerSave = {
    ...neverSeenSave,
    settings: { ...boldCursorSave.settings, shareStats: 'On' },
  }

  test('the bests round trip through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).bests).toEqual(
      learnedSave.bests,
    )
  })

  test('the sharing setting round trips through the model', () => {
    const restored = restoreSave(initialModel, learnedSave)
    expect(restored.shareStats).toBe('Off')
    expect(saveOf(restored).settings.shareStats).toBe('Off')
  })

  test('a version 1 save still loads, as Normal with the card still to come, sharing on, and no bests', () => {
    const { difficulty: _, ...withoutDifficulty } = versionTwoSave
    const json = JSON.stringify({
      ...withoutDifficulty,
      version: 1,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({
        ...sharingLearnedSave,
        difficulty: unpickedDifficulty,
        bests: noSavedBests,
        home: unvisitedHome,
      }),
    )
  })

  test('a version 2 save keeps every field, starts the bests at zero, and turns sharing on', () => {
    const json = JSON.stringify({
      ...versionTwoSave,
      version: 2,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({
        ...sharingLearnedSave,
        bests: noSavedBests,
        home: unvisitedHome,
      }),
    )
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.bests).toEqual(noBests)
    expect(restored.difficulty.chosen).toBe('Hard')
  })

  test("a version 3 save keeps its bests and turns sharing on, with What's New unseen and no Munchopedia entry opened", () => {
    const json = JSON.stringify({
      ...versionThreeSave,
      version: 3,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({ ...sharingLearnedSave, home: unvisitedHome }),
    )
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.bests.killsByKind.Runner).toBe(90)
    expect(restored.home.maybeSeenNewsDay).toEqual(Option.none())
    expect(restored.home.openedEntries).toEqual([])
  })

  test("a version 4 save, the live game's, keeps its home menu and turns sharing on", () => {
    const json = JSON.stringify({
      ...versionFiveSave,
      version: 4,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(Option.some(sharingLearnedSave))
  })

  test('a version 6 save keeps everything and gets the bold cursor', () => {
    const json = JSON.stringify({ ...versionSixSave, version: 6 })
    expect(decodeSave(json)).toEqual(Option.some(boldCursorSave))
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.cursorSetting).toBe('Bold')
  })

  test('a version 9 save keeps everything, its look read as the closest current one', () => {
    const json = JSON.stringify({ ...versionNineSave, version: 9 })
    expect(decodeSave(json)).toEqual(Option.some(migratedSave))
    const male = JSON.stringify({
      ...versionNineSave,
      version: 9,
      appearance: {
        ...LEGACY_LOOK,
        body: 'Male',
        hairStyle: 'Crop',
        hairColor: 'Ginger',
        skinTone: 'Light',
      },
    })
    expect(Option.map(decodeSave(male), save => save.appearance)).toEqual(
      Option.some({
        ...MIGRATED_LOOK,
        hairStyle: 'Short',
        hairColor: 'Red',
        skinTone: 'Light',
      }),
    )
  })

  // NOTE: the many-part look shipped for a few hours on 2026-10-30 before
  // the owner chose the simpler set; each part reads as its closest one.
  test('a version 10 save keeps everything, its many-part look read as the closest simple one', () => {
    const manyParts = {
      body: 'Round',
      hairStyle: 'Undercut',
      hairColor: 'Silver',
      skinTone: 'Umber',
      shirtColor: 'Lilac',
      outfit: 'Kilt',
      print: 'Trans',
      facialHair: 'Goatee',
      makeup: 'Glam',
      extra: 'Shades',
    }
    const json = JSON.stringify({
      ...learnedSave,
      version: 10,
      appearance: manyParts,
    })
    expect(Option.map(decodeSave(json), save => save.appearance)).toEqual(
      Option.some({
        body: 'Broad',
        hairStyle: 'Short',
        hairColor: 'Grey',
        skinTone: 'Deep',
        shirtColor: 'Purple',
        outfit: 'Dress',
        print: 'Rainbow',
        beard: true,
        glasses: true,
      }),
    )
    const plain = JSON.stringify({
      ...learnedSave,
      version: 10,
      appearance: {
        ...manyParts,
        body: 'Slim',
        hairStyle: 'Buzz',
        skinTone: 'Bronze',
        outfit: 'Vee',
        print: 'Stripes',
        facialHair: 'Stubble',
        extra: 'Earrings',
      },
    })
    expect(Option.map(decodeSave(plain), save => save.appearance)).toEqual(
      Option.some({
        body: 'Slim',
        hairStyle: 'Bald',
        hairColor: 'Grey',
        skinTone: 'Tan',
        shirtColor: 'Purple',
        outfit: 'Tee',
        print: 'Stripes',
        beard: false,
        glasses: false,
      }),
    )
    const { appearance: _look, ...rest } = learnedSave
    expect(
      Option.map(decodeSave(json), save => {
        const { appearance: _migrated, ...others } = save
        return others
      }),
    ).toEqual(
      Option.some({
        ...rest,
        records: noSavedRunRecords,
        rank: noRank,
        calling: 'You',
      }),
    )
  })

  test('a version 9 save with a look no build ever made reads as no save', () => {
    const json = JSON.stringify({
      ...versionNineSave,
      version: 9,
      appearance: { ...LEGACY_LOOK, body: 'Robot' },
    })
    expect(decodeSave(json)).toEqual(Option.none())
  })

  test('a version 8 save keeps everything, with no name yet', () => {
    const json = JSON.stringify({ ...versionEightSave, version: 8 })
    expect(decodeSave(json)).toEqual(Option.some(unnamedSave))
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.playerName).toBe('')
  })

  test('the name round trips through JSON and the model, cleaned on the way in', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    const reloaded = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(reloaded.playerName).toBe('Snackula')
    expect(saveOf(reloaded).name).toBe('Snackula')
    const messy: PlayerSave = {
      ...learnedSave,
      name: '  Dr.\u0007   Chomp the Unstoppable',
    }
    expect(restoreSave(initialModel, messy).playerName).toBe('Dr. Chomp th')
  })

  test('the cursor setting round trips through JSON and the model', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    const reloaded = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(reloaded.cursorSetting).toBe('Thin')
    expect(saveOf(reloaded).settings.cursor).toBe('Thin')
  })

  test('a version 5 save keeps everything, with no power-up seen yet', () => {
    const json = JSON.stringify({ ...versionFiveSave, version: 5 })
    expect(decodeSave(json)).toEqual(Option.some(neverSeenSave))
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.seenPowerUps).toEqual([])
  })

  test('the power-ups seen round trip through JSON and the model, dropping an unknown kind', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    const reloaded = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(reloaded.seenPowerUps).toEqual(['RapidFire', 'Burp'])
    expect(saveOf(reloaded).seenPowerUps).toEqual(['RapidFire', 'Burp'])
    const withStranger: PlayerSave = {
      ...learnedSave,
      seenPowerUps: ['Speed', 'Jetpack'],
    }
    expect(restoreSave(initialModel, withStranger).seenPowerUps).toEqual([
      'Speed',
    ])
  })

  test("the preview's version 4 save keeps its sharing, with the home menu unvisited", () => {
    const json = JSON.stringify({ ...versionThreeSave, version: 4 })
    expect(decodeSave(json)).toEqual(
      Option.some({ ...neverSeenSave, home: unvisitedHome }),
    )
  })

  test('the home menu round trips through the model, dropping an unknown kind', () => {
    const withStranger: PlayerSave = {
      ...learnedSave,
      home: { ...learnedSave.home, openedEntries: ['Shambler', 'Gloop'] },
    }
    const restored = restoreSave(initialModel, withStranger)
    expect(restored.home.maybeSeenNewsDay).toEqual(
      Option.some('October 28, 2026'),
    )
    expect(restored.home.openedEntries).toEqual(['Shambler'])
    expect(saveOf(restoreSave(initialModel, learnedSave)).home).toEqual(
      learnedSave.home,
    )
  })

  test('corrupted JSON, a wrong version, and a missing field read as no save', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    expect(decodeSave(`{"version":${SAVE_VERSION},`)).toEqual(Option.none())
    expect(
      decodeSave(json.replace(`"version":${SAVE_VERSION}`, '"version":0')),
    ).toEqual(Option.none())
    expect(
      decodeSave(JSON.stringify({ ...learnedSave, settings: undefined })),
    ).toEqual(Option.none())
  })
})

describe('the legacy localStorage copy', () => {
  afterEach(() => localStorage.clear())

  it.effect('writes and reads back under one key', () =>
    Effect.gen(function* () {
      yield* writeLegacySave(learnedSave)
      expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
      expect(yield* readLegacySave).toEqual(Option.some(learnedSave))
    }),
  )

  it.effect('a missing or corrupted save reads as no save', () =>
    Effect.gen(function* () {
      expect(yield* readLegacySave).toEqual(Option.none())
      localStorage.setItem(SAVE_KEY, 'not json at all')
      expect(yield* readLegacySave).toEqual(Option.none())
    }),
  )
})

describe('loading the save', () => {
  test('a loaded save skips the learned hints, the practice gate, and seen intro cards', () => {
    story(
      update,
      given(loadingSave),
      message(
        Message.CompletedLoadSave({ maybeSave: Option.some(learnedSave) }),
      ),
      finishSplash,
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(current.soundSetting).toBe('Muted')
        expect(current.shakeSetting).toBe('Off')
        expect(current.appearance).toEqual(learnedSave.appearance)
        expect(current.homeScreenTip).toBe('Dismissed')
        expect(TrapHint.guards.Seen(current.trapHint)).toBe(true)
        expect(current.difficulty).toEqual({
          chosen: 'Hard',
          nightmare: 'Unlocked',
        })
        expect(current.difficultyCard).toEqual(DifficultyCard.Seen())
        expect(current.bests.totalKills).toBe(341)
        expect(current.bests.runsPlayed).toBe(12)
        expect(current.bests.killsByKind.Tank).toBe(11)
        expect(current.bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.some(402_000),
        )
        expect(current.bests.byDifficulty.Hard.maybeBestEndlessWave).toEqual(
          Option.some(9),
        )
      }),
      message(Message.ClickedCampaignButton()),
      tick(50),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(shownHints(current)).toEqual([])
        expect(isPracticeGateHeld(current)).toBe(false)
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(DebutCard.guards.Hidden(current.debutCard)).toBe(true)
      }),
    )
  })

  test('with no save, a new player still gets the hints and the practice gate', () => {
    story(
      update,
      given(loadingSave),
      message(Message.CompletedLoadSave({ maybeSave: Option.none() })),
      finishSplash,
      message(Message.ClickedCampaignButton()),
      showDialog(),
      message(Message.ClickedDifficultyCardButton({ difficulty: 'Normal' })),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      tick(50),
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(isPracticeGateHeld(current)).toBe(true)
        expect(shownHints(current).map(({ id }) => id)).toContain('Move')
      }),
    )
  })

  test('storage that cannot be read falls back to the defaults and lets the game in', () => {
    story(
      update,
      given(loadingSave),
      message(Message.FailedLoadSave({ reason: 'SecurityError' })),
      finishSplash,
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(current.lessons).toEqual(freshLessons)
        expect(current.soundSetting).toBe('On')
        expect(Loading.guards.Loaded(current.loading)).toBe(true)
      }),
    )
  })

  test('a save with an unknown zombie kind keeps the rest', () => {
    const odd: PlayerSave = {
      ...learnedSave,
      onboarding: {
        ...learnedSave.onboarding,
        introducedKinds: ['Shambler', 'Gone'],
      },
      bests: {
        ...learnedSave.bests,
        killsByKind: { Shambler: 5, Gone: 9 },
      },
    }
    story(
      update,
      given(loadingSave),
      message(Message.CompletedLoadSave({ maybeSave: Option.some(odd) })),
      finishSplash,
      model(current => {
        expect(current.introducedKinds).toEqual(['Shambler'])
        expect(current.soundSetting).toBe('Muted')
        expect(current.bests.killsByKind).toEqual(
          modifyFields(noKills, { Shambler: () => 5 }),
        )
        expect(current.bests.totalKills).toBe(341)
      }),
    )
  })
})

describe('writing the save', () => {
  test('changing a setting writes the new save', () => {
    const muted = modifyFields(read, { soundSetting: () => 'Muted' })
    story(
      update,
      given(read),
      message(Message.ClickedMuteButton()),
      Command.expectExact(
        WriteSave({
          save: saveOf(muted),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(muted).settings }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('choosing a difficulty by PLAY writes the new save', () => {
    const settings = modifyFields(read, {
      panel: () => 'Difficulty',
      panelDialog: dialog => ({ ...dialog, isOpen: true }),
      difficultyCard: () => DifficultyCard.Seen(),
    })
    story(
      update,
      given(settings),
      message(Message.ClickedDifficultyCardButton({ difficulty: 'Easy' })),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      Command.expectExact(
        WriteSave({
          save: saveOf(
            modifyFields(settings, {
              difficulty: setting =>
                modifyFields(setting, { chosen: () => 'Easy' }),
            }),
          ),
          changes: [
            PlayerChange.ChangedDifficulty({ chosen: 'Easy', card: 'Seen' }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('answering the first-time card saves the pick and that it was seen', () => {
    story(
      update,
      given(read),
      message(Message.ClickedCampaignButton()),
      Command.resolve(
        Dialog.test.ShowDialog,
        DialogBlock.Message.SucceededShowDialog(),
      ),
      message(Message.ClickedDifficultyCardButton({ difficulty: 'Hard' })),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      model(current => {
        expect(saveOf(current).difficulty).toEqual({
          chosen: 'Hard',
          card: 'Seen',
          nightmare: 'Locked',
        })
      }),
    )
  })

  test('learning a lesson writes the new save', () => {
    const breakTime: Model = modifyFields(read, {
      lessons: lessons =>
        modifyFields(lessons, {
          move: () => Lesson.Learned({ atMs: 0 }),
          fire: () => Lesson.Learned({ atMs: 0 }),
        }),
      introducedKinds: () => ZOMBIE_KIND_ORDER,
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 5000,
          durationMs: 20_000,
          spawns: [],
        }),
    })
    story(
      update,
      given(breakTime),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Lesson.guards.Learned(current.lessons.startWave)).toBe(true)
      }),
      Command.expectHas(WriteSave),
      model(current => {
        expect(saveOf(current).onboarding.lessons.startWave).toBe('Learned')
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('the first break is learned when that break ends, with no label in the room', () => {
    const openBreak: Model = modifyFields(read, {
      introducedKinds: () => ZOMBIE_KIND_ORDER,
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 20_000,
          durationMs: 20_000,
          spawns: [],
          clock: BreakClock.Waiting({ elapsedMs: 9000 }),
        }),
    })
    expect(shownHints(openBreak)).toEqual([])
    story(
      update,
      given(openBreak),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(saveOf(current).onboarding.lessons.openBreak).toBe('Learned')
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('the end of a run writes its kills and the run into the save', () => {
    const dying = modifyFields(read, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      player: player => modifyFields(player, { hp: () => 0 }),
      stats: stats =>
        modifyFields(stats, {
          kills: () =>
            modifyFields(noKills, { Shambler: () => 4, Tank: () => 1 }),
        }),
    })
    story(
      update,
      given(dying),
      tick(50),
      model(current => {
        expect(Phase.guards.GameOver(current.phase)).toBe(true)
        expect(saveOf(current).bests).toEqual({
          ...noSavedBests,
          runsPlayed: 1,
          totalKills: 5,
          killsByKind: { Shambler: 4, Tank: 1 },
        })
      }),
      Command.expectHas(WriteSave),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('kills mid-run write nothing until the run ends', () => {
    const fighting = modifyFields(read, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      stats: stats =>
        modifyFields(stats, {
          kills: () => modifyFields(noKills, { Shambler: () => 4 }),
        }),
    })
    story(update, given(fighting), tick(50), Command.expectNone())
  })

  test('the first grab of a power-up kind writes it, and a second grab writes nothing', () => {
    const fighting = modifyFields(restoreSave(read, neverSeenSave), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    })
    const hotSauceUnder = (base: Model): Model =>
      modifyFields(base, {
        pickups: () => [
          {
            id: 900,
            kind: 'RapidFire',
            x: base.player.x,
            y: base.player.y,
            ageMs: 0,
          },
        ],
      })
    const seen = modifyFields(fighting, { seenPowerUps: () => ['RapidFire'] })
    story(
      update,
      given(hotSauceUnder(fighting)),
      tick(FIXED_STEP_MS),
      Command.expectExact(
        WriteSave({
          save: { ...saveOf(fighting), seenPowerUps: ['RapidFire'] },
          changes: [PlayerChange.SawPowerUps({ kinds: ['RapidFire'] })],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
    story(
      update,
      given(hotSauceUnder(seen)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(current.pickups).toEqual([])
        expect(current.callouts[0]?.look).toBe('Named')
      }),
      Command.expectNone(),
    )
  })

  test('the power-ups seen last across a reload', () => {
    const grabbed = modifyFields(read, {
      seenPowerUps: () => ['Damage', 'Heart'],
      rank: rank => grantedVeteran(rank, 0),
    })
    const json = Option.getOrThrow(encodeSave(saveOf(grabbed)))
    story(
      update,
      given(loadingSave),
      message(Message.CompletedLoadSave({ maybeSave: decodeSave(json) })),
      finishSplash,
      model(current => {
        expect(current.seenPowerUps).toEqual(['Damage', 'Heart'])
      }),
    )
  })

  test('a frame that changes nothing saved writes nothing', () => {
    story(update, given(read), tick(50), Command.expectNone())
  })

  test('a frame mid-wave leaves every saved field as it was, so the save is not rebuilt', () => {
    const fighting = modifyFields(restoreSave(read, learnedSave), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    })
    story(
      update,
      given(fighting),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FIXED_STEP_MS),
      tick(FIXED_STEP_MS),
      Command.expectNone(),
      model(current => {
        expect(current.player.x).not.toBe(fighting.player.x)
        expect(
          SAVED_FIELDS.filter(field => fighting[field] !== current[field]),
        ).toEqual([])
        expect(hasSaveFieldsChanged(fighting, current)).toBe(false)
      }),
    )
  })

  test('the saved fields are all the save reads', () => {
    const played = modifyFields(restoreSave(read, learnedSave), {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      wallet: wallet => modifyFields(wallet, { balance: () => 300 }),
      stats: stats =>
        modifyFields(stats, {
          kills: () => modifyFields(noKills, { Shambler: () => 4 }),
        }),
      runTally: () => RunTally.Counted({ kills: noKills }),
      panel: () => 'WhatsNew',
      orientation: () => 'Portrait',
    })
    const savedFromInitial = Object.fromEntries(
      SAVED_FIELDS.map(field => [field, initialModel[field]]),
    )
    expect(saveOf({ ...played, ...savedFromInitial })).toEqual(
      saveOf(initialModel),
    )
  })

  test('nothing is written before the save has been read', () => {
    story(
      update,
      given(loadingSave),
      message(Message.ClickedMuteButton()),
      Command.expectNone(),
    )
  })
})

describe('reset tutorial', () => {
  const veteranHome: Model = modifyFields(read, {
    lessons: () => ({
      move: Lesson.Learned({ atMs: 0 }),
      fire: Lesson.Learned({ atMs: 0 }),
      startWave: Lesson.Learned({ atMs: 0 }),
      shop: Lesson.Learned({ atMs: 0 }),
      swap: Lesson.Learned({ atMs: 0 }),
      pickup: Lesson.Learned({ atMs: 0 }),
      timedBreaks: Lesson.Learned({ atMs: 0 }),
      openBreak: Lesson.Learned({ atMs: 0 }),
    }),
    trapHint: () => TrapHint.Seen(),
    introducedKinds: () => ZOMBIE_KIND_ORDER,
    seenPowerUps: () => ['RapidFire', 'Pierce'],
    homeScreenTip: () => 'Dismissed',
    soundSetting: () => 'Muted',
    shakeSetting: () => 'Off',
    appearance: () => learnedSave.appearance,
    bests: () => restoreSave(read, learnedSave).bests,
  })

  test('asks first, then clears the onboarding only and saves', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedResetTutorialButton()),
      Command.expectExact(FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID })),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      model(current => {
        expect(current.tutorialReset).toBe('Asking')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
      message(Message.ClickedConfirmResetTutorialButton()),
      Command.expectHas(WriteSave),
      model(current => {
        expect(current.tutorialReset).toBe('Done')
        expect(current.lessons).toEqual(freshLessons)
        expect(current.introducedKinds).toEqual([])
        expect(current.seenPowerUps).toEqual([])
        expect(
          Array.map(
            changesBetween(saveOf(veteranHome), saveOf(current)),
            ({ _tag }) => _tag,
          ),
        ).toEqual(['ChangedOnboarding', 'ForgotPowerUps'])
        expect(TrapHint.guards.Unseen(current.trapHint)).toBe(true)
        expect(current.soundSetting).toBe('Muted')
        expect(current.shakeSetting).toBe('Off')
        expect(current.appearance).toEqual(learnedSave.appearance)
        expect(current.homeScreenTip).toBe('Dismissed')
        expect(saveOf(current).bests).toEqual(learnedSave.bests)
      }),
      Command.resolve(
        FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID }),
        Message.CompletedFocusTutorialReset(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('keep leaves the tutorial learned and writes nothing', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedResetTutorialButton()),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      message(Message.ClickedCancelResetTutorialButton()),
      Command.expectExact(FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      model(current => {
        expect(current.tutorialReset).toBe('Idle')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    )
  })

  test('confirming without asking first does nothing', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedConfirmResetTutorialButton()),
      Command.expectNone(),
      model(current => {
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    )
  })
})

describe('the veteran grant', () => {
  const loaded = (maybeSave: Option.Option<PlayerSave>) =>
    update(loadingSave, Message.CompletedLoadSave({ maybeSave }))

  const writesOf = (result: ReturnType<typeof update>) =>
    (result.commands ?? []).filter(command => command.name === WriteSave.name)

  // NOTE: a save from before rank, as the previous build wrote it.
  const beforeRank = (killsByKind: Record<string, number>) => {
    const { rank: _rank, ...rest } = learnedSave
    const json = JSON.stringify({
      ...rest,
      version: 12,
      bests: { ...learnedSave.bests, killsByKind },
    })
    return decodeSave(json)
  }

  test('a save from before rank is granted a point per kill, and writes the grant', () => {
    const result = loaded(beforeRank({ Shambler: 200, Runner: 141 }))
    expect(result.model.rank).toEqual({
      earnedPoints: 0,
      earnedBones: 0,
      veteranPoints: 341,
      veteranBones: 34,
      isVeteranGranted: true,
      spentBones: 0,
    })
    const [write] = writesOf(result)
    expect(write?.args).toMatchObject({
      changes: [{ _tag: 'GrantedVeteranRank', points: 341, bones: 34 }],
    })
  })

  test('the grant stops at the points for rank 10', () => {
    const result = loaded(beforeRank({ Shambler: 9000 }))
    expect(result.model.rank.veteranPoints).toBe(1800)
    expect(result.model.rank.veteranBones).toBe(180)
  })

  test('a save that was granted keeps its grant and writes nothing', () => {
    const result = loaded(Option.some(learnedSave))
    expect(result.model.rank).toEqual(learnedSave.rank)
    expect(writesOf(result)).toEqual([])
  })

  test('a new player is granted 0 once, so later kills never become a grant', () => {
    const result = loaded(Option.none())
    expect(result.model.rank.isVeteranGranted).toBe(true)
    expect(result.model.rank.veteranPoints).toBe(0)
    expect(writesOf(result)).toEqual([])
    const later = modifyFields(result.model, {
      bests: bests => modifyFields(bests, { totalKills: () => 500 }),
    })
    expect(saveOf(later).rank.veteranPoints).toBe(0)
  })
})

describe('the calling in the save', () => {
  test('round trips through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).calling).toBe(
      'TrackStar',
    )
  })

  test('a save from before callings picks YOU', () => {
    const { calling: _calling, ...rest } = learnedSave
    const json = JSON.stringify({ ...rest, version: 13 })
    const migrated = Option.getOrThrow(decodeSave(json))
    expect(migrated.calling).toBe('You')
    expect(migrated.version).toBe(SAVE_VERSION)
  })

  test('a synced pick the rank has not reached still starts as YOU', () => {
    const synced = restoreSave(
      modifyFields(initialModel, { saveStatus: () => 'Read' }),
      { ...learnedSave, calling: 'LineCook', rank: noRank },
    )
    expect(synced.calling).toBe('LineCook')
    expect(synced.player.calling).toBe('You')
  })
})
