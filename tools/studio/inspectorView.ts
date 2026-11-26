import { Array, Function, Option, String } from 'effect'

import {
  Message,
  type Model,
  type SendStatus,
  type StudioH,
  type StudioHtml,
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

const composerView = (model: Model, h: StudioH): StudioHtml =>
  h.section.class('composer').children(
    h.h3.children('Ask Claude for a change'),
    h.div
      .class('segmented kinds')
      .attr('role', 'group')
      .children(
        Array.map(NoteKind.literals, kind =>
          h.button
            .class(model.draftKind === kind ? 'segment on' : 'segment')
            .attr('aria-pressed', model.draftKind === kind ? 'true' : 'false')
            .on('click', Message.ClickedKind({ kind }))
            .children(KIND_LABELS[kind]),
        ),
      ),
    h.p.class('pin-line').children(
      pinLine(model),
      ...(hasDraftSpot(model)
        ? [
            h.button
              .class('link')
              .on('click', Message.ClickedClearPin())
              .children(model.tab === 'Rooms' ? 'Clear tiles' : 'Remove pin'),
          ]
        : []),
    ),
    h.textarea
      .attr('rows', '4')
      .attr('placeholder', PLACEHOLDERS[model.draftKind])
      .value(model.note)
      .on('input', ({ value }) => Message.UpdatedNote({ value })),
    h.button
      .class(`send ${model.sendStatus === 'Sent' ? 'sent-ok' : ''}`)
      .disabled(
        String.isEmpty(String.trim(model.note)) ||
          model.sendStatus === 'Sending',
      )
      .on('click', Message.ClickedSend())
      .children(SEND_LABELS[model.sendStatus]),
  )

const statusChip = (note: StoredNote, h: StudioH): StudioHtml =>
  note.status === 'Done'
    ? h.span.class('chip done').children('Done')
    : h.span.class('chip waiting').children('Waiting for Claude')

const noteCard = (number: number, note: StoredNote, h: StudioH): StudioHtml =>
  h.li
    .key(note.noteId)
    .class(`note ${note.status === 'Done' ? 'is-done' : ''}`)
    .children(
      h.div
        .class('note-head')
        .children(
          h.span.class('note-number').children(`${number}`),
          h.span.children(KIND_ICONS[note.kind]),
          statusChip(note, h),
        ),
      h.p.class('note-text').children(note.note),
      ...(note.status === 'Done'
        ? [
            h.p
              .class('reply')
              .children(
                h.span.class('reply-from').children('Claude'),
                note.reply,
              ),
            ...(note.hasBefore
              ? [
                  h.div
                    .class('before-now')
                    .children(
                      h.figure.children(
                        h.img
                          .attr('src', `${BEFORE_PATH}${note.noteId}.png`)
                          .attr('alt', 'How it looked before'),
                        h.figcaption.children('Before'),
                      ),
                      h.p.class('now-hint').children('Now: shown above'),
                    ),
                ]
              : []),
          ]
        : []),
    )

const notesHereView = (
  model: Model,
  targetId: string,
  h: StudioH,
): StudioHtml => {
  const notes = notesFor(model, targetId)
  return h.section
    .class('notes-here')
    .children(
      h.h3.children('Notes about this'),
      Array.isReadonlyArrayEmpty(notes)
        ? h.p.class('quiet').children('No notes yet.')
        : h.ol
            .class('notes')
            .children(
              Array.map(Array.reverse(numberedNotes(notes)), ([number, note]) =>
                noteCard(number, note, h),
              ),
            ),
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

const allNotesView = (model: Model, h: StudioH): StudioHtml => {
  const waiting = Array.filter(
    model.notes,
    note => note.status === 'Open',
  ).length
  const done = model.notes.length - waiting
  return h.section.class('all-notes').children(
    h.h3.children('All your notes'),
    h.p
      .class('quiet')
      .children(
        Array.isReadonlyArrayEmpty(model.notes)
          ? 'Notes you send show up here, and turn green when Claude has done them.'
          : `${waiting} waiting · ${done} done`,
      ),
    h.ul.class('all-list').children(
      Array.map(Array.reverse(model.notes), note =>
        h.li.key(note.noteId).children(
          h.button
            .class('all-row')
            .on(
              'click',
              Message.ClickedNote({
                tab: model.tab,
                targetId: note.targetId,
              }),
            )
            .children(
              h.span.class(note.status === 'Done' ? 'dot done' : 'dot waiting'),
              h.span.class('all-title').children(titleOfTarget(note.targetId)),
              h.span.class('all-text').children(note.note),
            ),
        ),
      ),
    ),
  )
}

export const inspectorView: {
  (model: Model): (h: StudioH) => StudioHtml
  (h: StudioH, model: Model): StudioHtml
} = Function.dual(2, (h: StudioH, model: Model): StudioHtml =>
  h.aside.class('inspector').children(
    ...(model.isInboxOnline
      ? []
      : [
          h.p
            .class('offline')
            .children(
              'Can’t reach the studio. Is `bun dev` still running? Notes will send once it’s back.',
            ),
        ]),
    ...Option.match(pickedOf(model), {
      onNone: () => [
        h.section
          .class('empty-pick')
          .children(
            h.h2.children('Pick something to look at'),
            h.p.children(
              'Tap any picture to see it big, then tell Claude what you’d like changed.',
            ),
          ),
      ],
      onSome: picked => [
        h.section
          .class('picked')
          .children(
            h.h2.children(picked.title),
            h.details.children(
              h.summary.children('Details for Claude'),
              h.p.class('quiet').children(picked.id),
              h.p.class('quiet').children(picked.source),
            ),
          ),
        composerView(model, h),
        ...Option.match(targetIdOf(model), {
          onNone: () => [],
          onSome: targetId => [notesHereView(model, targetId, h)],
        }),
      ],
    }),
    allNotesView(model, h),
  ),
)
