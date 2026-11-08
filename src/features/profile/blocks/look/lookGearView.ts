import { Function, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { PADLOCK_ICON } from '../../../../art/icons'
import { type Standing, sourceOf } from '../../../../domain/closet'
import type { CosmeticKind } from '../../../../shared/playerData'
import { iconView } from '../../../../ui/menuParts'
import { boneCountView, rankMarkView } from '../../../../ui/rankBadgeView'
import type { ClosetCueKind } from './model'

// The earned looks in the Look tab's rows: a hat, shirt color, print, or gun
// skin is worn (the selected one), owned (a pick wears it), for sale (a bone
// and the price on it; a pick tries it on, and the BUY pill buys it), or a gift not reached yet
// (dark, a padlock and the rank). Pictures and numbers only.

// NOTE: the spoken note of an option, which the screen reader hears after
// its name: what it is and what a pick does.
const NOTES: Readonly<Record<Standing, string>> = {
  Worn: 'worn',
  Owned: 'tap to wear',
  ForSale: 'for sale',
  Locked: 'locked',
}

export const gearNote: {
  (
    name: string,
    standing: Standing,
    isNew: boolean,
  ): (kind: CosmeticKind) => string
  (kind: CosmeticKind, name: string, standing: Standing, isNew: boolean): string
} = Function.dual(
  4,
  (
    kind: CosmeticKind,
    name: string,
    standing: Standing,
    isNew: boolean,
  ): string => {
    const source = sourceOf(kind, name)
    const note =
      standing === 'ForSale' && source.kind === 'Sold'
        ? `${source.price} Bones`
        : standing === 'Locked' && source.kind === 'Gift'
          ? `reach rank ${source.rank}`
          : NOTES[standing]
    return `${note}${isNew ? ', new' : ''}`
  },
)

// NOTE: the price or the padlock and rank, stuck to the foot of an option.
export const gearTagView: {
  <Message>(
    name: string,
    standing: Standing,
    h: HtmlBuilder<Message>,
  ): (kind: CosmeticKind) => Option.Option<Html>
  <Message>(
    kind: CosmeticKind,
    name: string,
    standing: Standing,
    h: HtmlBuilder<Message>,
  ): Option.Option<Html>
} = Function.dual(
  4,
  <Message>(
    kind: CosmeticKind,
    name: string,
    standing: Standing,
    h: HtmlBuilder<Message>,
  ): Option.Option<Html> => {
    const source = sourceOf(kind, name)
    return standing === 'ForSale' && source.kind === 'Sold'
      ? Option.some(
          h.span(
            [h.Class('look-tag'), h.AriaHidden(true)],
            [boneCountView(source.price, 'look-price', h)],
          ),
        )
      : standing === 'Locked' && source.kind === 'Gift'
        ? Option.some(
            h.span(
              [h.Class('look-tag look-need'), h.AriaHidden(true)],
              [
                iconView('look-lock-icon', PADLOCK_ICON, h),
                rankMarkView(source.rank, h),
              ],
            ),
          )
        : Option.none()
  },
)

// NOTE: the BUY pill by the figure while a look for sale is tried on: BUY,
// a bone, and the price. Short of Bones it is disabled and the price is red,
// the same red as a short price in the rows.
export const buyPillView: {
  <Message>(
    h: HtmlBuilder<Message>,
  ): (
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
  ) => Html
  <Message>(
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
    h: HtmlBuilder<Message>,
  ): Html
} = Function.dual(
  2,
  <Message>(
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
    h: HtmlBuilder<Message>,
  ): Html =>
    h.button(
      [
        h.Type('button'),
        h.Key('look-buy'),
        h.Class('look-buy'),
        h.AriaLabel(
          pill.isShort
            ? `Buy for ${pill.price} Bones, too few`
            : `Buy for ${pill.price} Bones`,
        ),
        ...(pill.isShort
          ? [h.Disabled(true), h.DataAttribute('short', 'true')]
          : [h.OnClick(pill.onClick)]),
      ],
      [
        h.span([h.Class('look-buy-word'), h.AriaHidden(true)], ['BUY']),
        boneCountView(pill.price, 'look-buy-price', h),
      ],
    ),
)

// NOTE: the attributes that play what a pick did (src/app/model.ts, ClosetCue)
// on the one option it was for. Only the count's parity is read, so the same
// cue twice in a row still plays.
export const cueAttributes: {
  <Message>(
    h: HtmlBuilder<Message>,
  ): (
    cue: Readonly<{ kind: ClosetCueKind; count: number }>,
  ) => ReadonlyArray<ReturnType<HtmlBuilder<Message>['DataAttribute']>>
  <Message>(
    cue: Readonly<{ kind: ClosetCueKind; count: number }>,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<ReturnType<HtmlBuilder<Message>['DataAttribute']>>
} = Function.dual(
  2,
  <Message>(
    cue: Readonly<{ kind: ClosetCueKind; count: number }>,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<ReturnType<HtmlBuilder<Message>['DataAttribute']>> =>
    cue.kind === 'Still'
      ? []
      : [
          h.DataAttribute('cue', cue.kind),
          h.DataAttribute('parity', `${cue.count % 2}`),
        ],
)
