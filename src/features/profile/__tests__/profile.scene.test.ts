import { Effect } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'
import { Tabs } from '@foldkit/ui'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { LinkFlow, SyncState } from '../../../platform/playerSync'
import { homeAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeButton,
  closeDialogInScene,
  emitPressedKey,
  measureSurface,
  measureSurfaceAs,
  profileDialog,
  settingsButton,
  showDialogInScene,
} from '../../../test/testing'
import { CopyLinkCodeOnClick, PasteLinkCodeOnTap } from '../linkClipboard'
import { Message as ProfileMessage } from '../message'
import { ProfileTabsBlock } from '../model'
import { RequestLinkCode } from '../update'
import { LINK_TAKES_PROGRESS_NOTE, SHARE_STATS_NOTE } from '../view'

const onTouch: Model = modifyFields(homeAfterRead, {
  lastDevice: () => 'Touch',
})

const synced: Model = modifyFields(homeAfterRead, {
  syncState: () => SyncState.Synced({ devices: 2 }),
})

const tab = (name: string) => Scene.role('tab', { name })
const focusTab = (index: number) =>
  Scene.Command.resolve(
    Tabs.test.FocusTab({ id: 'profile-tabs', index }),
    ProfileTabsBlock.Message.CompletedFocusTab(),
  )

const measureUpright = measureSurfaceAs({
  left: 0,
  top: 0,
  width: 390,
  height: 844,
})

describe('the Profile', () => {
  it.effect(
    'the gear opens it on Settings: four tabs, sound and friends, and no devices or stats sharing',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(synced),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.expect(profileDialog).toExist(),
        Scene.inside(
          Scene.role('tablist', { name: 'Profile' }),
          Scene.expectAll(Scene.all.role('tab')).toHaveCount(4),
        ),
        Scene.expect(tab('Look')).toExist(),
        Scene.expect(tab('Name')).toExist(),
        Scene.expect(tab('Account')).toExist(),
        Scene.expect(tab('Settings')).toHaveAttr('aria-selected', 'true'),
        Scene.expect(Scene.role('tablist', { name: 'Profile' })).toHaveAttr(
          'aria-orientation',
          'vertical',
        ),
        Scene.expect(Scene.role('button', { name: 'Sound' })).toExist(),
        Scene.expect(
          Scene.role('button', { name: 'Reset tutorial' }),
        ).toExist(),
        Scene.expect(Scene.role('button', { name: 'Use a code' })).toBeAbsent(),
        Scene.expect(
          Scene.role('button', { name: 'Link another device' }),
        ).toBeAbsent(),
        Scene.expect(
          Scene.role('button', { name: 'Share anonymous play stats' }),
        ).toBeAbsent(),
        Scene.expect(Scene.role('button', { name: /^Devices/ })).toBeAbsent(),
        Scene.click(closeButton),
        ...closeDialogInScene(),
        Scene.expect(profileDialog).toBeAbsent(),
      ),
  )

  it.effect(
    'the arrow keys move between the tabs, down the side in landscape',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(homeAfterRead),
        measureSurface,
        emitPressedKey('KeyC'),
        ...showDialogInScene(),
        Scene.expect(tab('Look')).toHaveAttr('aria-selected', 'true'),
        Scene.expect(Scene.role('group', { name: 'Body' })).toBeAbsent(),
        Scene.expect(
          Scene.role('radiogroup', { name: 'Body shape' }),
        ).toExist(),
        Scene.keydown(tab('Look'), 'ArrowDown'),
        focusTab(1),
        Scene.expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
        Scene.expect(Scene.role('textbox', { name: 'Your name' })).toExist(),
        Scene.keydown(tab('Name'), 'ArrowDown'),
        focusTab(2),
        Scene.expect(tab('Account')).toHaveAttr('aria-selected', 'true'),
        Scene.keydown(tab('Account'), 'ArrowUp'),
        focusTab(1),
        Scene.expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
        Scene.keydown(tab('Name'), 'End'),
        focusTab(3),
        Scene.expect(tab('Settings')).toHaveAttr('aria-selected', 'true'),
      ),
  )

  it.effect(
    'upright on a phone the tabs run across the top, and the arrows go left and right',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onTouch),
        measureUpright,
        Scene.click(
          Scene.role('button', { name: 'Your character: change how you look' }),
        ),
        ...showDialogInScene(),
        Scene.expect(Scene.role('tablist', { name: 'Profile' })).toHaveAttr(
          'aria-orientation',
          'horizontal',
        ),
        Scene.keydown(tab('Look'), 'ArrowRight'),
        focusTab(1),
        Scene.expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
      ),
  )

  it.effect('a tap on a tab switches to it', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(onTouch, {
          syncState: () => SyncState.Synced({ devices: 2 }),
        }),
      ),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.click(tab('Account')),
      focusTab(2),
      Scene.expect(tab('Account')).toHaveAttr('aria-selected', 'true'),
      Scene.expect(Scene.role('list', { name: 'Your 2 devices' })).toExist(),
      Scene.expect(Scene.role('status')).toExist(),
      Scene.click(tab('Look')),
      focusTab(0),
      Scene.expect(
        Scene.role('button', { name: 'Roll a random look' }),
      ).toExist(),
    ),
  )
})

