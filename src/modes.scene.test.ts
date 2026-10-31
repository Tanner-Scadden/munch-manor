import { Array, Option } from 'effect'
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { FIXED_STEP_MS, PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { withBests } from './home'
import { Message } from './message'
import { type Model, Phase, RunMode, initialModel } from './model'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  holdingSecond,
  keepGoingButton,
  measureSurface,
  modeButton,
  playButton,
  playEndlessButton,
  retryButton,
  shareMountEnded,
  shareMountSettles,
} from './testing'
import { asVeteran } from './veteran'

const endlessModeButton = role('button', {
  name: 'Mode: Endless. Switch to Campaign',
})
const START_PROMPT =
  'Press Enter, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  test('the home menu offers PLAY with a mode toggle, and PLAY in Endless starts endless', () => {
    scene(
      ROOT,
      given(asVeteran(initialModel)),
      measureSurface,
      expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(modeButton).toHaveAttr('aria-keyshortcuts', 'E'),
      expect(selector('.home-key')).toExist(),
      expect(keepGoingButton).toBeAbsent(),
      click(modeButton),
      expect(endlessModeButton).toExist(),
      click(playEndlessButton),
      expect(role('status')).toHaveText(
        `Get ready for endless wave 1. ${START_PROMPT}`,
      ),
      expect(playEndlessButton).toBeAbsent(),
    )
  })

  test('the Play button starts the 10 wave campaign', () => {
    scene(
      ROOT,
      given(
        modifyFields(asVeteran(initialModel), {
          mode: () => RunMode.Endless(),
        }),
      ),
      measureSurface,
      click(playButton),
      expect(role('status')).toHaveText(
        `Get ready for wave 1 of 10. ${START_PROMPT}`,
      ),
    )
  })

  test('touch shows the buttons without key badges, and PLAY as its icon alone', () => {
    scene(
      ROOT,
      given(modifyFields(initialModel, { lastDevice: () => 'Touch' })),
      measureSurface,
      expect(playButton).toExist(),
      expect(playButton).toHaveText(''),
      expect(selector('.home-play-icon')).toExist(),
      expect(selector('.home-key')).toBeAbsent(),
    )
  })

  test('Victory offers Keep going after the grace, and it carries on into wave 11', () => {
    const victorious: Model = modifyFields(asVeteran(initialModel), {
      phase: () => Phase.Victory(),
      wallet: () => ({ balance: 321, earned: 1900, shown: 321 }),
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond({ kind: 'Smg', rounds: 99, loaded: 40, tier: 2 }),
        }),
    })
    scene(
      ROOT,
      given(victorious),
      measureSurface,
      expect(keepGoingButton).toBeAbsent(),
      ...Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
        Subscription.emit(
          SCENE_SUBSCRIPTIONS.frame,
          Message.TickedFrame({ deltaTime: 50 }),
        ),
      ),
      expect(keepGoingButton).toHaveAttr('aria-keyshortcuts', 'K'),
      expect(retryButton).toExist(),
      shareMountSettles('Cancelled'),
      click(keepGoingButton),
      shareMountEnded(),
      expect(role('status')).toHaveText(
        `Get ready for endless wave 11. ${START_PROMPT} The shop stall in the bottom right corner is open. Walk up to it from any side to browse.`,
      ),
      expect(
        text(
          'You have $321. Holding the Chatterbox DELUXE. Other slot: Pop Pistol, upgrade tier 0 of 3.',
        ),
      ).toExist(),
    )
  })

  test('Game Over and Victory ask the player to tell whoever sent the game what they think', () => {
    const FEEDBACK = 'Tell whoever sent you this what you think!'
    Array.forEach([Phase.GameOver({ wave: 4 }), Phase.Victory()], phase => {
      scene(
        ROOT,
        given(modifyFields(initialModel, { phase: () => phase })),
        measureSurface,
        expect(role('status')).toContainText(FEEDBACK),
      )
    })
    scene(
      ROOT,
      given(initialModel),
      measureSurface,
      expect(role('status')).not.toContainText(FEEDBACK),
    )
  })

  test('an endless Game Over reads out the wave reached and your best', () => {
    scene(
      ROOT,
      given(
        modifyFields(
          withBests(initialModel, bests =>
            modifyFields(bests, {
              maybeBestEndlessWave: () => Option.some(14),
            }),
          ),
          {
            mode: () => RunMode.Endless(),
            phase: () => Phase.GameOver({ wave: 12 }),
          },
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText(
        'Wave reached: 12. Your best: wave 14.',
      ),
    )
  })
})

describe('Upgrades in the shop', () => {
  const atStall: Model = modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave: 4,
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
    player: player =>
      modifyFields(player, {
        x: () => 270,
        y: () => 142,
        arsenal: () =>
          holdingSecond({ kind: 'Shotgun', rounds: 16, loaded: 6, tier: 2 }),
      }),
    wallet: () => ({ balance: 400, earned: 400, shown: 400 }),
  })

  test('names the next tier, says what changes, buys it, and shows MAX once done', () => {
    const nextShotgunTier = role('button', {
      name: 'Barn Buster 3000, upgrade for Barn Buster DELUXE, $320',
    })
    scene(
      ROOT,
      given(atStall),
      measureSurface,
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.frame,
        Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
      ),
      Command.resolve(
        Dialog.test.ShowDialog,
        DialogBlock.Message.SucceededShowDialog(),
      ),
      expect(role('tab', { name: /^Guns,/ })).toHaveAttr(
        'aria-selected',
        'true',
      ),
      expect(role('heading', { name: 'Barn Buster DELUXE' })).toExist(),
      expect(
        text(
          'Hits for 2 instead of 1. Reloads in 0.75 s instead of 0.9. Holds 80 shells instead of 64.',
        ),
      ).toExist(),
      expect(role('img', { name: 'Tier 2 of 3' })).toExist(),
      expect(
        role('button', {
          name: 'Beefy Pop Pistol, upgrade for Pop Pistol, $200',
        }),
      ).not.toHaveAttr('aria-disabled', 'true'),
      expect(
        role('button', {
          name: 'Beefy Chatterbox, upgrade for Chatterbox, $60',
        }),
      ).toBeAbsent(),
      click(nextShotgunTier),
      expect(text('You have $80')).toExist(),
      expect(role('heading', { name: 'Barn Buster 3000' })).toExist(),
      expect(role('img', { name: 'Tier 3 of 3' })).toExist(),
      expect(
        role('button', { name: 'Barn Buster 3000, fully upgraded' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Fully upgraded')).toExist(),
      expect(text('MAX')).toExist(),
      expect(
        role('button', {
          name: 'Beefy Pop Pistol, upgrade for Pop Pistol, $200',
        }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Need $120 more')).toExist(),
      expect(
        text(
          'Two guns. A new one replaces the one in your hands, upgrades and all.',
        ),
      ).toExist(),
      expect(
        text('Replaces your Barn Buster 3000, and its upgrades are lost'),
      ).toExist(),
    )
  })
})
