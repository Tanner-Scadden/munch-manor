import { Array, Option, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog, Tabs } from '@foldkit/ui'

import {
  CharacterBinding,
  ProfileDialogBinding,
  ProfileTabsBinding,
} from './bindings'
import type { ApplicationViewBuilder } from './composition'
import { closeButtonView, dialogShell } from './dialogs'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from './home'
import {
  ACCOUNT_ICON,
  AIM_ICON,
  CHARACTER_ICON,
  CLOCK_ICON,
  DICE_ICON,
  FULLSCREEN_ICON,
  KEYPAD_ICON,
  LAPTOP_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  NAME_ICON,
  PHONE_ICON,
  PORTAL_ICON,
  REWIND_ICON,
  SETTINGS_ICON,
  SHAKE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
  STATS_ICON,
  TAKES_PROGRESS_ICON,
  TURN_PHONE_ICON,
  ZAP_ICON,
} from './icons'
import { iconView, isKeyboard, keyCapView } from './menuParts'
import { Message } from './message'
import type { Model, ProfileTab } from './model'
import {
  LinkFlow,
  type PlayerScopeStatus,
  SyncState,
  devicesStatusText,
  linkProblemText,
} from './playerSync'
import {
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
  NAME_INPUT_ID,
  PROFILE_TABS,
  nameLength,
  shownName,
} from './profile'
import { rankPlateView } from './rankBadgeView'
import { isPortrait } from './screen'

// SHARED

// TABS

type TabLook = Readonly<{ word: string; icon: string }>

// NOTE: each tab is one word and one icon. Its color comes from
// [data-tab] in src/profile.css: pink Look, yellow Name, teal Account, and
// grey Settings.
const TAB_LOOKS: Readonly<Record<ProfileTab, TabLook>> = {
  Look: { word: 'Look', icon: CHARACTER_ICON },
  Name: { word: 'Name', icon: NAME_ICON },
  Account: { word: 'Account', icon: ACCOUNT_ICON },
  Settings: { word: 'Settings', icon: SETTINGS_ICON },
}

const tabButtonView = (
  tab: Tabs.TabInfo<ProfileTab>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  h.button(
    [
      ...tab.tab,
      ...(tab.isActive ? initialFocus : []),
      h.Class('profile-tab'),
      h.DataAttribute('tab', tab.value),
    ],
    [
      iconView('profile-tab-icon', TAB_LOOKS[tab.value].icon, h),
      h.span([h.Class('profile-tab-word')], [TAB_LOOKS[tab.value].word]),
    ],
  )

// LOOK

const lookTabView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.block(
    CharacterBinding.embedView({
      slotId: 'character-picker',
      model: model.character,
      viewInputs: {
        appearance: model.appearance,
        calling: model.player.calling,
        screenMs: model.screenMs,
        fx: model.profile.fx,
        fxCount: model.profile.fxCount,
      },
    }),
  )

// NAME

const nameLettersView = (name: string, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('name-stone-name'), h.AriaHidden(true)],
    Array.map(Array.fromIterable(name), (letter, index) =>
      h.span(
        [h.Class('name-stone-letter'), h.Style({ '--i': `${index}` })],
        [letter === ' ' ? ' ' : letter],
      ),
    ),
  )

const stoneChildren = (model: Model, h: ApplicationViewBuilder) => [
  h.span([h.Class('name-stone-rip'), h.AriaHidden(true)], ['R.I.P.']),
  nameLettersView(shownName(model.profile.nameDraft), h),
  h.span([h.Class('name-stone-crack'), h.AriaHidden(true)]),
]

// NOTE: the name is carved on a tombstone, live as it is typed. A dice roll
// swaps the stone, so its letters spin in like a slot machine each time.
const evenStoneView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [
      h.Class('name-stone'),
      h.DataAttribute('fx', model.profile.fx),
      h.DataAttribute(
        'empty',
        model.profile.nameDraft === '' ? 'Empty' : 'Named',
      ),
    ],
    stoneChildren(model, h),
  )

