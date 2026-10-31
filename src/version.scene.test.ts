import { Option } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { maybeNewestNewsDay, newsHeadline } from './changelog'
import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { fighting, withNewerBuild } from './model.fixture'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  manorButton,
  measureSurface,
  updateChip,
} from './testing'
import { ReloadPage, WaitForUnwrap } from './update/home'
import { RUNNING_BUILD } from './version'
import { pause } from './waves'

const greeting = role('dialog', { name: 'Updated!' })
const newsButton = role('button', { name: "WHAT'S NEW" })
const closeGreeting = role('button', { name: 'Close' })
// NOTE: the build check's answer is a Command's result, which no
// Subscription emits, so a scene starts from the Model it leaves.
const after = (model: Model, message: Message): Model =>
  update(model, message).model

const foundMidWave = after(
  fighting,
  Message.CompletedFetchBuild({ build: 'newer-build' }),
)

const onPhase = (phase: Phase): Model =>
  withNewerBuild(modifyFields(initialModel, { phase: () => phase }))

const breakBetweenWaves = Phase.Preparation({
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

const SCREENS_WITHOUT_THE_CHIP: ReadonlyArray<readonly [string, Model]> = [
  ['the pause screen', withNewerBuild(pause(fighting))],
  ['Game Over', onPhase(Phase.GameOver({ wave: 3 }))],
  [
    'Game Over after the grace',
    modifyFields(onPhase(Phase.GameOver({ wave: 3 })), {
      screenMs: () => RESTART_GRACE_MS,
    }),
  ],
  ['Victory', onPhase(Phase.Victory())],
  ['the break between waves', onPhase(breakBetweenWaves)],
  ['a wave', withNewerBuild(fighting)],
]

describe('the update gift', () => {
  test('shows on the home menu', () => {
    scene(
      ROOT,
      given(withNewerBuild(initialModel)),
      measureSurface,
      expect(updateChip).toExist(),
    )
  })

  test.each(SCREENS_WITHOUT_THE_CHIP)('waits off %s', (_name, quiet) => {
    scene(ROOT, given(quiet), measureSurface, expect(updateChip).toBeAbsent())
  })

  test('shows nothing when the live build is the one running', () => {
    scene(
      ROOT,
      given(initialModel),
      measureSurface,
      expect(updateChip).toBeAbsent(),
    )
  })

  test('a build found mid-wave waits through pause and shows on the home menu', () => {
    scene(
      ROOT,
      given(foundMidWave),
      measureSurface,
      expect(updateChip).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
      expect(updateChip).toBeAbsent(),
      expect(manorButton).toBeAbsent(),
    )
  })

  test('wears a little NEW! tag', () => {
    scene(
      ROOT,
      given(withNewerBuild(initialModel)),
      measureSurface,
      expect(updateChip).toHaveText('NEW!'),
    )
  })

  test('tapping it unwraps the gift, then reloads onto the new build', () => {
    scene(
      ROOT,
      given(withNewerBuild(initialModel)),
      measureSurface,
      click(updateChip),
      expect(updateChip).toHaveAttr('data-state', 'Unwrapping'),
      Command.expectExact(WaitForUnwrap),
      Command.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
      Command.expectExact(ReloadPage({ build: 'newer-build' })),
      Command.resolve(ReloadPage, Message.FailedReloadPage({ reason: 'no' })),
      expect(updateChip).toHaveAttr('data-state', 'Wrapped'),
    )
  })
})

const newestHeadline = Option.match(maybeNewestNewsDay, {
  onNone: () => '',
  onSome: day => newsHeadline(day.bullets[0].text),
})

// NOTE: the update marker is read by a Command at boot, so a scene starts
// from the Model it leaves: the greeting already opening.
const justUpdated = after(
  initialModel,
  Message.CompletedReadUpdateMarker({ maybeBuild: Option.some(RUNNING_BUILD) }),
)

// NOTE: a Dialog that is already open when the page draws takes its
// resources through its Mount.
const acquireGreeting = Mount.resolve(
  Dialog.test.AcquireResources,
  DialogBlock.Message.SucceededAcquireResources(),
)

describe('the greeting after an update', () => {
  test('throws a party with the news when the reload lands on the new build', () => {
    scene(
      ROOT,
      given(justUpdated),
      measureSurface,
      acquireGreeting,
      expect(greeting).toExist(),
      expect(greeting).toContainText(newestHeadline),
      expect(newsButton).toExist(),
      click(closeGreeting),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      expect(greeting).toBeAbsent(),
    )
  })

  test('the news button opens the full news', () => {
    scene(
      ROOT,
      given(justUpdated),
      measureSurface,
      acquireGreeting,
      click(newsButton),
      Command.resolveAll(
        [Dialog.test.CloseDialog, DialogBlock.Message.CompletedCloseDialog()],
        [Dialog.test.ShowDialog, DialogBlock.Message.SucceededShowDialog()],
      ),
      expect(greeting).toBeAbsent(),
      expect(role('dialog', { name: /^What's new/i })).toExist(),
    )
  })

  test('greets nobody on a plain load or a reload that kept the old build', () => {
    scene(
      ROOT,
      given(
        after(
          initialModel,
          Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
        ),
      ),
      measureSurface,
      expect(greeting).toBeAbsent(),
    )
    scene(
      ROOT,
      given(
        after(
          initialModel,
          Message.CompletedReadUpdateMarker({
            maybeBuild: Option.some('an-older-build'),
          }),
        ),
      ),
      measureSurface,
      expect(greeting).toBeAbsent(),
    )
  })
})
