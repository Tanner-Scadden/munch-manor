import { Array, Function, Option, Schema, SchemaGetter } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Calling, Difficulty } from '../shared/playerData'
import { DareKind } from '../world/dare/dareSchema'
import { MAX_MARK } from '../world/run/dareLadder'
import {
  Modifiers,
  maskOfModifiers,
  modifiersOfMask,
} from '../world/run/modifiers'
import { Bot, HomeMode } from './clientSchema'

// Beat my run's link (docs/PROGRESSION_PLAN.md, pillar G): SHARE's link carries a
// lone player's run, everything that decides its house (the seed, the mode,
// the difficulty, the modifiers, the dare mark, Dare's break clock, and the
// things its list rolled from) and how it went (the outcome, the wave, the
// things found, the run's time). A friend who opens the link gets BEAT MY
// RUN on the home menu: the same house, the same list, the same rolls, with
// the friend's result to beat on the end card. Determinism makes the house
// the same; the play decides the rest. The rules on the root's Model are
// in src/domain/beatMyRun.ts.

// THE DARE

// NOTE: how a run ended, as the end card names it (src/features/end/endBeat.ts,
// EndKind): escaped, left early by the back door, or munched.
export const DareOutcome = Schema.Literals(['Munched', 'Chicken', 'Won'])
export type DareOutcome = typeof DareOutcome.Type

// NOTE: a friend's run as its link carries it. `pool` is the things the
// run's list rolled from beyond the house's six (the sharer's milestones),
// so the list rolls the same for a friend who has not opened them.
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

// NOTE: the player's own lobby picks, kept while a friend's dare holds the
// lobby, and handed back when it lets go.
export const OwnPicks = Schema.Struct({
  mode: HomeMode,
  difficulty: Difficulty,
  modifiers: Modifiers,
  dareMark: Schema.Finite,
  easyBreakSeconds: Schema.Finite,
  bots: Schema.Array(Bot),
})
export type OwnPicks = typeof OwnPicks.Type

// NOTE: where a friend's dare stands: none, offered on the home menu (a
// link opened), or taken, holding the lobby's picks to the link's with the
// player's own kept to hand back. Taken lasts through the run and its end
// card, so RETRY plays the same house again; PLAY, CO-OP, or the card's x
// hand the picks back.
export const BeatMyRun = defineTaggedUnion({
  None: {},
  Offered: { dare: FriendsDare },
  Taken: { dare: FriendsDare, own: OwnPicks },
})
export type BeatMyRun = typeof BeatMyRun.Type

export const noBeatMyRun: BeatMyRun = BeatMyRun.None()

// THE LINK

// NOTE: the query parameter the link carries the run in:
// `https://munchmanor.com/?dare=...`.
export const BEAT_PARAM = 'dare'

// NOTE: the link's version. A link of another version (or none) is just
// ignored, so a change to the wire bumps it.
const LINK_VERSION = 1

const MAX_SEED = 0xffffffff
const MAX_WAVE = 999
const MAX_BREAK_SECONDS = 999
const MAX_RUN_SECONDS = 99_999

const intUpTo = (maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }))

const maskOf = (bits: number) => intUpTo(2 ** bits - 1)

const OUTCOME_ORDER: ReadonlyArray<DareOutcome> = DareOutcome.literals

// NOTE: the run as the link packs it: one small number each, in a fixed
// order, so the link stays short. The lists are bit masks in their Schema's
// order (DareKind, Modifier) and the picks are indexes into theirs.
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
  Array.filter(
    DareKind.literals,
    (_kind, index) => (mask & (1 << index)) !== 0,
  )

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

// NOTE: the link's code: the wire as JSON, in URL-safe base64, through
// Schema both ways.
const DareCode = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(WireToDare)),
)

export const dareCodeOf = (dare: FriendsDare): Option.Option<string> =>
  Schema.encodeOption(DareCode)(dare)

const dareOfCode = (code: string): Option.Option<FriendsDare> =>
  Schema.decodeOption(DareCode)(code)

// NOTE: a `?dare=...` in the page's address, read once the splash is gone.
// A bad, cut, or older link is nothing.
export const readBeatLink = (search: string): Option.Option<FriendsDare> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get(BEAT_PARAM)),
    dareOfCode,
  )

// BEATING IT

// NOTE: a run's result, the friend's or the player's.
export type DareResult = Readonly<{
  outcome: DareOutcome
  wave: number
  found: ReadonlyArray<DareKind>
  runSeconds: number
}>

// NOTE: whether `mine` beats `theirs`: an escape beats any run that did
// not get out, and two escapes go to the quicker. Otherwise the most things
// found, then the furthest wave, then leaving alive over getting munched. A
// tie beats nothing.
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

// NOTE: the address with its dare taken off and every other parameter kept,
// for the address bar once the dare is read.
export const addressWithoutDare = (href: string): string => {
  const url = new URL(href)
  url.searchParams.delete(BEAT_PARAM)
  return url.href
}
