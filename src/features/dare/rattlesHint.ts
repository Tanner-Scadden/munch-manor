import { Array, Function, Option } from 'effect'
import { makeModifyFieldsFor, modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import {
  type DareHint,
  DareHintCall,
  type DareHintCalling,
  KitchenCall,
  QuestTour,
  Tour,
} from '../../domain/clientSchema'
import type { Difficulty } from '../../shared/playerData'
import { type Seeded, nextRandom } from '../../shared/prng'
import { LAST_THING, isDareListDone } from '../../world/dare/dare'
import {
  DareKind,
  type DareThing,
  DareThingState,
} from '../../world/dare/dareSchema'
import { caseFootOf } from '../../world/feats/caseSpots'
import { stoveBoxOf } from '../../world/kitchen/stove'
import { levelOf } from '../../world/level/arena'
import {
  GameEvent,
  Phase,
  type Vector,
  ZombieState,
  roundWaveOf,
} from '../../world/schema/worldSchema'

// Rattles, the first daredevil (1924), who never got out, hollers about the
// dare in his bubble (LORE.md, "Rattles"). A client cosmetic read off the
// World, drawn by src/screens/game/stallBubble.ts, its picks from the
// cosmetic stream, so the World never changes. How much he helps is the
// difficulty dial (docs/ESCAPE_PLAN.md, layer 12):
//
// - Dare (Easy): a hint at a thing on the list each break, and again after a
//   rest, pointing at it.
// - Double Dare (Normal): one hint a break, pointing.
// - Triple Dare (Hard): none in the breaks. Once a marked zombie wearing a
//   thing on the list walks in, he says it is out there, pointing nowhere.
// - Triple Dog Dare (Nightmare): no hints; he heckles once a break.
//
// With the list done he hollers about the hat and the front door, the moment
// the last thing is found and in each break after. A hint about a thing in
// the house may point off screen in a break, as the kitchen holler does;
// nothing ever points at a zombie ("No off-screen hints", GAME_DESIGN.md).

export const HINT_MS = 5000
export const EASY_REST_MS = 15_000

type Lines = Array.NonEmptyReadonlyArray<string>

// NOTE: his lines, a few words each, by the thing they are about. A group
// has two lines at least, so the one just seen can always be skipped.
const THING_LINES: Readonly<Record<DareKind, Lines>> = {
  SilverSpoon: [
    "SPOON'S OVER THERE. PROBABLY.",
    'SHINY SPOON! THAT WAY!',
    'I LOST THAT SPOON IN 1924.',
  ],
  FamilyPortrait: ['YOUR PORTRAIT! GRAB IT!', 'NICE FRAME. YOURS NOW.'],
  GuestBookPage: ['A PAGE! SIGN ME IN!', 'GUEST BOOK PAGE! THERE!'],
  GrandmasRecipe: ["GRANDMA'S RECIPE! SNIFF!", 'SECRET SAUCE! THAT WAY!'],
  MusicBox: ['HEAR THAT TUNE? FOLLOW IT.', 'LA LA LAAA! THAT WAY!'],
  ButlersBell: ['DING DING! BEHIND THE BOARDS!', "BUTLER'S BELL! IN THERE!"],
  PartyHat: ['LAST THING: HIS HAT.', 'FRONT DOOR! MIND THE HAT!'],
}

// NOTE: the thing a zombie wears, said in a break with none on the field.
const MARKED_LINES: Lines = [
  'A GUEST TOOK YOUR PORTRAIT!',
  "SOMEBODY'S WEARING IT. RUDE.",
]

// NOTE: said once a zombie wearing it walks in, on Triple Dare.
const CARRIER_LINES: Lines = [
  "THAT ONE'S WEARING YOUR PORTRAIT!",
  "HE'S GOT YOUR STUFF! POP HIM!",
]

const HECKLES: Lines = [
  'NO HINTS. TRIPLE DOG DARE.',
  'I GOT THIS FAR IN 1924.',
  'HEH. GOOD LUCK, KID.',
]

// NOTE: every line with the thing its bubble shows beside it (none for a
// heckle), for the bubble to bake once.
export const HINT_LINES: ReadonlyArray<
  Readonly<{ line: string; maybeIcon: Option.Option<DareKind> }>
> = [
  ...Array.flatMap(DareKind.literals, kind =>
    Array.map(THING_LINES[kind], line => ({
      line,
      maybeIcon: Option.some(kind),
    })),
  ),
  ...Array.map([...MARKED_LINES, ...CARRIER_LINES], line => ({
    line,
    maybeIcon: Option.some<DareKind>('FamilyPortrait'),
  })),
  ...Array.map(HECKLES, line => ({ line, maybeIcon: Option.none() })),
]

// PICKING

type Hint = Readonly<{ lines: Lines; maybeThingId: Option.Option<number> }>

const FINALE: Hint = {
  lines: THING_LINES[LAST_THING],
  maybeThingId: Option.none(),
}

const HECKLE: Hint = { lines: HECKLES, maybeThingId: Option.none() }

// NOTE: a draw from the cosmetic stream as an index below `count`.
const drawIndex = (state: number, count: number): Seeded<number> => {
  const draw = nextRandom(state)
  return [draw.nextState, Math.floor(draw.value * count)]
}

// NOTE: one of the lines, never the one the player saw last.
export const pickLine: {
  (lines: Lines, lastLine: string): (state: number) => Seeded<string>
  (state: number, lines: Lines, lastLine: string): Seeded<string>
} = Function.dual(
  3,
  (state: number, lines: Lines, lastLine: string): Seeded<string> => {
    const fresh = Array.filter(lines, line => line !== lastLine)
    const pool = Array.isReadonlyArrayNonEmpty(fresh) ? fresh : lines
    const [nextState, index] = drawIndex(state, pool.length)
    return [
      nextState,
      Option.getOrElse(Array.get(pool, index), () => Array.headNonEmpty(pool)),
    ]
  },
)

// NOTE: where a thing on the list lies for the bubble to point at: its spot
// while hidden (behind the boards too, as the kitchen holler points there),
// where its carrier fell, the case it is locked in, or the stove.
const targetOf =
  (model: Model) =>
  (thing: DareThing): Option.Option<Vector> =>
    DareThingState.matchOrElse(
      thing.state,
      {
        Hidden: ({ x, y }): Option.Option<Vector> => Option.some({ x, y }),
        Dropped: ({ x, y }): Option.Option<Vector> => Option.some({ x, y }),
        InCase: ({ caseId }): Option.Option<Vector> =>
          Option.map(
            Array.findFirst(model.cases, ({ id }) => id === caseId),
            displayCase => caseFootOf(levelOf(model), displayCase),
          ),
        InStove: (): Option.Option<Vector> =>
          Option.map(stoveBoxOf(model), box => ({
            x: (box.left + box.right) / 2,
            y: box.bottom,
          })),
      },
      (): Option.Option<Vector> => Option.none(),
    )

const thingHint = (thing: DareThing): Option.Option<Hint> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: (): Option.Option<Hint> =>
        Option.some({
          lines: THING_LINES[thing.kind],
          maybeThingId: Option.some(thing.id),
        }),
      Dropped: (): Option.Option<Hint> =>
        Option.some({
          lines: THING_LINES[thing.kind],
          maybeThingId: Option.some(thing.id),
        }),
      InCase: (): Option.Option<Hint> =>
        Option.some({
          lines: THING_LINES[thing.kind],
          maybeThingId: Option.some(thing.id),
        }),
      InStove: (): Option.Option<Hint> =>
        Option.some({
          lines: THING_LINES[thing.kind],
          maybeThingId: Option.some(thing.id),
        }),
      Marked: (): Option.Option<Hint> =>
        Option.some({ lines: MARKED_LINES, maybeThingId: Option.none() }),
      Carried: (): Option.Option<Hint> =>
        Option.some({ lines: MARKED_LINES, maybeThingId: Option.none() }),
    },
    (): Option.Option<Hint> => Option.none(),
  )