const oddStoneView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [
      h.Class('name-stone'),
      h.DataAttribute('fx', model.profile.fx),
      h.DataAttribute(
        'empty',
        model.profile.nameDraft === '' ? 'Empty' : 'Named',
      ),
    ],
    stoneChildren(model, h),
  )

const stoneView = (model: Model, h: ApplicationViewBuilder): Html =>
  model.profile.fxCount % 2 === 0
    ? evenStoneView(model, h)
    : oddStoneView(model, h)

const namePipsView = (model: Model, h: ApplicationViewBuilder): Html => {
  const used = nameLength(model.profile.nameDraft)
  const left = MAX_NAME_LENGTH - used
  return h.div(
    [
      h.Class('name-pips'),
      h.Role('img'),
      h.AriaLabel(left === 1 ? '1 letter left' : `${left} letters left`),
    ],
    Array.makeBy(MAX_NAME_LENGTH, index =>
      h.span([
        h.Class('name-pip'),
        h.DataAttribute('used', index < used ? 'Used' : 'Free'),
      ]),
    ),
  )
}

const nameTabView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.form(
    [h.Class('name-tab'), h.OnSubmit(Message.SubmittedName())],
    [
      h.div(
        [h.Class('name-yard')],
        [
          stoneView(model, h),
          h.span([h.Class('name-grass'), h.AriaHidden(true)]),
        ],
      ),
      h.div(
        [h.Class('name-entry')],
        [
          h.label([h.For(NAME_INPUT_ID), h.Class('sr-only')], ['Your name']),
          h.input([
            h.Id(NAME_INPUT_ID),
            h.Class('name-input'),
            h.Type('text'),
            h.Name('name'),
            h.Value(model.profile.nameDraft),
            h.Placeholder(DEFAULT_NAME),
            h.Maxlength(MAX_NAME_LENGTH),
            h.Autocomplete('off'),
            h.Autocapitalize('words'),
            h.Spellcheck(false),
            h.EnterKeyHint('done'),
            h.OnInput(value => Message.UpdatedNameDraft({ value })),
            h.OnBlur(Message.BlurredNameInput()),
          ]),
          h.button(
            [
              h.Type('button'),
              h.Class('profile-dice name-dice'),
              h.AriaLabel('Roll a goofy name'),
              h.OnClick(Message.ClickedNameDiceButton()),
            ],
            [iconView('profile-dice-icon', DICE_ICON, h)],
          ),
        ],
      ),
      namePipsView(model, h),
    ],
  )

// ACCOUNT

type DeviceKind = 'Phone' | 'Laptop'

const DEVICE_ICONS: Readonly<Record<DeviceKind, string>> = {
  Phone: PHONE_ICON,
  Laptop: LAPTOP_ICON,
}

const MAX_DEVICES_SHOWN = 4

const deviceCount = (state: SyncState): number =>
  SyncState.match(state, {
    LocalOnly: () => 1,
    Connecting: () => 1,
    Synced: ({ devices }) => Math.max(1, devices),
    Offline: ({ devices }) => Math.max(1, devices),
  })

type SyncDot = 'Local' | 'Syncing' | 'Synced' | 'Broken'

// NOTE: a dot on every device: grey on this device only, yellow while it
// connects or waits offline, green once synced, red when sync is broken.
const syncDot = (state: SyncState, scope: PlayerScopeStatus): SyncDot => {
  if (scope._tag === 'Failed') {
    return 'Broken'
  } else {
    return SyncState.match(state, {
      LocalOnly: (): SyncDot => 'Local',
      Connecting: (): SyncDot => 'Syncing',
      Synced: (): SyncDot => 'Synced',
      Offline: (): SyncDot => 'Syncing',
    })
  }
}

