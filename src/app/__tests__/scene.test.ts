import { Array, Effect, Option } from 'effect'

import { Head, UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator, Story } from '@effect/ui/testing'
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
  ackHudSlots,
  byClass,
  clickOn,
  emitFrame,
  expectAttr,
  measureHud,
  measureSurface,
  playButton,
  pressSurface,
  readDareCardByTapInScene,
  settleEndShareOf,
  startRunInScene,
  statusLine,
  throughIntroByTapInScene,
} from '../../test/sceneTesting'
import {
  BELOW_NORTH_DOOR,
  type SceneStep,
  checkModel,
  sceneOf,
  send,
  settleRunCommands,
  steps,
  storyOf,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { crateSpotOf } from '../../world/gear/crates'
import { START_LEVEL } from '../../world/level/arena'
import { focusOf, modifyFocus } from '../../world/party/party'
import { pause } from '../../world/waves/waves'
import { Message } from '../message'
import { BreakClock, DifficultyCard, type Model, Phase, Reload } from '../model'
import { PressGameSurface } from '../mount'
import { initialModel } from '../pureApp'

const role = HtmlLocator.role

const exists =
  (locator: Locator.Locator): SceneStep =>
  s =>
    s.expect(locator).toExist()

const absent =
  (locator: Locator.Locator): SceneStep =>
  s =>
    s.expect(locator).toBeAbsent()

const hasText =
  (locator: Locator.Locator, text: string): SceneStep =>
  s =>
    s.expect(locator).toHaveText(text)

// NOTE: a frame through the root's frame Subscription, its sounds played
// and the HUD's gun slots acknowledged.
const frame = (deltaTime: number): SceneStep =>
  steps(emitFrame(deltaTime), settleRunCommands, ackHudSlots)

// NOTE: the pause screen's press on the surface, acknowledged running.
const pausedSurface: SceneStep = steps(measureSurface, s =>
  s.expectMount(PressGameSurface()),
)

const PLAY_AGAIN =
  'Press Enter or choose Retry to play again, or E for an endless run. Press X or choose Share to post your run on X.'

const BACK_HOME = 'Press H or choose Menu to go back to the main menu.'

const FEEDBACK = 'Tell whoever sent you this what you think!'
const READY_STATUS = `${GAME_TITLE}, an early alpha. Main menu. Press Enter or choose Play. Press V or choose Manor for your character, the Munchopedia, what is new, and how to play. Press O or choose the gear for settings. Arrow keys move between the buttons.`

const PAUSED_STATUS =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const pausedRound: Model = pause(
  UiStruct.evolve(asVeteran(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const PREPARING_WAVE_ONE =
  'Get ready for wave 1. Press Enter, or use the Start wave button, to start it now. Keys on the ring: 0.'

describe('Ready screen', () => {
  it.effect(
    'waits for a button: a tap beside the buttons starts nothing, and Play starts the campaign',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(asVeteran(initialModel))
        s.pipe(
          measureSurface,
          exists(role('heading', { name: GAME_TITLE })),
          hasText(statusLine, READY_STATUS),
          pressSurface({
            pointerId: 7,
            device: 'Touch',
            clientX: 120,
            clientY: 300,
          }),
          settleRunCommands,
          hasText(statusLine, READY_STATUS),
          absent(Locator.attr('data-stick', 'move')),
          startRunInScene,
          settleRunCommands,
          ackHudSlots,
          hasText(statusLine, PREPARING_WAVE_ONE),
        )
      }),
  )
})

describe('Mute button', () => {
  it.effect(
    'toggles sound with a click or tap and reports its pressed state',
    () =>
      Effect.gen(function* () {
        const muteButton = role('button', { name: 'Mute sound' })
        const s = yield* sceneOf(pausedRound)
        s.pipe(
          pausedSurface,
          expectAttr(muteButton, 'aria-pressed', 'false'),
          clickOn(muteButton),
          settleRunCommands,
          expectAttr(muteButton, 'aria-pressed', 'true'),
          hasText(statusLine, PAUSED_STATUS),
          clickOn(muteButton),
          settleRunCommands,
          expectAttr(muteButton, 'aria-pressed', 'false'),
        )
      }),
  )
})

describe('Music button', () => {
  it.effect(
    'sits beside mute, toggles music with a click or tap, and reports its pressed state',
    () =>
      Effect.gen(function* () {
        const musicButton = role('button', { name: 'Music' })
        const muteButton = role('button', { name: 'Mute sound' })
        const s = yield* sceneOf(pausedRound)
        s.pipe(
          pausedSurface,
          expectAttr(musicButton, 'aria-pressed', 'true'),
          expectAttr(musicButton, 'aria-keyshortcuts', 'N'),
          clickOn(musicButton),
          settleRunCommands,
          expectAttr(musicButton, 'aria-pressed', 'false'),
          expectAttr(muteButton, 'aria-pressed', 'false'),
          hasText(statusLine, PAUSED_STATUS),
          clickOn(musicButton),
          settleRunCommands,
          expectAttr(musicButton, 'aria-pressed', 'true'),
        )
      }),
  )
})

describe('Start wave button', () => {
  it.effect(
    'appears during preparation, starts the wave on a click, then goes away',
    () =>
      Effect.gen(function* () {
        const startWaveButton = role('button', { name: 'Start wave 1 now' })
        const s = yield* sceneOf(asVeteran(initialModel))
        s.pipe(
          measureSurface,
          absent(startWaveButton),
          startRunInScene,
          settleRunCommands,
          ackHudSlots,
          hasText(statusLine, PREPARING_WAVE_ONE),
          hasText(role('timer'), '6 seconds until wave 1.'),
          expectAttr(startWaveButton, 'aria-keyshortcuts', 'Enter'),
          clickOn(startWaveButton),
          settleRunCommands,
          ackHudSlots,
          hasText(statusLine, 'Fighting wave 1.'),
          absent(startWaveButton),
          absent(role('timer')),
        )
      }),
  )
})

describe('A break', () => {
  const atStall: Model = modifyFocus(
    UiStruct.evolve(pastFirstBreak(initialModel), {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
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
        UiStruct.evolve(player, { x: () => 270, y: () => 142, hp: () => 3 }),
    },
  )

  it.effect(
    'finds a Plank Pile in the crate, and the PLACE button explains it needs a doorway',
    () =>
      Effect.gen(function* () {
        const placeButton = role('button', { name: 'Place a Plank Pile' })
        const crate = crateSpotOf(START_LEVEL, 'Dining')
        // NOTE: every heart, so the crate rolls a trap, not a heart.
        const s = yield* sceneOf(
          modifyFocus(atStall, {
            player: player =>
              UiStruct.evolve(player, {
                x: () => crate.x,
                y: () => crate.y,
                hp: () => PLAYER_MAX_HP,
              }),
          }),
        )
        s.pipe(
          measureHud,
          absent(placeButton),
          frame(FIXED_STEP_MS),
          expectAttr(placeButton, 'aria-disabled', 'true'),
          expectAttr(placeButton, 'aria-keyshortcuts', 'T'),
          exists(Locator.text('Stand in a doorway to board it up')),
        )
      }),
  )

  it.effect('with a second gun, a click on the other slot swaps to it', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        modifyFocus(atStall, {
          player: player =>
            UiStruct.evolve(player, {
              arsenal: () =>
                holdingSecond({ kind: 'Smg', loaded: 30, tier: 0, kills: 0 }),
            }),
        }),
      )
      s.pipe(
        measureHud,
        clickOn(role('button', { name: 'Switch to the Pop Pistol' })),
        settleRunCommands,
        ackHudSlots,
        exists(role('button', { name: 'Switch to the Chatterbox' })),
        exists(role('button', { name: 'Reload the Pop Pistol' })),
      )
    }),
  )
})

