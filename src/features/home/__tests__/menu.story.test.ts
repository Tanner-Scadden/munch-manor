// @vitest-environment happy-dom
import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { DialogBlock } from '@foldkit/ui'

import { PanelDialogBinding } from '../../../app/bindings'
import {
  AwaitFirstFrame,
  DecodeSprites,
  DetectInputDevice,
  DetectLocalPlayers,
  DetectOrientationLock,
  DetectScreenFit,
  DetectShareSheet,
  GenerateSeed,
  GenerateVisitId,
  LoadFonts,
  LoadSave,
  LoadStyles,
  ReadUpdateMarker,
  StartSummaryQueue,
} from '../../../app/boot'
import { Message } from '../../../app/message'
import {
  Loading,
  type Model,
  Phase,
  RunTally,
  noKills,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { returnHome } from '../../../app/runReset'
import { maybeKeyDownMessage } from '../../../app/subscriptions'
import { ReadRoomLink } from '../../../app/update/coop'
import { HideSplash, ShowLoadProgress } from '../../../app/update/save'
import { withBests } from '../../../domain/run'
import { bestsFor } from '../../../screens/home/home'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  home,
  veteranFighting,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  scoring,
  showDialog,
  throughIntro,
} from '../../../test/testing'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { scoreOf } from '../../../world/run/stats'
import { FINAL_WAVE } from '../../../world/waves/wavePlans'
import { pause } from '../../../world/waves/waves'

const withEndlessBest = (base: Model, wave: number): Model =>
  withBests(base, bests =>
    modifyFields(bests, { maybeBestEndlessWave: () => Option.some(wave) }),
  )

const withKills = (base: Model, shamblers: number, runMs: number): Model =>
  modifyFields(base, {
    stats: stats =>
      modifyFields(stats, {
        kills: () => modifyFields(noKills, { Shambler: () => shamblers }),
        runMs: () => runMs,
      }),
  })

const dying = (base: Model): Model =>
  modifyFocus(
    modifyFields(base, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    }),
    { player: player => modifyFields(player, { hp: () => 0 }) },
  )

describe('the bests', () => {
  it.effect('kills count when the run ends, not as they happen', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(withKills(veteranFighting, 3, 0)),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(({ bests, runTally }) => {
          expect(bests.totalKills).toBe(0)
          expect(bests.runsPlayed).toBe(0)
          expect(RunTally.guards.Uncounted(runTally)).toBe(true)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(dying(withKills(veteranFighting, 3, 0))),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(({ phase, bests }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
          expect(bests.totalKills).toBe(3)
          expect(bests.killsByKind.Shambler).toBe(3)
          expect(bests.runsPlayed).toBe(1)
        }),
      )
    }),
  )

  it.effect('a new run starts a fresh tally and keeps the bests', () => {
    const over = modifyFields(withKills(veteranFighting, 7, 0), {
      phase: () => Phase.GameOver({ wave: 3 }),
      screenMs: () => RESTART_GRACE_MS,
      runTally: () =>
        RunTally.Counted({
          kills: modifyFields(noKills, { Shambler: () => 7 }),
        }),
      bests: bests =>
        modifyFields(bests, { totalKills: () => 7, runsPlayed: () => 1 }),
    })
    return Story.story(
      APPLICATION,
      Story.given(over),
      Story.message(Message.ClickedEndlessButton()),
      throughIntro,
      Story.model(({ phase, stats, bests, runTally }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.kills.Shambler).toBe(0)
        expect(bests.totalKills).toBe(7)
        expect(bests.runsPlayed).toBe(1)
        expect(RunTally.guards.Uncounted(runTally)).toBe(true)
      }),
    )
  })

  it.effect('leaving a paused run for the menu counts it', () =>
    Story.story(
      APPLICATION,
      Story.given(pause(withKills(veteranFighting, 5, 0))),
      Story.message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      Story.message(Message.ClickedLeaveRunButton()),
      closeDialog(),
      Story.model(({ phase, bests, runTally }) => {
        expect(Phase.guards.Ready(phase)).toBe(true)
        expect(bests.totalKills).toBe(5)
        expect(bests.killsByKind.Shambler).toBe(5)
        expect(bests.runsPlayed).toBe(1)
        expect(RunTally.guards.Uncounted(runTally)).toBe(true)
      }),
    ),
  )

  it.effect(
    'a win that goes on into endless adds only its new kills when it ends again',
    () => {
      const goneOn = modifyFields(dying(withKills(veteranFighting, 6, 0)), {
        runTally: () =>
          RunTally.Counted({
            kills: modifyFields(noKills, { Shambler: () => 4 }),
          }),
        bests: bests =>
          modifyFields(bests, { totalKills: () => 4, runsPlayed: () => 1 }),
      })
      return Story.story(
        APPLICATION,
        Story.given(goneOn),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(({ bests }) => {
          expect(bests.totalKills).toBe(6)
          expect(bests.killsByKind.Shambler).toBe(2)
          expect(bests.runsPlayed).toBe(1)
        }),
      )
    },
  )

  it.effect(
    'a win records the fastest campaign time and keeps the faster one',
    () =>
      Effect.gen(function* () {
        const winning = (runMs: number): Model =>
          withKills(
            modifyFields(veteranFighting, {
              phase: () =>
                Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 90_000, spawns: [] }),
            }),
            0,
            runMs,
          )
        yield* Story.story(
          APPLICATION,
          Story.given(winning(500_000)),
          Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          Story.model(({ phase, bests }) => {
            expect(Phase.guards.Victory(phase)).toBe(true)
            expect(bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
              Option.some(500_000 + FIXED_STEP_MS),
            )
            expect(bests.runsPlayed).toBe(1)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            withBests(winning(700_000), bests =>
              modifyFields(bests, {
                maybeFastestWinMs: () => Option.some(400_000),
              }),
            ),
          ),
          Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          Story.model(({ bests }) => {
            expect(bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
              Option.some(400_000),
            )
          }),
        )
      }),
  )
})