describe('the Name tab', () => {
  const nameField = Scene.role('textbox', { name: 'Your name' })
  const stone = Scene.selector('.name-stone-name')

  it.effect(
    'the stone shows the placeholder, then the name as it is typed, and Enter keeps it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(homeAfterRead),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.click(tab('Name')),
        focusTab(1),
        Scene.expect(stone).toHaveText('Survivor'),
        Scene.expect(nameField).toHaveAttr('placeholder', 'Survivor'),
        Scene.expect(Scene.role('img', { name: '12 letters left' })).toExist(),
        Scene.type(nameField, 'Gravy Dave'),
        Scene.expect(stone).toHaveText('Gravy Dave'),
        Scene.expect(Scene.role('img', { name: '2 letters left' })).toExist(),
        Scene.submit(Scene.selector('.name-tab')),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        Scene.expect(nameField).toHaveValue('Gravy Dave'),
      ),
  )

  it.effect('the dice rolls a goofy name onto the stone', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(modifyFields(homeAfterRead, { cosmeticRngState: () => 99 })),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.click(tab('Name')),
      focusTab(1),
      Scene.click(Scene.role('button', { name: 'Roll a goofy name' })),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      Scene.expect(stone).not.toHaveText('Survivor'),
      Scene.expect(Scene.selector('.name-stone')).toHaveAttr('data-fx', 'Spin'),
    ),
  )
})

