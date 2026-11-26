import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { BreakClock, type Model, Phase } from '../../../app/model'
import { profilePropsOf } from '../../../app/profileView'
import { initialModel } from '../../../app/pureApp'
import { ShowInstallPrompt } from '../../../app/update/home'
import {
  HOME_SCREEN_STEPS_ID,
  PROFILE_DIALOG_ID,
} from '../../../domain/clientSchema'
import { InstallMessage } from '../../../platform/message'
import { PREPARATION_MS } from '../../../shared/constants'
import { holdingSecond } from '../../../test/arsenals'
import {
  ackHudSlots,
  button,
  byClass,
  clickOn,
  emitFrame,
  emitPressedKey,
  expectAttr,
  expectClass,
  expectStyle,
  fromSubscription,
  homeUnderLobby,
  measureHud,
  pauseButton,
  pauseByButton,
  pressHudSlot,
  pressSurface,
  profileDialog,
  requestDialogClose,
  settingsButton,
  showDialog,
  statusLine,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  modelAfter,
  resolveFocusLobby,
  sceneOf,
  send,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { tierName } from '../../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { type Player } from '../../../world/schema/worldSchema'
import { Profile } from '../../profile/block'

const SMG_NAME = tierName('Smg', 0)

const onTouch = (base: Model): Model =>
  UiStruct.evolve(asVeteran(base), { lastDevice: () => 'Touch' })

const withSmg = (loaded: number): Player =>
  UiStruct.evolve(focusOf(initialModel).player, {
    arsenal: () => holdingSecond({ kind: 'Smg', loaded, tier: 0, kills: 0 }),
  })

const fightingWith = (loaded: number): Model =>
  modifyFocus(
    UiStruct.evolve(onTouch(initialModel), {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
    }),
    { player: () => withSmg(loaded) },
  )

const breakWithTraps: Model = modifyFocus(
  UiStruct.evolve(onTouch(initialModel), {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave: 3,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns: [],
      }),
  }),
  { trapStock: () => ({ Barricade: 1, Turret: 1 }) },
)

// NOTE: a gun slot by its name: the reload button past the knife shares the
// held gun's name, so a slot is looked for among the slots.
const slotNamed = (name: string) =>
  Locator.inside(byClass('gun-slots'), button(name))

const reloadButton = byClass('reload-button')
const muteButton = button('Mute sound')
const musicButton = button('Music')
const fullscreenButton = button('Full screen')
const placeTrap = button('Place a Plank Pile')
const nextTrap = button('Switch to the Grumpy Gnome')
const startWave = button('Start wave 3 now')
const homeScreenTip = button('Add to Home Screen: show me how')
const installButton = button('Install Munch Manor')
const moveStick = withAttrs({ 'data-stick': 'move' })(byClass('touch-stick'))
const keyBadgeIn = (locator: Locator.Locator) =>
  Locator.inside(locator, byClass('key-badge'))
const slotNumberIn = (locator: Locator.Locator) =>
  Locator.inside(locator, byClass('slot-number'))

// NOTE: a thumb on the left of the surface: the move stick.
const moveThumb = pressSurface({
  pointerId: 3,
  device: 'Touch',
  clientX: 120,
  clientY: 260,
})

const PAUSED_LINE =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

