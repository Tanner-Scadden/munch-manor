import { Function } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

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
  <Message>(h: HtmlBuilder<Message>): (mark: number) => ReadonlyArray<Html>
  <Message>(mark: number, h: HtmlBuilder<Message>): ReadonlyArray<Html>
} = Function.dual(
  2,
  <Message>(mark: number, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
    iconView('coop-pick-icon dare-mark-icon', markIcon(mark), h),
    h.span(
      [h.Class('dare-mark-value'), h.AriaHidden(true)],
      [mark > 0 ? `${mark}` : '-'],
    ),
  ],
)

// NOTE: a mark's seal alone, small, beside a name: the Proof Shelf's row
// and the co-op host's seat. Mark 0 shows nothing.
export const dareMarkBadgeView: {
  <Message>(
    className: string,
    h: HtmlBuilder<Message>,
  ): (mark: number) => ReadonlyArray<Html>
  <Message>(
    mark: number,
    className: string,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<Html>
} = Function.dual(
  3,
  <Message>(
    mark: number,
    className: string,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<Html> =>
    mark > 0
      ? [
          h.span(
            [
              h.Class(`dare-mark-badge ${className}`),
              h.DataAttribute('mark', `${mark}`),
              h.Role('img'),
              h.AriaLabel(dareMarkLabel(mark)),
            ],
            [iconView('dare-mark-badge-icon', markIcon(mark), h)],
          ),
        ]
      : [],
)
