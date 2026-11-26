import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { profilePropsOf } from '../../../app/profileView'
import { FocusHandCard, FocusHomeButton } from '../../../app/update/home'
import { FocusProfileElement } from '../../../app/update/profile'
import { ApplyRotation } from '../../../app/update/rotation'
import {
  HAND_DIALOG_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
} from '../../../domain/clientSchema'
import { withBests } from '../../../domain/run'
import { noSavedBests, restoreSave, saveOf } from '../../../platform/save'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { home, withoutSupportLink } from '../../../test/model.fixture'
import {
  ackHudSlots,
  button,
  byClass,
  closeButton,
  dialogModel,
  emitPressedKey,
  expectAttr,
  expectClass,
  homeUnderLobby,
  lobbyBackButton,
  lobbyScreen,
  lockedNightmare,
  manorButton,
  measureSurface,
  openHandInScene,
  openLobbyInScene,
  pausePressRuns,
  pickCardInScene,
  playButton,
  readDareCardInScene,
  requestDialogClose,
  settingsButton,
  settleEndShareOf,
  showDialog,
  statusLine,
  throughIntroInScene,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type SceneStep,
  foldLobby,
  modelAfter,
  resolveFocusLobby,
  sceneOf,
  send,
  steps,
  writeSave,
} from '../../../test/testing'
import { pause } from '../../../world/waves/waves'
import { HeroPicker } from '../../heroes/block'
import { Events as HeroEvents } from '../../heroes/message'
import {
  type LobbyScene,
  expectLobbyDrawn,
  lobbyAttr,
  lobbyPropsIn,
  lobbySceneIn,
} from '../../lobby/__tests__/lobby.fixture'
import { Lobby } from '../../lobby/block'
import { HERO_DIALOG_ID } from '../../lobby/lobby'
import { Events as LobbyEvents } from '../../lobby/message'
import { isLobbyShown } from '../../lobby/model'
import {
  atRoot,
  inPanel,
  profileDeskOf,
} from '../../profile/__tests__/profile.fixture'
import { Profile } from '../../profile/block'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '../../profile/profile'
import type { HandCard, HomeButton } from '../homeSchema'

