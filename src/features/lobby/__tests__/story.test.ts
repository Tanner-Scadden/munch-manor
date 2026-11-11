import { Option, Tuple } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { defaultAppearance } from '../../../domain/clientSchema'
import { noModifiers } from '../../../world/run/modifiers'
import { PickOutcome } from '../../heroes/inMessage'
import { Message as HeroPickerMessage } from '../../heroes/message'
import { HeroDialogBinding, HeroPickerBinding } from '../bindings'
import { LobbyBlock } from '../block'
import { InMessage } from '../inMessage'
import { LobbyLayer } from '../layer'
import { Message, OutMessage } from '../message'
import { type LobbyPicks, isHeroPickerUp } from '../model'
import { FocusLobbyControl, FoldLobby } from '../steps'

// The single player lobby Block on its own: it opens on START, says each
// pick for the root to make, opens the hero picker in its Dialog, and plays
// the root's answer. The root's side (the picks kept, the run started, the
// bot rolled, the hero judged) is in lobby.story.test.ts.

const PICKS: LobbyPicks = {
  mode: 'Campaign',
  difficulty: { chosen: 'Normal', nightmare: 'Locked' },
  modifiers: noModifiers,
  bots: [],
  botSeats: 3,
}

const WITH_BOT: LobbyPicks = {
  ...PICKS,
  bots: [{ name: 'Gravy Dave', calling: 'You', look: defaultAppearance }],
}

const lobbyWith = (picks: LobbyPicks) => ({
  block: LobbyBlock,
  layer: LobbyLayer,
  updateContext: Tuple.make(picks),
  inMessageContext: Tuple.make(picks),
})

const LOBBY = lobbyWith(PICKS)

const focusStart = Story.Command.resolve(
  FocusLobbyControl({ control: 'Start' }),
  Message.CompletedFocusControl(),
)

const opened = Story.steps(
  Story.inMessage(InMessage.RequestedOpen()),
  focusStart,
)

const showHeroDialog = Story.Command.resolve(
  Dialog.test.ShowDialog,
  DialogBlock.Message.SucceededShowDialog(),
)

const closeHeroDialog = Story.Command.resolve(
  Dialog.test.CloseDialog,
  DialogBlock.Message.CompletedCloseDialog(),
)

const pressed = (code: string) =>
  Story.inMessage(InMessage.RequestedPressKey({ code }))

