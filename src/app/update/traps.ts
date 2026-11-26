import { Array, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import { playerKeyAction } from '../../input/keyActions'
import { puffDust } from '../../render/particles/particles'
import {
  SHAKE_TRAUMA_MAX,
  TRAP_NOTICE_MS,
  TRAP_PLACE_TRAUMA,
} from '../../shared/constants'
import { trapCenter } from '../../world/gear/traps'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { ActionRefusal, SeatAction } from '../../world/step/stepWorld'
import { type Model, TrapHint, TrapNotice } from '../model'
import { actAsLead, tryAsLead } from './action'
import { playSounds, uiCue } from './sound'
import { type UpdateStep, toModel } from './step'

const shakeBy = (model: Model, trauma: number): Model =>
  UiStruct.evolve(model, {
    shake: shake =>
      UiStruct.evolve(shake, {
        trauma: current => Math.min(SHAKE_TRAUMA_MAX, current + trauma),
      }),
  })

// NOTE: a trap placed settles its hint and quiets the notice.
const notePlacement = (model: Model): Model =>
  UiStruct.evolve(model, {
    trapHint: () => TrapHint.Seen(),
    cosmetics: UiStruct.evolve({ trapNotice: () => TrapNotice.Quiet() }),
  })

const refusePlacement = (model: Model, reason: string): Model =>
  UiStruct.evolve(model, {
    cosmetics: UiStruct.evolve({
      trapNotice: () =>
        TrapNotice.Refused({ reason, remainingMs: TRAP_NOTICE_MS }),
    }),
  })

// NOTE: a placed trap stamps its dust and thunk where it landed; a refused
// one says why in the trap notice.
export const placeSelectedTrap: UpdateStep = $ =>
  Result.match(tryAsLead($.model, SeatAction.PlaceTrap()), {
    onFailure: refusal =>
      ActionRefusal.match(refusal, {
        NotNow: () => $.model,
        Refused: ({ reason }) =>
          $.combine(
            toModel(refusePlacement($.model, reason)),
            playSounds([uiCue('Denied')]),
          ),
      }),
    onSuccess: placed =>
      Option.match(Array.last(placed.traps), {
        onNone: () => placed,
        onSome: trap => {
          const { x, y } = trapCenter(levelOf(placed), trap)
          return $.combine(
            toModel(
              shakeBy(puffDust(notePlacement(placed), x, y), TRAP_PLACE_TRAUMA),
            ),
            playSounds([{ sound: 'Thunk', variation: 0 }]),
          )
        },
      }),
  })

export const nextTrap: UpdateStep = $ => {
  const cycled = actAsLead($.model, SeatAction.NextTrap())
  return $.combine(
    toModel(cycled),
    playSounds(
      focusOf(cycled).selectedTrap === focusOf($.model).selectedTrap
        ? []
        : [uiCue('Swap')],
    ),
  )
}

// NOTE: T places the selected trap and G picks the next, read from the one
// key table (src/input/keyActions.ts).
export const trapFromKey: (code: string) => UpdateStep = code => $ =>
  Option.match(playerKeyAction($.model, code), {
    onNone: () => $.model,
    onSome: action =>
      SeatAction.matchOrElse(
        action,
        {
          PlaceTrap: () => placeSelectedTrap($),
          NextTrap: () => nextTrap($),
        },
        () => $.model,
      ),
  })
