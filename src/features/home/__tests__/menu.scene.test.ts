import { Array, Cause, Effect, Exit, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { FocusHandCard, FocusHomeButton } from '../../../app/update/home'
import { ApplyRotation } from '../../../app/update/rotation'
import { WriteSave } from '../../../app/update/save'
import { withBests } from '../../../domain/run'
import { noSavedBests, restoreSave, saveOf } from '../../../platform/save'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeButton,
  closeDialogInScene,
  emitPressedKey,
  lobbyBackButton,
  lobbyScreen,
  lockedNightmare,
  manorButton,
  measureSurface,
  openHandInScene,
  openLobbyInScene,
  pickCardInScene,
  playButton,
  resolveFocusLobbyInScene,
  settingsButton,
  shareMountEnded,
  shareMountSettles,
  showDialogInScene,
} from '../../../test/testing'
import { pause } from '../../../world/waves/waves'
import { Message as ProfileMessage } from '../../profile/message'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '../../profile/profile'
import { FocusTutorialReset } from '../../profile/update'
import type { HandCard } from '../homeSchema'

const playCluster = Scene.role('group', { name: 'Play' })
const hand = Scene.role('dialog', { name: 'The manor' })
const CARD_NAMES = {
  Character: 'Character: change how you look',
  Munchopedia: 'Munchopedia: every zombie you have splatted',
  WhatsNew: "What's new: the latest changes",
  HowToPlay: 'How to play: the controls',
} as const
const characterCard = Scene.role('button', { name: CARD_NAMES.Character })
const munchopediaCard = Scene.role('button', { name: /^Munchopedia:/ })
const whatsNewCard = Scene.role('button', { name: /^What's new:/ })
const howToPlayCard = Scene.role('button', { name: CARD_NAMES.HowToPlay })
const munchopediaName = /^Munchopedia:/
const whatsNewName = /^What's new:/
const pauseMenuButton = Scene.role('button', { name: 'Menu: leave this run' })
const endMenuButton = Scene.role('button', {
  name: 'Menu: back to the home screen',
})
const leaveQuestion = Scene.role('dialog', { name: 'Leave this run?' })
const bests = Scene.role('button', { name: /^Your bests, Double Dare/ })

// NOTE: Scene refuses a pointerdown that no handler on the element or its
// ancestors would receive. That refusal is the check: a press on these
// buttons has no path to the game surface's pointerdown handler.
const NO_POINTERDOWN_PATH =
  /neither it nor any ancestor has a pointerdown handler/

// NOTE: a Block-aware Scene's refusal fails its Effect, so the check reads
// it from the failure's cause.
const expectNoPointerdownPath = <A, E>(exit: Exit.Exit<A, E>): void => {
  vitestExpect(
    Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'the press went in',
  ).toMatch(NO_POINTERDOWN_PATH)
}

const PREPARING = 'Get ready for wave 1.'
const PAUSED =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const pausedRound: Model = pause(
  modifyFields(home, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const afterGrace = (phase: Phase): Model =>
  modifyFields(home, {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('Home menu', () => {
  it.effect(
    'fills the slots: the gear, the MORE deck, and PLAY with CO-OP, no mode, difficulty, or hero pill, with a key badge on every button on a keyboard, and no bests badge before a best',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.inside(
          playCluster,
          Scene.expectAll(Scene.all.role('button')).toHaveCount(2),
          Scene.expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
          Scene.expect(
            Scene.role('button', { name: 'Co-op: play with friends' }),
          ).toHaveAttr('aria-keyshortcuts', 'J'),
        ),
        Scene.expect(Scene.selector('.home-pick')).toBeAbsent(),
        Scene.expect(Scene.role('button', { name: /^Mode:/ })).toBeAbsent(),
        Scene.expect(
          Scene.role('button', { name: /^Difficulty:/ }),
        ).toBeAbsent(),
        Scene.expect(Scene.role('button', { name: /^Hero:/ })).toBeAbsent(),
        Scene.expect(manorButton).toHaveAttr('aria-keyshortcuts', 'V'),
        Scene.expect(manorButton).toHaveAttr('aria-haspopup', 'dialog'),
        Scene.inside(
          Scene.selector('.home-corner'),
          Scene.expect(settingsButton).toHaveAttr('aria-keyshortcuts', 'O'),
          Scene.expect(settingsButton).toHaveAttr('aria-haspopup', 'dialog'),
          Scene.expect(
            Scene.role('link', { name: /^Buy Rattles a coffee/ }),
          ).toHaveAttr('aria-keyshortcuts', 'B'),
        ),
        Scene.expectAll(
          Scene.all.selector('.home-stage .home-key'),
        ).toHaveCount(5),
        Scene.expect(
          Scene.role('button', { name: 'Your character: change how you look' }),
        ).toHaveAttr('aria-haspopup', 'dialog'),
        Scene.expect(Scene.role('button', { name: 'Mute sound' })).toBeAbsent(),
        Scene.expect(bests).toBeAbsent(),
        Scene.expect(
          Scene.text('No bests yet. Go get chewed on.'),
        ).toBeAbsent(),
      ),
  )

  it.effect(
    'the MANOR hand deals a card for each page with its key, and CLOSE puts it away',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(home, { maybeSupportUrl: () => Option.none() }),
        ),
        measureSurface,
        Scene.expect(hand).toBeAbsent(),
        ...openHandInScene(),
        Scene.inside(
          hand,
          Scene.expectAll(Scene.all.selector('.hand-card')).toHaveCount(5),
          Scene.expect(characterCard).toHaveAttr('aria-keyshortcuts', 'C'),
          Scene.expect(munchopediaCard).toHaveAttr('aria-keyshortcuts', 'Z'),
          Scene.expect(whatsNewCard).toHaveAttr('aria-keyshortcuts', 'L'),
          Scene.expect(howToPlayCard).toHaveAttr('aria-keyshortcuts', 'I'),
          Scene.expect(Scene.role('link', { name: /^Tip jar/ })).toBeAbsent(),
          Scene.click(closeButton),
        ),
        ...closeDialogInScene(),
        Scene.expect(hand).toBeAbsent(),
        Scene.expect(manorButton).toExist(),
      ),
  )

  it.effect(
    'V deals the hand from the keyboard, and the arrow keys walk its cards, the Code card last, and wrap',
    () => {
      const focusCard = (card: HandCard) =>
        Scene.Command.resolve(
          FocusHandCard({ card }),
          Message.CompletedFocusHandCard(),
        )
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(home, { maybeSupportUrl: () => Option.none() }),
        ),
        measureSurface,
        emitPressedKey('KeyV'),
        ...showDialogInScene(),
        Scene.expect(hand).toExist(),
        Scene.keydown(characterCard, 'ArrowRight'),
        focusCard('Munchopedia'),
        Scene.keydown(howToPlayCard, 'ArrowDown'),
        focusCard('Code'),
        Scene.keydown(Scene.role('link', { name: /^Code:/ }), 'ArrowRight'),
        focusCard('Character'),
        Scene.keydown(characterCard, 'ArrowLeft'),
        focusCard('Code'),
      )
    },
  )

  it.effect(
    'the hand deals no tip jar card: the coffee stands in the corner',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        Scene.inside(
          hand,
          Scene.expectAll(Scene.all.selector('.hand-card')).toHaveCount(5),
          Scene.expect(Scene.role('link', { name: /coffee/i })).toBeAbsent(),
        ),
      ),
  )

  it.effect(
    'the Code card is the last card, a plain link to the source on GitHub that opens in a new tab',
    () => {
      const codeCard = Scene.role('link', { name: /^Code:/ })
      return Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.expect(codeCard).toBeAbsent(),
        ...openHandInScene(),
        Scene.inside(
          hand,
          Scene.expect(codeCard).toHaveAttr(
            'href',
            'https://github.com/Tanner-Scadden/munch-manor',
          ),
          Scene.expect(codeCard).toHaveAttr('target', '_blank'),
          Scene.expect(codeCard).toHaveAttr('rel', 'noopener noreferrer'),
          Scene.expect(codeCard).toHaveAttr('data-card', 'Code'),
          Scene.expect(codeCard).toHaveId('hand-card-code'),
          Scene.expect(
            Scene.within(codeCard, Scene.selector('.hand-card-title')),
          ).toHaveText('CODE'),
          Scene.expect(
            Scene.within(codeCard, Scene.selector('.home-key')),
          ).toBeAbsent(),
        ),
      )
    },
  )

  it.effect('each card opens its own page from the hand', () =>
    Effect.forEach(
      [
        { name: CARD_NAMES.Character, dialog: 'Profile' },
        { name: CARD_NAMES.Munchopedia, dialog: 'Munchopedia' },
        { name: `${CARD_NAMES.WhatsNew}. Something new`, dialog: "What's new" },
        { name: CARD_NAMES.HowToPlay, dialog: 'How to play' },
      ],
      ({ name, dialog }) =>
        Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          ...openHandInScene(),
          ...pickCardInScene(name),
          Scene.expect(hand).toBeAbsent(),
          Scene.expect(Scene.role('dialog', { name: dialog })).toExist(),
        ),
      { discard: true },
    ),
  )

  it.effect(
    'PLAY opens the lobby, a pick changes the difficulty without starting a run, and BACK goes home',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openLobbyInScene(),
        Scene.expect(lobbyScreen).toExist(),
        Scene.expect(playButton).toBeAbsent(),
        Scene.expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        Scene.click(Scene.role('button', { name: /^Triple Dare:/ })),
        resolveFocusLobbyInScene(),
        Scene.expect(
          Scene.role('button', { name: /^Triple Dare:/ }),
        ).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(Scene.selector('.coop[data-screen="Solo"]')).toExist(),
        Scene.click(lobbyBackButton),
        Scene.Command.resolve(
          FocusHomeButton({ button: 'Play' }),
          Message.CompletedFocusHomeButton(),
        ),
        Scene.expect(lobbyScreen).toBeAbsent(),
        Scene.expect(playButton).toExist(),
        Scene.expect(manorButton).toExist(),
      ),
  )

  it.effect(
    'Esc goes back from the lobby, and X and E pick on a keyboard while a tap does on touch',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          ...openLobbyInScene(),
          emitPressedKey('KeyX'),
          resolveFocusLobbyInScene(),
          Scene.expect(
            Scene.role('button', { name: /^Triple Dare:/ }),
          ).toHaveAttr('aria-pressed', 'true'),
          emitPressedKey('KeyE'),
          resolveFocusLobbyInScene(),
          Scene.expect(Scene.role('button', { name: 'Endless' })).toHaveAttr(
            'aria-pressed',
            'true',
          ),
          emitPressedKey('Escape'),
          Scene.Command.resolve(
            FocusHomeButton({ button: 'Play' }),
            Message.CompletedFocusHomeButton(),
          ),
          Scene.expect(lobbyScreen).toBeAbsent(),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(modifyFields(home, { lastDevice: () => 'Touch' })),
          measureSurface,
          ...openLobbyInScene(),
          Scene.expect(Scene.selector('.home-key')).toBeAbsent(),
          Scene.click(Scene.role('button', { name: /^Dare:/ })),
          resolveFocusLobbyInScene(),
          Scene.expect(Scene.role('button', { name: /^Dare:/ })).toHaveAttr(
            'aria-pressed',
            'true',
          ),
        )
      }),
  )

  it.effect(
    'touch shows the same buttons in the same slots without key badges',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(home, { lastDevice: () => 'Touch' })),
        measureSurface,
        Scene.inside(
          playCluster,
          Scene.expectAll(Scene.all.role('button')).toHaveCount(2),
        ),
        Scene.expect(manorButton).toExist(),
        Scene.expect(settingsButton).toExist(),
        Scene.expect(Scene.selector('.home-key')).toBeAbsent(),
      ),
  )

  it.effect('shows your best endless wave, fastest win, and kills', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(
          withBests(home, current => ({
            ...current,
            maybeBestEndlessWave: Option.some(12),
            maybeFastestWinMs: Option.some(402_000),
          })),
          {
            bests: current => modifyFields(current, { totalKills: () => 341 }),
          },
        ),
      ),
      measureSurface,
      Scene.inside(
        bests,
        Scene.expect(Scene.text('12')).toExist(),
        Scene.expect(Scene.text('6:42')).toExist(),
        Scene.expect(Scene.text('341')).toExist(),
      ),
      Scene.expect(
        Scene.role('button', {
          name: /Best endless wave 12, Fastest win 6:42, Zombies splatted 341\. Opens the Munchopedia/,
        }),
      ).toExist(),
    ),
  )

  it.effect('the bests badge is a button that opens the Munchopedia', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(home, {
          bests: current => modifyFields(current, { totalKills: () => 12 }),
        }),
      ),
      measureSurface,
      Scene.click(bests),
      ...showDialogInScene(),
      Scene.expect(Scene.role('dialog', { name: 'Munchopedia' })).toExist(),
    ),
  )

  it.effect('a loaded save shows the bests from earlier visits', () => {
    const saved = {
      ...saveOf(home),
      bests: {
        ...noSavedBests,
        runsPlayed: 4,
        totalKills: 97,
        killsByKind: { Shambler: 80, Tank: 17 },
        byDifficulty: {
          ...noSavedBests.byDifficulty,
          Normal: { fastestWinMs: null, bestEndlessWave: 9 },
        },
      },
    }
    return Scene.scene(
      APPLICATION,
      Scene.given(restoreSave(home, saved)),
      measureSurface,
      Scene.inside(
        bests,
        Scene.expect(Scene.text('9')).toExist(),
        Scene.expect(Scene.text('97')).toExist(),
      ),
    )
  })

  it.effect(
    'Enter opens the lobby, and Enter again plays the mode E chose there',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          emitPressedKey('Enter'),
          resolveFocusLobbyInScene(),
          Scene.expect(lobbyScreen).toExist(),
          Scene.expect(manorButton).toBeAbsent(),
          emitPressedKey('Enter'),
          Scene.expect(Scene.role('status')).toContainText(PREPARING),
          Scene.expect(lobbyScreen).toBeAbsent(),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          Scene.inside(
            playCluster,
            Scene.expect(Scene.selector('.home-play')).toHaveAttr(
              'id',
              'home-play',
            ),
          ),
          emitPressedKey('KeyE'),
          Scene.expect(lobbyScreen).toBeAbsent(),
          emitPressedKey('Enter'),
          resolveFocusLobbyInScene(),
          emitPressedKey('KeyE'),
          resolveFocusLobbyInScene(),
          Scene.expect(Scene.role('button', { name: 'Endless' })).toHaveAttr(
            'aria-pressed',
            'true',
          ),
          emitPressedKey('Enter'),
          Scene.expect(Scene.role('status')).toContainText(
            'Get ready for endless wave 1.',
          ),
        )
      }),
  )

  it.effect(
    'C opens the Profile straight from the menu, without the hand',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        emitPressedKey('KeyC'),
        ...showDialogInScene(),
        Scene.expect(Scene.role('dialog', { name: 'Profile' })).toExist(),
        Scene.expect(Scene.role('tab', { name: 'Look' })).toHaveAttr(
          'aria-selected',
          'true',
        ),
        Scene.expect(hand).toBeAbsent(),
      ),
  )

  it.effect('L, Z, I, and O open their pages straight from the menu', () =>
    Effect.forEach(
      [
        { key: 'KeyL', dialog: "What's new" },
        { key: 'KeyZ', dialog: 'Munchopedia' },
        { key: 'KeyI', dialog: 'How to play' },
        { key: 'KeyO', dialog: 'Profile' },
      ],
      ({ key, dialog }) =>
        Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          emitPressedKey(key),
          ...showDialogInScene(),
          Scene.expect(Scene.role('dialog', { name: dialog })).toExist(),
          Scene.expect(hand).toBeAbsent(),
        ),
      { discard: true },
    ),
  )

  it.effect('without a support link the arrow keys skip the coffee', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(modifyFields(home, { maybeSupportUrl: () => Option.none() })),
      measureSurface,
      emitPressedKey('ArrowRight'),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      emitPressedKey('ArrowUp'),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Settings' }),
        Message.CompletedFocusHomeButton(),
      ),
      emitPressedKey('ArrowUp'),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Manor' }),
        Message.CompletedFocusHomeButton(),
      ),
    ),
  )

  it.effect('arrow keys walk the buttons in order and wrap', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      emitPressedKey('ArrowRight'),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      ...Array.flatMap(
        ['Coop', 'Manor', 'Support', 'Settings', 'Play'] as const,
        button => [
          emitPressedKey('ArrowDown'),
          Scene.Command.resolve(
            FocusHomeButton({ button }),
            Message.CompletedFocusHomeButton(),
          ),
        ],
      ),
      emitPressedKey('ArrowUp'),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Settings' }),
        Message.CompletedFocusHomeButton(),
      ),
    ),
  )

  // NOTE: every menu dialog closes with the one shared button: the red X on
  // a small face inside a 48 px see-through button, on the Escape key.
  it.effect.each([
    { dialog: 'The manor', open: openHandInScene() },
    {
      dialog: 'Profile',
      open: [...openHandInScene(), ...pickCardInScene(CARD_NAMES.Character)],
    },
    {
      dialog: 'Munchopedia',
      open: [...openHandInScene(), ...pickCardInScene(munchopediaName)],
    },
    {
      dialog: "What's new",
      open: [...openHandInScene(), ...pickCardInScene(whatsNewName)],
    },
    {
      dialog: 'How to play',
      open: [...openHandInScene(), ...pickCardInScene(CARD_NAMES.HowToPlay)],
    },
    {
      dialog: 'Profile',
      open: [Scene.click(settingsButton), ...showDialogInScene()],
    },
    {
      dialog: 'Hero',
      open: [
        ...openLobbyInScene(),
        Scene.click(Scene.role('button', { name: /^Hero:/ })),
        ...showDialogInScene(),
      ],
    },
  ])('$dialog (#$#) closes with the shared close X', ({ dialog, open }) =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...open,
      Scene.inside(
        Scene.role('dialog', { name: dialog }),
        Scene.expect(closeButton).toHaveClass('menu-close'),
        Scene.expect(closeButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
        Scene.expect(
          Scene.within(closeButton, Scene.selector('.menu-close-face')),
        ).toExist(),
        Scene.expect(
          Scene.within(closeButton, Scene.selector('.menu-close-icon')),
        ).toExist(),
        Scene.expect(closeButton).toHaveText(''),
        Scene.click(closeButton),
      ),
      ...closeDialogInScene(),
      Scene.expect(Scene.role('dialog', { name: dialog })).toBeAbsent(),
    ),
  )

  it.effect(
    'How to play shows the controls as cards for the device, and its X closes it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        ...pickCardInScene(CARD_NAMES.HowToPlay),
        Scene.inside(
          Scene.role('dialog', { name: 'How to play' }),
          Scene.inside(
            Scene.role('list', { name: 'Controls' }),
            Scene.expectAll(Scene.all.role('listitem')).toHaveCount(10),
          ),
          Scene.expect(Scene.role('list', { name: 'More keys' })).toExist(),
          Scene.expect(Scene.role('region', { name: 'On the menu' })).toExist(),
          Scene.click(Scene.role('button', { name: 'Close' })),
        ),
        ...closeDialogInScene(),
        Scene.expect(
          Scene.role('dialog', { name: 'How to play' }),
        ).toBeAbsent(),
        Scene.expect(manorButton).toExist(),
      ),
  )

  it.effect(
    'the gear opens the Profile on Settings, and its tiles toggle sound, music, screen shake, and the big cursor',
    () => {
      const soundToggle = Scene.role('button', { name: 'Sound' })
      const musicToggle = Scene.role('button', { name: 'Music' })
      const shakeToggle = Scene.role('button', { name: 'Screen shake' })
      const cursorToggle = Scene.role('button', { name: 'Big cursor' })
      return Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.expect(Scene.role('dialog', { name: 'Profile' })).toExist(),
        Scene.expect(Scene.role('tab', { name: 'Settings' })).toHaveAttr(
          'aria-selected',
          'true',
        ),
        Scene.expect(soundToggle).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(soundToggle).toHaveAttr('aria-keyshortcuts', 'M'),
        Scene.expect(musicToggle).toHaveAttr('aria-keyshortcuts', 'N'),
        Scene.expect(shakeToggle).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(
          Scene.role('button', { name: 'Full screen' }),
        ).toBeAbsent(),
        Scene.click(soundToggle),
        Scene.expect(soundToggle).toHaveAttr('aria-pressed', 'false'),
        Scene.click(musicToggle),
        Scene.expect(musicToggle).toHaveAttr('aria-pressed', 'false'),
        Scene.click(shakeToggle),
        Scene.expect(shakeToggle).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(cursorToggle).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(Scene.selector('.game-root')).toHaveAttr(
          'data-cursor',
          'Bold',
        ),
        Scene.click(cursorToggle),
        Scene.expect(cursorToggle).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(Scene.selector('.game-root')).toHaveAttr(
          'data-cursor',
          'Thin',
        ),
      )
    },
  )

  it.effect(
    'Reset tutorial asks first, then says the tips will show again',
    () => {
      const resetButton = Scene.role('button', { name: 'Reset tutorial' })
      const keepButton = Scene.role('button', { name: 'Keep' })
      const confirmButton = Scene.role('button', { name: 'Reset' })
      const focusReset = (id: string) =>
        Scene.Command.resolve(
          FocusTutorialReset({ id }),
          ProfileMessage.CompletedFocusTutorialReset(),
        )
      return Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(home, { saveStatus: () => 'Read' })),
        measureSurface,
        Scene.click(settingsButton),
        ...showDialogInScene(),
        Scene.click(resetButton),
        focusReset(KEEP_TUTORIAL_BUTTON_ID),
        Scene.expect(Scene.text('Show the tips again?')).toExist(),
        Scene.click(keepButton),
        focusReset(RESET_TUTORIAL_BUTTON_ID),
        Scene.expect(keepButton).toBeAbsent(),
        Scene.click(resetButton),
        focusReset(KEEP_TUTORIAL_BUTTON_ID),
        Scene.click(confirmButton),
        focusReset(RESET_TUTORIAL_BUTTON_ID),
        Scene.Command.resolve(WriteSave, Message.CompletedWriteSave()),
        Scene.expect(Scene.text('Tips are back.')).toExist(),
      )
    },
  )

  it.effect('a press on a menu button never reaches the game surface', () =>
    Effect.forEach(
      [playButton, manorButton, settingsButton],
      button =>
        Effect.exit(
          Scene.scene(
            APPLICATION,
            Scene.given(modifyFields(home, { lastDevice: () => 'Touch' })),
            measureSurface,
            Scene.pointerDown(button, { pointerType: 'touch', pointerId: 4 }),
          ),
        ).pipe(Effect.map(expectNoPointerdownPath)),
      { discard: true },
    ),
  )
})