describe('Reload button', () => {
  const fighting: Model = modifyFocus(
    UiStruct.evolve(initialModel, {
      phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    }),
    {
      player: player =>
        withPistol(player, pistol => ({ ...pistol, loaded: 2 })),
    },
  )
  const reloadButton = role('button', { name: 'Reload the Pop Pistol' })
  // NOTE: on touch the reload button past the knife shares the held gun's
  // name, so the held gun's slot is looked for among the slots.
  const touchReloadButton = Locator.inside(byClass('gun-slots'), reloadButton)

  it.effect('shows on touch and starts a reload when tapped', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(fighting, { lastDevice: () => 'Touch' }),
      )
      s.pipe(
        measureHud,
        expectAttr(touchReloadButton, 'aria-keyshortcuts', 'R 1'),
        clickOn(touchReloadButton),
        settleRunCommands,
        ackHudSlots,
        exists(touchReloadButton),
      )
      const story = yield* storyOf(fighting)
      story.pipe(
        send(Message.ClickedReloadButton()),
        settleRunCommands,
        checkModel(reloaded => {
          vitestExpect(
            Reload.isAnyOf(['Reloading'])(focusOf(reloaded).player.reload),
          ).toBe(true)
        }),
      )
    }),
  )

  it.effect('stays hidden on a keyboard, where the held gun shows R', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(fighting)
      s.pipe(
        measureHud,
        absent(byClass('reload-icon-button')),
        hasText(Locator.inside(reloadButton, byClass('key-badge')), 'R'),
      )
    }),
  )
})