// NOTE: this device is drawn as what it is. The others are unknown, so they
// take turns as the other kind.
const deviceKinds = (model: Model): ReadonlyArray<DeviceKind> => {
  const here: DeviceKind = model.lastDevice === 'Touch' ? 'Phone' : 'Laptop'
  const other: DeviceKind = here === 'Phone' ? 'Laptop' : 'Phone'
  return Array.makeBy(
    Math.min(MAX_DEVICES_SHOWN, deviceCount(model.syncState)),
    index => (index % 2 === 0 ? here : other),
  )
}

const devicesView = (model: Model, h: ApplicationViewBuilder): Html => {
  const dot = syncDot(model.syncState, model.playerScopeStatus)
  const count = deviceCount(model.syncState)
  return h.div(
    [h.Class('account-devices'), h.DataAttribute('sync', dot)],
    [
      h.ul(
        [
          h.Class('account-device-list'),
          h.AriaLabel(count === 1 ? 'Your device' : `Your ${count} devices`),
        ],
        Array.map(deviceKinds(model), (kind, index) =>
          h.li(
            [
              h.Class('account-device'),
              h.DataAttribute('kind', kind),
              h.Style({ '--i': `${index}` }),
              h.AriaLabel(
                index === 0 ? `This ${kind.toLowerCase()}` : 'Linked',
              ),
            ],
            [
              iconView('account-device-icon', DEVICE_ICONS[kind], h),
              h.span([
                h.Class('account-device-dot'),
                h.DataAttribute('sync', dot),
              ]),
            ],
          ),
        ),
      ),
      h.p(
        [
          h.Class('account-status'),
          h.Role('status'),
          h.DataAttribute('sync', dot),
          h.DataAttribute('scope', model.playerScopeStatus._tag),
          h.DataAttribute('last-run', model.lastRunSync._tag),
        ],
        [devicesStatusText(model.syncState, model.playerScopeStatus)],
      ),
    ],
  )
}

// NOTE: linking never merges. The device that types the code takes on the
// other device's player, and what it had saved is left behind (see
// "Device linking" in PLATFORM.md), so the form says so before Link.
export const LINK_TAKES_PROGRESS_NOTE =
  "This device will use the other device's progress. What was saved here is replaced, not merged."

const SHOWING_TAKES_PROGRESS_NOTE =
  "The other device takes this one's progress."

const bigButton = (
  className: string,
  icon: string,
  word: string,
  ariaLabel: string,
  message: Message,
  h: ApplicationViewBuilder,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(`account-big ${className}`),
      h.AriaLabel(ariaLabel),
      h.OnClick(message, { propagation: 'Stop' }),
    ],
    [
      iconView('account-big-icon', icon, h),
      h.span([h.Class('account-big-word')], [word]),
    ],
  )

const pillButton = (
  label: string,
  message: Message,
  tone: 'Go' | 'Back',
  h: ApplicationViewBuilder,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(
        tone === 'Go' ? 'panel-button panel-stay' : 'panel-button panel-leave',
      ),
      h.OnClick(message, { propagation: 'Stop' }),
    ],
    [label],
  )

const noteView = (
  icon: string,
  text: string,
  h: ApplicationViewBuilder,
): Html =>
  h.p(
    [h.Class('account-note')],
    [iconView('account-note-icon', icon, h), h.span([], [text])],
  )

const portalView = (
  spin: 'Spinning' | 'Open',
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [
      h.Class('account-portal'),
      h.DataAttribute('state', spin),
      h.AriaHidden(true),
    ],
    [
      h.span([h.Class('account-portal-ring')]),
      iconView('account-portal-icon', PORTAL_ICON, h),
    ],
  )

const codeView = (code: string, h: ApplicationViewBuilder): Html =>
  h.p(
    [
      h.Class('account-code'),
      h.AriaLabel(`Link code ${Array.join(Array.fromIterable(code), ' ')}`),
    ],
    Array.map(Array.fromIterable(code), (letter, index) =>
      h.span(
        [
          h.Class('account-code-letter'),
          h.AriaHidden(true),
          h.Style({ '--i': `${index}` }),
        ],
        [letter],
      ),
    ),
  )

