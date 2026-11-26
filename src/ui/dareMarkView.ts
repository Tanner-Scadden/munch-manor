import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { markIcon } from '#art/markArt.ts'

import { iconView } from './menuParts.ts'

export const dareMarkLabel = (mark: number): string =>
  mark > 0 ? `Dare mark ${mark}` : 'Dare mark: none'

export const dareMarkFaceView: {
  <Message>(
    h: Html.H<Message>,
  ): (mark: number) => ReadonlyArray<View.Content<Message>>
  <Message>(
    mark: number,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  2,
  <Message>(
    mark: number,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> => [
    iconView('coop-pick-icon dare-mark-icon', markIcon(mark), h),
    h.span
      .class('dare-mark-value')
      .attr('aria-hidden', 'true')
      .children(mark > 0 ? `${mark}` : '-'),
  ],
)

export const dareMarkBadgeView: {
  <Message>(
    className: string,
    h: Html.H<Message>,
  ): (mark: number) => ReadonlyArray<View.Content<Message>>
  <Message>(
    mark: number,
    className: string,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  3,
  <Message>(
    mark: number,
    className: string,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> =>
    mark > 0
      ? [
          h.span
            .class(`dare-mark-badge ${className}`)
            .attr('data-mark', `${mark}`)
            .attr('role', 'img')
            .attr('aria-label', dareMarkLabel(mark))
            .children(iconView('dare-mark-badge-icon', markIcon(mark), h)),
        ]
      : [],
)
