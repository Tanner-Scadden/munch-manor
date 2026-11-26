import {
  Array,
  Function,
  Number,
  Option,
  Record,
  Result,
  Schema,
  String,
  pipe,
} from 'effect'

import {
  FLAME_TUNING,
  type FlameKind,
  type FlameLooks,
} from '../../src/render/iso/light/lightSpecs'
import {
  LOOK_TUNING,
  type LookSpecs,
  type RoomLook,
} from '../../src/render/iso/light/lookSpecs'
import {
  MOOD_AMBIENT,
  type MoodAmbients,
} from '../../src/render/iso/light/mood'

const ValuePath = Schema.String.check(
  Schema.isPattern(/^(LOOK|FLAME_LOOKS|MOOD_AMBIENT)\./),
)
export const LabEdits = Schema.Record(ValuePath, Schema.Finite)
export type LabEdits = typeof LabEdits.Type

export type LabTables = Readonly<{
  look: LookSpecs
  flames: FlameLooks
  moods: MoodAmbients
}>

export const SHIPPED_TABLES: LabTables = {
  look: LOOK_TUNING.shipped,
  flames: FLAME_TUNING.shipped,
  moods: MOOD_AMBIENT.shipped,
}

export const tuneTables = (tables: LabTables): void => {
  LOOK_TUNING.tune(tables.look)
  FLAME_TUNING.tune(tables.flames)
  MOOD_AMBIENT.tune(tables.moods)
}

export const ControlKind = Schema.Literals(['Number', 'Color'])
export type ControlKind = typeof ControlKind.Type

export type Control = Readonly<{
  id: string
  file: string
  group: string
  label: string
  kind: ControlKind
  min: number
  max: number
  step: number
  read: (tables: LabTables) => number
  write: (tables: LabTables, value: number) => LabTables
}>

const LOOK_FILE = 'src/render/iso/light/lookSpecs.ts'
const LIGHT_FILE = 'src/render/iso/light/lightSpecs.ts'
const MOOD_FILE = 'src/render/iso/light/mood.ts'

type Range = Readonly<{ min: number; max: number; step: number }>

const SHARE: Range = { min: 0, max: 1, step: 0.05 }
const LIFT: Range = { min: 0, max: 2, step: 0.05 }
const COLOR: Range = { min: 0, max: 0xffffff, step: 1 }

type LookNumber = Exclude<keyof LookSpecs, 'rooms'>

const LOOK_NUMBERS: ReadonlyArray<
  Readonly<{ key: LookNumber; label: string; range: Range }>
> = [
  { key: 'steps', label: 'Bands', range: { min: 2, max: 15, step: 1 } },
  { key: 'dither', label: 'Dither', range: SHARE },
  {
    key: 'blackBelow',
    label: 'Black below',
    range: { min: 0, max: 0.5, step: 0.01 },
  },
  {
    key: 'brightest',
    label: 'Brightest',
    range: { min: 0.5, max: 3, step: 0.05 },
  },
  { key: 'hueKeep', label: 'Light hue kept', range: SHARE },
  { key: 'roomFill', label: 'Room fill', range: LIFT },
  { key: 'ambient', label: 'Ambient', range: LIFT },
]

const lookControl = ({
  key,
  label,
  range,
}: (typeof LOOK_NUMBERS)[number]): Control => ({
  id: `LOOK.${key}`,
  file: LOOK_FILE,
  group: 'Look',
  label,
  kind: 'Number',
  ...range,
  read: tables => tables.look[key],
  write: (tables, value) => ({
    ...tables,
    look: { ...tables.look, [key]: value },
  }),
})

type RoomColor = 'shadow' | 'mid' | 'light' | 'accent'

const ROOM_COLORS: ReadonlyArray<Readonly<{ key: RoomColor; label: string }>> =
  [
    { key: 'shadow', label: 'Shadow' },
    { key: 'mid', label: 'Mid' },
    { key: 'light', label: 'Light' },
    { key: 'accent', label: 'Accent' },
  ]

const roomOf = (tables: LabTables, roomId: string): RoomLook =>
  Option.getOrElse(Record.get(tables.look.rooms, roomId), () => ({
    shadow: 0,
    mid: 0,
    light: 0,
    accent: 0,
    accentShare: 0,
  }))

const withRoom = (
  tables: LabTables,
  roomId: string,
  change: (room: RoomLook) => RoomLook,
): LabTables => ({
  ...tables,
  look: {
    ...tables.look,
    rooms: Record.set(
      tables.look.rooms,
      roomId,
      change(roomOf(tables, roomId)),
    ),
  },
})