describe('the reload button', () => {
  it.effect(
    'is always there on touch, dim and inert with a full magazine',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fightingWith(30))
        s.pipe(
          measureHud,
          expectAttr(reloadButton, 'aria-keyshortcuts', 'R'),
          expectAttr(reloadButton, 'data-ready', 'false'),
          expectAttr(reloadButton, 'aria-disabled', 'true'),
        )
          .expect(reloadButton)
          .toExist()
      }),
  )

  it.effect('reloads the held gun on a tap, and dims while it reloads', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fightingWith(20))
      s.pipe(
        measureHud,
        expectAttr(reloadButton, 'data-ready', 'true'),
        expectAttr(reloadButton, 'aria-disabled', undefined),
        clickOn(reloadButton),
        expectAttr(reloadButton, 'data-ready', 'false'),
        expectAttr(
          slotNamed(`Reload the ${SMG_NAME}`),
          'aria-disabled',
          'true',
        ),
      )
    }),
  )

  it.effect(
    'with the knife out, draws the last gun and reloads it, as R does',
    () =>
      Effect.gen(function* () {
        const knifeOut = modifyFocus(fightingWith(20), {
          player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
        })
        const s = yield* sceneOf(knifeOut)
        s.pipe(
          measureHud,
          expectAttr(
            reloadButton,
            'aria-label',
            `Draw and reload the ${SMG_NAME}`,
          ),
          clickOn(reloadButton),
          expectAttr(
            withAttrs({ 'data-slot': 'Melee' })(byClass('gun-slot-button')),
            'data-held',
            'false',
          ),
          expectAttr(slotNamed(`Reload the ${SMG_NAME}`), 'data-held', 'true'),
          expectAttr(reloadButton, 'data-ready', 'false'),
        )
      }),
  )

  it.effect(
    'with the knife out and a full magazine, is dim but still draws the gun',
    () =>
      Effect.gen(function* () {
        const knifeOut = modifyFocus(fightingWith(30), {
          player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
        })
        const s = yield* sceneOf(knifeOut)
        s.pipe(
          measureHud,
          expectAttr(reloadButton, 'data-ready', 'false'),
          expectAttr(reloadButton, 'aria-disabled', undefined),
          clickOn(reloadButton),
          expectAttr(slotNamed(`Reload the ${SMG_NAME}`), 'data-held', 'true'),
        )
      }),
  )

  it.effect('works with the move stick held by another finger', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fightingWith(20))
      s.pipe(measureHud, moveThumb).expect(moveStick).toExist()
      s.pipe(
        clickOn(reloadButton),
        expectAttr(reloadButton, 'data-ready', 'false'),
      )
        .expect(moveStick)
        .toExist()
    }),
  )

  it.effect('is not on a keyboard and mouse: R reloads there', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(fightingWith(20), {
          lastDevice: () => 'KeyboardMouse',
        }),
      )
      s.pipe(measureHud).expect(reloadButton).toBeAbsent()
    }),
  )
})

