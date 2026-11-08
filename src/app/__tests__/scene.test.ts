import { Array, Effect, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'
import { Dialog, DialogBlock, Tabs } from '@foldkit/ui'

import indexHtml from '../../../index.html?raw'
import { FEEDBACK_RUNS } from '../../domain/run'
import { DEBUT_CARD_MIN_MS } from '../../features/onboarding/onboarding'
import { Message as ShopMessage } from '../../features/shop/message'
import { ShopTabsBlock } from '../../features/shop/shopTabs'
import { FocusItem } from '../../features/shop/steps'
import {
  FIXED_STEP_MS,
  GAME_TITLE,
  PREPARATION_MS,
} from '../../shared/constants'
import { pastFirstBreak } from '../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  holdingSecond,
  measureSurface,
  playButton,
  startRunInScene,
  withPistol,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { STARTING_PISTOL, maxRounds } from '../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../world/party/party'
import { Arsenal } from '../../world/schema/worldSchema'
import { pause } from '../../world/waves/waves'
import { Message } from '../message'
import { DifficultyCard, type Model, Phase, Reload } from '../model'
import { initialModel } from '../pureApp'

const PLAY_AGAIN =
  'Press Enter or choose Retry to play again, or E for an endless run. Press X or choose Share to post your run on X.'

const KEEP_GOING =
  'Press K or choose Keep going to carry on into endless from wave 11 with your money, guns, and traps.'

const BACK_HOME = 'Press H or choose Menu to go back to the main menu.'

const FEEDBACK = 'Tell whoever sent you this what you think!'
const READY_STATUS = `${GAME_TITLE}, an early alpha. Main menu. Press Enter or choose Play. Press V or choose Manor for your character, the Munchopedia, what is new, and how to play. Press O or choose the gear for settings. Arrow keys move between the buttons.`

const PAUSED_STATUS =
  'Paused during wave 3 of 10. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const pausedRound: Model = pause(
  modifyFields(asVeteran(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const PREPARING_WAVE_ONE =
  'Get ready for wave 1 of 10. Press Enter, or use the Start wave button, to start it now.'

describe('Ready screen', () => {
  it.effect(
    'waits for a button: a tap beside the buttons starts nothing, and Play starts the campaign',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(asVeteran(initialModel)),
        measureSurface,
        Scene.expect(Scene.role('heading', { name: GAME_TITLE })).toExist(),
        Scene.expect(Scene.role('status')).toHaveText(READY_STATUS),
        Scene.pointerDown(Scene.role('application', { name: 'Game surface' }), {
          pointerType: 'touch',
          pointerId: 7,
          clientX: 120,
          clientY: 300,
        }),
        Scene.expect(Scene.role('status')).toHaveText(READY_STATUS),
        Scene.expect(Scene.selector('[data-stick="move"]')).toBeAbsent(),
        ...startRunInScene(),
        Scene.expect(Scene.role('status')).toHaveText(PREPARING_WAVE_ONE),
      ),
  )
})

describe('Mute button', () => {
  it.effect(
    'toggles sound with a click or tap and reports its pressed state',
    () => {
      const muteButton = Scene.role('button', { name: 'Mute sound' })
      return Scene.scene(
        APPLICATION,
        Scene.given(pausedRound),
        measureSurface,
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'false'),
        Scene.click(muteButton),
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(Scene.role('status')).toHaveText(PAUSED_STATUS),
        Scene.click(muteButton),
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      )
    },
  )
})

describe('Music button', () => {
  it.effect(
    'sits beside mute, toggles music with a click or tap, and reports its pressed state',
    () => {
      const musicButton = Scene.role('button', { name: 'Music' })
      const muteButton = Scene.role('button', { name: 'Mute sound' })
      return Scene.scene(
        APPLICATION,
        Scene.given(pausedRound),
        measureSurface,
        Scene.expect(musicButton).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(musicButton).toHaveAttr('aria-keyshortcuts', 'N'),
        Scene.click(musicButton),
        Scene.expect(musicButton).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(muteButton).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(Scene.role('status')).toHaveText(PAUSED_STATUS),
        Scene.click(musicButton),
        Scene.expect(musicButton).toHaveAttr('aria-pressed', 'true'),
      )
    },
  )
})

describe('Start wave button', () => {
  it.effect(
    'appears during preparation, starts the wave on a click, then goes away',
    () => {
      const startWaveButton = Scene.role('button', { name: 'Start wave 1 now' })
      return Scene.scene(
        APPLICATION,
        Scene.given(asVeteran(initialModel)),
        measureSurface,
        Scene.expect(startWaveButton).toBeAbsent(),
        ...startRunInScene(),
        Scene.expect(Scene.role('status')).toHaveText(PREPARING_WAVE_ONE),
        Scene.expect(Scene.role('timer')).toHaveText('6 seconds until wave 1.'),
        Scene.expect(startWaveButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.click(startWaveButton),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 1 of 10.'),
        Scene.expect(startWaveButton).toBeAbsent(),
        Scene.expect(Scene.role('timer')).toBeAbsent(),
      )
    },
  )
})

describe('Shop', () => {
  const atStall: Model = modifyFocus(
    modifyFields(pastFirstBreak(initialModel), {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 15_000,
          durationMs: PREPARATION_MS,
          spawns: [
            {
              atMs: 1e9,
              kind: 'Shambler',
              door: 'North',
              offset: 0,
              speedScale: 1,
              hpScale: 1,
              pack: 0,
              formation: 'Squad',
            },
          ],
        }),
    }),
    {
      player: player =>
        modifyFields(player, { x: () => 270, y: () => 142, hp: () => 3 }),
      wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
    },
  )

  const shotgunButton = Scene.role('button', {
    name: 'Buy Barn Buster for $35',
  })
  const smgButton = Scene.role('button', { name: 'Buy Chatterbox for $100' })
  const shellsButton = Scene.role('button', {
    name: 'Shell Sack, ammo for Barn Buster, $10, adds 16 shells',
  })
  const shotgunUpgradeButton = Scene.role('button', {
    name: 'Beefy Barn Buster, upgrade for Barn Buster, $40',
  })
  const heartButton = Scene.role('button', {
    name: 'Buy Pickled Heart for $25',
  })
  const swapButton = Scene.role('button', { name: 'Switch to the Pop Pistol' })
  const gunsTab = Scene.role('tab', { name: /^Guns,/ })
  const healthTab = Scene.role('tab', { name: /^Health,/ })
  const trapsTab = Scene.role('tab', { name: /^Traps,/ })
  const resolveFocusTab = Scene.Command.resolve(
    Tabs.test.FocusTab,
    ShopTabsBlock.Message.CompletedFocusTab(),
  )
  const openShop = () => [
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ),
    Scene.Command.resolve(
      Dialog.test.ShowDialog,
      DialogBlock.Message.SucceededShowDialog(),
    ),
  ]
  const leaveShop = () => [
    Scene.expect(Scene.role('button', { name: 'Leave shop' })).toHaveClass(
      'menu-close',
    ),
    Scene.click(Scene.role('button', { name: 'Leave shop' })),
    Scene.Command.resolve(
      Dialog.test.CloseDialog,
      DialogBlock.Message.CompletedCloseDialog(),
    ),
  ]

  it.effect(
    'prices and the balance show a coin and read as plain dollars',
    () => {
      const shotgunPrice = Scene.within(
        shotgunButton,
        Scene.selector('.shop-item-price'),
      )
      const smgReason = Scene.within(
        smgButton,
        Scene.selector('.shop-item-reason'),
      )
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall, {
            wallet: () => ({ balance: 70, earned: 70, shown: 70 }),
          }),
        ),
        measureSurface,
        ...openShop(),
        Scene.expect(Scene.selector('.shop-balance')).toHaveText(
          'You have $70',
        ),
        Scene.expect(
          Scene.within(
            Scene.selector('.shop-balance'),
            Scene.selector('.coin-icon'),
          ),
        ).toHaveAttr('aria-hidden', 'true'),
        Scene.expect(shotgunPrice).toHaveText('$35'),
        Scene.expect(
          Scene.within(shotgunPrice, Scene.selector('.coin-icon')),
        ).toHaveAttr('aria-hidden', 'true'),
        Scene.expect(
          Scene.within(shotgunPrice, Scene.selector('.sr-only')),
        ).toHaveText('$'),
        Scene.expect(smgReason).toHaveText('Need $30 more'),
        Scene.expect(
          Scene.within(smgReason, Scene.selector('.coin-icon')),
        ).toExist(),
      )
    },
  )

  it.effect(
    'opens on the Guns tab, buys with the keyboard and a click, switches tabs, and closes',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall, {
            wallet: () => ({ balance: 70, earned: 70, shown: 70 }),
          }),
        ),
        measureSurface,
        Scene.expect(
          Scene.role('heading', { name: "Rattles' Bone Bazaar" }),
        ).toBeAbsent(),
        ...openShop(),
        Scene.expect(
          Scene.role('heading', { name: "Rattles' Bone Bazaar" }),
        ).toExist(),
        Scene.expect(Scene.text('You have $70')).toExist(),
        Scene.expect(gunsTab).toHaveAttr('aria-selected', 'true'),
        Scene.expect(shellsButton).toBeAbsent(),
        Scene.expect(smgButton).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(Scene.text('Need $30 more')).toExist(),
        Scene.keydown(shotgunButton, 'ArrowDown'),
        Scene.Command.resolve(FocusItem, ShopMessage.CompletedFocusItem()),
        Scene.keydown(smgButton, 'Enter'),
        Scene.expect(Scene.text('You have $70')).toExist(),
        Scene.keydown(smgButton, 'ArrowUp'),
        Scene.Command.resolve(FocusItem, ShopMessage.CompletedFocusItem()),
        Scene.keydown(shotgunButton, 'Enter'),
        Scene.Command.resolve(
          FocusItem({ item: 'ShotgunShells' }),
          ShopMessage.CompletedFocusItem(),
        ),
        Scene.expect(Scene.text('You have $35')).toExist(),
        Scene.expect(shotgunButton).toBeAbsent(),
        Scene.expect(Scene.role('heading', { name: 'Barn Buster' })).toExist(),
        Scene.expect(Scene.text('OWNED')).toExist(),
        Scene.expect(Scene.text('6 loaded, 10 spare')).toExist(),
        Scene.expect(Scene.role('img', { name: 'Tier 0 of 3' })).toExist(),
        Scene.expect(
          Scene.role('list', { name: 'For your Barn Buster' }),
        ).toExist(),
        Scene.expect(
          Scene.text('Adds 16 shells. You have 16 of 48.'),
        ).toExist(),
        Scene.expect(shotgunUpgradeButton).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(Scene.text('Need $5 more')).toExist(),
        Scene.keydown(shellsButton, 'Enter'),
        Scene.expect(Scene.text('You have $25')).toExist(),
        Scene.expect(Scene.text('6 loaded, 26 spare')).toExist(),
        Scene.expect(shellsButton).not.toHaveAttr('aria-disabled', 'true'),
        Scene.expect(Scene.text('Need $15 more')).toExist(),
        Scene.keydown(shellsButton, 'ArrowDown'),
        Scene.Command.resolve(
          FocusItem({ item: 'ShotgunUpgrade' }),
          ShopMessage.CompletedFocusItem(),
        ),
        Scene.keydown(shotgunUpgradeButton, 'ArrowDown'),
        Scene.Command.resolve(
          FocusItem({ item: 'Smg' }),
          ShopMessage.CompletedFocusItem(),
        ),
        Scene.keydown(smgButton, 'Home'),
        Scene.Command.resolve(
          FocusItem({ item: 'PistolUpgrade' }),
          ShopMessage.CompletedFocusItem(),
        ),
        Scene.expect(
          Scene.role('button', {
            name: 'Beefy Pop Pistol, upgrade for Pop Pistol, $200',
          }),
        ).toHaveAttr('aria-disabled', 'true'),
        Scene.keydown(gunsTab, 'ArrowRight'),
        resolveFocusTab,
        Scene.expect(healthTab).toHaveAttr('aria-selected', 'true'),
        Scene.expect(shellsButton).toBeAbsent(),
        Scene.click(heartButton),
        Scene.expect(Scene.text('You have $0')).toExist(),
        Scene.expect(Scene.text('Hearts 4 of 5')).toExist(),
        ...leaveShop(),
        Scene.expect(
          Scene.role('heading', { name: "Rattles' Bone Bazaar" }),
        ).toBeAbsent(),
        Scene.expect(swapButton).toHaveAttr('aria-keyshortcuts', 'Q'),
      ),
  )

  it.effect('a full gun cannot take more ammo, and says why', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(atStall, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond({
                  kind: 'Shotgun',
                  rounds: 44,
                  loaded: 6,
                  tier: 0,
                }),
            }),
        }),
      ),
      measureSurface,
      ...openShop(),
      Scene.expect(
        Scene.role('button', {
          name: 'Shell Sack, ammo for Barn Buster, $10, adds 4 shells and fills it',
        }),
      ).not.toHaveAttr('aria-disabled', 'true'),
      Scene.click(
        Scene.role('button', {
          name: 'Shell Sack, ammo for Barn Buster, $10, adds 4 shells and fills it',
        }),
      ),
      Scene.expect(
        Scene.role('button', {
          name: 'Shell Sack, ammo for Barn Buster, $10, adds up to 16 shells',
        }),
      ).toHaveAttr('aria-disabled', 'true'),
      Scene.expect(Scene.text('Your Barn Buster is full')).toExist(),
      Scene.expect(Scene.text('6 loaded, 42 spare')).toExist(),
    ),
  )

  it.effect(
    'an upgraded gun goes by its tier name everywhere in the shop',
    () => {
      const fullDrum = Scene.role('button', {
        name: 'Chatter Drum, ammo for Beefy Chatterbox, $20, adds up to 120 rounds',
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall, {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  Arsenal.HoldingSecond({
                    first: { ...STARTING_PISTOL, tier: 1 },
                    second: {
                      kind: 'Smg',
                      rounds: maxRounds('Smg', 1),
                      loaded: 30,
                      tier: 1,
                    },
                  }),
              }),
          }),
        ),
        measureSurface,
        ...openShop(),
        Scene.expect(
          Scene.role('heading', { name: 'Beefy Chatterbox' }),
        ).toExist(),
        Scene.expect(
          Scene.role('list', { name: 'For your Beefy Chatterbox' }),
        ).toExist(),
        Scene.expect(fullDrum).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(
          Scene.within(fullDrum, Scene.text('Your Beefy Chatterbox is full')),
        ).toExist(),
        Scene.expect(Scene.text('Your Chatterbox is full')).toBeAbsent(),
        Scene.expect(
          Scene.text(
            'Two guns. A new one replaces the one in your hands, upgrades and all.',
          ),
        ).toExist(),
        Scene.expect(
          Scene.text(
            'Replaces your Beefy Chatterbox, and its upgrades are lost',
          ),
        ).toExist(),
      )
    },
  )

  it.effect(
    'buys a Plank Pile, and the PLACE button explains it needs a doorway',
    () => {
      const placeButton = Scene.role('button', { name: 'Place a Plank Pile' })
      return Scene.scene(
        APPLICATION,
        Scene.given(atStall),
        measureSurface,
        Scene.expect(placeButton).toBeAbsent(),
        ...openShop(),
        Scene.click(trapsTab),
        resolveFocusTab,
        Scene.expect(
          Scene.text('0 ready to place, 0 placed, up to 2'),
        ).toExist(),
        Scene.click(Scene.role('button', { name: 'Buy Plank Pile for $95' })),
        Scene.expect(Scene.text('You have $5')).toExist(),
        Scene.expect(
          Scene.text('1 ready to place, 0 placed, up to 2'),
        ).toExist(),
        Scene.expect(
          Scene.role('button', { name: /^Repair the/ }),
        ).toBeAbsent(),
        ...leaveShop(),
        Scene.expect(placeButton).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(placeButton).toHaveAttr('aria-keyshortcuts', 'T'),
        Scene.expect(Scene.text('Stand in a doorway to board it up')).toExist(),
      )
    },
  )

  it.effect(
    'each tab counts what the player can buy, and the shop sums it up',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall, {
            wallet: () => ({ balance: 37, earned: 37, shown: 37 }),
          }),
        ),
        measureSurface,
        ...openShop(),
        Scene.expect(
          Scene.role('tab', { name: 'Guns, 1 you can buy' }),
        ).toExist(),
        Scene.expect(
          Scene.role('tab', { name: 'Health, 1 you can buy' }),
        ).toExist(),
        Scene.expect(
          Scene.role('tab', { name: 'Traps, nothing you can buy' }),
        ).toExist(),
        Scene.expect(Scene.text('2 things you can buy now')).toExist(),
        Scene.expect(
          Scene.selector('[data-verdict="available"] #shop-item-Shotgun'),
        ).toExist(),
        Scene.expect(
          Scene.selector('[data-verdict="refused"] #shop-item-Smg'),
        ).toExist(),
        Scene.click(shotgunButton),
        Scene.Command.resolve(FocusItem, ShopMessage.CompletedFocusItem()),
        Scene.expect(
          Scene.role('tab', { name: 'Guns, nothing you can buy' }),
        ).toExist(),
        Scene.expect(
          Scene.role('tab', { name: 'Health, nothing you can buy' }),
        ).toExist(),
        Scene.expect(Scene.text('Nothing you can buy right now')).toExist(),
      ),
  )

  it.effect('with a second gun, a click on the other slot swaps to it', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(atStall, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond({ kind: 'Smg', rounds: 30, loaded: 30, tier: 0 }),
            }),
        }),
      ),
      measureSurface,
      Scene.click(Scene.role('button', { name: 'Switch to the Pop Pistol' })),
      Scene.expect(
        Scene.role('button', { name: 'Switch to the Chatterbox' }),
      ).toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Reload the Pop Pistol' }),
      ).toExist(),
    ),
  )
})