const roomControls = (roomId: string): ReadonlyArray<Control> => [
  ...Array.map(ROOM_COLORS, ({ key, label }): Control => ({
    id: `LOOK.rooms.${roomId}.${key}`,
    file: LOOK_FILE,
    group: roomId,
    label,
    kind: 'Color',
    ...COLOR,
    read: tables => roomOf(tables, roomId)[key],
    write: (tables, value) =>
      withRoom(tables, roomId, room => ({ ...room, [key]: value })),
  })),
  {
    id: `LOOK.rooms.${roomId}.accentShare`,
    file: LOOK_FILE,
    group: roomId,
    label: 'Accent share',
    kind: 'Number',
    ...SHARE,
    read: tables => roomOf(tables, roomId).accentShare,
    write: (tables, value) =>
      withRoom(tables, roomId, room => ({ ...room, accentShare: value })),
  },
  {
    id: `LOOK.rooms.${roomId}.fill`,
    file: LOOK_FILE,
    group: roomId,
    label: 'Fill',
    kind: 'Number',
    ...LIFT,
    read: tables => roomOf(tables, roomId).fill ?? tables.look.roomFill,
    write: (tables, value) =>
      withRoom(tables, roomId, room => ({ ...room, fill: value })),
  },
]

type FlameNumber = 'intensity' | 'range' | 'color'

const FLAME_NUMBERS: ReadonlyArray<
  Readonly<{ key: FlameNumber; label: string; kind: ControlKind; range: Range }>
> = [
  {
    key: 'intensity',
    label: 'Intensity',
    kind: 'Number',
    range: { min: 0, max: 60, step: 0.5 },
  },
  {
    key: 'range',
    label: 'Range',
    kind: 'Number',
    range: { min: 1, max: 20, step: 0.5 },
  },
  { key: 'color', label: 'Color', kind: 'Color', range: COLOR },
]

const flameControls = (kind: FlameKind): ReadonlyArray<Control> =>
  Array.map(
    FLAME_NUMBERS,
    ({ key, label, kind: controlKind, range }): Control => ({
      id: `FLAME_LOOKS.${kind}.${key}`,
      file: LIGHT_FILE,
      group: 'Flames',
      label: `${kind} ${String.toLowerCase(label)}`,
      kind: controlKind,
      ...range,
      read: tables => tables.flames[kind][key],
      write: (tables, value) => ({
        ...tables,
        flames: {
          ...tables.flames,
          [kind]: { ...tables.flames[kind], [key]: value },
        },
      }),
    }),
  )

const MOOD_NUMBERS: ReadonlyArray<
  Readonly<{ key: keyof MoodAmbients; label: string; range: Range }>
> = [
  { key: 'calm', label: 'Break ambient', range: LIFT },
  { key: 'wave', label: 'Wave ambient', range: LIFT },
  { key: 'waveDrop', label: 'Wave drop at full heat', range: SHARE },
  { key: 'dread', label: 'Dread ambient', range: LIFT },
]

const moodControl = ({
  key,
  label,
  range,
}: (typeof MOOD_NUMBERS)[number]): Control => ({
  id: `MOOD_AMBIENT.${key}`,
  file: MOOD_FILE,
  group: 'Moods',
  label,
  kind: 'Number',
  ...range,
  read: tables => tables.moods[key],
  write: (tables, value) => ({
    ...tables,
    moods: { ...tables.moods, [key]: value },
  }),
})

const FLAME_KINDS: ReadonlyArray<FlameKind> = Record.keys(SHIPPED_TABLES.flames)

export const CONTROLS: ReadonlyArray<Control> = [
  ...Array.map(LOOK_NUMBERS, lookControl),
  ...Array.flatMap(Record.keys(SHIPPED_TABLES.look.rooms), roomControls),
  ...Array.flatMap(FLAME_KINDS, flameControls),
  ...Array.map(MOOD_NUMBERS, moodControl),
]

export const GROUPS: ReadonlyArray<string> = Array.dedupe(
  Array.map(CONTROLS, ({ group }) => group),
)

export const controlById = (id: string): Option.Option<Control> =>
  Array.findFirst(CONTROLS, control => control.id === id)

const fitted = (control: Control, value: number): number => {
  const clamped = Number.clamp(value, {
    minimum: control.min,
    maximum: control.max,
  })
  return control.kind === 'Color'
    ? Math.round(clamped)
    : roundTo(Math.round(clamped / control.step) * control.step, control.step)
}