describe('the gun cluster', () => {
  const cluster = byClass('gun-cluster')
  const smgSlot = slotNamed(`Reload the ${SMG_NAME}`)
  const pistolSlot = slotNamed('Switch to the Pop Pistol')
  const knifeSlot = withAttrs({ 'data-slot': 'Melee' })(
    byClass('gun-slot-button'),
  )

  it.effect('sits at the bottom middle with the held gun marked', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fightingWith(30))
      s.pipe(
        measureHud,
        // NOTE: the 2:1 surface widens the screen to 360
        // (src/render/screen.ts), and the gun pair stays centered on it, 20
        // pixels further right.
        expectStyle(cluster, 'left', `${(139 / 360) * 100}%`),
        expectStyle(cluster, 'width', `${(112 / 360) * 100}%`),
        expectAttr(pistolSlot, 'data-held', 'false'),
        expectStyle(pistolSlot, 'left', '0%'),
        expectAttr(smgSlot, 'data-held', 'true'),
        expectStyle(smgSlot, 'left', '38.392857142857146%'),
        expectAttr(knifeSlot, 'data-held', 'false'),
        expectStyle(knifeSlot, 'left', '76.78571428571429%'),
        expectStyle(knifeSlot, 'width', '23.214285714285715%'),
      )
        .expect(
          Locator.inside(
            cluster,
            HtmlLocator.role('group', { name: 'Your guns' }),
          ),
        )
        .toExist()
        .expect(byClass('key-badge'))
        .toBeAbsent()
        .expect(byClass('slot-number'))
        .toBeAbsent()
    }),
  )

  it.effect('a tap on the other gun swaps, a tap on the held gun reloads', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fightingWith(20))
      s.pipe(
        measureHud,
        clickOn(smgSlot),
        expectAttr(smgSlot, 'aria-disabled', 'true'),
        clickOn(pistolSlot),
        expectAttr(slotNamed('Reload the Pop Pistol'), 'data-held', 'true'),
        expectAttr(
          slotNamed(`Switch to the ${SMG_NAME}`),
          'data-held',
          'false',
        ),
      )
    }),
  )

  it.effect(
    'a tap on a slot swaps while another finger holds the move stick',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fightingWith(20))
        s.pipe(
          measureHud,
          moveThumb,
          clickOn(pistolSlot),
          expectAttr(slotNamed('Reload the Pop Pistol'), 'data-held', 'true'),
        )
          .expect(moveStick)
          .toExist()
      }),
  )

  it.effect('the reload button sits past the knife, in the row', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fightingWith(9))
      s.pipe(
        measureHud,
        expectAttr(reloadButton, 'data-layout', 'Landscape'),
        expectStyle(reloadButton, 'left', 'calc(100% + 2.6785714285714284%)'),
        expectStyle(reloadButton, 'bottom', '0px'),
      )
        .expect(Locator.inside(cluster, reloadButton))
        .toExist()
    }),
  )

  it.effect('works with keys on a keyboard, and shows them on the slots', () =>
    Effect.gen(function* () {
      const onKeyboard = UiStruct.evolve(fightingWith(20), {
        lastDevice: () => 'KeyboardMouse',
      })
      const s = yield* sceneOf(onKeyboard)
      s.pipe(measureHud)
        .expect(keyBadgeIn(smgSlot))
        .toHaveText('R')
        .expect(keyBadgeIn(pistolSlot))
        .toHaveText('Q')
        .expect(slotNumberIn(pistolSlot))
        .toHaveText('1')
        .expect(slotNumberIn(smgSlot))
        .toHaveText('2')
        .expect(slotNumberIn(knifeSlot))
        .toHaveText('3')
        .expect(reloadButton)
        .toBeAbsent()
      s.pipe(
        emitPressedKey('KeyR'),
        expectAttr(smgSlot, 'aria-disabled', 'true'),
        emitPressedKey('KeyQ'),
        expectAttr(slotNamed('Reload the Pop Pistol'), 'data-held', 'true'),
        clickOn(slotNamed(`Switch to the ${SMG_NAME}`)),
        expectAttr(smgSlot, 'data-held', 'true'),
      )
    }),
  )

  it.effect(
    'the knife slot, right of the guns, draws the knife and shows F',
    () =>
      Effect.gen(function* () {
        const onKeyboard = UiStruct.evolve(fightingWith(20), {
          lastDevice: () => 'KeyboardMouse',
        })
        const smgToSwitch = slotNamed(`Switch to the ${SMG_NAME}`)
        const s = yield* sceneOf(onKeyboard)
        s.pipe(measureHud).expect(keyBadgeIn(knifeSlot)).toHaveText('F')
        s.pipe(
          clickOn(slotNamed('Switch to the Knife')),
          expectAttr(knifeSlot, 'data-held', 'true'),
          expectAttr(knifeSlot, 'aria-disabled', 'true'),
          expectAttr(smgToSwitch, 'data-held', 'false'),
        )
          .expect(keyBadgeIn(knifeSlot))
          .toBeAbsent()
          .expect(keyBadgeIn(smgToSwitch))
          .toHaveText('Q')
          .expect(keyBadgeIn(pistolSlot))
          .toBeAbsent()
        s.pipe(
          clickOn(smgToSwitch),
          expectAttr(smgSlot, 'data-held', 'true'),
          expectAttr(knifeSlot, 'data-held', 'false'),
        )
      }),
  )

  it.effect(
    'mid-wave a mouse click on a slot shoots through it, and a tap still draws',
    () =>
      Effect.gen(function* () {
        const slots = byClass('gun-slots')
        const onMouse = UiStruct.evolve(fightingWith(20), {
          lastDevice: () => 'KeyboardMouse',
        })
        const midWave = yield* sceneOf(onMouse)
        midWave.pipe(
          measureHud,
          expectAttr(slots, 'data-click', 'World'),
          pressHudSlot({ slot: 'Melee', pointerId: 1, device: 'Mouse' }),
          clickOn(knifeSlot),
          expectAttr(knifeSlot, 'data-held', 'false'),
          expectAttr(smgSlot, 'data-held', 'true'),
          pressHudSlot({ slot: 'Melee', pointerId: 7, device: 'Touch' }),
          clickOn(knifeSlot),
          expectAttr(knifeSlot, 'data-held', 'true'),
        )
        const inBreak = yield* sceneOf(
          modifyFocus(breakWithTraps, { player: () => withSmg(20) }),
        )
        inBreak.pipe(
          measureHud,
          expectAttr(slots, 'data-click', 'Slot'),
          pressHudSlot({ slot: 'Melee', pointerId: 1, device: 'Mouse' }),
          clickOn(knifeSlot),
          expectAttr(knifeSlot, 'data-held', 'true'),
        )
      }),
  )
})