describe('Place button', () => {
  const atNorthDoor: Model = modifyFocus(
    UiStruct.evolve(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
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
        UiStruct.evolve(player, {
          x: () => BELOW_NORTH_DOOR.x,
          y: () => BELOW_NORTH_DOOR.y,
        }),
      trapStock: () => ({ Barricade: 1, Turret: 1 }),
    },
  )

  it.effect(
    'places the selected trap on a tap, and NEXT switches the kind',
    () =>
      Effect.gen(function* () {
        const plankButton = role('button', { name: 'Place a Plank Pile' })
        const gnomeButton = role('button', { name: 'Place a Grumpy Gnome' })
        const tapAndSettle = (locator: Locator.Locator): SceneStep =>
          steps(clickOn(locator), settleRunCommands, ackHudSlots)
        const s = yield* sceneOf(atNorthDoor)
        s.pipe(
          measureHud,
          scene =>
            scene.check(() => {
              vitestExpect(
                scene.get(plankButton).attrs?.['aria-disabled'],
              ).not.toBe('true')
            }),
          hasText(
            Locator.inside(plankButton, byClass('icon-button-badge')),
            'x1',
          ),
          hasText(Locator.inside(plankButton, byClass('key-badge')), 'T'),
          tapAndSettle(role('button', { name: 'Switch to the Grumpy Gnome' })),
          exists(gnomeButton),
          absent(plankButton),
          tapAndSettle(role('button', { name: 'Switch to the Plank Pile' })),
          tapAndSettle(plankButton),
          absent(plankButton),
          exists(gnomeButton),
          absent(role('button', { name: 'Switch to the Plank Pile' })),
          tapAndSettle(gnomeButton),
          absent(gnomeButton),
          absent(Locator.text('Traps go down between waves')),
        )
      }),
  )

  it.effect('is not offered without traps or outside Preparation', () =>
    Effect.gen(function* () {
      const noTraps = yield* sceneOf(
        modifyFocus(atNorthDoor, {
          trapStock: () => ({ Barricade: 0, Turret: 0 }),
        }),
      )
      noTraps.pipe(
        measureHud,
        absent(role('button', { name: 'Place a Plank Pile' })),
      )
      const inWave = yield* sceneOf(
        UiStruct.evolve(atNorthDoor, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      )
      inWave.pipe(
        measureHud,
        absent(role('button', { name: 'Place a Plank Pile' })),
      )
    }),
  )
})

describe('Run stats', () => {
  const finished = (phase: Phase): Model =>
    withKeys(
      UiStruct.evolve(initialModel, {
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
          readyPoints: 0,
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

  // NOTE: an end screen read out, its SHARE Mount acknowledged.
  const readsOut = (model: Model, text: string) =>
    Effect.gen(function* () {
      const s = yield* sceneOf(model)
      s.pipe(measureSurface, settleEndShareOf(model), hasText(statusLine, text))
    })

  it.effect('Game Over reads out the verdict and the whole run', () =>
    readsOut(
      finished(Phase.GameOver({ wave: 4 })),
      `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
    ),
  )

  it.effect('an escape reads out the verdict and the whole run', () =>
    readsOut(
      finished(Phase.Escaped({ wave: 10 })),
      `You escaped the manor on wave 10. Out the front door, hat and all. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
    ),
  )
  const afterRuns = (runs: number, phase: Phase): Model =>
    UiStruct.evolve(finished(phase), {
      bests: bests => UiStruct.evolve(bests, { runsPlayed: () => runs }),
    })

  it.effect('the end screens still ask for feedback on the third run', () =>
    readsOut(
      afterRuns(FEEDBACK_RUNS, Phase.GameOver({ wave: 4 })),
      `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME} ${FEEDBACK}`,
    ),
  )

  it.effect(
    'the end screens stop asking for feedback after the first few runs',
    () =>
      Effect.gen(function* () {
        yield* readsOut(
          afterRuns(FEEDBACK_RUNS + 1, Phase.GameOver({ wave: 4 })),
          `Game over. Eaten on wave 4. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME}`,
        )
        yield* readsOut(
          afterRuns(FEEDBACK_RUNS + 1, Phase.Escaped({ wave: 10 })),
          `You escaped the manor on wave 10. Out the front door, hat and all. Difficulty: Double Dare. ${STATS} ${PLAY_AGAIN} ${BACK_HOME}`,
        )
      }),
  )
})

describe('Title', () => {
  // NOTE: the root's head names the document: `Story.head` reads what its
  // `head` option returns for the Scene's record.
  it.effect(
    'the working title names the document, the page, and index.html',
    () =>
      Effect.gen(function* () {
        vitestExpect(indexHtml).toContain(`<title>${GAME_TITLE}</title>`)
        const s = yield* sceneOf(initialModel)
        s.pipe(measureSurface, exists(role('heading', { name: GAME_TITLE })))
        vitestExpect(Story.head(s.current)).toEqual([Head.title(GAME_TITLE)])
      }),
  )
})

const CARD_TICKS = Math.ceil(DEBUT_CARD_MIN_MS / 50)

describe('New zombie card', () => {
  it.effect(
    'stays out of Preparation, then reads out the new kind when the wave starts',
    () =>
      Effect.gen(function* () {
        const tapToContinue = role('button', { name: 'TAP TO CONTINUE' })
        const card = role('group', { name: 'New zombie: Groaner' })
        const s = yield* sceneOf(
          UiStruct.evolve(initialModel, {
            lastDevice: () => 'Touch',
            difficultyCard: () => DifficultyCard.Seen(),
          }),
        )
        steps(
          measureSurface,
          clickOn(playButton),
          settleRunCommands,
          throughIntroByTapInScene,
          settleRunCommands,
          ackHudSlots,
          absent(role('button', { name: 'Start wave 1 now' })),
          absent(card),
          exists(Locator.attr('data-ghost', 'Move')),
          exists(Locator.attr('data-ghost', 'Aim')),
          readDareCardByTapInScene,
          settleRunCommands,
          ackHudSlots,
          clickOn(role('button', { name: 'Start wave 1 now' })),
          settleRunCommands,
          ackHudSlots,
          exists(card),
          exists(Locator.text("He's slow. Back up and keep shooting.")),
          absent(tapToContinue),
          hasText(
            statusLine,
            "New zombie: Groaner. He's slow. Back up and keep shooting. The wave starts in a moment. Once Continue shows, press Enter or choose it to start now.",
          ),
          steps(...Array.makeBy(CARD_TICKS - 1, () => frame(50))),
          absent(tapToContinue),
          frame(50),
          expectAttr(tapToContinue, 'aria-keyshortcuts', 'Enter'),
          clickOn(tapToContinue),
          settleRunCommands,
          ackHudSlots,
          absent(card),
          hasText(statusLine, 'Fighting wave 1.'),
        )(s)
      }),
  )

  it.effect(
    'shows CONTINUE with an ENTER key on a keyboard once it can be skipped',
    () =>
      Effect.gen(function* () {
        const continueButton = role('button', { name: 'CONTINUE' })
        const s = yield* sceneOf(
          UiStruct.evolve(asVeteran(initialModel), {
            introducedKinds: () => [],
          }),
        )
        s.pipe(
          measureSurface,
          startRunInScene,
          settleRunCommands,
          ackHudSlots,
          clickOn(role('button', { name: 'Start wave 1 now' })),
          settleRunCommands,
          ackHudSlots,
          absent(continueButton),
          steps(...Array.makeBy(CARD_TICKS, () => frame(50))),
          exists(continueButton),
          exists(Locator.text('ENTER')),
        )
      }),
  )
})
