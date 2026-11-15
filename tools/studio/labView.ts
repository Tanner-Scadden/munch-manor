// The light and color lab's panel (./lab.ts): every value of the 3D look,
// the flames, and the moods' ambient as a slider or a color picker, grouped
// as in code (each group's count of slid values on its fold), with the slid ones marked and their shipped value beside them;
// RESET puts every value back, and PROPOSE sends the slid values as a note
// for an agent to land. It shows under the live room and the 3D stage, which
// both take its edits as they move.
import { Array, Function, Option, Record } from 'effect'
import type { Html } from 'foldkit/html'

import { Message, type Model, type StudioViewBuilder } from './block'
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
  model: Model,
  control: Control,
  h: StudioViewBuilder,
): Html => {
  const value = valueOf(model.labEdits, control)
  const isSlid = Record.has(model.labEdits, control.id)
  const inputId = `lab-${control.id}`
  const shipped = control.read(SHIPPED_TABLES)
  return h.div(
    [h.Key(control.id), h.Class(isSlid ? 'lab-row slid' : 'lab-row')],
    [
      h.label([h.For(inputId), h.Title(control.id)], [control.label]),
      h.input([
        h.Id(inputId),
        h.Class(control.kind === 'Color' ? 'lab-color' : 'lab-slider'),
        h.Type(control.kind === 'Color' ? 'color' : 'range'),
        ...(control.kind === 'Color'
          ? []
          : [
              h.Min(`${control.min}`),
              h.Max(`${control.max}`),
              h.Step(`${control.step}`),
            ]),
        h.Value(inputTextOf(value, control)),
        h.OnInput(text => Message.ChangedLab({ id: control.id, text })),
      ]),
      h.span(
        [
          h.Class('lab-value'),
          h.Title(`Shipped: ${formatValue(shipped, control)}`),
        ],
        [
          formatValue(value, control),
          ...(isSlid ? [h.s([], [formatValue(shipped, control)])] : []),
        ],
      ),
    ],
  )
}

const groupView = (model: Model, group: string, h: StudioViewBuilder): Html => {
  const controls = Array.filter(CONTROLS, control => control.group === group)
  const slid = Array.filter(controls, control =>
    Record.has(model.labEdits, control.id),
  ).length
  // NOTE: the browser keeps a group open or shut: Foldkit's Open sets the
  // property again on every patch, and the page draws every frame.
  return h.details(
    [h.Key(group), h.Class('lab-group')],
    [
      h.summary([], [slid > 0 ? `${group} (${slid})` : group]),
      ...Array.map(controls, control => controlView(model, control, h)),
    ],
  )
}

const labBody = (model: Model, h: StudioViewBuilder): Html => {
  const count = changesOf(model.labEdits).length
  return h.section(
    [h.Class('lab'), h.AriaLabel('Light and color lab')],
    [
      h.div(
        [h.Class('lab-head')],
        [
          h.h2([], ['🎨 Light and color lab']),
          h.span(
            [h.Class('stage-hint')],
            [
              count === 0
                ? 'Slide a value to see it live. The game keeps its own until a note lands.'
                : `${count} slid`,
            ],
          ),
          h.button(
            [
              h.Class('tool-toggle'),
              h.Disabled(count === 0),
              h.Title('Put every value back as shipped'),
              h.OnClick(Message.ClickedLabReset()),
            ],
            ['Reset'],
          ),
          h.button(
            [
              h.Class('lab-propose'),
              h.Disabled(count === 0 || model.sendStatus === 'Sending'),
              h.Title(
                'Send the slid values, before and after, as a note (with your note text, if any)',
              ),
              h.OnClick(Message.ClickedPropose()),
            ],
            [
              Option.match(
                Option.liftPredicate(
                  model.sendStatus,
                  status => status === 'Sent',
                ),
                { onNone: () => 'Propose these', onSome: () => 'Sent ✓' },
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('lab-groups')],
        Array.map(GROUPS, group => groupView(model, group, h)),
      ),
    ],
  )
}

export const labView: {
  (h: StudioViewBuilder): (model: Model) => Html
  (model: Model, h: StudioViewBuilder): Html
} = Function.dual(2, labBody)

// NOTE: the toolbar's switch that opens the lab under the picture.
const labToggleBody = (model: Model, h: StudioViewBuilder): Html =>
  h.button(
    [
      h.Class(model.isLabOpen ? 'tool-toggle on' : 'tool-toggle'),
      h.AriaPressed(model.isLabOpen ? 'true' : 'false'),
      h.Title('Slide the 3D look, the flames, and the moods live'),
      h.OnClick(Message.ClickedLabToggle()),
    ],
    ['🎨 Light lab'],
  )

export const labToggleView: {
  (h: StudioViewBuilder): (model: Model) => Html
  (model: Model, h: StudioViewBuilder): Html
} = Function.dual(2, labToggleBody)
