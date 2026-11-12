import { Array, Option, Result } from 'effect'

import { applyBotPresses, botInputs } from '../../src/features/bots/teammateBot'
import {
  type RunEnd,
  type RunRecording,
  TickEdit,
  outcomeOf,
  recordedHashOf,
} from '../../src/platform/recording'
import {
  type TickInputs,
  ticksOfChunks,
} from '../../src/platform/recordingCodec'
import { modifyFocus } from '../../src/world/party/party'
import type { World } from '../../src/world/schema/world'
import { idleIntent } from '../../src/world/schema/worldSchema'
import { applySeatAction, stepWorld } from '../../src/world/step/stepWorld'
import { roundWave } from '../../src/world/waves/waves'

// A recorded run played back through the plain step, tick by tick, as the
// client played it (runTicks in src/app/frame.ts): the edits the client
// made before the tick (presses by their rule, then the other changes as
// they were), the human's intent on the first seat, the bots' presses and
// intents from their brain, then stepWorld with every seat's intent. The run
// it ends on is compared with the one the recording kept.

const applyEdit = (world: World, edit: TickEdit): World =>
  TickEdit.match(edit, {
    Pressed: ({ slot, action }) => applySeatAction(world, slot, action),
    Patched: ({ fields }) => ({ ...world, ...fields }),
  })

const intentOf = (tick: TickInputs, slot: number) =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(tick.inputs, ([inputSlot]) => inputSlot === slot),
      ([, intent]) => intent,
    ),
    () => idleIntent,
  )

const playTick = (
  world: World,
  tick: TickInputs,
  edits: ReadonlyArray<TickEdit>,
  botSlots: ReadonlyArray<number>,
): World => {
  const pressed = Array.reduce(
    Array.filter(edits, TickEdit.isAnyOf(['Pressed'])),
    world,
    applyEdit,
  )
  const cleared = tick.isCleared ? { ...pressed, frameEvents: [] } : pressed
  const patched = Array.reduce(
    Array.filter(edits, TickEdit.isAnyOf(['Patched'])),
    cleared,
    applyEdit,
  )
  const intended = modifyFocus(patched, {
    intent: () => intentOf(tick, patched.seats[0].seat.slot),
  })
  if (Array.isReadonlyArrayEmpty(botSlots)) {
    return stepWorld(intended, new Map(tick.inputs)).world
  }
  const botted = applyBotPresses(intended, botSlots)
  return stepWorld(
    botted,
    new Map([...tick.inputs, ...botInputs(botted, botSlots)]),
  ).world
}

export type ReplayResult = Readonly<{
  recorded: RunEnd
  replayed: RunEnd
  isSame: boolean
}>

const editsByTick = (
  recording: RunRecording,
): ReadonlyMap<number, ReadonlyArray<TickEdit>> =>
  Array.reduce(
    recording.edits,
    new Map<number, ReadonlyArray<TickEdit>>(),
    (byTick, { tick, edit }) =>
      byTick.set(tick, [...(byTick.get(tick) ?? []), edit]),
  )

// NOTE: the run played back, or why it could not be: its ticks unreadable.
export const replayRecording = (
  recording: RunRecording,
): Result.Result<ReplayResult, string> =>
  Option.match(ticksOfChunks(recording.ticks), {
    onNone: () => Result.fail('the ticks could not be read'),
    onSome: ticks => {
      const edits = editsByTick(recording)
      const final = Array.reduce(ticks, recording.start, (world, tick, index) =>
        playTick(
          world,
          tick,
          edits.get(index) ?? [],
          recording.settings.botSlots,
        ),
      )
      const replayed: RunEnd = {
        ticks: ticks.length,
        outcome: outcomeOf(final),
        wave: roundWave(final.phase),
        hash: recordedHashOf(final),
      }
      const { end } = recording
      return Result.succeed({
        recorded: end,
        replayed,
        isSame:
          replayed.ticks === end.ticks &&
          replayed.outcome === end.outcome &&
          replayed.wave === end.wave &&
          replayed.hash === end.hash,
      })
    },
  })
