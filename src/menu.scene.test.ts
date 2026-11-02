import { Array, Option } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  keydown,
  pointerDown,
  role,
  scene,
  selector,
  text,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
  withBests,
} from './home'
import { Message } from './message'
import { type HandCard, type Model, Phase } from './model'
import { home } from './model.fixture'
import { noSavedBests, restoreSave, saveOf } from './save'
import {
  ROOT,
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
} from './testing'
import { FocusHandCard, FocusHomeButton } from './update/home'
import { ApplyRotation } from './update/rotation'
import { FocusTutorialReset, WriteSave } from './update/save'
import { pause } from './waves'

const playCluster = role('group', { name: 'Play' })
const hand = role('dialog', { name: 'The manor' })
const CARD_NAMES = {
  Character: 'Character: change how you look',
  Munchopedia: 'Munchopedia: every zombie you have splatted',
  WhatsNew: "What's new: the latest changes",
  HowToPlay: 'How to play: the controls',
} as const
const characterCard = role('button', { name: CARD_NAMES.Character })
const munchopediaCard = role('button', { name: /^Munchopedia:/ })
const whatsNewCard = role('button', { name: /^What's new:/ })
const howToPlayCard = role('button', { name: CARD_NAMES.HowToPlay })
const munchopediaName = /^Munchopedia:/
const whatsNewName = /^What's new:/
const pauseMenuButton = role('button', { name: 'Menu: leave this run' })
const endMenuButton = role('button', { name: 'Menu: back to the home screen' })
const leaveQuestion = role('dialog', { name: 'Leave this run?' })
const bests = role('region', { name: 'Your bests, Normal' })

// NOTE: Scene refuses a pointerdown that no handler on the element or its
// ancestors would receive. That refusal is the check: a press on these
// buttons has no path to the game surface's pointerdown handler.
const NO_POINTERDOWN_PATH =
  /neither it nor any ancestor has a pointerdown handler/

const PREPARING = 'Get ready for wave 1 of 10.'
const PAUSED =
  'Paused during wave 3 of 10. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

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
  test('fills the slots: the gear, the MORE deck, and PLAY with CO-OP, no mode, difficulty, or hero pill, with a key badge on every button on a keyboard, and no bests badge before a best', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      inside(
        playCluster,
        expectAll(all.role('button')).toHaveCount(2),
        expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        expect(
          role('button', { name: 'Co-op: finish the tutorial to unlock' }),
        ).toHaveAttr('aria-keyshortcuts', 'J'),
      ),
      expect(selector('.home-pick')).toBeAbsent(),
      expect(role('button', { name: /^Mode:/ })).toBeAbsent(),
      expect(role('button', { name: /^Difficulty:/ })).toBeAbsent(),
      expect(role('button', { name: /^Hero:/ })).toBeAbsent(),
      expect(manorButton).toHaveAttr('aria-keyshortcuts', 'V'),
      expect(manorButton).toHaveAttr('aria-haspopup', 'dialog'),
      inside(
        selector('.home-corner'),
        expect(settingsButton).toHaveAttr('aria-keyshortcuts', 'O'),
        expect(settingsButton).toHaveAttr('aria-haspopup', 'dialog'),
        expect(role('link', { name: /^Buy Rattles a coffee/ })).toHaveAttr(
          'aria-keyshortcuts',
          'B',
        ),
      ),
      expectAll(all.selector('.home-stage .home-key')).toHaveCount(5),
      expect(
        role('button', { name: 'Your character: change how you look' }),
      ).toHaveAttr('aria-haspopup', 'dialog'),
      expect(role('button', { name: 'Mute sound' })).toBeAbsent(),
      expect(bests).toBeAbsent(),
      expect(text('No bests yet. Go get chewed on.')).toBeAbsent(),
    )
  })

  test('the MANOR hand deals a card for each page with its key, and CLOSE puts it away', () => {
    scene(
      ROOT,
      given(modifyFields(home, { maybeSupportUrl: () => Option.none() })),
      measureSurface,
      expect(hand).toBeAbsent(),
      ...openHandInScene(),
      inside(
        hand,
        expectAll(all.selector('.hand-card')).toHaveCount(5),
        expect(characterCard).toHaveAttr('aria-keyshortcuts', 'C'),
        expect(munchopediaCard).toHaveAttr('aria-keyshortcuts', 'Z'),
        expect(whatsNewCard).toHaveAttr('aria-keyshortcuts', 'L'),
        expect(howToPlayCard).toHaveAttr('aria-keyshortcuts', 'I'),
        expect(role('link', { name: /^Tip jar/ })).toBeAbsent(),
        click(closeButton),
      ),
      ...closeDialogInScene(),
      expect(hand).toBeAbsent(),
      expect(manorButton).toExist(),
    )
  })

  test('V deals the hand from the keyboard, and the arrow keys walk its cards, the Code card last, and wrap', () => {
    const focusCard = (card: HandCard) =>
      Command.resolve(FocusHandCard({ card }), Message.CompletedFocusHandCard())
    scene(
      ROOT,
      given(modifyFields(home, { maybeSupportUrl: () => Option.none() })),
      measureSurface,
      emitPressedKey('KeyV'),
      ...showDialogInScene(),
      expect(hand).toExist(),
      keydown(characterCard, 'ArrowRight'),
      focusCard('Munchopedia'),
      keydown(howToPlayCard, 'ArrowDown'),
      focusCard('Code'),
      keydown(role('link', { name: /^Code:/ }), 'ArrowRight'),
      focusCard('Character'),
      keydown(characterCard, 'ArrowLeft'),
      focusCard('Code'),
    )
  })

  test('the hand deals no tip jar card: the coffee stands in the corner', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      inside(
        hand,
        expectAll(all.selector('.hand-card')).toHaveCount(5),
        expect(role('link', { name: /coffee/i })).toBeAbsent(),
      ),
    )
  })

  test('the Code card is the last card, a plain link to the source on GitHub that opens in a new tab', () => {
    const codeCard = role('link', { name: /^Code:/ })
    scene(
      ROOT,
      given(home),
      measureSurface,
      expect(codeCard).toBeAbsent(),
      ...openHandInScene(),
      inside(
        hand,
        expect(codeCard).toHaveAttr(
          'href',
          'https://github.com/Tanner-Scadden/munch-manor',
        ),
        expect(codeCard).toHaveAttr('target', '_blank'),
        expect(codeCard).toHaveAttr('rel', 'noopener noreferrer'),
        expect(codeCard).toHaveAttr('data-card', 'Code'),
        expect(codeCard).toHaveId('hand-card-code'),
        expect(within(codeCard, selector('.hand-card-title'))).toHaveText(
          'CODE',
        ),
        expect(within(codeCard, selector('.home-key'))).toBeAbsent(),
      ),
    )
  })

  test('each card opens its own page from the hand', () => {
    Array.forEach(
      [
        { name: CARD_NAMES.Character, dialog: 'Profile' },
        { name: CARD_NAMES.Munchopedia, dialog: 'Munchopedia' },
        { name: `${CARD_NAMES.WhatsNew}. Something new`, dialog: "What's new" },
        { name: CARD_NAMES.HowToPlay, dialog: 'How to play' },
      ],
      ({ name, dialog }) => {
        scene(
          ROOT,
          given(home),
          measureSurface,
          ...openHandInScene(),
          ...pickCardInScene(name),
          expect(hand).toBeAbsent(),
          expect(role('dialog', { name: dialog })).toExist(),
        )
      },
    )
  })

  test('PLAY opens the lobby, a pick changes the difficulty without starting a run, and BACK goes home', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      expect(lobbyScreen).toExist(),
      expect(playButton).toBeAbsent(),
      expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
      click(role('button', { name: /^Hard:/ })),
      resolveFocusLobbyInScene(),
      expect(role('button', { name: /^Hard:/ })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      expect(selector('.coop[data-screen="Solo"]')).toExist(),
      click(lobbyBackButton),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      expect(lobbyScreen).toBeAbsent(),
      expect(playButton).toExist(),
      expect(manorButton).toExist(),
    )
  })

  test('Esc goes back from the lobby, and X and E pick on a keyboard while a tap does on touch', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      emitPressedKey('KeyX'),
      resolveFocusLobbyInScene(),
      expect(role('button', { name: /^Hard:/ })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      emitPressedKey('KeyE'),
      resolveFocusLobbyInScene(),
      expect(role('button', { name: 'Endless' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      emitPressedKey('Escape'),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      expect(lobbyScreen).toBeAbsent(),
    )
    scene(
      ROOT,
      given(modifyFields(home, { lastDevice: () => 'Touch' })),
      measureSurface,
      ...openLobbyInScene(),
      expect(selector('.home-key')).toBeAbsent(),
      click(role('button', { name: /^Easy:/ })),
      resolveFocusLobbyInScene(),
      expect(role('button', { name: /^Easy:/ })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
    )
  })

  test('touch shows the same buttons in the same slots without key badges', () => {
    scene(
      ROOT,
      given(modifyFields(home, { lastDevice: () => 'Touch' })),
      measureSurface,
      inside(playCluster, expectAll(all.role('button')).toHaveCount(2)),
      expect(manorButton).toExist(),
      expect(settingsButton).toExist(),
      expect(selector('.home-key')).toBeAbsent(),
    )
  })

  test('shows your best endless wave, fastest win, and kills', () => {
    scene(
      ROOT,
      given(
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
      inside(
        bests,
        expect(text('Best endless wave')).toExist(),
        expect(text('12')).toExist(),
        expect(text('Fastest win')).toExist(),
        expect(text('6:42')).toExist(),
        expect(text('Zombies splatted')).toExist(),
        expect(text('341')).toExist(),
      ),
    )
  })

  test('a loaded save shows the bests from earlier visits', () => {
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
    scene(
      ROOT,
      given(restoreSave(home, saved)),
      measureSurface,
      inside(bests, expect(text('9')).toExist(), expect(text('97')).toExist()),
    )
  })

  test('Enter opens the lobby, and Enter again plays the mode E chose there', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      emitPressedKey('Enter'),
      resolveFocusLobbyInScene(),
      expect(lobbyScreen).toExist(),
      expect(manorButton).toBeAbsent(),
      emitPressedKey('Enter'),
      expect(role('status')).toContainText(PREPARING),
      expect(lobbyScreen).toBeAbsent(),
    )
    scene(
      ROOT,
      given(home),
      measureSurface,
      inside(
        playCluster,
        expect(selector('.home-play')).toHaveAttr('id', 'home-play'),
      ),
      emitPressedKey('KeyE'),
      expect(lobbyScreen).toBeAbsent(),
      emitPressedKey('Enter'),
      resolveFocusLobbyInScene(),
      emitPressedKey('KeyE'),
      resolveFocusLobbyInScene(),
      expect(role('button', { name: 'Endless' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      emitPressedKey('Enter'),
      expect(role('status')).toContainText('Get ready for endless wave 1.'),
    )
  })

  test('C opens the Profile straight from the menu, without the hand', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      emitPressedKey('KeyC'),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Profile' })).toExist(),
      expect(role('tab', { name: 'Look' })).toHaveAttr('aria-selected', 'true'),
      expect(hand).toBeAbsent(),
    )
  })

  test('L, Z, I, and O open their pages straight from the menu', () => {
    Array.forEach(
      [
        { key: 'KeyL', dialog: "What's new" },
        { key: 'KeyZ', dialog: 'Munchopedia' },
        { key: 'KeyI', dialog: 'How to play' },
        { key: 'KeyO', dialog: 'Profile' },
      ],
      ({ key, dialog }) => {
        scene(
          ROOT,
          given(home),
          measureSurface,
          emitPressedKey(key),
          ...showDialogInScene(),
          expect(role('dialog', { name: dialog })).toExist(),
          expect(hand).toBeAbsent(),
        )
      },
    )
  })

  test('without a support link the arrow keys skip the coffee', () => {
    scene(
      ROOT,
      given(modifyFields(home, { maybeSupportUrl: () => Option.none() })),
      measureSurface,
      emitPressedKey('ArrowRight'),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      emitPressedKey('ArrowUp'),
      Command.resolve(
        FocusHomeButton({ button: 'Settings' }),
        Message.CompletedFocusHomeButton(),
      ),
      emitPressedKey('ArrowUp'),
      Command.resolve(
        FocusHomeButton({ button: 'Manor' }),
        Message.CompletedFocusHomeButton(),
      ),
    )
  })

  test('arrow keys walk the buttons in order and wrap', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      emitPressedKey('ArrowRight'),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      ...Array.flatMap(
        ['Coop', 'Manor', 'Support', 'Settings', 'Play'] as const,
        button => [
          emitPressedKey('ArrowDown'),
          Command.resolve(
            FocusHomeButton({ button }),
            Message.CompletedFocusHomeButton(),
          ),
        ],
      ),
      emitPressedKey('ArrowUp'),
      Command.resolve(
        FocusHomeButton({ button: 'Settings' }),
        Message.CompletedFocusHomeButton(),
      ),
    )
  })

  // NOTE: every menu dialog closes with the one shared button: the red X on
  // a small face inside a 48 px see-through button, on the Escape key.
  test.each([
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
      open: [click(settingsButton), ...showDialogInScene()],
    },
    {
      dialog: 'Hero',
      open: [
        ...openLobbyInScene(),
        click(role('button', { name: /^Hero:/ })),
        ...showDialogInScene(),
      ],
    },
  ])('$dialog (#$#) closes with the shared close X', ({ dialog, open }) => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...open,
      inside(
        role('dialog', { name: dialog }),
        expect(closeButton).toHaveClass('menu-close'),
        expect(closeButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
        expect(within(closeButton, selector('.menu-close-face'))).toExist(),
        expect(within(closeButton, selector('.menu-close-icon'))).toExist(),
        expect(closeButton).toHaveText(''),
        click(closeButton),
      ),
      ...closeDialogInScene(),
      expect(role('dialog', { name: dialog })).toBeAbsent(),
    )
  })

  test('How to play shows the controls as cards for the device, and its X closes it', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(CARD_NAMES.HowToPlay),
      inside(
        role('dialog', { name: 'How to play' }),
        inside(
          role('list', { name: 'Controls' }),
          expectAll(all.role('listitem')).toHaveCount(10),
        ),
        expect(role('list', { name: 'More keys' })).toExist(),
        expect(role('region', { name: 'On the menu' })).toExist(),
        click(role('button', { name: 'Close' })),
      ),
      ...closeDialogInScene(),
      expect(role('dialog', { name: 'How to play' })).toBeAbsent(),
      expect(manorButton).toExist(),
    )
  })

  test('the gear opens the Profile on Settings, and its tiles toggle sound, music, screen shake, and the big cursor', () => {
    const soundToggle = role('button', { name: 'Sound' })
    const musicToggle = role('button', { name: 'Music' })
    const shakeToggle = role('button', { name: 'Screen shake' })
    const cursorToggle = role('button', { name: 'Big cursor' })
    scene(
      ROOT,
      given(home),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Profile' })).toExist(),
      expect(role('tab', { name: 'Settings' })).toHaveAttr(
        'aria-selected',
        'true',
      ),
      expect(soundToggle).toHaveAttr('aria-pressed', 'true'),
      expect(soundToggle).toHaveAttr('aria-keyshortcuts', 'M'),
      expect(musicToggle).toHaveAttr('aria-keyshortcuts', 'N'),
      expect(shakeToggle).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Full screen' })).toBeAbsent(),
      click(soundToggle),
      expect(soundToggle).toHaveAttr('aria-pressed', 'false'),
      click(musicToggle),
      expect(musicToggle).toHaveAttr('aria-pressed', 'false'),
      click(shakeToggle),
      expect(shakeToggle).toHaveAttr('aria-pressed', 'false'),
      expect(cursorToggle).toHaveAttr('aria-pressed', 'true'),
      expect(selector('.game-root')).toHaveAttr('data-cursor', 'Bold'),
      click(cursorToggle),
      expect(cursorToggle).toHaveAttr('aria-pressed', 'false'),
      expect(selector('.game-root')).toHaveAttr('data-cursor', 'Thin'),
    )
  })

  test('Reset tutorial asks first, then says the tips will show again', () => {
    const resetButton = role('button', { name: 'Reset tutorial' })
    const keepButton = role('button', { name: 'Keep' })
    const confirmButton = role('button', { name: 'Reset' })
    const focusReset = (id: string) =>
      Command.resolve(
        FocusTutorialReset({ id }),
        Message.CompletedFocusTutorialReset(),
      )
    scene(
      ROOT,
      given(modifyFields(home, { saveStatus: () => 'Read' })),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      click(resetButton),
      focusReset(KEEP_TUTORIAL_BUTTON_ID),
      expect(text('Show the tips again?')).toExist(),
      click(keepButton),
      focusReset(RESET_TUTORIAL_BUTTON_ID),
      expect(keepButton).toBeAbsent(),
      click(resetButton),
      focusReset(KEEP_TUTORIAL_BUTTON_ID),
      click(confirmButton),
      focusReset(RESET_TUTORIAL_BUTTON_ID),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(text('Tips are back.')).toExist(),
    )
  })

  test('a press on a menu button never reaches the game surface', () => {
    Array.forEach([playButton, manorButton, settingsButton], button => {
      vitestExpect(() =>
        scene(
          ROOT,
          given(modifyFields(home, { lastDevice: () => 'Touch' })),
          measureSurface,
          pointerDown(button, { pointerType: 'touch', pointerId: 4 }),
        ),
      ).toThrow(NO_POINTERDOWN_PATH)
    })
  })
})

