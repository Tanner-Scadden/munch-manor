// What the end report (tools/balance/endReport.ts) reads of a run: where
// it stopped, read off its last frame, and the trace of each Uncle Chunk
// fight: the bot's hearts and its distance to him each second, the time in
// his slam's reach, the time crowded by other zombies, and the hearts the
// crowd took while he stood.

import { Array, Function, Option } from 'effect'

import {
  HuntStep,
  huntPlan,
  shutExitsOnTheList,
} from '../../../src/features/bots/dareSearch'
import { maybeThingRoom } from '../../../src/world/dare/dare'
import { DareThingState } from '../../../src/world/dare/dareSchema'
import { heldKeys } from '../../../src/world/keys/keys'
import { levelOf } from '../../../src/world/level/arena'
import { focusOf, focusSlotOf } from '../../../src/world/party/party'
import { CaseState } from '../../../src/world/schema/worldSchema'
import { BOSS_RULES } from '../../../src/world/zombies/bossRules'
import { FRAME_MS, type Kind, type Model, distance } from './basics'
import { type BossLog, PRESSURE_PX, emptyBossBlame } from './logs'
import type { RunEnd } from './results'

type BossFight = BossLog[number]

// NOTE: other zombies this close count as a crowd in his fight.
const CROWD = 3

export const emptyBossFight = (wave: number): BossFight => ({
  wave,
  arrived: false,
  felled: false,
  fightMs: 0,
  diedToIt: false,
  stomps: 0,
  stompHits: 0,
  belches: 0,
  charges: 0,
  chargeHits: 0,
  bonks: 0,
  spits: 0,
  spitHits: 0,
  enraged: false,
  heartsLost: 0,
  heartsByAttack: emptyBossBlame(),
  damageTaken: 0,
  aimedMs: 0,
  hpBySecond: [],
  distanceBySecond: [],
  nearMs: 0,
  crowdedMs: 0,
  crowdHurtBy: {},
})

const isUp = (zombie: Model['zombies'][number]) => zombie.state._tag !== 'Dying'

// NOTE: Uncle Chunk himself, in view or not.
const chunkOf = (model: Model) => {
  const { boss } = model
  return boss._tag === 'Fighting'
    ? Option.getOrUndefined(
        Array.findFirst(model.zombies, zombie => zombie.id === boss.id),
      )
    : undefined
}

// Adds one frame of his fight, after its fightMs has counted it. `blamed`
// is the kind charged with the hearts lost this frame, and `byBoss` whether
// one of his attacks or his bite took them.
export const traceChunk = ({
  fight,
  model,
  lost,
  blamed,
  byBoss,
}: {
  readonly fight: BossFight
  readonly model: Model
  readonly lost: number
  readonly blamed: Kind | undefined
  readonly byBoss: boolean
}): void => {
  const chunk = chunkOf(model)
  if (chunk === undefined) {
    return
  }
  const { player } = focusOf(model)
  const gap = distance(player, chunk)
  while (fight.hpBySecond.length * 1000 < fight.fightMs) {
    fight.hpBySecond.push(player.hp)
    fight.distanceBySecond.push(Math.round(gap))
  }
  fight.nearMs += gap <= BOSS_RULES.slamRadius ? FRAME_MS : 0
  const crowd = Array.filter(
    model.zombies,
    zombie =>
      zombie.id !== chunk.id &&
      isUp(zombie) &&
      distance(player, zombie) <= PRESSURE_PX,
  ).length
  fight.crowdedMs += crowd >= CROWD ? FRAME_MS : 0
  if (lost > 0 && !byBoss) {
    const kind = blamed ?? 'Unknown'
    fight.crowdHurtBy[kind] = (fight.crowdHurtBy[kind] ?? 0) + lost
  }
}

// NOTE: where the run stopped, from its last frame.
export const runEndOf: {
  (maxRunMs: number): (model: Model) => RunEnd
  (model: Model, maxRunMs: number): RunEnd
} = Function.dual(2, (model: Model, maxRunMs: number): RunEnd => {
  const level = levelOf(model)
  const hidden = Array.filter(model.dareThings, thing =>
    DareThingState.isAnyOf(['Hidden'])(thing.state),
  )
  const rooms = Array.flatMap(hidden, thing =>
    Option.toArray(maybeThingRoom(thing, level)),
  )
  const behindBoards = Array.filter(rooms, ({ isOpen }) => !isOpen).length
  const isListDone = hidden.length === 0
  const wave =
    model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
      ? model.phase.wave
      : model.stats.wavesCleared + 1
  const slot = focusSlotOf(model)
  return {
    stop:
      model.phase._tag === 'Escaped'
        ? 'Escaped'
        : model.stats.runMs >= maxRunMs && focusOf(model).player.hp > 0
          ? 'TimedOut'
          : model.boss._tag === 'Fighting'
            ? 'DiedToChunk'
            : isListDone
              ? 'DiedListDone'
              : 'DiedHunting',
    plan: HuntStep.match(huntPlan(model, focusOf(model).player), {
      Leave: () => 'Leave',
      Fetch: () => 'Fetch',
      Light: () => 'Light',
      Open: ({ price }) => `Open ${price}`,
      Save: ({ short }) => `Save ${short}`,
      Done: () => 'Done',
    }),
    wave,
    listLength: model.dareThings.length,
    found: model.dareThings.length - hidden.length,
    behindBoards,
    hiddenInOpen: rooms.length - behindBoards,
    shutBoards: shutExitsOnTheList(model).length,
    keysHeld: heldKeys(model),
    casesWaiting: Array.filter(
      model.cases,
      ({ state }) => CaseState.isAnyOf(['Opened'])(state) && state.by === slot,
    ).length,
    casesLocked: Array.filter(model.cases, ({ state }) =>
      CaseState.isAnyOf(['Locked'])(state),
    ).length,
  }
})