const playCluster = HtmlLocator.role('group', { name: 'Play' })
const hand = HtmlLocator.role('dialog', { name: 'The manor' })
const CARD_NAMES = {
  Character: 'Character: change how you look',
  Munchopedia: 'Dare Journal: the zombies, things, rooms, story, and heroes',
  WhatsNew: "What's new: the latest changes",
  HowToPlay: 'How to play: the controls',
} as const
const characterCard = button(CARD_NAMES.Character)
const munchopediaCard = button(/^Dare Journal:/)
const whatsNewCard = button(/^What's new:/)
const howToPlayCard = button(CARD_NAMES.HowToPlay)
const proofCard = button(/^Proof:/)
const codeCard = HtmlLocator.role('link', { name: /^Code:/ })
const munchopediaName = /^Dare Journal:/
const whatsNewName = /^What's new:/
const pauseMenuButton = button('Menu: leave this run')
const endMenuButton = button('Menu: back to the home screen')
const leaveQuestion = HtmlLocator.role('dialog', { name: 'Leave this run?' })
const bests = button(/^Your bests, Double Dare/)
const dialogNamed = (name: string) => HtmlLocator.role('dialog', { name })
const exactText = (text: string) => Locator.text(text, { exact: true })
const inside = (container: Locator.Locator) => (found: Locator.Locator) =>
  Locator.inside(container, found)
const tripleDare = button(/^Triple Dare:/)

const PREPARING = /Get ready for wave 1\./
const PAUSED =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const pausedRound: Model = pause(
  UiStruct.evolve(home, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const afterGrace = (phase: Phase): Model =>
  UiStruct.evolve(home, {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

const onTouch = (model: Model): Model =>
  UiStruct.evolve(model, { lastDevice: () => 'Touch' })

// NOTE: a press on the game surface reaches the root through the Mounts on
// the surface (WatchGameSurface) and on the pause screen's help card
// (PressGameSurface), each listening for its element's own pointerdown. A
// button outside both has no path to them.
const expectOffSurface =
  (found: Locator.Locator): SceneStep =>
  s =>
    s
      .expect(found)
      .toExist()
      .expect(Locator.inside(byClass('game-surface'), found))
      .toBeAbsent()
      .expect(Locator.inside(byClass('pause-help'), found))
      .toBeAbsent()

// NOTE: ui-kit's Dialog once its exit has played, for a root dialog closed
// by a button inside it (Stay, Leave, a card): a Scene runs no Mount, so
// the Dialog's own Model is given as the Mount would leave it.
const hideDialog =
  (id: string): SceneStep =>
  s =>
    s.givenChild(Dialog, id, dialogModel(false))

const focusHome =
  (homeButton: HomeButton): SceneStep =>
  s =>
    s.resolve(FocusHomeButton.make({ button: homeButton }), Component.noop)

const focusCard =
  (card: HandCard): SceneStep =>
  s =>
    s.resolve(FocusHandCard.make({ card }), Component.noop)

// NOTE: the lobby's event as the root hears it, through the Lobby's onEmit
// (src/app/lobbyView.ts).
const fromLobby =
  (event: LobbyEvents): SceneStep =>
  s =>
    s.childEmit(Lobby, 'lobby', event)

// NOTE: whether the lobby is up (its card open, not folding back).
const expectLobbyShown =
  (isShown: boolean): SceneStep =>
  s =>
    s.check(() => {
      vitestExpect(
        Option.match(lobbyPropsIn(s), {
          onNone: () => false,
          onSome: props => isLobbyShown(props.lobby),
        }),
      ).toBe(isShown)
    })

const expectInLobby = (
  lobby: LobbyScene,
  check: (scene: LobbyScene) => LobbyScene,
): void => {
  check(lobby)
}

describe('Home menu', () => {
  it.effect(
    'fills the slots: the gear, the MORE deck, and PLAY with CO-OP, no mode, difficulty, or hero pill, with a key badge on every button on a keyboard, and no bests badge before a best',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        const inPlay = inside(playCluster)
        const inCorner = inside(byClass('home-corner'))
        s.pipe(
          measureSurface,
          t =>
            t
              .expect(inPlay(HtmlLocator.role('button')))
              .toHaveCount(2)
              .expect(byClass('home-pick'))
              .toBeAbsent()
              .expect(button(/^Mode:/))
              .toBeAbsent()
              .expect(button(/^Difficulty:/))
              .toBeAbsent()
              .expect(button(/^Hero:/))
              .toBeAbsent(),
          expectAttr(inPlay(playButton), 'aria-keyshortcuts', 'Enter'),
          expectAttr(
            inPlay(button('Co-op: play with friends')),
            'aria-keyshortcuts',
            'J',
          ),
          expectAttr(manorButton, 'aria-keyshortcuts', 'V'),
          expectAttr(manorButton, 'aria-haspopup', 'dialog'),
          expectAttr(inCorner(settingsButton), 'aria-keyshortcuts', 'O'),
          expectAttr(inCorner(settingsButton), 'aria-haspopup', 'dialog'),
          expectAttr(
            inCorner(
              HtmlLocator.role('link', { name: /^Buy Rattles a coffee/ }),
            ),
            'aria-keyshortcuts',
            'B',
          ),
          t =>
            t
              .expect(
                Locator.inside(byClass('home-stage'), byClass('home-key')),
              )
              .toHaveCount(5),
          expectAttr(
            button('Your character: change how you look'),
            'aria-haspopup',
            'dialog',
          ),
        )
          .expect(button('Mute sound'))
          .toBeAbsent()
          .expect(bests)
          .toBeAbsent()
          .expect(Locator.text('No bests yet. Go get chewed on.'))
          .toBeAbsent()
      }),
  )

  it.effect(
    'the MANOR hand deals a card for each page with its key, and CLOSE puts it away',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withoutSupportLink(home))
        const inHand = inside(hand)
        s.pipe(
          measureSurface,
          t => t.expect(hand).toBeAbsent(),
          openHandInScene,
          showDialog(HAND_DIALOG_ID),
          t => t.expect(inHand(byClass('hand-card'))).toHaveCount(6),
          expectAttr(inHand(characterCard), 'aria-keyshortcuts', 'C'),
          expectAttr(inHand(munchopediaCard), 'aria-keyshortcuts', 'Z'),
          expectAttr(inHand(whatsNewCard), 'aria-keyshortcuts', 'L'),
          expectAttr(inHand(howToPlayCard), 'aria-keyshortcuts', 'I'),
          expectAttr(inHand(proofCard), 'aria-keyshortcuts', 'P'),
          t =>
            t
              .expect(inHand(HtmlLocator.role('link', { name: /^Tip jar/ })))
              .toBeAbsent()
              .expect(inHand(closeButton))
              .toExist(),
          requestDialogClose(HAND_DIALOG_ID, 'close-press'),
        )
          .expect(hand)
          .toBeAbsent()
          .expect(manorButton)
          .toExist()
      }),
  )

  it.effect(
    'V deals the hand from the keyboard, and the arrow keys walk its cards, the Code card last, and wrap',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withoutSupportLink(home))
        s.pipe(
          measureSurface,
          emitPressedKey('KeyV'),
          showDialog(HAND_DIALOG_ID),
          t => t.expect(hand).toExist(),
          t => t.keydown(characterCard, 'ArrowRight'),
          focusCard('Munchopedia'),
          t => t.keydown(howToPlayCard, 'ArrowDown'),
          focusCard('Proof'),
          t => t.keydown(proofCard, 'ArrowDown'),
          focusCard('Code'),
          t => t.keydown(codeCard, 'ArrowRight'),
          focusCard('Character'),
          t => t.keydown(characterCard, 'ArrowLeft'),
          focusCard('Code'),
        )
      }),
  )

  it.effect(
    'the hand deals no tip jar card: the coffee stands in the corner',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(measureSurface, openHandInScene, showDialog(HAND_DIALOG_ID))
          .expect(Locator.inside(hand, byClass('hand-card')))
          .toHaveCount(6)
          .expect(
            Locator.inside(hand, HtmlLocator.role('link', { name: /coffee/i })),
          )
          .toBeAbsent()
      }),
  )

  it.effect(
    'the Code card is the last card, a plain link to the source on GitHub that opens in a new tab',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        const inHand = Locator.inside(hand, codeCard)
        s.pipe(
          measureSurface,
          t => t.expect(codeCard).toBeAbsent(),
          openHandInScene,
          showDialog(HAND_DIALOG_ID),
          expectAttr(
            inHand,
            'href',
            'https://github.com/Tanner-Scadden/munch-manor',
          ),
          expectAttr(inHand, 'target', '_blank'),
          expectAttr(inHand, 'rel', 'noopener noreferrer'),
          expectAttr(inHand, 'data-card', 'Code'),
          expectAttr(inHand, 'id', 'hand-card-code'),
        )
          .expect(Locator.inside(codeCard, byClass('hand-card-title')))
          .toHaveText('CODE')
          .expect(Locator.inside(codeCard, byClass('home-key')))
          .toBeAbsent()
      }),
  )

  it.effect('each card opens its own page from the hand', () =>
    Effect.forEach(
      [
        {
          name: CARD_NAMES.Character,
          dialog: 'Profile',
          id: PROFILE_DIALOG_ID,
        },
        {
          name: CARD_NAMES.Munchopedia,
          dialog: 'Dare Journal',
          id: PANEL_DIALOG_ID,
        },
        {
          name: `${CARD_NAMES.WhatsNew}. Something new`,
          dialog: "What's new",
          id: PANEL_DIALOG_ID,
        },
        {
          name: CARD_NAMES.HowToPlay,
          dialog: 'How to play',
          id: PANEL_DIALOG_ID,
        },
      ],
      ({ name, dialog, id }) =>
        Effect.gen(function* () {
          const s = yield* sceneOf(home)
          s.pipe(
            measureSurface,
            openHandInScene,
            showDialog(HAND_DIALOG_ID),
            pickCardInScene(name),
            hideDialog(HAND_DIALOG_ID),
            showDialog(id),
          )
            .expect(hand)
            .toBeAbsent()
            .expect(dialogNamed(dialog))
            .toExist()
        }),
      { discard: true },
    ),
  )

  it.effect(
    'PLAY opens the lobby, a pick changes the difficulty without starting a run, and BACK goes home',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          openLobbyInScene,
          expectLobbyShown(true),
          expectAttr(homeUnderLobby, 'inert', ''),
        )
        const opened = yield* lobbySceneIn(s)
        expectInLobby(opened, lobby =>
          lobby
            .expect(lobbyScreen)
            .toExist()
            .pipe(lobbyAttr(lockedNightmare, 'aria-disabled', 'true'))
            .click(tripleDare)
            .emitted(LobbyEvents.PickedDifficulty({ difficulty: 'Hard' })),
        )
        s.pipe(
          fromLobby(LobbyEvents.PickedDifficulty({ difficulty: 'Hard' })),
          resolveFocusLobby(),
        )
        const picked = yield* lobbySceneIn(s)
        expectInLobby(picked, lobby =>
          lobby
            .pipe(lobbyAttr(tripleDare, 'aria-pressed', 'true'))
            .expect(withAttrs({ 'data-screen': 'Solo' })(byClass('coop')))
            .toExist()
            .click(lobbyBackButton)
            .emitted(LobbyEvents.RequestedLeave()),
        )
        s.pipe(fromLobby(LobbyEvents.RequestedLeave()), focusHome('Play'))
        const folding = yield* lobbySceneIn(s)
        folding.expect(lobbyScreen).toBeAbsent()
        s.pipe(
          foldLobby,
          expectLobbyDrawn(false),
          expectAttr(homeUnderLobby, 'inert', undefined),
        )
          .expect(playButton)
          .toExist()
          .expect(manorButton)
          .toExist()
      }),
  )

  it.effect(
    'Esc goes back from the lobby, and X and E pick on a keyboard while a tap does on touch',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          openLobbyInScene,
          emitPressedKey('KeyX'),
          resolveFocusLobby(),
        )
        const lobby1 = yield* lobbySceneIn(s)
        lobbyAttr(tripleDare, 'aria-pressed', 'true')(lobby1)
        s.pipe(emitPressedKey('KeyE'), resolveFocusLobby())
        const lobby2 = yield* lobbySceneIn(s)
        lobbyAttr(button('Endless'), 'aria-pressed', 'true')(lobby2)
        s.pipe(emitPressedKey('Escape'), focusHome('Play'))
        const folding = yield* lobbySceneIn(s)
        folding.expect(lobbyScreen).toBeAbsent()
        s.pipe(foldLobby, expectLobbyDrawn(false))

        const touch = yield* sceneOf(onTouch(home))
        touch.pipe(measureSurface, openLobbyInScene)
        touch.expect(byClass('home-key')).toBeAbsent()
        const dare = button(/^Dare:/)
        const onTouchLobby = yield* lobbySceneIn(touch)
        expectInLobby(onTouchLobby, lobby =>
          lobby
            .expect(byClass('home-key'))
            .toBeAbsent()
            .click(dare)
            .emitted(LobbyEvents.PickedDifficulty({ difficulty: 'Easy' })),
        )
        touch.pipe(
          fromLobby(LobbyEvents.PickedDifficulty({ difficulty: 'Easy' })),
          resolveFocusLobby(),
        )
        const lobby3 = yield* lobbySceneIn(touch)
        lobbyAttr(dare, 'aria-pressed', 'true')(lobby3)
      }),
  )

  it.effect(
    'touch shows the same buttons in the same slots without key badges',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(onTouch(home))
        s.pipe(measureSurface)
          .expect(Locator.inside(playCluster, HtmlLocator.role('button')))
          .toHaveCount(2)
          .expect(manorButton)
          .toExist()
          .expect(settingsButton)
          .toExist()
          .expect(byClass('home-key'))
          .toBeAbsent()
      }),
  )

  it.effect('shows your best endless wave, fastest win, and kills', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(
          withBests(home, current => ({
            ...current,
            maybeBestEndlessWave: Option.some(12),
            maybeFastestWinMs: Option.some(402_000),
          })),
          {
            bests: current =>
              UiStruct.evolve(current, { totalKills: () => 341 }),
          },
        ),
      )
      const inBests = inside(bests)
      s.pipe(measureSurface)
        .expect(inBests(exactText('12')))
        .toExist()
        .expect(inBests(exactText('6:42')))
        .toExist()
        .expect(inBests(exactText('341')))
        .toExist()
        .expect(inBests(exactText('Best endless wave')))
        .toExist()
        .expect(inBests(exactText('Fastest win')))
        .toExist()
        .expect(inBests(exactText('Zombies splatted')))
        .toExist()
        .expect(
          button(
            /Best endless wave 12, Fastest win 6:42, Zombies splatted 341\. Opens the Munchopedia/,
          ),
        )
        .toExist()
    }),
  )

  it.effect('the bests badge is a button that opens the Munchopedia', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(home, {
          bests: current => UiStruct.evolve(current, { totalKills: () => 12 }),
        }),
      )
      s.pipe(measureSurface, t => t.click(bests), showDialog(PANEL_DIALOG_ID))
        .expect(dialogNamed('Dare Journal'))
        .toExist()
    }),
  )

  it.effect('a loaded save shows the bests from earlier visits', () =>
    Effect.gen(function* () {
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
      const s = yield* sceneOf(restoreSave(home, saved))
      s.pipe(measureSurface)
        .expect(Locator.inside(bests, exactText('9')))
        .toExist()
        .expect(Locator.inside(bests, exactText('97')))
        .toExist()
    }),
  )

  it.effect(
    'Enter opens the lobby, and Enter again plays the mode E chose there',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          emitPressedKey('Enter'),
          resolveFocusLobby(),
          expectLobbyShown(true),
          expectAttr(homeUnderLobby, 'inert', ''),
          emitPressedKey('Enter'),
          throughIntroInScene,
          readDareCardInScene,
          ackHudSlots,
          expectLobbyShown(false),
        )
          .expect(statusLine)
          .toHaveText(PREPARING)

        const endless = yield* sceneOf(home)
        endless.pipe(
          measureSurface,
          expectAttr(
            Locator.inside(playCluster, byClass('home-play')),
            'id',
            'home-play',
          ),
          emitPressedKey('KeyE'),
          expectLobbyDrawn(false),
          emitPressedKey('Enter'),
          resolveFocusLobby(),
          emitPressedKey('KeyE'),
          resolveFocusLobby(),
        )
        const lobby4 = yield* lobbySceneIn(endless)
        lobbyAttr(button('Endless'), 'aria-pressed', 'true')(lobby4)
        endless
          .pipe(emitPressedKey('Enter'), throughIntroInScene, ackHudSlots)
          .expect(statusLine)
          .toHaveText(/Get ready for endless wave 1\./)
      }),
  )

  it.effect(
    'C opens the Profile straight from the menu, without the hand',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          emitPressedKey('KeyC'),
          showDialog(PROFILE_DIALOG_ID),
        )
          .expect(dialogNamed('Profile'))
          .toExist()
          .expect(hand)
          .toBeAbsent()
        // NOTE: the Profile is a child, a leaf in the root's Scene, so its
        // tabs are read in a Scene of its own, with the props the root
        // hands it.
        const opened = yield* modelAfter(
          home,
          send(Message.PressedKey({ code: 'KeyC' })),
        )
        const profile = yield* HtmlScene.make(Profile, profilePropsOf(opened))
        profile.check(() => {
          vitestExpect(
            profile.get(HtmlLocator.role('tab', { name: 'Look' })).attrs?.[
              'aria-selected'
            ],
          ).toBe('true')
        })
      }),
  )

  it.effect('L, Z, I, and O open their pages straight from the menu', () =>
    Effect.forEach(
      [
        { key: 'KeyL', dialog: "What's new", id: PANEL_DIALOG_ID },
        { key: 'KeyZ', dialog: 'Dare Journal', id: PANEL_DIALOG_ID },
        { key: 'KeyI', dialog: 'How to play', id: PANEL_DIALOG_ID },
        { key: 'KeyO', dialog: 'Profile', id: PROFILE_DIALOG_ID },
      ],
      ({ key, dialog, id }) =>
        Effect.gen(function* () {
          const s = yield* sceneOf(home)
          s.pipe(measureSurface, emitPressedKey(key), showDialog(id))
            .expect(dialogNamed(dialog))
            .toExist()
            .expect(hand)
            .toBeAbsent()
        }),
      { discard: true },
    ),
  )

  it.effect('without a support link the arrow keys skip the coffee', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(withoutSupportLink(home))
      s.pipe(
        measureSurface,
        emitPressedKey('ArrowRight'),
        focusHome('Play'),
        emitPressedKey('ArrowUp'),
        focusHome('Settings'),
        emitPressedKey('ArrowUp'),
        focusHome('Manor'),
      )
    }),
  )

  it.effect('arrow keys walk the buttons in order and wrap', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        emitPressedKey('ArrowRight'),
        focusHome('Play'),
        steps(
          ...Array.flatMap(
            ['Coop', 'Manor', 'Support', 'Settings', 'Play'] as const,
            homeButton => [emitPressedKey('ArrowDown'), focusHome(homeButton)],
          ),
        ),
        emitPressedKey('ArrowUp'),
        focusHome('Settings'),
      )
    }),
  )

  // NOTE: every menu dialog closes with the one shared button: the red X on
  // a small face inside a 48 px see-through button, on the Escape key. A
  // Scene can't press the Dialog's close part, so its close is asked for as
  // the press would ask (requestDialogClose).
  const closesWithX = (dialog: string): SceneStep => {
    const close = Locator.inside(dialogNamed(dialog), closeButton)
    return steps(
      expectClass(close, 'menu-close'),
      expectAttr(close, 'aria-keyshortcuts', 'Escape'),
      t =>
        t
          .expect(Locator.inside(close, byClass('menu-close-face')))
          .toExist()
          .expect(Locator.inside(close, byClass('menu-close-icon')))
          .toExist()
          .expect(close)
          .toHaveText(''),
    )
  }

  const fromHand = (name: string | RegExp, id: string): SceneStep =>
    steps(
      openHandInScene,
      showDialog(HAND_DIALOG_ID),
      pickCardInScene(name),
      hideDialog(HAND_DIALOG_ID),
      showDialog(id),
    )

  it.effect.each([
    {
      dialog: 'The manor',
      id: HAND_DIALOG_ID,
      open: steps(openHandInScene, showDialog(HAND_DIALOG_ID)),
    },
    {
      dialog: 'Profile',
      id: PROFILE_DIALOG_ID,
      open: fromHand(CARD_NAMES.Character, PROFILE_DIALOG_ID),
    },
    {
      dialog: 'Dare Journal',
      id: PANEL_DIALOG_ID,
      open: fromHand(munchopediaName, PANEL_DIALOG_ID),
    },
    {
      dialog: "What's new",
      id: PANEL_DIALOG_ID,
      open: fromHand(whatsNewName, PANEL_DIALOG_ID),
    },
    {
      dialog: 'How to play',
      id: PANEL_DIALOG_ID,
      open: fromHand(CARD_NAMES.HowToPlay, PANEL_DIALOG_ID),
    },
    {
      dialog: 'Profile',
      id: PROFILE_DIALOG_ID,
      open: steps(
        (t: Parameters<SceneStep>[0]) => t.click(settingsButton),
        showDialog(PROFILE_DIALOG_ID),
      ),
    },
  ])('$dialog (#$#) closes with the shared close X', ({ dialog, id, open }) =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        open,
        closesWithX(dialog),
        requestDialogClose(id, 'close-press'),
      )
        .expect(dialogNamed(dialog))
        .toBeAbsent()
    }),
  )

  it.effect('the hero picker (Hero) closes with the shared close X', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface, openLobbyInScene)
      const opened = yield* lobbySceneIn(s)
      opened.click(button(/^Hero:/)).emitted(LobbyEvents.RequestedHeroPicker())
      s.pipe(fromLobby(LobbyEvents.RequestedHeroPicker()))
      const picking = yield* lobbySceneIn(s)
      const heroDialog = dialogNamed('Hero')
      picking
        .givenChild(Dialog, HERO_DIALOG_ID, dialogModel(true))
        .expect(heroDialog)
        .toExist()
      // NOTE: the close X is the hero picker's own (a leaf in the lobby's
      // Scene), so it is read in a Scene of the picker with the props the
      // lobby hands it.
      const props = yield* Effect.fromOption(lobbyPropsIn(s))
      const picker = yield* HtmlScene.make(HeroPicker, {
        look: props.look,
        chosen: props.calling,
        trying: Option.getOrNull(props.lobby.maybeTrying),
        rank: props.rank,
        bought: props.bought,
        bones: props.bones,
        fresh: props.fresh,
        layout: 'Panel',
      })
      picker
        .check(() => {
          const attrs = picker.get(closeButton).attrs
          vitestExpect(attrs?.['class']).toMatch(/\bmenu-close\b/)
          vitestExpect(attrs?.['aria-keyshortcuts']).toBe('Escape')
        })
        .expect(Locator.inside(closeButton, byClass('menu-close-face')))
        .toExist()
        .expect(Locator.inside(closeButton, byClass('menu-close-icon')))
        .toExist()
        .expect(closeButton)
        .toHaveText('')
        .click(closeButton)
        .emitted(HeroEvents.RequestedClose())
      picking
        .childEmit(HeroPicker, 'lobby-hero-picker', HeroEvents.RequestedClose())
        .emitted(LobbyEvents.RequestedCloseHeroPicker())
      s.pipe(fromLobby(LobbyEvents.RequestedCloseHeroPicker()))
      const closed = yield* lobbySceneIn(s)
      closed.expect(heroDialog).toBeAbsent()
    }),
  )

  it.effect(
    'How to play shows the controls as cards for the device, and its X closes it',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        const howToPlay = dialogNamed('How to play')
        s.pipe(measureSurface, fromHand(CARD_NAMES.HowToPlay, PANEL_DIALOG_ID))
          .expect(
            Locator.inside(
              Locator.inside(
                howToPlay,
                HtmlLocator.role('list', { name: 'Controls' }),
              ),
              HtmlLocator.role('listitem'),
            ),
          )
          .toHaveCount(12)
          .expect(
            Locator.inside(
              howToPlay,
              HtmlLocator.role('list', { name: 'More keys' }),
            ),
          )
          .toExist()
          .expect(
            Locator.inside(
              howToPlay,
              HtmlLocator.role('region', { name: 'On the menu' }),
            ),
          )
          .toExist()
          .expect(Locator.inside(howToPlay, closeButton))
          .toExist()
          .pipe(requestDialogClose(PANEL_DIALOG_ID, 'close-press'))
          .expect(howToPlay)
          .toBeAbsent()
          .expect(manorButton)
          .toExist()
      }),
  )

  it.effect(
    'the gear opens the Profile on Settings, and its tiles toggle sound, music, screen shake, and the big cursor',
    () =>
      Effect.gen(function* () {
        const soundToggle = button('Sound')
        const musicToggle = button('Music')
        const shakeToggle = button('Screen shake')
        const cursorToggle = button('Big cursor')
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          t => t.click(settingsButton),
          showDialog(PROFILE_DIALOG_ID),
          expectAttr(byClass('game-root'), 'data-cursor', 'Bold'),
        )
          .expect(dialogNamed('Profile'))
          .toExist()
        // NOTE: the Profile's tiles, in a Scene of its own beside the
        // root's Story (src/features/profile/__tests__/profile.fixture.ts).
        const onSettings = yield* modelAfter(
          home,
          send(Message.ClickedSettingsButton()),
        )
        const desk = yield* profileDeskOf(onSettings)
        const attr = (found: Locator.Locator, name: string) =>
          desk.scene.get(found).attrs?.[name]
        vitestExpect(
          attr(HtmlLocator.role('tab', { name: 'Settings' }), 'aria-selected'),
        ).toBe('true')
        vitestExpect(attr(soundToggle, 'aria-pressed')).toBe('true')
        vitestExpect(attr(soundToggle, 'aria-keyshortcuts')).toBe('M')
        vitestExpect(attr(musicToggle, 'aria-keyshortcuts')).toBe('N')
        vitestExpect(attr(shakeToggle, 'aria-pressed')).toBe('true')
        desk.scene.expect(button('Full screen')).toBeAbsent()
        inPanel(t => t.click(soundToggle))(desk)
        vitestExpect(attr(soundToggle, 'aria-pressed')).toBe('false')
        inPanel(t => t.click(musicToggle))(desk)
        vitestExpect(attr(musicToggle, 'aria-pressed')).toBe('false')
        inPanel(t => t.click(shakeToggle))(desk)
        vitestExpect(attr(shakeToggle, 'aria-pressed')).toBe('false')
        vitestExpect(attr(cursorToggle, 'aria-pressed')).toBe('true')
        inPanel(t => t.click(cursorToggle))(desk)
        vitestExpect(attr(cursorToggle, 'aria-pressed')).toBe('false')
        const after = yield* sceneOf(desk.root.model)
        after.pipe(
          measureSurface,
          expectAttr(byClass('game-root'), 'data-cursor', 'Thin'),
        )
      }),
  )

  it.effect(
    'Reset tutorial asks first, then says the tips will show again',
    () =>
      Effect.gen(function* () {
        const resetButton = button('Reset tutorial')
        const keepButton = button('Keep')
        const confirmButton = button('Reset')
        const focusReset = (id: string) =>
          atRoot(root =>
            root.resolve(
              FocusProfileElement.make({ selector: `#${id}` }),
              Component.noop,
            ),
          )
        const onSettings = yield* modelAfter(
          UiStruct.evolve(home, {
            saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
          }),
          send(Message.ClickedSettingsButton()),
        )
        const desk = yield* profileDeskOf(onSettings)
        inPanel(t => t.click(resetButton))(desk)
        focusReset(KEEP_TUTORIAL_BUTTON_ID)(desk)
        desk.scene.expect(Locator.text('Show the tips again?')).toExist()
        inPanel(t => t.click(keepButton))(desk)
        focusReset(RESET_TUTORIAL_BUTTON_ID)(desk)
        desk.scene.expect(keepButton).toBeAbsent()
        inPanel(t => t.click(resetButton))(desk)
        focusReset(KEEP_TUTORIAL_BUTTON_ID)(desk)
        inPanel(t => t.click(confirmButton))(desk)
        focusReset(RESET_TUTORIAL_BUTTON_ID)(desk)
        atRoot(writeSave)(desk)
        desk.scene.expect(Locator.text('Tips are back.')).toExist()
      }),
  )

  it.effect('a press on a menu button never reaches the game surface', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onTouch(home))
      s.pipe(
        measureSurface,
        expectOffSurface(playButton),
        expectOffSurface(manorButton),
        expectOffSurface(settingsButton),
      )
    }),
  )
})

