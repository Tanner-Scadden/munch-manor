// Which Model fields the gameplay hash covers. This is the field list of the
// World and client Model split planned in MULTIPLAYER.md (Phase 0), kept here
// as data until the split gives the World its own schema in src.
//
// - World: gameplay state the room owns and every client must agree on.
// - Gate: client state that steers gameplay in single player today (it
//   freezes the world, blocks firing, or feeds aim). The split turns each one
//   into a per-player input or a World field. Hashed until then.
// - Derived: recomputed from the World (the flow fields). Not hashed: it is
//   costly, and a divergence there shows up in the World a frame later.
// - Cosmetic: made from frame events, never read by the simulation.
// - Client: UI, menus, dialogs, audio, settings, save and sync, devices.
//
// A Model field missing from this table is hashed as World, the safe side,
// and the cross-engine report lists it, so a new field never hides a
// divergence. Classify it here when it lands.

import type { Model } from '../../src/model'

export type FieldClass = 'World' | 'Gate' | 'Derived' | 'Cosmetic' | 'Client'

export const FIELD_CLASSES = {
  phase: 'World',
  pacing: 'World',
  boss: 'World',
  frenzyPacks: 'World',
  intensity: 'World',
  mode: 'World',
  difficulty: 'World',
  player: 'World',
  zombies: 'World',
  bullets: 'World',
  lobs: 'World',
  nextEntityId: 'World',
  wallet: 'World',
  elapsedMs: 'World',
  frameEvents: 'World',
  traps: 'World',
  pickups: 'World',
  boosts: 'World',
  loot: 'World',
  trapStock: 'World',
  selectedTrap: 'World',
  level: 'World',
  rngState: 'World',
  intent: 'World',

  ovens: 'World',
  fridge: 'World',
  laserSight: 'World',
  shop: 'World',
  shopCategory: 'World',
  purchase: 'World',
  hitStop: 'World',
  lessons: 'World',
  practice: 'World',
  debutCard: 'World',
  stats: 'World',
  party: 'World',

  input: 'Client',
  maybeSurface: 'Client',
  orientation: 'Client',
  cameraLean: 'Client',

  flowField: 'Derived',
  wideFlowField: 'Derived',

  particles: 'Cosmetic',
  decals: 'Cosmetic',
  dustCooldownMs: 'Cosmetic',
  shake: 'Cosmetic',
  popups: 'Cosmetic',
  streak: 'Cosmetic',
  bestStreak: 'Cosmetic',
  blasts: 'Cosmetic',
  callouts: 'Cosmetic',
  prizeFlight: 'Cosmetic',
  counterSale: 'Cosmetic',
  cosmeticRngState: 'Cosmetic',

  difficultyCard: 'Client',
  shopDialog: 'Client',
  shopTabs: 'Client',
  trapHint: 'Client',
  ammoTip: 'Client',
  firstBreakQuest: 'Client',
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
  character: 'Client',
  shakeSetting: 'Client',
  shareStats: 'Client',
  maybeVisitId: 'Client',
  maybeHomeFocus: 'Client',
  panel: 'Client',
  panelDialog: 'Client',
  bests: 'Client',
  runTally: 'Client',
  maybeRoomDifficulty: 'Client',
  loading: 'Client',
  saveStatus: 'Client',
  tutorialReset: 'Client',
  syncState: 'Client',
  playerScopeStatus: 'Client',
  lastRunSync: 'Client',
  writesInFlight: 'Client',
  unsavedChanges: 'Client',
  syncedSave: 'Client',
  linkFlow: 'Client',
  home: 'Client',
  seenPowerUps: 'Client',
  coop: 'Client',
  cursorSetting: 'Client',
  handDialog: 'Client',
  orientationLock: 'Client',
  playerName: 'Client',
  profile: 'Client',
  profileDialog: 'Client',
  profileTabs: 'Client',
  rotationSetting: 'Client',
  shopChatter: 'Client',
  localPlayers: 'Client',
} satisfies Partial<Record<keyof Model, FieldClass>>

const CLASS_BY_FIELD: ReadonlyMap<string, FieldClass> = new Map(
  Object.entries(FIELD_CLASSES),
)

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
  Object.entries(model).flatMap(([field, value]: [string, unknown]) =>
    field === 'world' && typeof value === 'object' && value !== null
      ? Object.entries(value)
      : [[field, value] as const],
  )

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
  flatEntriesOf(model)
    .filter(
      ([field, value]) =>
        isHashedClass(classOf(field)) && !isSoloDefault(field, value),
    )
    .sort(byField)

export const hashedFieldsOf = (model: Model): ReadonlyArray<string> =>
  gameplayEntriesOf(model).map(([field]) => field)

// Model fields this table does not classify yet.
export const unclassifiedFieldsOf = (model: Model): ReadonlyArray<string> =>
  flatEntriesOf(model)
    .map(([field]) => field)
    .filter(field => classOf(field) === undefined)
    .sort()

// The gameplay part of a Model as a plain record, for dumps and diffs.
export const gameplayOf = (model: Model): Readonly<Record<string, unknown>> =>
  Object.fromEntries(gameplayEntriesOf(model))
