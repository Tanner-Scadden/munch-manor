// The right side of the studio: what is picked, the box to ask for a change,
// the notes about it with Claude's answers and their before pictures, and
// every other note, a tap away.
import { Array, Function, Option, String } from 'effect'
import type { Html } from 'foldkit/html'

import {
  Message,
  type Model,
  type SendStatus,
  type StudioViewBuilder,
  notesFor,
} from './block'
import { entryById } from './catalog'
import { BEFORE_PATH, NoteKind, type StoredNote } from './notes'
import { numberedNotes } from './pins'
import {
  areaHeight,
  areaWidth,
  isToggleOn,
  roomOfTarget,
  roomSourceOf,
  roomTargetOf,
  roomTitleOf,
  roomToggleOf,
} from './room'
import { pickedEntry, targetIdOf } from './update'

const KIND_LABELS: Readonly<Record<NoteKind, string>> = {
  Change: '✏️ Change',
  Idea: '💡 Idea',
  Bug: '🐞 Fix',
  Love: '❤️ Love',
}

const KIND_ICONS: Readonly<Record<NoteKind, string>> = {
  Change: '✏️',
  Idea: '💡',
  Bug: '🐞',
  Love: '❤️',
}

const PLACEHOLDERS: Readonly<Record<NoteKind, string>> = {
  Change:
    'What should change? Bigger, smaller, another color, a different face…',
  Idea: 'What if…?',
  Bug: 'What looks wrong?',
  Love: 'What do you love about it?',
}

const SEND_LABELS: Readonly<Record<SendStatus, string>> = {
  Idle: 'Send to Claude',
  Sending: 'Sending…',
  Sent: 'Sent ✓',
  Failed: 'Didn’t send. Try again',
}

type Picked = Readonly<{ title: string; id: string; source: string }>

const pickedOf = (model: Model): Option.Option<Picked> =>
  model.tab === 'Rooms'
    ? Option.some({
        title: Option.match(roomToggleOf(model.room), {
          onNone: () => roomTitleOf(model.room),
          onSome: toggle =>
            `${roomTitleOf(model.room)}, ${String.toLowerCase(toggle.label)} ${String.toLowerCase(isToggleOn(model) ? toggle.on : toggle.off)}`,
        }),
        id: roomTargetOf(model.room),
        source: roomSourceOf(model.room),
      })
    : Option.map(pickedEntry(model), entry => ({
        title: entry.title,
        id: entry.id,
        source: entry.source,
      }))

const areaLine = (model: Model): string =>
  Option.match(model.maybeDraftArea, {
    onNone: () => '👆 Drag over the room to pick tiles (optional).',
    onSome: area =>
      areaWidth(area) * areaHeight(area) === 1
        ? '📐 Picked 1 tile. Drag to pick more.'
        : `📐 Picked ${areaWidth(area)} × ${areaHeight(area)} tiles. Drag again to change.`,
  })

const spriteLine = (model: Model): string =>
  Option.match(model.maybeDraftPin, {
    onNone: () => '👆 Tap the big picture to point at a spot (optional).',
    onSome: () => '📍 Pinned a spot. Tap again to move it.',
  })

const pinLine = (model: Model): string =>
  model.tab === 'Rooms' ? areaLine(model) : spriteLine(model)

const hasDraftSpot = (model: Model): boolean =>
  model.tab === 'Rooms'
    ? Option.isSome(model.maybeDraftArea)
    : Option.isSome(model.maybeDraftPin)

const composerView = (model: Model, h: StudioViewBuilder): Html =>
  h.section(
    [h.Class('composer')],
    [
      h.h3([], ['Ask Claude for a change']),
      h.div(
        [h.Class('segmented kinds'), h.Role('group')],
        Array.map(NoteKind.literals, kind =>
          h.button(
            [
              h.Class(model.draftKind === kind ? 'segment on' : 'segment'),
              h.AriaPressed(model.draftKind === kind ? 'true' : 'false'),
              h.OnClick(Message.ClickedKind({ kind })),
            ],
            [KIND_LABELS[kind]],
          ),
        ),
      ),
      h.p(
        [h.Class('pin-line')],
        [
          pinLine(model),
          ...(hasDraftSpot(model)
            ? [
                h.button(
                  [h.Class('link'), h.OnClick(Message.ClickedClearPin())],
                  [model.tab === 'Rooms' ? 'Clear tiles' : 'Remove pin'],
                ),
              ]
            : []),
        ],
      ),
      h.textarea([
        h.Rows(4),
        h.Placeholder(PLACEHOLDERS[model.draftKind]),
        h.Value(model.note),
        h.OnInput(value => Message.UpdatedNote({ value })),
      ]),
      h.button(
        [
          h.Class(`send ${model.sendStatus === 'Sent' ? 'sent-ok' : ''}`),
          h.Disabled(
            String.isEmpty(String.trim(model.note)) ||
              model.sendStatus === 'Sending',
          ),
          h.OnClick(Message.ClickedSend()),
        ],
        [SEND_LABELS[model.sendStatus]],
      ),
    ],
  )

