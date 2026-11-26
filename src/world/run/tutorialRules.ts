import { Array, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

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

const isSolo = (world: World): boolean => Party.isAnyOf(['Solo'])(world.party)

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

const TUTORIAL_RULES: TutorialRules = {
  keyDropPx: 14,
  keyReachPx: 8,
  caseKills: 5,
}

export const tutorialKeySpotOf = (world: World): Vector => {
  const { start } = levelOf(world)
  return { x: start.x, y: start.y + TUTORIAL_RULES.keyDropPx }
}

export const isTutorialKeyOut = (world: World): boolean =>
  isDareTourBreak(world) && isPending(world.lessons.dareKey)

export const advanceTutorialKey = (world: World): World => {
  if (!isTutorialKeyOut(world)) {
    return world
  }
  const spot = tutorialKeySpotOf(world)
  const { seat, player } = seatStateAt(world, SOLO_SLOT)
  return isStanding(seat) &&
    distanceBetween(player, spot) <= TUTORIAL_RULES.keyReachPx
    ? UiStruct.evolve(grantKeys(world, 1, spot), {
        lessons: lessons =>
          UiStruct.evolve(lessons, {
            dareKey: lesson => learn(lesson, world.elapsedMs),
          }),
      })
    : world
}

const distanceToStart = (world: World, displayCase: DisplayCase): number =>
  distanceBetween(caseFootOf(levelOf(world), displayCase), levelOf(world).start)

export const maybeTutorialCase = (world: World): Option.Option<DisplayCase> =>
  pipe(
    world.cases,
    Array.filter(displayCase => isCaseShown(levelOf(world), displayCase)),
    Array.sort((first: DisplayCase, second: DisplayCase) =>
      distanceToStart(world, first) <= distanceToStart(world, second) ? -1 : 1,
    ),
    Array.head,
  )

export const rigTutorialCase = (world: World): World =>
  isSolo(world) && isPending(world.lessons.dareTour)
    ? Option.match(maybeTutorialCase(world), {
        onNone: () => world,
        onSome: ({ id }) =>
          UiStruct.evolve(world, {
            cases: Array.map(displayCase =>
              displayCase.id === id
                ? UiStruct.evolve(displayCase, {
                    feat: () => Feat.Kills({ count: TUTORIAL_RULES.caseKills }),
                  })
                : displayCase,
            ),
          }),
      })
    : world

export const isFridgeTried = (world: World): boolean =>
  world.fridge.pulls > 0 &&
  FridgeDoor.isAnyOf(['Shut', 'Slammed'])(world.fridge.door)

export const isKitchenTourOn = (world: World): boolean =>
  isSolo(world) &&
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  world.phase.wave === KITCHEN_FIRST_WAVE &&
  isPending(world.lessons.timedBreaks) &&
  !isFridgeTried(world)
