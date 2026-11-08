import { Effect, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { ReloadPage, WaitForUnwrap } from '../../features/home/update'
import {
  maybeNewestNewsDay,
  newsHeadline,
} from '../../features/whatsNew/changelog'
import { RESTART_GRACE_MS } from '../../shared/constants'
import {
  WAVE_3_BREAK,
  fighting,
  withNewerBuild,
} from '../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  closeButton,
  manorButton,
  measureSurface,
  showDialog,
  updateChip,
} from '../../test/testing'
import { pause } from '../../world/waves/waves'
import { RUNNING_BUILD } from '../version'

const greeting = Scene.role('dialog', { name: 'Updated!' })
const newsButton = Scene.role('button', { name: "WHAT'S NEW" })
// NOTE: a build check is a Command's result, which no Subscription emits,
// so a Story delivers it and the Scene starts from the Model it leaves.
const foundMidWave = Story.story(
  APPLICATION,
  Story.given(fighting),
  Story.message(Message.CompletedFetchBuild({ build: 'newer-build' })),
)

const onPhase = (phase: Phase): Model =>
  withNewerBuild(modifyFields(initialModel, { phase: () => phase }))

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
  ['the break between waves', onPhase(WAVE_3_BREAK)],
  ['a wave', withNewerBuild(fighting)],
]

describe('the update gift', () => {
  it.effect('shows on the home menu', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withNewerBuild(initialModel)),
      measureSurface,
      Scene.expect(updateChip).toExist(),
    ),
  )

  it.effect.each(SCREENS_WITHOUT_THE_CHIP)('waits off %s', ([, quiet]) =>
    Scene.scene(
      APPLICATION,
      Scene.given(quiet),
      measureSurface,
      Scene.expect(updateChip).toBeAbsent(),
    ),
  )

  it.effect('shows nothing when the live build is the one running', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(initialModel),
      measureSurface,
      Scene.expect(updateChip).toBeAbsent(),
    ),
  )

  it.effect(
    'a build found mid-wave waits through pause and shows on the home menu',
    () =>
      Effect.gen(function* () {
        const found = yield* foundMidWave
        yield* Scene.scene(
          APPLICATION,
          Scene.given(found),
          measureSurface,
          Scene.expect(updateChip).toBeAbsent(),
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.keyboard,
            Message.PressedKey({ code: 'Escape' }),
          ),
          Scene.expect(updateChip).toBeAbsent(),
          Scene.expect(manorButton).toBeAbsent(),
        )
      }),
  )

  it.effect('wears a little NEW! tag', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withNewerBuild(initialModel)),
      measureSurface,
      Scene.expect(updateChip).toHaveText('NEW!'),
    ),
  )

  it.effect(
    'tapping it unwraps the gift, then reloads onto the new build',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(withNewerBuild(initialModel)),
        measureSurface,
        Scene.click(updateChip),
        Scene.expect(updateChip).toHaveAttr('data-state', 'Unwrapping'),
        Scene.Command.expectExact(WaitForUnwrap),
        Scene.Command.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
        Scene.Command.expectExact(ReloadPage({ build: 'newer-build' })),
        Scene.Command.resolve(
          ReloadPage,
          Message.FailedReloadPage({ reason: 'no' }),
        ),
        Scene.expect(updateChip).toHaveAttr('data-state', 'Wrapped'),
      ),
  )
})

const newestHeadline = Option.match(maybeNewestNewsDay, {
  onNone: () => '',
  onSome: day => newsHeadline(day.bullets[0].text),
})

// NOTE: the update marker is read by a Command at boot, so a Story
// delivers what it read and a Scene starts from the Model it leaves: with
// the build that is running, the greeting already opening.
const afterMarker = (maybeBuild: Option.Option<string>) =>
  Story.story(
    APPLICATION,
    Story.given(initialModel),
    Story.message(Message.CompletedReadUpdateMarker({ maybeBuild })),
  )

const justUpdated = Story.story(
  APPLICATION,
  Story.given(initialModel),
  Story.message(
    Message.CompletedReadUpdateMarker({
      maybeBuild: Option.some(RUNNING_BUILD),
    }),
  ),
  showDialog(),
)

// NOTE: a Dialog that is already open when the page draws takes its
// resources through its Mount.
const acquireGreeting = Scene.Mount.resolve(
  Dialog.test.AcquireResources,
  DialogBlock.Message.SucceededAcquireResources(),
)

describe('the greeting after an update', () => {
  it.effect(
    'throws a party with the news when the reload lands on the new build',
    () =>
      Effect.gen(function* () {
        const updated = yield* justUpdated
        yield* Scene.scene(
          APPLICATION,
          Scene.given(updated),
          measureSurface,
          acquireGreeting,
          Scene.expect(greeting).toExist(),
          Scene.expect(greeting).toContainText(newestHeadline),
          Scene.expect(newsButton).toExist(),
          Scene.click(closeButton),
          Scene.Command.resolve(
            Dialog.test.CloseDialog,
            DialogBlock.Message.CompletedCloseDialog(),
          ),
          Scene.expect(greeting).toBeAbsent(),
        )
      }),
  )

  it.effect('the news button opens the full news', () =>
    Effect.gen(function* () {
      const updated = yield* justUpdated
      yield* Scene.scene(
        APPLICATION,
        Scene.given(updated),
        measureSurface,
        acquireGreeting,
        Scene.click(newsButton),
        Scene.Command.resolveAll(
          [Dialog.test.CloseDialog, DialogBlock.Message.CompletedCloseDialog()],
          [Dialog.test.ShowDialog, DialogBlock.Message.SucceededShowDialog()],
        ),
        Scene.expect(greeting).toBeAbsent(),
        Scene.expect(Scene.role('dialog', { name: /^What's new/i })).toExist(),
      )
    }),
  )

  it.effect(
    'greets nobody on a plain load or a reload that kept the old build',
    () =>
      Effect.forEach(
        [Option.none(), Option.some('an-older-build')],
        maybeBuild =>
          Effect.flatMap(afterMarker(maybeBuild), loaded =>
            Scene.scene(
              APPLICATION,
              Scene.given(loaded),
              measureSurface,
              Scene.expect(greeting).toBeAbsent(),
            ),
          ),
      ),
  )
})