describe('the lobby Block', () => {
  it.effect('opens with START focused', () =>
    Story.story(
      LOBBY,
      Story.init(),
      Story.inMessage(InMessage.RequestedOpen()),
      Story.Command.expectExact(FocusLobbyControl({ control: 'Start' })),
      focusStart,
      Story.model(model => {
        expect(model.status).toBe('Open')
        expect(model.maybeFocus).toEqual(Option.some('Start'))
      }),
    ),
  )

  it.effect(
    'a mode tile says the mode for the root to make, and focuses START',
    () =>
      Story.story(
        LOBBY,
        Story.init(),
        opened,
        Story.message(Message.ClickedModeButton({ mode: 'Endless' })),
        Story.expectOutMessage(OutMessage.ChoseMode({ mode: 'Endless' })),
        focusStart,
      ),
  )

  it.effect('a locked Nightmare says nothing; X steps past it', () =>
    Story.story(
      LOBBY,
      Story.init(),
      opened,
      Story.message(
        Message.ClickedDifficultyButton({ difficulty: 'Nightmare' }),
      ),
      Story.expectNoOutMessage(),
      Story.Command.expectNone(),
      pressed('KeyX'),
      Story.expectOutMessage(
        OutMessage.ChoseDifficulty({ difficulty: 'Hard' }),
      ),
      focusStart,
    ),
  )

  it.effect('Friendly Fire waits for a bot in the crew', () =>
    Story.story(
      LOBBY,
      Story.init(),
      opened,
      Story.message(
        Message.ClickedModifierButton({ modifier: 'FriendlyFire' }),
      ),
      Story.expectNoOutMessage(),
      Story.message(Message.ClickedModifierButton({ modifier: 'Glass' })),
      Story.expectOutMessage(OutMessage.ToggledModifier({ modifier: 'Glass' })),
    ),
  )

  it.effect('with a bot seated, Friendly Fire turns on', () =>
    Story.story(
      lobbyWith(WITH_BOT),
      Story.init(),
      opened,
      Story.message(
        Message.ClickedModifierButton({ modifier: 'FriendlyFire' }),
      ),
      Story.expectOutMessage(
        OutMessage.ToggledModifier({ modifier: 'FriendlyFire' }),
      ),
    ),
  )

  it.effect('+ BOT and B ask the root for a bot, and focus START', () =>
    Story.story(
      LOBBY,
      Story.init(),
      opened,
      Story.message(Message.ClickedAddBotButton()),
      Story.expectOutMessage(OutMessage.ClickedAddBot()),
      focusStart,
      pressed('KeyB'),
      Story.expectOutMessage(OutMessage.ClickedAddBot()),
      focusStart,
    ),
  )

  it.effect(
    'Enter starts, closing the lobby at once, and Esc goes back, folding it away first',
    () =>
      Story.story(
        LOBBY,
        Story.init(),
        opened,
        pressed('Enter'),
        Story.expectOutMessage(OutMessage.Started()),
        Story.model(model => {
          expect(model.status).toBe('Closed')
        }),
        opened,
        pressed('Escape'),
        Story.expectOutMessage(OutMessage.Left()),
        Story.model(model => {
          expect(model.status).toBe('Folding')
        }),
        pressed('Enter'),
        Story.expectNoOutMessage(),
        Story.Command.resolve(FoldLobby(), Message.CompletedFold()),
        Story.model(model => {
          expect(model.status).toBe('Closed')
        }),
      ),
  )

  it.effect(
    'the hero card opens the picker in its Dialog and tells the root',
    () =>
      Story.story(
        LOBBY,
        Story.init(),
        opened,
        Story.message(Message.ClickedHeroButton()),
        Story.expectOutMessage(OutMessage.OpenedHeroPicker()),
        showHeroDialog,
        Story.model(model => {
          expect(isHeroPickerUp(model)).toBe(true)
          expect(model.heroPicker.status).toBe('Open')
        }),
        pressed('Enter'),
        Story.expectNoOutMessage(),
        Story.messageIn(
          HeroPickerBinding,
          HeroPickerMessage.ClickedCard({ calling: 'Handyman' }),
        ),
        Story.expectOutMessage(
          OutMessage.PickedHero({
            calling: 'Handyman',
            maybeBot: Option.none(),
          }),
        ),
      ),
  )

  it.effect('a hero worn closes the picker and its Dialog', () =>
    Story.story(
      LOBBY,
      Story.init(),
      opened,
      pressed('KeyY'),
      Story.expectOutMessage(OutMessage.OpenedHeroPicker()),
      showHeroDialog,
      Story.inMessage(
        InMessage.InformedOfHeroOutcome({
          outcome: PickOutcome.Worn({ calling: 'Handyman' }),
        }),
      ),
      closeHeroDialog,
      Story.model(model => {
        expect(isHeroPickerUp(model)).toBe(false)
        expect(model.status).toBe('Open')
      }),
    ),
  )

  it.effect(
    "a bot's card chooses for that bot, and BUY only ends its try-on",
    () =>
      Story.story(
        lobbyWith(WITH_BOT),
        Story.init(),
        opened,
        Story.message(Message.ClickedBotHeroButton({ index: 0 })),
        Story.expectOutMessage(OutMessage.OpenedHeroPicker()),
        showHeroDialog,
        Story.messageIn(
          HeroPickerBinding,
          HeroPickerMessage.ClickedCard({ calling: 'LineCook' }),
        ),
        Story.expectOutMessage(
          OutMessage.PickedHero({
            calling: 'LineCook',
            maybeBot: Option.some(0),
          }),
        ),
        Story.inMessage(
          InMessage.InformedOfHeroOutcome({
            outcome: PickOutcome.TriedOn({ calling: 'LineCook' }),
          }),
        ),
        Story.messageIn(
          HeroPickerBinding,
          HeroPickerMessage.ClickedBuyButton(),
        ),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.heroPicker.maybeTrying).toEqual(Option.none())
        }),
      ),
  )

  it.effect('the Dialog closing closes the picker and forgets the bot', () =>
    Story.story(
      lobbyWith(WITH_BOT),
      Story.init(),
      opened,
      Story.message(Message.ClickedBotHeroButton({ index: 0 })),
      showHeroDialog,
      Story.messageIn(HeroDialogBinding, DialogBlock.Message.CanceledDialog()),
      closeHeroDialog,
      Story.model(model => {
        expect(model.heroPicker.status).toBe('Closed')
        expect(model.maybePickingBot).toEqual(Option.none())
        expect(isHeroPickerUp(model)).toBe(false)
      }),
    ),
  )
})
