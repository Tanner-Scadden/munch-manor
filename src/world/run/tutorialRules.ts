import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { KITCHEN_FIRST_WAVE, OPEN_BREAK_WAVE } from '../../shared/constants'
import { caseFootOf, isCaseShown } from '../feats/caseSpots'
import { grantKeys } from '../keys/keys'
import { levelOf } from '../level/arena'
import { isStanding, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  type DisplayCase,
  Feat,
  FridgeDoor,
  Party,
  Phase,
  SOLO_SLOT,
  type Vector,
} from '../schema/worldSchema'
import { distanceBetween } from '../step/geometry'
import { isPending, learn } from './lessons'

// The tutorial's few rules that change the game itself, kept in the World
// so a co-op room and the determinism tools see them: the dare tour's
// skeleton key on the floor and its easy display case, and the kitchen
// tour's paused break clock and free boards and pull. The steps, the
// tracker, and the markers are the client's
// (src/features/onboarding/firstBreakQuest.ts and kitchenTour.ts).

const isSolo = (world: World): boolean => Party.isAnyOf(['Solo'])(world.party)

// THE DARE TOUR

// NOTE: the guided first break (docs/ESCAPE_PLAN.md, layer 16): a new
// player alone, in the open break before wave 2, while the dare tour lesson
// is pending. It is learned when the tour ends or is skipped, and saved, so
// a returning player never sees any of it.
export const DARE_TOUR_WAVE = OPEN_BREAK_WAVE

export const isDareTourBreak = (world: World): boolean =>
  isSolo(world) &&
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  world.phase.wave === DARE_TOUR_WAVE &&
  isPending(world.lessons.dareTour)

type TutorialRules = Readonly<{
  keyDropPx: number
  keyReachPx: number
  caseKills: number
}>

// NOTE: the key lies a step below where the run started, the middle of
// the dining room, on the floor between the table's halves; the easy case
// asks for 5 kills, which the practice wave always gives.
const TUTORIAL_RULES: TutorialRules = {
  keyDropPx: 14,
  keyReachPx: 8,
  caseKills: 5,
}

export const tutorialKeySpotOf = (world: World): Vector => {
  const { start } = levelOf(world)
  return { x: start.x, y: start.y + TUTORIAL_RULES.keyDropPx }
}

// NOTE: the tour's own skeleton key waits on the floor until it is taken.
export const isTutorialKeyOut = (world: World): boolean =>
  isDareTourBreak(world) && isPending(world.lessons.dareKey)

// NOTE: one tick of the tour's key: walking onto it puts it on the ring and
// learns the key lesson, so it lies there once per save.
export const advanceTutorialKey = (world: World): World => {
  if (!isTutorialKeyOut(world)) {
    return world
  }
  const spot = tutorialKeySpotOf(world)
  const { seat, player } = seatStateAt(world, SOLO_SLOT)
  return isStanding(seat) &&
    distanceBetween(player, spot) <= TUTORIAL_RULES.keyReachPx
    ? modifyFields(grantKeys(world, 1, spot), {
        lessons: lessons =>
          modifyFields(lessons, {
            dareKey: lesson => learn(lesson, world.elapsedMs),
          }),
      })
    : world
}

const distanceToStart = (world: World, displayCase: DisplayCase): number =>
  distanceBetween(caseFootOf(levelOf(world), displayCase), levelOf(world).start)

// NOTE: the display case nearest where the run starts, among those standing
// in an open room: the one the tour opens.
export const maybeTutorialCase = (world: World): Option.Option<DisplayCase> =>
  pipe(
    world.cases,
    Array.filter(displayCase => isCaseShown(levelOf(world), displayCase)),
    Array.sort((first: DisplayCase, second: DisplayCase) =>
      distanceToStart(world, first) <= distanceToStart(world, second) ? -1 : 1,
    ),
    Array.head,
  )

// NOTE: a new player's run starts with the nearest case asking only for a
// few kills, so it springs open in the practice wave and the tour can walk
// them up to it. Its prize stays the roll's.
export const rigTutorialCase = (world: World): World =>
  isSolo(world) && isPending(world.lessons.dareTour)
    ? Option.match(maybeTutorialCase(world), {
        onNone: () => world,
        onSome: ({ id }) =>
          modifyFields(world, {
            cases: Array.map(displayCase =>
              displayCase.id === id
                ? modifyFields(displayCase, {
                    feat: () => Feat.Kills({ count: TUTORIAL_RULES.caseKills }),
                  })
                : displayCase,
            ),
          }),
      })
    : world

// THE KITCHEN TOUR

// NOTE: the fridge has been pulled and its prize settled: taken, left, sunk
// back, eaten, or burped out. The chapter ends here.
export const isFridgeTried = (world: World): boolean =>
  world.fridge.pulls > 0 &&
  FridgeDoor.isAnyOf(['Shut', 'Slammed'])(world.fridge.door)

// NOTE: the kitchen tour, chapter 2 of the guided tutorial (owner,
// 2026-10-30): in a new save's break before wave 3, the one where the
// kitchen's boards first open for keys, the break clock holds still, the
// boards are free, and so is the first pull from the fridge, until the
// player has tried the fridge. Only a player alone: a co-op room has its
// lessons learned and never holds the shared clock. A save past it has
// learned the timed breaks lesson (learned as that break ends, timed or
// not, src/world/waves/waves.ts), so it never sees it.
export const isKitchenTourOn = (world: World): boolean =>
  isSolo(world) &&
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  world.phase.wave === KITCHEN_FIRST_WAVE &&
  isPending(world.lessons.timedBreaks) &&
  !isFridgeTried(world)
