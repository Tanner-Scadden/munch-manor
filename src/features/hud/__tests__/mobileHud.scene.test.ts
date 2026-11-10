import { Effect } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { HomeScreenStepsBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { BreakClock, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { ShowInstallPrompt } from '../../../app/update/home'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  closeDialog,
  holdingSecond,
  measureSurface,
  pauseButton,
  resolveFocusLobbyInScene,
  showDialog,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { tierName } from '../../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { type Player } from '../../../world/schema/worldSchema'

const SMG_NAME = tierName('Smg', 0)

const onTouch = (base: Model): Model =>
  modifyFields(asVeteran(base), { lastDevice: () => 'Touch' })

const withSmg = (loaded: number): Player =>
  modifyFields(focusOf(initialModel).player, {
    arsenal: () => holdingSecond({ kind: 'Smg', loaded, tier: 0, kills: 0 }),
  })

const fightingWith = (loaded: number): Model =>
  modifyFocus(
    modifyFields(onTouch(initialModel), {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
    }),
    { player: () => withSmg(loaded) },
  )

const breakWithTraps: Model = modifyFocus(
  modifyFields(onTouch(initialModel), {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns: [],
      }),
  }),
  { trapStock: () => ({ Barricade: 1, Turret: 1 }) },
)

const reloadButton = Scene.selector('.reload-button')
const muteButton = Scene.role('button', { name: 'Mute sound' })
const musicButton = Scene.role('button', { name: 'Music' })
const fullscreenButton = Scene.role('button', { name: 'Full screen' })
const placeTrap = Scene.role('button', { name: 'Place a Plank Pile' })
const nextTrap = Scene.role('button', { name: 'Switch to the Grumpy Gnome' })
const startWave = Scene.role('button', { name: 'Start wave 3 now' })
const homeScreenTip = Scene.role('button', {
  name: 'Add to Home Screen: show me how',
})
const installButton = Scene.role('button', { name: 'Install Munch Manor' })
const frame = (deltaTime: number) =>
  Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.frame,
    Message.TickedFrame({ deltaTime }),
  )

// NOTE: a finger's tap: src/input/touchTaps.ts makes it a click on the button, as
// it does for a second finger while another holds the move stick.
const tap = Scene.click

// NOTE: a thumb on the left of the surface: the move stick.
const moveThumb = Scene.pointerDown(Scene.selector('.game-surface'), {
  pointerType: 'touch',
  pointerId: 3,
  clientX: 120,
  clientY: 260,
})

describe('the reload button', () => {
  it.effect(
    'is always there on touch, dim and inert with a full magazine',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fightingWith(30)),
        measureSurface,
        Scene.expect(reloadButton).toExist(),
        Scene.expect(reloadButton).toHaveAttr('aria-keyshortcuts', 'R'),
        Scene.expect(reloadButton).toHaveAttr('data-ready', 'false'),
        Scene.expect(reloadButton).toHaveAttr('aria-disabled', 'true'),
      ),
  )

  it.effect('reloads the held gun on a tap, and dims while it reloads', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fightingWith(20)),
      measureSurface,
      Scene.expect(reloadButton).toHaveAttr('data-ready', 'true'),
      Scene.expect(reloadButton).not.toHaveAttr('aria-disabled'),
      tap(reloadButton),
      Scene.expect(reloadButton).toHaveAttr('data-ready', 'false'),
      Scene.expect(
        Scene.role('button', { name: `Reload the ${SMG_NAME}` }),
      ).toHaveAttr('aria-disabled', 'true'),
    ),
  )

  it.effect(
    'with the knife out, draws the last gun and reloads it, as R does',
    () => {
      const knifeOut = modifyFocus(fightingWith(20), {
        player: player => modifyFields(player, { wield: () => 'Melee' }),
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(knifeOut),
        measureSurface,
        Scene.expect(reloadButton).toHaveAttr(
          'aria-label',
          `Draw and reload the ${SMG_NAME}`,
        ),
        tap(reloadButton),
        Scene.expect(
          Scene.selector('.gun-slot-button[data-slot="Melee"]'),
        ).toHaveAttr('data-held', 'false'),
        Scene.expect(
          Scene.role('button', { name: `Reload the ${SMG_NAME}` }),
        ).toHaveAttr('data-held', 'true'),
        Scene.expect(reloadButton).toHaveAttr('data-ready', 'false'),
      )
    },
  )

  it.effect(
    'with the knife out and a full magazine, is dim but still draws the gun',
    () => {
      const knifeOut = modifyFocus(fightingWith(30), {
        player: player => modifyFields(player, { wield: () => 'Melee' }),
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(knifeOut),
        measureSurface,
        Scene.expect(reloadButton).toHaveAttr('data-ready', 'false'),
        Scene.expect(reloadButton).not.toHaveAttr('aria-disabled'),
        tap(reloadButton),
        Scene.expect(
          Scene.role('button', { name: `Reload the ${SMG_NAME}` }),
        ).toHaveAttr('data-held', 'true'),
      )
    },
  )

  it.effect('works with the move stick held by another finger', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fightingWith(20)),
      measureSurface,
      moveThumb,
      Scene.expect(Scene.selector('.touch-stick[data-stick="move"]')).toExist(),
      tap(reloadButton),
      Scene.expect(reloadButton).toHaveAttr('data-ready', 'false'),
      Scene.expect(Scene.selector('.touch-stick[data-stick="move"]')).toExist(),
    ),
  )

  it.effect('is not on a keyboard and mouse: R reloads there', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(fightingWith(20), { lastDevice: () => 'KeyboardMouse' }),
      ),
      measureSurface,
      Scene.expect(reloadButton).toBeAbsent(),
    ),
  )
})