describe('leaving a run', () => {
  it.effect(
    'H on the pause screen asks first, and closing the question keeps the run paused',
    () =>
      Story.story(
        APPLICATION,
        Story.given(pause(veteranFighting)),
        Story.message(Message.PressedKey({ code: 'KeyH' })),
        showDialog(),
        Story.model(({ panel, panelDialog, phase }) => {
          expect(panel).toBe('LeaveRun')
          expect(panelDialog.isOpen).toBe(true)
          expect(Phase.guards.Paused(phase)).toBe(true)
        }),
        Story.messageIn(
          PanelDialogBinding,
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        Story.model(({ panelDialog, phase }) => {
          expect(panelDialog.isOpen).toBe(false)
          expect(Phase.guards.Paused(phase)).toBe(true)
        }),
      ),
  )

  it.effect(
    'LEAVE tapped as the question fades out after Back keeps the run',
    () =>
      Story.story(
        APPLICATION,
        Story.given(pause(veteranFighting)),
        Story.message(Message.PressedKey({ code: 'KeyH' })),
        showDialog(),
        Story.messageIn(
          PanelDialogBinding,
          DialogBlock.Message.CanceledDialog(),
        ),
        Story.message(Message.ClickedLeaveRunButton()),
        closeDialog(),
        Story.model(({ panel, panelDialog, phase }) => {
          expect(panel).toBe('LeaveRun')
          expect(panelDialog.isOpen).toBe(false)
          expect(Phase.guards.Paused(phase)).toBe(true)
        }),
      ),
  )

  test('Escape on the open question belongs to the dialog, never the game', () => {
    const dialog = document.createElement('dialog')
    const stay = document.createElement('button')
    dialog.append(stay)
    expect(
      maybeKeyDownMessage({ code: 'Escape', repeat: false, target: stay }),
    ).toEqual(Option.none())
  })

  it.effect('H does nothing mid-wave, and Game Over waits out the grace', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(veteranFighting),
        Story.message(Message.PressedKey({ code: 'KeyH' })),
        Story.model(({ phase, panelDialog }) => {
          expect(Phase.guards.Wave(phase)).toBe(true)
          expect(panelDialog.isOpen).toBe(false)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(home, { phase: () => Phase.GameOver({ wave: 3 }) }),
        ),
        Story.message(Message.PressedKey({ code: 'KeyH' })),
        Story.model(({ phase }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
        }),
      )
    }),
  )

  test('going home clears the room but keeps the look, the settings, and the bests', () => {
    const messy = modifyFields(withEndlessBest(veteranFighting, 11), {
      stats: scoring(900),
      soundSetting: () => 'Muted',
      shakeSetting: () => 'Off',
      appearance: appearance =>
        modifyFields(appearance, { hairColor: () => 'Pink' }),
    })
    const cleared = returnHome(messy)
    expect(Phase.guards.Ready(cleared.phase)).toBe(true)
    expect(scoreOf(cleared.stats)).toBe(0)
    expect(cleared.zombies).toEqual([])
    expect(focusOf(cleared).player).toEqual(focusOf(initialModel).player)
    expect(cleared.soundSetting).toBe('Muted')
    expect(cleared.shakeSetting).toBe('Off')
    expect(bestsFor(cleared).maybeBestEndlessWave).toEqual(Option.some(11))
    expect(cleared.appearance.hairColor).toBe('Pink')
  })
})

