import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { BeatMyRun } from '../../../domain/beatLink'
import { Screen } from '../../../domain/coopRoom'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { FocusLobbyControl, FoldLobby } from '../../../features/lobby/steps'
import type { ProfileTab } from '../../../features/profile/model'
import {
  home,
  openedDialog,
  readyModel,
  veteranFighting,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  resolveFocusLobby,
} from '../../../test/testing'
import { DebutCard } from '../../../world/schema/worldSchema'
import { pause } from '../../../world/waves/waves'
import { menuState } from '../../menuState'
import { Message } from '../../message'
import { type Model, Phase } from '../../model'
import { FocusHomeButton } from '../home'
import {
  ClickPadFocus,
  EscapePadDialog,
  MovePadFocus,
  StepPadTab,
} from '../padMenu'

// A controller in every menu: each menu by its state, the stick and d-pad
// moving focus, A pressing, B backing out, the bumpers turning tabs.

const BUTTON_COUNT = 17
const A = 0
const B = 1
const LB = 4
const RB = 5
const DPAD_UP = 12
const DPAD_DOWN = 13
const DPAD_RIGHT = 15

const padOf = ({
  axes = [0, 0, 0, 0],
  held = [],
}: Readonly<{
  axes?: ReadonlyArray<number>
  held?: ReadonlyArray<number>
}>) =>
  Message.PolledGamepad({
    index: 0,
    axes,
    buttons: Array.makeBy(BUTTON_COUNT, position =>
      Array.contains(held, position) ? 1 : 0,
    ),
  })

const poll = (reading: Parameters<typeof padOf>[0]) =>
  Story.message(padOf(reading))

const rest = poll({})

// NOTE: a button pressed and let go, as a thumb does.
const tapPad = (button: number) => Story.steps(poll({ held: [button] }), rest)

// NOTE: a pad already in hand and resting, so the first press is an edge.
const withPad = (model: Model): Model =>
  modifyFields(model, {
    input: input =>
      modifyFields(input, {
        maybeGamepad: () =>
          Option.some({
            index: 0,
            axes: [0, 0, 0, 0],
            buttons: Array.makeBy(BUTTON_COUNT, () => 0),
          }),
      }),
  })

const withPanel = (model: Model, panel: Model['panel']): Model =>
  modifyFields(model, { panel: () => panel, panelDialog: openedDialog })

const onProfileTab = (tab: ProfileTab): Model =>
  modifyFields(withPad(home), {
    profile: profile => modifyFields(profile, { tab: () => tab }),
    profileDialog: openedDialog,
  })

const inHand: Model = modifyFields(withPad(home), { handDialog: openedDialog })

const inCoop: Model = modifyFields(withPad(home), {
  coop: coop =>
    modifyFields(coop, {
      screen: () => Screen.Hub({ maybeProblem: Option.none() }),
    }),
})

const inLobby: Model = modifyFields(withPad(home), {
  lobby: lobby => modifyFields(lobby, { status: () => 'Open' }),
})

const inHeroPicker: Model = modifyFields(inLobby, {
  lobby: lobby => modifyFields(lobby, { heroDialog: openedDialog }),
})

const onEndCard: Model = modifyFields(withPad(home), {
  phase: () => Phase.GameOver({ wave: 3 }),
  screenMs: () => 60_000,
})

const paused: Model = withPad(pause(veteranFighting))

const pageFocus = (direction: 'Up' | 'Down' | 'Left' | 'Right') =>
  Story.Command.expectExact(MovePadFocus({ scope: 'Page', direction }))

const dialogFocus = (direction: 'Up' | 'Down' | 'Left' | 'Right') =>
  Story.Command.expectExact(MovePadFocus({ scope: 'TopDialog', direction }))

const resolveMoved = Story.Command.resolve(
  MovePadFocus,
  Message.CompletedPadMenu(),
)

const resolveTab = Story.Command.resolve(StepPadTab, Message.CompletedPadMenu())

const resolveEscape = Story.Command.resolve(
  EscapePadDialog,
  Message.CompletedPadMenu(),
)

const resolveClicked = Story.Command.resolve(
  ClickPadFocus,
  Message.ClickedPadFocus({ scope: 'TopDialog', outcome: 'Clicked' }),
)

const resolveHomeFocus = Story.Command.resolve(
  FocusHomeButton,
  Message.CompletedFocusHomeButton(),
)

const onDebutCard: Model = modifyFields(withPad(veteranFighting), {
  debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 60_000 }),
})

