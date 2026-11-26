import { Array, Function, Option, String } from 'effect'

import { Mount, type View } from '@effect/ui'
import { Tabs } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'

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
  RECORD_OFF_ICON,
  RECORD_ON_ICON,
  REWIND_ICON,
  RUMBLE_ICON,
  SETTINGS_ICON,
  SHAKE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
  STATS_ICON,
  TAKES_PROGRESS_ICON,
  TROPHY_ICON,
  TURN_PHONE_ICON,
  ZAP_ICON,
} from '../../art/icons'
import {
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
  nameLength,
  shownName,
} from '../../domain/playerName'
import type { InputDevice } from '../../input/inputSchema'
import {
  LinkFlow,
  SyncState,
  linkProblemText,
  syncStateText,
} from '../../platform/playerSync'
import { iconView, newPipView } from '../../ui/menuParts'
import { Character } from './blocks/look/block'
import {
  CopyLinkCodeOnClick,
  LINK_CODE_DATA,
  PasteLinkCodeOnTap,
} from './linkClipboard'
import { masteryTabView } from './masteryView'
import { Message, type SettingTile } from './message'
import type { Model, ProfileProps, ProfileTab } from './model'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  NAME_INPUT_ID,
  PROFILE_TABS,
  PROFILE_TABS_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from './profile'

type H = Html.H<Message>
type Content = View.Content<Message>
type MaybeContent = Content | null

type TabLook = Readonly<{ word: string; icon: string }>

const TAB_LOOKS: Readonly<Record<ProfileTab, TabLook>> = {
  Look: { word: 'Look', icon: CHARACTER_ICON },
  Mastery: { word: 'Mastery', icon: TROPHY_ICON },
  Name: { word: 'Name', icon: NAME_ICON },
  Account: { word: 'Account', icon: ACCOUNT_ICON },
  Settings: { word: 'Settings', icon: SETTINGS_ICON },
}

const TAB_ITEMS = Array.map(PROFILE_TABS, value => ({ value }))

type TabsParts = Parameters<NonNullable<Parameters<typeof Tabs>[1]['view']>>[0]

const tabButtonView = (
  tabs: TabsParts,
  tab: ProfileTab,
  props: ProfileProps,
  h: H,
): Content =>
  tabs
    .tab({
      element: h.button
        .key(tab)
        .class('profile-tab')
        .attrs({
          'data-tab': tab,
          autofocus: tab === props.state.tab ? '' : undefined,
        }),
      value: tab,
    })
    .children(
      iconView('profile-tab-icon', TAB_LOOKS[tab].icon, h),
      h.span.class('profile-tab-word').children(TAB_LOOKS[tab].word),
      props.isLookNew && tab === 'Look' && newPipView(h),
    )

const lookTabView = (props: ProfileProps, h: H): Content =>
  Character(h, {
    key: 'character-picker',
    props: {
      appearance: props.appearance,
      calling: props.calling,
      screenMs: props.screenMs,
      fx: props.state.fx,
      fxCount: props.state.fxCount,
      bought: props.bought,
      rank: props.rank,
      fresh: props.fresh,
      maybePreview: props.state.maybePreview,
      cue: props.state.closetCue,
    },
    onEmit: {
      ChoseLook: ({ part, value }) => Message.ChoseLook({ part, value }),
      FlippedLook: ({ toggle }) => Message.FlippedLook({ toggle }),
      RolledDice: () => Message.RolledLookDice(),
      ClickedBuy: ({ part, value }) => Message.ClickedBuyLook({ part, value }),
    },
  })

const nameLettersView = (name: string, h: H): Content =>
  h.span
    .class('name-stone-name')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(Array.fromIterable(name), (letter, index) =>
        h.span
          .class('name-stone-letter')
          .style({ '--i': `${index}` })
          .children(letter),
      ),
    )

const stoneView = (model: Model, h: H): Content =>
  h.div
    .key(`name-stone-${model.fxCount % 2}`)
    .class('name-stone')
    .attrs({
      'data-fx': model.fx,
      'data-empty': model.nameDraft === '' ? 'Empty' : 'Named',
    })
    .children(
      h.span
        .class('name-stone-rip')
        .attr('aria-hidden', 'true')
        .children('R.I.P.'),
      nameLettersView(shownName(model.nameDraft), h),
      h.span.class('name-stone-crack').attr('aria-hidden', 'true'),
    )