const CODE_INPUT_ID = 'link-code-input'

const codeEntryView = (code: string, h: ApplicationViewBuilder): Html =>
  h.form(
    [h.Class('account-entry'), h.OnSubmit(Message.SubmittedLinkCode())],
    [
      h.label(
        [h.For(CODE_INPUT_ID), h.Class('account-warning')],
        [
          iconView('account-note-icon', TAKES_PROGRESS_ICON, h),
          h.span([h.Class('sr-only')], [LINK_TAKES_PROGRESS_NOTE]),
          h.span(
            [h.Class('account-warning-words'), h.AriaHidden(true)],
            [
              h.span([], ["Takes the other device's progress"]),
              h.span(
                [h.Class('account-warning-small')],
                ["What's saved here is replaced"],
              ),
            ],
          ),
        ],
      ),
      h.input([
        h.Id(CODE_INPUT_ID),
        h.Class('account-code-input'),
        h.Type('text'),
        h.Name('code'),
        h.Value(code),
        h.Maxlength(7),
        h.Placeholder('ABC234'),
        h.Autocomplete('off'),
        h.Autocapitalize('characters'),
        h.Spellcheck(false),
        h.EnterKeyHint('go'),
        h.OnInput(value => Message.UpdatedLinkCode({ value })),
      ]),
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [h.Type('submit'), h.Class('panel-button panel-stay')],
            ['Link'],
          ),
          pillButton('Cancel', Message.ClickedCancelLinkButton(), 'Back', h),
        ],
      ),
    ],
  )

const zapView = (model: Model, h: ApplicationViewBuilder): Html => {
  const here: DeviceKind = model.lastDevice === 'Touch' ? 'Phone' : 'Laptop'
  const other: DeviceKind = here === 'Phone' ? 'Laptop' : 'Phone'
  return h.div(
    [h.Class('account-zap'), h.AriaHidden(true)],
    [
      iconView('account-zap-device account-zap-left', DEVICE_ICONS[other], h),
      iconView('account-zap-bolt', ZAP_ICON, h),
      iconView('account-zap-device account-zap-right', DEVICE_ICONS[here], h),
    ],
  )
}

const linkView = (model: Model, h: ApplicationViewBuilder): Html =>
  LinkFlow.match(model.linkFlow, {
    Idle: () =>
      h.div(
        [h.Class('account-actions')],
        [
          bigButton(
            'account-summon',
            PORTAL_ICON,
            'SUMMON',
            'Link another device',
            Message.ClickedLinkDeviceButton(),
            h,
          ),
          bigButton(
            'account-use-code',
            KEYPAD_ICON,
            'USE A CODE',
            'Use a code',
            Message.ClickedUseCodeButton(),
            h,
          ),
        ],
      ),
    Requesting: () =>
      h.div(
        [h.Class('account-link'), h.Role('status')],
        [
          portalView('Spinning', h),
          h.span([h.Class('sr-only')], ['Getting a code']),
        ],
      ),
    Showing: ({ code }) =>
      h.div(
        [h.Class('account-link')],
        [
          portalView('Open', h),
          h.p(
            [h.Class('account-hint'), h.Role('status')],
            ['Type this on your other device'],
          ),
          codeView(code, h),
          noteView(CLOCK_ICON, '10 min, one use', h),
          noteView(TAKES_PROGRESS_ICON, SHOWING_TAKES_PROGRESS_NOTE, h),
          h.div(
            [h.Class('panel-actions')],
            [pillButton('Done', Message.ClickedCancelLinkButton(), 'Go', h)],
          ),
        ],
      ),
    Entering: ({ code }) => codeEntryView(code, h),
    Redeeming: () =>
      h.div(
        [h.Class('account-link'), h.Role('status')],
        [
          portalView('Spinning', h),
          h.span([h.Class('account-hint')], ['Linking']),
        ],
      ),
    Linked: () =>
      h.div(
        [h.Class('account-link')],
        [
          zapView(model, h),
          h.p(
            [h.Class('account-hint account-linked'), h.Role('status')],
            ["Linked! This device now uses your other device's progress."],
          ),
          h.div(
            [h.Class('panel-actions')],
            [pillButton('Done', Message.ClickedCancelLinkButton(), 'Go', h)],
          ),
        ],
      ),
    Failed: ({ problem }) =>
      h.div(
        [h.Class('account-link')],
        [
          h.p(
            [h.Class('account-hint account-problem'), h.Role('status')],
            [linkProblemText(problem)],
          ),
          h.div(
            [h.Class('panel-actions')],
            [
              pillButton('Use a code', Message.ClickedUseCodeButton(), 'Go', h),
              pillButton(
                'Cancel',
                Message.ClickedCancelLinkButton(),
                'Back',
                h,
              ),
            ],
          ),
        ],
      ),
  })

