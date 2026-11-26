import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { ApplyRotation } from '#app/update/rotation.ts'
import { FetchBuild } from '#app/update/version.ts'
import { decodeSave, encodeSave, restoreSave, saveOf } from '#platform/save.ts'
import { loadingSave, readyAfterRead } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  finishSplash,
  jsonOf,
  send,
  storyOf,
  writeSave,
} from '#test/testing.ts'

const onPhone = (base: Model): Model =>
  UiStruct.evolve(base, { orientationLock: () => 'Supported' })

const applied =
  (rotation: 'Landscape' | 'Auto'): StoryStep =>
  s =>
    s.resolve(ApplyRotation.make({ rotation }), Component.noop)

const clickRotate = send(Message.ClickedProfileSetting({ setting: 'Rotation' }))

describe('the rotation setting in the save', () => {
  test('round-trips through the save', () => {
    const auto = UiStruct.evolve(readyAfterRead, {
      settings: UiStruct.evolve({ rotationSetting: () => 'Auto' }),
    })
    const save = saveOf(auto)
    expect(save.rotation).toBe('Auto')
    const raw = Option.getOrThrow(encodeSave(save))
    const decoded = Option.getOrThrow(decodeSave(raw))
    expect(decoded.rotation).toBe('Auto')
    expect(restoreSave(initialModel, decoded).settings.rotationSetting).toBe(
      'Auto',
    )
  })

  test('a save from before the rotation loads locked to landscape', () => {
    const { rotation: _rotation, ...withoutRotation } = saveOf(
      UiStruct.evolve(readyAfterRead, {
        settings: UiStruct.evolve({ shakeSetting: () => 'Off' }),
      }),
    )
    const versionSeven = jsonOf({ ...withoutRotation, version: 7 })
    const migrated = Option.getOrThrow(decodeSave(versionSeven))
    expect(migrated.rotation).toBe('Landscape')
    expect(migrated.settings.shake).toBe('Off')
  })
})

describe('applying the rotation', () => {
  it.effect('a loaded save on a phone that can lock applies its rotation', () =>
    Effect.gen(function* () {
      const autoSave = {
        ...saveOf(readyAfterRead),
        rotation: 'Auto' as const,
      }
      const s = yield* storyOf(onPhone(loadingSave))
      s.pipe(
        send(Message.CompletedLoadSave({ maybeSave: Option.some(autoSave) })),
        finishSplash,
        applied('Auto'),
        checkModel(current => {
          expect(current.settings.rotationSetting).toBe('Auto')
        }),
      )
    }),
  )

  it.effect(
    'finding a phone that can lock locks it to landscape by default',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyAfterRead)
        s.pipe(
          send(
            Message.CompletedDetectOrientationLock({
              orientationLock: 'Supported',
            }),
          ),
          applied('Landscape'),
          checkModel(current => {
            expect(current.orientationLock).toBe('Supported')
            expect(current.settings.rotationSetting).toBe('Landscape')
          }),
        )
      }),
  )

  it.effect('ROTATE switches to Auto and back, applying and saving each', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onPhone(readyAfterRead))
      s.pipe(
        clickRotate,
        applied('Auto'),
        writeSave,
        checkModel(current => {
          expect(current.settings.rotationSetting).toBe('Auto')
          expect(saveOf(current).rotation).toBe('Auto')
        }),
        clickRotate,
        applied('Landscape'),
        writeSave,
        checkModel(current => {
          expect(current.settings.rotationSetting).toBe('Landscape')
        }),
      )
    }),
  )

  it.effect(
    'full screen coming on and the page coming back apply it again',
    () =>
      Effect.gen(function* () {
        const auto = onPhone(
          UiStruct.evolve(readyAfterRead, {
            settings: UiStruct.evolve({ rotationSetting: () => 'Auto' }),
          }),
        )
        yield* Effect.scoped(
          Effect.map(storyOf(auto), s =>
            s.pipe(
              send(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
              applied('Auto'),
            ),
          ),
        )
        yield* Effect.scoped(
          Effect.map(
            storyOf(UiStruct.evolve(auto, { pageVisibility: () => 'Hidden' })),
            s =>
              s
                .pipe(
                  send(
                    Message.ChangedPageVisibility({ visibility: 'Visible' }),
                  ),
                  applied('Auto'),
                )
                .resolve(
                  FetchBuild,
                  Message.FailedFetchBuild({ reason: 'test' }),
                ),
          ),
        )
      }),
  )

  it.effect('a desktop or an iPhone never locks and ignores ROTATE', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyAfterRead)
      s.pipe(
        clickRotate,
        send(Message.CompletedSetFullscreen({ fullscreen: 'On' })),
        checkModel(current => {
          expect(current.settings.rotationSetting).toBe('Landscape')
        }),
      ).expectNone()
    }),
  )
})
