import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  CALLINGS,
  UNLOCK_RANKS,
  callingPriceOf,
  callingStandingOf,
} from './calling'
import { type Special, specialsNoteOf, specialsOf } from './callingSpecials'
import { portraitOf } from './coop/icons'
import { PADLOCK_ICON } from './icons'
import { newBadgeView } from './lookGearView'
import { iconView } from './menuParts'
import type { Appearance } from './model'
import { CALLING_NAMES, SPECIAL_LINES } from './names'
import type { Calling, SavedBoughtCosmetics } from './playerData'
import { boneCountView, rankMarkView } from './rankBadgeView'
import { callingUnlockId } from './unlocks'

// The picker's cards, one per hero (GAME_DESIGN.md, "Rank and Bones"),
// shared by the home menu's picker and co-op's lobby picker: the player's own
// look wearing the hero's prop, its name, and each special as a picture
// with a short line, perks in green with a plus and drawbacks in red with a
// minus. A locked card shows the same lines dimmed, with the padlock and the
// rank that opens it, so a player knows what they are working toward. A
// card for sale (its rank reached, not bought) shows its price in Bones.

type ButtonAttributes<Message> = Parameters<HtmlBuilder<Message>['button']>[0]

export type CardsInput<Message> = Readonly<{
  look: Appearance
  chosen: Calling
  rank: number
  // NOTE: the heroes bought (the save's bought ids), and the one for sale
  // being tried on.
  bought: SavedBoughtCosmetics
  maybeTrying: Option.Option<Calling>
  // NOTE: the unlock ids that wear a NEW badge (src/unlocks.ts).
  fresh: ReadonlyArray<string>
  // NOTE: what the caller adds to a card: its click, and the initial focus
  // on the chosen one.
  attributesOf: (
    calling: Calling,
    isChosen: boolean,
  ) => ButtonAttributes<Message>
}>

const specialView = <Message>(
  special: Special,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [
      h.Class('calling-special'),
      h.DataAttribute('sign', special.isPerk ? 'Perk' : 'Drawback'),
    ],
    [
      iconView('calling-special-icon', special.art, h),
      h.span(
        [h.Class('calling-special-sign'), h.AriaHidden(true)],
        [special.isPerk ? '+' : '-'],
      ),
      h.span([h.Class('calling-special-line')], [special.line]),
    ],
  )

const cardView = <Message>(
  input: CardsInput<Message>,
  calling: Calling,
  h: HtmlBuilder<Message>,
): Html => {
  const standing = callingStandingOf(calling, input.rank, input.bought)
  const isTrying = Option.exists(
    input.maybeTrying,
    trying => trying === calling,
  )
  const isChosen = calling === input.chosen
  const need = UNLOCK_RANKS[calling]
  const specials = specialsOf(calling)
  const isNew = Array.contains(input.fresh, callingUnlockId(calling))
  return h.button(
    [
      ...input.attributesOf(calling, isChosen),
      h.Type('button'),
      h.Class('calling-card'),
      h.DataAttribute('calling', calling),
      h.DataAttribute('lock', standing),
      ...(isTrying ? [h.DataAttribute('trying', 'true')] : []),
      ...(isChosen ? [h.DataAttribute('chosen', 'Chosen')] : []),
      ...(isNew ? [h.DataAttribute('new', 'true')] : []),
      h.AriaLabel(
        standing === 'Owned'
          ? `${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}`
          : standing === 'ForSale'
            ? `${CALLING_NAMES[calling]}, for sale, ${Option.getOrElse(callingPriceOf(calling), () => 0)} Bones. ${specialsNoteOf(calling)}`
            : `${CALLING_NAMES[calling]}, locked. Reach rank ${need} to unlock. ${specialsNoteOf(calling)}`,
      ),
      ...(standing === 'Locked' ? [h.AriaDisabled(true)] : []),
    ],
    [
      h.span(
        [h.Class('calling-figure'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('calling-figure-img'),
            h.Style({ backgroundImage: portraitOf(input.look, calling) }),
          ]),
        ],
      ),
      h.span(
        [h.Class('calling-body'), h.AriaHidden(true)],
        [
          h.span(
            [h.Class('calling-head')],
            [
              h.span([h.Class('calling-name')], [CALLING_NAMES[calling]]),
              ...(isNew ? [newBadgeView(h)] : []),
              standing === 'Owned'
                ? h.empty
                : h.span(
                    [h.Class('calling-need')],
                    standing === 'ForSale'
                      ? [
                          boneCountView(
                            Option.getOrElse(callingPriceOf(calling), () => 0),
                            'calling-price',
                            h,
                          ),
                        ]
                      : [
                          iconView('calling-lock-icon', PADLOCK_ICON, h),
                          rankMarkView(need, h),
                        ],
                  ),
            ],
          ),
          h.ul(
            [h.Class('calling-specials')],
            Array.isReadonlyArrayEmpty(specials)
              ? [
                  h.li(
                    [h.Class('calling-special calling-special-none')],
                    [SPECIAL_LINES.noSpecials],
                  ),
                ]
              : Array.map(specials, special => specialView(special, h)),
          ),
        ],
      ),
    ],
  )
}

export const callingCardsView = <Message>(
  input: CardsInput<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('calling-cards')],
    Array.map(CALLINGS, calling => cardView(input, calling, h)),
  )
