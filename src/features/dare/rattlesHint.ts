import { Array, Function, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  type DareHint,
  DareHintCall,
  type DareHintCalling,
  KitchenCall,
  QuestTour,
  RattlesIntro,
  Tour,
} from '#domain/clientSchema.ts'
import { runDifficultyOf } from '#domain/onlineRun.ts'
import { evolveFor } from '#shared/evolve.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { type Seeded, drawIndex, pickLine } from '#shared/prng.ts'
import {
  isDareListDone,
  isInOpenRoom,
  maybeThingRoom,
} from '#world/dare/dare.ts'
import {
  DareKind,
  type DareThing,
  DareThingState,
} from '#world/dare/dareSchema.ts'
import { levelOf } from '#world/level/arena.ts'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '#world/level/plan.ts'
import {
  GameEvent,
  Phase,
  type Vector,
  roundWaveOf,
} from '#world/schema/worldSchema.ts'

import { isThingShownOn } from './dareView.ts'
import { isPocketCardOut } from './pocketCard.ts'

export const HINT_MS = 5000
export const EASY_REST_MS = 15_000

type Lines = Array.NonEmptyReadonlyArray<string>

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

const FINALE_LINES: Lines = ["CHUNK'S GOT THE BIG KEY.", 'BEAT HIM. THEN RUN!']

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

const roomLinesOf = (kind: DareKind, room: string): Lines => {
  const where = ROOM_WORDS[room] ?? 'BOARDS'
  return [
    `${THING_WORDS[kind]}? TRY THE ${where}.`,
    `THE ${where}! ${THING_WORDS[kind]}'S IN THERE.`,
  ]
}

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

type Hint = Readonly<{ lines: Lines; maybeThingId: Option.Option<number> }>

const FINALE: Hint = {
  lines: FINALE_LINES,
  maybeThingId: Option.none(),
}

const HECKLE: Hint = { lines: HECKLES, maybeThingId: Option.none() }

const targetOf = (thing: DareThing): Option.Option<Vector> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: ({ x, y }): Option.Option<Vector> => Option.some({ x, y }),
    },
    (): Option.Option<Vector> => Option.none(),
  )

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

const isBreak = Phase.isAnyOf(['Preparation'])

const hasList = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.dare.list)

const isHushed = (model: Model): boolean =>
  isPocketCardOut(model) ||
  RattlesIntro.isAnyOf(['Talking'])(model.rattlesIntro) ||
  KitchenCall.isAnyOf(['Calling'])(model.kitchenCall) ||
  Tour.isAnyOf(['Running'])(model.kitchenTour) ||
  QuestTour.isAnyOf(['Running', 'Looking', 'Starting'])(model.firstBreakQuest)

const modifyHint = evolveFor<DareHint>()

type HintChange = Parameters<typeof modifyHint>[1]

const withHint = (model: Model, change: HintChange): Model =>
  UiStruct.evolve(model, { dareHint: hint => modifyHint(hint, change) })

const startCall = (model: Model, hint: Hint, change: HintChange): Model => {
  const [state, line] = pickLine(
    model.cosmetics.cosmeticRngState,
    hint.lines,
    model.dareHint.lastLine,
  )
  return UiStruct.evolve(model, {
    dareHint: current =>
      modifyHint(modifyHint(current, change), {
        call: () =>
          DareHintCall.Calling({
            line,
            maybeThingId: hint.maybeThingId,
            wave: roundWaveOf(model.phase),
            isBreak: isBreak(model.phase),
            endsAtMs: model.elapsedMs + HINT_MS,
          }),
      }),
    cosmetics: UiStruct.evolve({ cosmeticRngState: () => state }),
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

const advanceCalling = (model: Model, call: DareHintCalling): Model => {
  const isOver =
    model.elapsedMs >= call.endsAtMs ||
    isBreak(model.phase) !== call.isBreak ||
    roundWaveOf(model.phase) !== call.wave ||
    isThingGone(model, call.maybeThingId)
  return isOver
    ? withHint(model, {
        lastLine: () => call.line,
        restMs: () => EASY_REST_MS,
        call: () => DareHintCall.Quiet(),
      })
    : model
}

const callInBreak = (model: Model, wave: number, frameMs: number): Model => {
  const hint = model.dareHint
  const isFirst = hint.calledWave < wave
  const isEasy = runDifficultyOf(model) === 'Easy'
  const isAgain = !isFirst && isEasy && hint.restMs - frameMs <= 0
  if (!isFirst && !isAgain) {
    return isEasy
      ? withHint(model, {
          restMs: restMs => Math.max(0, restMs - frameMs),
        })
      : model
  }
  const [state, maybeHint] = breakHint(model, model.cosmetics.cosmeticRngState)
  return Option.match(maybeHint, {
    onNone: () =>
      withHint(model, {
        calledWave: () => wave,
        restMs: () => EASY_REST_MS,
      }),
    onSome: picked =>
      startCall(
        UiStruct.evolve(model, {
          cosmetics: UiStruct.evolve({ cosmeticRngState: () => state }),
        }),
        picked,
        {
          calledWave: () => wave,
        },
      ),
  })
}

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
    Calling: call => advanceCalling(noticed.model, call),
    Quiet: () =>
      Phase.isAnyOf(['Preparation', 'Wave'])(noticed.model.phase)
        ? advanceQuiet(noticed.model, frameMs)
        : noticed.model,
  })
})

export type HintCall = Readonly<{
  line: string
  maybeTarget: Option.Option<Vector>
}>

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
