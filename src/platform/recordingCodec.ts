import { Array, Number, Option, String } from 'effect'

import type { Intent } from '../world/schema/entitySchema'
import type { PlayerSlot } from '../world/schema/worldSchema'

// A recorded run's ticks as text (src/platform/recording.ts): one line per
// tick, each seat's intent as `slot:mx,my,ax,ay,T,I` joined by `;`, with no
// aim written `_,_` and a trigger as H (held) or R (released). A line starts
// with `!` when the client cleared the last tick's events before this one.
// A chunk of lines is run-length coded: `count*line` per run, joined by new
// lines, so a player standing still or holding a direction costs one line.
//
// Numbers are written exactly: JavaScript's shortest form reads back to the
// same double, and -0 is written `-0`, which `${value}` would drop.

export type TickInputs = Readonly<{
  isCleared: boolean
  inputs: ReadonlyArray<readonly [PlayerSlot, Intent]>
}>

const CLEARED = '!'
const SEATS = ';'
const SLOT = ':'
const PARTS = ','
const NO_AIM = '_'
const RUN = '*'
const LINES = '\n'

const numberText = (value: number): string =>
  Object.is(value, -0) ? '-0' : `${value}`

const triggerText = (trigger: Intent['trigger']): string =>
  trigger === 'Held' ? 'H' : 'R'

const seatText = ([slot, intent]: readonly [PlayerSlot, Intent]): string => {
  const aim = Option.match(intent.maybeAim, {
    onNone: () => [NO_AIM, NO_AIM],
    onSome: ({ x, y }) => [numberText(x), numberText(y)],
  })
  return `${numberText(slot)}${SLOT}${Array.join(
    [
      numberText(intent.move.x),
      numberText(intent.move.y),
      ...aim,
      triggerText(intent.trigger),
      triggerText(intent.interact),
    ],
    PARTS,
  )}`
}

export const lineOfTick = ({ isCleared, inputs }: TickInputs): string =>
  `${isCleared ? CLEARED : ''}${Array.join(Array.map(inputs, seatText), SEATS)}`

// NOTE: runs of equal lines as `count*line`.
export const encodeChunk = (lines: ReadonlyArray<string>): string =>
  Array.join(
    Array.map(
      Array.isReadonlyArrayNonEmpty(lines) ? Array.group(lines) : [],
      run => `${run.length}${RUN}${Array.headNonEmpty(run)}`,
    ),
    LINES,
  )

// DECODE

const numberOf = (text: string): Option.Option<number> =>
  text === '-0'
    ? Option.some(-0)
    : Option.filter(Number.parse(text), globalThis.Number.isFinite)

const triggerOf = (text: string): Option.Option<Intent['trigger']> =>
  text === 'H'
    ? Option.some('Held')
    : text === 'R'
      ? Option.some('Released')
      : Option.none()

const aimOf = (x: string, y: string): Option.Option<Intent['maybeAim']> =>
  x === NO_AIM && y === NO_AIM
    ? Option.some(Option.none())
    : Option.map(Option.all({ x: numberOf(x), y: numberOf(y) }), Option.some)

// NOTE: the text's pieces split by `separator`, when there are exactly
// `count` of them.
const piecesOf = (
  text: string,
  separator: string,
  count: number,
): Option.Option<ReadonlyArray<string>> =>
  Option.liftPredicate(
    String.split(text, separator),
    pieces => pieces.length === count,
  )

const pieceAt = (pieces: ReadonlyArray<string>, index: number): string =>
  Option.getOrElse(Array.get(pieces, index), () => '')

const seatOf = (text: string): Option.Option<readonly [PlayerSlot, Intent]> =>
  Option.flatMap(piecesOf(text, SLOT, 2), seat =>
    Option.flatMap(piecesOf(pieceAt(seat, 1), PARTS, 6), parts =>
      Option.map(
        Option.all({
          slot: numberOf(pieceAt(seat, 0)),
          moveX: numberOf(pieceAt(parts, 0)),
          moveY: numberOf(pieceAt(parts, 1)),
          maybeAim: aimOf(pieceAt(parts, 2), pieceAt(parts, 3)),
          trigger: triggerOf(pieceAt(parts, 4)),
          interact: triggerOf(pieceAt(parts, 5)),
        }),
        (read): readonly [PlayerSlot, Intent] => [
          read.slot,
          {
            move: { x: read.moveX, y: read.moveY },
            maybeAim: read.maybeAim,
            trigger: read.trigger,
            interact: read.interact,
          },
        ],
      ),
    ),
  )

export const tickOfLine = (line: string): Option.Option<TickInputs> => {
  const isCleared = String.startsWith(CLEARED)(line)
  const body = isCleared ? String.slice(1)(line) : line
  const maybeInputs: Option.Option<
    ReadonlyArray<readonly [PlayerSlot, Intent]>
  > = String.isEmpty(body)
    ? Option.some([])
    : Option.all(Array.map(String.split(body, SEATS), seatOf))
  return Option.map(maybeInputs, inputs => ({ isCleared, inputs }))
}

const runOf = (text: string): Option.Option<ReadonlyArray<string>> =>
  Option.flatMap(String.indexOf(RUN)(text), index =>
    Option.map(
      Option.filter(
        numberOf(String.slice(0, index)(text)),
        count => globalThis.Number.isInteger(count) && count > 0,
      ),
      count => Array.replicate(String.slice(index + 1)(text), count),
    ),
  )

// NOTE: every tick of a run's chunks in order, or none when any is
// malformed.
export const ticksOfChunks = (
  chunks: ReadonlyArray<string>,
): Option.Option<ReadonlyArray<TickInputs>> =>
  Option.flatMap(
    Option.all(
      Array.flatMap(chunks, chunk =>
        String.isEmpty(chunk)
          ? []
          : Array.map(String.split(chunk, LINES), runOf),
      ),
    ),
    runs => Option.all(Array.map(Array.flatten(runs), tickOfLine)),
  )