describe('the gun cluster', () => {
  const cluster = Scene.selector('.gun-cluster')
  const smgSlot = Scene.role('button', { name: `Reload the ${SMG_NAME}` })
  const pistolSlot = Scene.role('button', { name: 'Switch to the Pop Pistol' })
  const knifeSlot = Scene.selector('.gun-slot-button[data-slot="Melee"]')

  it.effect('sits at the bottom middle with the held gun marked', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fightingWith(30)),
      measureSurface,
      Scene.expect(cluster).toHaveStyle('left', '37.1875%'),
      Scene.expect(cluster).toHaveStyle('width', '35%'),
      Scene.expect(
        Scene.within(cluster, Scene.role('group', { name: 'Your guns' })),
      ).toExist(),
      Scene.expect(pistolSlot).toHaveAttr('data-held', 'false'),
      Scene.expect(pistolSlot).toHaveStyle('left', '0%'),
      Scene.expect(smgSlot).toHaveAttr('data-held', 'true'),
      Scene.expect(smgSlot).toHaveStyle('left', '38.392857142857146%'),
      Scene.expect(knifeSlot).toHaveAttr('data-held', 'false'),
      Scene.expect(knifeSlot).toHaveStyle('left', '76.78571428571429%'),
      Scene.expect(knifeSlot).toHaveStyle('width', '23.214285714285715%'),
      Scene.expect(Scene.selector('.key-badge')).toBeAbsent(),
    ),
  )

  it.effect('a tap on the other gun swaps, a tap on the held gun reloads', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fightingWith(20)),
      measureSurface,
      tap(smgSlot),
      Scene.expect(smgSlot).toHaveAttr('aria-disabled', 'true'),
      tap(pistolSlot),
      Scene.expect(
        Scene.role('button', { name: 'Reload the Pop Pistol' }),
      ).toHaveAttr('data-held', 'true'),
      Scene.expect(
        Scene.role('button', { name: `Switch to the ${SMG_NAME}` }),
      ).toHaveAttr('data-held', 'false'),
    ),
  )

  it.effect(
    'a tap on a slot swaps while another finger holds the move stick',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fightingWith(20)),
        measureSurface,
        moveThumb,
        tap(pistolSlot),
        Scene.expect(
          Scene.role('button', { name: 'Reload the Pop Pistol' }),
        ).toHaveAttr('data-held', 'true'),
        Scene.expect(
          Scene.selector('.touch-stick[data-stick="move"]'),
        ).toExist(),
      ),
  )

  it.effect('the reload button sits past the knife, in the row', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fightingWith(9)),
      measureSurface,
      Scene.expect(Scene.within(cluster, reloadButton)).toExist(),
      Scene.expect(reloadButton).toHaveAttr('data-layout', 'Landscape'),
      Scene.expect(reloadButton).toHaveStyle(
        'left',
        'calc(100% + 2.6785714285714284%)',
      ),
      Scene.expect(reloadButton).toHaveStyle('bottom', '0px'),
    ),
  )

  it.effect(
    'works with keys on a keyboard, and shows them on the slots',
    () => {
      const onKeyboard = modifyFields(fightingWith(20), {
        lastDevice: () => 'KeyboardMouse',
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(onKeyboard),
        measureSurface,
        Scene.expect(
          Scene.within(smgSlot, Scene.selector('.key-badge')),
        ).toHaveText('R'),
        Scene.expect(
          Scene.within(pistolSlot, Scene.selector('.key-badge')),
        ).toHaveText('Q'),
        Scene.expect(reloadButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'KeyR' }),
        ),
        Scene.expect(smgSlot).toHaveAttr('aria-disabled', 'true'),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'KeyQ' }),
        ),
        Scene.expect(
          Scene.role('button', { name: 'Reload the Pop Pistol' }),
        ).toHaveAttr('data-held', 'true'),
        Scene.click(
          Scene.role('button', { name: `Switch to the ${SMG_NAME}` }),
        ),
        Scene.expect(smgSlot).toHaveAttr('data-held', 'true'),
      )
    },
  )

  it.effect(
    'the knife slot, right of the guns, draws the knife and shows F',
    () => {
      const onKeyboard = modifyFields(fightingWith(20), {
        lastDevice: () => 'KeyboardMouse',
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(onKeyboard),
        measureSurface,
        Scene.expect(
          Scene.within(knifeSlot, Scene.selector('.key-badge')),
        ).toHaveText('F'),
        Scene.click(Scene.role('button', { name: 'Switch to the Knife' })),
        Scene.expect(knifeSlot).toHaveAttr('data-held', 'true'),
        Scene.expect(knifeSlot).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(
          Scene.within(knifeSlot, Scene.selector('.key-badge')),
        ).toBeAbsent(),
        Scene.expect(
          Scene.role('button', { name: `Switch to the ${SMG_NAME}` }),
        ).toHaveAttr('data-held', 'false'),
        Scene.expect(
          Scene.within(
            Scene.role('button', { name: `Switch to the ${SMG_NAME}` }),
            Scene.selector('.key-badge'),
          ),
        ).toHaveText('Q'),
        Scene.expect(
          Scene.within(pistolSlot, Scene.selector('.key-badge')),
        ).toBeAbsent(),
        Scene.click(
          Scene.role('button', { name: `Switch to the ${SMG_NAME}` }),
        ),
        Scene.expect(smgSlot).toHaveAttr('data-held', 'true'),
        Scene.expect(knifeSlot).toHaveAttr('data-held', 'false'),
      )
    },
  )

  it.effect(
    'mid-wave a mouse click on a slot shoots through it, and a tap still draws',
    () =>
      Effect.gen(function* () {
        const slots = Scene.selector('.gun-slots')
        const onMouse = modifyFields(fightingWith(20), {
          lastDevice: () => 'KeyboardMouse',
        })
        yield* Scene.scene(
          APPLICATION,
          Scene.given(onMouse),
          measureSurface,
          Scene.expect(slots).toHaveAttr('data-click', 'World'),
          Scene.pointerDown(knifeSlot, { pointerType: 'mouse', pointerId: 1 }),
          Scene.click(knifeSlot),
          Scene.expect(knifeSlot).toHaveAttr('data-held', 'false'),
          Scene.expect(smgSlot).toHaveAttr('data-held', 'true'),
          Scene.pointerDown(knifeSlot, { pointerType: 'touch', pointerId: 7 }),
          Scene.click(knifeSlot),
          Scene.expect(knifeSlot).toHaveAttr('data-held', 'true'),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFocus(breakWithTraps, { player: () => withSmg(20) }),
          ),
          measureSurface,
          Scene.expect(slots).toHaveAttr('data-click', 'Slot'),
          Scene.pointerDown(knifeSlot, { pointerType: 'mouse', pointerId: 1 }),
          Scene.click(knifeSlot),
          Scene.expect(knifeSlot).toHaveAttr('data-held', 'true'),
        )
      }),
  )
})