const statusChip = (note: StoredNote, h: StudioViewBuilder): Html =>
  note.status === 'Done'
    ? h.span([h.Class('chip done')], ['Done'])
    : h.span([h.Class('chip waiting')], ['Waiting for Claude'])

const noteCard = (
  number: number,
  note: StoredNote,
  h: StudioViewBuilder,
): Html =>
  h.li(
    [
      h.Key(note.noteId),
      h.Class(`note ${note.status === 'Done' ? 'is-done' : ''}`),
    ],
    [
      h.div(
        [h.Class('note-head')],
        [
          h.span([h.Class('note-number')], [`${number}`]),
          h.span([], [KIND_ICONS[note.kind]]),
          statusChip(note, h),
        ],
      ),
      h.p([h.Class('note-text')], [note.note]),
      ...(note.status === 'Done'
        ? [
            h.p(
              [h.Class('reply')],
              [h.span([h.Class('reply-from')], ['Claude']), note.reply],
            ),
            ...(note.hasBefore
              ? [
                  h.div(
                    [h.Class('before-now')],
                    [
                      h.figure(
                        [],
                        [
                          h.img([
                            h.Src(`${BEFORE_PATH}${note.noteId}.png`),
                            h.Alt('How it looked before'),
                          ]),
                          h.figcaption([], ['Before']),
                        ],
                      ),
                      h.p([h.Class('now-hint')], ['Now: shown above']),
                    ],
                  ),
                ]
              : []),
          ]
        : []),
    ],
  )

const notesHereView = (
  model: Model,
  targetId: string,
  h: StudioViewBuilder,
): Html => {
  const notes = notesFor(model, targetId)
  return h.section(
    [h.Class('notes-here')],
    [
      h.h3([], ['Notes about this']),
      Array.isReadonlyArrayEmpty(notes)
        ? h.p([h.Class('quiet')], ['No notes yet.'])
        : h.ol(
            [h.Class('notes')],
            Array.map(Array.reverse(numberedNotes(notes)), ([number, note]) =>
              noteCard(number, note, h),
            ),
          ),
    ],
  )
}

const titleOfTarget = (targetId: string): string =>
  Option.match(roomOfTarget(targetId), {
    onSome: roomTitleOf,
    onNone: () =>
      Option.match(entryById(targetId), {
        onNone: () => targetId,
        onSome: entry => entry.title,
      }),
  })

const allNotesView = (model: Model, h: StudioViewBuilder): Html => {
  const waiting = Array.filter(
    model.notes,
    note => note.status === 'Open',
  ).length
  const done = model.notes.length - waiting
  return h.section(
    [h.Class('all-notes')],
    [
      h.h3([], ['All your notes']),
      h.p(
        [h.Class('quiet')],
        [
          Array.isReadonlyArrayEmpty(model.notes)
            ? 'Notes you send show up here, and turn green when Claude has done them.'
            : `${waiting} waiting · ${done} done`,
        ],
      ),
      h.ul(
        [h.Class('all-list')],
        Array.map(Array.reverse(model.notes), note =>
          h.li(
            [h.Key(note.noteId)],
            [
              h.button(
                [
                  h.Class('all-row'),
                  h.OnClick(
                    Message.ClickedNote({
                      tab: model.tab,
                      targetId: note.targetId,
                    }),
                  ),
                ],
                [
                  h.span([
                    h.Class(
                      note.status === 'Done' ? 'dot done' : 'dot waiting',
                    ),
                  ]),
                  h.span(
                    [h.Class('all-title')],
                    [titleOfTarget(note.targetId)],
                  ),
                  h.span([h.Class('all-text')], [note.note]),
                ],
              ),
            ],
          ),
        ),
      ),
    ],
  )
}

export const inspectorView: {
  (h: StudioViewBuilder): (model: Model) => Html
  (model: Model, h: StudioViewBuilder): Html
} = Function.dual(2, (model: Model, h: StudioViewBuilder): Html =>
  h.aside(
    [h.Class('inspector')],
    [
      ...(model.isInboxOnline
        ? []
        : [
            h.p(
              [h.Class('offline')],
              [
                'Can’t reach the studio. Is `bun dev` still running? Notes will send once it’s back.',
              ],
            ),
          ]),
      ...Option.match(pickedOf(model), {
        onNone: () => [
          h.section(
            [h.Class('empty-pick')],
            [
              h.h2([], ['Pick something to look at']),
              h.p(
                [],
                [
                  'Tap any picture to see it big, then tell Claude what you’d like changed.',
                ],
              ),
            ],
          ),
        ],
        onSome: picked => [
          h.section(
            [h.Class('picked')],
            [
              h.h2([], [picked.title]),
              h.details(
                [],
                [
                  h.summary([], ['Details for Claude']),
                  h.p([h.Class('quiet')], [picked.id]),
                  h.p([h.Class('quiet')], [picked.source]),
                ],
              ),
            ],
          ),
          composerView(model, h),
          ...Option.match(targetIdOf(model), {
            onNone: () => [],
            onSome: targetId => [notesHereView(model, targetId, h)],
          }),
        ],
      }),
      allNotesView(model, h),
    ],
  ),
)
