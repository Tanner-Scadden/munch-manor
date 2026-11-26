import { Function, Option } from 'effect'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import { PENCIL_ICON } from '#art/icons/coopIcons.ts'
import { DICE_ICON } from '#art/icons/icons.ts'
import { type Room, isInLobby } from '#domain/coopRoom.ts'
import { DEFAULT_NAME, MAX_NAME_LENGTH } from '#domain/playerName.ts'
import { CoopMessage } from '#features/coop/message.ts'
import {
  NAME_BUTTON,
  NAME_BUTTON_ID,
  NAME_INPUT,
  NAME_INPUT_ID,
} from '#features/coop/roomState.ts'
import { closeButtonView } from '#ui/cornerButtons.ts'
import { iconView } from '#ui/menuParts.ts'

export const nameButtonView: {
  (h: ApplicationViewBuilder): (name: string) => ApplicationHtml
  (name: string, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (name: string, h: ApplicationViewBuilder): ApplicationHtml =>
    h.button
      .attr('type', 'button')
      .id(NAME_BUTTON_ID)
      .ref(NAME_BUTTON)
      .class('coop-name-button')
      .attr('aria-label', `Your name: ${name}. Change it`)
      .attr('aria-haspopup', 'dialog')
      .on('click', CoopMessage.ClickedCoopNameButton())
      .children(
        h.span
          .class('coop-nameplate')
          .attr('aria-hidden', 'true')
          .children(name),
        iconView('coop-name-pencil', PENCIL_ICON, h),
      ),
)

export const namePickerView: {
  (h: ApplicationViewBuilder): (room: Room) => ApplicationHtml | null
  (room: Room, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (room: Room, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Option.match(room.maybeNameDraft, {
      onNone: () => null,
      onSome: draft =>
        !isInLobby(room)
          ? null
          : h.form
              .class('coop-name-picker')
              .attrs({
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': 'Your name',
              })
              .on('submit', CoopMessage.SubmittedCoopName())
              .children(
                h.div.class('coop-calling-picker-head').children(
                  h.span
                    .class('coop-calling-picker-title')
                    .children('Your name'),
                  closeButtonView(
                    {
                      button: h.button.on(
                        'click',
                        CoopMessage.ClickedCoopNameCancel(),
                      ),
                      className: 'coop-close',
                      label: 'Cancel',
                    },
                    h,
                  ),
                ),
                h.div.class('coop-name-entry').children(
                  h.input
                    .id(NAME_INPUT_ID)
                    .ref(NAME_INPUT)
                    .class('coop-name-input')
                    .attrs({
                      'aria-label': 'Your name',
                      type: 'text',
                      name: 'name',
                      placeholder: DEFAULT_NAME,
                      maxlength: String(MAX_NAME_LENGTH),
                      autocomplete: 'off',
                      autocapitalize: 'words',
                      spellcheck: 'false',
                      enterkeyhint: 'done',
                    })
                    .value(draft)
                    .on('input', ({ value }) =>
                      CoopMessage.UpdatedCoopNameDraft({ value }),
                    )
                    .on(
                      'keydown',
                      ({ key }) =>
                        key === 'Escape'
                          ? CoopMessage.ClickedCoopNameCancel()
                          : undefined,
                      { preventDefault: true },
                    ),
                  h.button
                    .attr('type', 'button')
                    .class('coop-name-dice')
                    .attr('aria-label', 'Roll a goofy name')
                    .on('click', CoopMessage.ClickedCoopNameDice())
                    .children(iconView('coop-name-dice-icon', DICE_ICON, h)),
                  h.button
                    .attr('type', 'submit')
                    .class('coop-go coop-name-ok')
                    .attr('aria-label', 'Save name')
                    .children(h.span.children('OK')),
                ),
              ),
    }),
)
