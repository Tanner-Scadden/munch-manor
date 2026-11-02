// Named Models for Story and Scene tests, and the changes tests make to one
// most often. A test starts from one with `given(...)`, so the setup it does
// not care about reads as a name, and the steps it is about stay in the test.
// Steps and locators live in `testing.ts`.

import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  LEVEL_SPECS,
  type Level,
  PARLOUR,
  levelFor,
  levelOf,
  openExitIn,
} from './arena'
import { PLAYER_MAX_HP, PREPARATION_MS } from './constants'
import { biteGraceScale } from './difficulty'
import { KITCHEN_EXIT } from './exits'
import { fridgeBoxOf, pickPrize, prizeWeights } from './leftovers'
import {
  type Bullet,
  DifficultyCard,
  type FridgePrize,
  Lesson,
  Loading,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
  initialModel,
} from './model'
import { seatCrew, withSeat } from './party'
import { nextRandom } from './prng'
import { grantedVeteran } from './rank'
import { freshRun } from './runReset'
import { STALL_BOX } from './shop'
import { PHONE_PORTRAIT, SURFACE, zombieOf } from './testing'
import { asVeteran } from './veteran'
import { freshGun } from './weapons'
import { type World, withWorld } from './world'
import { Arsenal, type Life, type WeaponKind } from './worldSchema'

// The stretch of the blink after a bite on Normal, where the named Models
// play: a bite's invulnerability is the base times this.
// NOTE: every level the game builds, shut and with all its exits open.
export const EVERY_LEVEL: ReadonlyArray<Level> = Array.flatMap(
  Object.values(LEVEL_SPECS),
  spec => [
    levelFor(spec),
    levelFor(
      spec,
      Array.map(spec.exits, ({ id }) => id),
    ),
  ],
)

export const NORMAL_BITE_GRACE = biteGraceScale('Normal')

// SPAWNS

export const plannedSpawn = (atMs: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
})

// NOTE: a spawn planned so far out that it never comes, so a wave that holds
// it stays in progress with only the zombies a test puts in the room.
export const DISTANT_SPAWN: PlannedSpawn = plannedSpawn(1e9)

// PHASES

// NOTE: wave 2 under way, and the break before it, each holding a spawn
// that never comes.
export const WAVE_2_FIGHT = Phase.Wave({
  wave: 2,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const WAVE_2_BREAK = Phase.Preparation({
  wave: 2,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [DISTANT_SPAWN],
})

// NOTE: the break before wave 3, with nothing planned.
export const WAVE_3_BREAK = Phase.Preparation({
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

// HOME

// NOTE: a returning player on the home menu: the tutorial is done, so no
// lesson or first-run card gets in the way.
export const home: Model = asVeteran(initialModel)

// NOTE: the home menu once the save has been read, so the menu's buttons are
// up. A save that was read has been granted its veteran start (0 here).
export const homeAfterRead: Model = modifyFields(home, {
  saveStatus: () => 'Read',
  rank: rank => grantedVeteran(rank, 0),
})

// NOTE: a returning player on a measured surface, ready to start a run.
export const readyModel: Model = modifyFields(home, {
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a new player on a measured surface: the tutorial is still ahead.
export const newPlayerReady: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a new player on a measured surface who has picked a difficulty, so
// the card does not come up.
export const newPlayerCardSeen: Model = modifyFields(initialModel, {
  difficultyCard: () => DifficultyCard.Seen(),
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a returning player on a measured surface once the save has been
// read.
export const readyAfterRead: Model = modifyFields(home, {
  maybeSurface: () => Option.some(SURFACE),
  saveStatus: () => 'Read',
  rank: rank => grantedVeteran(rank, 0),
})

// NOTE: the boot splash, still reading the save.
export const loadingSave: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
  loading: () => Loading.Loading({ pending: ['Save'] }),
})

// FIGHTING

export const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

export const veteranFighting: Model = modifyFields(home, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

// A wave in progress on a measured surface, with nothing coming in.
export const quietWave = (wave: number): Model =>
  modifyFields(initialModel, {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

// NOTE: past the first break's lesson, so a Plank Pile has its price (a
// new save's first one is free, see isFirstPlankFree in src/shop.ts).
export const pastFirstBreak = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  })

// NOTE: past the kitchen tour's break, so the break before wave 3 counts
// down and the kitchen and the fridge have their prices (the tour holds the
// clock and gives them away in a new save, see src/tutorialRules.ts).
export const pastTimedBreaks = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { timedBreaks: () => Lesson.Learned({ atMs: 0 }) }),
  })

export const withActors = (
  base: Model,
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(base, {
    zombies: () => zombies,
    bullets: () => bullets,
  })

export const withPlayerAt = (base: Model, x: number, y: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { x: () => x, y: () => y }),
  })

export const withArsenal = (base: Model, arsenal: Arsenal): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { arsenal: () => arsenal }),
  })

// NOTE: changes one seat of a co-op World held in the Model.
export const atSeat = (
  current: Model,
  slot: number,
  change: (world: World) => World,
): Model => withWorld(current, world => withSeat(world, slot, change))

