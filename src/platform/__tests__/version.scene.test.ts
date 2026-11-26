import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model, Phase } from '#app/model.ts'
import { PressGameSurface } from '#app/mount.ts'
import { initialModel } from '#app/pureApp.ts'
import { ReloadPage, WaitForUnwrap } from '#app/update/home.ts'
import { PANEL_DIALOG_ID, UPDATE_GREETING_ID } from '#domain/clientSchema.ts'
import {
  maybeNewestNewsDay,
  newsHeadline,
} from '#features/whatsNew/changelog.ts'
import { RUNNING_BUILD } from '#platform/version.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import { WAVE_3_BREAK, fighting, withNewerBuild } from '#test/model.fixture.ts'
import {
  emitPressedKey,
  expectAttr,
  manorButton,
  measureHud,
  measureSurface,
  requestDialogClose,
  showDialog,
  updateChip,
} from '#test/sceneTesting.ts'
import {
  type SceneStep,
  isPausedPhase,
  modelAfter,
  sceneOf,
  send,
  steps,
} from '#test/testing.ts'
import { pause } from '#world/waves/waves.ts'

const greeting = HtmlLocator.role('dialog', { name: 'Updated!' })
const newsButton = HtmlLocator.role('button', { name: "WHAT'S NEW" })
const foundMidWave = modelAfter(
  fighting,
  send(Message.CompletedFetchBuild({ build: 'newer-build' })),
)

const onPhase = (phase: Phase): Model =>
  withNewerBuild(UiStruct.evolve(initialModel, { phase: () => phase }))

const SCREENS_WITHOUT_THE_CHIP: ReadonlyArray<readonly [string, Model]> = [
  ['the pause screen', withNewerBuild(pause(fighting))],
  ['Game Over', onPhase(Phase.GameOver({ wave: 3 }))],
  [
    'Game Over after the grace',
    UiStruct.evolve(onPhase(Phase.GameOver({ wave: 3 })), {
      screenMs: () => RESTART_GRACE_MS,
    }),
  ],
  ['Victory', onPhase(Phase.Escaped({ wave: 10 }))],
  ['the break between waves', onPhase(WAVE_3_BREAK)],
  ['a wave', withNewerBuild(fighting)],
]

const settleOn = (model: Model): SceneStep =>
  isPausedPhase(model)
    ? s => measureHud(s).expectMount(PressGameSurface())
    : measureHud

describe('the update gift', () => {
  it.effect('shows on the home menu', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withNewerBuild(initialModel))
      s.pipe(measureHud).expect(updateChip).toExist()
    }),
  )

  it.effect.each(SCREENS_WITHOUT_THE_CHIP)('waits off %s', ([, quiet]) =>
    Effect.gen(function* () {
      const s = yield* sceneOf(quiet)
      s.pipe(settleOn(quiet)).expect(updateChip).toBeAbsent()
    }),
  )

  it.effect('shows nothing when the live build is the one running', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(initialModel)
      s.pipe(measureHud).expect(updateChip).toBeAbsent()
    }),
  )

  it.effect(
    'a build found mid-wave waits through pause and shows on the home menu',
    () =>
      Effect.gen(function* () {
        const found = yield* foundMidWave
        const s = yield* sceneOf(found)
        s.pipe(measureHud).expect(updateChip).toBeAbsent()
        s.pipe(emitPressedKey('Escape'), sc =>
          sc.expectMount(PressGameSurface()),
        )
          .expect(updateChip)
          .toBeAbsent()
          .expect(manorButton)
          .toBeAbsent()
      }),
  )

  it.effect('wears a little NEW! tag', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withNewerBuild(initialModel))
      s.pipe(measureHud).expect(updateChip).toHaveText('NEW!')
    }),
  )

  it.effect(
    'tapping it unwraps the gift, then reloads onto the new build',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withNewerBuild(initialModel))
        s.pipe(
          measureSurface,
          sc => sc.click(updateChip),
          expectAttr(updateChip, 'data-state', 'Unwrapping'),
        )
          .expectExact(WaitForUnwrap.make())
          .resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap())
          .expectExact(ReloadPage.make({ build: 'newer-build' }))
          .resolve(ReloadPage, Message.FailedReloadPage({ reason: 'no' }))
          .pipe(expectAttr(updateChip, 'data-state', 'Wrapped'))
      }),
  )
})

const newestHeadline = Option.match(maybeNewestNewsDay, {
  onNone: () => '',
  onSome: day => newsHeadline(day.bullets[0].text),
})

const afterMarker = (maybeBuild: Option.Option<string>) =>
  modelAfter(
    initialModel,
    send(Message.CompletedReadUpdateMarker({ maybeBuild })),
  )

const justUpdated = modelAfter(
  initialModel,
  steps(
    send(
      Message.CompletedReadUpdateMarker({
        maybeBuild: Option.some(RUNNING_BUILD),
      }),
    ),
  ),
)

describe('the greeting after an update', () => {
  it.effect(
    'throws a party with the news when the reload lands on the new build',
    () =>
      Effect.gen(function* () {
        const updated = yield* justUpdated
        const s = yield* sceneOf(updated)
        s.pipe(measureSurface, showDialog(UPDATE_GREETING_ID))
          .expect(greeting)
          .toExist()
          .check(() => {
            expect(Locator.textOf(s.get(greeting))).toContain(newestHeadline)
          })
          .expect(newsButton)
          .toExist()
          .pipe(requestDialogClose(UPDATE_GREETING_ID, 'close-press'))
          .expect(greeting)
          .toBeAbsent()
      }),
  )

  it.effect('the news button opens the full news', () =>
    Effect.gen(function* () {
      const updated = yield* justUpdated
      const s = yield* sceneOf(updated)
      s.pipe(measureSurface, showDialog(UPDATE_GREETING_ID))
        .click(newsButton)
        .pipe(
          requestDialogClose(UPDATE_GREETING_ID, 'close-press'),
          showDialog(PANEL_DIALOG_ID),
        )
        .expect(greeting)
        .toBeAbsent()
        .expect(HtmlLocator.role('dialog', { name: /^What's new/i }))
        .toExist()
    }),
  )

  it.effect(
    'greets nobody on a plain load or a reload that kept the old build',
    () =>
      Effect.forEach(
        [Option.none(), Option.some('an-older-build')],
        maybeBuild =>
          Effect.gen(function* () {
            const loaded = yield* afterMarker(maybeBuild)
            const s = yield* sceneOf(loaded)
            s.pipe(measureHud).expect(greeting).toBeAbsent()
          }),
      ),
  )
})
