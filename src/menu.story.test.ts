// @vitest-environment happy-dom
import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import {
  AwaitFirstFrame,
  DecodeSprites,
  LoadFonts,
  LoadSave,
  LoadStyles,
} from './boot'
import { PanelDialogBinding } from './composition'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from './constants'
import { bestsFor, withBests } from './difficulty'
import { returnHome } from './home'
import { init, update } from './main'
import { Message } from './message'
import {
  Loading,
  type Model,
  Phase,
  RunTally,
  initialModel,
  noKills,
} from './model'
import { DISTANT_SPAWN, home, veteranFighting } from './model.fixture'
import { scoreOf } from './stats'
import { maybeKeyDownMessage } from './subscriptions'
import { scoring, showDialog } from './testing'
import { ReadRoomLink } from './update/coop'
import { HideSplash, ShowLoadProgress } from './update/save'
import { FINAL_WAVE } from './wavePlans'
import { pause } from './waves'

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
  modifyFields(base, {
    phase: () =>
      Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    player: player => modifyFields(player, { hp: () => 0 }),
  })

describe('the bests', () => {
  test('kills count when the run ends, not as they happen', () => {
    story(
      update,
      given(withKills(veteranFighting, 3, 0)),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(({ bests, runTally }) => {
        expect(bests.totalKills).toBe(0)
        expect(bests.runsPlayed).toBe(0)
        expect(RunTally.guards.Uncounted(runTally)).toBe(true)
      }),
    )
    story(
      update,
      given(dying(withKills(veteranFighting, 3, 0))),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(({ phase, bests }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
        expect(bests.totalKills).toBe(3)
        expect(bests.killsByKind.Shambler).toBe(3)
        expect(bests.runsPlayed).toBe(1)
      }),
    )
  })

  test('a new run starts a fresh tally and keeps the bests', () => {
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
    story(
      update,
      given(over),
      message(Message.ClickedEndlessButton()),
      model(({ phase, stats, bests, runTally }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.kills.Shambler).toBe(0)
        expect(bests.totalKills).toBe(7)
        expect(bests.runsPlayed).toBe(1)
        expect(RunTally.guards.Uncounted(runTally)).toBe(true)
      }),
    )
  })

  test('leaving a paused run for the menu counts it', () => {
    story(
      update,
      given(pause(withKills(veteranFighting, 5, 0))),
      message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      message(Message.ClickedLeaveRunButton()),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(({ phase, bests, runTally }) => {
        expect(Phase.guards.Ready(phase)).toBe(true)
        expect(bests.totalKills).toBe(5)
        expect(bests.killsByKind.Shambler).toBe(5)
        expect(bests.runsPlayed).toBe(1)
        expect(RunTally.guards.Uncounted(runTally)).toBe(true)
      }),
    )
  })

  test('a win that goes on into endless adds only its new kills when it ends again', () => {
    const goneOn = modifyFields(dying(withKills(veteranFighting, 6, 0)), {
      runTally: () =>
        RunTally.Counted({
          kills: modifyFields(noKills, { Shambler: () => 4 }),
        }),
      bests: bests =>
        modifyFields(bests, { totalKills: () => 4, runsPlayed: () => 1 }),
    })
    story(
      update,
      given(goneOn),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(({ bests }) => {
        expect(bests.totalKills).toBe(6)
        expect(bests.killsByKind.Shambler).toBe(2)
        expect(bests.runsPlayed).toBe(1)
      }),
    )
  })

  test('a win records the fastest campaign time and keeps the faster one', () => {
    const winning = (runMs: number): Model =>
      withKills(
        modifyFields(veteranFighting, {
          phase: () =>
            Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 90_000, spawns: [] }),
        }),
        0,
        runMs,
      )
    story(
      update,
      given(winning(500_000)),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(({ phase, bests }) => {
        expect(Phase.guards.Victory(phase)).toBe(true)
        expect(bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.some(500_000 + FIXED_STEP_MS),
        )
        expect(bests.runsPlayed).toBe(1)
      }),
    )
    story(
      update,
      given(
        withBests(winning(700_000), bests =>
          modifyFields(bests, {
            maybeFastestWinMs: () => Option.some(400_000),
          }),
        ),
      ),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(({ bests }) => {
        expect(bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.some(400_000),
        )
      }),
    )
  })
})

