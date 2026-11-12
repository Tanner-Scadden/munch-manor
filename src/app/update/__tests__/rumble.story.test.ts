import { Option } from 'effect'
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
import { readyAfterRead } from '../../../test/model.fixture'
import { APPLICATION, jsonOf, writeSave } from '../../../test/testing'
import { ProfileBinding } from '../../bindings'
import { initialModel } from '../../pureApp'

describe('the rumble setting', () => {
  test('is on for a new player', () => {
    expect(initialModel.rumbleSetting).toBe('On')
  })

  test('round-trips through the save', () => {
    const off = modifyFields(readyAfterRead, { rumbleSetting: () => 'Off' })
    const save = saveOf(off)
    expect(save.rumble).toBe('Off')
    const raw = Option.getOrThrow(encodeSave(save))
    const decoded = Option.getOrThrow(decodeSave(raw))
    expect(restoreSave(initialModel, decoded).rumbleSetting).toBe('Off')
  })

  test('a save from before controllers loads rumbling', () => {
    const { rumble: _rumble, ...withoutRumble } = saveOf(
      modifyFields(readyAfterRead, { shakeSetting: () => 'Off' }),
    )
    const versionSeventeen = jsonOf({ ...withoutRumble, version: 17 })
    const migrated = Option.getOrThrow(decodeSave(versionSeventeen))
    expect(migrated.rumble).toBe('On')
    expect(migrated.settings.shake).toBe('Off')
  })

  it.effect('RUMBLE turns it off and on, saving each', () =>
    Story.story(
      APPLICATION,
      Story.given(readyAfterRead),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'Rumble' }),
      ),
      writeSave(),
      Story.model(current => {
        expect(current.rumbleSetting).toBe('Off')
        expect(saveOf(current).rumble).toBe('Off')
      }),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'Rumble' }),
      ),
      writeSave(),
      Story.model(current => {
        expect(current.rumbleSetting).toBe('On')
      }),
    ),
  )
})
