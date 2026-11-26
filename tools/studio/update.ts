import { Array, Function, Option, String } from 'effect'

import { type Component, UiStruct } from '@effect/ui'

import {
  DEFAULT_VIEW,
  type Flags,
  type Message,
  Model,
  type SavedView,
  StudioDef,
  freshDoneOf,
} from './block'
import { type Entry, entryById, tabOfEntry } from './catalog'
import { type Capture, SaveSeen, SaveView, SendNote } from './commands'
import {
  changesOf,
  controlById,
  inputValueOf,
  proposalOf,
  withEdit,
} from './lab'
import type { NoteDraft, StoredNote } from './notes'
import {
  areaBetween,
  areaOfTile,
  cropAround,
  isRoomTarget,
  roomFrameOf,
  roomOfTarget,
  roomSourceOf,
  roomTargetOf,
  roomTitleOf,
} from './room'

type Studio$ = Component.Update<
  Model,
  Message,
  never,
  Readonly<{ flags: Flags }>,
  {},
  Message
>

export const init = StudioDef.init($ =>
  Model.make({
    ...Option.getOrElse($.props.flags.maybeSavedView, () => DEFAULT_VIEW),
    isPlaying: true,
    clockMs: 0,
    maybeHoverTile: Option.none(),
    maybeDraftPin: Option.none(),
    maybeDraftArea: Option.none(),
    maybeDragFrom: Option.none(),
    draftKind: 'Change',
    note: '',
    sendStatus: 'Idle',
    notes: [],
    seenDone: $.props.flags.seenDone,
    isInboxOnline: true,
    cameraResets: 0,
  }),
)

const savedViewOf = (model: Model): SavedView => ({
  tab: model.tab,
  zoom: model.zoom,
  backdrop: model.backdrop,
  facing: model.facing,
  tone: model.tone,
  maybeSelectedId: model.maybeSelectedId,
  room: model.room,
  isKitchenOpen: model.isKitchenOpen,
  house: model.house,
  isTwistOn: model.isTwistOn,
  live: model.live,
  liveTool: model.liveTool,
  isGridOn: model.isGridOn,
  isOnion: model.isOnion,
  isCrew: model.isCrew,
  speed: model.speed,
  stageMode: model.stageMode,
  stagePreset: model.stagePreset,
  isAutoSpin: model.isAutoSpin,
  labEdits: model.labEdits,
  isLabOpen: model.isLabOpen,
})

const saved = ($: Studio$, next: Model) =>
  $.set(next).run(SaveView.make({ view: savedViewOf(next) }))

export const targetIdOf = (model: Model): Option.Option<string> =>
  model.tab === 'Rooms'
    ? Option.some(roomTargetOf(model.room))
    : model.maybeSelectedId

export const pickedEntry = (model: Model): Option.Option<Entry> =>
  model.tab === 'Rooms'
    ? Option.none()
    : Option.flatMap(model.maybeSelectedId, entryById)

const picking = ($: Studio$, next: Model, targetId: string) => {
  const seenDone = Array.appendAll(
    next.seenDone,
    Array.map(freshDoneOf(next, targetId), note => note.noteId),
  )
  return seenDone.length > next.seenDone.length
    ? saved($, UiStruct.evolve(next, { seenDone: () => seenDone })).run(
        SaveSeen.make({ seen: seenDone }),
      )
    : saved($, next)
}

const draftOf = (model: Model, targetId: string): NoteDraft => {
  const maybePin = model.maybeDraftPin
  const isRoom = isRoomTarget(targetId)
  const maybeEntry = entryById(targetId)
  return {
    tab: model.tab,
    targetId,
    title: isRoom
      ? roomTitleOf(model.room)
      : Option.match(maybeEntry, {
          onNone: () => targetId,
          onSome: entry => entry.title,
        }),
    source: isRoom
      ? roomSourceOf(model.room)
      : Option.match(maybeEntry, {
          onNone: () => '',
          onSome: entry => entry.source,
        }),
    kind: model.draftKind,
    pin: isRoom ? null : Option.getOrNull(maybePin),
    area: isRoom ? Option.getOrNull(model.maybeDraftArea) : null,
    note: String.trim(model.note),
    before: null,
  }
}

const captureOf = (model: Model): Capture =>
  model.tab !== 'Rooms' && model.stageMode === 'Blocks'
    ? { selector: '.stage-shot', crop: null }
    : model.tab === 'Rooms' && model.room === 'Live'
      ? { selector: '.live-shot', crop: null }
      : model.tab === 'Rooms'
        ? {
            selector: '.room-art canvas',
            crop: Option.getOrNull(
              Option.map(model.maybeDraftArea, area =>
                cropAround({
                  bounds: roomFrameOf(model).bounds,
                  zoom: model.zoom,
                })(area),
              ),
            ),
          }
        : { selector: '.stage-art canvas', crop: null }

