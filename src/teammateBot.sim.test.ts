import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { addBot } from './bots'
import { FIXED_STEP_MS } from './constants'
import { Message } from './message'
import { type Model, initialModel } from './model'
import { atSeat } from './model.fixture'
import { playersOf } from './party'
import { SURFACE, modelAfter, startedRunOf } from './testing'
import { asVeteran } from './veteran'

// Whole waves with three teammate bots (src/teammateBot.ts): the human
// stands at the spawn pressing READY through every break, and the bots do
// the rest. They fight, buy, and ready up, and the same seed plays the same
// run twice.

const FRAMES = 60 * 90

const readyKey = (current: Model): Model =>
  modelAfter(
    modelAfter(current, Message.PressedKey({ code: 'Enter' })),
    Message.ReleasedKey({ code: 'Enter' }),
  )

// NOTE: each bot starts with a little cash, so the first breaks that open
// the stall have something to spend.
const withThreeBots = (): Model =>
  Array.reduce(Array.range(1, 3), startedThreeBots(), (current, slot) =>
    atSeat(current, slot, world =>
      modifyFields(world, {
        wallet: wallet => ({ ...wallet, balance: 120 }),
        player: player => modifyFields(player, { hp: () => 3 }),
      }),
    ),
  )

const startedThreeBots = (): Model =>
  startedRunOf(
    addBot(
      addBot(
        addBot(
          modifyFields(asVeteran(initialModel), {
            maybeSurface: () => Option.some(SURFACE),
          }),
        ),
      ),
    ),
  )

const play = (start: Model): Model =>
  Array.reduce(Array.range(0, FRAMES - 1), start, (current, frame) => {
    if (!['Preparation', 'Wave'].includes(current.phase._tag)) {
      return current
    }
    const readied =
      current.phase._tag === 'Preparation' && frame % 60 === 0
        ? readyKey(current)
        : current
    return modelAfter(
      readied,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    )
  })

const waveOf = (current: Model): number =>
  'wave' in current.phase ? current.phase.wave : 0

describe('three bots and a human who only presses READY', () => {
  const finished = play(withThreeBots())

  test('clear waves, each bot kills, and the crew buys at the stall', () => {
    expect(waveOf(finished)).toBeGreaterThanOrEqual(3)
    const crew = playersOf(finished)
    expect(crew).toHaveLength(4)
    for (const bot of Array.drop(crew, 1)) {
      expect(bot.seat.kills).toBeGreaterThan(0)
    }
    expect(finished.stats.purchases).toBeGreaterThan(0)
  })

  test('the human is not carried to the end: bots hold, but the wave still bites', () => {
    const human = playersOf(finished)[0]
    expect(human?.seat.kills).toBe(0)
    expect(finished.stats.kills.Shambler).toBeGreaterThan(0)
  })

  test('the same seed plays the same run', () => {
    const again = play(withThreeBots())
    expect(playersOf(again)).toEqual(playersOf(finished))
    expect(again.phase).toEqual(finished.phase)
  })
})