const namePipsView = (model: Model, h: H): Content => {
  const used = nameLength(model.nameDraft)
  const left = MAX_NAME_LENGTH - used
  return h.div
    .class('name-pips')
    .attrs({
      role: 'img',
      'aria-label': left === 1 ? '1 letter left' : `${left} letters left`,
    })
    .children(
      Array.makeBy(MAX_NAME_LENGTH, index =>
        h.span
          .class('name-pip')
          .attr('data-used', index < used ? 'Used' : 'Free'),
      ),
    )
}

const nameTabView = (model: Model, h: H): Content =>
  h.form
    .class('name-tab')
    .on('submit', Message.SubmittedName())
    .children(
      h.div
        .class('name-yard')
        .children(
          stoneView(model, h),
          h.span.class('name-grass').attr('aria-hidden', 'true'),
        ),
      h.div.class('name-entry').children(
        h.label
          .attr('for', NAME_INPUT_ID)
          .class('sr-only')
          .children('Your name'),
        h.input
          .id(NAME_INPUT_ID)
          .class('name-input')
          .attrs({
            type: 'text',
            name: 'name',
            placeholder: DEFAULT_NAME,
            maxlength: `${MAX_NAME_LENGTH}`,
            autocomplete: 'off',
            autocapitalize: 'words',
            spellcheck: 'false',
            enterkeyhint: 'done',
          })
          .value(model.nameDraft)
          .on('input', ({ value }) => Message.UpdatedNameDraft({ value }))
          .on('blur', Message.BlurredNameInput()),
        h.button
          .attrs({ type: 'button', 'aria-label': 'Roll a goofy name' })
          .class('profile-dice name-dice')
          .on('click', Message.ClickedNameDiceButton())
          .children(iconView('profile-dice-icon', DICE_ICON, h)),
      ),
      namePipsView(model, h),
    )

type DeviceKind = 'Phone' | 'Laptop'

const DEVICE_ICONS: Readonly<Record<DeviceKind, string>> = {
  Phone: PHONE_ICON,
  Laptop: LAPTOP_ICON,
}

type SyncDot = 'Local' | 'Syncing' | 'Synced'

const syncDot = (state: SyncState): SyncDot =>
  SyncState.match(state, {
    LocalOnly: (): SyncDot => 'Local',
    Connecting: (): SyncDot => 'Syncing',
    Synced: (): SyncDot => 'Synced',
    Offline: (): SyncDot => 'Syncing',
  })

const hereOf = (device: InputDevice): DeviceKind =>
  device === 'Touch' ? 'Phone' : 'Laptop'

const devicesView = (props: ProfileProps, h: H): Content => {
  const { state } = props.sync
  const dot = syncDot(state)
  const kind = hereOf(props.device)
  return h.div
    .class('account-devices')
    .attr('data-sync', dot)
    .children(
      h.ul
        .class('account-device-list')
        .attr('aria-label', 'Your device')
        .children(
          h.li
            .class('account-device')
            .attrs({
              'data-kind': kind,
              'aria-label': `This ${String.toLowerCase(kind)}`,
            })
            .style({ '--i': '0' })
            .children(
              iconView('account-device-icon', DEVICE_ICONS[kind], h),
              h.span.class('account-device-dot').attr('data-sync', dot),
            ),
        ),
      h.p
        .class('account-status')
        .attrs({ role: 'status', 'data-sync': dot })
        .children(syncStateText(state)),
    )
}

export const LINK_TAKES_PROGRESS_NOTE =
  "This device will use the other device's progress. What was saved here is replaced, not merged."

const SHOWING_TAKES_PROGRESS_NOTE =
  "The other device takes this one's progress."

type BigButton = Readonly<{
  className: string
  icon: string
  word: string
  ariaLabel: string
  message: Message
}>

