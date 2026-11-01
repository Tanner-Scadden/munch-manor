import { Effect, Schema, SchemaGetter } from 'effect'

import {
  DoorId,
  FridgePrize,
  NightmareLock,
  PickupKind,
  ZombieKind,
} from '@game/model'
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
  ShirtColor,
  SkinTone,
} from '@game/playerData'

// NOTE: the harness's query string, decoded once. An unknown key or a bad
// value throws when the page loads, so a typo in an audit script fails loudly
// instead of quietly showing the default scene. Every key is documented in
// tools/audit/README.md.

const Flag = Schema.String.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform(() => true),
    encode: SchemaGetter.transform(() => ''),
  }),
  Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
)

const Num = (fallback: number) =>
  Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(String(fallback))),
  )

const MaybeNum = Schema.optionalKey(Schema.FiniteFromString)

const Choice = <const L extends ReadonlyArray<string>>(literals: L) =>
  Schema.optionalKey(Schema.Literals(literals))

const split = (text: string, separator: string) =>
  text.split(separator).filter(part => part.length > 0)

// NOTE: text split into its parts, which the next Schema decodes.
const SplitBy = (separator: string, isKeepingEmpty = false) =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.Array(Schema.String), {
      decode: SchemaGetter.transform(text =>
        isKeepingEmpty ? text.split(separator) : split(text, separator),
      ),
      encode: SchemaGetter.transform(parts => parts.join(separator)),
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
    encode: SchemaGetter.transform(spots => spots.join(';')),
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
      const parts = text.split(',')
      return Array.from(
        { length: LOOK_PARTS },
        (_, index) => parts[index] ?? '',
      )
    }),
    encode: SchemaGetter.transform(parts => parts.join(',')),
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
  // The run
  wave: Num(0),
  mode: Choice(['endless', 'campaign']),
  start: Choice(['wave']),
  phase: Choice(['victory', 'paused', 'gameover']),
  // NOTE: `party` seats a crew of that many players around the player, each
  // with kills of their own, as the end card's crew and MVP show them.
  party: MaybeNum,
  elapsed: Num(0),
  prep: Num(20000),
  break: Choice(['open']),
  breakMs: Num(0),
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
        'shop',
        'swap',
        'pickup',
        'timedBreaks',
        'openBreak',
      ]),
    ),
  ),
  traphint: Choice(['Barricade', 'Turret']),
  // NOTE: `quest` stages the guided first break running or just done, and
  // `kitchendone` the kitchen tour just done.
  quest: Choice(['running', 'done', 'kitchendone']),
  // The player and the guns
  px: MaybeNum,
  py: MaybeNum,
  gun: Choice(['smg', 'shotgun', 'cooker', 'pan', 'freeze']),
  // NOTE: `gun=pan` puts the Clang Pan in the melee slot, in hand. `first`
  // puts a gun in the first slot in place of the pistol, as a player who
  // traded it away carries; `pan` puts the Clang Pan (at `tier`) in the
  // melee slot in place of the knife; `knife` puts the melee slot in hand,
  // and `stab` does and holds the trigger from the first frame, so the
  // knife stabs.
  first: Choice(['smg', 'shotgun', 'cooker', 'freeze']),
  pan: Flag,
  knife: Flag,
  stab: Flag,
  // NOTE: `dry` empties every gun the player carries, so the knife's slot
  // pulses.
  dry: Flag,
  rounds: MaybeNum,
  loaded: Num(30),
  tier: Num(0),
  pistol: MaybeNum,
  aim: Schema.optionalKey(PointFromString),
  stick: Schema.optionalKey(PointFromString),
  god: Flag,
  look: Schema.optionalKey(Look),
  picker: Flag,
  looksection: Choice(['Body', 'Hair', 'Outfit', 'Gear']),
  profile: Choice(['look', 'name', 'account', 'settings']),
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
  // The room
  fill: Flag,
  crowd: MaybeNum,
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
  // The boss
  boss: Choice([
    'arriving',
    'stomp',
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
  // The other kinds
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
  // The kitchen
  kitchen: Flag,
  ovens: Choice(['belch', 'cool']),
  ovenMs: Num(300),
  slip: Flag,
  hold: Flag,
  // Mystery Leftovers
  fridge: Choice(['open', 'offering', 'slammed']),
  prize: Schema.optionalKey(FridgePrize),
  fridgeMs: Num(600),
  fridgeseed: MaybeNum,
  lobs: Flag,
  iced: Choice(['freeze', 'pan']),
  // Traps and difficulty
  planks: Schema.optionalKey(ListOf(DoorId)),
  plankhp: Num(30),
  chewers: Num(0),
  doorway: Flag,
  openexits: Schema.optionalKey(ListOf(Schema.String)),
  ask: Flag,
  difficulty: Schema.optionalKey(Difficulty),
  // The calling picked and worn, whatever the rank
  calling: Schema.optionalKey(Calling),
  nightmare: Schema.optionalKey(NightmareLock),
  // The home menu and the save
  best: MaybeNum,
  // Rank: the total points the player holds (after the run on an end card),
  // and the points the run on the end card just paid, for its strip
  rank: MaybeNum,
  rankgain: MaybeNum,
  // The earned looks: the hat and gun skin worn, the cosmetic ids bought
  // (`Fez`, `skin:Candy`), and the Bones earned (over the tenth of the
  // rank's points) and spent. `fresh` leaves the gifts reached unseen, so
  // they wear NEW badges and pips.
  hat: Schema.optionalKey(Hat),
  skin: Schema.optionalKey(GunSkin),
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
  newer: Schema.optionalKey(Schema.String),
  fit: Choice(['home', 'full']),
  install: Flag,
  greet: Flag,
  unwrap: Flag,
  support: Flag,
  rotate: Flag,
  // Co-op
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
    'keep',
    'ready',
    'result',
    'arena',
    'away',
    'ended',
    'card',
    'cardwon',
    'cardduo',
  ]),
  // Measuring
  freeze: MaybeNum,
  tick: MaybeNum,
  seed: MaybeNum,
  instrument: Flag,
  nodev: Flag,
  // The video tool (tools/video): ticks only when it asks, logs audio
  director: Flag,
})
export type HarnessConfig = typeof HarnessConfig.Type

export const decodeHarnessConfig = (search: string): HarnessConfig =>
  Schema.decodeSync(HarnessConfig)(
    Object.fromEntries(new URLSearchParams(search)),
    { onExcessProperty: 'error', errors: 'all' },
  )
