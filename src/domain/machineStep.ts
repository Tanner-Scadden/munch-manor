import { Effect, Function, type Schema } from 'effect'
import { Machine, type MachineType } from 'effect-machine'

type Tagged = { readonly _tag: string }

type Fields = Record<string, Schema.Struct.Fields>

type MachineStep<S, E> = {
  (event: E): (state: S) => S
  (state: S, event: E): S
}

export const machineStepOf = <
  S extends Tagged,
  E extends Tagged,
  SD extends Fields,
  ED extends Fields,
  Output,
>(
  machine: MachineType<S, E, never, SD, ED, void, Output>,
): MachineStep<S, E> =>
  Function.dual(2, (state: S, event: E): S =>
    Effect.runSync(Machine.replay(machine, [event], { from: state })),
  )
