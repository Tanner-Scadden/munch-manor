import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message as ProfileMessage } from '../../../features/profile/message'
import {
  decodeSave,
  encodeSave,
  restoreSave,
  saveOf,
} from '../../../platform/save'
import { loadingSave, readyAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  finishSplash,
  jsonOf,
  writeSave,
} from '../../../test/testing'
import { ProfileBinding } from '../../bindings'
import { Message } from '../../message'
import { type Model } from '../../model'
import { initialModel } from '../../pureApp'
import { ApplyRotation } from '../rotation'
import { FetchBuild } from '../version'

const onPhone = (base: Model): Model =>
  modifyFields(base, { orientationLock: () => 'Supported' })

const applied = (rotation: 'Landscape' | 'Auto') =>
  Story.Command.resolve(
    ApplyRotation({ rotation }),
    Message.CompletedApplyRotation(),
  )

describe('the rotation setting in the save', () => {
  test('round-trips through the save', () => {
    const auto = modifyFields(readyAfterRead, { rotationSetting: () => 'Auto' })
    const save = saveOf(auto)
    expect(save.rotation).toBe('Auto')
    const raw = Option.getOrThrow(encodeSave(save))
    const decoded = Option.getOrThrow(decodeSave(raw))
    expect(decoded.rotation).toBe('Auto')
    expect(restoreSave(initialModel, decoded).rotationSetting).toBe('Auto')
  })

  test('a save from before the rotation loads locked to landscape', () => {
    const { rotation: _rotation, ...withoutRotation } = saveOf(
      modifyFields(readyAfterRead, { shakeSetting: () => 'Off' }),
    )
    const versionSeven = jsonOf({ ...withoutRotation, version: 7 })
    const migrated = Option.getOrThrow(decodeSave(versionSeven))
    expect(migrated.rotation).toBe('Landscape')
    expect(migrated.settings.shake).toBe('Off')
  })
})

describe('applying the rotation', () => {
  it.effect(
    'a loaded save on a phone that can lock applies its rotation',
    () => {
      const autoSave = {
        ...saveOf(readyAfterRead),
        rotation: 'Auto' as const,
      }
      return Story.story(
        APPLICATION,
        Story.given(onPhone(loadingSave)),
        Story.message(
          Message.CompletedLoadSave({ maybeSave: Option.some(autoSave) }),
        ),
        finishSplash,
        applied('Auto'),
        Story.model(current => {
          expect(current.rotationSetting).toBe('Auto')
        }),
      )
    },
  )

  it.effect(
    'finding a phone that can lock locks it to landscape by default',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyAfterRead),
        Story.message(
          Message.CompletedDetectOrientationLock({
            orientationLock: 'Supported',
          }),
        ),
        applied('Landscape'),
        Story.model(current => {
          expect(current.orientationLock).toBe('Supported')
          expect(current.rotationSetting).toBe('Landscape')
        }),
      ),
  )

  it.effect('ROTATE switches to Auto and back, applying and saving each', () =>
    Story.story(
      APPLICATION,
      Story.given(onPhone(readyAfterRead)),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'Rotation' }),
      ),
      applied('Auto'),
      writeSave(),
      Story.model(current => {
        expect(current.rotationSetting).toBe('Auto')
        expect(saveOf(current).rotation).toBe('Auto')
      }),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'Rotation' }),
      ),
      applied('Landscape'),
      writeSave(),
      Story.model(current => {
        expect(current.rotationSetting).toBe('Landscape')
      }),
    ),
  )

  it.effect(
    'full screen coming on and the page coming back apply it again',
    () =>
      Effect.gen(function* () {
        const auto = onPhone(
          modifyFields(readyAfterRead, { rotationSetting: () => 'Auto' }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(auto),
          Story.message(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
          applied('Auto'),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(modifyFields(auto, { pageVisibility: () => 'Hidden' })),
          Story.message(
            Message.ChangedPageVisibility({ visibility: 'Visible' }),
          ),
          applied('Auto'),
          Story.Command.resolve(
            FetchBuild,
            Message.FailedFetchBuild({ reason: 'test' }),
          ),
        )
      }),
  )

  it.effect('a desktop or an iPhone never locks and ignores ROTATE', () =>
    Story.story(
      APPLICATION,
      Story.given(readyAfterRead),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'Rotation' }),
      ),
      Story.message(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(current.rotationSetting).toBe('Landscape')
      }),
    ),
  )
})
