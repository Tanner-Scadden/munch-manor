import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { PROP_ICONS } from '../callingArt'
import { callingCardsView } from '../callingCards'
import { specialsNoteOf } from '../callingSpecials'
import { closeButtonView } from '../dialogs'
import { iconView } from '../menuParts'
import type { Appearance } from '../model'
import { CALLING_NAMES } from '../names'
import type { SavedBoughtCosmetics } from '../playerData'
import { callingOfMember } from './looks'
import { Message } from './message'
import type { Room } from './model'
import { CALLING_PILL_ID, isInLobby, meIn } from './roomState'

// The hero pill in co-op's lobby, beside the mode and difficulty picks,
// and the picker it opens: the home menu's cards (src/callingCards.ts) for
// the player's own seat, so a hero can change while the room waits.
// Every member has one, as the host alone picks the mode and difficulty.

export const callingPillView = (
  room: Room,
  keyCap: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(meIn(room), {
    onNone: () => h.empty,
    onSome: me => {
      const calling = callingOfMember(me)
      return h.button(
        [
          h.Type('button'),
          h.Id(CALLING_PILL_ID),
          h.Class('coop-pick coop-calling-pill'),
          h.DataAttribute('calling', calling),
          h.AriaLabel(
            `Hero: ${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}. Change it`,
          ),
          h.AriaHasPopup('dialog'),
          h.AriaExpanded(room.isPickingCalling),
          h.AriaKeyshortcuts('Y'),
          h.OnClick(Message.ClickedCallingPill()),
        ],
        [iconView('coop-calling-pill-icon', PROP_ICONS[calling], h), ...keyCap],
      )
    },
  })

// NOTE: over the lobby while the pill is open and the room still waits. A
// card the player's rank has not reached stays shut with the rank it needs.
export const callingPickerView = (
  room: Room,
  look: Appearance,
  bought: SavedBoughtCosmetics,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(meIn(room), {
    onNone: () => h.empty,
    onSome: me =>
      room.isPickingCalling && isInLobby(room)
        ? h.div(
            [
              h.Class('coop-calling-picker'),
              h.Role('dialog'),
              h.AriaModal(true),
              h.AriaLabel('Hero'),
            ],
            [
              h.div(
                [h.Class('coop-calling-picker-head')],
                [
                  h.span([h.Class('coop-calling-picker-title')], ['Hero']),
                  closeButtonView(
                    {
                      attributes: [h.OnClick(Message.ClickedCallingDone())],
                      className: 'coop-close',
                      label: 'Close',
                    },
                    h,
                  ),
                ],
              ),
              callingCardsView(
                {
                  look,
                  chosen: callingOfMember(me),
                  rank: me.rank,
                  bought,
                  maybeTrying: Option.none(),
                  fresh: [],
                  attributesOf: calling => [
                    h.OnClick(Message.ClickedCallingPick({ calling })),
                  ],
                },
                h,
              ),
            ],
          )
        : h.empty,
  })
