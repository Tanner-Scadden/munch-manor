import { Array, Function, Option, Result } from 'effect'
import { makeModifyFieldsFor, modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import {
  type DareHint,
  DareHintCall,
  type DareHintCalling,
  KitchenCall,
  QuestTour,
  RattlesIntro,
  Tour,
} from '../../domain/clientSchema'
import { runDifficultyOf } from '../../domain/onlineRun'
import type { Difficulty } from '../../shared/playerData'
import { type Seeded, drawIndex, pickLine } from '../../shared/prng'
import {
  isDareListDone,
  isInOpenRoom,
  maybeThingRoom,
} from '../../world/dare/dare'
import {
  DareKind,
  type DareThing,
  DareThingState,
} from '../../world/dare/dareSchema'
import { levelOf } from '../../world/level/arena'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../world/level/plan'
import {
  GameEvent,
  Phase,
  type Vector,
  roundWaveOf,
} from '../../world/schema/worldSchema'
import { isThingShownOn } from './dareView'
import { isPocketCardOut } from './pocketCard'

// Rattles, the first daredevil (1924), who never got out, hollers about the
// dare in his bubble (LORE.md, "Rattles"). A client cosmetic read off the
// World, drawn by src/screens/game/stallBubble.ts, its picks from the
// cosmetic stream, so the World never changes. How much he helps is the
// difficulty dial (docs/ESCAPE_PLAN.md, layer 12):
//
// - Dare (Easy): a hint at a thing on the list each break, and again after a
//   rest, pointing at it.
// - Double Dare (Normal): one hint a break, pointing.
// - Triple Dare (Hard): none.
// - Triple Dog Dare (Nightmare): no hints; he heckles once a break.
//
// Each room holds one thing (src/world/dare/dare.ts), so while its room is
// still boarded he names the room ("BELL? TRY THE CELLAR."), and once it is
// open, the thing. With the list done he hollers about Uncle Chunk's big
// key and the front door, the moment the last thing is found and in each
// break after. A hint
// about a thing in the house may point off screen in a break, as the kitchen
// holler does; nothing ever points at a zombie ("No off-screen hints",
// GAME_DESIGN.md). The HUD's list never says where a thing is: only he does.

export const HINT_MS = 5000
export const EASY_REST_MS = 15_000

type Lines = Array.NonEmptyReadonlyArray<string>

// NOTE: his lines, a few words each, by the thing they are about. A group
// has two lines at least, so the one just seen can always be skipped.
// Every line names the thing, beside its icon in the bubble, and the gold
// arrow (./darePointer.ts) shows where: never a bare "THAT WAY".
const THING_LINES: Readonly<Record<DareKind, Lines>> = {
  SilverSpoon: ['SILVER SPOON! GRAB IT!', 'I LOST THAT SPOON IN 1924.'],
  FamilyPortrait: ['YOUR PORTRAIT! GRAB IT!', 'THE PORTRAIT! NICE FRAME.'],
  GuestBookPage: ['A PAGE! SIGN ME IN!', 'GUEST BOOK PAGE! GET IT!'],
  GrandmasRecipe: ["GRANDMA'S RECIPE! SNIFF!", 'SECRET RECIPE! GRAB IT!'],
  MusicBox: ['MUSIC BOX! HEAR THAT?', 'LA LA LAAA! MUSIC BOX!'],
  ButlersBell: ["BUTLER'S BELL! DING DING!", 'THE BELL! RIGHT THERE!'],
  NapkinRing: ['NAPKIN RING! GRAB IT!', 'HE CHEWED THAT RING. EW.'],
  DareNote: ['MY OLD DARE NOTE! GET IT!', 'I WROTE THAT IN 1924!'],
  FalseTeeth: ['FALSE TEETH! THEY BITE!', "GRANDMA'S TEETH! GET 'EM!"],
  Invitation: ['THE INVITATION! GRAB IT!', 'PARTY INVITE! DO NOT RSVP!'],
}

// NOTE: with the list done: Uncle Chunk is coming, and his key is the way
// out.
const FINALE_LINES: Lines = ["CHUNK'S GOT THE BIG KEY.", 'BEAT HIM. THEN RUN!']

// NOTE: each thing and room in his words, for the line that names the room
// a thing lies in while its boards still stand.
const THING_WORDS: Readonly<Record<DareKind, string>> = {
  SilverSpoon: 'SPOON',
  FamilyPortrait: 'PORTRAIT',
  GuestBookPage: 'PAGE',
  GrandmasRecipe: 'RECIPE',
  MusicBox: 'MUSIC BOX',
  ButlersBell: 'BELL',
  NapkinRing: 'NAPKIN RING',
  DareNote: 'DARE NOTE',
  FalseTeeth: 'TEETH',
  Invitation: 'INVITATION',
}

const ROOM_WORDS: Readonly<Record<string, string>> = {
  [KITCHEN_ROOM_ID]: 'KITCHEN',
  [PARLOUR_ROOM_ID]: 'PARLOUR',
  [LIBRARY_ROOM_ID]: 'LIBRARY',
  [CELLAR_ROOM_ID]: 'CELLAR',
  [DINING_ROOM_ID]: 'DINING ROOM',
}

// NOTE: two lines a room, so the one just seen can be skipped.
const roomLinesOf = (kind: DareKind, room: string): Lines => {
  const where = ROOM_WORDS[room] ?? 'BOARDS'
  return [
    `${THING_WORDS[kind]}? TRY THE ${where}.`,
    `THE ${where}! ${THING_WORDS[kind]}'S IN THERE.`,
  ]
}

// NOTE: the line for a room the moment its boards come down, with the
// thing inside: one each, as nothing came before it.
const revealLineOf = (kind: DareKind): string =>
  `${THING_WORDS[kind]}! IN HERE!`

const ROOM_IDS: ReadonlyArray<string> = [
  KITCHEN_ROOM_ID,
  PARLOUR_ROOM_ID,
  LIBRARY_ROOM_ID,
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
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
  ...Array.flatMap(DareKind.literals, (kind: DareKind) =>
    Array.flatMap(ROOM_IDS, room =>
      Array.map(roomLinesOf(kind, room), line => ({
        line,
        maybeIcon: Option.some(kind),
      })),
    ),
  ),
  ...Array.map(DareKind.literals, (kind: DareKind) => ({
    line: revealLineOf(kind),
    maybeIcon: Option.some(kind),
  })),
  ...Array.map([...HECKLES, ...FINALE_LINES], line => ({
    line,
    maybeIcon: Option.none(),
  })),
]

// PICKING

type Hint = Readonly<{ lines: Lines; maybeThingId: Option.Option<number> }>

const FINALE: Hint = {
  lines: FINALE_LINES,
  maybeThingId: Option.none(),
}

const HECKLE: Hint = { lines: HECKLES, maybeThingId: Option.none() }

// NOTE: where a thing on the list lies for the bubble to point at: its spot
// while hidden (behind the boards too, as the kitchen holler points there).
const targetOf = (thing: DareThing): Option.Option<Vector> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: ({ x, y }): Option.Option<Vector> => Option.some({ x, y }),
    },
    (): Option.Option<Vector> => Option.none(),
  )

