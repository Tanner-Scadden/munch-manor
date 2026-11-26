import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { Tabs, TabsEvents } from '@effect/ui-kit'
import { HtmlLocator, HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { describe, expect, it, layer } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { profilePropsOf } from '../../../app/profileView'
import { RequestLinkCode } from '../../../app/update/profile'
import { PROFILE_DIALOG_ID } from '../../../domain/clientSchema'
import { LinkFlow, SyncState } from '../../../platform/playerSync'
import { homeAfterRead, inPortrait } from '../../../test/model.fixture'
import {
  button,
  byClass,
  emitPressedKey,
  measureSurface,
  profileDialog,
  requestDialogClose,
  settingsButton,
  showDialog,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type SceneStep,
  type StoryStep,
  sceneOf,
  send,
  settleRunCommands,
  steps,
} from '../../../test/testing'
import { Profile } from '../block'
import { CopyLinkCodeOnClick, PasteLinkCodeOnTap } from '../linkClipboard'
import { Events } from '../message'
import { PROFILE_TABS_ID } from '../profile'
import { LINK_TAKES_PROGRESS_NOTE, SHARE_STATS_NOTE } from '../view'
import {
  type ProfileDesk,
  type ProfileScene,
  atRoot,
  characterButton,
  inPanel,
  profileDeskOf,
  profileOpenOn,
} from './profile.fixture'

// The Profile as a player meets it. The root's Scene opens and closes its
// Dialog; the Profile is a child there, so its tabs and pages are drawn in
// a Scene of their own, with each event taken up to a Story of the root and
// the props it then hands down (profile.fixture.ts).

const onTouch: Model = UiStruct.evolve(homeAfterRead, {
  lastDevice: () => 'Touch',
})

const synced: Model = UiStruct.evolve(homeAfterRead, {
  saving: saving =>
    UiStruct.evolve(saving, {
      syncState: () => SyncState.Synced({ devices: 2 }),
    }),
})

const tab = (name: string) => HtmlLocator.role('tab', { name })
const tablist = HtmlLocator.role('tablist', { name: 'Profile' })

// NOTE: a check on the Profile's Scene, as a step over the desk.
const see = (check: (scene: ProfileScene) => ProfileScene) => inPanel(check)

// NOTE: the one element `locator` finds wears `attrs`.
const has = (
  locator: Locator.Locator,
  attrs: Readonly<Record<string, string>>,
) => see(s => s.expect(withAttrs(attrs)(locator)).toExist())

// NOTE: the one element `locator` finds has no `name` attribute: the kit's
// Tabs writes `aria-orientation` only for a vertical list.
const lacks = (locator: Locator.Locator, name: string) =>
  see(s =>
    s.check(() => {
      if (s.get(locator).attrs?.[name] !== undefined) {
        throw new Error(`${locator.description} has ${name}`)
      }
    }),
  )

const selected = (name: string) => has(tab(name), { 'aria-selected': 'true' })

// NOTE: a tab picked, as the kit's Tabs says it: a scene runs no child's
// update, so its click and keys are the Play's below.
const atTab = (name: string) =>
  inPanel(s =>
    s.childEmit(
      Tabs,
      PROFILE_TABS_ID,
      TabsEvents.Selected({ value: name, activationDirection: 'none' }),
    ),
  )

// NOTE: the Profile opened by `open` on the root, drawn from what it left.
const deskOpenedBy = (model: Model, open: StoryStep) =>
  Effect.map(profileDeskOf(model), atRoot(open))

const settle = atRoot(settleRunCommands)

describe("the Profile's Dialog", () => {
  it.effect('the gear opens it, and its close shuts it', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(synced)
      s.pipe(
        measureSurface,
        scene => scene.click(settingsButton),
        showDialog(PROFILE_DIALOG_ID),
      )
        .expect(profileDialog)
        .toExist()
      s.pipe(requestDialogClose(PROFILE_DIALOG_ID, 'close-press'))
        .expect(profileDialog)
        .toBeAbsent()
    }),
  )

  it.effect('every entry point opens it, on its tab', () =>
    Effect.forEach(
      [
        {
          open: s => s.click(settingsButton),
          message: Message.ClickedSettingsButton(),
          tab: 'Settings',
        },
        {
          open: emitPressedKey('KeyO'),
          message: Message.PressedKey({ code: 'KeyO' }),
          tab: 'Settings',
        },
        {
          open: emitPressedKey('KeyC'),
          message: Message.PressedKey({ code: 'KeyC' }),
          tab: 'Look',
        },
        {
          open: s => s.click(characterButton),
          message: Message.ClickedCharacterButton(),
          tab: 'Look',
        },
      ] satisfies ReadonlyArray<
        Readonly<{ open: SceneStep; message: Message; tab: string }>
      >,
      ({ open, message, tab: name }) =>
        Effect.gen(function* () {
          const s = yield* sceneOf(homeAfterRead)
          s.pipe(measureSurface, open, showDialog(PROFILE_DIALOG_ID))
            .expect(profileDialog)
            .toExist()
          const desk = yield* deskOpenedBy(homeAfterRead, send(message))
          steps<ProfileDesk>(selected(name), settle)(desk)
        }),
      { discard: true },
    ),
  )
})