describe('the Account tab', () => {
  it.effect(
    "Use a code says this device will take the other device's progress before Link",
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(synced),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.click(tab('Account')),
        focusTab(2),
        Scene.expect(Scene.text(LINK_TAKES_PROGRESS_NOTE)).toBeAbsent(),
        Scene.click(Scene.role('button', { name: 'Use a code' })),
        Scene.expect(Scene.text(LINK_TAKES_PROGRESS_NOTE)).toExist(),
        Scene.expect(
          Scene.role('textbox', { name: LINK_TAKES_PROGRESS_NOTE }),
        ).toExist(),
        Scene.expect(Scene.role('button', { name: 'Link' })).toExist(),
        Scene.Mount.resolve(
          PasteLinkCodeOnTap,
          ProfileMessage.SucceededReadClipboard({ text: 'hi', typed: '' }),
        ),
        Scene.expect(
          Scene.role('textbox', { name: LINK_TAKES_PROGRESS_NOTE }),
        ).toHaveValue(''),
      ),
  )

  it.effect(
    'summoning shows the code in big letters, and a tap copies it with COPIED! in place',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(synced),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.click(tab('Account')),
        focusTab(2),
        Scene.click(Scene.role('button', { name: 'Link another device' })),
        Scene.Command.resolve(
          RequestLinkCode,
          ProfileMessage.SucceededRequestLinkCode({ code: 'KZ7QWM' }),
        ),
        Scene.expect(
          Scene.role('button', { name: 'Link code K Z 7 Q W M, tap to copy' }),
        ).toExist(),
        Scene.expect(
          Scene.selector('.account-code[data-link-code="KZ7QWM"]'),
        ).toExist(),
        Scene.expectAll(Scene.all.selector('.account-code-letter')).toHaveCount(
          6,
        ),
        Scene.expect(Scene.text('COPIED!')).toBeAbsent(),
        Scene.Mount.resolve(
          CopyLinkCodeOnClick,
          ProfileMessage.SucceededCopyLinkCode(),
        ),
        Scene.expect(
          Scene.role('button', { name: 'Link code K Z 7 Q W M, copied' }),
        ).toExist(),
        Scene.expect(Scene.text('COPIED!')).toExist(),
        Scene.Mount.emit(
          CopyLinkCodeOnClick,
          ProfileMessage.SucceededCopyLinkCode(),
        ),
        Scene.expectAll(Scene.all.text('COPIED!')).toHaveCount(1),
      ),
  )

  it.effect('a pasted code fills the field', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(synced),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.click(tab('Account')),
      focusTab(2),
      Scene.click(Scene.role('button', { name: 'Use a code' })),
      Scene.Mount.resolve(
        PasteLinkCodeOnTap,
        ProfileMessage.SucceededReadClipboard({ text: 'kz7 qwm', typed: '' }),
      ),
      Scene.expect(
        Scene.role('textbox', { name: LINK_TAKES_PROGRESS_NOTE }),
      ).toHaveValue('KZ7QWM'),
    ),
  )

  it.effect('the devices zap together once linked', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(synced, {
          profile: profile =>
            modifyFields(profile, { linkFlow: () => LinkFlow.Linked() }),
        }),
      ),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.click(tab('Account')),
      focusTab(2),
      Scene.expect(Scene.selector('.account-zap')).toExist(),
      Scene.expect(
        Scene.text(
          "Linked! This device now uses your other device's progress.",
        ),
      ).toExist(),
    ),
  )

  it.effect('stats sharing is one icon toggle, its note read aloud', () => {
    const shareToggle = Scene.role('button', {
      name: 'Share anonymous play stats',
    })
    return Scene.scene(
      APPLICATION,
      Scene.given(homeAfterRead),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.click(tab('Account')),
      focusTab(2),
      Scene.expect(shareToggle).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(shareToggle).toHaveAttr(
        'aria-describedby',
        'share-stats-note',
      ),
      Scene.expect(Scene.text(SHARE_STATS_NOTE)).toExist(),
      Scene.click(shareToggle),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      Scene.expect(shareToggle).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(
        Scene.role('button', { name: 'Link another device' }),
      ).toBeAbsent(),
    )
  })
})

describe('every entry point', () => {
  it.effect('lands on its tab', () =>
    Effect.forEach(
      [
        { open: Scene.click(settingsButton), tab: 'Settings' },
        { open: emitPressedKey('KeyO'), tab: 'Settings' },
        { open: emitPressedKey('KeyC'), tab: 'Look' },
        {
          open: Scene.click(
            Scene.role('button', {
              name: 'Your character: change how you look',
            }),
          ),
          tab: 'Look',
        },
      ],
      ({ open, tab: name }) =>
        Scene.scene(
          APPLICATION,
          Scene.given(homeAfterRead),
          measureSurface,
          open,
          ...showDialogInScene(),
          Scene.expect(tab(name)).toHaveAttr('aria-selected', 'true'),
        ),
      { discard: true },
    ),
  )
})

describe('RECORD MY RUNS', () => {
  const recordTile = Scene.role('button', { name: 'Record my runs' })

  it.effect('is hidden on a device never opened with ?record=1', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(homeAfterRead),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.expect(Scene.role('button', { name: 'Sound' })).toExist(),
      Scene.expect(recordTile).toBeAbsent(),
    ),
  )

  it.effect('shows on an unlocked device, off until tapped', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(homeAfterRead, { recordUnlock: () => 'Unlocked' }),
      ),
      measureSurface,
      Scene.click(settingsButton),
      ...showDialogInScene(),
      Scene.expect(recordTile).toHaveAttr('aria-pressed', 'false'),
      Scene.click(recordTile),
      Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
      Scene.expect(recordTile).toHaveAttr('aria-pressed', 'true'),
    ),
  )
})