describe('trap icons and START WAVE', () => {
  it.effect(
    'show between waves on touch and go away when the wave starts',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(breakWithTraps),
        measureSurface,
        Scene.expect(placeTrap).toHaveClass('place-icon-button'),
        Scene.expect(
          Scene.within(Scene.selector('.gun-cluster-side'), placeTrap),
        ).toExist(),
        Scene.expect(
          Scene.within(Scene.selector('.gun-cluster-side'), nextTrap),
        ).toExist(),
        Scene.expect(nextTrap).toHaveAttr('aria-keyshortcuts', 'G'),
        Scene.expect(startWave).toHaveClass('start-wave-pill'),
        Scene.expect(
          Scene.within(Scene.selector('.gun-cluster-top'), startWave),
        ).toExist(),
        Scene.click(startWave),
        Scene.expect(placeTrap).toBeAbsent(),
        Scene.expect(nextTrap).toBeAbsent(),
        Scene.expect(startWave).toBeAbsent(),
        Scene.expect(Scene.selector('.gun-cluster-top')).toBeAbsent(),
        Scene.expect(Scene.role('group', { name: 'Your guns' })).toExist(),
      ),
  )

  it.effect('are the same icons on a keyboard, with their keys', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(breakWithTraps, { lastDevice: () => 'KeyboardMouse' }),
      ),
      measureSurface,
      Scene.expect(
        Scene.within(placeTrap, Scene.selector('.key-badge')),
      ).toHaveText('T'),
      Scene.expect(
        Scene.within(nextTrap, Scene.selector('.key-badge')),
      ).toHaveText('G'),
      Scene.expect(
        Scene.within(startWave, Scene.selector('.key-badge')),
      ).toHaveText('ENTER'),
      Scene.expect(
        Scene.within(Scene.selector('.gun-cluster-top'), startWave),
      ).toExist(),
      Scene.Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyG' }),
      ),
      Scene.expect(
        Scene.role('button', { name: 'Place a Grumpy Gnome' }),
      ).toExist(),
    ),
  )
})

