import { Array, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import { type Model, TrapHint, TrapNotice } from '#app/model.ts'
import { playerKeyAction } from '#input/keyActions.ts'
import { puffDust } from '#render/particles/particles.ts'
import {
  SHAKE_TRAUMA_MAX,
  TRAP_NOTICE_MS,
  TRAP_PLACE_TRAUMA,
} from '#shared/constants.ts'
import { trapCenter } from '#world/gear/traps.ts'
import { levelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'
import { ActionRefusal, SeatAction } from '#world/step/stepWorld.ts'

import { actAsLead, tryAsLead } from './action.ts'
import { playSounds, uiCue } from './sound.ts'
import { type UpdateStep, toModel } from './step.ts'

const shakeBy = (model: Model, trauma: number): Model =>
  UiStruct.evolve(model, {
    shake: shake =>
      UiStruct.evolve(shake, {
        trauma: current => Math.min(SHAKE_TRAUMA_MAX, current + trauma),
      }),
  })

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