const decimalsOf = (step: number): number =>
  pipe(
    String.split(`${step}`, '.'),
    Array.get(1),
    Option.match({ onNone: () => 0, onSome: part => part.length }),
  )

const roundTo = (value: number, step: number): number => {
  const scale = 10 ** decimalsOf(step)
  return Math.round(value * scale) / scale
}

const isSame = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

export const withEdit: {
  (id: string, value: number): (edits: LabEdits) => LabEdits
  (edits: LabEdits, id: string, value: number): LabEdits
} = Function.dual(3, (edits: LabEdits, id: string, value: number): LabEdits =>
  Option.match(controlById(id), {
    onNone: () => edits,
    onSome: control => {
      const next = fitted(control, value)
      return isSame(next, control.read(SHIPPED_TABLES))
        ? Record.remove(edits, id)
        : Record.set(edits, id, next)
    },
  }),
)

export const tablesOf = (edits: LabEdits): LabTables =>
  Array.reduce(CONTROLS, SHIPPED_TABLES, (tables, control) =>
    Option.match(Record.get(edits, control.id), {
      onNone: () => tables,
      onSome: value => control.write(tables, value),
    }),
  )

export const valueOf: {
  (control: Control): (edits: LabEdits) => number
  (edits: LabEdits, control: Control): number
} = Function.dual(2, (edits: LabEdits, control: Control): number =>
  Option.getOrElse(Record.get(edits, control.id), () =>
    control.read(SHIPPED_TABLES),
  ),
)

export const inputValueOf: {
  (text: string): (control: Control) => Option.Option<number>
  (control: Control, text: string): Option.Option<number>
} = Function.dual(2, (control: Control, text: string): Option.Option<number> =>
  control.kind === 'Color'
    ? pipe(
        Option.some(text),
        Option.filter(String.startsWith('#')),
        Option.map(String.slice(1)),
        Option.filter(hex => hex.length === 6),
        Option.flatMap(hex => Number.parse(`0x${hex}`)),
      )
    : Number.parse(String.trim(text)),
)

export const inputTextOf: {
  (control: Control): (value: number) => string
  (value: number, control: Control): string
} = Function.dual(2, (value: number, control: Control): string =>
  control.kind === 'Color'
    ? `#${String.padStart(6, '0')(Math.round(value).toString(16))}`
    : formatValue(value, control),
)

export const formatValue: {
  (control: Control): (value: number) => string
  (value: number, control: Control): string
} = Function.dual(2, (value: number, control: Control): string =>
  control.kind === 'Color'
    ? `0x${String.padStart(6, '0')(Math.round(value).toString(16))}`
    : `${roundTo(value, control.step)}`,
)

export type Change = Readonly<{
  control: Control
  before: number
  after: number
}>

export const changesOf = (edits: LabEdits): ReadonlyArray<Change> =>
  Array.filterMap(CONTROLS, control =>
    Option.match(Record.get(edits, control.id), {
      onNone: () => Result.failVoid,
      onSome: after =>
        Result.succeed({
          control,
          before: control.read(SHIPPED_TABLES),
          after,
        }),
    }),
  )

const changeLine = ({ control, before, after }: Change): string => {
  const isOwnFill =
    String.endsWith('.fill')(control.id) &&
    String.startsWith('LOOK.rooms.')(control.id)
  const roomId = String.split(control.id, '.')[2] ?? ''
  const isUnset =
    isOwnFill &&
    Option.match(Record.get(SHIPPED_TABLES.look.rooms, roomId), {
      onNone: () => true,
      onSome: room => room.fill === undefined,
    })
  return `  ${control.id}: ${formatValue(before, control)}${isUnset ? ' (unset, LOOK.roomFill)' : ''} -> ${formatValue(after, control)}`
}

export const proposalOf = (
  input: Readonly<{ edits: LabEdits; words: string; where: string }>,
): string => {
  const changes = changesOf(input.edits)
  const files = Array.dedupe(Array.map(changes, ({ control }) => control.file))
  return Array.join(
    [
      ...(String.isNonEmpty(String.trim(input.words))
        ? [String.trim(input.words)]
        : []),
      `Light and color lab: please land these values (tried on ${input.where}).`,
      ...Array.flatMap(files, file => [
        file,
        ...pipe(
          changes,
          Array.filter(({ control }) => control.file === file),
          Array.map(changeLine),
        ),
      ]),
    ],
    '\n',
  )
}
