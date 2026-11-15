// The art studio's init and update: the controls, picking and pinning, the
// note being written and sent, and the notes coming back.
import { Array, Option, String } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  DEFAULT_VIEW,
  type Flags,
  Model,
  type SavedView,
  StudioComposition,
  freshDoneOf,
  makeFieldsStep,
  makeNoopStep,
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

export const init = StudioComposition.makeInit((startFlags: Flags) => ({
  model: Model.make({
    ...Option.getOrElse(startFlags.maybeSavedView, () => DEFAULT_VIEW),
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
    seenDone: startFlags.seenDone,
    isInboxOnline: true,
    cameraResets: 0,
  }),
}))

// THE VIEW

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

// NOTE: a change to the saved part of the view, written to sessionStorage.
const saved = (model: Model) => ({
  model,
  commands: [SaveView({ view: savedViewOf(model) })],
})

// NOTE: what a note is about: the picked sprite, or the room on the Rooms
// tab.
export const targetIdOf = (model: Model): Option.Option<string> =>
  model.tab === 'Rooms'
    ? Option.some(roomTargetOf(model.room))
    : model.maybeSelectedId

export const pickedEntry = (model: Model): Option.Option<Entry> =>
  model.tab === 'Rooms'
    ? Option.none()
    : Option.flatMap(model.maybeSelectedId, entryById)

// NOTE: opening something marks its done notes seen, so their sparkle goes.
const seeing = (model: Model, targetId: string) => {
  const seenDone = Array.appendAll(
    model.seenDone,
    Array.map(freshDoneOf(model, targetId), note => note.noteId),
  )
  const isChanged = seenDone.length > model.seenDone.length
  return {
    model: isChanged
      ? modifyFields(model, { seenDone: () => seenDone })
      : model,
    commands: Array.filter([SaveSeen({ seen: seenDone })], () => isChanged),
  }
}

const picking = (model: Model, targetId: string) => {
  const seen = seeing(model, targetId)
  const view = saved(seen.model)
  return { model: view.model, commands: [...seen.commands, ...view.commands] }
}

// THE NOTE

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

// NOTE: the canvas a note's before picture comes from: the big view's art,
// or the room around the picked tiles (the whole room with none).
const captureOf = (model: Model): Capture =>
  model.tab !== 'Rooms' && model.stageMode === 'Blocks'
    ? { selector: '.stage-shot', crop: null }
    : model.tab === 'Rooms' && model.room === 'Live'
      ? { selector: '.live-shot', crop: null }
      : model.tab === 'Rooms'
        ? {
            selector: '.room-art',
            crop: Option.getOrNull(
              Option.map(model.maybeDraftArea, area =>
                cropAround({
                  bounds: roomFrameOf(model).bounds,
                  zoom: model.zoom,
                })(area),
              ),
            ),
          }
        : { selector: '.stage-art', crop: null }

// THE LAB

// NOTE: where the lab's values were tried, as its note says.
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

// NOTE: the lab's note: its values, before and after, about what is open.
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

// NOTE: the notes as they stand, so a poll that brings nothing new keeps the
// Model as it is and nothing redraws.
const notesKey = (notes: ReadonlyArray<StoredNote>): string =>
  Array.join(
    Array.map(notes, note => `${note.noteId}:${note.status}`),
    ',',
  )

// THE CLOCK

// NOTE: one frame back or on in the big view: the clock moves by the picked
// sprite's frame length, and the animation stops so the frame holds.
const stepped = (model: Model, step: number): Model =>
  Option.match(pickedEntry(model), {
    onNone: () => model,
    onSome: entry =>
      modifyFields(model, {
        isPlaying: () => false,
        clockMs: clockMs =>
          Math.max(
            0,
            (Math.floor(clockMs / entry.frameMs) + step) * entry.frameMs,
          ),
      }),
  })