describe('the corner', () => {
  it.effect(
    'has only the pause icon in a round, and the pause icon pauses',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fightingWith(30)),
        measureSurface,
        Scene.expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
        Scene.expect(muteButton).toBeAbsent(),
        Scene.expect(musicButton).toBeAbsent(),
        Scene.expect(fullscreenButton).toBeAbsent(),
        Scene.click(pauseButton),
        Scene.expect(Scene.role('status')).toHaveText(
          'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.',
        ),
        Scene.expect(pauseButton).toBeAbsent(),
      ),
  )

  it.effect(
    'the pause screen holds the audio toggles, which still toggle',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fightingWith(30)),
        measureSurface,
        Scene.click(pauseButton),
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(muteButton).toHaveAttr('aria-keyshortcuts', 'M'),
        Scene.expect(musicButton).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(musicButton).toHaveAttr('aria-keyshortcuts', 'N'),
        Scene.click(muteButton),
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'true'),
        Scene.click(musicButton),
        Scene.expect(musicButton).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(Scene.role('status')).toHaveText(
          'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.',
        ),
      ),
  )

  it.effect(
    'full screen shows in the home corner, in Settings, and on the pause screen, never mid-wave',
    () =>
      Effect.gen(function* () {
        const canFill = (base: Model): Model =>
          modifyFields(base, { screenFit: () => 'Fullscreen' })
        yield* Scene.scene(
          APPLICATION,
          Scene.given(canFill(initialModel)),
          measureSurface,
          Scene.inside(
            Scene.selector('.home-corner'),
            Scene.expect(fullscreenButton).toExist(),
          ),
          Scene.click(
            Scene.role('button', {
              name: 'Settings',
            }),
          ),
          Scene.Command.resolve(
            Dialog.test.ShowDialog,
            DialogBlock.Message.SucceededShowDialog(),
          ),
          Scene.inside(
            Scene.role('dialog', { name: 'Profile' }),
            Scene.expect(fullscreenButton).toHaveAttr('aria-pressed', 'false'),
          ),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(canFill(fightingWith(30))),
          measureSurface,
          Scene.expect(fullscreenButton).toBeAbsent(),
          Scene.click(pauseButton),
          Scene.expect(fullscreenButton).toExist(),
        )
      }),
  )
})

