// @vitest-environment happy-dom
import { Array, Effect, Option, Record, String } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test } from '@effect/vitest'

import { LobbyBinding, ProfileBinding } from '../../app/bindings'
import { Message } from '../../app/message'
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
  noBests,
  noKills,
} from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { WriteSave } from '../../app/update/save'
import { Message as LobbyMessage } from '../../features/lobby/message'
import { shownHints } from '../../features/onboarding/onboarding'
import { Message as ProfileMessage } from '../../features/profile/message'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '../../features/profile/profile'
import { FocusTutorialReset } from '../../features/profile/update'
import { FIXED_STEP_MS } from '../../shared/constants'
import { noSavedRunRecords } from '../../shared/playerData'
import { DISTANT_SPAWN, loadingSave, withKeys } from '../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  finishSplash,
  jsonOf,
  resolveFocusLobby,
  showDialog,
  throughIntro,
  tick,
  writeSave,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { grantedVeteran, noRank } from '../../world/heroes/rank'
import { focusOf, modifyFocus } from '../../world/party/party'
import { isPracticeGateHeld } from '../../world/run/lessons'
import { ZOMBIE_KIND_ORDER } from '../../world/zombies/zombies'
import { PlayerChange, changesBetween } from '../playerSync'
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
} from '../save'
import { learnedSave } from './save.fixture'

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
  hat: 'None',
  gunSkin: 'Stock',
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

  // NOTE: a save from before the dare tour has no key for it and still
  // holds the shop's lesson: it reads, the shop dropped and the tour to
  // come.
  test('a save from before the dare tour reads with the tour still to come', () => {
    const {
      dareTour: _dareTour,
      dareKey: _dareKey,
      rattles: _rattles,
      ...lessons
    } = learnedSave.onboarding.lessons
    const older = jsonOf({
      ...learnedSave,
      onboarding: {
        ...learnedSave.onboarding,
        lessons: { ...lessons, shop: 'Learned' },
      },
    })
    expect(
      Option.map(decodeSave(older), save => save.onboarding.lessons),
    ).toEqual(
      Option.some({
        ...lessons,
        dareTour: 'Pending',
        dareKey: 'Pending',
        rattles: 'Pending',
      }),
    )
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
    const json = jsonOf({
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
    const json = jsonOf({
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
    const json = jsonOf({
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
    const json = jsonOf({
      ...versionFiveSave,
      version: 4,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(Option.some(sharingLearnedSave))
  })

  test('a version 6 save keeps everything and gets the bold cursor', () => {
    const json = jsonOf({ ...versionSixSave, version: 6 })
    expect(decodeSave(json)).toEqual(Option.some(boldCursorSave))
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.cursorSetting).toBe('Bold')
  })

  test('a version 9 save keeps everything, its look read as the closest current one', () => {
    const json = jsonOf({ ...versionNineSave, version: 9 })
    expect(decodeSave(json)).toEqual(Option.some(migratedSave))
    const male = jsonOf({
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
    const json = jsonOf({
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
        hat: 'None',
        gunSkin: 'Stock',
      }),
    )
    const plain = jsonOf({
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
        hat: 'None',
        gunSkin: 'Stock',
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
    const json = jsonOf({
      ...versionNineSave,
      version: 9,
      appearance: { ...LEGACY_LOOK, body: 'Robot' },
    })
    expect(decodeSave(json)).toEqual(Option.none())
  })

  test('a version 8 save keeps everything, with no name yet', () => {
    const json = jsonOf({ ...versionEightSave, version: 8 })
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
    const json = jsonOf({ ...versionFiveSave, version: 5 })
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
    const json = jsonOf({ ...versionThreeSave, version: 4 })
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
      decodeSave(
        String.replace(`"version":${SAVE_VERSION}`, '"version":0')(json),
      ),
    ).toEqual(Option.none())
    expect(decodeSave(jsonOf({ ...learnedSave, settings: undefined }))).toEqual(
      Option.none(),
    )
  })
})

describe('the legacy localStorage copy', () => {
  afterEach(() => localStorage.clear())

  it.effect('writes and reads back under one key', () =>
    Effect.gen(function* () {
      yield* writeLegacySave(learnedSave)
      expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
      const readLegacySave_1 = yield* readLegacySave
      expect(readLegacySave_1).toEqual(Option.some(learnedSave))
    }),
  )

  it.effect('a missing or corrupted save reads as no save', () =>
    Effect.gen(function* () {
      const readLegacySave_2 = yield* readLegacySave
      expect(readLegacySave_2).toEqual(Option.none())
      localStorage.setItem(SAVE_KEY, 'not json at all')
      const readLegacySave_3 = yield* readLegacySave
      expect(readLegacySave_3).toEqual(Option.none())
    }),
  )
})

describe('loading the save', () => {
  it.effect(
    'a loaded save skips the learned hints, the practice gate, and seen intro cards',
    () =>
      Story.story(
        APPLICATION,
        Story.given(loadingSave),
        Story.message(
          Message.CompletedLoadSave({ maybeSave: Option.some(learnedSave) }),
        ),
        finishSplash,
        Story.model(current => {
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
        Story.message(Message.ClickedCampaignButton()),
        tick(50),
        throughIntro,
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(shownHints(current)).toEqual([])
          expect(isPracticeGateHeld(current)).toBe(false)
        }),
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
          expect(DebutCard.guards.Hidden(current.debutCard)).toBe(true)
        }),
      ),
  )

  it.effect(
    'with no save, a new player still gets the hints and the practice gate',
    () =>
      Story.story(
        APPLICATION,
        Story.given(loadingSave),
        Story.message(Message.CompletedLoadSave({ maybeSave: Option.none() })),
        finishSplash,
        Story.message(Message.ClickedCampaignButton()),
        showDialog(),
        Story.message(
          Message.ClickedDifficultyCardButton({ difficulty: 'Normal' }),
        ),
        closeDialog(),
        writeSave(),
        tick(50),
        throughIntro,
        Story.model(current => {
          expect(current.saveStatus).toBe('Read')
          expect(isPracticeGateHeld(current)).toBe(true)
          expect(Array.map(shownHints(current), ({ id }) => id)).toContain(
            'Move',
          )
        }),
      ),
  )

  it.effect(
    'storage that cannot be read falls back to the defaults and lets the game in',
    () =>
      Story.story(
        APPLICATION,
        Story.given(loadingSave),
        Story.message(Message.FailedLoadSave({ reason: 'SecurityError' })),
        finishSplash,
        Story.model(current => {
          expect(current.saveStatus).toBe('Read')
          expect(current.lessons).toEqual(freshLessons)
          expect(current.soundSetting).toBe('On')
          expect(Loading.guards.Loaded(current.loading)).toBe(true)
        }),
      ),
  )

  it.effect('a save with an unknown zombie kind keeps the rest', () => {
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
    return Story.story(
      APPLICATION,
      Story.given(loadingSave),
      Story.message(Message.CompletedLoadSave({ maybeSave: Option.some(odd) })),
      finishSplash,
      Story.model(current => {
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
  it.effect('changing a setting writes the new save', () => {
    const muted = modifyFields(read, { soundSetting: () => 'Muted' })
    return Story.story(
      APPLICATION,
      Story.given(read),
      Story.message(Message.ClickedMuteButton()),
      Story.Command.expectExact(
        WriteSave({
          save: saveOf(muted),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(muted).settings }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  it.effect('choosing a difficulty in the lobby writes the new save', () => {
    const settings = asVeteran(read)
    return Story.story(
      APPLICATION,
      Story.given(settings),
      Story.message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedDifficultyButton({ difficulty: 'Easy' }),
      ),
      resolveFocusLobby(),
      Story.Command.expectExact(
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
      writeSave(),
    )
  })

  it.effect(
    'answering the first-time card saves the pick and that it was seen',
    () =>
      Story.story(
        APPLICATION,
        Story.given(read),
        Story.message(Message.ClickedCampaignButton()),
        showDialog(),
        Story.message(
          Message.ClickedDifficultyCardButton({ difficulty: 'Hard' }),
        ),
        closeDialog(),
        writeSave(),
        Story.model(current => {
          expect(saveOf(current).difficulty).toEqual({
            chosen: 'Hard',
            card: 'Seen',
            nightmare: 'Locked',
          })
        }),
      ),
  )

  it.effect('learning a lesson writes the new save', () => {
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
    return Story.story(
      APPLICATION,
      Story.given(breakTime),
      Story.message(Message.ClickedStartWaveButton()),
      Story.model(current => {
        expect(Lesson.guards.Learned(current.lessons.startWave)).toBe(true)
      }),
      Story.Command.expectHas(WriteSave),
      Story.model(current => {
        expect(saveOf(current).onboarding.lessons.startWave).toBe('Learned')
      }),
      writeSave(),
    )
  })

  it.effect(
    'the first break is learned when that break ends, with no label in the room',
    () => {
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
      return Story.story(
        APPLICATION,
        Story.given(openBreak),
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(current => {
          expect(saveOf(current).onboarding.lessons.openBreak).toBe('Learned')
        }),
        writeSave(),
      )
    },
  )

  it.effect(
    'the end of a run writes its kills and the run into the save',
    () => {
      const dying = modifyFocus(
        modifyFields(read, {
          phase: () =>
            Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
          stats: stats =>
            modifyFields(stats, {
              kills: () =>
                modifyFields(noKills, { Shambler: () => 4, Tank: () => 1 }),
            }),
        }),
        { player: player => modifyFields(player, { hp: () => 0 }) },
      )
      return Story.story(
        APPLICATION,
        Story.given(dying),
        tick(50),
        Story.model(current => {
          expect(Phase.guards.GameOver(current.phase)).toBe(true)
          expect(saveOf(current).bests).toEqual({
            ...noSavedBests,
            runsPlayed: 1,
            totalKills: 5,
            killsByKind: { Shambler: 4, Tank: 1 },
          })
        }),
        Story.Command.expectHas(WriteSave),
        writeSave(),
      )
    },
  )

  it.effect('kills mid-run write nothing until the run ends', () => {
    const fighting = modifyFields(read, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      stats: stats =>
        modifyFields(stats, {
          kills: () => modifyFields(noKills, { Shambler: () => 4 }),
        }),
    })
    return Story.story(
      APPLICATION,
      Story.given(fighting),
      tick(50),
      Story.Command.expectNone(),
    )
  })

  it.effect(
    'the first grab of a power-up kind writes it, and a second grab writes nothing',
    () =>
      Effect.gen(function* () {
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
                x: focusOf(base).player.x,
                y: focusOf(base).player.y,
                ageMs: 0,
              },
            ],
          })
        const seen = modifyFields(fighting, {
          seenPowerUps: () => ['RapidFire'],
        })
        yield* Story.story(
          APPLICATION,
          Story.given(hotSauceUnder(fighting)),
          tick(FIXED_STEP_MS),
          Story.Command.expectExact(
            WriteSave({
              save: { ...saveOf(fighting), seenPowerUps: ['RapidFire'] },
              changes: [PlayerChange.SawPowerUps({ kinds: ['RapidFire'] })],
            }),
          ),
          writeSave(),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(hotSauceUnder(seen)),
          tick(FIXED_STEP_MS),
          Story.model(current => {
            expect(current.pickups).toEqual([])
            expect(current.callouts[0]?.look).toBe('Named')
          }),
          Story.Command.expectNone(),
        )
      }),
  )

  it.effect('the power-ups seen last across a reload', () => {
    const grabbed = modifyFields(read, {
      seenPowerUps: () => ['Damage', 'Heart'],
      rank: rank => grantedVeteran(rank, 0),
    })
    const json = Option.getOrThrow(encodeSave(saveOf(grabbed)))
    return Story.story(
      APPLICATION,
      Story.given(loadingSave),
      Story.message(Message.CompletedLoadSave({ maybeSave: decodeSave(json) })),
      finishSplash,
      Story.model(current => {
        expect(current.seenPowerUps).toEqual(['Damage', 'Heart'])
      }),
    )
  })

  it.effect('a frame that changes nothing saved writes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(read),
      tick(50),
      Story.Command.expectNone(),
    ),
  )

  it.effect(
    'a frame mid-wave leaves every saved field as it was, so the save is not rebuilt',
    () => {
      const fighting = modifyFields(restoreSave(read, learnedSave), {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      })
      return Story.story(
        APPLICATION,
        Story.given(fighting),
        Story.message(Message.PressedKey({ code: 'KeyD' })),
        tick(FIXED_STEP_MS),
        tick(FIXED_STEP_MS),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(focusOf(current).player.x).not.toBe(focusOf(fighting).player.x)
          expect(
            Array.filter(
              SAVED_FIELDS,
              field => fighting[field] !== current[field],
            ),
          ).toEqual([])
          expect(hasSaveFieldsChanged(fighting, current)).toBe(false)
        }),
      )
    },
  )

  test('the saved fields are all the save reads', () => {
    const played = withKeys(
      modifyFields(restoreSave(read, learnedSave), {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
        stats: stats =>
          modifyFields(stats, {
            kills: () => modifyFields(noKills, { Shambler: () => 4 }),
          }),
        runTally: () => RunTally.Counted({ kills: noKills }),
        panel: () => 'WhatsNew',
        orientation: () => 'Portrait',
      }),
      3,
    )
    const savedFromInitial = Record.fromEntries(
      Array.map(SAVED_FIELDS, field => [field, initialModel[field]]),
    )
    expect(saveOf({ ...played, ...savedFromInitial })).toEqual(
      saveOf(initialModel),
    )
  })

  it.effect('nothing is written before the save has been read', () =>
    Story.story(
      APPLICATION,
      Story.given(loadingSave),
      Story.message(Message.ClickedMuteButton()),
      Story.Command.expectNone(),
    ),
  )
})

describe('reset tutorial', () => {
  const veteranHome: Model = modifyFields(read, {
    lessons: () => Record.map(freshLessons, () => Lesson.Learned({ atMs: 0 })),
    trapHint: () => TrapHint.Seen(),
    introducedKinds: () => ZOMBIE_KIND_ORDER,
    seenPowerUps: () => ['RapidFire', 'Pierce'],
    homeScreenTip: () => 'Dismissed',
    soundSetting: () => 'Muted',
    shakeSetting: () => 'Off',
    appearance: () => learnedSave.appearance,
    bests: () => restoreSave(read, learnedSave).bests,
  })

  it.effect('asks first, then clears the onboarding only and saves', () =>
    Story.story(
      APPLICATION,
      Story.given(veteranHome),
      Story.message(Message.ClickedSettingsButton()),
      showDialog(),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedResetTutorialButton(),
      ),
      Story.Command.expectExact(
        FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID }),
      ),
      Story.Command.resolve(
        FocusTutorialReset,
        ProfileMessage.CompletedFocusTutorialReset(),
      ),
      Story.model(current => {
        expect(current.profile.tutorialReset).toBe('Asking')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedConfirmResetTutorialButton(),
      ),
      Story.Command.expectHas(WriteSave),
      Story.model(current => {
        expect(current.profile.tutorialReset).toBe('Done')
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
      Story.Command.resolve(
        FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID }),
        ProfileMessage.CompletedFocusTutorialReset(),
      ),
      writeSave(),
    ),
  )

  it.effect('keep leaves the tutorial learned and writes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(veteranHome),
      Story.message(Message.ClickedSettingsButton()),
      showDialog(),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedResetTutorialButton(),
      ),
      Story.Command.resolve(
        FocusTutorialReset,
        ProfileMessage.CompletedFocusTutorialReset(),
      ),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedCancelResetTutorialButton(),
      ),
      Story.Command.expectExact(
        FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID }),
      ),
      Story.Command.resolve(
        FocusTutorialReset,
        ProfileMessage.CompletedFocusTutorialReset(),
      ),
      Story.model(current => {
        expect(current.profile.tutorialReset).toBe('Idle')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    ),
  )

  it.effect('confirming without asking first does nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(veteranHome),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedConfirmResetTutorialButton(),
      ),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    ),
  )
})