describe('Menu from a run', () => {
  it.effect(
    'the pause screen asks before leaving: Stay keeps the run paused',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(pausedRound),
        measureSurface,
        Scene.expect(pauseMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
        Scene.click(pauseMenuButton),
        ...showDialogInScene(),
        Scene.expect(leaveQuestion).toExist(),
        Scene.click(Scene.role('button', { name: 'Stay' })),
        ...closeDialogInScene(),
        Scene.expect(leaveQuestion).toBeAbsent(),
        Scene.expect(Scene.role('status')).toHaveText(PAUSED),
      ),
  )

  it.effect('Leave goes back to the home menu', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(pausedRound),
      measureSurface,
      emitPressedKey('KeyH'),
      ...showDialogInScene(),
      Scene.inside(
        leaveQuestion,
        Scene.click(Scene.role('button', { name: 'Leave' })),
      ),
      ...closeDialogInScene(),
      Scene.expect(manorButton).toExist(),
      Scene.expect(pauseMenuButton).toBeAbsent(),
    ),
  )

  it.effect(
    'a press on the pause MENU button never reaches the game surface, so it cannot resume the run',
    () =>
      Effect.exit(
        Scene.scene(
          APPLICATION,
          Scene.given(pausedRound),
          measureSurface,
          Scene.pointerDown(pauseMenuButton, {
            pointerType: 'touch',
            pointerId: 2,
          }),
        ),
      ).pipe(Effect.map(expectNoPointerdownPath)),
  )

  it.effect(
    'Game Over and the escape offer Menu after the grace, and it goes home',
    () =>
      Effect.forEach(
        [Phase.GameOver({ wave: 4 }), Phase.Escaped({ wave: 10 })],
        phase =>
          Effect.gen(function* () {
            yield* Scene.scene(
              APPLICATION,
              Scene.given(modifyFields(home, { phase: () => phase })),
              measureSurface,
              Scene.expect(endMenuButton).toBeAbsent(),
            )
            yield* Scene.scene(
              APPLICATION,
              Scene.given(afterGrace(phase)),
              measureSurface,
              shareMountSettles('Cancelled'),
              Scene.expect(endMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
              Scene.click(endMenuButton),
              shareMountEnded(),
              Scene.expect(manorButton).toExist(),
            )
            yield* Scene.scene(
              APPLICATION,
              Scene.given(afterGrace(phase)),
              measureSurface,
              shareMountSettles('Cancelled'),
              emitPressedKey('KeyH'),
              shareMountEnded(),
              Scene.expect(manorButton).toExist(),
            )
          }),
        { discard: true },
      ),
  )
})

describe('the rotation tile', () => {
  const rotateTile = Scene.role('button', { name: 'Turn with the phone' })

  it.effect(
    'Settings shows ROTATE only on a phone that can lock how it turns',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(home),
          measureSurface,
          Scene.click(settingsButton),
          ...showDialogInScene(),
          Scene.expect(Scene.role('dialog', { name: 'Profile' })).toExist(),
          Scene.expect(rotateTile).toBeAbsent(),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFields(home, {
              lastDevice: () => 'Touch',
              orientationLock: () => 'Supported',
            }),
          ),
          measureSurface,
          Scene.click(settingsButton),
          ...showDialogInScene(),
          Scene.expect(rotateTile).toHaveAttr('aria-pressed', 'false'),
          Scene.expect(rotateTile).toContainText('LOCKED'),
          Scene.click(rotateTile),
          Scene.Command.resolve(
            ApplyRotation({ rotation: 'Auto' }),
            Message.CompletedApplyRotation(),
          ),
          Scene.expect(rotateTile).toHaveAttr('aria-pressed', 'true'),
          Scene.expect(rotateTile).toContainText('AUTO'),
        )
      }),
  )
})