describe('Reload button', () => {
  const fighting: Model = modifyFocus(
    modifyFields(initialModel, {
      phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    }),
    {
      player: player =>
        withPistol(player, pistol => ({ ...pistol, loaded: 2 })),
    },
  )
  const reloadButton = Scene.role('button', { name: 'Reload the Pop Pistol' })

  it.effect('shows on touch and starts a reload when tapped', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(fighting, { lastDevice: () => 'Touch' })),
        measureSurface,
        Scene.expect(reloadButton).toHaveAttr('aria-keyshortcuts', 'R'),
        Scene.click(reloadButton),
        Scene.expect(reloadButton).toExist(),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(fighting),
        Story.message(Message.ClickedReloadButton()),
        Story.model(reloaded => {
          vitestExpect(
            Reload.isAnyOf(['Reloading'])(focusOf(reloaded).player.reload),
          ).toBe(true)
        }),
      )
    }),
  )

  it.effect('stays hidden on a keyboard, where the held gun shows R', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(fighting),
      measureSurface,
      Scene.expect(Scene.selector('.reload-icon-button')).toBeAbsent(),
      Scene.expect(
        Scene.within(reloadButton, Scene.selector('.key-badge')),
      ).toHaveText('R'),
    ),
  )
})

describe('Place button', () => {
  const atNorthDoor: Model = modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 15_000,
          durationMs: PREPARATION_MS,
          spawns: [
            {
              atMs: 1e9,
              kind: 'Shambler',
              door: 'North',
              offset: 0,
              speedScale: 1,
              hpScale: 1,
              pack: 0,
              formation: 'Squad',
            },
          ],
        }),
    }),
    {
      player: player => modifyFields(player, { x: () => 220, y: () => 27 }),
      trapStock: () => ({ Barricade: 1, Turret: 1 }),
    },
  )

  it.effect(
    'places the selected trap on a tap, and NEXT switches the kind',
    () => {
      const plankButton = Scene.role('button', { name: 'Place a Plank Pile' })
      const gnomeButton = Scene.role('button', { name: 'Place a Grumpy Gnome' })
      return Scene.scene(
        APPLICATION,
        Scene.given(atNorthDoor),
        measureSurface,
        Scene.expect(plankButton).not.toHaveAttr('aria-disabled', 'true'),
        Scene.expect(
          Scene.within(plankButton, Scene.selector('.icon-button-badge')),
        ).toHaveText('x1'),
        Scene.expect(
          Scene.within(plankButton, Scene.selector('.key-badge')),
        ).toHaveText('T'),
        Scene.click(
          Scene.role('button', { name: 'Switch to the Grumpy Gnome' }),
        ),
        Scene.expect(gnomeButton).toExist(),
        Scene.expect(plankButton).toBeAbsent(),
        Scene.click(Scene.role('button', { name: 'Switch to the Plank Pile' })),
        Scene.click(plankButton),
        Scene.expect(plankButton).toBeAbsent(),
        Scene.expect(gnomeButton).toExist(),
        Scene.expect(
          Scene.role('button', { name: 'Switch to the Plank Pile' }),
        ).toBeAbsent(),
        Scene.click(gnomeButton),
        Scene.expect(gnomeButton).toBeAbsent(),
        Scene.expect(Scene.text('Traps go down between waves')).toBeAbsent(),
      )
    },
  )

  it.effect('is not offered without traps or outside Preparation', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atNorthDoor, {
            trapStock: () => ({ Barricade: 0, Turret: 0 }),
          }),
        ),
        measureSurface,
        Scene.expect(
          Scene.role('button', { name: 'Place a Plank Pile' }),
        ).toBeAbsent(),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(atNorthDoor, {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          }),
        ),
        measureSurface,
        Scene.expect(
          Scene.role('button', { name: 'Place a Plank Pile' }),
        ).toBeAbsent(),
      )
    }),
  )
})