// SCREENS

export const inPortrait = (model: Model): Model =>
  modifyFields(model, {
    orientation: () => 'Portrait',
    maybeSurface: () => Option.some(PHONE_PORTRAIT),
  })

export const withNewerBuild = (model: Model): Model =>
  modifyFields(model, { maybeNewerBuild: () => Option.some('newer-build') })

// MYSTERY LEFTOVERS

// NOTE: a fresh run with the kitchen open and the player at the fridge's
// door in a break, for the fridge's Story tests.
export function freshRunModel(): Model {
  const veteran = asVeteran(initialModel)
  return modifyFields(
    { ...veteran, ...freshRun(veteran) },
    {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    },
  )
}

const fridgeBox = Option.getOrThrow(
  fridgeBoxOf(
    levelOf({ level: openExitIn(freshRunModel().level, KITCHEN_EXIT) }),
  ),
)

export const AT_FRIDGE = {
  x: (fridgeBox.left + fridgeBox.right) / 2,
  y: fridgeBox.bottom + 8,
}

export const atFridge = (balance: number, wave = 5): Model =>
  modifyFields(freshRunModel(), {
    level: level => openExitIn(level, KITCHEN_EXIT),
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 120_000,
        durationMs: 120_000,
        spawns: [DISTANT_SPAWN],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player =>
      modifyFields(player, { x: () => AT_FRIDGE.x, y: () => AT_FRIDGE.y }),
  })

// THE AMMO WINDOW

const BELOW_STALL = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.bottom + 6,
}

// NOTE: the Pop Pistol first and `kind` in the hands with `rounds` left.
const holdingSecond = (kind: WeaponKind, rounds: number): Arsenal =>
  Arsenal.HoldingSecond({
    first: freshGun('Pistol'),
    second: modifyFields(freshGun(kind), { rounds: () => rounds }),
  })

// NOTE: mid-wave at the stall's ammo window (src/ammoCounter.ts).
export const midWaveAtStall = (
  kind: WeaponKind,
  rounds: number,
  balance = 100,
): Model =>
  modifyFields(freshRunModel(), {
    phase: () =>
      Phase.Wave({
        wave: 5,
        elapsedMs: 20_000,
        spawns: [DISTANT_SPAWN],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player =>
      modifyFields(player, {
        x: () => BELOW_STALL.x,
        y: () => BELOW_STALL.y,
        arsenal: () => holdingSecond(kind, rounds),
      }),
  })

// NOTE: a fridge whose stream's next draw lands on `prize`, found by trying
// seeds, so a test can ask for each prize without knowing the stream.
export const fridgeSeededFor = (current: Model, prize: FridgePrize): Model => {
  const seed = Option.getOrThrow(
    Array.findFirst(
      Array.makeBy(500, index => index + 1),
      candidate =>
        pickPrize(
          prizeWeights(current.fridge, current.player),
          nextRandom(candidate).value,
        ) === prize,
    ),
  )
  return modifyFields(current, {
    loot: loot => modifyFields(loot, { fridgeRngState: () => seed }),
  })
}

// NOTE: typed as the Wave it is, not as any Phase, so a test can pause it
// as a round.
export const FIGHTING_PHASE = Phase.Wave({
  wave: 1,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const playingModel: Model = modifyFields(readyModel, {
  phase: () => FIGHTING_PHASE,
})

export const withZombies = (
  base: Model,
  zombies: ReadonlyArray<Zombie>,
): Model => modifyFields(base, { zombies: () => zombies })

// CO-OP CREWS

// NOTE: wave 3 under way with a spawn that never comes, for a crew's tests.
const CREW_WAVE = Phase.Wave({
  wave: 3,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

// NOTE: a crew of `count` seats in one World, on a surface, mid-wave.
export const crewInWave = (count: number, phase: Phase = CREW_WAVE): Model =>
  withWorld(
    modifyFields(home, {
      maybeSurface: () => Option.some(SURFACE),
      phase: () => phase,
    }),
    world => seatCrew(world, count),
  )

export const placeSeat =
  (slot: number, x: number, y: number, hp = PLAYER_MAX_HP) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyFields(world, {
        player: player =>
          modifyFields(player, { x: () => x, y: () => y, hp: () => hp }),
      }),
    )

export const withSeatLife =
  (slot: number, life: Life) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyFields(world, {
        party: party =>
          party._tag === 'Crew'
            ? modifyFields(party, {
                lead: lead => modifyFields(lead, { life: () => life }),
              })
            : party,
      }),
    )

// NOTE: changes made to a Model one after another, in order.
export const pipeline =
  (...steps: ReadonlyArray<(current: Model) => Model>) =>
  (start: Model): Model =>
    Array.reduce(steps, start, (current, step) => step(current))

// NOTE: one heart left and a zombie on the player, so the next tick bites.
export const lastHeart = (base: Model): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { hp: () => 1 }),
    zombies: () => [
      zombieOf('Runner', 100, PARLOUR.width / 2 + 2, PARLOUR.height / 2),
    ],
  })