// NOTE: a hint at one of the list's things still out there, drawn from the
// cosmetic stream.
const listHint = (model: Model, state: number): Seeded<Option.Option<Hint>> => {
  const hints = Array.getSomes(
    Array.map(
      Array.filter(model.dareThings, ({ isAsked }) => isAsked),
      thingHint,
    ),
  )
  if (!Array.isReadonlyArrayNonEmpty(hints)) {
    return [state, Option.none()]
  }
  const [nextState, index] = drawIndex(state, hints.length)
  return [nextState, Array.get(hints, index)]
}

const BREAK_HINTS: Readonly<
  Record<
    Difficulty,
    (model: Model, state: number) => Seeded<Option.Option<Hint>>
  >
> = {
  Easy: listHint,
  Normal: listHint,
  Hard: (_model, state) => [state, Option.none()],
  Nightmare: (_model, state) => [state, Option.some(HECKLE)],
}

const breakHint = (model: Model, state: number): Seeded<Option.Option<Hint>> =>
  isDareListDone(model)
    ? [state, Option.some(FINALE)]
    : BREAK_HINTS[model.difficulty.chosen](model, state)

// NOTE: on Triple Dare, a marked zombie wearing a thing on the list, walking
// on the field, that Rattles has not hollered about yet.
const maybeFreshCarrier = (model: Model): Option.Option<number> =>
  model.difficulty.chosen === 'Hard' && !isDareListDone(model)
    ? Array.findFirst(model.dareThings, ({ isAsked, state }) =>
        isAsked &&
        DareThingState.isAnyOf(['Carried'])(state) &&
        state.zombieId !== model.dareHint.carrierId &&
        Array.some(
          model.zombies,
          zombie =>
            zombie.id === state.zombieId &&
            ZombieState.isAnyOf(['Walking'])(zombie.state),
        )
          ? Option.some(state.zombieId)
          : Option.none(),
      )
    : Option.none()

// THE CALL

const isBreak = Phase.isAnyOf(['Preparation'])

const hasList = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.dare.list)

