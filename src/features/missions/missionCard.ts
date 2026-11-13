import { Array, Function } from 'effect'
import type { Html } from 'foldkit/html'

import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from '../../app/composition'
import type { Model } from '../../app/model'
import { DICE_ICON } from '../../art/icons'
import {
  ALL_THREE_ICON,
  MISSION_DONE_ICON,
  MISSION_ICONS,
} from '../../art/missionIcons'
import { ALL_THREE_BONES } from '../../shared/missionData'
import { iconView, percentOf } from '../../ui/menuParts'
import { boneCountView } from '../../ui/rankBadgeView'
import { ALL_THREE_TAG, MISSIONS_TITLE, MISSION_NAMES } from '../../world/names'
import { MissionMessage } from './message'
import { type MissionRow, isAllThreeDone, missionRowsOf } from './missions'

// The day's missions on the home menu: a card of their three pictures with
// a bar under each, which opens the panel of rows, each with its name, its
// bar, its Bones, and the day's one reroll. Show, don't explain: the card
// is pictures and bars, its words only for a screen reader.

const rowLabel = (row: MissionRow): string =>
  row.isDone
    ? `${MISSION_NAMES[row.mission]}: done`
    : `${MISSION_NAMES[row.mission]}: ${row.count} of ${row.goal}`

const barView = (row: MissionRow, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('mission-bar'), h.AriaHidden(true)],
    [
      h.span([
        h.Class('mission-bar-fill'),
        h.Style({ width: percentOf(row.count, Math.max(1, row.goal)) }),
      ]),
    ],
  )

// NOTE: a mission's picture, a check over it once done.
const pictureView = (
  row: MissionRow,
  className: string,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class(`${className} mission-picture`)],
    [
      iconView('mission-icon', MISSION_ICONS[row.mission], h),
      ...(row.isDone ? [iconView('mission-check', MISSION_DONE_ICON, h)] : []),
    ],
  )

// CARD

const pipView = (row: MissionRow, h: ApplicationViewBuilder): Html =>
  h.span(
    [
      h.Class('mission-pip'),
      h.DataAttribute('done', row.isDone ? 'true' : 'false'),
    ],
    [pictureView(row, 'mission-pip-picture', h), barView(row, h)],
  )

// NOTE: the home card. The screen hands it the attributes every home button
// wears (its id, key, and focus), as only the home screen knows them.
export const missionCardView: {
  (
    attributes: ReadonlyArray<ApplicationAttribute>,
    keyCap: ReadonlyArray<Html>,
    h: ApplicationViewBuilder,
  ): (model: Model) => Html
  (
    model: Model,
    attributes: ReadonlyArray<ApplicationAttribute>,
    keyCap: ReadonlyArray<Html>,
    h: ApplicationViewBuilder,
  ): Html
} = Function.dual(
  4,
  (
    model: Model,
    attributes: ReadonlyArray<ApplicationAttribute>,
    keyCap: ReadonlyArray<Html>,
    h: ApplicationViewBuilder,
  ): Html =>
    Array.match(missionRowsOf(model), {
      onEmpty: () => h.empty,
      onNonEmpty: rows =>
        h.button(
          [
            ...attributes,
            h.Class('mission-card'),
            h.DataAttribute('all', isAllThreeDone(model) ? 'true' : 'false'),
            h.AriaLabel(
              `${MISSIONS_TITLE}: ${Array.join(Array.map(rows, rowLabel), ', ')}`,
            ),
            h.AriaHasPopup('dialog'),
            h.OnClick(MissionMessage.ClickedMissionsButton(), {
              propagation: 'Stop',
            }),
          ],
          [
            ...Array.map(rows, row => pipView(row, h)),
            iconView('mission-card-all', ALL_THREE_ICON, h),
            ...keyCap,
          ],
        ),
    }),
)

// PANEL

export const missionsText = (
  model: Model,
): Readonly<{ title: string; blurb: string }> => ({
  title: MISSIONS_TITLE,
  blurb: isAllThreeDone(model)
    ? 'All three done. New ones tomorrow.'
    : 'Three a day, new each day. One free reroll.',
})

const bonesView = (
  bones: number,
  className: string,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class(className)],
    [
      h.span([h.AriaHidden(true)], ['+']),
      boneCountView(bones, 'mission-bones-count', h),
      h.span([h.Class('sr-only')], [`${bones} Bones`]),
    ],
  )

// NOTE: the day's one reroll, on a mission not done yet. Once spent, every
// dice greys out until tomorrow.
const rerollView = (row: MissionRow, h: ApplicationViewBuilder): Html =>
  row.isDone
    ? h.span([h.Class('mission-reroll-gap'), h.AriaHidden(true)])
    : h.button(
        [
          h.Type('button'),
          h.Class('mission-reroll'),
          ...(row.canReroll ? [] : [h.AriaDisabled(true)]),
          h.AriaLabel(`Reroll ${MISSION_NAMES[row.mission]}`),
          h.OnClick(MissionMessage.ClickedRerollButton({ slot: row.slot }), {
            propagation: 'Stop',
          }),
        ],
        [iconView('mission-reroll-icon', DICE_ICON, h)],
      )

const rowView = (row: MissionRow, h: ApplicationViewBuilder): Html =>
  h.li(
    [
      h.Class('mission-row'),
      h.DataAttribute('done', row.isDone ? 'true' : 'false'),
    ],
    [
      pictureView(row, 'mission-row-picture', h),
      h.span(
        [h.Class('mission-row-main')],
        [
          h.span([h.Class('mission-row-name')], [MISSION_NAMES[row.mission]]),
          h.span(
            [h.Class('mission-row-track')],
            [
              barView(row, h),
              h.span(
                [h.Class('mission-row-count'), h.AriaHidden(true)],
                [`${row.count}/${row.goal}`],
              ),
            ],
          ),
        ],
      ),
      bonesView(row.bones, 'mission-row-bones', h),
      rerollView(row, h),
    ],
  )

export const missionsPanelView: {
  (doneButton: Html, h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, doneButton: Html, h: ApplicationViewBuilder): Html
} = Function.dual(
  3,
  (model: Model, doneButton: Html, h: ApplicationViewBuilder): Html =>
    h.div(
      [h.Class('missions-panel')],
      [
        h.ul(
          [h.Class('mission-rows')],
          Array.map(missionRowsOf(model), row => rowView(row, h)),
        ),
        h.p(
          [
            h.Class('mission-all'),
            h.DataAttribute('done', isAllThreeDone(model) ? 'true' : 'false'),
          ],
          [
            iconView('mission-all-icon', ALL_THREE_ICON, h),
            h.span([h.Class('mission-all-tag')], [ALL_THREE_TAG]),
            bonesView(ALL_THREE_BONES, 'mission-all-bones', h),
          ],
        ),
        h.div([h.Class('panel-actions')], [doneButton]),
      ],
    ),
)
