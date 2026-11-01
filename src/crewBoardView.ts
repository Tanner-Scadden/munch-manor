import { Array, Option, Record } from 'effect'
import type { Canvas } from 'foldkit'

import {
  CREW_AWARDS,
  type CrewMember,
  awardsOf,
  crewOf,
  mvpOf,
} from './crewAwards'
import { rect } from './drawing'
import {
  AWARD_STAMP_MS,
  type EndKind,
  type TallyRow,
  awardsAtMs,
  countedUp,
  easeOut,
  easeOutBack,
  plain,
  progressOf,
  rowStartMs,
  tallyRowsOf,
} from './endBeat'
import {
  type BakedText,
  COIN_SPRITE,
  GLYPH_HEIGHT,
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from './font'
import type { Model } from './model'
import { CREW_AWARD_NAMES, type CrewAward } from './names'
import { leadSeatOf } from './party'
import { seatColorOf, seatModelsOf } from './partyView'
import { playerShapes } from './playerView'
import { badgeTierOf } from './rank'
import { badgeSprite } from './rankArt'
import { isPortrait } from './screen'
import { type Sprite, group, placeAt } from './sprite'
import {
  AWARD_ICONS,
  CROWN,
  DOWN_ICON,
  ICON_SHIFT,
  REVIVE_ICON,
  TALLY_ICONS,
} from './tallyIcons'

// The crew board on a co-op end card (MULTIPLAYER.md, "The crew board"):
// the run's line (the wave or the time, and the crew's kills), then a
// column for each player, their own look and name over their kills,
// revives, downs, aim, and money, counted up a row at a time like the solo
// tally. Then the awards stamp: the crown drops on the MVP, each winner's
// number turns gold, and each player's best award lands as a title under
// their column, with its badge beside them. Icons over words: each row is
// its icon, and each award wears the icon of the row it was won on.

const PAD = 4
const GUTTER = 12
const COLUMN = 54
const ROW = 7
const CREW_TOP = 15
const FOOT = 17
const NAME_Y = 19
const STATS_Y = 29
const TITLE_Y = STATS_Y + 5 * ROW + 1
const BOTTOM = TITLE_Y + GLYPH_HEIGHT + 1
const BADGE_STRIDE = 8
// NOTE: badges go right of the player, two to a row.
const BADGE_SIDE_PX = 10

export const PANEL_FILL = 'rgba(24, 14, 22, 0.94)'
export const PANEL_EDGE = '#5a3a4a'
const OWN_FILL = 'rgba(255, 240, 200, 0.07)'

// NOTE: upright, the frame shows only 180 of the board's width (the end
// card is drawn in the landscape frame), so three or four players sit two
// to a row, a row of columns under another. A row is BLOCK_STEP below the
// one above.
const PORTRAIT_COLUMNS = 2
const BLOCK_STEP = BOTTOM + 4

export const crewBoardColumns = (model: Model, count: number): number =>
  isPortrait(model) && count > PORTRAIT_COLUMNS ? PORTRAIT_COLUMNS : count

const rowsOf = (count: number, columns: number): number =>
  Math.max(1, Math.ceil(count / Math.max(1, columns)))

// NOTE: the board's height below its top, from the panel's edge to edge.
export const crewBoardHeightPx = (model: Model): number => {
  const count = crewOf(model).length
  return (
    CREW_TOP +
    BOTTOM +
    (rowsOf(count, crewBoardColumns(model, count)) - 1) * BLOCK_STEP
  )
}

// NOTE: the board's width, so a test can hold it inside the screen.
export const crewBoardWidthPx = (model: Model): number =>
  crewBoardWidth(crewBoardColumns(model, crewOf(model).length))

// THE ROWS

type StatRow = Readonly<{
  icon: Sprite
  shift: number
  value: (member: CrewMember) => number
  format: (shown: number) => string
  tone: TextTone
  maybeAward: Option.Option<CrewAward>
}>

const STAT_ROWS: ReadonlyArray<StatRow> = [
  {
    icon: TALLY_ICONS.Kills,
    shift: 0,
    value: member => member.kills,
    format: plain,
    tone: 'Plain',
    maybeAward: Option.some('Mvp'),
  },
  {
    icon: REVIVE_ICON,
    shift: 0,
    value: member => member.revives,
    format: plain,
    tone: 'Plain',
    maybeAward: Option.some('Medic'),
  },
  {
    icon: DOWN_ICON,
    shift: 0,
    value: member => member.downs,
    format: plain,
    tone: 'Plain',
    maybeAward: Option.some('MostMunched'),
  },
  {
    icon: TALLY_ICONS.Aim,
    shift: 0,
    value: member => member.aim,
    format: shown => `${shown}%`,
    tone: 'Plain',
    maybeAward: Option.some('Sharpshooter'),
  },
  {
    icon: COIN_SPRITE,
    shift: ICON_SHIFT.Cash,
    value: member => member.earned,
    format: plain,
    tone: 'Coin',
    maybeAward: Option.none(),
  },
]

const TITLES: Readonly<Record<CrewAward, BakedText>> = Record.map(
  CREW_AWARD_NAMES,
  name => bakeText(name.toUpperCase(), 'Victory'),
)

// SPARKS

const SPARKS = 8
const SPARK_MS = 420
const SPARK_REACH = 16

export const sparkShapes = (
  x: number,
  y: number,
  ms: number,
): ReadonlyArray<Canvas.Shape> => {
  const t = progressOf(ms, 0, SPARK_MS)
  if (t <= 0 || t >= 1) {
    return []
  }
  const reach = SPARK_REACH * easeOut(t)
  return Array.map(Array.range(0, SPARKS - 1), index => {
    const angle = (index / SPARKS) * Math.PI * 2
    return rect(
      Math.round(x + Math.cos(angle) * reach),
      Math.round(y + Math.sin(angle) * reach * 0.6),
      2,
      2,
      index % 2 === 0 ? '#ffd23f' : '#ff8a3d',
    )
  })
}

// LAYOUT

const ROW_SLIDE_PX = 8

const slideOf = (kind: EndKind, index: number, ms: number): number =>
  Math.round(
    ROW_SLIDE_PX * (1 - easeOut(progressOf(ms, rowStartMs(kind, index), 120))),
  )

// NOTE: a name too wide for its column loses letters from its end.
const fitted = (name: string, width: number): string =>
  textWidth(name) <= width || name.length <= 1
    ? name
    : fitted(name.slice(0, -1), width)

type Board = Readonly<{
  kind: EndKind
  ms: number
  top: number
  left: number
  crew: ReadonlyArray<CrewMember>
  centerX: number
  columns: number
}>

const columnX = (board: Board, index: number): number =>
  Math.round(
    board.left + PAD + GUTTER + (index % board.columns) * COLUMN + COLUMN / 2,
  )

const rowOf = (board: Board, index: number): number =>
  Math.floor(index / board.columns)

// NOTE: where a player's block starts: the top of their column.
const blockTopOf = (board: Board, index: number): number =>
  board.top + CREW_TOP + rowOf(board, index) * BLOCK_STEP

// THE RUN'S LINE

// NOTE: the crew's kills are the sum of its columns, read off the World,
// so every player's card says the same.
const crewKillsOf = (crew: ReadonlyArray<CrewMember>): number =>
  Array.reduce(crew, 0, (sum, member) => sum + member.kills)

const lineCell = (
  row: TallyRow,
  kind: EndKind,
  ms: number,
  x: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const value = row.format(countedUp(row.value, kind, 0, ms))
  const width = 9 + textWidth(value)
  const left = Math.round(x - width / 2)
  return [
    placeAt(
      left + 3 - ICON_SHIFT[row.icon],
      y + 3 - ICON_SHIFT[row.icon],
      TALLY_ICONS[row.icon],
    ),
    ...textShapes(value, 'Plain', left + 9, y, 'Left'),
  ]
}

const runLineShapes = (
  model: Model,
  board: Board,
): ReadonlyArray<Canvas.Shape> => {
  if (board.ms < rowStartMs(board.kind, 0)) {
    return []
  }
  const y = board.top + PAD
  const [first, kills] = tallyRowsOf(model)
  return [
    ...(first === undefined
      ? []
      : lineCell(first, board.kind, board.ms, board.centerX - 30, y)),
    ...(kills === undefined
      ? []
      : lineCell(
          { ...kills, value: crewKillsOf(board.crew) },
          board.kind,
          board.ms,
          board.centerX + 30,
          y,
        )),
  ]
}

// THE COLUMNS

const isAwarded = (board: Board, ms: number): boolean =>
  ms >= awardsAtMs(board.kind)

// NOTE: a player's badge and rank number at the top left of their column,
// beside the figure, so the board is no taller for it. The rank is the one
// they joined the room with, so every card shows the same. Award badges
// stack on the right.
const BADGE_WIDTH = 11
const BADGE_GAP = 2
const RANK_LEFT_PX = 27
const RANK_Y = 9

const rankShapes = (
  x: number,
  centerY: number,
  rank: number,
): ReadonlyArray<Canvas.Shape> => {
  const left = x - RANK_LEFT_PX
  return [
    placeAt(
      left + Math.floor(BADGE_WIDTH / 2),
      centerY,
      badgeSprite(badgeTierOf(rank)),
    ),
    ...textShapes(
      `${rank}`,
      'Plain',
      left + BADGE_WIDTH + BADGE_GAP,
      centerY - Math.floor(GLYPH_HEIGHT / 2),
      'Left',
    ),
  ]
}

const headShapes = (
  model: Model,
  board: Board,
  member: CrewMember,
  index: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = columnX(board, index)
  const crewTop = blockTopOf(board, index)
  const footY = crewTop + FOOT
  const maybeSeat = Array.findFirst(
    seatModelsOf(model),
    seat => seat.slot === member.slot,
  )
  const name = fitted(member.name, COLUMN - 4)
  return [
    ...Option.match(maybeSeat, {
      onNone: () => [],
      onSome: ({ model: seatModel }) => [
        group({
          translate: {
            x: x - seatModel.player.x,
            y: footY - seatModel.player.y - 5,
          },
          shapes: playerShapes(seatModel),
        }),
      ],
    }),
    ...textShapes(name, 'Plain', x, crewTop + NAME_Y, 'Center'),
    rect(
      Math.round(x - textWidth(name) / 2),
      crewTop + NAME_Y + GLYPH_HEIGHT + 1,
      textWidth(name),
      1,
      seatColorOf(member.slot),
    ),
    ...rankShapes(x, crewTop + RANK_Y, member.rank),
  ]
}

// NOTE: your own column is a shade lighter, so you find yourself first.
const ownPlateShapes = (
  model: Model,
  board: Board,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(
    Array.findFirstIndex(
      board.crew,
      member => member.slot === leadSeatOf(model).slot,
    ),
    {
      onNone: () => [],
      onSome: index => [
        rect(
          columnX(board, index) - COLUMN / 2 + 1,
          blockTopOf(board, index) - 3,
          COLUMN - 2,
          BOTTOM + 1,
          OWN_FILL,
        ),
      ],
    },
  )

const statShapes = (
  board: Board,
  winners: ReadonlyMap<CrewAward, number>,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(STAT_ROWS, (row, rowIndex) => {
    const tallyIndex = rowIndex + 1
    if (board.ms < rowStartMs(board.kind, tallyIndex)) {
      return []
    }
    const slide = slideOf(board.kind, tallyIndex, board.ms)
    const isGold = (member: CrewMember): boolean =>
      isAwarded(board, board.ms) &&
      Option.exists(row.maybeAward, award => winners.get(award) === member.slot)
    return Array.flatMap(
      Array.range(0, rowsOf(board.crew.length, board.columns) - 1),
      blockRow => {
        const y =
          board.top +
          CREW_TOP +
          blockRow * BLOCK_STEP +
          STATS_Y +
          rowIndex * ROW
        return [
          placeAt(
            board.left + PAD + 4 - slide - row.shift,
            y + 3 - row.shift,
            row.icon,
          ),
          ...Array.flatMap(board.crew, (member, index) =>
            rowOf(board, index) === blockRow
              ? textShapes(
                  row.format(
                    countedUp(
                      row.value(member),
                      board.kind,
                      tallyIndex,
                      board.ms,
                    ),
                  ),
                  isGold(member) ? 'Victory' : row.tone,
                  columnX(board, index) - slide,
                  y,
                  'Center',
                )
              : [],
          ),
        ]
      },
    )
  })

const CROWN_DROP_PX = 10

const awardShapes = (
  board: Board,
  member: CrewMember,
  index: number,
): ReadonlyArray<Canvas.Shape> => {
  const atMs = awardsAtMs(board.kind)
  if (board.ms < atMs) {
    return []
  }
  const awards = awardsOf(board.crew, member.slot)
  const x = columnX(board, index)
  const crewTop = blockTopOf(board, index)
  const drop = easeOutBack(progressOf(board.ms, atMs, AWARD_STAMP_MS))
  const pop = 1 + 1.2 * (1 - drop)
  const isMvp = Option.exists(mvpOf(board.crew), slot => slot === member.slot)
  const badges = Array.filter(awards, award => award !== 'Mvp')
  return [
    ...(isMvp
      ? [placeAt(x, Math.round(crewTop - CROWN_DROP_PX * (1 - drop)), CROWN)]
      : []),
    ...Array.map(badges, (award, badge) =>
      placeAt(
        x + BADGE_SIDE_PX + (badge % 2) * BADGE_SIDE_PX,
        Math.round(
          crewTop + 3 + Math.floor(badge / 2) * BADGE_STRIDE - 6 * (1 - drop),
        ),
        AWARD_ICONS[award],
      ),
    ),
    ...Option.match(Array.head(awards), {
      onNone: () => [],
      onSome: award => {
        const title = TITLES[award]
        const y = crewTop + TITLE_Y
        return [
          placeBaked(title, {
            x,
            y: Math.round(y + GLYPH_HEIGHT / 2 - (GLYPH_HEIGHT * pop) / 2),
            align: 'Center',
            scale: pop,
          }),
          ...sparkShapes(x, y + 3, board.ms - atMs),
        ]
      },
    }),
  ]
}

// THE BOARD

const winnersOf = (
  crew: ReadonlyArray<CrewMember>,
): ReadonlyMap<CrewAward, number> =>
  new Map(
    Array.flatMap(CREW_AWARDS, award =>
      Array.flatMap(crew, member =>
        Array.contains(awardsOf(crew, member.slot), award)
          ? [[award, member.slot] as const]
          : [],
      ),
    ),
  )

const crewBoardWidth = (count: number): number =>
  PAD * 2 + GUTTER + count * COLUMN

// NOTE: the panel and what stands on it, from `top`, centered on `centerX`
// of the landscape frame the end card is drawn in (src/endView.ts). The panel fades and
// rises with the rest of the card (src/endView.ts); the rows and awards
// land on their own beats.
export const crewBoardShapes = (
  model: Model,
  kind: EndKind,
  ms: number,
  top: number,
  centerX: number,
): Readonly<{
  panel: ReadonlyArray<Canvas.Shape>
  rows: ReadonlyArray<Canvas.Shape>
}> => {
  const crew = crewOf(model)
  const columns = crewBoardColumns(model, crew.length)
  const width = crewBoardWidth(columns)
  const height = crewBoardHeightPx(model)
  const left = Math.round(centerX - width / 2)
  const board: Board = { kind, ms, top, left, crew, centerX, columns }
  const winners = winnersOf(crew)
  return {
    panel: [
      rect(left - 1, top - 1, width + 2, height + 2, PANEL_EDGE),
      rect(left, top, width, height, PANEL_FILL),
      ...ownPlateShapes(model, board),
      rect(left + PAD, top + CREW_TOP - 5, width - PAD * 2, 1, PANEL_EDGE),
      ...Array.map(
        // NOTE: makeBy and range never make fewer than one, so a board of
        // one row asks for none itself.
        rowsOf(crew.length, columns) > 1
          ? Array.makeBy(rowsOf(crew.length, columns) - 1, row => row + 1)
          : [],
        blockRow =>
          rect(
            left + PAD,
            top + CREW_TOP + blockRow * BLOCK_STEP - 3,
            width - PAD * 2,
            1,
            PANEL_EDGE,
          ),
      ),
      ...Array.flatMap(crew, (member, index) =>
        headShapes(model, board, member, index),
      ),
    ],
    rows: [
      ...runLineShapes(model, board),
      ...statShapes(board, winners),
      ...Array.flatMap(crew, (member, index) =>
        awardShapes(board, member, index),
      ),
    ],
  }
}