const bigButton = (button: BigButton, h: H): Content =>
  h.button
    .attrs({ type: 'button', 'aria-label': button.ariaLabel })
    .class(`account-big ${button.className}`)
    .on('click', button.message)
    .children(
      iconView('account-big-icon', button.icon, h),
      h.span.class('account-big-word').children(button.word),
    )

const pillButton = (
  label: string,
  message: Message,
  tone: 'Go' | 'Back',
  h: H,
): Content =>
  h.button
    .attr('type', 'button')
    .class(
      tone === 'Go' ? 'panel-button panel-stay' : 'panel-button panel-leave',
    )
    .on('click', message)
    .children(label)

const noteView = (icon: string, text: string, h: H): Content =>
  h.p
    .class('account-note')
    .children(iconView('account-note-icon', icon, h), h.span.children(text))

const portalView = (spin: 'Spinning' | 'Open', h: H): Content =>
  h.span
    .class('account-portal')
    .attrs({ 'data-state': spin, 'aria-hidden': 'true' })
    .children(
      h.span.class('account-portal-ring'),
      iconView('account-portal-icon', PORTAL_ICON, h),
    )

const LINK_CODE_COPIED = 'COPIED!'

const codeView = (code: string, copies: number, h: H): Content =>
  h.button
    .attrs({
      type: 'button',
      [`data-${LINK_CODE_DATA}`]: code,
      'aria-label': `Link code ${Array.join(Array.fromIterable(code), ' ')}${
        copies > 0 ? ', copied' : ', tap to copy'
      }`,
    })
    .class('account-code')
    .onMount(
      CopyLinkCodeOnClick().pipe(
        Mount.map(() => Message.SucceededCopyLinkCode()),
      ),
    )
    .children(
      ...Array.map(Array.fromIterable(code), (letter, index) =>
        h.span
          .class('account-code-letter')
          .attr('aria-hidden', 'true')
          .style({ '--i': `${index}` })
          .children(letter),
      ),
      copies > 0 &&
        h.span
          .key(`copied-${copies}`)
          .class('account-code-copied')
          .attr('aria-hidden', 'true')
          .children(LINK_CODE_COPIED),
    )

const CODE_INPUT_ID = 'link-code-input'

const codeEntryView = (code: string, h: H): Content =>
  h.form
    .class('account-entry')
    .on('submit', Message.SubmittedLinkCode())
    .children(
      h.label
        .attr('for', CODE_INPUT_ID)
        .class('account-warning')
        .children(
          iconView('account-note-icon', TAKES_PROGRESS_ICON, h),
          h.span.class('sr-only').children(LINK_TAKES_PROGRESS_NOTE),
          h.span
            .class('account-warning-words')
            .attr('aria-hidden', 'true')
            .children(
              h.span.children("Takes the other device's progress"),
              h.span
                .class('account-warning-small')
                .children("What's saved here is replaced"),
            ),
        ),
      h.input
        .id(CODE_INPUT_ID)
        .class('account-code-input')
        .attrs({
          type: 'text',
          name: 'code',
          maxlength: '7',
          placeholder: 'ABC234',
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          enterkeyhint: 'go',
        })
        .value(code)
        .on('input', ({ value }) => Message.UpdatedLinkCode({ value }))
        .onMount(
          PasteLinkCodeOnTap().pipe(
            Mount.map(({ text, typed }) =>
              Message.SucceededReadClipboard({ text, typed }),
            ),
          ),
        ),
      h.div
        .class('panel-actions')
        .children(
          h.button
            .attr('type', 'submit')
            .class('panel-button panel-stay')
            .children('Link'),
          pillButton('Cancel', Message.ClickedCancelLinkButton(), 'Back', h),
        ),
    )

const zapView = (device: InputDevice, h: H): Content => {
  const here = hereOf(device)
  const other: DeviceKind = here === 'Phone' ? 'Laptop' : 'Phone'
  return h.div
    .class('account-zap')
    .attr('aria-hidden', 'true')
    .children(
      iconView('account-zap-device account-zap-left', DEVICE_ICONS[other], h),
      iconView('account-zap-bolt', ZAP_ICON, h),
      iconView('account-zap-device account-zap-right', DEVICE_ICONS[here], h),
    )
}

