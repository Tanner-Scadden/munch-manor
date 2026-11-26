import { Array, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { BeatMyRun } from '../../../domain/beatLink'
import { Screen } from '../../../domain/coopRoom'
import type { ProfileTab } from '../../../features/profile/model'
import {
  home,
  openedDialog,
  readyModel,
  veteranFighting,
} from '../../../test/model.fixture'
import {
  type AppStory,
  type StoryStep,
  checkModel,
  foldLobby,
  modelAfter,
  resolveFocusLobby,
  send,
  steps,
} from '../../../test/testing'
import { DebutCard } from '../../../world/schema/worldSchema'
import { pause } from '../../../world/waves/waves'
import { menuState } from '../../menuState'
import { Message } from '../../message'
import { type Model, Phase } from '../../model'
import { FocusHomeButton } from '../home'
import { FocusLobbyControl } from '../lobby'
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

const poll = (reading: Parameters<typeof padOf>[0]): StoryStep =>
  send(padOf(reading))

const rest = poll({})

// NOTE: a button pressed. A Command it issues is settled before the
// thumb lets go (`rest`), since a Story sends nothing while one is pending.
const pressPad = (button: number): StoryStep => poll({ held: [button] })

// NOTE: a pad already in hand and resting, so the first press is an edge.
const withPad = (model: Model): Model =>
  UiStruct.evolve(model, {
    input: input =>
      UiStruct.evolve(input, {
        maybeGamepad: () =>
          Option.some({
            index: 0,
            axes: [0, 0, 0, 0],
            buttons: Array.makeBy(BUTTON_COUNT, () => 0),
          }),
      }),
  })

const withPanel = (model: Model, panel: Model['panel']): Model =>
  UiStruct.evolve(model, { panel: () => panel, panelDialog: openedDialog })

const onProfileTab = (tab: ProfileTab): Model =>
  UiStruct.evolve(withPad(home), {
    profile: profile => UiStruct.evolve(profile, { tab: () => tab }),
    profileDialog: openedDialog,
  })

const inHand: Model = UiStruct.evolve(withPad(home), {
  handDialog: openedDialog,
})

const inCoop: Model = UiStruct.evolve(withPad(home), {
  coop: coop =>
    UiStruct.evolve(coop, {
      screen: () => Screen.Hub({ maybeProblem: Option.none() }),
    }),
})

const inLobby: Model = UiStruct.evolve(withPad(home), {
  lobby: lobby => UiStruct.evolve(lobby, { status: () => 'Open' }),
})

const inHeroPicker: Model = UiStruct.evolve(inLobby, {
  lobby: lobby => UiStruct.evolve(lobby, { isHeroPickerOpen: () => true }),
})

const onEndCard: Model = UiStruct.evolve(withPad(home), {
  phase: () => Phase.GameOver({ wave: 3 }),
  screenMs: () => 60_000,
})

const paused: Model = withPad(pause(veteranFighting))

const pageFocus =
  (direction: 'Up' | 'Down' | 'Left' | 'Right'): StoryStep =>
  s =>
    s.expectExact(MovePadFocus.make({ scope: 'Page', direction }))

const dialogFocus =
  (direction: 'Up' | 'Down' | 'Left' | 'Right'): StoryStep =>
  s =>
    s.expectExact(MovePadFocus.make({ scope: 'TopDialog', direction }))

const resolveMoved = (s: AppStory) => s.resolve(MovePadFocus, Component.noop)

const resolveTab = (s: AppStory) => s.resolve(StepPadTab, Component.noop)

const resolveEscape = (s: AppStory) =>
  s.resolve(EscapePadDialog, Component.noop)

const resolveClicked = (s: AppStory) =>
  s.resolve(
    ClickPadFocus,
    Message.ClickedPadFocus({ scope: 'TopDialog', outcome: 'Clicked' }),
  )

const resolveHomeFocus = (s: AppStory) =>
  s.resolve(FocusHomeButton, Component.noop)

const onDebutCard: Model = UiStruct.evolve(withPad(veteranFighting), {
  debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 60_000 }),
})

