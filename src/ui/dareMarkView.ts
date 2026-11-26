import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { markIcon } from '../art/markArt'
import { iconView } from './menuParts'

// The parts of the dare ladder's pick that the single player lobby
// (src/features/lobby/view.ts) and the co-op lobby
// (src/features/coop/picksView.ts) share: the mark's seal and its number.
// Each lobby builds its own button, as it does Dare's break clock. A press
// steps to the next mark opened, round to none (nextMarkOf in
// src/domain/dareMarks.ts).

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

// NOTE: a mark's seal alone, small, beside a name: the Proof Shelf's row
// and the co-op host's seat. Mark 0 shows nothing.
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
