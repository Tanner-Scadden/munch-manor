import { KITCHEN_FIRST_WAVE } from '../../shared/constants'
import type { World } from '../schema/world'
import { FridgeDoor, Party, Phase } from '../schema/worldSchema'
import { isPending } from './lessons'

// The tutorial's few rules that change the game itself, kept in the World
// so a co-op room and the determinism tools see them: the kitchen tour's
// paused break clock and free boards and pull. The steps, the tracker, and
// the markers are the client's (src/features/onboarding/kitchenTour.ts).

// NOTE: the fridge has been pulled and its prize settled: taken, left, sunk
// back, eaten, or burped out. The chapter ends here.
export const isFridgeTried = (world: World): boolean =>
  world.fridge.pulls > 0 &&
  FridgeDoor.isAnyOf(['Shut', 'Slammed'])(world.fridge.door)

// NOTE: the kitchen tour, chapter 2 of the guided tutorial (owner,
// 2026-10-30): in a new save's first timed break, the one where the
// kitchen's boards first go on sale, the break clock holds still, the
// boards are free, and so is the first pull from the fridge, until the
// player has tried the fridge. Only a player alone: a co-op room has its
// lessons learned and never holds the shared clock. A save past it has
// learned the timed breaks, so it never sees it.
export const isKitchenTourOn = (world: World): boolean =>
  Party.isAnyOf(['Solo'])(world.party) &&
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  world.phase.wave === KITCHEN_FIRST_WAVE &&
  isPending(world.lessons.timedBreaks) &&
  !isFridgeTried(world)
