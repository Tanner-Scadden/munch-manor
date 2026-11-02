import {
  Command,
  Subscription,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  pointerDown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import {
  Command as StoryCommand,
  message,
  story,
  given as storyGiven,
  model as storyModel,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, test, expect as vitestExpect } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { HomeScreenStepsBinding } from './bindings'
import { PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { BreakClock, type Model, Phase, initialModel } from './model'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  holdingSecond,
  measureSurface,
  resolveFocusLobbyInScene,
} from './testing'
import { ShowInstallPrompt } from './update/home'
import { asVeteran } from './veteran'
import { tierName } from './weapons'

const SMG_NAME = tierName('Smg', 0)

const onTouch = (base: Model): Model =>
  modifyFields(asVeteran(base), { lastDevice: () => 'Touch' })

const withSmg = (loaded: number): Model['player'] =>
  modifyFields(initialModel.player, {
    arsenal: () => holdingSecond({ kind: 'Smg', rounds: 120, loaded, tier: 0 }),
  })

const fightingWith = (loaded: number): Model =>
  modifyFields(onTouch(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
    player: () => withSmg(loaded),
  })

const breakWithTraps: Model = modifyFields(onTouch(initialModel), {
  phase: () =>
    Phase.Preparation({
      wave: 3,
      remainingMs: PREPARATION_MS,
      durationMs: PREPARATION_MS,
      spawns: [],
    }),
  trapStock: () => ({ Barricade: 1, Turret: 1 }),
})

const reloadButton = selector('.reload-button')
const pauseButton = role('button', { name: 'Pause' })
const muteButton = role('button', { name: 'Mute sound' })
const musicButton = role('button', { name: 'Music' })
const fullscreenButton = role('button', { name: 'Full screen' })
const placeTrap = role('button', { name: 'Place a Plank Pile' })
const nextTrap = role('button', { name: 'Switch to the Grumpy Gnome' })
const startWave = role('button', { name: 'Start wave 3 now' })
const homeScreenTip = role('button', {
  name: 'Add to Home Screen: show me how',
})
const installButton = role('button', { name: 'Install Munch Manor' })
const frame = (deltaTime: number) =>
  Subscription.emit(
    SCENE_SUBSCRIPTIONS.frame,
    Message.TickedFrame({ deltaTime }),
  )

// NOTE: a finger's tap: src/touchTaps.ts makes it a click on the button, as
// it does for a second finger while another holds the move stick.
const tap = click

// NOTE: a thumb on the left of the surface: the move stick.
const moveThumb = pointerDown(selector('.game-surface'), {
  pointerType: 'touch',
  pointerId: 3,
  clientX: 120,
  clientY: 260,
})

describe('the reload button', () => {
  test('is always there on touch, dim and inert with a full magazine', () => {
    scene(
      ROOT,
      given(fightingWith(30)),
      measureSurface,
      expect(reloadButton).toExist(),
      expect(reloadButton).toHaveAttr('aria-keyshortcuts', 'R'),
      expect(reloadButton).toHaveAttr('data-ready', 'false'),
      expect(reloadButton).toHaveAttr('aria-disabled', 'true'),
    )
  })

  test('reloads the held gun on a tap, and dims while it reloads', () => {
    scene(
      ROOT,
      given(fightingWith(20)),
      measureSurface,
      expect(reloadButton).toHaveAttr('data-ready', 'true'),
      expect(reloadButton).not.toHaveAttr('aria-disabled'),
      tap(reloadButton),
      expect(reloadButton).toHaveAttr('data-ready', 'false'),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
    )
  })

  test('with the knife out, draws the last gun and reloads it, as R does', () => {
    const knifeOut = modifyFields(fightingWith(20), {
      player: player => modifyFields(player, { wield: () => 'Melee' }),
    })
    scene(
      ROOT,
      given(knifeOut),
      measureSurface,
      expect(reloadButton).toHaveAttr(
        'aria-label',
        `Draw and reload the ${SMG_NAME}`,
      ),
      tap(reloadButton),
      expect(selector('.gun-slot-button[data-slot="Melee"]')).toHaveAttr(
        'data-held',
        'false',
      ),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toHaveAttr(
        'data-held',
        'true',
      ),
      expect(reloadButton).toHaveAttr('data-ready', 'false'),
    )
  })

  test('with the knife out and a full magazine, is dim but still draws the gun', () => {
    const knifeOut = modifyFields(fightingWith(30), {
      player: player => modifyFields(player, { wield: () => 'Melee' }),
    })
    scene(
      ROOT,
      given(knifeOut),
      measureSurface,
      expect(reloadButton).toHaveAttr('data-ready', 'false'),
      expect(reloadButton).not.toHaveAttr('aria-disabled'),
      tap(reloadButton),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toHaveAttr(
        'data-held',
        'true',
      ),
    )
  })

  test('works with the move stick held by another finger', () => {
    scene(
      ROOT,
      given(fightingWith(20)),
      measureSurface,
      moveThumb,
      expect(selector('.touch-stick[data-stick="move"]')).toExist(),
      tap(reloadButton),
      expect(reloadButton).toHaveAttr('data-ready', 'false'),
      expect(selector('.touch-stick[data-stick="move"]')).toExist(),
    )
  })

  test('is not on a keyboard and mouse: R reloads there', () => {
    scene(
      ROOT,
      given(
        modifyFields(fightingWith(20), { lastDevice: () => 'KeyboardMouse' }),
      ),
      measureSurface,
      expect(reloadButton).toBeAbsent(),
    )
  })
})

describe('the gun cluster', () => {
  const cluster = selector('.gun-cluster')
  const smgSlot = role('button', { name: `Reload the ${SMG_NAME}` })
  const pistolSlot = role('button', { name: 'Switch to the Pop Pistol' })
  const knifeSlot = selector('.gun-slot-button[data-slot="Melee"]')

  test('sits at the bottom middle with the held gun marked', () => {
    scene(
      ROOT,
      given(fightingWith(30)),
      measureSurface,
      expect(cluster).toHaveStyle('left', '37.1875%'),
      expect(cluster).toHaveStyle('width', '35%'),
      expect(within(cluster, role('group', { name: 'Your guns' }))).toExist(),
      expect(pistolSlot).toHaveAttr('data-held', 'false'),
      expect(pistolSlot).toHaveStyle('left', '0%'),
      expect(smgSlot).toHaveAttr('data-held', 'true'),
      expect(smgSlot).toHaveStyle('left', '38.392857142857146%'),
      expect(knifeSlot).toHaveAttr('data-held', 'false'),
      expect(knifeSlot).toHaveStyle('left', '76.78571428571429%'),
      expect(knifeSlot).toHaveStyle('width', '23.214285714285715%'),
      expect(selector('.key-badge')).toBeAbsent(),
    )
  })

  test('a tap on the other gun swaps, a tap on the held gun reloads', () => {
    scene(
      ROOT,
      given(fightingWith(20)),
      measureSurface,
      tap(smgSlot),
      expect(smgSlot).toHaveAttr('aria-disabled', 'true'),
      tap(pistolSlot),
      expect(role('button', { name: 'Reload the Pop Pistol' })).toHaveAttr(
        'data-held',
        'true',
      ),
      expect(role('button', { name: `Switch to the ${SMG_NAME}` })).toHaveAttr(
        'data-held',
        'false',
      ),
    )
  })

  test('a tap on a slot swaps while another finger holds the move stick', () => {
    scene(
      ROOT,
      given(fightingWith(20)),
      measureSurface,
      moveThumb,
      tap(pistolSlot),
      expect(role('button', { name: 'Reload the Pop Pistol' })).toHaveAttr(
        'data-held',
        'true',
      ),
      expect(selector('.touch-stick[data-stick="move"]')).toExist(),
    )
  })

  test('the reload button sits past the knife, in the row', () => {
    scene(
      ROOT,
      given(fightingWith(9)),
      measureSurface,
      expect(within(cluster, reloadButton)).toExist(),
      expect(reloadButton).toHaveAttr('data-layout', 'Landscape'),
      expect(reloadButton).toHaveStyle(
        'left',
        'calc(100% + 2.6785714285714284%)',
      ),
      expect(reloadButton).toHaveStyle('bottom', '0px'),
    )
  })

  test('works with keys on a keyboard, and shows them on the slots', () => {
    const onKeyboard = modifyFields(fightingWith(20), {
      lastDevice: () => 'KeyboardMouse',
    })
    scene(
      ROOT,
      given(onKeyboard),
      measureSurface,
      expect(within(smgSlot, selector('.key-badge'))).toHaveText('R'),
      expect(within(pistolSlot, selector('.key-badge'))).toHaveText('Q'),
      expect(reloadButton).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyR' }),
      ),
      expect(smgSlot).toHaveAttr('aria-disabled', 'true'),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyQ' }),
      ),
      expect(role('button', { name: 'Reload the Pop Pistol' })).toHaveAttr(
        'data-held',
        'true',
      ),
      click(role('button', { name: `Switch to the ${SMG_NAME}` })),
      expect(smgSlot).toHaveAttr('data-held', 'true'),
    )
  })

  test('the knife slot, right of the guns, draws the knife and shows F', () => {
    const onKeyboard = modifyFields(fightingWith(20), {
      lastDevice: () => 'KeyboardMouse',
    })
    scene(
      ROOT,
      given(onKeyboard),
      measureSurface,
      expect(within(knifeSlot, selector('.key-badge'))).toHaveText('F'),
      click(role('button', { name: 'Switch to the Knife' })),
      expect(knifeSlot).toHaveAttr('data-held', 'true'),
      expect(knifeSlot).toHaveAttr('aria-disabled', 'true'),
      expect(within(knifeSlot, selector('.key-badge'))).toBeAbsent(),
      expect(role('button', { name: `Switch to the ${SMG_NAME}` })).toHaveAttr(
        'data-held',
        'false',
      ),
      expect(
        within(
          role('button', { name: `Switch to the ${SMG_NAME}` }),
          selector('.key-badge'),
        ),
      ).toHaveText('Q'),
      expect(within(pistolSlot, selector('.key-badge'))).toBeAbsent(),
      click(role('button', { name: `Switch to the ${SMG_NAME}` })),
      expect(smgSlot).toHaveAttr('data-held', 'true'),
      expect(knifeSlot).toHaveAttr('data-held', 'false'),
    )
  })

  test('mid-wave a mouse click on a slot shoots through it, and a tap still draws', () => {
    const slots = selector('.gun-slots')
    const onMouse = modifyFields(fightingWith(20), {
      lastDevice: () => 'KeyboardMouse',
    })
    scene(
      ROOT,
      given(onMouse),
      measureSurface,
      expect(slots).toHaveAttr('data-click', 'World'),
      pointerDown(knifeSlot, { pointerType: 'mouse', pointerId: 1 }),
      click(knifeSlot),
      expect(knifeSlot).toHaveAttr('data-held', 'false'),
      expect(smgSlot).toHaveAttr('data-held', 'true'),
      pointerDown(knifeSlot, { pointerType: 'touch', pointerId: 7 }),
      click(knifeSlot),
      expect(knifeSlot).toHaveAttr('data-held', 'true'),
    )
    scene(
      ROOT,
      given(modifyFields(breakWithTraps, { player: () => withSmg(20) })),
      measureSurface,
      expect(slots).toHaveAttr('data-click', 'Slot'),
      pointerDown(knifeSlot, { pointerType: 'mouse', pointerId: 1 }),
      click(knifeSlot),
      expect(knifeSlot).toHaveAttr('data-held', 'true'),
    )
  })
})

