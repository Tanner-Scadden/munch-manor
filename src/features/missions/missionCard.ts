import { Array, Function } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import { DICE_ICON } from '#art/icons.ts'
import {
  ALL_THREE_ICON,
  MISSION_DONE_ICON,
  MISSION_ICONS,
} from '#art/missionIcons.ts'
import { ALL_THREE_BONES } from '#shared/missionData.ts'
import { iconView, percentOf } from '#ui/menuParts.ts'
import { boneCountView } from '#ui/rankBadgeView.ts'
import { ALL_THREE_TAG, MISSIONS_TITLE, MISSION_NAMES } from '#world/names.ts'

import { MissionMessage } from './message.ts'
import { type MissionRow, isAllThreeDone, missionRowsOf } from './missions.ts'

const rowLabel = (row: MissionRow): string =>
  row.isDone
    ? `${MISSION_NAMES[row.mission]}: done`
    : `${MISSION_NAMES[row.mission]}: ${row.count} of ${row.goal}`

const barView = (row: MissionRow, h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('mission-bar')
    .attr('aria-hidden', 'true')
    .children(
      h.span
        .class('mission-bar-fill')
        .style({ width: percentOf(row.count, Math.max(1, row.goal)) }),
    )

const pictureView = (
  row: MissionRow,
  className: string,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span
    .class(`${className} mission-picture`)
    .children(
      iconView('mission-icon', MISSION_ICONS[row.mission], h),
      ...(row.isDone ? [iconView('mission-check', MISSION_DONE_ICON, h)] : []),
    )

const pipView = (row: MissionRow, h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('mission-pip')
    .attr('data-done', row.isDone ? 'true' : 'false')
    .children(pictureView(row, 'mission-pip-picture', h), barView(row, h))

type CardButton = ReturnType<ApplicationViewBuilder['button']['attr']>

export const missionCardView: {
  (
    button: CardButton,
    keyCap: ReadonlyArray<ApplicationHtml>,
    h: ApplicationViewBuilder,
  ): (model: Model) => ApplicationHtml | null
  (
    model: Model,
    button: CardButton,
    keyCap: ReadonlyArray<ApplicationHtml>,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null
} = Function.dual(
  4,
  (
    model: Model,
    button: CardButton,
    keyCap: ReadonlyArray<ApplicationHtml>,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null =>
    Array.match(missionRowsOf(model), {
      onEmpty: () => null,
      onNonEmpty: rows =>
        button
          .attr('data-all', isAllThreeDone(model) ? 'true' : 'false')
          .class('mission-card')
          .attr(
            'aria-label',
            `${MISSIONS_TITLE}: ${Array.join(Array.map(rows, rowLabel), ', ')}`,
          )
          .attr('aria-haspopup', 'dialog')
          .on('click', MissionMessage.ClickedMissionsButton())
          .children(
            ...Array.map(rows, row => pipView(row, h)),
            iconView('mission-card-all', ALL_THREE_ICON, h),
            ...keyCap,
          ),
    }),
)

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
): ApplicationHtml =>
  h.span
    .class(className)
    .children(
      h.span.attr('aria-hidden', 'true').children('+'),
      boneCountView(bones, 'mission-bones-count', h),
      h.span.class('sr-only').children(`${bones} Bones`),
    )

const rerollView = (
  row: MissionRow,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  row.isDone
    ? h.span.class('mission-reroll-gap').attr('aria-hidden', 'true')
    : h.button
        .attr('type', 'button')
        .class('mission-reroll')
        .attr('aria-disabled', row.canReroll ? undefined : 'true')
        .attr('aria-label', `Reroll ${MISSION_NAMES[row.mission]}`)
        .on('click', MissionMessage.ClickedRerollButton({ slot: row.slot }))
        .children(iconView('mission-reroll-icon', DICE_ICON, h))

const rowView = (row: MissionRow, h: ApplicationViewBuilder): ApplicationHtml =>
  h.li
    .class('mission-row')
    .attr('data-done', row.isDone ? 'true' : 'false')
    .children(
      pictureView(row, 'mission-row-picture', h),
      h.span
        .class('mission-row-main')
        .children(
          h.span.class('mission-row-name').children(MISSION_NAMES[row.mission]),
          h.span
            .class('mission-row-track')
            .children(
              barView(row, h),
              h.span
                .class('mission-row-count')
                .attr('aria-hidden', 'true')
                .children(`${row.count}/${row.goal}`),
            ),
        ),
      bonesView(row.bones, 'mission-row-bones', h),
      rerollView(row, h),
    )

export const missionsPanelView: {
  (
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): (model: Model) => ApplicationHtml
  (
    model: Model,
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): ApplicationHtml
} = Function.dual(
  3,
  (
    model: Model,
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): ApplicationHtml =>
    h.div.class('missions-panel').children(
      h.ul
        .class('mission-rows')
        .children(Array.map(missionRowsOf(model), row => rowView(row, h))),
      h.p
        .class('mission-all')
        .attr('data-done', isAllThreeDone(model) ? 'true' : 'false')
        .children(
          iconView('mission-all-icon', ALL_THREE_ICON, h),
          h.span.class('mission-all-tag').children(ALL_THREE_TAG),
          bonesView(ALL_THREE_BONES, 'mission-all-bones', h),
        ),
      h.div.class('panel-actions').children(doneButton),
    ),
)
