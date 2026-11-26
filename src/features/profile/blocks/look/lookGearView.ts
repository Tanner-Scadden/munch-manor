import { Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

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
    h: Html.H<Message>,
  ): (kind: CosmeticKind) => Option.Option<View.Content<Message>>
  <Message>(
    kind: CosmeticKind,
    name: string,
    standing: Standing,
    h: Html.H<Message>,
  ): Option.Option<View.Content<Message>>
} = Function.dual(
  4,
  <Message>(
    kind: CosmeticKind,
    name: string,
    standing: Standing,
    h: Html.H<Message>,
  ): Option.Option<View.Content<Message>> => {
    const source = sourceOf(kind, name)
    return standing === 'ForSale' && source.kind === 'Sold'
      ? Option.some(
          h.span
            .class('look-tag')
            .attr('aria-hidden', 'true')
            .children(boneCountView(source.price, 'look-price', h)),
        )
      : standing === 'Locked' && source.kind === 'Gift'
        ? Option.some(
            h.span
              .class('look-tag look-need')
              .attr('aria-hidden', 'true')
              .children(
                iconView('look-lock-icon', PADLOCK_ICON, h),
                rankMarkView(source.rank, h),
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
    h: Html.H<Message>,
  ): (
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
  ) => View.Content<Message>
  <Message>(
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  2,
  <Message>(
    pill: Readonly<{ price: number; isShort: boolean; onClick: Message }>,
    h: Html.H<Message>,
  ): View.Content<Message> => {
    const button = h.button
      .attrs({
        type: 'button',
        'aria-label': pill.isShort
          ? `Buy for ${pill.price} Bones, too few`
          : `Buy for ${pill.price} Bones`,
      })
      .key('look-buy')
      .class('look-buy')
    return (
      pill.isShort
        ? button.disabled(true).attr('data-short', 'true')
        : button.on('click', pill.onClick)
    ).children(
      h.span.class('look-buy-word').attr('aria-hidden', 'true').children('BUY'),
      boneCountView(pill.price, 'look-buy-price', h),
    )
  },
)

// NOTE: the attributes that play what a pick did (ClosetCue, in this
// folder's model.ts) on the one option it was for, for its builder's
// `attrs`. Only the count's parity is read, so the same cue twice in a row
// still plays; a still cue writes neither.
export const cueAttrs = (
  cue: Readonly<{ kind: ClosetCueKind; count: number }>,
): Readonly<Record<string, string | undefined>> =>
  cue.kind === 'Still'
    ? { 'data-cue': undefined, 'data-parity': undefined }
    : { 'data-cue': cue.kind, 'data-parity': `${cue.count % 2}` }