describe('Run stats', () => {
  const finished = (phase: Phase): Model =>
    modifyFocus(
      modifyFields(initialModel, {
        phase: () => phase,
        stats: () => ({
          kills: {
            Shambler: 41,
            Runner: 17,
            Tank: 2,
            Exploder: 9,
            Thrower: 0,
            Crawler: 0,
            Boss: 0,
          },
          wavesCleared: 3,
          shotsFired: 1240,
          shotsHit: 532,
          heartsLost: 7,
          trapsPlaced: 3,
          purchases: 4,
          powerUpsGrabbed: 2,
          maybeLastHurtBy: Option.some('Runner'),
          activeFrames: 22_260,
          activeFrameMs: 371_000,
          runMs: 371_000,
        }),
      }),
      { wallet: () => ({ balance: 40, earned: 615, shown: 40 }) },
    )
  const STATS =
    'Waves cleared: 3 of 10. Zombies splatted: 69 (41 Groaner, 17 Hotfoot, 9 Kaboomer, 2 Big Lug, 0 Big Leaguer, 0 Ankle Biter). Best streak 0. Run time 6:11. Accuracy 43 percent. Money earned $615.'

  it.effect('Game Over reads out the verdict and the whole run', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(finished(Phase.GameOver({ wave: 4 }))),
      measureSurface,
      Scene.expect(Scene.role('status')).toHaveText(
        `Game over. Eaten on wave 4. Difficulty: Normal. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
      ),
    ),
  )

  it.effect('Victory reads out the verdict and the whole run', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(finished(Phase.Victory())),
      measureSurface,
      Scene.expect(Scene.role('status')).toHaveText(
        `Victory. The house is yours. For now. Difficulty: Normal. ${STATS} ${KEEP_GOING} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
      ),
    ),
  )
  const afterRuns = (runs: number, phase: Phase): Model =>
    modifyFields(finished(phase), {
      bests: bests => modifyFields(bests, { runsPlayed: () => runs }),
    })

  it.effect('the end screens still ask for feedback on the third run', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(afterRuns(FEEDBACK_RUNS, Phase.GameOver({ wave: 4 }))),
      measureSurface,
      Scene.expect(Scene.role('status')).toHaveText(
        `Game over. Eaten on wave 4. Difficulty: Normal. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
      ),
    ),
  )

  it.effect(
    'the end screens stop asking for feedback after the first few runs',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            afterRuns(FEEDBACK_RUNS + 1, Phase.GameOver({ wave: 4 })),
          ),
          measureSurface,
          Scene.expect(Scene.role('status')).toHaveText(
            `Game over. Eaten on wave 4. Difficulty: Normal. ${STATS} ${PLAY_AGAIN} ${BACK_HOME}`,
          ),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(afterRuns(FEEDBACK_RUNS + 1, Phase.Victory())),
          measureSurface,
          Scene.expect(Scene.role('status')).toHaveText(
            `Victory. The house is yours. For now. Difficulty: Normal. ${STATS} ${KEEP_GOING} ${PLAY_AGAIN} ${BACK_HOME}`,
          ),
        )
      }),
  )
})

describe('Title', () => {
  // NOTE: a Block-aware Scene draws the document's body only, so this one
  // renders the acquired root through a view of its own that also shows
  // the document's title (FOLDKIT.md "Testing": `withBlock` for a custom
  // renderer).
  it.effect(
    'the working title names the document, the page, and index.html',
    () =>
      Story.withBlock(APPLICATION, block => {
        vitestExpect(indexHtml).toContain(`<title>${GAME_TITLE}</title>`)
        return Scene.scene(
          {
            update: block.update,
            view: (...[current, h]: Parameters<typeof block.view>) => {
              const document = block.view(current, h)
              return h.div(
                [h.DataAttribute('document-title', document.title)],
                [document.body],
              )
            },
          },
          Scene.given(initialModel),
          measureSurface,
          Scene.expect(
            Scene.selector(`[data-document-title="${GAME_TITLE}"]`),
          ).toExist(),
          Scene.expect(Scene.role('heading', { name: GAME_TITLE })).toExist(),
        )
      }),
  )
})

const CARD_TICKS = Math.ceil(DEBUT_CARD_MIN_MS / 50)

describe('New zombie card', () => {
  it.effect(
    'stays out of Preparation, then reads out the new kind when the wave starts',
    () => {
      const tapToContinue = Scene.role('button', { name: 'TAP TO CONTINUE' })
      const card = Scene.role('group', { name: 'New zombie: Groaner' })
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(initialModel, {
            lastDevice: () => 'Touch',
            difficultyCard: () => DifficultyCard.Seen(),
          }),
        ),
        measureSurface,
        Scene.click(playButton),
        Scene.expect(card).toBeAbsent(),
        Scene.expect(Scene.selector('[data-ghost="Move"]')).toExist(),
        Scene.expect(Scene.selector('[data-ghost="Aim"]')).toExist(),
        Scene.click(Scene.role('button', { name: 'Start wave 1 now' })),
        Scene.expect(card).toExist(),
        Scene.expect(
          Scene.text("He's slow. Back up and keep shooting."),
        ).toExist(),
        Scene.expect(tapToContinue).toBeAbsent(),
        Scene.expect(Scene.role('status')).toHaveText(
          "New zombie: Groaner. He's slow. Back up and keep shooting. The wave starts in a moment. Once Continue shows, press Enter or choose it to start now.",
        ),
        ...Array.makeBy(CARD_TICKS - 1, () =>
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.frame,
            Message.TickedFrame({ deltaTime: 50 }),
          ),
        ),
        Scene.expect(tapToContinue).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.frame,
          Message.TickedFrame({ deltaTime: 50 }),
        ),
        Scene.expect(tapToContinue).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.click(tapToContinue),
        Scene.expect(card).toBeAbsent(),
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 1 of 10.'),
      )
    },
  )

  it.effect(
    'shows CONTINUE with an ENTER key on a keyboard once it can be skipped',
    () => {
      const continueButton = Scene.role('button', { name: 'CONTINUE' })
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(asVeteran(initialModel), { introducedKinds: () => [] }),
        ),
        measureSurface,
        ...startRunInScene(),
        Scene.click(Scene.role('button', { name: 'Start wave 1 now' })),
        Scene.expect(continueButton).toBeAbsent(),
        ...Array.makeBy(CARD_TICKS, () =>
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.frame,
            Message.TickedFrame({ deltaTime: 50 }),
          ),
        ),
        Scene.expect(continueButton).toExist(),
        Scene.expect(Scene.text('ENTER')).toExist(),
      )
    },
  )
})