// NOTE: a thing still hidden: its room while the boards stand, else the
// thing itself.
const thingHint =
  (model: Model) =>
  (thing: DareThing): Option.Option<Hint> => {
    if (!DareThingState.isAnyOf(['Hidden'])(thing.state)) {
      return Option.none()
    }
    const level = levelOf(model)
    const roomLines = Option.match(maybeThingRoom(thing, level), {
      onNone: (): Lines => THING_LINES[thing.kind],
      onSome: ({ id }): Lines => roomLinesOf(thing.kind, id),
    })
    return Option.some({
      lines: isInOpenRoom(level, thing.state)
        ? THING_LINES[thing.kind]
        : roomLines,
      maybeThingId: Option.some(thing.id),
    })
  }

// NOTE: a hint at one of the list's things still out there, drawn from the
// cosmetic stream.
const listHint = (model: Model, state: number): Seeded<Option.Option<Hint>> => {
  const hints = Array.getSomes(Array.map(model.dareThings, thingHint(model)))
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
    : BREAK_HINTS[runDifficultyOf(model)](model, state)

// THE CALL

const isBreak = Phase.isAnyOf(['Preparation'])

const hasList = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.dare.list)

// NOTE: he keeps quiet while the kitchen holler, his own hello, or a tour
// has the bubble, and while the dare card in your pocket is out.
const isHushed = (model: Model): boolean =>
  isPocketCardOut(model) ||
  RattlesIntro.isAnyOf(['Talking'])(model.rattlesIntro) ||
  KitchenCall.isAnyOf(['Calling'])(model.kitchenCall) ||
  Tour.isAnyOf(['Running'])(model.kitchenTour) ||
  QuestTour.isAnyOf(['Running', 'Looking', 'Starting'])(model.firstBreakQuest)

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
          targetOf,
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
    !isFirst && runDifficultyOf(model) === 'Easy' && hint.restMs - frameMs <= 0
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