describe('trap icons and START WAVE', () => {
  test('show between waves on touch and go away when the wave starts', () => {
    scene(
      ROOT,
      given(breakWithTraps),
      measureSurface,
      expect(placeTrap).toHaveClass('place-icon-button'),
      expect(within(selector('.gun-cluster-side'), placeTrap)).toExist(),
      expect(within(selector('.gun-cluster-side'), nextTrap)).toExist(),
      expect(nextTrap).toHaveAttr('aria-keyshortcuts', 'G'),
      expect(startWave).toHaveClass('start-wave-pill'),
      expect(within(selector('.gun-cluster-top'), startWave)).toExist(),
      click(startWave),
      expect(placeTrap).toBeAbsent(),
      expect(nextTrap).toBeAbsent(),
      expect(startWave).toBeAbsent(),
      expect(selector('.gun-cluster-top')).toBeAbsent(),
      expect(role('group', { name: 'Your guns' })).toExist(),
    )
  })

  test('are the same icons on a keyboard, with their keys', () => {
    scene(
      ROOT,
      given(
        modifyFields(breakWithTraps, { lastDevice: () => 'KeyboardMouse' }),
      ),
      measureSurface,
      expect(within(placeTrap, selector('.key-badge'))).toHaveText('T'),
      expect(within(nextTrap, selector('.key-badge'))).toHaveText('G'),
      expect(within(startWave, selector('.key-badge'))).toHaveText('ENTER'),
      expect(within(selector('.gun-cluster-top'), startWave)).toExist(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyG' }),
      ),
      expect(role('button', { name: 'Place a Grumpy Gnome' })).toExist(),
    )
  })
})

