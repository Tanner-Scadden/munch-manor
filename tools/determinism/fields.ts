// Which Model fields the gameplay hash covers. This is the field list of the
// World and client Model split planned in MULTIPLAYER.md (Phase 0), kept here
// as data until the split gives the World its own schema in src.
//
// - World: gameplay state the room owns and every client must agree on.
// - Gate: client state that steers gameplay in single player today (it
//   freezes the world, blocks firing, or feeds aim). The split turns each one
//   into a per-player input or a World field. Hashed until then.
// - Derived: recomputed from the World (none today: the flow fields are built on the frame). Not hashed: it is
//   costly, and a divergence there shows up in the World a frame later.
// - Cosmetic: made from frame events, never read by the simulation.
// - Client: UI, menus, dialogs, audio, settings, save and sync, devices.
//
// A Model field missing from this table is hashed as World, the safe side,
// and the cross-engine report lists it, so a new field never hides a
// divergence. Classify it here when it lands.

import { Array, Option, Record } from 'effect'

import type { Model } from '../../src/app/model'

export type FieldClass = 'World' | 'Gate' | 'Derived' | 'Cosmetic' | 'Client'

export const FIELD_CLASSES = {
  phase: 'World',
  pacing: 'World',
  boss: 'World',
  frenzyPacks: 'World',
  intensity: 'World',
  mode: 'World',
  difficulty: 'World',
  modifiers: 'World',
  zombies: 'World',
  bullets: 'World',
  lobs: 'World',
  nextEntityId: 'World',
  elapsedMs: 'World',
  frameEvents: 'World',
  traps: 'World',
  pickups: 'World',
  loot: 'World',
  level: 'World',
  rngState: 'World',

  ovens: 'World',
  fridge: 'World',
  pantry: 'World',
  crates: 'World',
  keys: 'World',
  stove: 'World',
  dare: 'World',
  dareThings: 'World',
  gasValve: 'World',
  stations: 'World',
  cases: 'World',
  hitStop: 'World',
  lessons: 'World',
  practice: 'World',
  debutCard: 'World',
  stats: 'World',
  party: 'World',
  seats: 'World',

  input: 'Client',
  maybeSurface: 'Client',
  orientation: 'Client',
  cameraLean: 'Client',

  particles: 'Cosmetic',
  decals: 'Cosmetic',
  dustCooldownMs: 'Cosmetic',
  tellWatch: 'Cosmetic',
  actionWatch: 'Cosmetic',
  shake: 'Cosmetic',
  popups: 'Cosmetic',
  streak: 'Cosmetic',
  bestStreak: 'Cosmetic',
  blasts: 'Cosmetic',
  callouts: 'Cosmetic',
  levelCallouts: 'Cosmetic',
  prizeFlight: 'Cosmetic',
  clocheLift: 'Cosmetic',
  kitchenCall: 'Cosmetic',
  dareHint: 'Cosmetic',
  breakIdleMs: 'Cosmetic',
  cosmeticRngState: 'Cosmetic',

  difficultyCard: 'Client',
  trapHint: 'Client',
  introSeen: 'Client',
  introSkip: 'Client',
  pocketCard: 'Client',
  dareSatchel: 'Client',
  caseCard: 'Client',
  firstBreakQuest: 'Client',
  rattlesIntro: 'Client',
  kitchenTour: 'Client',
  maybeOpenHelpCard: 'Client',
  trapNotice: 'Client',
  lastDevice: 'Client',
  touchControls: 'Client',
  introducedKinds: 'Client',
  hintBand: 'Client',
  screenMs: 'Client',
  runRecords: 'Client',
  shareSheet: 'Client',
  maybeShareCopiedAtMs: 'Client',
  isRunCardDropped: 'Client',
  stepCarryMs: 'Client',
  audio: 'Client',
  soundSetting: 'Client',
  musicSetting: 'Client',
  screenFit: 'Client',
  fullscreen: 'Client',
  homeScreenTip: 'Client',
  homeScreenSteps: 'Client',
  pageVisibility: 'Client',
  maybeNewerBuild: 'Client',
  maybeSupportUrl: 'Client',
  appearance: 'Client',
  shakeSetting: 'Client',
  shareStats: 'Client',
  maybeVisitId: 'Client',
  maybeHomeFocus: 'Client',
  panel: 'Client',
  panelDialog: 'Client',
  bests: 'Client',
  rank: 'Client',
  calling: 'Client',
  boughtCosmetics: 'Client',
  seenUnlocks: 'Client',
  freshUnlocks: 'Client',
  rankPaid: 'Client',
  maybeRankGain: 'Client',
  runTally: 'Client',
  maybeRoomDifficulty: 'Client',
  maybeRoomModifiers: 'Client',
  maybeCrewRunKey: 'Client',
  maybeRunNet: 'Client',
  loading: 'Client',
  saveStatus: 'Client',
  syncState: 'Client',
  playerScopeStatus: 'Client',
  lastRunSync: 'Client',
  writesInFlight: 'Client',
  unsavedChanges: 'Client',
  syncedSave: 'Client',
  home: 'Client',
  seenPowerUps: 'Client',
  coop: 'Client',
  cursorSetting: 'Client',
  handDialog: 'Client',
  orientationLock: 'Client',
  playerName: 'Client',
  profile: 'Client',
  lobby: 'Client',
  munchopedia: 'Client',
  profileDialog: 'Client',
  rotationSetting: 'Client',
  rumbleSetting: 'Client',
  localPlayers: 'Client',
  crewBots: 'Client',
} satisfies Partial<Record<keyof Model, FieldClass>>

