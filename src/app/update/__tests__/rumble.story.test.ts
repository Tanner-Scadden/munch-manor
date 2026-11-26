import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { initialModel } from '#app/pureApp.ts'
import { decodeSave, encodeSave, restoreSave, saveOf } from '#platform/save.ts'
import { readyAfterRead } from '#test/model.fixture.ts'
import { checkModel, jsonOf, send, storyOf, writeSave } from '#test/testing.ts'

describe('the rumble setting', () => {
  test('is on for a new player', () => {
    expect(initialModel.settings.rumbleSetting).toBe('On')
  })

  test('round-trips through the save', () => {
    const off = UiStruct.evolve(readyAfterRead, {
      settings: UiStruct.evolve({ rumbleSetting: () => 'Off' }),
    })
    const save = saveOf(off)
    expect(save.rumble).toBe('Off')
    const raw = Option.getOrThrow(encodeSave(save))
    const decoded = Option.getOrThrow(decodeSave(raw))
    expect(restoreSave(initialModel, decoded).settings.rumbleSetting).toBe(
      'Off',
    )
  })

  test('a save from before controllers loads rumbling', () => {
    const { rumble: _rumble, ...withoutRumble } = saveOf(
      UiStruct.evolve(readyAfterRead, {
        settings: UiStruct.evolve({ shakeSetting: () => 'Off' }),
      }),
    )
    const versionSeventeen = jsonOf({ ...withoutRumble, version: 17 })
    const migrated = Option.getOrThrow(decodeSave(versionSeventeen))
    expect(migrated.rumble).toBe('On')
    expect(migrated.settings.shake).toBe('Off')
  })

  it.effect('RUMBLE turns it off and on, saving each', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyAfterRead)
      s.pipe(
        send(Message.ClickedProfileSetting({ setting: 'Rumble' })),
        writeSave,
        checkModel(current => {
          expect(current.settings.rumbleSetting).toBe('Off')
          expect(saveOf(current).rumble).toBe('Off')
        }),
        send(Message.ClickedProfileSetting({ setting: 'Rumble' })),
        writeSave,
        checkModel(current => {
          expect(current.settings.rumbleSetting).toBe('On')
        }),
      )
    }),
  )
})