describe('the Profile', () => {
  it.effect(
    'the gear opens it on Settings: five tabs, sound and friends, and no devices or stats sharing',
    () =>
      Effect.gen(function* () {
        const desk = yield* deskOpenedBy(
          synced,
          send(Message.ClickedSettingsButton()),
        )
        steps<ProfileDesk>(
          see(s =>
            s
              .expect(Locator.inside(tablist, HtmlLocator.role('tab')))
              .toHaveCount(5)
              .expect(tab('Look'))
              .toExist()
              .expect(tab('Name'))
              .toExist()
              .expect(tab('Account'))
              .toExist()
              .expect(tab('Mastery'))
              .toExist(),
          ),
          selected('Settings'),
          has(tablist, { 'aria-orientation': 'vertical' }),
          see(s =>
            s
              .expect(button('Sound'))
              .toExist()
              .expect(button('Reset tutorial'))
              .toExist()
              .expect(button('Use a code'))
              .toBeAbsent()
              .expect(button('Link another device'))
              .toBeAbsent()
              .expect(button('Share anonymous play stats'))
              .toBeAbsent()
              .expect(button(/^Devices/))
              .toBeAbsent(),
          ),
          settle,
        )(desk)
      }),
  )

  it.effect(
    'down the side in landscape, across the top upright on a phone',
    () =>
      Effect.gen(function* () {
        const side = yield* deskOpenedBy(
          homeAfterRead,
          send(Message.PressedKey({ code: 'KeyC' })),
        )
        steps<ProfileDesk>(
          selected('Look'),
          has(tablist, { 'aria-orientation': 'vertical' }),
          settle,
        )(side)
        const upright = yield* deskOpenedBy(
          inPortrait(onTouch),
          send(Message.ClickedCharacterButton()),
        )
        steps<ProfileDesk>(
          selected('Look'),
          lacks(tablist, 'aria-orientation'),
          settle,
        )(upright)
      }),
  )

  it.effect('a switched tab shows its own page', () =>
    Effect.gen(function* () {
      const desk = yield* deskOpenedBy(
        homeAfterRead,
        send(Message.PressedKey({ code: 'KeyC' })),
      )
      steps<ProfileDesk>(
        atTab('Name'),
        selected('Name'),
        see(s =>
          s
            .expect(HtmlLocator.role('textbox', { name: 'Your name' }))
            .toExist(),
        ),
        atTab('Mastery'),
        selected('Mastery'),
        see(s =>
          s
            .expect(HtmlLocator.role('list', { name: 'Heroes' }))
            .toExist()
            .expect(HtmlLocator.role('list', { name: 'Guns' }))
            .toExist(),
        ),
        settle,
      )(desk)
    }),
  )

  it.effect('a tap on a tab switches to it', () =>
    Effect.gen(function* () {
      const desk = yield* deskOpenedBy(
        UiStruct.evolve(synced, { lastDevice: () => 'Touch' }),
        send(Message.ClickedSettingsButton()),
      )
      steps<ProfileDesk>(
        atTab('Account'),
        selected('Account'),
        see(s =>
          s
            .expect(HtmlLocator.role('list', { name: 'Your 2 devices' }))
            .toExist()
            .expect(HtmlLocator.role('status'))
            .toExist(),
        ),
        atTab('Look'),
        selected('Look'),
        has(byClass('profile-page'), { 'data-tab': 'Look' }),
        settle,
      )(desk)
    }),
  )
})

