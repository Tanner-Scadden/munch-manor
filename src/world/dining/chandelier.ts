import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS } from '../../shared/constants'
import {
  type Box,
  DOOR_OUTWARD,
  type Level,
  circleTouchesBox,
  levelOf,
  tileBox,
  tilesWithSymbol,
} from '../level/arena'
import { boxAround } from '../level/exits'
import { CHANDELIER_DROP, CHANDELIER_SYMBOL } from '../level/plan'
import { forEachSeat, modifySeat, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  Phase,
  type Vector,
  type Zombie,
} from '../schema/worldSchema'
import { ZOMBIE_BLAST_TARGET } from '../step/combat'
import { bodyRadiusOf, isGrounded } from '../zombies/zombies'

// The dining room's twist (docs/ROOM_DRAFTS.md): the chandelier hangs over
// the gap in the party table. A shot through it in a wave snaps its chain:
// it drops into the gap, crushing every zombie under it, and lies there as
// cover, blocking the gap, until the next break, when the house hoists it
// back up. It never hurts a player (owner question 5 in ROOM_DRAFTS.md is
// still open: once a wave until then). Fallen, it is the level's drop
// (LevelState.dropped), so the gap's tiles are solid for every walker,
// bullet, and path without a rule of their own.

type ChandelierRules = Readonly<{
  hungRisePx: number
  sidePx: number
  chainPx: number
  damage: number
}>

// NOTE: the hung chandelier is drawn 12 px over the gap (HUNG_RISE in
// src/render/room/diningArt.ts), so a shot strikes it there: a box as wide as
// the gap and a little more, from the chain down to the ring.
export const CHANDELIER_RULES: ChandelierRules = {
  hungRisePx: 12,
  sidePx: 3,
  chainPx: 6,
  damage: 60,
}

const gapBoxes = new WeakMap<Level, Option.Option<Box>>()

// NOTE: the gap in the table, where the chandelier lands. A level keeps its
// box, so a frame only reads it.
export const gapBoxOf = (level: Level): Option.Option<Box> => {
  const cached = gapBoxes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const box = boxAround(
    Array.map(tilesWithSymbol(level, CHANDELIER_SYMBOL), tileBox),
  )
  gapBoxes.set(level, box)
  return box
}

// NOTE: where a shot strikes the hung chandelier.
export const chandelierHitBox = (gap: Box): Box => ({
  left: gap.left - CHANDELIER_RULES.sidePx,
  top: gap.top - CHANDELIER_RULES.hungRisePx - CHANDELIER_RULES.chainPx,
  right: gap.right + CHANDELIER_RULES.sidePx,
  bottom: gap.top,
})

export const isChandelierDown = (world: World): boolean =>
  Array.contains(world.level.dropped, CHANDELIER_DROP)

const isInBox = (
  { left, top, right, bottom }: Box,
  { x, y }: Vector,
): boolean => x >= left && x < right && y >= top && y < bottom

// NOTE: a body in the gap when it falls is set down at the nearer open edge
// of it, north or south, since the table halves close its east and west.
const yOutOfGap = (gap: Box, radius: number, body: Vector): number => {
  if (!isInBox(gap, body)) {
    return body.y
  }
  return body.y < (gap.top + gap.bottom) / 2
    ? gap.top - radius
    : gap.bottom + radius
}

const crush = (world: World, gap: Box): World => {
  const isUnder = (zombie: Zombie): boolean =>
    isGrounded(zombie) && circleTouchesBox(zombie, bodyRadiusOf(zombie), gap)
  const outcomes = Array.map(world.zombies, zombie =>
    isUnder(zombie)
      ? ZOMBIE_BLAST_TARGET.hurt(zombie, {
          damage: CHANDELIER_RULES.damage,
          direction: DOOR_OUTWARD.South,
          knockbackSpeed: 0,
        })
      : { target: zombie, events: [] },
  )
  const events = Array.flatMap(outcomes, outcome => outcome.events)
  // NOTE: its kills drop keys like any other, from the tick's ZombieKilled
  // events (src/world/keys/keys.ts).
  return modifyFields(world, {
    zombies: () =>
      Array.map(outcomes, ({ target }) =>
        modifyFields(target, {
          y: () => yOutOfGap(gap, bodyRadiusOf(target), target),
        }),
      ),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
}

// NOTE: no player is ever under it when it lands: one standing in the gap is
// stepped out to its nearer edge.
const clearPlayers = (world: World, gap: Box): World =>
  forEachSeat(world, (current, slot) =>
    isInBox(gap, seatStateAt(current, slot).player)
      ? modifySeat(current, slot, {
          player: player =>
            modifyFields(player, {
              y: () => yOutOfGap(gap, PLAYER_RADIUS, player),
            }),
        })
      : current,
  )

// NOTE: a shot through the hung chandelier in a wave drops it. The bullet is
// spent on the chain.
export const dropChandelier = (world: World): World => {
  if (!Phase.isAnyOf(['Wave'])(world.phase) || isChandelierDown(world)) {
    return world
  }
  const level = levelOf(world)
  return Option.match(gapBoxOf(level), {
    onNone: () => world,
    onSome: gap => {
      const hit = chandelierHitBox(gap)
      if (!Array.some(world.bullets, bullet => isInBox(hit, bullet))) {
        return world
      }
      const fallen = modifyFields(world, {
        bullets: bullets =>
          Array.filter(bullets, bullet => !isInBox(hit, bullet)),
        level: state =>
          modifyFields(state, {
            dropped: dropped => Array.append(dropped, CHANDELIER_DROP),
          }),
        frameEvents: frameEvents => [
          ...frameEvents,
          GameEvent.ChandelierFell({
            x: (gap.left + gap.right) / 2,
            y: (gap.top + gap.bottom) / 2,
          }),
        ],
      })
      return clearPlayers(crush(fallen, gap), gap)
    },
  })
}

// NOTE: when a wave ends and its break begins, the house hoists the
// chandelier back up over the gap.
export const rehangAtBreak: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World =>
  Phase.isAnyOf(['Wave'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase) &&
  isChandelierDown(after)
    ? modifyFields(after, {
        level: state =>
          modifyFields(state, {
            dropped: dropped =>
              Array.filter(dropped, id => id !== CHANDELIER_DROP),
          }),
      })
    : after,
)
