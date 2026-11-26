import { Array, Function, Option, Record } from 'effect'

import { Message, type Model, type StudioH, type StudioHtml } from './block'
import {
  CONTROLS,
  type Control,
  GROUPS,
  SHIPPED_TABLES,
  changesOf,
  formatValue,
  inputTextOf,
  valueOf,
} from './lab'

const controlView = (
  h: StudioH,
  model: Model,
  control: Control,
): StudioHtml => {
  const value = valueOf(model.labEdits, control)
  const isSlid = Record.has(model.labEdits, control.id)
  const inputId = `lab-${control.id}`
  const shipped = control.read(SHIPPED_TABLES)
  return h.div
    .key(control.id)
    .class(isSlid ? 'lab-row slid' : 'lab-row')
    .children(
      h.label
        .attr('for', inputId)
        .attr('title', control.id)
        .children(control.label),
      h.input
        .attr('id', inputId)
        .class(control.kind === 'Color' ? 'lab-color' : 'lab-slider')
        .attr('type', control.kind === 'Color' ? 'color' : 'range')
        .attrs(
          control.kind === 'Color'
            ? {}
            : {
                min: `${control.min}`,
                max: `${control.max}`,
                step: `${control.step}`,
              },
        )
        .value(inputTextOf(value, control))
        .on('input', ({ value: text }) =>
          Message.ChangedLab({ id: control.id, text }),
        ),
      h.span
        .class('lab-value')
        .attr('title', `Shipped: ${formatValue(shipped, control)}`)
        .children(
          formatValue(value, control),
          isSlid && h.s.children(formatValue(shipped, control)),
        ),
    )
}

const groupView = (h: StudioH, model: Model, group: string): StudioHtml => {
  const controls = Array.filter(CONTROLS, control => control.group === group)
  const slid = Array.filter(controls, control =>
    Record.has(model.labEdits, control.id),
  ).length
  return h.details
    .key(group)
    .class('lab-group')
    .children(
      h.summary.children(slid > 0 ? `${group} (${slid})` : group),
      ...Array.map(controls, control => controlView(h, model, control)),
    )
}

const labBody = (h: StudioH, model: Model): StudioHtml => {
  const count = changesOf(model.labEdits).length
  return h.section
    .class('lab')
    .attr('aria-label', 'Light and color lab')
    .children(
      h.div.class('lab-head').children(
        h.h2.children('🎨 Light and color lab'),
        h.span
          .class('stage-hint')
          .children(
            count === 0
              ? 'Slide a value to see it live. The game keeps its own until a note lands.'
              : `${count} slid`,
          ),
        h.button
          .class('tool-toggle')
          .disabled(count === 0)
          .attr('title', 'Put every value back as shipped')
          .on('click', Message.ClickedLabReset())
          .children('Reset'),
        h.button
          .class('lab-propose')
          .disabled(count === 0 || model.sendStatus === 'Sending')
          .attr(
            'title',
            'Send the slid values, before and after, as a note (with your note text, if any)',
          )
          .on('click', Message.ClickedPropose())
          .children(
            Option.match(
              Option.liftPredicate(
                model.sendStatus,
                status => status === 'Sent',
              ),
              { onNone: () => 'Propose these', onSome: () => 'Sent ✓' },
            ),
          ),
      ),
      h.div
        .class('lab-groups')
        .children(Array.map(GROUPS, group => groupView(h, model, group))),
    )
}

export const labView: {
  (model: Model): (h: StudioH) => StudioHtml
  (h: StudioH, model: Model): StudioHtml
} = Function.dual(2, labBody)

const labToggleBody = (h: StudioH, model: Model): StudioHtml =>
  h.button
    .class(model.isLabOpen ? 'tool-toggle on' : 'tool-toggle')
    .attr('aria-pressed', model.isLabOpen ? 'true' : 'false')
    .attr('title', 'Slide the 3D look, the flames, and the moods live')
    .on('click', Message.ClickedLabToggle())
    .children('🎨 Light lab')

export const labToggleView: {
  (model: Model): (h: StudioH) => StudioHtml
  (h: StudioH, model: Model): StudioHtml
} = Function.dual(2, labToggleBody)
