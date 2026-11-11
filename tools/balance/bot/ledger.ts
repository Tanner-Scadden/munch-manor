// What the end report (tools/balance/endReport.ts) reads of a run's keys
// and of the crowd's bites: where each key on the ring came from (kills,
// a cleared wave, a wiped pack, the pantry, the fridge's Dud) and where it
// went (boards, the fridge), the ring at each break, and each heart the
// crowd took outside Uncle Chunk's fight, with what the bot was doing then
// and how many zombies stood near.

import { Array, Function } from 'effect'

import { KEY_RULES } from '../../../src/world/keys/keys'
import { focusOf } from '../../../src/world/party/party'
import { FRAME_MS, type Kind, type Model, distance } from './basics'
import { PRESSURE_PX } from './logs'
import type { CrowdHurt, Doing } from './results'

type MutableLedger = {
  kills: number
  clears: number
  wipes: number
  pantry: number
  dud: number
  boards: number
  fridge: number
  chandelierDrops: number
  heldAtBreak: Array<number>
  foundAtBreak: Array<number>
}

type MutableHurt = { -readonly [Field in keyof CrowdHurt]: CrowdHurt[Field] }

export type Ledger = MutableLedger & {
  hurts: Array<MutableHurt>
  doingMs: Array<{ wave: number; doing: Record<string, number> }>
}

export const emptyLedger = (): Ledger => ({
  kills: 0,
  clears: 0,
  wipes: 0,
  pantry: 0,
  dud: 0,
  boards: 0,
  fridge: 0,
  chandelierDrops: 0,
  heldAtBreak: [],
  foundAtBreak: [],
  hurts: [],
  doingMs: [],
})

// NOTE: the ring as a break begins, before the bot spends.
export const recordBreak: {
  (model: Model): (ledger: Ledger) => void
  (ledger: Ledger, model: Model): void
} = Function.dual(2, (ledger: Ledger, model: Model): void => {
  ledger.heldAtBreak.push(model.keys.held)
  ledger.foundAtBreak.push(model.keys.found)
})

const countOf = (model: Model, tag: string) =>
  Array.filter(model.frameEvents, event => event._tag === tag).length

// Charges one frame's keys to their source and their spending to what
// was bought. What no other source explains came from kills.
export const recordKeys: {
  (before: Model, after: Model): (ledger: Ledger) => void
  (ledger: Ledger, before: Model, after: Model): void
} = Function.dual(3, (ledger: Ledger, before: Model, after: Model): void => {
  const found = after.keys.found - before.keys.found
  const clears = Array.reduce(after.frameEvents, 0, (sum, event) =>
    event._tag === 'WaveCleared' ? sum + event.keys : sum,
  )
  const wipes = countOf(after, 'PackWiped') * KEY_RULES.perPackWiped
  const pantry = Array.some(
    after.frameEvents,
    event => event._tag === 'PantryTaken' && event.goodie === 'Key',
  )
    ? Math.max(0, found - clears - wipes)
    : 0
  const dud = Array.reduce(after.frameEvents, 0, (sum, event) =>
    event._tag === 'DudBurped' ? sum + event.refund : sum,
  )
  ledger.clears += clears
  ledger.chandelierDrops += countOf(after, 'ChandelierFell')
  ledger.wipes += wipes
  ledger.pantry += pantry
  ledger.dud += dud
  ledger.kills += Math.max(0, found - clears - wipes - pantry - dud)
  const spent = before.keys.held + found - after.keys.held
  if (spent > 0) {
    if (countOf(after, 'ExitOpened') > 0) {
      ledger.boards += spent
    } else {
      ledger.fridge += spent
    }
  }
})

// NOTE: what the bot was doing on a frame of a wave.
export const doingOf = ({
  model,
  isFetching,
  isWorking,
}: {
  readonly model: Model
  readonly isFetching: boolean
  readonly isWorking: boolean
}): Doing =>
  focusOf(model).player.reload._tag === 'Reloading'
    ? 'Reloading'
    : isWorking
      ? 'Working'
      : isFetching
        ? 'Fetching'
        : 'Fighting'

const crowdAround = (model: Model) =>
  Array.filter(
    model.zombies,
    zombie =>
      zombie.kind !== 'Boss' &&
      zombie.state._tag !== 'Dying' &&
      distance(focusOf(model).player, zombie) <= PRESSURE_PX,
  ).length

// Adds one frame of a wave outside his fight: the time at what the bot was
// doing, and the hearts the crowd took.
export const recordCrowd = ({
  ledger,
  before,
  after,
  wave,
  doing,
  blamed,
}: {
  readonly ledger: Ledger
  readonly before: Model
  readonly after: Model
  readonly wave: number
  readonly doing: Doing
  readonly blamed: Kind | undefined
}): void => {
  const last = ledger.doingMs[ledger.doingMs.length - 1]
  const fresh: Record<string, number> = {}
  const entry = last?.wave === wave ? last : { wave, doing: fresh }
  if (entry !== last) {
    ledger.doingMs.push(entry)
  }
  entry.doing[doing] = (entry.doing[doing] ?? 0) + FRAME_MS
  const lost = focusOf(before).player.hp - focusOf(after).player.hp
  if (lost > 0) {
    ledger.hurts.push({
      wave,
      kind: blamed ?? 'Unknown',
      doing,
      hearts: lost,
      crowd: crowdAround(before),
    })
  }
}
