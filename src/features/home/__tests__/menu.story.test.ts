// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it, test } from '@effect/vitest'

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
  ReadRecordUnlock,
  ReadUpdateMarker,
  StartRecordingQueue,
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
import { ReadBeatLink } from '../../../app/update/beatMyRun'
import { ReadRoomLink } from '../../../app/update/coop'
import { HideSplash, ShowLoadProgress } from '../../../app/update/save'
import { withBests } from '../../../domain/run'
import { LoadMessage } from '../../../platform/message'
import { bestsFor } from '../../../screens/home/home'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  escaping,
  home,
  veteranFighting,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  type StoryStep,
  checkModel,
  scoring,
  send,
  storyOf,
  throughIntro,
} from '../../../test/testing'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { scoreOf } from '../../../world/run/stats'
import { FINAL_WAVE } from '../../../world/waves/wavePlans'
import { pause } from '../../../world/waves/waves'

const withEndlessBest = (base: Model, wave: number): Model =>
  withBests(base, bests =>
    UiStruct.evolve(bests, { maybeBestEndlessWave: () => Option.some(wave) }),
  )

const withKills = (base: Model, shamblers: number, runMs: number): Model =>
  UiStruct.evolve(base, {
    stats: stats =>
      UiStruct.evolve(stats, {
        kills: () => UiStruct.evolve(noKills, { Shambler: () => shamblers }),
        runMs: () => runMs,
      }),
  })

const dying = (base: Model): Model =>
  modifyFocus(
    UiStruct.evolve(base, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    }),
    { player: player => UiStruct.evolve(player, { hp: () => 0 }) },
  )

