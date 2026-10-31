import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { update } from './main'
import { Message } from './message'
import { type Model, initialModel } from './model'
import { loadingSave, readyAfterRead } from './model.fixture'
import { decodeSave, encodeSave, restoreSave, saveOf } from './save'
import { finishSplash } from './testing'
import { ApplyRotation } from './update/rotation'
import { WriteSave } from './update/save'
import { FetchBuild } from './update/version'

const onPhone = (base: Model): Model =>
  modifyFields(base, { orientationLock: () => 'Supported' })

const applied = (rotation: 'Landscape' | 'Auto') =>
  Command.resolve(ApplyRotation({ rotation }), Message.CompletedApplyRotation())

const savedWrite = Command.resolve(WriteSave, Message.CompletedWriteSave())

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
    const versionSeven = JSON.stringify({ ...withoutRotation, version: 7 })
    const migrated = Option.getOrThrow(decodeSave(versionSeven))
    expect(migrated.rotation).toBe('Landscape')
    expect(migrated.settings.shake).toBe('Off')
  })
})

describe('applying the rotation', () => {
  test('a loaded save on a phone that can lock applies its rotation', () => {
    const autoSave = {
      ...saveOf(readyAfterRead),
      rotation: 'Auto' as const,
    }
    story(
      update,
      given(onPhone(loadingSave)),
      message(Message.CompletedLoadSave({ maybeSave: Option.some(autoSave) })),
      finishSplash,
      applied('Auto'),
      model(current => {
        expect(current.rotationSetting).toBe('Auto')
      }),
    )
  })

  test('finding a phone that can lock locks it to landscape by default', () => {
    story(
      update,
      given(readyAfterRead),
      message(
        Message.CompletedDetectOrientationLock({
          orientationLock: 'Supported',
        }),
      ),
      applied('Landscape'),
      model(current => {
        expect(current.orientationLock).toBe('Supported')
        expect(current.rotationSetting).toBe('Landscape')
      }),
    )
  })

  test('ROTATE switches to Auto and back, applying and saving each', () => {
    story(
      update,
      given(onPhone(readyAfterRead)),
      message(Message.ClickedRotationButton()),
      applied('Auto'),
      savedWrite,
      model(current => {
        expect(current.rotationSetting).toBe('Auto')
        expect(saveOf(current).rotation).toBe('Auto')
      }),
      message(Message.ClickedRotationButton()),
      applied('Landscape'),
      savedWrite,
      model(current => {
        expect(current.rotationSetting).toBe('Landscape')
      }),
    )
  })

  test('full screen coming on and the page coming back apply it again', () => {
    const auto = onPhone(
      modifyFields(readyAfterRead, { rotationSetting: () => 'Auto' }),
    )
    story(
      update,
      given(auto),
      message(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
      applied('Auto'),
    )
    story(
      update,
      given(modifyFields(auto, { pageVisibility: () => 'Hidden' })),
      message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
      applied('Auto'),
      Command.resolve(FetchBuild, Message.FailedFetchBuild({ reason: 'test' })),
    )
  })

  test('a desktop or an iPhone never locks and ignores ROTATE', () => {
    story(
      update,
      given(readyAfterRead),
      message(Message.ClickedRotationButton()),
      message(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
      Command.expectNone(),
      model(current => {
        expect(current.rotationSetting).toBe('Landscape')
      }),
    )
  })
})
