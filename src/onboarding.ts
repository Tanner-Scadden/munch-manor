import { Array, Option, Result, Schema, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { screenCameraOf, worldToView } from './camera'
import { type HintBand, type InputDevice, Stick, Tour } from './clientSchema'
import { vectorLength } from './geometry'
import { isPending, isTimedBreak, learn } from './lessons'
import type { Model } from './model'
import { landscapeFrameOffset, screenOf } from './screen'
import { TURRET_WEAPON, maybeSelectedKind } from './traps'
import { isKitchenTourOn } from './tutorialRules'
import { isBreak } from './waves'
import {
  BreakClock,
  DebutCard,
  GameEvent,
  Lesson,
  type Lessons,
  Phase,
  type Practice,
  TrapHint,
  type ZombieKind,
} from './worldSchema'
import { ZOMBIE_KIND_ORDER } from './zombies'

// LESSONS

const learnWhen = (isDone: boolean, atMs: number) => (lesson: Lesson) =>
  isDone ? learn(lesson, atMs) : lesson

export const isLearned = (lesson: Lesson): boolean =>
  Lesson.isAnyOf(['Learned'])(lesson)

const hasPlayerFired = (events: ReadonlyArray<GameEvent>): boolean =>
  Array.some(
    events,
    event =>
      GameEvent.isAnyOf(['Fired'])(event) && event.weapon !== TURRET_WEAPON,
  )

const MOVE_LESSON_PX = 24
const AIM_LESSON_SHOTS = 3
export const LESSON_MIN_SHOWN_MS = 2500

const distanceWalked = (before: Model, after: Model): number =>
  vectorLength(after.intent.move) > 0
    ? Math.hypot(
        after.player.x - before.player.x,
        after.player.y - before.player.y,
      )
    : 0

const hasFiredWhileAiming = (model: Model): boolean =>
  hasPlayerFired(model.frameEvents) && Option.isSome(model.intent.maybeAim)

const hasGrabbedPickup = (events: ReadonlyArray<GameEvent>): boolean =>
  Array.some(events, GameEvent.isAnyOf(['PickupGrabbed']))

const practise = (before: Model, after: Model): Practice => ({
  movedPx: after.practice.movedPx + distanceWalked(before, after),
  aimedShots: after.practice.aimedShots + (hasFiredWhileAiming(after) ? 1 : 0),
})

// NOTE: the lessons keep their reference on a frame that learns nothing, so
// the save check sees at a glance that nothing saved changed.
const learnFromPractice = (
  lessons: Lessons,
  practice: Practice,
  after: Model,
): Lessons => {
  const isShownLongEnough = after.elapsedMs >= LESSON_MIN_SHOWN_MS
  const move = learnWhen(
    isShownLongEnough && practice.movedPx >= MOVE_LESSON_PX,
    after.elapsedMs,
  )(lessons.move)
  const fire = learnWhen(
    isShownLongEnough && practice.aimedShots >= AIM_LESSON_SHOTS,
    after.elapsedMs,
  )(lessons.fire)
  const pickup = learnWhen(
    hasGrabbedPickup(after.frameEvents),
    after.elapsedMs,
  )(lessons.pickup)
  return move === lessons.move &&
    fire === lessons.fire &&
    pickup === lessons.pickup
    ? lessons
    : { ...lessons, move, fire, pickup }
}

export const learnFromFrame = (before: Model, after: Model): Model => {
  const practice = practise(before, after)
  return modifyFields(after, {
    practice: () => practice,
    lessons: lessons => learnFromPractice(lessons, practice, after),
  })
}

// PRACTICE GATE

// DEBUT CARD

export const DEBUT_CARD_MIN_MS = 600
export const DEBUT_CARD_MS = 3000

const maybeDebutKind = (model: Model): Option.Option<ZombieKind> =>
  Phase.match(model.phase, {
    Ready: () => Option.none(),
    Preparation: () => Option.none(),
    Wave: ({ spawns }) =>
      Array.findFirst(
        ZOMBIE_KIND_ORDER,
        kind =>
          !Array.contains(model.introducedKinds, kind) &&
          Array.some(spawns, spawn => spawn.kind === kind),
      ),
    Paused: () => Option.none(),
    Victory: () => Option.none(),
    GameOver: () => Option.none(),
  })

export const raiseDebutCard = (model: Model): Model =>
  modifyFields(model, {
    debutCard: () =>
      Option.match(maybeDebutKind(model), {
        onNone: () => DebutCard.Hidden(),
        onSome: kind => DebutCard.Showing({ kind, ageMs: 0 }),
      }),
  })

// NOTE: a wave that just started raises the card for any kind in it the
// player has not met yet.
export const raiseDebutCardFrom = (before: Model, after: Model): Model =>
  Phase.isAnyOf(['Preparation'])(before.phase) &&
  Phase.isAnyOf(['Wave'])(after.phase)
    ? raiseDebutCard(after)
    : after

export const isDebutCardUp = (model: Model): boolean =>
  DebutCard.isAnyOf(['Showing'])(model.debutCard)

const finishDebutCard = (model: Model, kind: ZombieKind): Model =>
  raiseDebutCard(modifyFields(model, { introducedKinds: Array.append(kind) }))

export const ageDebutCard = (model: Model, deltaMs: number): Model =>
  DebutCard.match(model.debutCard, {
    Hidden: () => model,
    Showing: ({ kind, ageMs }) =>
      ageMs + deltaMs >= DEBUT_CARD_MS
        ? finishDebutCard(model, kind)
        : modifyFields(model, {
            debutCard: () =>
              DebutCard.Showing({ kind, ageMs: ageMs + deltaMs }),
          }),
  })

export const canSkipDebutCard = (model: Model): boolean =>
  DebutCard.match(model.debutCard, {
    Hidden: () => false,
    Showing: ({ ageMs }) => ageMs >= DEBUT_CARD_MIN_MS,
  })

export const skipDebutCard = (model: Model): Model =>
  DebutCard.match(model.debutCard, {
    Hidden: () => model,
    Showing: ({ kind, ageMs }) =>
      ageMs < DEBUT_CARD_MIN_MS ? model : finishDebutCard(model, kind),
  })

export const learnShop = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { shop: lesson => learn(lesson, model.elapsedMs) }),
  })