describe('the install tile', () => {
  const onIphone: Model = modifyFields(onTouch(initialModel), {
    screenFit: () => 'HomeScreen',
  })
  const showSteps = [
    Scene.Command.resolve(
      Dialog.test.ShowDialog,
      DialogBlock.Message.SucceededShowDialog(),
    ),
  ]
  const steps = Scene.role('dialog', { name: 'Home Screen' })

  it.effect('pulses by the gear on an iPhone until its first tap', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(onIphone),
        measureSurface,
        Scene.inside(
          Scene.selector('.home-corner'),
          Scene.expect(homeScreenTip).toExist(),
        ),
        Scene.expect(homeScreenTip).toHaveAttr('data-tip', 'Unseen'),
        Scene.expect(fullscreenButton).toBeAbsent(),
        Scene.click(Scene.role('button', { name: 'Play' })),
        resolveFocusLobbyInScene(),
        Scene.expect(homeScreenTip).toBeAbsent(),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(onIphone, { homeScreenTip: () => 'Dismissed' }),
        ),
        measureSurface,
        Scene.expect(homeScreenTip).toHaveAttr('data-tip', 'Dismissed'),
      )
    }),
  )

  it.effect(
    'opens the picture guide, three steps of a word each, and the X closes it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onIphone),
        measureSurface,
        Scene.expect(steps).toBeAbsent(),
        Scene.click(homeScreenTip),
        ...showSteps,
        Scene.expect(steps).toExist(),
        Scene.inside(
          steps,
          Scene.expectAll(Scene.all.role('listitem')).toHaveCount(3),
        ),
        Scene.expect(steps).toContainText('Share'),
        Scene.expect(steps).toContainText('Add'),
        Scene.expect(steps).toContainText('Play!'),
        Scene.expect(steps).toContainText('Add to Home Screen'),
        Scene.expect(homeScreenTip).toHaveAttr('data-tip', 'Dismissed'),
        Scene.click(Scene.role('button', { name: 'Close' })),
        Scene.Command.resolve(
          Dialog.test.CloseDialog,
          DialogBlock.Message.CompletedCloseDialog(),
        ),
        Scene.expect(steps).toBeAbsent(),
        Scene.expect(homeScreenTip).toExist(),
      ),
  )

  // NOTE: Escape reaches the Dialog as its own close request, which a
  // Scene cannot raise, so the Story sends it to the open guide and the
  // Scene draws the Model it left.
  it.effect('Escape closes the guide too', () =>
    Effect.gen(function* () {
      const escaped = yield* Story.story(
        APPLICATION,
        Story.given(onIphone),
        Story.message(Message.ClickedInstallButton()),
        showDialog(),
        Story.model(current => {
          vitestExpect(current.homeScreenSteps.isOpen).toBe(true)
        }),
        Story.messageIn(
          HomeScreenStepsBinding,
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        Story.model(current => {
          vitestExpect(current.homeScreenSteps.isOpen).toBe(false)
        }),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(escaped),
        measureSurface,
        Scene.expect(steps).toBeAbsent(),
      )
    }),
  )

  it.effect(
    'on Chrome, it shows only once the browser offers to install, and a tap asks for the prompt',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(onTouch(initialModel), {
            screenFit: () => 'Fullscreen',
          }),
        ),
        measureSurface,
        Scene.expect(installButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.installOffers,
          Message.ChangedInstallOffer({ installOffer: 'Ready' }),
        ),
        Scene.expect(installButton).toExist(),
        Scene.click(installButton),
        Scene.Command.expectExact(ShowInstallPrompt),
        Scene.Command.resolve(
          ShowInstallPrompt,
          Message.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
        ),
        Scene.expect(installButton).toBeAbsent(),
      ),
  )

  it.effect(
    'hides in the installed app and on a desktop with no way to install',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(modifyFields(onIphone, { screenFit: () => 'Installed' })),
          measureSurface,
          Scene.expect(homeScreenTip).toBeAbsent(),
          Scene.expect(fullscreenButton).toBeAbsent(),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFields(initialModel, { screenFit: () => 'Fullscreen' }),
          ),
          measureSurface,
          Scene.expect(homeScreenTip).toBeAbsent(),
          Scene.expect(installButton).toBeAbsent(),
        )
      }),
  )
})

describe('the first break on screen', () => {
  it.effect('has no timer, and the timer line says so', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
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
      Scene.expect(Scene.role('timer')).toHaveText(
        'Wave 2 starts when you are ready.',
      ),
      Scene.expect(
        Scene.role('button', { name: 'Start wave 2 now' }),
      ).toExist(),
    ),
  )
})

describe('the title icons and the character picker', () => {
  const showPicker = [
    Scene.Command.resolve(
      Dialog.test.ShowDialog,
      DialogBlock.Message.SucceededShowDialog(),
    ),
  ]

  it.effect('the title keeps its corner clear for the picker', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(onTouch(initialModel), { screenFit: () => 'HomeScreen' }),
      ),
      measureSurface,
      Scene.expect(muteButton).toBeAbsent(),
      Scene.expect(homeScreenTip).toExist(),
      Scene.click(
        Scene.role('button', { name: 'Your character: change how you look' }),
      ),
      ...showPicker,
      Scene.expect(Scene.role('dialog', { name: 'Profile' })).toExist(),
      Scene.expect(muteButton).toBeAbsent(),
      Scene.expect(musicButton).toBeAbsent(),
    ),
  )

  it.effect('C opens the Profile from the title', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(asVeteran(initialModel)),
      measureSurface,
      Scene.Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyC' }),
      ),
      ...showPicker,
      Scene.expect(Scene.role('dialog', { name: 'Profile' })).toExist(),
    ),
  )
})