describe('Menu from a run', () => {
  it.effect(
    'the pause screen asks before leaving: Stay keeps the run paused',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(pausedRound)
        s.pipe(
          measureSurface,
          pausePressRuns,
          expectAttr(pauseMenuButton, 'aria-keyshortcuts', 'H'),
          t => t.click(pauseMenuButton),
          showDialog(PANEL_DIALOG_ID),
          t => t.expect(leaveQuestion).toExist(),
          t => t.click(button('Stay')),
          hideDialog(PANEL_DIALOG_ID),
        )
          .expect(leaveQuestion)
          .toBeAbsent()
          .expect(statusLine)
          .toHaveText(PAUSED)
      }),
  )

  it.effect('Leave goes back to the home menu', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(pausedRound)
      s.pipe(
        measureSurface,
        pausePressRuns,
        emitPressedKey('KeyH'),
        showDialog(PANEL_DIALOG_ID),
        t => t.click(Locator.inside(leaveQuestion, button('Leave'))),
        hideDialog(PANEL_DIALOG_ID),
      )
        .expect(manorButton)
        .toExist()
        .expect(pauseMenuButton)
        .toBeAbsent()
    }),
  )

  it.effect(
    'a press on the pause MENU button never reaches the game surface, so it cannot resume the run',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(pausedRound)
        s.pipe(
          measureSurface,
          pausePressRuns,
          expectOffSurface(pauseMenuButton),
        )
      }),
  )

  it.effect(
    'Game Over and the escape offer Menu after the grace, and it goes home',
    () =>
      Effect.forEach(
        [Phase.GameOver({ wave: 4 }), Phase.Escaped({ wave: 10 })],
        phase =>
          Effect.gen(function* () {
            const early = yield* sceneOf(
              UiStruct.evolve(home, { phase: () => phase }),
            )
            early.pipe(measureSurface).expect(endMenuButton).toBeAbsent()
            const byClick = yield* sceneOf(afterGrace(phase))
            byClick
              .pipe(
                measureSurface,
                settleEndShareOf(afterGrace(phase)),
                expectAttr(endMenuButton, 'aria-keyshortcuts', 'H'),
                t => t.click(endMenuButton),
              )
              .expect(manorButton)
              .toExist()
            const byKey = yield* sceneOf(afterGrace(phase))
            byKey
              .pipe(
                measureSurface,
                settleEndShareOf(afterGrace(phase)),
                emitPressedKey('KeyH'),
              )
              .expect(manorButton)
              .toExist()
          }),
        { discard: true },
      ),
  )
})