export const learnSwap = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { swap: lesson => learn(lesson, model.elapsedMs) }),
  })

export const learnStartWave = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        startWave: lesson => learn(lesson, model.elapsedMs),
      }),
  })

const settle = (lesson: Lesson): Lesson =>
  Lesson.match(lesson, {
    Pending: () => lesson,
    Learned: () => Lesson.Learned({ atMs: 0 }),
  })

export const settleLessons = (lessons: Lessons): Lessons =>
  modifyFields(lessons, {
    move: settle,
    fire: settle,
    startWave: settle,
    shop: settle,
    swap: settle,
    pickup: settle,
    timedBreaks: settle,
    openBreak: settle,
  })

// BAND

const TOP_BAND_LEAVE_Y = 70
const BOTTOM_BAND_LEAVE_Y = 86

const followPlayer = (band: HintBand, playerY: number): HintBand => {
  if (band === 'Top' && playerY < TOP_BAND_LEAVE_Y) {
    return 'Bottom'
  } else if (band === 'Bottom' && playerY > BOTTOM_BAND_LEAVE_Y) {
    return 'Top'
  } else {
    return band
  }
}

// NOTE: the bands are drawn in the landscape frame, so the player is
// measured there too, whatever the window's zoom.
export const moveHintBand = (model: Model): Model =>
  modifyFields(model, {
    hintBand: band =>
      followPlayer(
        band,
        worldToView(screenCameraOf(model), model.player).y -
          landscapeFrameOffset(screenOf(model)).y,
      ),
  })

// HINTS