export const SHARE_STATS_NOTE = 'Wave, kills, and run time. Nothing personal.'

const SHARE_STATS_NOTE_ID = 'share-stats-note'

const shareStatsView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('account-share')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('setting-tile account-share-tile'),
          h.AriaLabel('Share anonymous play stats'),
          h.AriaPressed(model.shareStats === 'On' ? 'true' : 'false'),
          h.AriaDescribedBy(SHARE_STATS_NOTE_ID),
          h.OnClick(Message.ClickedShareStatsButton(), { propagation: 'Stop' }),
        ],
        [
          iconView('setting-tile-icon', STATS_ICON, h),
          h.span([h.Class('setting-tile-label')], ['STATS']),
          h.span(
            [h.Class('setting-tile-state'), h.AriaHidden(true)],
            [model.shareStats === 'On' ? 'ON' : 'OFF'],
          ),
        ],
      ),
      h.p([h.Id(SHARE_STATS_NOTE_ID), h.Class('sr-only')], [SHARE_STATS_NOTE]),
    ],
  )

const accountTabView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('account-tab')],
    [
      devicesView(model, h),
      ...(SyncState.isAnyOf(['LocalOnly'])(model.syncState)
        ? []
        : [linkView(model, h)]),
      shareStatsView(model, h),
    ],
  )

// SETTINGS

type Toggle = Readonly<{
  label: string
  shortLabel: string
  isOn: boolean
  onIcon: string
  offIcon: string
  maybeKey: Option.Option<string>
  states?: Readonly<{ on: string; off: string }>
  message: Message
}>

const ON_OFF = { on: 'ON', off: 'OFF' } as const