// NOTE: he keeps quiet while the kitchen holler or a tour has the bubble.
const isHushed = (model: Model): boolean =>
  KitchenCall.isAnyOf(['Calling'])(model.kitchenCall) ||
  Tour.isAnyOf(['Running'])(model.kitchenTour) ||
  QuestTour.isAnyOf(['Running', 'Looking'])(model.firstBreakQuest)

const modifyHint = makeModifyFieldsFor<DareHint>()

type HintChange = Parameters<typeof modifyHint>[1]

const withHint = (model: Model, change: HintChange): Model =>
  modifyFields(model, { dareHint: hint => modifyHint(hint, change) })

const startCall = (model: Model, hint: Hint, change: HintChange): Model => {
  const [state, line] = pickLine(
    model.cosmeticRngState,
    hint.lines,
    model.dareHint.lastLine,
  )
  return modifyFields(model, {
    cosmeticRngState: () => state,
    dareHint: current =>
      modifyHint(modifyHint(current, change), {
        call: () =>
          DareHintCall.Calling({
            line,
            maybeThingId: hint.maybeThingId,
            wave: roundWaveOf(model.phase),
            isBreak: isBreak(model.phase),
            remainingMs: HINT_MS,
          }),
      }),
  })
}

const isThingGone = (model: Model, maybeThingId: Option.Option<number>) =>
  Option.match(maybeThingId, {
    onNone: () => false,
    onSome: id =>
      Option.isNone(
        Option.flatMap(
          Array.findFirst(model.dareThings, thing => thing.id === id),
          targetOf(model),
        ),
      ),
  })

const advanceCalling = (
  model: Model,
  call: DareHintCalling,
  frameMs: number,
): Model => {
  const remainingMs = call.remainingMs - frameMs
  const isOver =
    remainingMs <= 0 ||
    isBreak(model.phase) !== call.isBreak ||
    roundWaveOf(model.phase) !== call.wave ||
    isThingGone(model, call.maybeThingId)
  return withHint(
    model,
    isOver
      ? {
          lastLine: () => call.line,
          restMs: () => EASY_REST_MS,
          call: () => DareHintCall.Quiet(),
        }
      : { call: () => DareHintCall.Calling({ ...call, remainingMs }) },
  )
}

const callInBreak = (model: Model, wave: number, frameMs: number): Model => {
  const hint = model.dareHint
  const isFirst = hint.calledWave < wave
  const isAgain =
    !isFirst && model.difficulty.chosen === 'Easy' && hint.restMs - frameMs <= 0
  if (!isFirst && !isAgain) {
    return withHint(model, {
      restMs: restMs => Math.max(0, restMs - frameMs),
    })
  }
  const [state, maybeHint] = breakHint(model, model.cosmeticRngState)
  return Option.match(maybeHint, {
    onNone: () =>
      withHint(model, {
        calledWave: () => wave,
        restMs: () => EASY_REST_MS,
      }),
    onSome: picked =>
      startCall(
        modifyFields(model, { cosmeticRngState: () => state }),
        picked,
        {
          calledWave: () => wave,
        },
      ),
  })
}

const callInWave = (model: Model): Model =>
  Option.match(maybeFreshCarrier(model), {
    onNone: () => model,
    onSome: carrierId =>
      startCall(
        model,
        { lines: CARRIER_LINES, maybeThingId: Option.none() },
        { carrierId: () => carrierId },
      ),
  })

const isListDoneThisFrame = (model: Model): boolean =>
  Array.some(model.frameEvents, GameEvent.isAnyOf(['DareListDone']))

const advanceQuiet = (model: Model, frameMs: number): Model => {
  if (isHushed(model)) {
    return model
  }
  return Phase.isAnyOf(['Preparation'])(model.phase)
    ? callInBreak(model, model.phase.wave, frameMs)
    : callInWave(model)
}

// NOTE: one frame of Rattles' hints, after the kitchen holler's, so the
// holler has the bubble first in a break that has both.
export const advanceDareHint: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model => {
  if (!hasList(model)) {
    return model
  }
  if (isListDoneThisFrame(model)) {
    return startCall(model, FINALE, {
      calledWave: calledWave =>
        isBreak(model.phase) ? roundWaveOf(model.phase) : calledWave,
    })
  }
  return DareHintCall.match(model.dareHint.call, {
    Calling: call => advanceCalling(model, call, frameMs),
    Quiet: () =>
      Phase.isAnyOf(['Preparation', 'Wave'])(model.phase)
        ? advanceQuiet(model, frameMs)
        : model,
  })
})

// READING

export type HintCall = Readonly<{
  line: string
  maybeTarget: Option.Option<Vector>
}>

// NOTE: what he says now, and where it points: the thing it is about, or
// nowhere, when the bubble hangs from his own spot.
export const maybeHintCall = (model: Model): Option.Option<HintCall> =>
  DareHintCall.matchOrElse(
    model.dareHint.call,
    {
      Calling: ({ line, maybeThingId }): Option.Option<HintCall> =>
        Option.some({
          line,
          maybeTarget: Option.flatMap(maybeThingId, id =>
            Option.flatMap(
              Array.findFirst(model.dareThings, thing => thing.id === id),
              targetOf(model),
            ),
          ),
        }),
    },
    (): Option.Option<HintCall> => Option.none(),
  )