// A ROOM OPENED

// NOTE: on Dare and Double Dare, the moment a room's boards come down
// Rattles shows what is inside: the thing's icon and its name in his
// bubble over it, and the gold arrow over it (./darePointer.ts). Read off
// the level's open rooms against the ones seen last frame, so a co-op
// teammate's boards show it for the whole crew; a run's first frame (or a
// teammate joining mid-run) only takes the rooms already open. Only where
// things lie in plain sight (./dareView.ts).
const openRoomIds = (model: Model): ReadonlyArray<string> =>
  Array.filterMap(levelOf(model).rooms, ({ id, isOpen }) =>
    isOpen ? Result.succeed(id) : Result.failVoid,
  )

const revealOf = (thing: DareThing): Hint => ({
  lines: [revealLineOf(thing.kind)],
  maybeThingId: Option.some(thing.id),
})

const maybeRevealIn = (
  model: Model,
  fresh: ReadonlyArray<string>,
): Option.Option<Hint> => {
  if (
    !isThingShownOn(runDifficultyOf(model)) ||
    isHushed(model) ||
    !Phase.isAnyOf(['Preparation', 'Wave'])(model.phase)
  ) {
    return Option.none()
  }
  const level = levelOf(model)
  return Option.map(
    Array.findFirst(
      model.dareThings,
      thing =>
        DareThingState.isAnyOf(['Hidden'])(thing.state) &&
        Option.exists(maybeThingRoom(thing, level), ({ id }) =>
          Array.contains(fresh, id),
        ),
    ),
    revealOf,
  )
}

type Noticed = Readonly<{ model: Model; isRevealed: boolean }>

const noticeOpenedRooms = (model: Model): Noticed => {
  const open = openRoomIds(model)
  return Option.match(model.dareHint.maybeOpenRooms, {
    onNone: () => ({
      model: withHint(model, { maybeOpenRooms: () => Option.some(open) }),
      isRevealed: false,
    }),
    onSome: (seen): Noticed => {
      if (open.length === seen.length) {
        return { model, isRevealed: false }
      }
      const synced = withHint(model, {
        maybeOpenRooms: () => Option.some(open),
      })
      return Option.match(
        maybeRevealIn(
          synced,
          Array.filter(open, id => !Array.contains(seen, id)),
        ),
        {
          onNone: () => ({ model: synced, isRevealed: false }),
          onSome: reveal => ({
            model: startCall(synced, reveal, {}),
            isRevealed: true,
          }),
        },
      )
    },
  })
}

const isListDoneThisFrame = (model: Model): boolean =>
  Array.some(model.frameEvents, GameEvent.isAnyOf(['DareListDone']))

const advanceQuiet = (model: Model, frameMs: number): Model => {
  if (isHushed(model)) {
    return model
  }
  return Phase.isAnyOf(['Preparation'])(model.phase)
    ? callInBreak(model, model.phase.wave, frameMs)
    : model
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
  const noticed = noticeOpenedRooms(model)
  if (noticed.isRevealed) {
    return noticed.model
  }
  return DareHintCall.match(noticed.model.dareHint.call, {
    Calling: call => advanceCalling(noticed.model, call, frameMs),
    Quiet: () =>
      Phase.isAnyOf(['Preparation', 'Wave'])(noticed.model.phase)
        ? advanceQuiet(noticed.model, frameMs)
        : noticed.model,
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
              targetOf,
            ),
          ),
        }),
    },
    (): Option.Option<HintCall> => Option.none(),
  )