// NOTE: hints float only for the controls themselves: moving and aiming in
// wave 1 on a keyboard, and the key that places a trap once one is bought.
// Everything else is taught where the player acts, never as a label in the
// middle of the room, which a playtester took for a place to walk to: the
// stall waves and calls with a bubble (src/stallBubble.ts), START WAVE and
// the other gun pulse (src/touchControls.ts, src/hud.ts), a goodie wears a
// bouncing arrow (src/powerupView.ts), and the break's countdown blinks.
export const HintId = Schema.Literals(['Move', 'Fire', 'Barricade', 'Turret'])
export type HintId = typeof HintId.Type

// NOTE: a hint shows instead of explaining: a small moving picture of the
// key, mouse, thumb, or thing to use, and at most three words. A part with no
// words is a picture that leads into the next part, such as the T key before
// the planks. How to play draws the same pictures (src/pauseHelp.ts).
export const HintIcon = Schema.Literals([
  'Wasd',
  'Mouse',
  'MoveStick',
  'AimStick',
  'Tap',
  'KeyT',
  'KeyQ',
  'Goodie',
  'PlankDoor',
  'Gnome',
  'Guns',
  'Stall',
])
export type HintIcon = typeof HintIcon.Type

export type HintPart = Readonly<{ icon: HintIcon; words: string }>

type HintParts = Array.NonEmptyReadonlyArray<HintPart>

const part = (icon: HintIcon, words = ''): HintPart => ({ icon, words })

export const HINT_PARTS: Readonly<
  Record<HintId, Readonly<Record<InputDevice, HintParts>>>
> = {
  Move: {
    KeyboardMouse: [part('Wasd', 'MOVE')],
    Touch: [part('MoveStick', 'MOVE')],
  },
  Fire: {
    KeyboardMouse: [part('Mouse', 'AIM + SHOOT')],
    Touch: [part('AimStick', 'AIM + SHOOT')],
  },
  Barricade: {
    KeyboardMouse: [part('KeyT'), part('PlankDoor', 'BLOCK DOOR')],
    Touch: [part('Tap'), part('PlankDoor', 'BLOCK DOOR')],
  },
  Turret: {
    KeyboardMouse: [part('KeyT'), part('Gnome', 'PLONK IT')],
    Touch: [part('Tap'), part('Gnome', 'PLONK IT')],
  },
}

export const hintWords = (id: HintId, device: InputDevice): string =>
  pipe(
    HINT_PARTS[id][device],
    Array.map(({ words }) => words),
    Array.filter(String.isNonEmpty),
    Array.join(' '),
  )

export const hintIcons = (
  id: HintId,
  device: InputDevice,
): ReadonlyArray<HintIcon> =>
  Array.map(HINT_PARTS[id][device], ({ icon }) => icon)

export type ShownHint = Readonly<{ id: HintId; ageMs: number }>

const MAX_HINTS = 2

export const msIntoPhase = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 0,
    Preparation: ({ remainingMs, durationMs, clock }) =>
      BreakClock.match(clock, {
        Counting: () => durationMs - remainingMs,
        Waiting: ({ elapsedMs }) => elapsedMs,
      }),
    Wave: ({ elapsedMs }) => elapsedMs,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