describe('the Name tab', () => {
  const nameField = HtmlLocator.role('textbox', { name: 'Your name' })
  const stone = byClass('name-stone-name')

  it.effect(
    'the stone shows the placeholder, then the name as it is typed, and Enter keeps it',
    () =>
      Effect.gen(function* () {
        const desk = yield* deskOpenedBy(
          homeAfterRead,
          send(Message.ClickedSettingsButton()),
        )
        steps<ProfileDesk>(
          atTab('Name'),
          see(s => s.expect(stone).toHaveText('Survivor')),
          has(nameField, { placeholder: 'Survivor' }),
          see(s =>
            s
              .expect(HtmlLocator.role('img', { name: '12 letters left' }))
              .toExist(),
          ),
          inPanel(s => s.type(nameField, 'Gravy Dave')),
          see(s =>
            s
              .expect(stone)
              .toHaveText('Gravy Dave')
              .expect(HtmlLocator.role('img', { name: '2 letters left' }))
              .toExist(),
          ),
          inPanel(s => s.submit(byClass('name-tab'))),
          see(s => s.expect(nameField).toHaveValue('Gravy Dave')),
          settle,
        )(desk)
      }),
  )

  it.effect('the dice rolls a goofy name onto the stone', () =>
    Effect.gen(function* () {
      const desk = yield* deskOpenedBy(
        UiStruct.evolve(homeAfterRead, {
          cosmetics: cosmetics =>
            UiStruct.evolve(cosmetics, { cosmeticRngState: () => 99 }),
        }),
        send(Message.ClickedSettingsButton()),
      )
      steps<ProfileDesk>(
        atTab('Name'),
        inPanel(s => s.click(button('Roll a goofy name'))),
        see(s =>
          s.check(() => {
            if (Locator.textOf(s.get(stone)) === 'Survivor') {
              throw new Error('the stone still reads Survivor')
            }
          }),
        ),
        has(byClass('name-stone'), { 'data-fx': 'Spin' }),
        settle,
      )(desk)
    }),
  )
})

describe('the Account tab', () => {
  const codeField = HtmlLocator.role('textbox', {
    name: LINK_TAKES_PROGRESS_NOTE,
  })

  const onAccount = (model: Model) =>
    Effect.map(
      deskOpenedBy(model, send(Message.ClickedSettingsButton())),
      atTab('Account'),
    )

  it.effect(
    "Use a code says this device will take the other device's progress before Link",
    () =>
      Effect.gen(function* () {
        const desk = yield* onAccount(synced)
        steps<ProfileDesk>(
          see(s =>
            s.expect(Locator.text(LINK_TAKES_PROGRESS_NOTE)).toBeAbsent(),
          ),
          inPanel(s => s.click(button('Use a code'))),
          see(s =>
            s
              .expect(Locator.text(LINK_TAKES_PROGRESS_NOTE))
              .toExist()
              .expect(codeField)
              .toExist()
              .expect(button('Link'))
              .toExist(),
          ),
          inPanel(s =>
            s.mounted(PasteLinkCodeOnTap, { text: 'hi', typed: '' }),
          ),
          see(s => s.expect(codeField).toHaveValue('')),
          settle,
        )(desk)
      }),
  )

  it.effect(
    'summoning shows the code in big letters, and a tap copies it with COPIED! in place',
    () =>
      Effect.gen(function* () {
        const desk = yield* onAccount(synced)
        steps<ProfileDesk>(
          inPanel(s => s.click(button('Link another device'))),
          atRoot(s =>
            s.resolve(
              RequestLinkCode,
              Message.SucceededRequestLinkCode({ code: 'KZ7QWM' }),
            ),
          ),
          see(s =>
            s
              .expect(button('Link code K Z 7 Q W M, tap to copy'))
              .toExist()
              .expect(byClass('account-code-letter'))
              .toHaveCount(6)
              .expect(Locator.text('COPIED!'))
              .toBeAbsent(),
          ),
          has(byClass('account-code'), { 'data-link-code': 'KZ7QWM' }),
          inPanel(s => s.mounted(CopyLinkCodeOnClick, undefined)),
          see(s =>
            s
              .expect(button('Link code K Z 7 Q W M, copied'))
              .toExist()
              .expect(Locator.text('COPIED!'))
              .toExist(),
          ),
          inPanel(s => s.mounted(CopyLinkCodeOnClick, undefined)),
          see(s => s.expect(Locator.text('COPIED!')).toHaveCount(1)),
          settle,
        )(desk)
      }),
  )

  it.effect('a pasted code fills the field', () =>
    Effect.gen(function* () {
      const desk = yield* onAccount(synced)
      steps<ProfileDesk>(
        inPanel(s => s.click(button('Use a code'))),
        inPanel(s =>
          s.mounted(PasteLinkCodeOnTap, { text: 'kz7 qwm', typed: '' }),
        ),
        see(s => s.expect(codeField).toHaveValue('KZ7QWM')),
        settle,
      )(desk)
    }),
  )

  it.effect('the devices zap together once linked', () =>
    Effect.gen(function* () {
      const desk = yield* onAccount(
        UiStruct.evolve(synced, {
          profile: profile =>
            UiStruct.evolve(profile, { linkFlow: () => LinkFlow.Linked() }),
        }),
      )
      steps<ProfileDesk>(
        see(s =>
          s
            .expect(byClass('account-zap'))
            .toExist()
            .expect(
              Locator.text(
                "Linked! This device now uses your other device's progress.",
              ),
            )
            .toExist(),
        ),
        settle,
      )(desk)
    }),
  )

  it.effect('stats sharing is one icon toggle, its note read aloud', () =>
    Effect.gen(function* () {
      const shareToggle = button('Share anonymous play stats')
      const desk = yield* onAccount(homeAfterRead)
      steps<ProfileDesk>(
        has(shareToggle, { 'aria-pressed': 'true' }),
        has(shareToggle, { 'aria-describedby': 'share-stats-note' }),
        see(s => s.expect(Locator.text(SHARE_STATS_NOTE)).toExist()),
        inPanel(s => s.click(shareToggle)),
        has(shareToggle, { 'aria-pressed': 'false' }),
        see(s => s.expect(button('Link another device')).toBeAbsent()),
        settle,
      )(desk)
    }),
  )
})