describe('the loading splash', () => {
  const resolveProgress = (loaded: number) =>
    Story.Command.resolve(
      ShowLoadProgress({ loaded, total: 5 }),
      Message.CompletedShowLoadProgress(),
    )

  // NOTE: the boot's Commands that are not load steps, answered as a
  // desktop with one player, no share sheet, and no update waiting.
  const answerDeviceChecks = Story.steps(
    Story.Command.resolve(
      GenerateSeed(),
      Message.CompletedGenerateSeed({ seed: 1 }),
    ),
    Story.Command.resolve(
      GenerateVisitId(),
      Message.CompletedGenerateVisitId({ visitId: 'visit' }),
    ),
    Story.Command.resolve(
      StartSummaryQueue(),
      Message.CompletedStartSummaryQueue(),
    ),
    Story.Command.resolve(
      DetectInputDevice(),
      Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
    ),
    Story.Command.resolve(
      DetectShareSheet(),
      Message.CompletedDetectShareSheet({ shareSheet: 'Unavailable' }),
    ),
    Story.Command.resolve(
      DetectScreenFit(),
      Message.CompletedDetectScreenFit({ screenFit: 'Unknown' }),
    ),
    Story.Command.resolve(
      DetectOrientationLock(),
      Message.CompletedDetectOrientationLock({
        orientationLock: 'Unsupported',
      }),
    ),
    Story.Command.resolve(
      DetectLocalPlayers(),
      Message.CompletedDetectLocalPlayers({ count: 1 }),
    ),
    Story.Command.resolve(
      ReadUpdateMarker(),
      Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
    ),
  )

  it.effect(
    'waits for the save, the styles, the fonts, the first frame, and the sprites, shows progress, then hides once',
    () =>
      Story.story(
        APPLICATION,
        Story.init(),
        Story.model(({ loading }) => {
          expect(loading).toEqual(
            Loading.Loading({
              pending: ['Save', 'Styles', 'Fonts', 'FirstFrame', 'Sprites'],
            }),
          )
        }),
        // NOTE: init asks for every load step.
        Story.Command.expectHas(
          LoadSave(),
          LoadStyles(),
          LoadFonts(),
          AwaitFirstFrame(),
          DecodeSprites(),
        ),
        answerDeviceChecks,
        Story.Command.resolve(LoadStyles(), Message.CompletedLoadStyles()),
        Story.Command.expectExact(
          ShowLoadProgress({ loaded: 1, total: 5 }),
          LoadSave(),
          LoadFonts(),
          AwaitFirstFrame(),
          DecodeSprites(),
        ),
        resolveProgress(1),
        Story.Command.resolve(LoadFonts(), Message.CompletedLoadFonts()),
        Story.Command.expectExact(
          ShowLoadProgress({ loaded: 2, total: 5 }),
          LoadSave(),
          AwaitFirstFrame(),
          DecodeSprites(),
        ),
        resolveProgress(2),
        Story.model(({ loading }) => {
          expect(loading).toEqual(
            Loading.Loading({ pending: ['Save', 'FirstFrame', 'Sprites'] }),
          )
        }),
        Story.Command.resolve(
          AwaitFirstFrame(),
          Message.CompletedAwaitFirstFrame(),
        ),
        Story.Command.expectExact(
          ShowLoadProgress({ loaded: 3, total: 5 }),
          LoadSave(),
          DecodeSprites(),
        ),
        resolveProgress(3),
        Story.Command.resolve(
          DecodeSprites(),
          Message.CompletedDecodeSprites(),
        ),
        Story.Command.expectExact(
          ShowLoadProgress({ loaded: 4, total: 5 }),
          LoadSave(),
        ),
        resolveProgress(4),
        Story.model(({ loading }) => {
          expect(loading).toEqual(Loading.Loading({ pending: ['Save'] }))
        }),
        Story.Command.resolve(
          LoadSave(),
          Message.CompletedLoadSave({ maybeSave: Option.none() }),
        ),
        // NOTE: the bar fills before the splash goes.
        Story.Command.expectExactInOrder(
          ShowLoadProgress({ loaded: 5, total: 5 }),
          HideSplash(),
        ),
        resolveProgress(5),
        Story.Command.resolve(HideSplash(), Message.CompletedHideSplash()),
        Story.Command.resolve(
          ReadRoomLink,
          Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
        ),
        Story.model(({ loading }) => {
          expect(loading).toEqual(Loading.Loaded())
        }),
        Story.message(Message.CompletedAwaitFirstFrame()),
        Story.Command.expectNone(),
      ),
  )

  it.effect('a font that fails to load still lets the game in', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, {
          loading: () => Loading.Loading({ pending: ['Fonts'] }),
        }),
      ),
      Story.message(Message.FailedLoadFonts({ reason: 'offline' })),
      Story.Command.expectExactInOrder(
        ShowLoadProgress({ loaded: 5, total: 5 }),
        HideSplash(),
      ),
      resolveProgress(5),
      Story.Command.resolve(HideSplash(), Message.CompletedHideSplash()),
      Story.Command.resolve(
        ReadRoomLink,
        Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
      ),
    ),
  )
})