const isFirstWave = (phase: Phase): boolean =>
  Phase.match(phase, {
    Ready: () => false,
    Preparation: ({ wave }) => wave === 1,
    Wave: ({ wave }) => wave === 1,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

type HintRule = Readonly<{
  id: HintId
  maybeAgeMs: (model: Model) => Option.Option<number>
}>

const ageWhen = (isShown: boolean, ageMs: number): Option.Option<number> =>
  isShown ? Option.some(ageMs) : Option.none()

const isBreakWith = (
  model: Model,
  isWanted: (wave: number, clock: BreakClock) => boolean,
): boolean =>
  Phase.match(model.phase, {
    Ready: () => false,
    Preparation: ({ wave, clock }) => isWanted(wave, clock),
    Wave: () => false,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

export const isOpenBreak = (model: Model): boolean =>
  isBreakWith(model, (_wave, clock) => BreakClock.isAnyOf(['Waiting'])(clock))

const isLaterTimedBreak = (model: Model): boolean =>
  isBreakWith(model, isTimedBreak)

const isTrapHintFor = (model: Model, kind: 'Barricade' | 'Turret'): boolean =>
  isBreak(model) &&
  TrapHint.isAnyOf(['Showing'])(model.trapHint) &&
  Option.contains(maybeSelectedKind(model), kind)

// NOTE: on touch the ghost sticks, drawn where the thumbs go, teach moving
// and shooting, so the center hints for them show only with a keyboard.
const isFirstWaveOnKeyboard = (model: Model): boolean =>
  isFirstWave(model.phase) && model.lastDevice === 'KeyboardMouse'

const HINT_RULES: ReadonlyArray<HintRule> = [
  {
    id: 'Move',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWaveOnKeyboard(model) && isPending(model.lessons.move),
        model.elapsedMs,
      ),
  },
  {
    id: 'Fire',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWaveOnKeyboard(model) && isPending(model.lessons.fire),
        model.elapsedMs,
      ),
  },
  {
    id: 'Barricade',
    maybeAgeMs: model =>
      ageWhen(isTrapHintFor(model, 'Barricade'), msIntoPhase(model.phase)),
  },
  {
    id: 'Turret',
    maybeAgeMs: model =>
      ageWhen(isTrapHintFor(model, 'Turret'), msIntoPhase(model.phase)),
  },
]

// NOTE: START WAVE pulses once the player has moved and fired, until they
// first start a wave themselves.
export const isStartWaveBeckoning = ({
  phase,
  lessons,
  firstBreakQuest,
}: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(phase) &&
  ((isPending(lessons.startWave) &&
    isLearned(lessons.move) &&
    isLearned(lessons.fire)) ||
    Tour.isAnyOf(['Done'])(firstBreakQuest))

// NOTE: the first timed break's countdown blinks, so the player sees the
// clock is running.
export const isCountdownBeckoning = (model: Model): boolean =>
  isLaterTimedBreak(model) &&
  isPending(model.lessons.timedBreaks) &&
  !isKitchenTourOn(model)

// NOTE: a goodie on the floor wears a bouncing arrow until the player has
// grabbed one.
export const isGoodieBeckoning = (model: Model): boolean =>
  isPending(model.lessons.pickup)

export const shownHints = (model: Model): ReadonlyArray<ShownHint> =>
  isDebutCardUp(model)
    ? []
    : pipe(
        HINT_RULES,
        Array.filterMap(({ id, maybeAgeMs }) =>
          Option.match(maybeAgeMs(model), {
            onNone: () => Result.failVoid,
            onSome: ageMs => Result.succeed({ id, ageMs }),
          }),
        ),
        Array.take(MAX_HINTS),
      )

// GHOST STICKS

export const GhostStick = Schema.Literals(['Move', 'Aim'])
export type GhostStick = typeof GhostStick.Type

const isIdle = Stick.isAnyOf(['Idle'])

type GhostRule = Readonly<{
  ghost: GhostStick
  isShown: (model: Model) => boolean
}>

const GHOST_RULES: ReadonlyArray<GhostRule> = [
  {
    ghost: 'Move',
    isShown: ({ lessons, input }) =>
      isPending(lessons.move) && isIdle(input.moveStick),
  },
  {
    ghost: 'Aim',
    isShown: ({ lessons, input }) =>
      isPending(lessons.fire) && isIdle(input.aimStick),
  },
]

export const shownGhostSticks = (model: Model): ReadonlyArray<GhostStick> => {
  if (
    model.lastDevice !== 'Touch' ||
    !isFirstWave(model.phase) ||
    isDebutCardUp(model)
  ) {
    return []
  }

  return Array.filterMap(GHOST_RULES, ({ ghost, isShown }) =>
    isShown(model) ? Result.succeed(ghost) : Result.failVoid,
  )
}
