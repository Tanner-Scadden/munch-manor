import { Array, Effect, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from '../../../app/message'
import { type Model, Phase, RunMode } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { withBests } from '../../../domain/run'
import {
  FIXED_STEP_MS,
  PREPARATION_MS,
  RESTART_GRACE_MS,
} from '../../../shared/constants'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  holdingSecond,
  keepGoingButton,
  lobbyMode,
  lobbyStartButton,
  measureSurface,
  openLobbyInScene,
  playButton,
  playEndlessButton,
  resolveFocusLobbyInScene,
  retryButton,
  shareMountEnded,
  shareMountSettles,
  startRunInScene,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { modifyFocus } from '../../../world/party/party'

const endlessModeButton = Scene.role('button', { name: 'Endless' })
const START_PROMPT =
  'Press Enter, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  it.effect(
    'the home menu offers PLAY alone, and the lobby picks endless and starts it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(asVeteran(initialModel)),
        measureSurface,
        Scene.expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.expect(endlessModeButton).toBeAbsent(),
        Scene.expect(Scene.selector('.home-key')).toExist(),
        Scene.expect(keepGoingButton).toBeAbsent(),
        ...openLobbyInScene(),
        Scene.expect(endlessModeButton).toHaveAttr('aria-pressed', 'false'),
        Scene.click(endlessModeButton),
        resolveFocusLobbyInScene(),
        Scene.expect(endlessModeButton).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(lobbyMode('Campaign')).toHaveAttr('aria-pressed', 'false'),
        Scene.click(lobbyStartButton),
        Scene.expect(Scene.role('status')).toHaveText(
          `Get ready for endless wave 1. ${START_PROMPT}`,
        ),
        Scene.expect(playEndlessButton).toBeAbsent(),
      ),
  )

  it.effect('the Play button starts the 10 wave campaign', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(asVeteran(initialModel), {
          mode: () => RunMode.Endless(),
        }),
      ),
      measureSurface,
      ...startRunInScene(),
      Scene.expect(Scene.role('status')).toHaveText(
        `Get ready for wave 1 of 10. ${START_PROMPT}`,
      ),
    ),
  )

  it.effect(
    'touch shows the buttons without key badges, and PLAY as its icon alone',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(initialModel, { lastDevice: () => 'Touch' })),
        measureSurface,
        Scene.expect(playButton).toExist(),
        Scene.expect(playButton).toHaveText(''),
        Scene.expect(Scene.selector('.home-play-icon')).toExist(),
        Scene.expect(Scene.selector('.home-key')).toBeAbsent(),
      ),
  )

  it.effect(
    'Victory offers Keep going after the grace, and it carries on into wave 11',
    () => {
      const victorious: Model = modifyFocus(
        modifyFields(asVeteran(initialModel), { phase: () => Phase.Victory() }),
        {
          wallet: () => ({ balance: 321, earned: 1900, shown: 321 }),
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond({ kind: 'Smg', loaded: 40, tier: 2, kills: 0 }),
            }),
        },
      )
      return Scene.scene(
        APPLICATION,
        Scene.given(victorious),
        measureSurface,
        Scene.expect(keepGoingButton).toBeAbsent(),
        ...Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.frame,
            Message.TickedFrame({ deltaTime: 50 }),
          ),
        ),
        Scene.expect(keepGoingButton).toHaveAttr('aria-keyshortcuts', 'K'),
        Scene.expect(retryButton).toExist(),
        shareMountSettles('Cancelled'),
        Scene.click(keepGoingButton),
        shareMountEnded(),
        Scene.expect(Scene.role('status')).toHaveText(
          `Get ready for endless wave 11. There is no timer this break. ${START_PROMPT} The shop stall in the bottom right corner is open. Walk up to it from any side to browse.`,
        ),
        Scene.expect(
          Scene.text(
            'You have $321. Holding the Chatterbox DELUXE. Other slot: Pop Pistol, upgrade tier 0 of 3, 14 rounds loaded.',
          ),
        ).toExist(),
      )
    },
  )

  it.effect(
    'Game Over and Victory ask the player to tell whoever sent the game what they think',
    () =>
      Effect.gen(function* () {
        const FEEDBACK = 'Tell whoever sent you this what you think!'
        yield* Effect.forEach(
          [Phase.GameOver({ wave: 4 }), Phase.Victory()],
          phase =>
            Scene.scene(
              APPLICATION,
              Scene.given(modifyFields(initialModel, { phase: () => phase })),
              measureSurface,
              Scene.expect(Scene.role('status')).toContainText(FEEDBACK),
            ),
          { discard: true },
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(initialModel),
          measureSurface,
          Scene.expect(Scene.role('status')).not.toContainText(FEEDBACK),
        )
      }),
  )

  it.effect(
    'an endless Game Over reads out the wave reached and your best',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
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
        Scene.expect(Scene.role('status')).toContainText(
          'Wave reached: 12. Your best: wave 14.',
        ),
      ),
  )
})

describe("A gun's level in the shop", () => {
  const atStall: Model = modifyFocus(
    modifyFields(initialModel, {
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
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => 270,
          y: () => 142,
          arsenal: () =>
            holdingSecond({ kind: 'Shotgun', loaded: 6, tier: 2, kills: 200 }),
        }),
      wallet: () => ({ balance: 400, earned: 400, shown: 400 }),
    },
  )

  it.effect(
    'shows the tier and the kills to the next, and sells no upgrade',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall),
        measureSurface,
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.frame,
          Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
        ),
        Scene.Command.resolve(
          Dialog.test.ShowDialog,
          DialogBlock.Message.SucceededShowDialog(),
        ),
        Scene.expect(Scene.role('tab', { name: /^Guns,/ })).toHaveAttr(
          'aria-selected',
          'true',
        ),
        Scene.expect(
          Scene.role('heading', { name: 'Barn Buster DELUXE' }),
        ).toExist(),
        Scene.expect(Scene.role('img', { name: 'Tier 2 of 3' })).toExist(),
        Scene.expect(
          Scene.text(
            '6 loaded, shells never run out. 200 kills, 50 more to Barn Buster 3000',
          ),
        ).toExist(),
        Scene.expect(Scene.role('button', { name: /upgrade/ })).toBeAbsent(),
        Scene.expect(
          Scene.text(
            'Two guns. A new one replaces the one in your hands, levels and all.',
          ),
        ).toExist(),
        Scene.expect(
          Scene.text(
            'Replaces your Barn Buster DELUXE, and its kills and level go with it',
          ),
        ).toBeAbsent(),
      ),
  )
})
