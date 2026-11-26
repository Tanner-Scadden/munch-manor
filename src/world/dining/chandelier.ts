import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { PLAYER_RADIUS } from '../../shared/constants'
import { type Level, levelOf } from '../level/arena'
import { boxAround } from '../level/exits'
import { CHANDELIER_DROP, CHANDELIER_SYMBOL } from '../level/plan'
import {
  type Box,
  DOOR_OUTWARD,
  circleTouchesBox,
  tileBox,
  tilesWithSymbol,
} from '../level/tileGrid'
import { forEachSeat, modifySeat, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  Phase,
  type Vector,
  type Zombie,
} from '../schema/worldSchema'
import { ZOMBIE_BLAST_TARGET } from '../step/combat'
import { isInsideBox } from '../step/geometry'
import { bodyRadiusOf, isGrounded } from '../zombies/zombies'

type ChandelierRules = Readonly<{
  hungRisePx: number
  sidePx: number
  chainPx: number
  damage: number
}>

export const CHANDELIER_RULES: ChandelierRules = {
  hungRisePx: 12,
  sidePx: 3,
  chainPx: 6,
  damage: 60,
}

const gapBoxes = new WeakMap<Level, Option.Option<Box>>()

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

export const chandelierHitBox = (gap: Box): Box => ({
  left: gap.left - CHANDELIER_RULES.sidePx,
  top: gap.top - CHANDELIER_RULES.hungRisePx - CHANDELIER_RULES.chainPx,
  right: gap.right + CHANDELIER_RULES.sidePx,
  bottom: gap.top,
})

export const isChandelierDown = (world: World): boolean =>
  Array.contains(world.level.dropped, CHANDELIER_DROP)

const yOutOfGap = (gap: Box, radius: number, body: Vector): number => {
  if (!isInsideBox(body, gap)) {
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
  return UiStruct.evolve(world, {
    zombies: () =>
      Array.map(outcomes, ({ target }) =>
        UiStruct.evolve(target, {
          y: () => yOutOfGap(gap, bodyRadiusOf(target), target),
        }),
      ),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
}

const clearPlayers = (world: World, gap: Box): World =>
  forEachSeat(world, (current, slot) =>
    isInsideBox(seatStateAt(current, slot).player, gap)
      ? modifySeat(current, slot, {
          player: player =>
            UiStruct.evolve(player, {
              y: () => yOutOfGap(gap, PLAYER_RADIUS, player),
            }),
        })
      : current,
  )

export const dropChandelier = (world: World): World => {
  if (!Phase.isAnyOf(['Wave'])(world.phase) || isChandelierDown(world)) {
    return world
  }
  const level = levelOf(world)
  return Option.match(gapBoxOf(level), {
    onNone: () => world,
    onSome: gap => {
      const hit = chandelierHitBox(gap)
      if (!Array.some(world.bullets, bullet => isInsideBox(bullet, hit))) {
        return world
      }
      const fallen = UiStruct.evolve(world, {
        bullets: bullets =>
          Array.filter(bullets, bullet => !isInsideBox(bullet, hit)),
        level: state =>
          UiStruct.evolve(state, {
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

export const hoistChandelier = (world: World): World =>
  UiStruct.evolve(world, {
    level: state =>
      UiStruct.evolve(state, {
        dropped: dropped => Array.filter(dropped, id => id !== CHANDELIER_DROP),
      }),
  })

export const rehangAtBreak: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World =>
  Phase.isAnyOf(['Wave'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase) &&
  isChandelierDown(after)
    ? hoistChandelier(after)
    : after,
)