const linkView = (
  linkFlow: LinkFlow,
  copies: number,
  device: InputDevice,
  h: H,
): Content =>
  LinkFlow.match(linkFlow, {
    Idle: () =>
      h.div.class('account-actions').children(
        bigButton(
          {
            className: 'account-summon',
            icon: PORTAL_ICON,
            word: 'SUMMON',
            ariaLabel: 'Link another device',
            message: Message.ClickedLinkDeviceButton(),
          },
          h,
        ),
        bigButton(
          {
            className: 'account-use-code',
            icon: KEYPAD_ICON,
            word: 'USE A CODE',
            ariaLabel: 'Use a code',
            message: Message.ClickedUseCodeButton(),
          },
          h,
        ),
      ),
    Requesting: () =>
      h.div
        .class('account-link')
        .attr('role', 'status')
        .children(
          portalView('Spinning', h),
          h.span.class('sr-only').children('Getting a code'),
        ),
    Showing: ({ code }) =>
      h.div
        .class('account-link')
        .children(
          portalView('Open', h),
          h.p
            .class('account-hint')
            .attr('role', 'status')
            .children('Type this on your other device'),
          codeView(code, copies, h),
          noteView(CLOCK_ICON, '10 min, one use', h),
          noteView(TAKES_PROGRESS_ICON, SHOWING_TAKES_PROGRESS_NOTE, h),
          h.div
            .class('panel-actions')
            .children(
              pillButton('Done', Message.ClickedCancelLinkButton(), 'Go', h),
            ),
        ),
    Entering: ({ code }) => codeEntryView(code, h),
    Redeeming: () =>
      h.div
        .class('account-link')
        .attr('role', 'status')
        .children(
          portalView('Spinning', h),
          h.span.class('account-hint').children('Linking'),
        ),
    Linked: () =>
      h.div
        .class('account-link')
        .children(
          zapView(device, h),
          h.p
            .class('account-hint account-linked')
            .attr('role', 'status')
            .children(
              "Linked! This device now uses your other device's progress.",
            ),
          h.div
            .class('panel-actions')
            .children(
              pillButton('Done', Message.ClickedCancelLinkButton(), 'Go', h),
            ),
        ),
    Failed: ({ problem }) =>
      h.div
        .class('account-link')
        .children(
          h.p
            .class('account-hint account-problem')
            .attr('role', 'status')
            .children(linkProblemText(problem)),
          h.div
            .class('panel-actions')
            .children(
              pillButton('Use a code', Message.ClickedUseCodeButton(), 'Go', h),
              pillButton(
                'Cancel',
                Message.ClickedCancelLinkButton(),
                'Back',
                h,
              ),
            ),
        ),
  })

export const SHARE_STATS_NOTE = 'Wave, kills, and run time. Nothing personal.'

const SHARE_STATS_NOTE_ID = 'share-stats-note'

const shareStatsView = (props: ProfileProps, h: H): Content =>
  h.div.class('account-share').children(
    h.button
      .attrs({
        type: 'button',
        'aria-label': 'Share anonymous play stats',
        'aria-pressed': props.settings.shareStats === 'On' ? 'true' : 'false',
        'aria-describedby': SHARE_STATS_NOTE_ID,
      })
      .class('setting-tile account-share-tile')
      .on('click', Message.ClickedSettingTile({ setting: 'ShareStats' }))
      .children(
        iconView('setting-tile-icon', STATS_ICON, h),
        h.span.class('setting-tile-label').children('STATS'),
        h.span
          .class('setting-tile-state')
          .attr('aria-hidden', 'true')
          .children(props.settings.shareStats === 'On' ? 'ON' : 'OFF'),
      ),
    h.p.id(SHARE_STATS_NOTE_ID).class('sr-only').children(SHARE_STATS_NOTE),
  )

const accountTabView = (props: ProfileProps, h: H): Content =>
  h.div
    .class('account-tab')
    .children(
      devicesView(props, h),
      !SyncState.isAnyOf(['LocalOnly'])(props.sync.state) &&
        linkView(
          props.state.linkFlow,
          props.state.linkCodeCopies,
          props.device,
          h,
        ),
      shareStatsView(props, h),
    )

