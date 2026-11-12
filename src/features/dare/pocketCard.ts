import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { PocketCard } from '../../domain/clientSchema'
import { isRunOn, runDifficultyOf } from '../../domain/onlineRun'
import { PAD_SELECT } from '../../input/gamepad'
import { dareCardOf, maybeThingRoom } from '../../world/dare/dare'
import type { DareKind } from '../../world/dare/dareSchema'
import { levelOf } from '../../world/level/arena'
import { isPending, learn } from '../../world/run/lessons'
import { Phase, isRoundActive } from '../../world/schema/worldSchema'
import { isThingShownOn } from './dareView'

// The dare card in your pocket (LORE.md, "The dare card in your pocket"):
// once the doors slam, the card your friends wrote opens over the screen,
// I DARE YOU TO FIND: this run's room things in their scrawl, THEN GET
// OUT! by a doodle of the front door, and then folds itself into the HUD's dare
// card (src/features/dare/dareCard.ts), each picture flying into its own
// slot. Endless ("stay the night") has no list, so no card. It is the
// client's own: alone the first break waits under it until it is read, as
// the new zombie card holds a wave; in co-op the room never waits, and the
// card is drawn over the first break on its clock.
//
// The first time alone (the `dareCard` lesson, saved), the card waits for a
// key or a tap, taken only after GATE_MS so a mashed key from the intro
// does not throw it away unread, and folding it learns the lesson. After
// that it folds on its own at READ_MS.

// NOTE: the card rises out of your pocket and unfolds in UNFOLD_MS, the
// scrawl writes itself on, and it folds away on its own at READ_MS.
export const UNFOLD_MS = 400
export const READ_MS = 4_500
export const FOLD_MS = 900
export const GATE_MS = 1_500

// THE SCRAWL'S CLOCK

// NOTE: the things the card asks you to find: the room things on this
// run's list, in the HUD's order. Uncle Chunk and his key are not on it.
export const cardThingsOf = (model: Model): ReadonlyArray<DareKind> =>
  Array.map(dareCardOf(model), ({ kind }) => kind)

// NOTE: the scrawl writes itself on while you read: the dare as it opens
// (UNFOLD_MS), then TO FIND:, then each thing with a pencil scratch, then
// THEN GET OUT! with the door. The view (src/features/dare/pocketCardView.ts)
// and the scratches (`scratchesBetween`) read the same clock.
export const FIND_AT_MS = UNFOLD_MS + 200
const FIRST_THING_AT_MS = UNFOLD_MS + 450
const THING_GAP_MS = 320
const OUT_AFTER_MS = 300

// NOTE: when the thing at `index` is written on.
export const thingAtMs = (index: number): number =>
  FIRST_THING_AT_MS + index * THING_GAP_MS

// NOTE: when THEN GET OUT! is written, after the last of `count` things.
export const outAtMs = (count: number): number =>
  thingAtMs(Math.max(0, count - 1)) + OUT_AFTER_MS

// NOTE: every pencil scratch: each thing, and THEN GET OUT!.
const scratchTimesOf = (count: number): ReadonlyArray<number> => [
  ...Array.makeBy(count, thingAtMs),
  outAtMs(count),
]

const thingCountOf = (model: Model): number => cardThingsOf(model).length

// NOTE: how many scratches the card wrote between two Models, for the
// pencil's sound.
export const scratchesBetween: {
  (after: Model): (before: Model) => number
  (before: Model, after: Model): number
} = Function.dual(2, (before: Model, after: Model): number => {
  const ageOf = (model: Model): number =>
    PocketCard.matchOrElse(
      model.pocketCard,
      { Reading: ({ ageMs }) => ageMs },
      () => -1,
    )
  const from = ageOf(before)
  const to = ageOf(after)
  return to < 0
    ? 0
    : Array.length(
        Array.filter(
          scratchTimesOf(thingCountOf(after)),
          atMs => atMs > from && atMs <= to,
        ),
      )
})

// NOTE: alone, until the card has been read once, it waits for a key or a
// tap. Co-op's card keeps its clock.
export const isPocketCardWaiting = (model: Model): boolean =>
  isPending(model.lessons.dareCard) && !isRunOn(model)

// NOTE: when a waiting card takes a key, and its prompt shows: past the
// gate, once the whole list is written.
export const promptAtMs = (model: Model): number =>
  Math.max(GATE_MS, outAtMs(thingCountOf(model)))

export const isPocketCardReading = (model: Model): boolean =>
  PocketCard.isAnyOf(['Reading'])(model.pocketCard)

// NOTE: out of the pocket: unfolding, being read, or folding into the HUD.
// Rattles keeps his hints until it is put away, so no bubble sits over it
// (the gun cluster's buttons wait only while it is read).
export const isPocketCardOut = (model: Model): boolean =>
  !PocketCard.isAnyOf(['Pocketed'])(model.pocketCard)

export const isPocketCardOpened = (model: Model): boolean =>
  PocketCard.isAnyOf(['Opened'])(model.pocketCard)

// NOTE: alone the first break waits while the card is read, and the run
// waits while the card is opened again from the HUD, as the pause menu
// does. The fold plays over the running break, so a key that folds it
// gives the player back at once. Co-op never waits.
export const isPocketCardBlocking = (model: Model): boolean =>
  !isRunOn(model) &&
  ((isPocketCardReading(model) &&
    Phase.isAnyOf(['Preparation'])(model.phase)) ||
    isPocketCardOpened(model))