describe('the rotation tile', () => {
  const rotateTile = button('Turn with the phone')

  it.effect(
    'Settings shows ROTATE only on a phone that can lock how it turns',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          t => t.click(settingsButton),
          showDialog(PROFILE_DIALOG_ID),
        )
          .expect(dialogNamed('Profile'))
          .toExist()
        const desktop = yield* modelAfter(
          home,
          send(Message.ClickedSettingsButton()),
        )
        const onDesktop = yield* HtmlScene.make(
          Profile,
          profilePropsOf(desktop),
        )
        onDesktop.expect(rotateTile).toBeAbsent()

        const phone = yield* modelAfter(
          UiStruct.evolve(onTouch(home), {
            orientationLock: () => 'Supported',
          }),
          send(Message.ClickedSettingsButton()),
        )
        const desk = yield* profileDeskOf(phone)
        const pressed = () => desk.scene.get(rotateTile).attrs?.['aria-pressed']
        vitestExpect(pressed()).toBe('false')
        desk.scene.expect(rotateTile).toHaveText(/LOCKED/)
        inPanel(t => t.click(rotateTile))(desk)
        atRoot(root =>
          root.resolve(
            ApplyRotation.make({ rotation: 'Auto' }),
            Component.noop,
          ),
        )(desk)
        vitestExpect(pressed()).toBe('true')
        desk.scene.expect(rotateTile).toHaveText(/AUTO/)
      }),
  )
})