describe('the corner', () => {
  test('has only the pause icon in a round, and the pause icon pauses', () => {
    scene(
      ROOT,
      given(fightingWith(30)),
      measureSurface,
      expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
      expect(muteButton).toBeAbsent(),
      expect(musicButton).toBeAbsent(),
      expect(fullscreenButton).toBeAbsent(),
      click(pauseButton),
      expect(role('status')).toHaveText(
        'Paused during wave 3 of 10. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.',
      ),
      expect(pauseButton).toBeAbsent(),
    )
  })

  test('the pause screen holds the audio toggles, which still toggle', () => {
    scene(
      ROOT,
      given(fightingWith(30)),
      measureSurface,
      click(pauseButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      expect(muteButton).toHaveAttr('aria-keyshortcuts', 'M'),
      expect(musicButton).toHaveAttr('aria-pressed', 'true'),
      expect(musicButton).toHaveAttr('aria-keyshortcuts', 'N'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'true'),
      click(musicButton),
      expect(musicButton).toHaveAttr('aria-pressed', 'false'),
      expect(role('status')).toHaveText(
        'Paused during wave 3 of 10. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.',
      ),
    )
  })

  test('full screen shows in the home corner, in Settings, and on the pause screen, never mid-wave', () => {
    const canFill = (base: Model): Model =>
      modifyFields(base, { screenFit: () => 'Fullscreen' })
    scene(
      ROOT,
      given(canFill(initialModel)),
      measureSurface,
      inside(selector('.home-corner'), expect(fullscreenButton).toExist()),
      click(
        role('button', {
          name: 'Settings',
        }),
      ),
      Command.resolve(
        Dialog.test.ShowDialog,
        DialogBlock.Message.SucceededShowDialog(),
      ),
      inside(
        role('dialog', { name: 'Profile' }),
        expect(fullscreenButton).toHaveAttr('aria-pressed', 'false'),
      ),
    )
    scene(
      ROOT,
      given(canFill(fightingWith(30))),
      measureSurface,
      expect(fullscreenButton).toBeAbsent(),
      click(pauseButton),
      expect(fullscreenButton).toExist(),
    )
  })
})

describe('the install tile', () => {
  const onIphone: Model = modifyFields(onTouch(initialModel), {
    screenFit: () => 'HomeScreen',
  })
  const showSteps = [
    Command.resolve(
      Dialog.test.ShowDialog,
      DialogBlock.Message.SucceededShowDialog(),
    ),
  ]
  const steps = role('dialog', { name: 'Home Screen' })

  test('pulses by the gear on an iPhone until its first tap', () => {
    scene(
      ROOT,
      given(onIphone),
      measureSurface,
      inside(selector('.home-corner'), expect(homeScreenTip).toExist()),
      expect(homeScreenTip).toHaveAttr('data-tip', 'Unseen'),
      expect(fullscreenButton).toBeAbsent(),
      click(role('button', { name: 'Play' })),
      resolveFocusLobbyInScene(),
      expect(homeScreenTip).toBeAbsent(),
    )
    scene(
      ROOT,
      given(modifyFields(onIphone, { homeScreenTip: () => 'Dismissed' })),
      measureSurface,
      expect(homeScreenTip).toHaveAttr('data-tip', 'Dismissed'),
    )
  })

  test('opens the picture guide, three steps of a word each, and the X closes it', () => {
    scene(
      ROOT,
      given(onIphone),
      measureSurface,
      expect(steps).toBeAbsent(),
      click(homeScreenTip),
      ...showSteps,
      expect(steps).toExist(),
      inside(steps, expectAll(all.role('listitem')).toHaveCount(3)),
      expect(steps).toContainText('Share'),
      expect(steps).toContainText('Add'),
      expect(steps).toContainText('Play!'),
      expect(steps).toContainText('Add to Home Screen'),
      expect(homeScreenTip).toHaveAttr('data-tip', 'Dismissed'),
      click(role('button', { name: 'Close' })),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      expect(steps).toBeAbsent(),
      expect(homeScreenTip).toExist(),
    )
  })

  // NOTE: Escape reaches the Dialog as its own close request, which a
  // Scene cannot raise, so the Story sends it to the open guide and the
  // Scene draws the Model it left.
  test('Escape closes the guide too', () => {
    const shown = update(
      update(onIphone, Message.ClickedInstallButton()).model,
      toParentMessage(
        HomeScreenStepsBinding,
        DialogBlock.Message.SucceededShowDialog(),
      ),
    ).model
    const escaped = toParentMessage(
      HomeScreenStepsBinding,
      DialogBlock.Message.RequestedClose(),
    )
    story(
      update,
      storyGiven(shown),
      storyModel(current => {
        vitestExpect(current.homeScreenSteps.isOpen).toBe(true)
      }),
      message(escaped),
      StoryCommand.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      storyModel(current => {
        vitestExpect(current.homeScreenSteps.isOpen).toBe(false)
      }),
    )
    scene(
      ROOT,
      given(update(shown, escaped).model),
      measureSurface,
      expect(steps).toBeAbsent(),
    )
  })

  test('on Chrome, it shows only once the browser offers to install, and a tap asks for the prompt', () => {
    scene(
      ROOT,
      given(
        modifyFields(onTouch(initialModel), { screenFit: () => 'Fullscreen' }),
      ),
      measureSurface,
      expect(installButton).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.installOffers,
        Message.ChangedInstallOffer({ installOffer: 'Ready' }),
      ),
      expect(installButton).toExist(),
      click(installButton),
      Command.expectExact(ShowInstallPrompt),
      Command.resolve(
        ShowInstallPrompt,
        Message.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
      ),
      expect(installButton).toBeAbsent(),
    )
  })

  test('hides in the installed app and on a desktop with no way to install', () => {
    scene(
      ROOT,
      given(modifyFields(onIphone, { screenFit: () => 'Installed' })),
      measureSurface,
      expect(homeScreenTip).toBeAbsent(),
      expect(fullscreenButton).toBeAbsent(),
    )
    scene(
      ROOT,
      given(modifyFields(initialModel, { screenFit: () => 'Fullscreen' })),
      measureSurface,
      expect(homeScreenTip).toBeAbsent(),
      expect(installButton).toBeAbsent(),
    )
  })
})