export const update = StudioComposition.makeUpdate({
  ClickedTab: (model, { tab }) =>
    saved(
      modifyFields(model, {
        tab: () => tab,
        maybeSelectedId: () => Option.none(),
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedZoom: (model, { zoom }) =>
    saved(modifyFields(model, { zoom: () => zoom })),
  ClickedBackdrop: (model, { backdrop }) =>
    saved(modifyFields(model, { backdrop: () => backdrop })),
  ClickedFacing: (model, { facing }) =>
    saved(modifyFields(model, { facing: () => facing })),
  ClickedTone: (model, { tone }) =>
    saved(modifyFields(model, { tone: () => tone })),
  ClickedSpeed: (model, { speed }) =>
    saved(modifyFields(model, { speed: () => speed })),
  ClickedOnion: model => saved(modifyFields(model, { isOnion: isOn => !isOn })),
  ClickedCrew: model => saved(modifyFields(model, { isCrew: isOn => !isOn })),
  ClickedGrid: model => saved(modifyFields(model, { isGridOn: isOn => !isOn })),
  ClickedRoom: (model, { room }) =>
    picking(
      modifyFields(model, {
        room: () => room,
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
        maybeHoverTile: () => Option.none(),
      }),
      roomTargetOf(room),
    ),
  ClickedRoomToggle: model =>
    saved(
      modifyFields(model, {
        isKitchenOpen: isOpen => (model.room === 'Manor' ? !isOpen : isOpen),
        isTwistOn: isOn => (model.room === 'Manor' ? isOn : !isOn),
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedHouse: (model, { house }) =>
    saved(
      modifyFields(model, {
        house: () => house,
        maybeDraftPin: () => Option.none(),
        maybeDraftArea: () => Option.none(),
      }),
    ),
  ClickedLive: (model, { live }) =>
    saved(modifyFields(model, { live: () => live })),
  ClickedLiveTool: (model, { tool }) =>
    saved(
      modifyFields(model, {
        liveTool: () => tool,
        maybeHoverTile: () => Option.none(),
        maybeDragFrom: () => Option.none(),
      }),
    ),
  ClickedPlay: makeFieldsStep(() => ({ isPlaying: isPlaying => !isPlaying })),
  ClickedStep: (model, { step }) => ({ model: stepped(model, step) }),
  TickedFrame: (model, { deltaTime }) => ({
    model: modifyFields(model, {
      clockMs: clockMs => clockMs + deltaTime * model.speed,
    }),
  }),
  ClickedEntry: (model, { id }) =>
    picking(
      modifyFields(model, {
        maybeSelectedId: () => Option.some(id),
        maybeDraftPin: () => Option.none(),
        sendStatus: () => 'Idle' as const,
      }),
      id,
    ),
  ClickedNote: (model, { tab, targetId }) =>
    picking(
      modifyFields(model, {
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
  HoveredTile: (model, { tile }) =>
    Option.exists(
      model.maybeHoverTile,
      hover => hover.column === tile.column && hover.row === tile.row,
    ) && Option.isNone(model.maybeDragFrom)
      ? { model }
      : {
          model: modifyFields(model, {
            maybeHoverTile: () => Option.some(tile),
            maybeDraftArea: area =>
              Option.match(model.maybeDragFrom, {
                onNone: () => area,
                onSome: from => Option.some(areaBetween(from)(tile)),
              }),
          }),
        },
  PressedRoomTile: makeFieldsStep.fromMessage(({ tile }) => ({
    maybeDragFrom: () => Option.some(tile),
    maybeDraftArea: () => Option.some(areaOfTile(tile)),
  })),
  ReleasedRoom: makeFieldsStep(() => ({ maybeDragFrom: () => Option.none() })),
  LeftRoom: makeFieldsStep(() => ({
    maybeHoverTile: () => Option.none(),
    maybeDragFrom: () => Option.none(),
  })),
  PressedPicture: makeFieldsStep.fromMessage(({ pin }) => ({
    maybeDraftPin: () => Option.some(pin),
  })),
  ClickedClearPin: makeFieldsStep(() => ({
    maybeDraftPin: () => Option.none(),
    maybeDraftArea: () => Option.none(),
  })),
  ClickedKind: makeFieldsStep.fromMessage(({ kind }) => ({
    draftKind: () => kind,
  })),
  UpdatedNote: makeFieldsStep.fromMessage(({ value }) => ({
    note: () => value,
    sendStatus: status => (status === 'Sending' ? status : ('Idle' as const)),
  })),
  ClickedSend: model =>
    Option.match(
      Option.filter(targetIdOf(model), () => isSendable(model)),
      {
        onNone: () => ({ model }),
        onSome: targetId => ({
          model: modifyFields(model, { sendStatus: () => 'Sending' as const }),
          commands: [
            SendNote({
              draft: draftOf(model, targetId),
              capture: captureOf(model),
            }),
          ],
        }),
      },
    ),
  CompletedSendNote: makeFieldsStep(() => ({
    note: () => '',
    maybeDraftPin: () => Option.none(),
    maybeDraftArea: () => Option.none(),
    sendStatus: () => 'Sent' as const,
  })),
  FailedSendNote: makeFieldsStep(() => ({
    sendStatus: () => 'Failed' as const,
  })),
  ReceivedNotes: (model, { notes }) =>
    notesKey(notes) === notesKey(model.notes) && model.isInboxOnline
      ? { model }
      : {
          model: modifyFields(model, {
            notes: () => notes,
            isInboxOnline: () => true,
          }),
        },
  LostInbox: model =>
    model.isInboxOnline
      ? { model: modifyFields(model, { isInboxOnline: () => false }) }
      : { model },
  ClickedStageMode: (model, { mode }) =>
    saved(modifyFields(model, { stageMode: () => mode })),
  ClickedStagePreset: (model, { preset }) =>
    saved(modifyFields(model, { stagePreset: () => preset })),
  ClickedAutoSpin: model =>
    saved(modifyFields(model, { isAutoSpin: isOn => !isOn })),
  ClickedPlayCamera: makeFieldsStep(() => ({
    isAutoSpin: () => false,
    cameraResets: count => count + 1,
  })),
  ClickedLabToggle: model =>
    saved(modifyFields(model, { isLabOpen: isOpen => !isOpen })),
  ChangedLab: (model, { id, text }) =>
    Option.match(
      Option.flatMap(controlById(id), control => inputValueOf(control, text)),
      {
        onNone: () => ({ model }),
        onSome: value =>
          saved(
            modifyFields(model, {
              labEdits: edits => withEdit(edits, id, value),
            }),
          ),
      },
    ),
  ClickedLabReset: model =>
    saved(modifyFields(model, { labEdits: () => ({}) })),
  ClickedPropose: model =>
    Option.match(
      Option.filter(
        targetIdOf(model),
        () =>
          Array.isReadonlyArrayNonEmpty(changesOf(model.labEdits)) &&
          model.sendStatus !== 'Sending',
      ),
      {
        onNone: () => ({ model }),
        onSome: targetId => ({
          model: modifyFields(model, { sendStatus: () => 'Sending' as const }),
          commands: [
            SendNote({
              draft: labDraftOf(model, targetId),
              capture: captureOf(model),
            }),
          ],
        }),
      },
    ),
  CompletedSaveView: makeNoopStep(),
  CompletedSaveSeen: makeNoopStep(),
})
