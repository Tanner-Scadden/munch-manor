import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from '../arena'
import {
  SHAKE_TRAUMA_MAX,
  TRAP_NOTICE_MS,
  TRAP_PLACE_TRAUMA,
} from '../constants'
import { playerKeyAction } from '../keyActions'
import { type Model, TrapHint, TrapNotice } from '../model'
import { puffDust } from '../particles'
import { ActionRefusal, SeatAction } from '../stepWorld'
import { trapCenter } from '../traps'
import { actAsLead, tryAsLead } from './action'
import { playSounds, uiCue } from './sound'
import type { UpdateReturn, UpdateStep } from './step'

const shakeBy = (model: Model, trauma: number): Model =>
  modifyFields(model, {
    shake: shake =>
      modifyFields(shake, {
        trauma: current => Math.min(SHAKE_TRAUMA_MAX, current + trauma),
      }),
  })

// NOTE: a trap placed settles its hint and quiets the notice.
const notePlacement = (model: Model): Model =>
  modifyFields(model, {
    trapHint: () => TrapHint.Seen(),
    trapNotice: () => TrapNotice.Quiet(),
  })

const refusePlacement = (model: Model, reason: string): Model =>
  modifyFields(model, {
    trapNotice: () =>
      TrapNotice.Refused({ reason, remainingMs: TRAP_NOTICE_MS }),
  })

// NOTE: a placed trap stamps its dust and thunk where it landed; a refused
// one says why in the trap notice.
export const placeSelectedTrap = (model: Model): UpdateReturn =>
  Result.match(tryAsLead(model, SeatAction.PlaceTrap()), {
    onFailure: refusal =>
      ActionRefusal.match(refusal, {
        NotNow: () => ({ model }),
        Refused: ({ reason }) =>
          playSounds([uiCue('Denied')])(refusePlacement(model, reason)),
      }),
    onSuccess: placed =>
      Option.match(Array.last(placed.traps), {
        onNone: () => ({ model: placed }),
        onSome: trap => {
          const { x, y } = trapCenter(levelOf(placed), trap)
          return playSounds([{ sound: 'Thunk', variation: 0 }])(
            shakeBy(puffDust(notePlacement(placed), x, y), TRAP_PLACE_TRAUMA),
          )
        },
      }),
  })

export const nextTrap = (model: Model): UpdateReturn => {
  const cycled = actAsLead(model, SeatAction.NextTrap())
  return playSounds(
    cycled.selectedTrap === model.selectedTrap ? [] : [uiCue('Swap')],
  )(cycled)
}

// NOTE: T places the selected trap and G picks the next, read from the one
// key table (src/keyActions.ts).
export const trapFromKey: (code: string) => UpdateStep = code => stepModel =>
  Option.match(playerKeyAction(stepModel, code), {
    onNone: () => ({ model: stepModel }),
    onSome: action =>
      SeatAction.matchOrElse(
        action,
        {
          PlaceTrap: () => placeSelectedTrap(stepModel),
          NextTrap: () => nextTrap(stepModel),
        },
        () => ({ model: stepModel }),
      ),
  })
