import { Array } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  keydown,
  role,
  scene,
  selector,
  submit,
  text,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Tabs } from '@foldkit/ui'

import { Message } from './message'
import { type Model } from './model'
import { homeAfterRead } from './model.fixture'
import { LinkFlow, SyncState } from './playerSync'
import { ProfileTabsBlock } from './profile'
import { LINK_TAKES_PROGRESS_NOTE, SHARE_STATS_NOTE } from './profileView'
import {
  ROOT,
  closeButton,
  closeDialogInScene,
  emitPressedKey,
  measureSurface,
  measureSurfaceAs,
  profileDialog,
  settingsButton,
  showDialogInScene,
} from './testing'
import { RequestLinkCode, WriteSave } from './update/save'

const onTouch: Model = modifyFields(homeAfterRead, {
  lastDevice: () => 'Touch',
})

const synced: Model = modifyFields(homeAfterRead, {
  syncState: () => SyncState.Synced({ devices: 2 }),
})

const tab = (name: string) => role('tab', { name })
const focusTab = (index: number) =>
  Command.resolve(
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
  test('the gear opens it on Settings: four tabs, sound and friends, and no devices or stats sharing', () => {
    scene(
      ROOT,
      given(synced),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(profileDialog).toExist(),
      inside(
        role('tablist', { name: 'Profile' }),
        expectAll(all.role('tab')).toHaveCount(4),
      ),
      expect(tab('Look')).toExist(),
      expect(tab('Name')).toExist(),
      expect(tab('Account')).toExist(),
      expect(tab('Settings')).toHaveAttr('aria-selected', 'true'),
      expect(role('tablist', { name: 'Profile' })).toHaveAttr(
        'aria-orientation',
        'vertical',
      ),
      expect(role('button', { name: 'Sound' })).toExist(),
      expect(role('button', { name: 'Reset tutorial' })).toExist(),
      expect(role('button', { name: 'Use a code' })).toBeAbsent(),
      expect(role('button', { name: 'Link another device' })).toBeAbsent(),
      expect(
        role('button', { name: 'Share anonymous play stats' }),
      ).toBeAbsent(),
      expect(role('button', { name: /^Devices/ })).toBeAbsent(),
      click(closeButton),
      ...closeDialogInScene(),
      expect(profileDialog).toBeAbsent(),
    )
  })

  test('the arrow keys move between the tabs, down the side in landscape', () => {
    scene(
      ROOT,
      given(homeAfterRead),
      measureSurface,
      emitPressedKey('KeyC'),
      ...showDialogInScene(),
      expect(tab('Look')).toHaveAttr('aria-selected', 'true'),
      expect(role('group', { name: 'Body' })).toBeAbsent(),
      expect(role('radiogroup', { name: 'Body shape' })).toExist(),
      keydown(tab('Look'), 'ArrowDown'),
      focusTab(1),
      expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
      expect(role('textbox', { name: 'Your name' })).toExist(),
      keydown(tab('Name'), 'ArrowDown'),
      focusTab(2),
      expect(tab('Account')).toHaveAttr('aria-selected', 'true'),
      keydown(tab('Account'), 'ArrowUp'),
      focusTab(1),
      expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
      keydown(tab('Name'), 'End'),
      focusTab(3),
      expect(tab('Settings')).toHaveAttr('aria-selected', 'true'),
    )
  })

  test('upright on a phone the tabs run across the top, and the arrows go left and right', () => {
    scene(
      ROOT,
      given(onTouch),
      measureUpright,
      click(role('button', { name: 'Your character: change how you look' })),
      ...showDialogInScene(),
      expect(role('tablist', { name: 'Profile' })).toHaveAttr(
        'aria-orientation',
        'horizontal',
      ),
      keydown(tab('Look'), 'ArrowRight'),
      focusTab(1),
      expect(tab('Name')).toHaveAttr('aria-selected', 'true'),
    )
  })

  test('a tap on a tab switches to it', () => {
    scene(
      ROOT,
      given(
        modifyFields(onTouch, {
          syncState: () => SyncState.Synced({ devices: 2 }),
        }),
      ),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Account')),
      focusTab(2),
      expect(tab('Account')).toHaveAttr('aria-selected', 'true'),
      expect(role('list', { name: 'Your 2 devices' })).toExist(),
      expect(role('status')).toExist(),
      click(tab('Look')),
      focusTab(0),
      expect(role('button', { name: 'Roll a random look' })).toExist(),
    )
  })
})

