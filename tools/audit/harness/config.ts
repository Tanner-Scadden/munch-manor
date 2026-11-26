import {
  Array,
  Effect,
  Record,
  type Result,
  Schema,
  SchemaGetter,
  String,
} from 'effect'

import {
  DoorId,
  FridgePrize,
  NightmareLock,
  PickupKind,
  ZombieKind,
} from '@game/app/model'
import {
  Body,
  Calling,
  Difficulty,
  GunSkin,
  HairColor,
  HairStyle,
  Hat,
  Outfit,
  Print,
  PropStyle,
  RunEnding,
  ShirtColor,
  SkinTone,
} from '@game/shared/playerData'
import { StationId } from '@game/world/schema/worldSchema'

const Flag = Schema.String.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform(() => true),
    encode: SchemaGetter.transform(() => ''),
  }),
  Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
)

const Num = (fallback: number) =>
  Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(globalThis.String(fallback))),
  )

const MaybeNum = Schema.optionalKey(Schema.FiniteFromString)

const Choice = <const L extends ReadonlyArray<string>>(literals: L) =>
  Schema.optionalKey(Schema.Literals(literals))

const split = (text: string, separator: string) =>
  Array.filter(String.split(separator)(text), part => part.length > 0)

const SplitBy = (separator: string, isKeepingEmpty = false) =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.Array(Schema.String), {
      decode: SchemaGetter.transform(text =>
        isKeepingEmpty ? String.split(separator)(text) : split(text, separator),
      ),
      encode: SchemaGetter.transform(parts => Array.join(parts, separator)),
    }),
  )

const ListOf = <S extends Schema.Top & { readonly Encoded: string }>(item: S) =>
  SplitBy(',').pipe(Schema.decodeTo(Schema.Array(item)))

const AllOr = <S extends Schema.Top & { readonly Encoded: string }>(item: S) =>
  Schema.optionalKey(Schema.Union([Schema.Literal('all'), ListOf(item)]))

const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])

const PointFromString = SplitBy(',', true).pipe(Schema.decodeTo(Point))

const Puddles = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(PointFromString), {
    decode: SchemaGetter.transform(text => split(text, ';')),
    encode: SchemaGetter.transform(spots => Array.join(spots, ';')),
  }),
)

const KillCount = Schema.Tuple([ZombieKind, Schema.FiniteFromString])

const Kills = SplitBy(',').pipe(
  Schema.decodeTo(Schema.Array(SplitBy(':', true))),
  Schema.decodeTo(Schema.Array(KillCount)),
)

const LookPart = <S extends Schema.Top>(part: S) =>
  Schema.Union([Schema.Literal(''), part])

const LOOK_PARTS = 9

const Look = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.transform(text => {
      const parts = String.split(',')(text)
      return globalThis.Array.from(
        { length: LOOK_PARTS },
        (_, index) => parts[index] ?? '',
      )
    }),
    encode: SchemaGetter.transform(parts => Array.join(parts, ',')),
  }),
  Schema.decodeTo(
    Schema.Tuple([
      LookPart(Body),
      LookPart(HairStyle),
      LookPart(HairColor),
      LookPart(SkinTone),
      LookPart(ShirtColor),
      LookPart(Outfit),
      LookPart(Print),
      LookPart(Schema.Literal('Beard')),
      LookPart(Schema.Literal('Glasses')),
    ]),
  ),
)