// NOTE: the player fields at the root of a Model before seats by slot. A
// Model's first seat hashes under these names (legacyEntriesOf), so a run
// before that change and a run after it hash alike.
const LEGACY_SEAT_FIELDS = [
  'player',
  'intent',
  'wallet',
  'boosts',
  'trapStock',
  'selectedTrap',
  'shop',
  'shopCategory',
  'laserSight',
  'purchase',
] as const

// NOTE: client fields at the root of a Model before their feature became a
// Block: the Profile's (src/features/profile/), now inside `profile`, and
// the shop dialog's tabs and guide (src/features/shop/), inside
// `shopDialog` until the shop went (docs/ESCAPE_PLAN.md, layer 7), which
// hashes as a client field too. A run before those changes hashes them as
// the client fields they are, so it and a run after it hash alike.
const LEGACY_CLIENT_FIELDS = [
  'character',
  'profileTabs',
  'linkFlow',
  'tutorialReset',
  'shopTabs',
  'shopGuide',
  'shopDialog',
  'shopChatter',
] as const

const CLASS_BY_FIELD: ReadonlyMap<string, FieldClass> = new Map([
  ...Record.toEntries(FIELD_CLASSES),
  ...Array.map(LEGACY_SEAT_FIELDS, (field): readonly [string, FieldClass] => [
    field,
    'World',
  ]),
  ...Array.map(LEGACY_CLIENT_FIELDS, (field): readonly [string, FieldClass] => [
    field,
    'Client',
  ]),
])

const classOf = (field: string): FieldClass | undefined =>
  CLASS_BY_FIELD.get(field)

const isHashedClass = (fieldClass: FieldClass | undefined): boolean =>
  fieldClass === undefined || fieldClass === 'World' || fieldClass === 'Gate'

const byField = (
  [a]: readonly [string, unknown],
  [b]: readonly [string, unknown],
): number => (a < b ? -1 : a > b ? 1 : 0)

// NOTE: the split plans to move the World fields under `model.world`. Its
// fields are read as if they were still top level, so a split that changes
// no behavior keeps the same names, the same record, and the same hash.
const flatEntriesOf = (
  model: object,
): ReadonlyArray<readonly [string, unknown]> =>
  legacyEntriesOf(
    Array.flatMap(
      Record.toEntries(model),
      ([field, value]: [string, unknown]) =>
        field === 'world' && typeof value === 'object' && value !== null
          ? Record.toEntries(value)
          : [[field, value] as const],
    ),
  )

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isList = (value: unknown): value is ReadonlyArray<unknown> =>
  Array.isArray(value)

// NOTE: seats by slot read as the Model before them: the first seat's player
// fields at the root, and a Crew with its lead seat and the other seats as
// mates (a Mate was a seat's whole state). before and after (beforeAfter.ts)
// plays this against a base with the old shape, so both sides hash the same
// state under the same names.
const legacyEntriesOf = (
  entries: ReadonlyArray<readonly [string, unknown]>,
): ReadonlyArray<readonly [string, unknown]> => {
  const seats = Option.getOrUndefined(
    Option.map(
      Array.findFirst(entries, ([field]) => field === 'seats'),
      ([, value]) => value,
    ),
  )
  const lead = isList(seats) ? seats[0] : undefined
  if (!isList(seats) || !isRecord(lead)) {
    return entries
  }
  return [
    ...Array.map(
      Array.filter(entries, ([field]) => field !== 'seats'),
      ([field, value]): readonly [string, unknown] =>
        field === 'party' && isRecord(value) && value['_tag'] === 'Crew'
          ? [field, { _tag: 'Crew', lead: lead['seat'], mates: seats.slice(1) }]
          : [field, value],
    ),
    ...Array.map(LEGACY_SEAT_FIELDS, (field): readonly [string, unknown] => [
      field,
      lead[field],
    ]),
  ]
}

// NOTE: fields the World gained for co-op hash only once they hold more
// than single player's value, so a single player run hashes exactly as it
// did before them, and before and after (beforeAfter.ts) compares a solo
// run across the change.
const isSoloDefault = (field: string, value: unknown): boolean =>
  field === 'party' &&
  typeof value === 'object' &&
  value !== null &&
  '_tag' in value &&
  value._tag === 'Solo'

// The hashed fields of a Model with their values, sorted by name, so the
// order never depends on how the Model was built.
export const gameplayEntriesOf = (
  model: Model,
): ReadonlyArray<readonly [string, unknown]> =>
  Array.filter(
    flatEntriesOf(model),
    ([field, value]) =>
      isHashedClass(classOf(field)) && !isSoloDefault(field, value),
  ).sort(byField)

export const hashedFieldsOf = (model: Model): ReadonlyArray<string> =>
  Array.map(gameplayEntriesOf(model), ([field]) => field)

// Model fields this table does not classify yet.
export const unclassifiedFieldsOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(
    Array.map(flatEntriesOf(model), ([field]) => field),
    field => classOf(field) === undefined,
  ).sort()

// The gameplay part of a Model as a plain record, for dumps and diffs.
export const gameplayOf = (model: Model): Readonly<Record<string, unknown>> =>
  Record.fromEntries(gameplayEntriesOf(model))