describe('the bests', () => {
  it.effect('kills count when the run ends, not as they happen', () =>
    Effect.gen(function* () {
      const s1 = yield* storyOf(withKills(veteranFighting, 3, 0))
      s1.pipe(
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        checkModel(({ bests, runGains: { runTally } }) => {
          expect(bests.totalKills).toBe(0)
          expect(bests.runsPlayed).toBe(0)
          expect(RunTally.guards.Uncounted(runTally)).toBe(true)
        }),
      )
      const s2 = yield* storyOf(dying(withKills(veteranFighting, 3, 0)))
      s2.pipe(
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        checkModel(({ phase, bests }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
          expect(bests.totalKills).toBe(3)
          expect(bests.killsByKind.Shambler).toBe(3)
          expect(bests.runsPlayed).toBe(1)
        }),
      )
    }),
  )

  it.effect('a new run starts a fresh tally and keeps the bests', () => {
    const over = UiStruct.evolve(withKills(veteranFighting, 7, 0), {
      phase: () => Phase.GameOver({ wave: 3 }),
      screenMs: () => RESTART_GRACE_MS,
      bests: bests =>
        UiStruct.evolve(bests, { totalKills: () => 7, runsPlayed: () => 1 }),
      runGains: UiStruct.evolve({
        runTally: () =>
          RunTally.Counted({
            kills: UiStruct.evolve(noKills, { Shambler: () => 7 }),
          }),
      }),
    })
    return Effect.gen(function* () {
      const s = yield* storyOf(over)
      s.pipe(
        send(Message.ClickedEndlessButton()),
        throughIntro,
        checkModel(({ phase, stats, bests, runGains: { runTally } }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
          expect(stats.kills.Shambler).toBe(0)
          expect(bests.totalKills).toBe(7)
          expect(bests.runsPlayed).toBe(1)
          expect(RunTally.guards.Uncounted(runTally)).toBe(true)
        }),
      )
    })
  })

  it.effect('leaving a paused run for the menu counts it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(pause(withKills(veteranFighting, 5, 0)))
      s.pipe(
        send(Message.PressedKey({ code: 'KeyH' })),
        send(Message.ClickedLeaveRunButton()),
        checkModel(({ phase, bests, runGains: { runTally } }) => {
          expect(Phase.guards.Ready(phase)).toBe(true)
          expect(bests.totalKills).toBe(5)
          expect(bests.killsByKind.Shambler).toBe(5)
          expect(bests.runsPlayed).toBe(1)
          expect(RunTally.guards.Uncounted(runTally)).toBe(true)
        }),
      )
    }),
  )

  it.effect(
    'a win that goes on into endless adds only its new kills when it ends again',
    () => {
      const goneOn = UiStruct.evolve(dying(withKills(veteranFighting, 6, 0)), {
        bests: bests =>
          UiStruct.evolve(bests, { totalKills: () => 4, runsPlayed: () => 1 }),
        runGains: UiStruct.evolve({
          runTally: () =>
            RunTally.Counted({
              kills: UiStruct.evolve(noKills, { Shambler: () => 4 }),
            }),
        }),
      })
      return Effect.gen(function* () {
        const s = yield* storyOf(goneOn)
        s.pipe(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(({ bests }) => {
            expect(bests.totalKills).toBe(6)
            expect(bests.killsByKind.Shambler).toBe(2)
            expect(bests.runsPlayed).toBe(1)
          }),
        )
      })
    },
  )

  it.effect(
    'an escape records the fastest escape and keeps the faster one',
    () =>
      Effect.gen(function* () {
        const winning = (runMs: number): Model =>
          withKills(
            escaping(
              UiStruct.evolve(veteranFighting, {
                phase: () =>
                  Phase.Wave({
                    wave: FINAL_WAVE,
                    elapsedMs: 90_000,
                    spawns: [DISTANT_SPAWN],
                  }),
              }),
            ),
            0,
            runMs,
          )
        const s3 = yield* storyOf(winning(500_000))
        s3.pipe(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(({ phase, bests }) => {
            expect(Phase.guards.Escaped(phase)).toBe(true)
            expect(bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
              Option.some(500_000 + FIXED_STEP_MS),
            )
            expect(bests.runsPlayed).toBe(1)
          }),
        )
        const s4 = yield* storyOf(
          withBests(winning(700_000), bests =>
            UiStruct.evolve(bests, {
              maybeFastestWinMs: () => Option.some(400_000),
            }),
          ),
        )
        s4.pipe(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(({ bests }) => {
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
      Effect.gen(function* () {
        const s = yield* storyOf(pause(veteranFighting))
        s.pipe(
          send(Message.PressedKey({ code: 'KeyH' })),
          checkModel(({ panel, panelDialog, phase }) => {
            expect(panel).toBe('LeaveRun')
            expect(panelDialog.isOpen).toBe(true)
            expect(Phase.guards.Paused(phase)).toBe(true)
          }),
          send(Message.ClosedDialog({ dialog: 'Panel' })),
          checkModel(({ panelDialog, phase }) => {
            expect(panelDialog.isOpen).toBe(false)
            expect(Phase.guards.Paused(phase)).toBe(true)
          }),
        )
      }),
  )

  it.effect(
    'LEAVE tapped as the question fades out after Back keeps the run',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(pause(veteranFighting))
        s.pipe(
          send(Message.PressedKey({ code: 'KeyH' })),
          send(Message.ClosedDialog({ dialog: 'Panel' })),
          send(Message.ClickedLeaveRunButton()),
          checkModel(({ panel, panelDialog, phase }) => {
            expect(panel).toBe('LeaveRun')
            expect(panelDialog.isOpen).toBe(false)
            expect(Phase.guards.Paused(phase)).toBe(true)
          }),
        )
      }),
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
      const s5 = yield* storyOf(veteranFighting)
      s5.pipe(
        send(Message.PressedKey({ code: 'KeyH' })),
        checkModel(({ phase, panelDialog }) => {
          expect(Phase.guards.Wave(phase)).toBe(true)
          expect(panelDialog.isOpen).toBe(false)
        }),
      )
      const s6 = yield* storyOf(
        UiStruct.evolve(home, { phase: () => Phase.GameOver({ wave: 3 }) }),
      )
      s6.pipe(
        send(Message.PressedKey({ code: 'KeyH' })),
        checkModel(({ phase }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
        }),
      )
    }),
  )

  test('going home clears the room but keeps the look, the settings, and the bests', () => {
    const messy = UiStruct.evolve(withEndlessBest(veteranFighting, 11), {
      stats: scoring(900),
      appearance: appearance =>
        UiStruct.evolve(appearance, { hairColor: () => 'Pink' }),
      settings: UiStruct.evolve({
        soundSetting: () => 'Muted',
        shakeSetting: () => 'Off',
      }),
    })
    const cleared = returnHome(messy)
    expect(Phase.guards.Ready(cleared.phase)).toBe(true)
    expect(scoreOf(cleared.stats)).toBe(0)
    expect(cleared.zombies).toEqual([])
    expect(focusOf(cleared).player).toEqual(focusOf(initialModel).player)
    expect(cleared.settings.soundSetting).toBe('Muted')
    expect(cleared.settings.shakeSetting).toBe('Off')
    expect(bestsFor(cleared).maybeBestEndlessWave).toEqual(Option.some(11))
    expect(cleared.appearance.hairColor).toBe('Pink')
  })
})