// NOTE: the quick toggles are icon tiles: sound, music, shake, the big
// cursor on a mouse, full screen where the browser can do it, and, on a
// phone that can lock how it turns, ROTATE: off keeps it sideways, on lets
// it follow the phone.
const settingTiles = (model: Model): ReadonlyArray<Toggle> => [
  {
    label: 'Sound',
    shortLabel: 'SOUND',
    isOn: model.soundSetting === 'On',
    onIcon: SOUND_ON_ICON,
    offIcon: SOUND_OFF_ICON,
    maybeKey: Option.some('M'),
    message: Message.ClickedMuteButton(),
  },
  {
    label: 'Music',
    shortLabel: 'MUSIC',
    isOn: model.musicSetting === 'On',
    onIcon: MUSIC_ON_ICON,
    offIcon: MUSIC_OFF_ICON,
    maybeKey: Option.some('N'),
    message: Message.ClickedMusicButton(),
  },
  {
    label: 'Screen shake',
    shortLabel: 'SHAKE',
    isOn: model.shakeSetting === 'On',
    onIcon: SHAKE_ICON,
    offIcon: SHAKE_ICON,
    maybeKey: Option.none(),
    message: Message.ClickedShakeButton(),
  },
  ...(isKeyboard(model)
    ? [
        {
          label: 'Big cursor',
          shortLabel: 'CURSOR',
          isOn: model.cursorSetting === 'Bold',
          onIcon: AIM_ICON,
          offIcon: AIM_ICON,
          maybeKey: Option.none(),
          states: { on: 'BIG', off: 'THIN' },
          message: Message.ClickedCursorButton(),
        },
      ]
    : []),
  ...(model.screenFit === 'Fullscreen'
    ? [
        {
          label: 'Full screen',
          shortLabel: 'FULL',
          isOn: model.fullscreen === 'On',
          onIcon: FULLSCREEN_ICON,
          offIcon: FULLSCREEN_ICON,
          maybeKey: Option.none(),
          message: Message.ClickedFullscreenButton(),
        },
      ]
    : []),
  ...(model.orientationLock === 'Supported'
    ? [
        {
          label: 'Turn with the phone',
          shortLabel: 'ROTATE',
          isOn: model.rotationSetting === 'Auto',
          onIcon: TURN_PHONE_ICON,
          offIcon: TURN_PHONE_ICON,
          maybeKey: Option.none(),
          states: { on: 'AUTO', off: 'LOCKED' },
          message: Message.ClickedRotationButton(),
        },
      ]
    : []),
]

const tileView = (
  model: Model,
  toggle: Toggle,
  h: ApplicationViewBuilder,
): Html =>
  h.li(
    [h.Class('setting-tile-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('setting-tile'),
          h.AriaLabel(toggle.label),
          h.AriaPressed(toggle.isOn ? 'true' : 'false'),
          ...Option.match(toggle.maybeKey, {
            onNone: () => [],
            onSome: key => [h.AriaKeyshortcuts(key)],
          }),
          h.OnClick(toggle.message, { propagation: 'Stop' }),
        ],
        [
          iconView(
            'setting-tile-icon',
            toggle.isOn ? toggle.onIcon : toggle.offIcon,
            h,
          ),
          h.span([h.Class('setting-tile-label')], [toggle.shortLabel]),
          h.span(
            [h.Class('setting-tile-state'), h.AriaHidden(true)],
            [
              toggle.isOn
                ? (toggle.states ?? ON_OFF).on
                : (toggle.states ?? ON_OFF).off,
            ],
          ),
          ...Option.match(toggle.maybeKey, {
            onNone: () => [],
            onSome: key => keyCapView(model, key, h),
          }),
        ],
      ),
    ],
  )

const resetTutorialButtonView = (h: ApplicationViewBuilder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(RESET_TUTORIAL_BUTTON_ID),
      h.Class('panel-icon-button'),
      h.AriaLabel('Reset tutorial'),
      h.OnClick(Message.ClickedResetTutorialButton(), { propagation: 'Stop' }),
    ],
    [iconView('panel-icon', REWIND_ICON, h)],
  )

// NOTE: the confirm wobbles in, so it reads as "are you sure?" at a glance.
const askResetTutorialView = (h: ApplicationViewBuilder): Html =>
  h.div(
    [
      h.Class('setting-confirm'),
      h.Role('group'),
      h.AriaLabel('Reset tutorial'),
    ],
    [
      h.p(
        [h.Class('setting-confirm-question')],
        [iconView('panel-icon', REWIND_ICON, h), 'Show the tips again?'],
      ),
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('panel-button panel-leave'),
              h.OnClick(Message.ClickedConfirmResetTutorialButton(), {
                propagation: 'Stop',
              }),
            ],
            ['Reset'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Id(KEEP_TUTORIAL_BUTTON_ID),
              h.Class('panel-button panel-stay'),
              h.OnClick(Message.ClickedCancelResetTutorialButton(), {
                propagation: 'Stop',
              }),
            ],
            ['Keep'],
          ),
        ],
      ),
    ],
  )