describe('trap icons and START WAVE', () => {
  it.effect(
    'show between waves on touch and go away when the wave starts',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(breakWithTraps)
        s.pipe(
          measureHud,
          expectClass(placeTrap, 'place-icon-button'),
          expectAttr(nextTrap, 'aria-keyshortcuts', 'G'),
          expectClass(startWave, 'start-wave-pill'),
        )
          .expect(Locator.inside(byClass('gun-cluster-side'), placeTrap))
          .toExist()
          .expect(Locator.inside(byClass('gun-cluster-side'), nextTrap))
          .toExist()
          .expect(Locator.inside(byClass('gun-cluster-top'), startWave))
          .toExist()
        s.pipe(clickOn(startWave), ackHudSlots)
          .expect(placeTrap)
          .toBeAbsent()
          .expect(nextTrap)
          .toBeAbsent()
          .expect(startWave)
          .toBeAbsent()
          .expect(byClass('gun-cluster-top'))
          .toBeAbsent()
          .expect(HtmlLocator.role('group', { name: 'Your guns' }))
          .toExist()
      }),
  )

  it.effect('are the same icons on a keyboard, with their keys', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(breakWithTraps, { lastDevice: () => 'KeyboardMouse' }),
      )
      s.pipe(measureHud)
        .expect(keyBadgeIn(placeTrap))
        .toHaveText('T')
        .expect(keyBadgeIn(nextTrap))
        .toHaveText('G')
        .expect(keyBadgeIn(startWave))
        .toHaveText('ENTER')
        .expect(Locator.inside(byClass('gun-cluster-top'), startWave))
        .toExist()
      s.pipe(emitPressedKey('KeyG'))
        .expect(button('Place a Grumpy Gnome'))
        .toExist()
    }),
  )
})

