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
  easyBreakSeconds: 'World',
  dareMark: 'World',
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
  maybeFinisher: 'Client',
  cameraGlide: 'Client',

  shake: 'Cosmetic',
  streak: 'Cosmetic',
  bestStreak: 'Cosmetic',
  kitchenCall: 'Cosmetic',
  dareHint: 'Cosmetic',
  maybeBreakIdleSinceMs: 'Cosmetic',
  maybeCarLine: 'Cosmetic',
  cosmetics: 'Cosmetic',

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
  lastDevice: 'Client',
  missedKeyDowns: 'Client',
  updateGreeting: 'Client',
  recordUnlock: 'Client',
  recorder: 'Client',
  touchControls: 'Client',
  introducedKinds: 'Client',
  hintBand: 'Client',
  screenMs: 'Client',
  runRecords: 'Client',
  stepCarryMs: 'Client',
  audio: 'Client',
  homeScreenTip: 'Client',
  homeScreenSteps: 'Client',
  pageVisibility: 'Client',
  appearance: 'Client',
  maybeVisitId: 'Client',
  maybeHomeFocus: 'Client',
  panel: 'Client',
  panelDialog: 'Client',
  bests: 'Client',
  rank: 'Client',
  bonuses: 'Client',
  maybeToday: 'Client',
  lastRunEnding: 'Client',
  missions: 'Client',
  proof: 'Client',
  dareMarks: 'Client',
  journal: 'Client',
  mastery: 'Client',
  calling: 'Client',
  boughtCosmetics: 'Client',
  seenUnlocks: 'Client',
  freshUnlocks: 'Client',
  home: 'Client',
  saving: 'Client',
  roomRun: 'Client',
  runGains: 'Client',
  endCard: 'Client',
  release: 'Client',
  runStart: 'Client',
  settings: 'Client',
  seenPowerUps: 'Client',
  coop: 'Client',
  handDialog: 'Client',
  orientationLock: 'Client',
  playerName: 'Client',
  profile: 'Client',
  lobby: 'Client',
  munchopediaPage: 'Client',
  profileDialog: 'Client',
  localPlayers: 'Client',
  beatMyRun: 'Client',
} satisfies Partial<Record<keyof Model, FieldClass>>

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

const LEGACY_CLIENT_FIELDS = [
  'munchopedia',
  'proofShelf',
  'character',
  'profileTabs',
  'linkFlow',
  'tutorialReset',
  'shopTabs',
  'shopGuide',
  'shopDialog',
  'shopChatter',
  'loading',
  'saveStatus',
  'syncState',
  'playerScopeStatus',
  'lastRunSync',
  'writesInFlight',
  'unsavedChanges',
  'syncedSave',
  'maybeRoomDifficulty',
  'maybeRoomModifiers',
  'maybeRoomDareMark',
  'maybeCrewRunKey',
  'maybeRunNet',
  'runTally',
  'rankPaid',
  'maybeRankGain',
  'missionRun',
  'maybeMissionGain',
  'journalRun',
  'masteryRun',
  'shareSheet',
  'maybeShareCopiedAtMs',
  'isRunCardDropped',
  'maybeDeathTip',
  'maybeNewerBuild',
  'updateGift',
  'installOffer',
  'maybeSupportUrl',
  'runSeed',
  'runPool',
  'crewBots',
  'soundSetting',
  'musicSetting',
  'screenFit',
  'fullscreen',
  'shakeSetting',
  'rotationSetting',
  'rumbleSetting',
  'recordRuns',
  'shareStats',
  'cursorSetting',
  'trapNotice',
] as const

const LEGACY_COSMETIC_FIELDS = [
  'breakIdleMs',
  'particles',
  'decals',
  'dustCooldownMs',
  'tellWatch',
  'actionWatch',
  'popups',
  'blasts',
  'callouts',
  'levelCallouts',
  'prizeFlight',
  'clocheLift',
  'cosmeticRngState',
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
  ...Array.map(
    LEGACY_COSMETIC_FIELDS,
    (field): readonly [string, FieldClass] => [field, 'Cosmetic'],
  ),
])

const classOf = (field: string): FieldClass | undefined =>
  CLASS_BY_FIELD.get(field)

const isHashedClass = (fieldClass: FieldClass | undefined): boolean =>
  fieldClass === undefined || fieldClass === 'World' || fieldClass === 'Gate'

const byField = (
  [a]: readonly [string, unknown],
  [b]: readonly [string, unknown],
): number => (a < b ? -1 : a > b ? 1 : 0)

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

const isSoloDefault = (field: string, value: unknown): boolean =>
  field === 'party' &&
  typeof value === 'object' &&
  value !== null &&
  '_tag' in value &&
  value._tag === 'Solo'

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

export const unclassifiedFieldsOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(
    Array.map(flatEntriesOf(model), ([field]) => field),
    field => classOf(field) === undefined,
  ).sort()

export const gameplayOf = (model: Model): Readonly<Record<string, unknown>> =>
  Record.fromEntries(gameplayEntriesOf(model))