describe('leaving a run', () => {
  test('H on the pause screen asks first, and closing the question keeps the run paused', () => {
    story(
      update,
      given(pause(veteranFighting)),
      message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      model(({ panel, panelDialog, phase }) => {
        expect(panel).toBe('LeaveRun')
        expect(panelDialog.isOpen).toBe(true)
        expect(Phase.guards.Paused(phase)).toBe(true)
      }),
      message(
        toParentMessage(
          PanelDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(({ panelDialog, phase }) => {
        expect(panelDialog.isOpen).toBe(false)
        expect(Phase.guards.Paused(phase)).toBe(true)
      }),
    )
  })

  test('LEAVE tapped as the question fades out after Back keeps the run', () => {
    story(
      update,
      given(pause(veteranFighting)),
      message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      message(
        toParentMessage(
          PanelDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      message(Message.ClickedLeaveRunButton()),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(({ panel, panelDialog, phase }) => {
        expect(panel).toBe('LeaveRun')
        expect(panelDialog.isOpen).toBe(false)
        expect(Phase.guards.Paused(phase)).toBe(true)
      }),
    )
  })

  test('Escape on the open question belongs to the dialog, never the game', () => {
    const dialog = document.createElement('dialog')
    const stay = document.createElement('button')
    dialog.append(stay)
    expect(
      maybeKeyDownMessage({ code: 'Escape', repeat: false, target: stay }),
    ).toEqual(Option.none())
  })

  test('H does nothing mid-wave, and Game Over waits out the grace', () => {
    story(
      update,
      given(veteranFighting),
      message(Message.PressedKey({ code: 'KeyH' })),
      model(({ phase, panelDialog }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
        expect(panelDialog.isOpen).toBe(false)
      }),
    )
    story(
      update,
      given(modifyFields(home, { phase: () => Phase.GameOver({ wave: 3 }) })),
      message(Message.PressedKey({ code: 'KeyH' })),
      model(({ phase }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
      }),
    )
  })

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
    expect(cleared.player).toEqual(initialModel.player)
    expect(cleared.soundSetting).toBe('Muted')
    expect(cleared.shakeSetting).toBe('Off')
    expect(bestsFor(cleared).maybeBestEndlessWave).toEqual(Option.some(11))
    expect(cleared.appearance.hairColor).toBe('Pink')
  })
})

describe('the loading splash', () => {
  const resolveProgress = (loaded: number) =>
    Command.resolve(
      ShowLoadProgress({ loaded, total: 5 }),
      Message.CompletedShowLoadProgress(),
    )

  test('waits for the save, the styles, the fonts, the first frame, and the sprites, shows progress, then hides once', () => {
    const init_ = init()
    expect(init_.model.loading).toEqual(
      Loading.Loading({
        pending: ['Save', 'Styles', 'Fonts', 'FirstFrame', 'Sprites'],
      }),
    )
    story(
      update,
      given(init_.model),
      message(Message.CompletedLoadStyles()),
      Command.expectExact(ShowLoadProgress({ loaded: 1, total: 5 })),
      resolveProgress(1),
      message(Message.CompletedLoadFonts()),
      Command.expectExact(ShowLoadProgress({ loaded: 2, total: 5 })),
      resolveProgress(2),
      model(({ loading }) => {
        expect(loading).toEqual(
          Loading.Loading({ pending: ['Save', 'FirstFrame', 'Sprites'] }),
        )
      }),
      message(Message.CompletedAwaitFirstFrame()),
      Command.expectExact(ShowLoadProgress({ loaded: 3, total: 5 })),
      resolveProgress(3),
      message(Message.CompletedDecodeSprites()),
      Command.expectExact(ShowLoadProgress({ loaded: 4, total: 5 })),
      resolveProgress(4),
      model(({ loading }) => {
        expect(loading).toEqual(Loading.Loading({ pending: ['Save'] }))
      }),
      message(Message.CompletedLoadSave({ maybeSave: Option.none() })),
      Command.expectExact(
        ShowLoadProgress({ loaded: 5, total: 5 }),
        HideSplash(),
      ),
      resolveProgress(5),
      Command.resolve(HideSplash(), Message.CompletedHideSplash()),
      Command.resolve(
        ReadRoomLink,
        Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
      ),
      model(({ loading }) => {
        expect(loading).toEqual(Loading.Loaded())
      }),
      message(Message.CompletedAwaitFirstFrame()),
      Command.expectNone(),
    )
  })

  test('a font that fails to load still lets the game in', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          loading: () => Loading.Loading({ pending: ['Fonts'] }),
        }),
      ),
      message(Message.FailedLoadFonts({ reason: 'offline' })),
      Command.expectExact(
        ShowLoadProgress({ loaded: 5, total: 5 }),
        HideSplash(),
      ),
      resolveProgress(5),
      Command.resolve(HideSplash(), Message.CompletedHideSplash()),
      Command.resolve(
        ReadRoomLink,
        Message.CompletedReadRoomLink({ maybeCode: Option.none() }),
      ),
    )
  })

  test('init asks for every load step', () => {
    const names = Array.map(init().commands ?? [], command => command.name)
    expect(names).toEqual(
      expect.arrayContaining([
        LoadSave().name,
        LoadStyles().name,
        LoadFonts().name,
        AwaitFirstFrame().name,
        DecodeSprites().name,
      ]),
    )
  })
})