describe('the corner', () => {
  it.effect(
    'has only the pause icon in a round, and the pause icon pauses',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fightingWith(30))
        s.pipe(
          measureHud,
          expectAttr(pauseButton, 'aria-keyshortcuts', 'Escape'),
        )
          .expect(muteButton)
          .toBeAbsent()
          .expect(musicButton)
          .toBeAbsent()
          .expect(fullscreenButton)
          .toBeAbsent()
        s.pipe(pauseByButton)
          .expect(statusLine)
          .toHaveText(PAUSED_LINE)
          .expect(pauseButton)
          .toBeAbsent()
      }),
  )

  it.effect(
    'the pause screen holds the audio toggles, which still toggle',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fightingWith(30))
        s.pipe(
          measureHud,
          pauseByButton,
          expectAttr(muteButton, 'aria-pressed', 'false'),
          expectAttr(muteButton, 'aria-keyshortcuts', 'M'),
          expectAttr(musicButton, 'aria-pressed', 'true'),
          expectAttr(musicButton, 'aria-keyshortcuts', 'N'),
          clickOn(muteButton),
          expectAttr(muteButton, 'aria-pressed', 'true'),
          clickOn(musicButton),
          expectAttr(musicButton, 'aria-pressed', 'false'),
        )
          .expect(statusLine)
          .toHaveText(PAUSED_LINE)
      }),
  )

  it.effect(
    'full screen shows in the home corner, in Settings, and on the pause screen, never mid-wave',
    () =>
      Effect.gen(function* () {
        const canFill = (base: Model): Model =>
          UiStruct.evolve(base, {
            settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
          })
        const home = yield* sceneOf(canFill(initialModel))
        home
          .pipe(measureHud)
          .expect(Locator.inside(byClass('home-corner'), fullscreenButton))
          .toExist()
        home
          .pipe(clickOn(settingsButton), showDialog(PROFILE_DIALOG_ID))
          .expect(profileDialog)
          .toExist()
        // NOTE: the Profile is a child, a leaf in the root's Scene, so its
        // Settings tile is read in a Scene of its own, with the props the
        // root hands it.
        const onSettings = yield* modelAfter(
          canFill(initialModel),
          send(Message.ClickedSettingsButton()),
        )
        const settings = yield* HtmlScene.make(
          Profile,
          profilePropsOf(onSettings),
        )
        settings.check(() => {
          vitestExpect(
            settings.get(fullscreenButton).attrs?.['aria-pressed'],
          ).toBe('false')
        })
        const fight = yield* sceneOf(canFill(fightingWith(30)))
        fight.pipe(measureHud).expect(fullscreenButton).toBeAbsent()
        fight.pipe(pauseByButton).expect(fullscreenButton).toExist()
      }),
  )
})