describe('Menu from a run', () => {
  test('the pause screen asks before leaving: Stay keeps the run paused', () => {
    scene(
      ROOT,
      given(pausedRound),
      measureSurface,
      expect(pauseMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
      click(pauseMenuButton),
      ...showDialogInScene(),
      expect(leaveQuestion).toExist(),
      click(role('button', { name: 'Stay' })),
      ...closeDialogInScene(),
      expect(leaveQuestion).toBeAbsent(),
      expect(role('status')).toHaveText(PAUSED),
    )
  })

  test('Leave goes back to the home menu', () => {
    scene(
      ROOT,
      given(pausedRound),
      measureSurface,
      emitPressedKey('KeyH'),
      ...showDialogInScene(),
      inside(leaveQuestion, click(role('button', { name: 'Leave' }))),
      ...closeDialogInScene(),
      expect(manorButton).toExist(),
      expect(pauseMenuButton).toBeAbsent(),
    )
  })

  test('a press on the pause MENU button never reaches the game surface, so it cannot resume the run', () => {
    vitestExpect(() =>
      scene(
        ROOT,
        given(pausedRound),
        measureSurface,
        pointerDown(pauseMenuButton, { pointerType: 'touch', pointerId: 2 }),
      ),
    ).toThrow(NO_POINTERDOWN_PATH)
  })

  test('Game Over and Victory offer Menu after the grace, and it goes home', () => {
    Array.forEach([Phase.GameOver({ wave: 4 }), Phase.Victory()], phase => {
      scene(
        ROOT,
        given(modifyFields(home, { phase: () => phase })),
        measureSurface,
        expect(endMenuButton).toBeAbsent(),
      )
      scene(
        ROOT,
        given(afterGrace(phase)),
        measureSurface,
        shareMountSettles('Cancelled'),
        expect(endMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
        click(endMenuButton),
        shareMountEnded(),
        expect(manorButton).toExist(),
      )
      scene(
        ROOT,
        given(afterGrace(phase)),
        measureSurface,
        shareMountSettles('Cancelled'),
        emitPressedKey('KeyH'),
        shareMountEnded(),
        expect(manorButton).toExist(),
      )
    })
  })
})

describe('the rotation tile', () => {
  const rotateTile = role('button', { name: 'Turn with the phone' })

  test('Settings shows ROTATE only on a phone that can lock how it turns', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Profile' })).toExist(),
      expect(rotateTile).toBeAbsent(),
    )
    scene(
      ROOT,
      given(
        modifyFields(home, {
          lastDevice: () => 'Touch',
          orientationLock: () => 'Supported',
        }),
      ),
      measureSurface,
      click(settingsButton),
      ...showDialogInScene(),
      expect(rotateTile).toHaveAttr('aria-pressed', 'false'),
      expect(rotateTile).toContainText('LOCKED'),
      click(rotateTile),
      Command.resolve(
        ApplyRotation({ rotation: 'Auto' }),
        Message.CompletedApplyRotation(),
      ),
      expect(rotateTile).toHaveAttr('aria-pressed', 'true'),
      expect(rotateTile).toContainText('AUTO'),
    )
  })
})