type Toggle = Readonly<{
  label: string
  shortLabel: string
  isOn: boolean
  onIcon: string
  offIcon: string
  maybeKey: Option.Option<string>
  states?: Readonly<{ on: string; off: string }>
  setting: SettingTile
}>

const ON_OFF = { on: 'ON', off: 'OFF' } as const

const shownWhen = (isShown: boolean, toggle: Toggle): ReadonlyArray<Toggle> =>
  isShown ? [toggle] : []

const settingTiles = ({
  device,
  settings,
}: ProfileProps): ReadonlyArray<Toggle> => [
  {
    label: 'Sound',
    shortLabel: 'SOUND',
    isOn: settings.sound === 'On',
    onIcon: SOUND_ON_ICON,
    offIcon: SOUND_OFF_ICON,
    maybeKey: Option.some('M'),
    setting: 'Sound',
  },
  {
    label: 'Music',
    shortLabel: 'MUSIC',
    isOn: settings.music === 'On',
    onIcon: MUSIC_ON_ICON,
    offIcon: MUSIC_OFF_ICON,
    maybeKey: Option.some('N'),
    setting: 'Music',
  },
  {
    label: 'Screen shake',
    shortLabel: 'SHAKE',
    isOn: settings.shake === 'On',
    onIcon: SHAKE_ICON,
    offIcon: SHAKE_ICON,
    maybeKey: Option.none(),
    setting: 'Shake',
  },
  ...shownWhen(device === 'KeyboardMouse', {
    label: 'Big cursor',
    shortLabel: 'CURSOR',
    isOn: settings.cursor === 'Bold',
    onIcon: AIM_ICON,
    offIcon: AIM_ICON,
    maybeKey: Option.none(),
    states: { on: 'BIG', off: 'THIN' },
    setting: 'Cursor',
  }),
  ...shownWhen(settings.screenFit === 'Fullscreen', {
    label: 'Full screen',
    shortLabel: 'FULL',
    isOn: settings.fullscreen === 'On',
    onIcon: FULLSCREEN_ICON,
    offIcon: FULLSCREEN_ICON,
    maybeKey: Option.none(),
    setting: 'Fullscreen',
  }),
  ...shownWhen(settings.orientationLock === 'Supported', {
    label: 'Turn with the phone',
    shortLabel: 'ROTATE',
    isOn: settings.rotation === 'Auto',
    onIcon: TURN_PHONE_ICON,
    offIcon: TURN_PHONE_ICON,
    maybeKey: Option.none(),
    states: { on: 'AUTO', off: 'LOCKED' },
    setting: 'Rotation',
  }),
  ...shownWhen(settings.hasPad, {
    label: 'Controller rumble',
    shortLabel: 'RUMBLE',
    isOn: settings.rumble === 'On',
    onIcon: RUMBLE_ICON,
    offIcon: RUMBLE_ICON,
    maybeKey: Option.none(),
    setting: 'Rumble',
  }),
  ...shownWhen(settings.recordUnlock === 'Unlocked', {
    label: 'Record my runs',
    shortLabel: 'RECORD',
    isOn: settings.recordRuns === 'On',
    onIcon: RECORD_ON_ICON,
    offIcon: RECORD_OFF_ICON,
    maybeKey: Option.none(),
    setting: 'RecordRuns',
  }),
]

const keyCapOf = (
  device: InputDevice,
  maybeKey: Option.Option<string>,
  h: H,
): MaybeContent =>
  Option.match(maybeKey, {
    onNone: (): MaybeContent => null,
    onSome: (key): MaybeContent =>
      device === 'KeyboardMouse'
        ? h.span.class('home-key').attr('aria-hidden', 'true').children(key)
        : null,
  })

