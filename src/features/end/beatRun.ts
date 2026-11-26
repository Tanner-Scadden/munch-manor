import { Array, Option } from 'effect'

import type { Model } from '#app/model.ts'
import {
  BEAT_PARAM,
  type DareResult,
  type FriendsDare,
  dareCodeOf,
  isBeaten,
} from '#domain/beatLink.ts'
import { maybeTakenDareOf } from '#domain/beatMyRun.ts'
import { isBotCrew } from '#domain/bots.ts'
import { focusOf, isCoop } from '#world/party/party.ts'
import { RunMode } from '#world/schema/worldSchema.ts'

import { bestRunOf, endKindOf } from './endBeat.ts'
import { GAME_URL } from './share.ts'

const isLoneRun = (model: Model): boolean =>
  !isCoop(model) && !isBotCrew(model) && model.localPlayers <= 1

const maybeDareOfRun = (model: Model): Option.Option<FriendsDare> =>
  isLoneRun(model)
    ? Option.map(endKindOf(model), outcome => {
        const { wave, things } = bestRunOf(model)
        return {
          seed: model.runStart.runSeed,
          mode: RunMode.isAnyOf(['Endless'])(model.mode)
            ? 'Endless'
            : 'Campaign',
          difficulty: model.difficulty.chosen,
          modifiers: model.modifiers,
          dareMark: model.dareMark,
          easyBreakSeconds: model.easyBreakSeconds,
          pool: model.runStart.runPool,
          hero: focusOf(model).player.calling,
          outcome,
          wave,
          found: things,
          runSeconds: Math.floor(model.stats.runMs / 1000),
        }
      })
    : Option.none()

export const shareUrlOf = (model: Model): string =>
  Option.match(Option.flatMap(maybeDareOfRun(model), dareCodeOf), {
    onNone: () => GAME_URL,
    onSome: code => `${GAME_URL}/?${BEAT_PARAM}=${code}`,
  })

export type BeatVerdict = 'BeatIt' | 'NotYet'

export type BeatComparison = Readonly<{
  friend: FriendsDare
  verdict: BeatVerdict
  line: string
}>

const LINES: Readonly<Record<BeatVerdict, ReadonlyArray<string>>> = {
  BeatIt: ['RUB IT IN.', 'SEND IT BACK!', 'WHO IS CHICKEN NOW?', 'TOO EASY.'],
  NotYet: ['THEY ARE LAUGHING.', 'SO CLOSE. AGAIN!', 'THEIR HOUSE WINS.'],
}

const lineOf = (verdict: BeatVerdict, wave: number): string => {
  const lines = LINES[verdict]
  return Option.getOrElse(Array.get(lines, wave % lines.length), () => '')
}

const resultOf = (model: Model): Option.Option<DareResult> =>
  Option.map(endKindOf(model), outcome => {
    const { wave, things } = bestRunOf(model)
    return {
      outcome,
      wave,
      found: things,
      runSeconds: Math.floor(model.stats.runMs / 1000),
    }
  })

export const maybeBeatComparisonOf = (
  model: Model,
): Option.Option<BeatComparison> =>
  Option.flatMap(maybeTakenDareOf(model), friend =>
    Option.map(resultOf(model), mine => {
      const verdict: BeatVerdict = isBeaten(mine, friend) ? 'BeatIt' : 'NotYet'
      return { friend, verdict, line: lineOf(verdict, mine.wave) }
    }),
  )