const settingsTabView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('settings-tab')],
    [
      h.ul(
        [h.Class('setting-tiles'), h.AriaLabel('Game settings')],
        Array.map(settingTiles(model), toggle => tileView(model, toggle, h)),
      ),
      model.tutorialReset === 'Asking'
        ? askResetTutorialView(h)
        : h.div(
            [h.Class('setting-footer')],
            [
              resetTutorialButtonView(h),
              h.p(
                [h.Class('setting-note'), h.Role('status')],
                model.tutorialReset === 'Done' ? ['Tips are back.'] : [],
              ),
            ],
          ),
    ],
  )

// PANEL

type PageAttributes = Tabs.TabInfo<ProfileTab>['panel']

const pageAttributes = (
  panel: PageAttributes,
  tab: ProfileTab,
  h: ApplicationViewBuilder,
) => [...panel, h.Class('profile-page'), h.DataAttribute('tab', tab)]

// NOTE: each tab's page is its own view, so switching tabs swaps the page
// element and its flip-in animation plays again.
const lookPageView = (
  model: Model,
  panel: PageAttributes,
  h: ApplicationViewBuilder,
): Html => h.div(pageAttributes(panel, 'Look', h), [lookTabView(model, h)])

const namePageView = (
  model: Model,
  panel: PageAttributes,
  h: ApplicationViewBuilder,
): Html => h.div(pageAttributes(panel, 'Name', h), [nameTabView(model, h)])

const accountPageView = (
  model: Model,
  panel: PageAttributes,
  h: ApplicationViewBuilder,
): Html =>
  h.div(pageAttributes(panel, 'Account', h), [accountTabView(model, h)])

const settingsPageView = (
  model: Model,
  panel: PageAttributes,
  h: ApplicationViewBuilder,
): Html =>
  h.div(pageAttributes(panel, 'Settings', h), [settingsTabView(model, h)])

const PAGE_VIEWS: Readonly<
  Record<
    ProfileTab,
    (model: Model, panel: PageAttributes, h: ApplicationViewBuilder) => Html
  >
> = {
  Look: lookPageView,
  Name: namePageView,
  Account: accountPageView,
  Settings: settingsPageView,
}

const tabsView = (
  model: Model,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  h.block(
    ProfileTabsBinding.embedView({
      slotId: model.profileTabs.id,
      model: model.profileTabs,
      viewInputs: {
        tabs: PROFILE_TABS,
        selectedValue: model.profile.tab,
        ariaLabel: 'Profile',
        orientation: isPortrait(model) ? 'Horizontal' : 'Vertical',
        toView: ({ tablist, tabs, activeIndex }) =>
          h.div(
            [h.Class('profile-body')],
            [
              h.div(
                [...tablist, h.Class('profile-tabs')],
                Array.map(tabs, tab => tabButtonView(tab, initialFocus, h)),
              ),
              ...pipe(
                tabs,
                Array.filter(tab => tab.index === activeIndex),
                Array.map(tab => PAGE_VIEWS[tab.value](model, tab.panel, h)),
              ),
            ],
          ),
      },
    }),
  )

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.h2([...title, h.Class('sr-only')], ['Profile']),
  h.p(
    [...description, h.Class('sr-only')],
    ['Your look, your name, your devices, and the settings.'],
  ),
  closeButtonView(
    {
      attributes: closeButton,
      className: 'panel-close profile-close',
      label: 'Close',
    },
    h,
  ),
  tabsView(model, initialFocus, h),
  rankPlateView(model, h),
]

export const profileView = (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.profileDialog,
      dialogClass: 'profile-dialog',
      backdropClass: 'profile-backdrop',
      panelClass: 'profile',
      dialogAttributes: [
        h.DataAttribute('tab', model.profile.tab),
        h.DataAttribute('device', model.lastDevice),
      ],
      panelView: renderInfo => panelView(model, renderInfo, h),
      binding: ProfileDialogBinding,
    },
    h,
  )