const tileView = (device: InputDevice, toggle: Toggle, h: H): Content =>
  h.li.class('setting-tile-item').children(
    h.button
      .attrs({
        type: 'button',
        'aria-label': toggle.label,
        'aria-pressed': toggle.isOn ? 'true' : 'false',
        'aria-keyshortcuts': Option.getOrUndefined(toggle.maybeKey),
      })
      .class('setting-tile')
      .on('click', Message.ClickedSettingTile({ setting: toggle.setting }))
      .children(
        iconView(
          'setting-tile-icon',
          toggle.isOn ? toggle.onIcon : toggle.offIcon,
          h,
        ),
        h.span.class('setting-tile-label').children(toggle.shortLabel),
        h.span
          .class('setting-tile-state')
          .attr('aria-hidden', 'true')
          .children(
            toggle.isOn
              ? (toggle.states ?? ON_OFF).on
              : (toggle.states ?? ON_OFF).off,
          ),
        keyCapOf(device, toggle.maybeKey, h),
      ),
  )

const resetTutorialButtonView = (h: H): Content =>
  h.button
    .id(RESET_TUTORIAL_BUTTON_ID)
    .attrs({ type: 'button', 'aria-label': 'Reset tutorial' })
    .class('panel-icon-button')
    .on('click', Message.ClickedResetTutorialButton())
    .children(
      iconView('panel-icon', REWIND_ICON, h),
      h.span
        .class('panel-icon-label')
        .attr('aria-hidden', 'true')
        .children('TUTORIAL'),
    )

const askResetTutorialView = (h: H): Content =>
  h.div
    .class('setting-confirm')
    .attrs({ role: 'group', 'aria-label': 'Reset tutorial' })
    .children(
      h.p
        .class('setting-confirm-question')
        .children(
          iconView('panel-icon', REWIND_ICON, h),
          'Show the tips again?',
        ),
      h.div
        .class('panel-actions')
        .children(
          h.button
            .attr('type', 'button')
            .class('panel-button panel-leave')
            .on('click', Message.ClickedConfirmResetTutorialButton())
            .children('Reset'),
          h.button
            .id(KEEP_TUTORIAL_BUTTON_ID)
            .attr('type', 'button')
            .class('panel-button panel-stay')
            .on('click', Message.ClickedCancelResetTutorialButton())
            .children('Keep'),
        ),
    )

const settingsTabView = (props: ProfileProps, h: H): Content =>
  h.div.class('settings-tab').children(
    h.ul
      .class('setting-tiles')
      .attr('aria-label', 'Game settings')
      .children(
        Array.map(settingTiles(props), toggle =>
          tileView(props.device, toggle, h),
        ),
      ),
    props.state.tutorialReset === 'Asking'
      ? askResetTutorialView(h)
      : h.div.class('setting-footer').children(
          resetTutorialButtonView(h),
          h.p
            .class('setting-note')
            .attr('role', 'status')
            .children(props.state.tutorialReset === 'Done' && 'Tips are back.'),
        ),
  )

const PAGE_VIEWS: Readonly<
  Record<ProfileTab, (props: ProfileProps, h: H) => Content>
> = {
  Look: lookTabView,
  Mastery: (props, h) =>
    masteryTabView(
      { mastery: props.mastery, picked: props.picked, look: props.appearance },
      h,
    ),
  Name: (props, h) => nameTabView(props.state, h),
  Account: accountTabView,
  Settings: settingsTabView,
}

export const profileView: {
  (h: H): (props: ProfileProps) => Content
  (props: ProfileProps, h: H): Content
} = Function.dual(2, (props: ProfileProps, h: H): Content =>
  Tabs(h, {
    key: PROFILE_TABS_ID,
    props: {
      value: props.state.tab,
      tabs: TAB_ITEMS,
      orientation: props.isPortrait ? 'horizontal' : 'vertical',
      activateOnFocus: true,
    },
    onEmit: { Selected: ({ value }) => Message.SelectedTab({ value }) },
    view: tabs =>
      tabs.root(h.div.class('profile-body')).children(
        tabs
          .list(h.div.class('profile-tabs').attr('aria-label', 'Profile'))
          .children(
            Array.map(PROFILE_TABS, tab => tabButtonView(tabs, tab, props, h)),
          ),
        tabs
          .panel({
            element: h.div
              .key(props.state.tab)
              .class('profile-page')
              .attr('data-tab', props.state.tab),
            value: props.state.tab,
          })
          ?.children(PAGE_VIEWS[props.state.tab](props, h)),
      ),
  }),
)