describe('the loading splash', () => {
  const resolveProgress =
    (loaded: number): StoryStep =>
    s =>
      s.resolve(ShowLoadProgress.make({ loaded, total: 5 }), Component.noop)

  // NOTE: the splash hidden, and no room link or SHARE link waiting.
  const resolveSplashEnd: StoryStep = s =>
    s
      .resolve(HideSplash, LoadMessage.CompletedHideSplash())
      .resolve(
        ReadRoomLink,
        Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
      )
      .resolve(
        ReadBeatLink,
        Message.CompletedReadBeatLink({ maybeDare: Option.none() }),
      )

  // NOTE: the boot's Commands that are not load steps, answered as a
  // desktop with one player, no share sheet, and no update waiting.
  const answerDeviceChecks: StoryStep = s =>
    s
      .resolve(GenerateSeed, Message.CompletedGenerateSeed({ seed: 1 }))
      .resolve(
        GenerateVisitId,
        Message.CompletedGenerateVisitId({ visitId: 'visit' }),
      )
      .resolve(StartSummaryQueue, Component.noop)
      .resolve(
        ReadRecordUnlock,
        Message.CompletedReadRecordUnlock({ unlock: 'Locked' }),
      )
      .resolve(StartRecordingQueue, Component.noop)
      .resolve(
        DetectInputDevice,
        Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
      )
      .resolve(
        DetectShareSheet,
        Message.CompletedDetectShareSheet({ shareSheet: 'Unavailable' }),
      )
      .resolve(
        DetectScreenFit,
        Message.CompletedDetectScreenFit({ screenFit: 'Unknown' }),
      )
      .resolve(
        DetectOrientationLock,
        Message.CompletedDetectOrientationLock({
          orientationLock: 'Unsupported',
        }),
      )
      .resolve(
        DetectLocalPlayers,
        Message.CompletedDetectLocalPlayers({ count: 1 }),
      )
      .resolve(
        ReadUpdateMarker,
        Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
      )

  it.effect(
    'waits for the save, the styles, the fonts, the first frame, and the sprites, shows progress, then hides once',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(APPLICATION, {})
        s.pipe(
          checkModel(({ saving: { loading } }) => {
            expect(loading).toEqual(
              Loading.Loading({
                pending: ['Save', 'Styles', 'Fonts', 'FirstFrame', 'Sprites'],
              }),
            )
          }),
          // NOTE: init asks for every load step.
          t =>
            t
              .expectHas(LoadSave)
              .expectHas(LoadStyles)
              .expectHas(LoadFonts)
              .expectHas(AwaitFirstFrame)
              .expectHas(DecodeSprites),
          answerDeviceChecks,
          t =>
            t
              .resolve(LoadStyles, Message.CompletedLoadStyles())
              .expectExact(
                LoadSave,
                LoadFonts,
                AwaitFirstFrame,
                DecodeSprites,
                ShowLoadProgress.make({ loaded: 1, total: 5 }),
              ),
          resolveProgress(1),
          t =>
            t
              .resolve(LoadFonts, Message.CompletedLoadFonts())
              .expectExact(
                LoadSave,
                AwaitFirstFrame,
                DecodeSprites,
                ShowLoadProgress.make({ loaded: 2, total: 5 }),
              ),
          resolveProgress(2),
          checkModel(({ saving: { loading } }) => {
            expect(loading).toEqual(
              Loading.Loading({ pending: ['Save', 'FirstFrame', 'Sprites'] }),
            )
          }),
          t =>
            t
              .resolve(AwaitFirstFrame, Message.CompletedAwaitFirstFrame())
              .expectExact(
                LoadSave,
                DecodeSprites,
                ShowLoadProgress.make({ loaded: 3, total: 5 }),
              ),
          resolveProgress(3),
          t =>
            t
              .resolve(DecodeSprites, Message.CompletedDecodeSprites())
              .expectExact(
                LoadSave,
                ShowLoadProgress.make({ loaded: 4, total: 5 }),
              ),
          resolveProgress(4),
          checkModel(({ saving: { loading } }) => {
            expect(loading).toEqual(Loading.Loading({ pending: ['Save'] }))
          }),
          // NOTE: the bar fills before the splash goes.
          t =>
            t
              .resolve(
                LoadSave,
                Message.CompletedLoadSave({ maybeSave: Option.none() }),
              )
              .expectExact(
                ShowLoadProgress.make({ loaded: 5, total: 5 }),
                HideSplash,
              ),
          resolveProgress(5),
          resolveSplashEnd,
          checkModel(({ saving: { loading } }) => {
            expect(loading).toEqual(Loading.Loaded())
          }),
          send(Message.CompletedAwaitFirstFrame()),
          t => t.expectNone(),
        )
      }),
  )

  it.effect('a font that fails to load still lets the game in', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(initialModel, {
          saving: UiStruct.evolve({
            loading: () => Loading.Loading({ pending: ['Fonts'] }),
          }),
        }),
      )
      s.pipe(
        send(Message.FailedLoadFonts({ reason: 'offline' })),
        t =>
          t.expectExact(
            ShowLoadProgress.make({ loaded: 5, total: 5 }),
            HideSplash,
          ),
        resolveProgress(5),
        resolveSplashEnd,
      )
    }),
  )
})