describe('a controller in the menus', () => {
  describe('the home menu', () => {
    it.effect('the d-pad steps the menu ring, as an arrow key does', () =>
      modelAfter(
        withPad(home),
        steps(
          poll({ held: [DPAD_DOWN] }),
          checkModel(current => {
            expect(current.lastDevice).toBe('Gamepad')
            expect(current.maybeHomeFocus).toEqual(Option.some('Play'))
          }),
          s => s.expectExact(FocusHomeButton.make({ button: 'Play' })),
          resolveHomeFocus,
          rest,
          poll({ held: [DPAD_DOWN] }),
          checkModel(current => {
            expect(current.maybeHomeFocus).toEqual(Option.some('Coop'))
          }),
          resolveHomeFocus,
        ),
      ),
    )

    it.effect('the left stick flicks focus once, then repeats when held', () =>
      modelAfter(
        withPad(home),
        steps(
          poll({ axes: [0, 0.9, 0, 0] }),
          resolveHomeFocus,
          poll({ axes: [0.1, 0.95, 0, 0] }),
          s => s.expectNone(),
          send(Message.RepeatedPadDirection({ direction: 'Down' })),
          checkModel(current => {
            expect(current.maybeHomeFocus).toEqual(Option.some('Coop'))
          }),
          resolveHomeFocus,
        ),
      ),
    )

    it.effect('a stick nudged short of a flick moves nothing', () =>
      modelAfter(
        withPad(home),
        steps(poll({ axes: [0, 0.4, 0, 0] }), s => s.expectNone()),
      ),
    )

    it.effect('A clicks what has focus, or plays when nothing does', () =>
      modelAfter(
        withPad(home),
        steps(
          pressPad(A),
          s => s.expectExact(ClickPadFocus.make({ scope: 'Page' })),
          (s: AppStory) =>
            s.resolve(
              ClickPadFocus,
              Message.ClickedPadFocus({
                scope: 'Page',
                outcome: 'NothingFocused',
              }),
            ),
          checkModel(current => {
            expect(menuState(current)._tag).toBe('Lobby')
          }),
          resolveFocusLobby(),
        ),
      ),
    )
  })

  describe('the dialogs', () => {
    it.effect('the MORE hand moves focus on the page and B puts it away', () =>
      modelAfter(
        inHand,
        steps(
          poll({ held: [DPAD_RIGHT] }),
          dialogFocus('Right'),
          resolveMoved,
          rest,
          pressPad(B),
          s => s.expectExact(EscapePadDialog.make()),
          resolveEscape,
        ),
      ),
    )

    it.effect('How to play takes A on the focused card', () =>
      modelAfter(
        withPanel(withPad(home), 'HowToPlay'),
        steps(
          pressPad(A),
          s => s.expectExact(ClickPadFocus.make({ scope: 'TopDialog' })),
          resolveClicked,
        ),
      ),
    )

    it.effect("What's New turns its pages with the bumpers", () =>
      modelAfter(
        withPanel(withPad(home), 'WhatsNew'),
        steps(
          pressPad(RB),
          s =>
            s.expectExact(
              StepPadTab.make({ scope: 'TopDialog', step: 'Next' }),
            ),
          resolveTab,
          rest,
          pressPad(LB),
          s =>
            s.expectExact(
              StepPadTab.make({ scope: 'TopDialog', step: 'Previous' }),
            ),
          resolveTab,
        ),
      ),
    )

    it.effect('the Munchopedia and its guide move focus in their panel', () =>
      modelAfter(
        withPanel(withPad(home), 'Munchopedia'),
        steps(poll({ held: [DPAD_DOWN] }), dialogFocus('Down'), resolveMoved),
      ),
    )

    it.effect('the Profile turns its tabs with the bumpers', () =>
      modelAfter(
        onProfileTab('Settings'),
        steps(
          pressPad(LB),
          s =>
            s.expectExact(
              StepPadTab.make({ scope: 'TopDialog', step: 'Previous' }),
            ),
          resolveTab,
          rest,
          pressPad(B),
          s => s.expectExact(EscapePadDialog.make()),
          resolveEscape,
        ),
      ),
    )

    it.effect("the Look tab's options take the stick", () =>
      modelAfter(
        onProfileTab('Look'),
        steps(
          poll({ axes: [0.9, 0, 0, 0] }),
          dialogFocus('Right'),
          resolveMoved,
        ),
      ),
    )

    it.effect('the install guide and the update greeting close on B', () =>
      modelAfter(
        UiStruct.evolve(withPad(home), {
          homeScreenSteps: openedDialog,
          updateGreeting: openedDialog,
        }),
        steps(
          pressPad(B),
          s => s.expectExact(EscapePadDialog.make()),
          resolveEscape,
        ),
      ),
    )
  })

  describe('the lobbies', () => {
    it.effect('the solo lobby steps its own focus by the d-pad', () =>
      modelAfter(
        inLobby,
        steps(
          poll({ held: [DPAD_UP] }),
          checkModel(current => {
            expect(current.lastDevice).toBe('Gamepad')
          }),
          s => s.expectExact(FocusLobbyControl.make({ control: 'Start' })),
          resolveFocusLobby(),
        ),
      ),
    )

    it.effect("B on the home menu lets a friend's dare go", () =>
      modelAfter(
        withPad(
          UiStruct.evolve(readyModel, {
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
        steps(
          pressPad(B),
          s =>
            s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop),
          checkModel(({ beatMyRun }) => {
            expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
          }),
        ),
      ),
    )

    it.effect('B in the solo lobby backs out to the home menu', () =>
      modelAfter(
        inLobby,
        steps(
          pressPad(B),
          checkModel(current => {
            expect(menuState(current)._tag).toBe('Home')
          }),
          foldLobby,
          resolveHomeFocus,
        ),
      ),
    )

    it.effect(
      'the hero picker over the lobby moves focus and closes on B',
      () =>
        modelAfter(
          inHeroPicker,
          steps(
            poll({ held: [DPAD_RIGHT] }),
            dialogFocus('Right'),
            resolveMoved,
            rest,
            pressPad(B),
            s => s.expectExact(EscapePadDialog.make()),
            resolveEscape,
          ),
        ),
    )

    it.effect("co-op's screens move focus in co-op, and B backs out", () =>
      modelAfter(
        inCoop,
        steps(
          poll({ held: [DPAD_DOWN] }),
          s =>
            s.expectExact(
              MovePadFocus.make({ scope: 'Coop', direction: 'Down' }),
            ),
          resolveMoved,
          rest,
          pressPad(B),
          checkModel(current => {
            expect(menuState(current)._tag).toBe('Home')
          }),
          resolveHomeFocus,
        ),
      ),
    )
  })

  describe('a run', () => {
    it.effect('the end card moves focus on the page and A presses', () =>
      modelAfter(
        onEndCard,
        steps(
          poll({ held: [DPAD_RIGHT] }),
          pageFocus('Right'),
          resolveMoved,
          rest,
          pressPad(A),
          s => s.expectExact(ClickPadFocus.make({ scope: 'Page' })),
          (s: AppStory) =>
            s.resolve(
              ClickPadFocus,
              Message.ClickedPadFocus({ scope: 'Page', outcome: 'Clicked' }),
            ),
        ),
      ),
    )

    it.effect('B on pause resumes, as Escape does', () =>
      modelAfter(
        paused,
        steps(
          pressPad(B),
          checkModel(current => {
            expect(current.phase._tag).toBe('Wave')
          }),
        ),
      ),
    )

    it.effect("the leave panel over pause is the pad's to answer", () =>
      modelAfter(
        withPanel(paused, 'LeaveRun'),
        steps(
          pressPad(A),
          checkModel(current => {
            expect(current.phase._tag).not.toBe('Paused')
          }),
        ),
      ),
    )

    it.effect('A answers the new zombie card', () =>
      modelAfter(
        onDebutCard,
        steps(
          pressPad(A),
          checkModel(current => {
            expect(current.debutCard).toEqual(DebutCard.Hidden())
          }),
        ),
      ),
    )

    it.effect('in a round the d-pad walks and moves no focus', () =>
      modelAfter(
        withPad(veteranFighting),
        steps(
          poll({ held: [DPAD_DOWN] }),
          s => s.expectNone(),
          send(Message.RepeatedPadDirection({ direction: 'Down' })),
          s => s.expectNone(),
        ),
      ),
    )
  })
})