const labWhereOf = (model: Model): string =>
  model.tab === 'Rooms'
    ? model.room === 'Live'
      ? `the live room (${model.live.spot}, ${model.live.mood})`
      : roomTitleOf(model.room)
    : Option.match(pickedEntry(model), {
        onNone: () => 'the Studio',
        onSome: entry =>
          model.stageMode === 'Blocks'
            ? `${entry.title} on the 3D stage, ${model.stagePreset}`
            : entry.title,
      })

const labDraftOf = (model: Model, targetId: string): NoteDraft => ({
  tab: model.tab,
  targetId,
  title: 'Light and color lab',
  source: Array.join(
    Array.dedupe(
      Array.map(changesOf(model.labEdits), ({ control }) => control.file),
    ),
    ', ',
  ),
  kind: 'Change',
  pin: null,
  area: null,
  note: proposalOf({
    edits: model.labEdits,
    words: model.note,
    where: labWhereOf(model),
  }),
  before: null,
})

const isSendable = (model: Model): boolean =>
  String.isNonEmpty(String.trim(model.note)) &&
  model.sendStatus !== 'Sending' &&
  Option.isSome(targetIdOf(model))

const notesKey = (notes: ReadonlyArray<StoredNote>): string =>
  Array.join(
    Array.map(notes, note => `${note.noteId}:${note.status}`),
    ',',
  )

const stepped = (model: Model, step: number): Model =>
  Option.match(pickedEntry(model), {
    onNone: () => model,
    onSome: entry =>
      UiStruct.evolve(model, {
        isPlaying: () => false,
        clockMs: clockMs =>
          Math.max(
            0,
            (Math.floor(clockMs / entry.frameMs) + step) * entry.frameMs,
          ),
      }),
  })

const sending = ($: Studio$, draft: NoteDraft) =>
  $.evolve({ sendStatus: 'Sending' }).run(
    SendNote.make({ draft, capture: captureOf($.model) }),
  )