describe('the install tile', () => {
  const onIphone: Model = UiStruct.evolve(onTouch(initialModel), {
    settings: UiStruct.evolve({ screenFit: () => 'HomeScreen' }),
  })
  const guide = HtmlLocator.role('dialog', { name: 'Home Screen' })

  it.effect('pulses by the gear on an iPhone until its first tap', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onIphone)
      s.pipe(measureHud, expectAttr(homeScreenTip, 'data-tip', 'Unseen'))
        .expect(Locator.inside(byClass('home-corner'), homeScreenTip))
        .toExist()
        .expect(fullscreenButton)
        .toBeAbsent()
      s.pipe(
        clickOn(button('Play')),
        resolveFocusLobby(),
        expectAttr(homeUnderLobby, 'inert', ''),
        // NOTE: the home menu under the lobby is aria-hidden as well as
        // inert, so its tile is looked for among hidden elements.
        expectAttr(
          HtmlLocator.role('button', {
            name: 'Add to Home Screen: show me how',
            hidden: true,
          }),
          'data-tip',
          'Unseen',
        ),
      )
      const dismissed = yield* sceneOf(
        UiStruct.evolve(onIphone, { homeScreenTip: () => 'Dismissed' }),
      )
      dismissed.pipe(
        measureHud,
        expectAttr(homeScreenTip, 'data-tip', 'Dismissed'),
      )
    }),
  )

  it.effect(
    'opens the picture guide, three steps of a word each, and the X closes it',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(onIphone)
        s.pipe(measureHud).expect(guide).toBeAbsent()
        s.pipe(clickOn(homeScreenTip), showDialog(HOME_SCREEN_STEPS_ID))
          .expect(guide)
          .toExist()
          // NOTE: the steps are pictures, aria-hidden, so they are counted
          // among hidden elements.
          .expect(
            Locator.inside(
              guide,
              HtmlLocator.role('listitem', { hidden: true }),
            ),
          )
          .toHaveCount(3)
          .expect(guide)
          .toHaveText(/Share/)
          .expect(guide)
          .toHaveText(/Add/)
          .expect(guide)
          .toHaveText(/Play!/)
          .expect(guide)
          .toHaveText(/Add to Home Screen/)
        s.pipe(expectAttr(homeScreenTip, 'data-tip', 'Dismissed'))
          .expect(Locator.inside(guide, button('Close')))
          .toExist()
        // NOTE: the X is the Dialog's own close part, so its press comes up
        // as the Dialog's close request.
        s.pipe(requestDialogClose(HOME_SCREEN_STEPS_ID, 'close-press'))
          .expect(guide)
          .toBeAbsent()
          .expect(homeScreenTip)
          .toExist()
      }),
  )

  it.effect('Escape closes the guide too', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onIphone)
      s.pipe(
        measureHud,
        clickOn(homeScreenTip),
        showDialog(HOME_SCREEN_STEPS_ID),
        requestDialogClose(HOME_SCREEN_STEPS_ID, 'escape-key'),
      )
        .expect(guide)
        .toBeAbsent()
    }),
  )

  it.effect(
    'on Chrome, it shows only once the browser offers to install, and a tap asks for the prompt',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          UiStruct.evolve(onTouch(initialModel), {
            settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
          }),
        )
        s.pipe(measureHud).expect(installButton).toBeAbsent()
        s.pipe(
          fromSubscription(
            'InstallOffers',
            Message.ChangedInstallOffer({ installOffer: 'Ready' }),
          ),
        )
          .expect(installButton)
          .toExist()
        s.pipe(clickOn(installButton))
          .expectExact(ShowInstallPrompt.make())
          .resolve(
            ShowInstallPrompt,
            InstallMessage.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
          )
          .expect(installButton)
          .toBeAbsent()
      }),
  )

  it.effect(
    'hides in the installed app and on a desktop with no way to install',
    () =>
      Effect.gen(function* () {
        const installed = yield* sceneOf(
          UiStruct.evolve(onIphone, {
            settings: UiStruct.evolve({ screenFit: () => 'Installed' }),
          }),
        )
        installed
          .pipe(measureHud)
          .expect(homeScreenTip)
          .toBeAbsent()
          .expect(fullscreenButton)
          .toBeAbsent()
        const desktop = yield* sceneOf(
          UiStruct.evolve(initialModel, {
            settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
          }),
        )
        desktop
          .pipe(measureHud)
          .expect(homeScreenTip)
          .toBeAbsent()
          .expect(installButton)
          .toBeAbsent()
      }),
  )
})

describe('the first break on screen', () => {
  it.effect('has no timer, and the timer line says so', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(breakWithTraps, {
          phase: () =>
            Phase.Preparation({
              wave: 2,
              remainingMs: PREPARATION_MS,
              durationMs: PREPARATION_MS,
              spawns: [],
              clock: BreakClock.Waiting({ elapsedMs: 0 }),
            }),
        }),
      )
      s.pipe(measureHud, emitFrame(50))
        .expect(HtmlLocator.role('timer'))
        .toHaveText('Wave 2 starts when you are ready.')
        .expect(button('Start wave 2 now'))
        .toExist()
    }),
  )
})

describe('the title icons and the character picker', () => {
  it.effect('the title keeps its corner clear for the picker', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(onTouch(initialModel), {
          settings: UiStruct.evolve({ screenFit: () => 'HomeScreen' }),
        }),
      )
      s.pipe(measureHud)
        .expect(muteButton)
        .toBeAbsent()
        .expect(homeScreenTip)
        .toExist()
      s.pipe(
        clickOn(button('Your character: change how you look')),
        showDialog(PROFILE_DIALOG_ID),
      )
        .expect(profileDialog)
        .toExist()
        .expect(muteButton)
        .toBeAbsent()
        .expect(musicButton)
        .toBeAbsent()
    }),
  )

  it.effect('C opens the Profile from the title', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(asVeteran(initialModel))
      s.pipe(measureHud, emitPressedKey('KeyC'), showDialog(PROFILE_DIALOG_ID))
        .expect(profileDialog)
        .toExist()
    }),
  )
})
