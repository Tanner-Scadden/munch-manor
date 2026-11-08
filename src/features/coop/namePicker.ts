import { Function, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { closeButtonView } from '../../app/dialogs'
import { DICE_ICON } from '../../art/icons'
import { iconView } from '../menus/menuParts'
import { DEFAULT_NAME, MAX_NAME_LENGTH } from '../profile/profile'
import { PENCIL_ICON } from './icons'
import { Message } from './message'
import type { Room } from './model'
import { NAME_BUTTON_ID, NAME_INPUT_ID, isInLobby } from './roomState'

// Your own name in co-op's lobby is a button with a pencil, and a tap opens
// this small field over the lobby: the Profile's name rules and dice
// (src/features/profile/profile.ts). Enter or OK keeps it, Esc or the X leaves it as it was.

export const nameButtonView: {
  (h: HtmlBuilder<Message>): (name: string) => Html
  (name: string, h: HtmlBuilder<Message>): Html
} = Function.dual(2, (name: string, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(NAME_BUTTON_ID),
      h.Class('coop-name-button'),
      h.AriaLabel(`Your name: ${name}. Change it`),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedNameButton()),
    ],
    [
      h.span([h.Class('coop-nameplate'), h.AriaHidden(true)], [name]),
      iconView('coop-name-pencil', PENCIL_ICON, h),
    ],
  ),
)

// NOTE: over the top of the lobby, not centered, so a phone's keyboard in
// landscape leaves it in sight. The field is 16 px or more, or iOS zooms.
export const namePickerView: {
  (h: HtmlBuilder<Message>): (room: Room) => Html
  (room: Room, h: HtmlBuilder<Message>): Html
} = Function.dual(2, (room: Room, h: HtmlBuilder<Message>): Html =>
  Option.match(room.maybeNameDraft, {
    onNone: () => h.empty,
    onSome: draft =>
      isInLobby(room)
        ? h.form(
            [
              h.Class('coop-name-picker'),
              h.Role('dialog'),
              h.AriaModal(true),
              h.AriaLabel('Your name'),
              h.OnSubmit(Message.SubmittedName()),
            ],
            [
              h.div(
                [h.Class('coop-calling-picker-head')],
                [
                  h.span([h.Class('coop-calling-picker-title')], ['Your name']),
                  closeButtonView(
                    {
                      attributes: [h.OnClick(Message.ClickedNameCancel())],
                      className: 'coop-close',
                      label: 'Cancel',
                    },
                    h,
                  ),
                ],
              ),
              h.div(
                [h.Class('coop-name-entry')],
                [
                  h.input([
                    h.Id(NAME_INPUT_ID),
                    h.Class('coop-name-input'),
                    h.AriaLabel('Your name'),
                    h.Type('text'),
                    h.Name('name'),
                    h.Value(draft),
                    h.Placeholder(DEFAULT_NAME),
                    h.Maxlength(MAX_NAME_LENGTH),
                    h.Autocomplete('off'),
                    h.Autocapitalize('words'),
                    h.Spellcheck(false),
                    h.EnterKeyHint('done'),
                    h.OnInput(value => Message.UpdatedNameDraft({ value })),
                    h.OnKeyDownPreventDefault(key =>
                      key === 'Escape'
                        ? Option.some(Message.ClickedNameCancel())
                        : Option.none(),
                    ),
                  ]),
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('coop-name-dice'),
                      h.AriaLabel('Roll a goofy name'),
                      h.OnClick(Message.ClickedNameDice()),
                    ],
                    [iconView('coop-name-dice-icon', DICE_ICON, h)],
                  ),
                  h.button(
                    [
                      h.Type('submit'),
                      h.Class('coop-go coop-name-ok'),
                      h.AriaLabel('Save name'),
                    ],
                    [h.span([], ['OK'])],
                  ),
                ],
              ),
            ],
          )
        : h.empty,
  }),
)
