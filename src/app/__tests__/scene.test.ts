import { Array, Effect, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'

import indexHtml from '../../../index.html?raw'
import { FEEDBACK_RUNS } from '../../domain/run'
import { DEBUT_CARD_MIN_MS } from '../../features/onboarding/onboarding'
import {
  FIXED_STEP_MS,
  GAME_TITLE,
  PLAYER_MAX_HP,
  PREPARATION_MS,
} from '../../shared/constants'
import { holdingSecond, withPistol } from '../../test/arsenals'
import { pastFirstBreak, withKeys } from '../../test/model.fixture'
import {
  APPLICATION,
  BELOW_NORTH_DOOR,
  SCENE_SUBSCRIPTIONS,
  measureSurface,
  playButton,
  readDareCardByTapInScene,
  startRunInScene,
  throughIntroByTapInScene,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { crateSpotOf } from '../../world/gear/crates'
import { START_LEVEL } from '../../world/level/arena'
import { focusOf, modifyFocus } from '../../world/party/party'
import { pause } from '../../world/waves/waves'
import { Message } from '../message'
import { DifficultyCard, type Model, Phase, Reload } from '../model'
import { initialModel } from '../pureApp'

const PLAY_AGAIN =
  'Press Enter or choose Retry to play again, or E for an endless run. Press X or choose Share to post your run on X.'

const BACK_HOME = 'Press H or choose Menu to go back to the main menu.'

const FEEDBACK = 'Tell whoever sent you this what you think!'
const READY_STATUS = `${GAME_TITLE}, an early alpha. Main menu. Press Enter or choose Play. Press V or choose Manor for your character, the Munchopedia, what is new, and how to play. Press O or choose the gear for settings. Arrow keys move between the buttons.`

const PAUSED_STATUS =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const pausedRound: Model = pause(
  modifyFields(asVeteran(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const PREPARING_WAVE_ONE =
  'Get ready for wave 1. Press Enter, or use the Start wave button, to start it now. Keys on the ring: 0.'

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
      const startWaveButton = Scene.role('button', {
        name: 'Start wave 1 now',
      })
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
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 1.'),
        Scene.expect(startWaveButton).toBeAbsent(),
        Scene.expect(Scene.role('timer')).toBeAbsent(),
      )
    },
  )
})

describe('A break', () => {
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
    },
  )

  it.effect(
    'finds a Plank Pile in the crate, and the PLACE button explains it needs a doorway',
    () => {
      const placeButton = Scene.role('button', { name: 'Place a Plank Pile' })
      const crate = crateSpotOf(START_LEVEL, 'Dining')
      return Scene.scene(
        APPLICATION,
        Scene.given(
          // NOTE: every heart, so the crate rolls a trap, not a heart.
          modifyFocus(atStall, {
            player: player =>
              modifyFields(player, {
                x: () => crate.x,
                y: () => crate.y,
                hp: () => PLAYER_MAX_HP,
              }),
          }),
        ),
        measureSurface,
        Scene.expect(placeButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.frame,
          Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
        ),
        Scene.expect(placeButton).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(placeButton).toHaveAttr('aria-keyshortcuts', 'T'),
        Scene.expect(Scene.text('Stand in a doorway to board it up')).toExist(),
      )
    },
  )

  it.effect('with a second gun, a click on the other slot swaps to it', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(atStall, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond({ kind: 'Smg', loaded: 30, tier: 0, kills: 0 }),
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
      player: player =>
        modifyFields(player, {
          x: () => BELOW_NORTH_DOOR.x,
          y: () => BELOW_NORTH_DOOR.y,
        }),
      trapStock: () => ({ Barricade: 1, Turret: 1 }),
    },
  )

  it.effect(
    'places the selected trap on a tap, and NEXT switches the kind',
    () => {
      const plankButton = Scene.role('button', { name: 'Place a Plank Pile' })
      const gnomeButton = Scene.role('button', {
        name: 'Place a Grumpy Gnome',
      })
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
    withKeys(
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
          powerUpsGrabbed: 2,
          maybeLastHurtBy: Option.some('Runner'),
          activeFrames: 22_260,
          activeFrameMs: 371_000,
          runMs: 371_000,
        }),
      }),
      14,
    )
  const STATS =
    'Waves cleared: 3. Zombies splatted: 69 (41 Groaner, 17 Hotfoot, 9 Kaboomer, 2 Big Lug, 0 Big Leaguer, 0 Ankle Biter). Best streak 0. Run time 6:11. Accuracy 43 percent. Keys found 14.'

  it.effect('Game Over reads out the verdict and the whole run', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(finished(Phase.GameOver({ wave: 4 }))),
      measureSurface,
      Scene.expect(Scene.role('status')).toHaveText(
        `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
      ),
    ),
  )

  it.effect('an escape reads out the verdict and the whole run', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(finished(Phase.Escaped({ wave: 10 }))),
      measureSurface,
      Scene.expect(Scene.role('status')).toHaveText(
        `You escaped the manor on wave 10. Out the front door, hat and all. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
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
        `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
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
            `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME}`,
          ),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            afterRuns(FEEDBACK_RUNS + 1, Phase.Escaped({ wave: 10 })),
          ),
          measureSurface,
          Scene.expect(Scene.role('status')).toHaveText(
            `You escaped the manor on wave 10. Out the front door, hat and all. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME}`,
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
        ...throughIntroByTapInScene(),
        Scene.expect(
          Scene.role('button', { name: 'Start wave 1 now' }),
        ).toBeAbsent(),
        Scene.expect(card).toBeAbsent(),
        Scene.expect(Scene.selector('[data-ghost="Move"]')).toExist(),
        Scene.expect(Scene.selector('[data-ghost="Aim"]')).toExist(),
        ...readDareCardByTapInScene(),
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
        Scene.expect(Scene.role('status')).toHaveText('Fighting wave 1.'),
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
