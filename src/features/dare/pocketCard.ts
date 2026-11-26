import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { PocketCard } from '#domain/clientSchema.ts'
import { isRunOn, runDifficultyOf } from '#domain/onlineRun.ts'
import { PAD_SELECT } from '#input/gamepad.ts'
import { dareCardOf, maybeThingRoom } from '#world/dare/dare.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { levelOf } from '#world/level/arena.ts'
import { isPending, learn } from '#world/run/lessons.ts'
import { Phase, isRoundActive } from '#world/schema/worldSchema.ts'

import { isThingShownOn } from './dareView.ts'

export const UNFOLD_MS = 400
export const READ_MS = 4_500
export const FOLD_MS = 900
export const GATE_MS = 1_500

export const cardThingsOf = (model: Model): ReadonlyArray<DareKind> =>
  Array.map(dareCardOf(model), ({ kind }) => kind)

export const FIND_AT_MS = UNFOLD_MS + 200
const FIRST_THING_AT_MS = UNFOLD_MS + 450
const THING_GAP_MS = 320
const OUT_AFTER_MS = 300

export const thingAtMs = (index: number): number =>
  FIRST_THING_AT_MS + index * THING_GAP_MS

export const outAtMs = (count: number): number =>
  thingAtMs(Math.max(0, count - 1)) + OUT_AFTER_MS

const scratchTimesOf = (count: number): ReadonlyArray<number> => [
  ...Array.makeBy(count, thingAtMs),
  outAtMs(count),
]

const thingCountOf = (model: Model): number => cardThingsOf(model).length

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

export const isPocketCardWaiting = (model: Model): boolean =>
  isPending(model.lessons.dareCard) && !isRunOn(model)

export const promptAtMs = (model: Model): number =>
  Math.max(GATE_MS, outAtMs(thingCountOf(model)))

export const isPocketCardReading = (model: Model): boolean =>
  PocketCard.isAnyOf(['Reading'])(model.pocketCard)

export const isPocketCardOut = (model: Model): boolean =>
  !PocketCard.isAnyOf(['Pocketed'])(model.pocketCard)

export const isPocketCardOpened = (model: Model): boolean =>
  PocketCard.isAnyOf(['Opened'])(model.pocketCard)

export const isPocketCardBlocking = (model: Model): boolean =>
  !isRunOn(model) &&
  ((isPocketCardReading(model) &&
    Phase.isAnyOf(['Preparation'])(model.phase)) ||
    isPocketCardOpened(model))

export const raisePocketCardFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  Phase.isAnyOf(['Arriving'])(before.phase) &&
  !Phase.isAnyOf(['Arriving'])(after.phase) &&
  dareCardOf(after).length > 0
    ? UiStruct.evolve(after, {
        pocketCard: () => PocketCard.Reading({ ageMs: 0 }),
      })
    : after,
)

const foldOf = (model: Model): Model =>
  UiStruct.evolve(model, {
    pocketCard: () => PocketCard.Folding({ ageMs: 0 }),
    lessons: lessons =>
      isRunOn(model)
        ? lessons
        : UiStruct.evolve(lessons, {
            dareCard: lesson => learn(lesson, model.elapsedMs),
          }),
  })

const isPocketCardTakingKeys = (model: Model): boolean =>
  PocketCard.matchOrElse(
    model.pocketCard,
    {
      Reading: ({ ageMs }) =>
        ageMs >= (isPocketCardWaiting(model) ? GATE_MS : UNFOLD_MS),
    },
    () => false,
  )

export const isPocketCardHeld = (model: Model): boolean =>
  isPocketCardReading(model) && !isPocketCardTakingKeys(model)

const OPEN_GATE_MS = 150

const DARE_CARD_KEYS: ReadonlyArray<string> = ['Tab', PAD_SELECT]

export const isDareCardKey = (code: string): boolean =>
  Array.contains(DARE_CARD_KEYS, code)

const canOpenDareCard = (model: Model): boolean =>
  isRoundActive(model.phase) &&
  Array.isReadonlyArrayNonEmpty(dareCardOf(model)) &&
  PocketCard.isAnyOf(['Pocketed'])(model.pocketCard)

const foundKindsOf = (model: Model): ReadonlyArray<DareKind> =>
  Array.map(
    Array.filter(dareCardOf(model), ({ isFound }) => isFound),
    ({ kind }) => kind,
  )

const openDareCard = (model: Model): Model => {
  if (!canOpenDareCard(model)) {
    return model
  }
  const found = foundKindsOf(model)
  return UiStruct.evolve(model, {
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
    ? UiStruct.evolve(model, { pocketCard: () => PocketCard.Pocketed() })
    : model

export const toggleDareCard = (model: Model): Model =>
  isPocketCardOpened(model) ? closeDareCard(model) : openDareCard(model)

export const isDareCardToggling = (model: Model): boolean =>
  isPocketCardOpened(model) || canOpenDareCard(model)

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
        : UiStruct.evolve(model, {
            pocketCard: () => PocketCard.Reading({ ageMs: ageMs + deltaMs }),
          }),
    Folding: ({ ageMs }) =>
      UiStruct.evolve(model, {
        pocketCard: () =>
          ageMs + deltaMs >= FOLD_MS
            ? PocketCard.Pocketed()
            : PocketCard.Folding({ ageMs: ageMs + deltaMs }),
      }),
    Opened: ({ ageMs, fresh }) =>
      UiStruct.evolve(model, {
        pocketCard: () => PocketCard.Opened({ ageMs: ageMs + deltaMs, fresh }),
      }),
  }),
)