describe('RECORD MY RUNS', () => {
  const recordTile = button('Record my runs')

  it.effect('is hidden on a device never opened with ?record=1', () =>
    Effect.gen(function* () {
      const desk = yield* deskOpenedBy(
        homeAfterRead,
        send(Message.ClickedSettingsButton()),
      )
      steps<ProfileDesk>(
        see(s =>
          s.expect(button('Sound')).toExist().expect(recordTile).toBeAbsent(),
        ),
        settle,
      )(desk)
    }),
  )

  it.effect('shows on an unlocked device, off until tapped', () =>
    Effect.gen(function* () {
      const desk = yield* deskOpenedBy(
        UiStruct.evolve(homeAfterRead, { recordUnlock: () => 'Unlocked' }),
        send(Message.ClickedSettingsButton()),
      )
      steps<ProfileDesk>(
        has(recordTile, { 'aria-pressed': 'false' }),
        inPanel(s => s.click(recordTile)),
        has(recordTile, { 'aria-pressed': 'true' }),
        settle,
      )(desk)
    }),
  )
})

// The tab strip's own keys and taps are the kit's Tabs, a child the Profile's
// Scene runs no update of: a Play of the Profile runs it, and each says what
// it switched to. An arrow key moves focus between the tabs (the kit's own
// rule, by the orientation the Profile hands it, checked above) through a
// Focus Command TestHost can't carry out, so the Play gives the tab focus
// as the arrow would: the tab that takes it switches to it
// (`activateOnFocus`), as the old Profile switched on an arrow.
// NOTE: @effect/vitest's layer hands its tests their own `it`, which the
// vitest rules know as the test block; it stands in for the module's.
// oxlint-disable-next-line no-shadow -- the layer's own `it`
layer(TestHost.layer())('the tab strip', it => {
  const playOn = (model: Model) => HtmlPlay.make(Profile, profilePropsOf(model))

  const lastSwitch = (emitted: ReadonlyArray<Events>) => Array.last(emitted)

  it.effect('a tab the arrow keys move to switches to it', () =>
    Effect.forEach(
      [
        profileOpenOn('Settings'),
        inPortrait(
          UiStruct.evolve(profileOpenOn('Settings'), {
            lastDevice: () => 'Touch',
          }),
        ),
      ],
      model =>
        Effect.gen(function* () {
          const play = yield* playOn(model)
          yield* play.focus(tab('Name'))
          expect(lastSwitch(play.root.emitted)).toStrictEqual(
            Option.some(Events.SwitchedTab({ tab: 'Name' })),
          )
          yield* play.focus(tab('Mastery'))
          expect(lastSwitch(play.root.emitted)).toStrictEqual(
            Option.some(Events.SwitchedTab({ tab: 'Mastery' })),
          )
        }),
      { discard: true },
    ),
  )

  it.effect('a tap on a tab switches to it', () =>
    Effect.gen(function* () {
      const play = yield* playOn(profileOpenOn('Settings'))
      yield* play.click(tab('Account'))
      expect(lastSwitch(play.root.emitted)).toStrictEqual(
        Option.some(Events.SwitchedTab({ tab: 'Account' })),
      )
      yield* play.click(tab('Look'))
      expect(lastSwitch(play.root.emitted)).toStrictEqual(
        Option.some(Events.SwitchedTab({ tab: 'Look' })),
      )
    }),
  )
})
