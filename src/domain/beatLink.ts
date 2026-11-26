import { Array, Function, Option, Schema, SchemaGetter } from 'effect'

import { UiSchema } from '@effect/ui'

import { Calling, Difficulty } from '../shared/playerData'
import { DareKind } from '../world/dare/dareSchema'
import { MAX_MARK } from '../world/run/dareLadder'
import {
  Modifiers,
  maskOfModifiers,
  modifiersOfMask,
} from '../world/run/modifiers'
import { Bot, HomeMode } from './clientSchema'

export const DareOutcome = Schema.Literals(['Munched', 'Chicken', 'Won'])
export type DareOutcome = typeof DareOutcome.Type

export const FriendsDare = Schema.Struct({
  seed: Schema.Finite,
  mode: HomeMode,
  difficulty: Difficulty,
  modifiers: Modifiers,
  dareMark: Schema.Finite,
  easyBreakSeconds: Schema.Finite,
  pool: Schema.Array(DareKind),
  hero: Calling,
  outcome: DareOutcome,
  wave: Schema.Finite,
  found: Schema.Array(DareKind),
  runSeconds: Schema.Finite,
})
export type FriendsDare = typeof FriendsDare.Type

export const OwnPicks = Schema.Struct({
  mode: HomeMode,
  difficulty: Difficulty,
  modifiers: Modifiers,
  dareMark: Schema.Finite,
  easyBreakSeconds: Schema.Finite,
  bots: Schema.Array(Bot),
})
export type OwnPicks = typeof OwnPicks.Type

export const BeatMyRun = UiSchema.TaggedEnum({
  None: {},
  Offered: { dare: FriendsDare },
  Taken: { dare: FriendsDare, own: OwnPicks },
})
export type BeatMyRun = typeof BeatMyRun.Type

export const noBeatMyRun: BeatMyRun = BeatMyRun.None()

export const BEAT_PARAM = 'dare'

const LINK_VERSION = 1

const MAX_SEED = 0xffffffff
const MAX_WAVE = 999
const MAX_BREAK_SECONDS = 999
const MAX_RUN_SECONDS = 99_999

const intUpTo = (maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }))

const maskOf = (bits: number) => intUpTo(2 ** bits - 1)

const OUTCOME_ORDER: ReadonlyArray<DareOutcome> = DareOutcome.literals

const DareWire = Schema.Tuple([
  Schema.Literal(LINK_VERSION),
  intUpTo(MAX_SEED),
  intUpTo(HomeMode.literals.length - 1),
  intUpTo(Difficulty.literals.length - 1),
  maskOf(4),
  intUpTo(MAX_MARK),
  intUpTo(MAX_BREAK_SECONDS),
  maskOf(DareKind.literals.length),
  intUpTo(Calling.literals.length - 1),
  intUpTo(OUTCOME_ORDER.length - 1),
  intUpTo(MAX_WAVE),
  maskOf(DareKind.literals.length),
  intUpTo(MAX_RUN_SECONDS),
])
type DareWire = typeof DareWire.Type

const indexIn = <A>(list: ReadonlyArray<A>, value: A): number =>
  Option.getOrElse(
    Array.findFirstIndex(list, item => item === value),
    () => 0,
  )

const at = <A>(list: Array.NonEmptyReadonlyArray<A>, index: number): A =>
  Option.getOrElse(Array.get(list, index), () => Array.headNonEmpty(list))

const kindsMaskOf = (kinds: ReadonlyArray<DareKind>): number =>
  Array.reduce(DareKind.literals, 0, (mask, kind, index) =>
    Array.contains(kinds, kind) ? mask | (1 << index) : mask,
  )

const kindsOfMask = (mask: number): ReadonlyArray<DareKind> =>
  Array.filter(DareKind.literals, (_kind, index) => (mask & (1 << index)) !== 0)

const dareOfWire = (wire: DareWire): FriendsDare => {
  const [
    ,
    seed,
    mode,
    difficulty,
    modifiers,
    dareMark,
    easyBreakSeconds,
    pool,
    hero,
    outcome,
    wave,
    found,
    runSeconds,
  ] = wire
  return {
    seed,
    mode: at(HomeMode.literals, mode),
    difficulty: at(Difficulty.literals, difficulty),
    modifiers: modifiersOfMask(modifiers),
    dareMark,
    easyBreakSeconds,
    pool: kindsOfMask(pool),
    hero: at(Calling.literals, hero),
    outcome: at(DareOutcome.literals, outcome),
    wave,
    found: kindsOfMask(found),
    runSeconds,
  }
}

const clampTo = (value: number, maximum: number): number =>
  Math.max(0, Math.min(maximum, Math.floor(value)))

const wireOfDare = (dare: FriendsDare): DareWire => [
  LINK_VERSION,
  clampTo(dare.seed, MAX_SEED),
  indexIn(HomeMode.literals, dare.mode),
  indexIn(Difficulty.literals, dare.difficulty),
  maskOfModifiers(dare.modifiers),
  clampTo(dare.dareMark, MAX_MARK),
  clampTo(dare.easyBreakSeconds, MAX_BREAK_SECONDS),
  kindsMaskOf(dare.pool),
  indexIn(Calling.literals, dare.hero),
  indexIn(OUTCOME_ORDER, dare.outcome),
  clampTo(dare.wave, MAX_WAVE),
  kindsMaskOf(dare.found),
  clampTo(dare.runSeconds, MAX_RUN_SECONDS),
]

const WireToDare = DareWire.pipe(
  Schema.decodeTo(FriendsDare, {
    decode: SchemaGetter.transform(dareOfWire),
    encode: SchemaGetter.transform(wireOfDare),
  }),
)

const DareCode = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(WireToDare)),
)

export const dareCodeOf = (dare: FriendsDare): Option.Option<string> =>
  Schema.encodeOption(DareCode)(dare)

const dareOfCode = (code: string): Option.Option<FriendsDare> =>
  Schema.decodeOption(DareCode)(code)

export const readBeatLink = (search: string): Option.Option<FriendsDare> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get(BEAT_PARAM)),
    dareOfCode,
  )

export type DareResult = Readonly<{
  outcome: DareOutcome
  wave: number
  found: ReadonlyArray<DareKind>
  runSeconds: number
}>

export const isBeaten: {
  (theirs: DareResult): (mine: DareResult) => boolean
  (mine: DareResult, theirs: DareResult): boolean
} = Function.dual(2, (mine: DareResult, theirs: DareResult): boolean => {
  const isMineWon = mine.outcome === 'Won'
  const isTheirsWon = theirs.outcome === 'Won'
  if (isMineWon !== isTheirsWon) {
    return isMineWon
  } else if (isMineWon) {
    return mine.runSeconds < theirs.runSeconds
  } else if (mine.found.length !== theirs.found.length) {
    return mine.found.length > theirs.found.length
  } else if (mine.wave !== theirs.wave) {
    return mine.wave > theirs.wave
  } else {
    return mine.outcome === 'Chicken' && theirs.outcome === 'Munched'
  }
})

export const addressWithoutDare = (href: string): string => {
  const url = new URL(href)
  url.searchParams.delete(BEAT_PARAM)
  return url.href
}