export const HarnessConfig = Schema.Struct({
  wave: Num(0),
  mode: Choice(['endless', 'campaign']),
  start: Choice(['wave']),
  phase: Choice([
    'escaped',
    'victory',
    'paused',
    'gameover',
    'leftearly',
    'arriving',
  ]),
  cut: Choice(['full', 'short']),
  introMs: Num(2000),
  carLine: Schema.optionalKey(RunEnding),
  lineAt: Num(0),
  party: MaybeNum,
  bots: MaybeNum,
  lobbybots: MaybeNum,
  elapsed: Num(0),
  clock: MaybeNum,
  heat: MaybeNum,
  trauma: MaybeNum,
  blast: MaybeNum,
  prep: Num(20000),
  break: Choice(['open']),
  breakMs: Num(0),
  idle: Num(0),
  mates: Choice(['ready']),
  money: Num(0),
  barricades: Num(0),
  turrets: Num(0),
  stats: Flag,
  runs: MaybeNum,
  device: Choice(['touch']),
  learned: Schema.optionalKey(
    ListOf(
      Schema.Literals([
        'move',
        'fire',
        'startWave',
        'swap',
        'pickup',
        'timedBreaks',
        'openBreak',
        'dareTour',
        'dareKey',
        'rattles',
        'displayCase',
        'dareCard',
        'gunLevel',
      ]),
    ),
  ),
  traphint: Choice(['Barricade', 'Turret']),
  quest: Choice(['running', 'card', 'start', 'done', 'kitchendone']),
  newthings: Flag,
  darefound: Num(0),
  pocket: MaybeNum,
  pocketfold: MaybeNum,
  dareopen: MaybeNum,
  satchel: Num(0),
  darenear: MaybeNum,
  finale: Choice(['summoned', 'open']),
  px: MaybeNum,
  py: MaybeNum,
  gun: Choice([
    'smg',
    'shotgun',
    'cooker',
    'pan',
    'freeze',
    'rifle',
    'blunderbuss',
  ]),
  first: Choice(['smg', 'shotgun', 'cooker', 'freeze']),
  pan: Flag,
  knife: Flag,
  stab: Flag,
  loaded: Num(30),
  tier: Num(0),
  gunkills: Schema.optionalKey(ListOf(Schema.FiniteFromString)),
  perk: Choice(['Spicy', 'Crispy', 'Hearty']),
  levelup: MaybeNum,
  pistol: MaybeNum,
  aim: Schema.optionalKey(PointFromString),
  stick: Schema.optionalKey(PointFromString),
  god: Flag,
  look: Schema.optionalKey(Look),
  picker: Flag,
  looksection: Choice(['Body', 'Hair', 'Outfit', 'Gear']),
  profile: Choice(['look', 'name', 'account', 'settings', 'mastery']),
  name: Schema.optionalKey(Schema.String),
  sync: Choice(['local', 'connecting', 'synced', 'offline', 'broken']),
  devices: Num(1),
  link: Choice([
    'requesting',
    'showing',
    'entering',
    'redeeming',
    'linked',
    'failed',
  ]),
  looksheet: Flag,
  fill: Flag,
  crowd: MaybeNum,
  crowdx: Num(0),
  crowdy: Num(0),
  tough: Flag,
  gasroom: Num(0),
  lineup: Choice(['wear', 'sizes', 'armor', 'boss']),
  seen: AllOr(ZombieKind),
  card: MaybeNum,
  pickups: AllOr(PickupKind),
  pickupY: Num(128),
  pickupAge: Num(2000),
  boosts: AllOr(PickupKind),
  boostMs: Num(5000),
  callout: Schema.optionalKey(PickupKind),
  calloutAge: Num(400),
  calloutLook: Choice(['Explained', 'Named']),
  seenpowerups: AllOr(PickupKind),
  bounty: Flag,
  boss: Choice([
    'arriving',
    'stomp',
    'slam',
    'belch',
    'charge',
    'rush',
    'spit',
    'dazed',
    'fighting',
  ]),
  door: Schema.optionalKey(DoorId),
  arriveMs: Num(2600),
  windMs: Num(1000),
  cooldownMs: Num(60_000),
  globMs: Num(450),
  bx: Num(200),
  by: Num(80),
  tx: Num(120),
  ty: Num(120),
  bosshp: Num(1),
  enraged: Flag,
  puddles: Schema.optionalKey(Puddles),
  puddleMs: Num(3000),
  gasbags: Flag,
  fuseMs: Num(150),
  frenzy: Flag,
  hordeAge: Num(300),
  wipe: Flag,
  chucker: Choice(['heft', 'throw', 'taunt', 'shield', 'dazed']),
  cx: MaybeNum,
  cy: MaybeNum,
  heftMs: Num(450),
  flyMs: Num(400),
  shieldMs: Num(3000),
  crawler: Choice(['surfacing', 'cling']),
  wx: Num(100),
  wy: Num(125),
  surfMs: Num(400),
  kitchen: Flag,
  ovens: Choice(['belch', 'cool']),
  ovenMs: Num(300),
  slip: Flag,
  hold: Flag,
  fridge: Choice(['open', 'offering', 'slammed']),
  prize: Schema.optionalKey(FridgePrize),
  fridgeMs: Num(600),
  fridgeseed: MaybeNum,
  prizes: Schema.optionalKey(ListOf(FridgePrize)),
  lobs: Flag,
  caseopen: Flag,
  iced: Choice(['freeze', 'pan']),
  planks: Schema.optionalKey(ListOf(DoorId)),
  plankhp: Num(30),
  gnomes: Schema.optionalKey(Puddles),
  chewers: Num(0),
  doorway: Flag,
  openexits: Schema.optionalKey(ListOf(Schema.String)),
  fallen: Flag,
  cleat: Num(0),
  valve: Flag,
  findroom: Schema.optionalKey(Schema.String),
  findwork: Num(0),
  findgap: Num(0),
  wake: Schema.optionalKey(ListOf(DoorId)),
  tool: Schema.optionalKey(StationId),
  worked: Num(0),
  firedms: MaybeNum,
  house: Num(0),
  ask: Flag,
  difficulty: Schema.optionalKey(Difficulty),
  calling: Schema.optionalKey(Calling),
  nightmare: Schema.optionalKey(NightmareLock),
  best: MaybeNum,
  rank: MaybeNum,
  rankgain: MaybeNum,
  mods: MaybeNum,
  marks: MaybeNum,
  dmark: MaybeNum,
  beat: Choice(['offered', 'taken']),
  hat: Schema.optionalKey(Hat),
  skin: Schema.optionalKey(GunSkin),
  heropoints: MaybeNum,
  gunmastery: MaybeNum,
  propstyle: Schema.optionalKey(PropStyle),
  bought: Schema.optionalKey(ListOf(Schema.String)),
  fresh: Flag,
  bones: MaybeNum,
  spent: MaybeNum,
  bests: Flag,
  kills: Schema.optionalKey(Kills),
  opened: Schema.optionalKey(ListOf(ZombieKind)),
  newentries: Schema.optionalKey(ListOf(ZombieKind)),
  homemode: Choice(['endless', 'campaign']),
  newsseen: Flag,
  proof: Flag,
  journal: Flag,
  journalall: Flag,
  newer: Schema.optionalKey(Schema.String),
  fit: Choice(['home', 'full']),
  install: Flag,
  greet: Flag,
  unwrap: Flag,
  support: Flag,
  rotate: Flag,
  coop: Choice([
    'tile',
    'hub',
    'problem',
    'code',
    'asking',
    'queue',
    'offer',
    'accepted',
    'lobby',
    'host',
    'picks',
    'heroes',
    'name',
    'herosale',
    'heroshort',
    'guest',
    'nudge',
    'padlock',
    'keep',
    'ready',
    'result',
    'arena',
    'away',
    'ended',
    'card',
    'cardwon',
    'cardduo',
    'live',
  ]),
  seats: MaybeNum,
  freeze: MaybeNum,
  tick: MaybeNum,
  seed: MaybeNum,
  instrument: Flag,
  nodev: Flag,
  nohud: Flag,
  flat: Flag,
  quality: Choice(['full', 'light', 'scaled', 'floor', 'auto']),
  director: Flag,
})
export type HarnessConfig = typeof HarnessConfig.Type

export const decodeHarnessConfig = (
  search: string,
): Result.Result<HarnessConfig, Schema.SchemaError> =>
  Schema.decodeResult(HarnessConfig)(
    Record.fromEntries(new URLSearchParams(search)),
    { onExcessProperty: 'error', errors: 'all' },
  )