describe('the first break on screen', () => {
  test('has no timer, and the timer line says so', () => {
    scene(
      ROOT,
      given(
        modifyFields(breakWithTraps, {
          phase: () =>
            Phase.Preparation({
              wave: 2,
              remainingMs: PREPARATION_MS,
              durationMs: PREPARATION_MS,
              spawns: [],
              clock: BreakClock.Waiting({ elapsedMs: 0 }),
            }),
        }),
      ),
      measureSurface,
      frame(50),
      expect(role('timer')).toHaveText('Wave 2 starts when you are ready.'),
      expect(role('button', { name: 'Start wave 2 now' })).toExist(),
    )
  })
})

describe('the title icons and the character picker', () => {
  const showPicker = [
    Command.resolve(
      Dialog.test.ShowDialog,
      DialogBlock.Message.SucceededShowDialog(),
    ),
  ]

  test('the title keeps its corner clear for the picker', () => {
    scene(
      ROOT,
      given(
        modifyFields(onTouch(initialModel), { screenFit: () => 'HomeScreen' }),
      ),
      measureSurface,
      expect(muteButton).toBeAbsent(),
      expect(homeScreenTip).toExist(),
      click(role('button', { name: 'Your character: change how you look' })),
      ...showPicker,
      expect(role('dialog', { name: 'Profile' })).toExist(),
      expect(muteButton).toBeAbsent(),
      expect(musicButton).toBeAbsent(),
    )
  })

  test('C opens the Profile from the title', () => {
    scene(
      ROOT,
      given(asVeteran(initialModel)),
      measureSurface,
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyC' }),
      ),
      ...showPicker,
      expect(role('dialog', { name: 'Profile' })).toExist(),
    )
  })
})