describe('a controller in the menus', () => {
  describe('the home menu', () => {
    it.effect('the d-pad steps the menu ring, as an arrow key does', () =>
      Story.story(
        APPLICATION,
        Story.given(withPad(home)),
        poll({ held: [DPAD_DOWN] }),
        Story.model(current => {
          expect(current.lastDevice).toBe('Gamepad')
          expect(current.maybeHomeFocus).toEqual(Option.some('Play'))
        }),
        Story.Command.expectExact(FocusHomeButton({ button: 'Play' })),
        resolveHomeFocus,
        rest,
        poll({ held: [DPAD_DOWN] }),
        Story.model(current => {
          expect(current.maybeHomeFocus).toEqual(Option.some('Coop'))
        }),
        resolveHomeFocus,
      ),
    )

    it.effect('the left stick flicks focus once, then repeats when held', () =>
      Story.story(
        APPLICATION,
        Story.given(withPad(home)),
        poll({ axes: [0, 0.9, 0, 0] }),
        resolveHomeFocus,
        poll({ axes: [0.1, 0.95, 0, 0] }),
        Story.Command.expectNone(),
        Story.message(Message.RepeatedPadDirection({ direction: 'Down' })),
        Story.model(current => {
          expect(current.maybeHomeFocus).toEqual(Option.some('Coop'))
        }),
        resolveHomeFocus,
      ),
    )

    it.effect('a stick nudged short of a flick moves nothing', () =>
      Story.story(
        APPLICATION,
        Story.given(withPad(home)),
        poll({ axes: [0, 0.4, 0, 0] }),
        Story.Command.expectNone(),
      ),
    )

    it.effect('A clicks what has focus, or plays when nothing does', () =>
      Story.story(
        APPLICATION,
        Story.given(withPad(home)),
        tapPad(A),
        Story.Command.expectExact(ClickPadFocus({ scope: 'Page' })),
        Story.Command.resolve(
          ClickPadFocus,
          Message.ClickedPadFocus({ scope: 'Page', outcome: 'NothingFocused' }),
        ),
        Story.model(current => {
          expect(menuState(current)._tag).toBe('Lobby')
        }),
        resolveFocusLobby(),
      ),
    )
  })

  describe('the dialogs', () => {
    it.effect('the MORE hand moves focus on the page and B puts it away', () =>
      Story.story(
        APPLICATION,
        Story.given(inHand),
        poll({ held: [DPAD_RIGHT] }),
        dialogFocus('Right'),
        resolveMoved,
        rest,
        tapPad(B),
        Story.Command.expectExact(EscapePadDialog()),
        resolveEscape,
      ),
    )

    it.effect('How to play takes A on the focused card', () =>
      Story.story(
        APPLICATION,
        Story.given(withPanel(withPad(home), 'HowToPlay')),
        tapPad(A),
        Story.Command.expectExact(ClickPadFocus({ scope: 'TopDialog' })),
        resolveClicked,
      ),
    )

    it.effect("What's New turns its pages with the bumpers", () =>
      Story.story(
        APPLICATION,
        Story.given(withPanel(withPad(home), 'WhatsNew')),
        tapPad(RB),
        Story.Command.expectExact(
          StepPadTab({ scope: 'TopDialog', step: 'Next' }),
        ),
        resolveTab,
        tapPad(LB),
        Story.Command.expectExact(
          StepPadTab({ scope: 'TopDialog', step: 'Previous' }),
        ),
        resolveTab,
      ),
    )

    it.effect('the Munchopedia and its guide move focus in their panel', () =>
      Story.story(
        APPLICATION,
        Story.given(withPanel(withPad(home), 'Munchopedia')),
        poll({ held: [DPAD_DOWN] }),
        dialogFocus('Down'),
        resolveMoved,
      ),
    )

    it.effect('the Profile turns its tabs with the bumpers', () =>
      Story.story(
        APPLICATION,
        Story.given(onProfileTab('Settings')),
        tapPad(LB),
        Story.Command.expectExact(
          StepPadTab({ scope: 'TopDialog', step: 'Previous' }),
        ),
        resolveTab,
        tapPad(B),
        Story.Command.expectExact(EscapePadDialog()),
        resolveEscape,
      ),
    )

    it.effect("the Look tab's options take the stick", () =>
      Story.story(
        APPLICATION,
        Story.given(onProfileTab('Look')),
        poll({ axes: [0.9, 0, 0, 0] }),
        dialogFocus('Right'),
        resolveMoved,
      ),
    )

    it.effect('the install guide and the update greeting close on B', () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(withPad(home), {
            homeScreenSteps: openedDialog,
            updateGreeting: openedDialog,
          }),
        ),
        tapPad(B),
        Story.Command.expectExact(EscapePadDialog()),
        resolveEscape,
      ),
    )
  })

  describe('the lobbies', () => {
    it.effect('the solo lobby steps its own focus by the d-pad', () =>
      Story.story(
        APPLICATION,
        Story.given(inLobby),
        poll({ held: [DPAD_UP] }),
        Story.model(current => {
          expect(current.lastDevice).toBe('Gamepad')
        }),
        Story.Command.expectExact(FocusLobbyControl({ control: 'Start' })),
        resolveFocusLobby(),
      ),
    )

    it.effect("B on the home menu lets a friend's dare go", () =>
      Story.story(
        APPLICATION,
        Story.given(
          withPad(
            modifyFields(readyModel, {
              beatMyRun: () =>
                BeatMyRun.Offered({
                  dare: {
                    seed: 99,
                    mode: 'Campaign',
                    difficulty: 'Easy',
                    modifiers: readyModel.modifiers,
                    dareMark: 0,
                    easyBreakSeconds: 0,
                    pool: [],
                    hero: 'You',
                    outcome: 'Won',
                    wave: 10,
                    found: [],
                    runSeconds: 600,
                  },
                }),
            }),
          ),
        ),
        tapPad(B),
        Story.Command.resolve(
          FocusHomeButton({ button: 'Play' }),
          Message.CompletedFocusHomeButton(),
        ),
        Story.model(({ beatMyRun }) => {
          expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
        }),
      ),
    )

    it.effect('B in the solo lobby backs out to the home menu', () =>
      Story.story(
        APPLICATION,
        Story.given(inLobby),
        tapPad(B),
        Story.model(current => {
          expect(menuState(current)._tag).toBe('Home')
        }),
        Story.Command.resolve(FoldLobby(), LobbyMessage.CompletedFold()),
        resolveHomeFocus,
      ),
    )

    it.effect(
      'the hero picker over the lobby moves focus and closes on B',
      () =>
        Story.story(
          APPLICATION,
          Story.given(inHeroPicker),
          poll({ held: [DPAD_RIGHT] }),
          dialogFocus('Right'),
          resolveMoved,
          rest,
          tapPad(B),
          Story.Command.expectExact(EscapePadDialog()),
          resolveEscape,
        ),
    )

    it.effect("co-op's screens move focus in co-op, and B backs out", () =>
      Story.story(
        APPLICATION,
        Story.given(inCoop),
        poll({ held: [DPAD_DOWN] }),
        Story.Command.expectExact(
          MovePadFocus({ scope: 'Coop', direction: 'Down' }),
        ),
        resolveMoved,
        rest,
        tapPad(B),
        Story.model(current => {
          expect(menuState(current)._tag).toBe('Home')
        }),
        resolveHomeFocus,
      ),
    )
  })

  describe('a run', () => {
    it.effect('the end card moves focus on the page and A presses', () =>
      Story.story(
        APPLICATION,
        Story.given(onEndCard),
        poll({ held: [DPAD_RIGHT] }),
        pageFocus('Right'),
        resolveMoved,
        rest,
        tapPad(A),
        Story.Command.expectExact(ClickPadFocus({ scope: 'Page' })),
        Story.Command.resolve(
          ClickPadFocus,
          Message.ClickedPadFocus({ scope: 'Page', outcome: 'Clicked' }),
        ),
      ),
    )

    it.effect('B on pause resumes, as Escape does', () =>
      Story.story(
        APPLICATION,
        Story.given(paused),
        tapPad(B),
        Story.model(current => {
          expect(current.phase._tag).toBe('Wave')
        }),
      ),
    )

    it.effect("the leave panel over pause is the pad's to answer", () =>
      Story.story(
        APPLICATION,
        Story.given(withPanel(paused, 'LeaveRun')),
        tapPad(A),
        Story.model(current => {
          expect(current.phase._tag).not.toBe('Paused')
        }),
        closeDialog(),
      ),
    )

    it.effect('A answers the new zombie card', () =>
      Story.story(
        APPLICATION,
        Story.given(onDebutCard),
        tapPad(A),
        Story.model(current => {
          expect(current.debutCard).toEqual(DebutCard.Hidden())
        }),
      ),
    )

    it.effect('in a round the d-pad walks and moves no focus', () =>
      Story.story(
        APPLICATION,
        Story.given(withPad(veteranFighting)),
        poll({ held: [DPAD_DOWN] }),
        Story.Command.expectNone(),
        Story.message(Message.RepeatedPadDirection({ direction: 'Down' })),
        Story.Command.expectNone(),
      ),
    )
  })
})
