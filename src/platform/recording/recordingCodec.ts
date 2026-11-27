import { Array, Number, Option, String } from 'effect'

import type { Intent } from '#world/schema/entitySchema.ts'
import type { PlayerSlot } from '#world/schema/worldSchema.ts'

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

export const encodeChunk = (lines: ReadonlyArray<string>): string =>
  Array.join(
    Array.map(
      Array.isReadonlyArrayNonEmpty(lines) ? Array.group(lines) : [],
      run => `${run.length}${RUN}${Array.headNonEmpty(run)}`,
    ),
    LINES,
  )

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
