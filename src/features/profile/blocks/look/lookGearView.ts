import { Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { PADLOCK_ICON } from '#art/icons/icons.ts'
import { type Standing, sourceOf } from '#domain/closet.ts'
import type { CosmeticKind } from '#shared/records/playerData.ts'
import { iconView } from '#ui/menuParts.ts'
import { boneCountView, rankMarkView } from '#ui/rankBadgeView.ts'

import type { ClosetCueKind } from './model.ts'

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

export const cueAttrs = (
  cue: Readonly<{ kind: ClosetCueKind; count: number }>,
): Readonly<Record<string, string | undefined>> =>
  cue.kind === 'Still'
    ? { 'data-cue': undefined, 'data-parity': undefined }
    : { 'data-cue': cue.kind, 'data-parity': `${cue.count % 2}` }