describe('the Name tab', () => {
  const nameField = role('textbox', { name: 'Your name' })
  const stone = selector('.name-stone-name')

  test('the stone shows the placeholder, then the name as it is typed, and Enter keeps it', () => {
    scene(
      ROOT,
      given(homeAfterRead),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Name')),
      focusTab(1),
      expect(stone).toHaveText('Survivor'),
      expect(nameField).toHaveAttr('placeholder', 'Survivor'),
      expect(role('img', { name: '12 letters left' })).toExist(),
      type(nameField, 'Gravy Dave'),
      expect(stone).toHaveText('Gravy Dave'),
      expect(role('img', { name: '2 letters left' })).toExist(),
      submit(selector('.name-tab')),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(nameField).toHaveValue('Gravy Dave'),
    )
  })

  test('the dice rolls a goofy name onto the stone', () => {
    scene(
      ROOT,
      given(modifyFields(homeAfterRead, { cosmeticRngState: () => 99 })),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Name')),
      focusTab(1),
      click(role('button', { name: 'Roll a goofy name' })),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(stone).not.toHaveText('Survivor'),
      expect(selector('.name-stone')).toHaveAttr('data-fx', 'Spin'),
    )
  })
})

describe('the Account tab', () => {
  test("Use a code says this device will take the other device's progress before Link", () => {
    scene(
      ROOT,
      given(synced),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Account')),
      focusTab(2),
      expect(text(LINK_TAKES_PROGRESS_NOTE)).toBeAbsent(),
      click(role('button', { name: 'Use a code' })),
      expect(text(LINK_TAKES_PROGRESS_NOTE)).toExist(),
      expect(role('textbox', { name: LINK_TAKES_PROGRESS_NOTE })).toExist(),
      expect(role('button', { name: 'Link' })).toExist(),
    )
  })

  test('summoning asks for a code and shows it in big letters', () => {
    scene(
      ROOT,
      given(synced),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Account')),
      focusTab(2),
      click(role('button', { name: 'Link another device' })),
      Command.resolve(
        RequestLinkCode,
        Message.SucceededRequestLinkCode({ code: 'KZ7QWM' }),
      ),
      expect(role('paragraph', { name: 'Link code K Z 7 Q W M' })).toExist(),
      expectAll(all.selector('.account-code-letter')).toHaveCount(6),
    )
  })

  test('the devices zap together once linked', () => {
    scene(
      ROOT,
      given(modifyFields(synced, { linkFlow: () => LinkFlow.Linked() })),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Account')),
      focusTab(2),
      expect(selector('.account-zap')).toExist(),
      expect(
        text("Linked! This device now uses your other device's progress."),
      ).toExist(),
    )
  })

  test('stats sharing is one icon toggle, its note read aloud', () => {
    const shareToggle = role('button', { name: 'Share anonymous play stats' })
    scene(
      ROOT,
      given(homeAfterRead),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(tab('Account')),
      focusTab(2),
      expect(shareToggle).toHaveAttr('aria-pressed', 'true'),
      expect(shareToggle).toHaveAttr('aria-describedby', 'share-stats-note'),
      expect(text(SHARE_STATS_NOTE)).toExist(),
      click(shareToggle),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(shareToggle).toHaveAttr('aria-pressed', 'false'),
      expect(role('button', { name: 'Link another device' })).toBeAbsent(),
    )
  })
})

describe('every entry point', () => {
  test('lands on its tab', () => {
    Array.forEach(
      [
        { open: click(settingsButton), tab: 'Settings' },
        { open: emitPressedKey('KeyO'), tab: 'Settings' },
        { open: emitPressedKey('KeyC'), tab: 'Look' },
        {
          open: click(
            role('button', { name: 'Your character: change how you look' }),
          ),
          tab: 'Look',
        },
      ],
      ({ open, tab: name }) =>
        scene(
          ROOT,
          given(homeAfterRead),
          measureSurface,
          open,
          ...showDialogInScene(),
          expect(tab(name)).toHaveAttr('aria-selected', 'true'),
        ),
    )
  })
})