// NOTE: the slam ends the intro: the card comes out if the run has a list.
export const raisePocketCardFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  Phase.isAnyOf(['Arriving'])(before.phase) &&
  !Phase.isAnyOf(['Arriving'])(after.phase) &&
  dareCardOf(after).length > 0
    ? modifyFields(after, {
        pocketCard: () => PocketCard.Reading({ ageMs: 0 }),
      })
    : after,
)

const foldOf = (model: Model): Model =>
  modifyFields(model, {
    pocketCard: () => PocketCard.Folding({ ageMs: 0 }),
    lessons: lessons =>
      isRunOn(model)
        ? lessons
        : modifyFields(lessons, {
            dareCard: lesson => learn(lesson, model.elapsedMs),
          }),
  })

// NOTE: any key or tap folds it once it has opened, or, while it waits,
// once it is past the gate.
const isPocketCardTakingKeys = (model: Model): boolean =>
  PocketCard.matchOrElse(
    model.pocketCard,
    {
      Reading: ({ ageMs }) =>
        ageMs >= (isPocketCardWaiting(model) ? GATE_MS : UNFOLD_MS),
    },
    () => false,
  )

// NOTE: out and read, but not yet taking a key.
export const isPocketCardHeld = (model: Model): boolean =>
  isPocketCardReading(model) && !isPocketCardTakingKeys(model)

// THE CARD OPENED AGAIN

// NOTE: the HUD's list opens the card again, through a run with a list
// (Demi and the owner, 2026-11-11): a tap or click on the list, Tab, or a
// controller's Select (View, Share), which mid-round asks nothing else.
// The same key or button puts it away, and so does any key or tap once it
// is past OPEN_GATE_MS, so the tap that opened it never shuts it.
const OPEN_GATE_MS = 150

const DARE_CARD_KEYS: ReadonlyArray<string> = ['Tab', PAD_SELECT]

export const isDareCardKey = (code: string): boolean =>
  Array.contains(DARE_CARD_KEYS, code)

// NOTE: in a round of a run with a list, while the card is in the pocket.
const canOpenDareCard = (model: Model): boolean =>
  isRoundActive(model.phase) &&
  Array.isReadonlyArrayNonEmpty(dareCardOf(model)) &&
  PocketCard.isAnyOf(['Pocketed'])(model.pocketCard)

const foundKindsOf = (model: Model): ReadonlyArray<DareKind> =>
  Array.map(
    Array.filter(dareCardOf(model), ({ isFound }) => isFound),
    ({ kind }) => kind,
  )

// NOTE: the things found since the satchel was last looked at drop into it
// (src/features/dare/pocketCardView.ts); the rest are already there.
const openDareCard = (model: Model): Model => {
  if (!canOpenDareCard(model)) {
    return model
  }
  const found = foundKindsOf(model)
  return modifyFields(model, {
    pocketCard: () =>
      PocketCard.Opened({
        ageMs: 0,
        fresh: Array.filter(
          found,
          kind => !Array.contains(model.dareSatchel, kind),
        ),
      }),
    dareSatchel: () => found,
  })
}

export const closeDareCard = (model: Model): Model =>
  isPocketCardOpened(model)
    ? modifyFields(model, { pocketCard: () => PocketCard.Pocketed() })
    : model

// NOTE: the list's button and its keys: open, or put away.
export const toggleDareCard = (model: Model): Model =>
  isPocketCardOpened(model) ? closeDareCard(model) : openDareCard(model)

// NOTE: whether the list's button or key does anything now.
export const isDareCardToggling = (model: Model): boolean =>
  isPocketCardOpened(model) || canOpenDareCard(model)

// NOTE: where a thing still missing lies, as the opened card shows it
// under its outline, by the hint rules ("Finding the dare's things, by
// difficulty" in GAME_DESIGN.md): on Dare and Double Dare, where things
// lie in plain sight, its room's id once that room's boards are down; on
// Triple Dare and Triple Dog Dare nothing, until it is found and in the
// satchel. A thing found has no room to show.
export const maybeClueRoom: {
  (kind: DareKind): (model: Model) => Option.Option<string>
  (model: Model, kind: DareKind): Option.Option<string>
} = Function.dual(2, (model: Model, kind: DareKind): Option.Option<string> => {
  if (!isThingShownOn(runDifficultyOf(model))) {
    return Option.none()
  }
  const level = levelOf(model)
  return Array.findFirst(model.dareThings, thing =>
    thing.kind === kind
      ? Option.flatMap(maybeThingRoom(thing, level), room =>
          room.isOpen ? Option.some(room.id) : Option.none(),
        )
      : Option.none(),
  )
})

export const foldPocketCard = (model: Model): Model =>
  PocketCard.matchOrElse(
    model.pocketCard,
    {
      Opened: ({ ageMs }) =>
        ageMs >= OPEN_GATE_MS ? closeDareCard(model) : model,
    },
    () => (isPocketCardTakingKeys(model) ? foldOf(model) : model),
  )

export const agePocketCard: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  PocketCard.match(model.pocketCard, {
    Pocketed: () => model,
    Reading: ({ ageMs }) =>
      ageMs + deltaMs >= READ_MS && !isPocketCardWaiting(model)
        ? foldOf(model)
        : modifyFields(model, {
            pocketCard: () => PocketCard.Reading({ ageMs: ageMs + deltaMs }),
          }),
    Folding: ({ ageMs }) =>
      modifyFields(model, {
        pocketCard: () =>
          ageMs + deltaMs >= FOLD_MS
            ? PocketCard.Pocketed()
            : PocketCard.Folding({ ageMs: ageMs + deltaMs }),
      }),
    Opened: ({ ageMs, fresh }) =>
      modifyFields(model, {
        pocketCard: () => PocketCard.Opened({ ageMs: ageMs + deltaMs, fresh }),
      }),
  }),
)
