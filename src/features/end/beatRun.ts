import { Array, Option } from 'effect'

import type { Model } from '../../app/model'
import {
  BEAT_PARAM,
  type DareResult,
  type FriendsDare,
  dareCodeOf,
  isBeaten,
} from '../../domain/beatLink'
import { maybeTakenDareOf } from '../../domain/beatMyRun'
import { isBotCrew } from '../../domain/bots'
import { focusOf, isCoop } from '../../world/party/party'
import { RunMode } from '../../world/schema/worldSchema'
import { bestRunOf, endKindOf } from './endBeat'
import { GAME_URL } from './share'

// Beat my run on the end card (docs/PROGRESSION_PLAN.md, pillar G): a lone
// player's run as the link SHARE carries (src/domain/beatLink.ts), and a
// friend's dare's verdict, BEAT IT! or NOT YET, with a short line.

// THE LINK

// NOTE: only a lone player's run makes a dare to beat: a crew's, a couch's,
// or one with bots plays waves a friend alone would not, so its post links
// the game alone (co-op's dare is a follow-up, docs/PROGRESSION_PLAN.md).
const isLoneRun = (model: Model): boolean =>
  !isCoop(model) && !isBotCrew(model) && model.localPlayers <= 1

// NOTE: the run on the end card as its link carries it: what it started
// from (its seed, picks, and pool, the friend's own when it was their dare)
// and how it went.
const maybeDareOfRun = (model: Model): Option.Option<FriendsDare> =>
  isLoneRun(model)
    ? Option.map(endKindOf(model), outcome => {
        const { wave, things } = bestRunOf(model)
        return {
          seed: model.runSeed,
          mode: RunMode.isAnyOf(['Endless'])(model.mode) ? 'Endless' : 'Campaign',
          difficulty: model.difficulty.chosen,
          modifiers: model.modifiers,
          dareMark: model.dareMark,
          easyBreakSeconds: model.easyBreakSeconds,
          pool: model.runPool,
          hero: focusOf(model).player.calling,
          outcome,
          wave,
          found: things,
          runSeconds: Math.floor(model.stats.runMs / 1000),
        }
      })
    : Option.none()

// NOTE: SHARE's link: the game with the run in its `dare` parameter, or the
// game alone for a run no friend can play alone.
export const shareUrlOf = (model: Model): string =>
  Option.match(Option.flatMap(maybeDareOfRun(model), dareCodeOf), {
    onNone: () => GAME_URL,
    onSome: code => `${GAME_URL}/?${BEAT_PARAM}=${code}`,
  })

// THE VERDICT

export type BeatVerdict = 'BeatIt' | 'NotYet'

export type BeatComparison = Readonly<{
  friend: FriendsDare
  verdict: BeatVerdict
  line: string
}>

// NOTE: a few words each, in capitals as the pixel font draws them,
// picked by the run's wave so the same run always says the same thing, and
// two runs in a row rarely do.
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

// NOTE: a friend's dare's run, once its end card is up: the friend's
// result beside this one, and the verdict.
export const maybeBeatComparisonOf = (
  model: Model,
): Option.Option<BeatComparison> =>
  Option.flatMap(maybeTakenDareOf(model), friend =>
    Option.map(resultOf(model), mine => {
      const verdict: BeatVerdict = isBeaten(mine, friend) ? 'BeatIt' : 'NotYet'
      return { friend, verdict, line: lineOf(verdict, mine.wave) }
    }),
  )