const handle = StudioDef.update({
  ClickedTab: ($, { tab }) =>
    saved(
      $,
      UiStruct.evolve($.model, {
        tab: () => tab,
        maybeSelectedId: () => Option.none(),
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedZoom: ($, { zoom }) =>
    saved($, UiStruct.evolve($.model, { zoom: () => zoom })),
  ClickedBackdrop: ($, { backdrop }) =>
    saved($, UiStruct.evolve($.model, { backdrop: () => backdrop })),
  ClickedFacing: ($, { facing }) =>
    saved($, UiStruct.evolve($.model, { facing: () => facing })),
  ClickedTone: ($, { tone }) =>
    saved($, UiStruct.evolve($.model, { tone: () => tone })),
  ClickedSpeed: ($, { speed }) =>
    saved($, UiStruct.evolve($.model, { speed: () => speed })),
  ClickedOnion: $ =>
    saved($, UiStruct.evolve($.model, { isOnion: isOn => !isOn })),
  ClickedCrew: $ =>
    saved($, UiStruct.evolve($.model, { isCrew: isOn => !isOn })),
  ClickedGrid: $ =>
    saved($, UiStruct.evolve($.model, { isGridOn: isOn => !isOn })),
  ClickedRoom: ($, { room }) =>
    picking(
      $,
      UiStruct.evolve($.model, {
        room: () => room,
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
        maybeHoverTile: () => Option.none(),
      }),
      roomTargetOf(room),
    ),
  ClickedRoomToggle: $ =>
    saved(
      $,
      UiStruct.evolve($.model, {
        isKitchenOpen: isOpen => ($.model.room === 'Manor' ? !isOpen : isOpen),
        isTwistOn: isOn => ($.model.room === 'Manor' ? isOn : !isOn),
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedHouse: ($, { house }) =>
    saved(
      $,
      UiStruct.evolve($.model, {
        house: () => house,
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedLive: ($, { live }) =>
    saved($, UiStruct.evolve($.model, { live: () => live })),
  ClickedLiveTool: ($, { tool }) =>
    saved(
      $,
      UiStruct.evolve($.model, {
        liveTool: () => tool,
        maybeHoverTile: () => Option.none(),
        maybeDragFrom: () => Option.none(),
      }),
    ),
  ClickedPlay: $ => $.evolve({ isPlaying: isPlaying => !isPlaying }),
  ClickedStep: ($, { step }) => stepped($.model, step),
  TickedFrame: ($, { deltaTime }) =>
    $.evolve({ clockMs: clockMs => clockMs + deltaTime * $.model.speed }),
  ClickedEntry: ($, { id }) =>
    picking(
      $,
      UiStruct.evolve($.model, {
        maybeSelectedId: () => Option.some(id),
        maybeDraftPin: () => Option.none(),
        sendStatus: () => 'Idle' as const,
      }),
      id,
    ),
  ClickedNote: ($, { tab, targetId }) =>
    picking(
      $,
      UiStruct.evolve($.model, {
        tab: () =>
          isRoomTarget(targetId)
            ? 'Rooms'
            : Option.getOrElse(tabOfEntry(targetId), () => tab),
        room: room => Option.getOrElse(roomOfTarget(targetId), () => room),
        maybeSelectedId: () =>
          isRoomTarget(targetId) ? Option.none() : Option.some(targetId),
        maybeDraftPin: () => Option.none(),
      }),
      targetId,
    ),
  HoveredTile: ($, { tile }) =>
    Option.exists(
      $.model.maybeHoverTile,
      hover => hover.column === tile.column && hover.row === tile.row,
    ) && Option.isNone($.model.maybeDragFrom)
      ? $.model
      : $.evolve({
          maybeHoverTile: () => Option.some(tile),
          maybeDraftArea: area =>
            Option.match($.model.maybeDragFrom, {
              onNone: () => area,
              onSome: from => Option.some(areaBetween(from)(tile)),
            }),
        }),
  PressedRoomTile: ($, { tile }) =>
    $.evolve({
      maybeDragFrom: () => Option.some(tile),
      maybeDraftArea: () => Option.some(areaOfTile(tile)),
    }),
  ReleasedRoom: $ =>
    Option.isNone($.model.maybeDragFrom)
      ? $.model
      : $.evolve({ maybeDragFrom: () => Option.none() }),
  LeftRoom: $ =>
    $.evolve({
      maybeHoverTile: () => Option.none(),
      maybeDragFrom: () => Option.none(),
    }),
  PressedPicture: ($, { pin }) =>
    $.evolve({ maybeDraftPin: () => Option.some(pin) }),
  ClickedClearPin: $ =>
    $.evolve({
      maybeDraftPin: () => Option.none(),
      maybeDraftArea: () => Option.none(),
    }),
  ClickedKind: ($, { kind }) => $.evolve({ draftKind: () => kind }),
  UpdatedNote: ($, { value }) =>
    $.evolve({
      note: () => value,
      sendStatus: status => (status === 'Sending' ? status : ('Idle' as const)),
    }),
  ClickedSend: $ =>
    Option.match(
      Option.filter(targetIdOf($.model), () => isSendable($.model)),
      {
        onNone: () => $.model,
        onSome: targetId => sending($, draftOf($.model, targetId)),
      },
    ),
  CompletedSendNote: $ =>
    $.evolve({
      note: () => '',
      maybeDraftPin: () => Option.none(),
      maybeDraftArea: () => Option.none(),
      sendStatus: () => 'Sent' as const,
    }),
  FailedSendNote: $ => $.evolve({ sendStatus: () => 'Failed' as const }),
  ReceivedNotes: ($, { notes }) =>
    notesKey(notes) === notesKey($.model.notes) && $.model.isInboxOnline
      ? $.model
      : $.evolve({ notes: () => notes, isInboxOnline: () => true }),
  LostInbox: $ =>
    $.model.isInboxOnline ? $.evolve({ isInboxOnline: () => false }) : $.model,
  ClickedStageMode: ($, { mode }) =>
    saved($, UiStruct.evolve($.model, { stageMode: () => mode })),
  ClickedStagePreset: ($, { preset }) =>
    saved($, UiStruct.evolve($.model, { stagePreset: () => preset })),
  ClickedAutoSpin: $ =>
    saved($, UiStruct.evolve($.model, { isAutoSpin: isOn => !isOn })),
  ClickedPlayCamera: $ =>
    $.evolve({
      isAutoSpin: () => false,
      cameraResets: count => count + 1,
    }),
  ClickedLabToggle: $ =>
    saved($, UiStruct.evolve($.model, { isLabOpen: isOpen => !isOpen })),
  ChangedLab: ($, { id, text }) =>
    Option.match(
      Option.flatMap(controlById(id), control => inputValueOf(control, text)),
      {
        onNone: () => $.model,
        onSome: value =>
          saved(
            $,
            UiStruct.evolve($.model, {
              labEdits: edits => withEdit(edits, id, value),
            }),
          ),
      },
    ),
  ClickedLabReset: $ =>
    saved($, UiStruct.evolve($.model, { labEdits: () => ({}) })),
  ClickedPropose: $ =>
    Option.match(
      Option.filter(
        targetIdOf($.model),
        () =>
          Array.isReadonlyArrayNonEmpty(changesOf($.model.labEdits)) &&
          $.model.sendStatus !== 'Sending',
      ),
      {
        onNone: () => $.model,
        onSome: targetId => sending($, labDraftOf($.model, targetId)),
      },
    ),
})

type Handled = ReturnType<typeof handle>

export const update: {
  (message: Message): ($: Studio$) => Handled
  ($: Studio$, message: Message): Handled
} = Function.dual(2, ($: Studio$, message: Message): Handled =>
  handle($, message),
)
