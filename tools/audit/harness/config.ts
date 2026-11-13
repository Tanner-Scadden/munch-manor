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
    Schema.withDecodingDefaultKey(Effect.succeed(globalThis.String(fallback))),
  )

const MaybeNum = Schema.optionalKey(Schema.FiniteFromString)

const Choice = <const L extends ReadonlyArray<string>>(literals: L) =>
  Schema.optionalKey(Schema.Literals(literals))

const split = (text: string, separator: string) =>
  Array.filter(String.split(separator)(text), part => part.length > 0)

// NOTE: text split into its parts, which the next Schema decodes.
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
  // The run
  wave: Num(0),
  mode: Choice(['endless', 'campaign']),
  start: Choice(['wave']),
  // NOTE: `escaped` ends the run in an escape; `victory` is its old name,
  // kept for shot lists written before it.
  phase: Choice([
    'escaped',
    'victory',
    'paused',
    'gameover',
    'leftearly',
    'arriving',
  ]),
  // NOTE: `phase=arriving` stands the run in its intro: `cut` and
  // `introMs` into it, the friends' line the `lineAt`th of `carLine`'s.
  cut: Choice(['full', 'short']),
  introMs: Num(2000),
  carLine: Schema.optionalKey(RunEnding),
  lineAt: Num(0),
  // NOTE: `party` seats a crew of that many players around the player, each
  // with kills of their own, as the end card's crew and MVP show them.
  party: MaybeNum,
  // NOTE: `bots` seats teammate bots, 1 to 3, as the lobby does.
  bots: MaybeNum,
  // NOTE: `lobbybots` waits that many bots in the lobby's seats, for PLAY to open.
  lobbybots: MaybeNum,
  elapsed: Num(0),
  prep: Num(20000),
  break: Choice(['open']),
  breakMs: Num(0),
  // NOTE: `idle` is how long the player has done nothing in the break, ms, so
  // 16000 shows the READY nudge in a break without a clock; `mates=ready`
  // marks every other seat of a `party` READY.
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
  // NOTE: `quest` stages the guided first break running or just done, and
  // `kitchendone` the kitchen tour just done.
  // `card` stages its last step, looking at the dare card.
  quest: Choice(['running', 'card', 'start', 'done', 'kitchendone']),
  // NOTE: `darefound=N` marks the first N things of the dare card found.
  // NOTE: `newthings` rolls the list from a pool with the four things the
  // Dare Journal's milestones open (src/world/dare/milestones.ts).
  newthings: Flag,
  darefound: Num(0),
  // NOTE: `pocket=N` holds the dare card from the pocket out, read for N ms
  // (src/features/dare/pocketCard.ts); `pocketfold=N` has it folding for N ms.
  pocket: MaybeNum,
  pocketfold: MaybeNum,
  // NOTE: `dareopen=N` has the card opened again from the HUD's list for N
  // ms, with its satchel; `satchel=N` says the first N things found were
  // in it already, so the rest drop in.
  dareopen: MaybeNum,
  satchel: Num(0),
  // NOTE: `darenear=N` stands the player N px south of the first thing of
  // the dare's list still lying in an open room, so it is in sight.
  darenear: MaybeNum,
  // NOTE: `finale=summoned` finds the whole list and has Uncle Chunk due
  // (stage him with `boss`), so felling him bursts his key; `finale=open`
  // finds the list with the front door already open.
  finale: Choice(['summoned', 'open']),
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
  loaded: Num(30),
  tier: Num(0),
  // NOTE: `gunkills=25,90` gives the first and second gun that many kills
  // of their own, toward their next level; `perk` cooks the gun in hand;
  // `levelup` pops the gun in hand's level up to that tier, `calloutAge` ms
  // in.
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
  // The room
  fill: Flag,
  crowd: MaybeNum,
  // How far east of the dining room the crowd stands (`crowdx=680` puts it
  // in the cellar).
  crowdx: Num(0),
  // And how far south (`crowdy=-140` puts it in the kitchen).
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
  // The boss
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
  // The fridge prizes pulled before (`Cooker,Freeze`): the shop guide's
  // fridge page shows them in place of ???.
  prizes: Schema.optionalKey(ListOf(FridgePrize)),
  lobs: Flag,
  // NOTE: `caseopen` springs every display case open for the player, so a
  // scene can stand at a prize to take.
  caseopen: Flag,
  iced: Choice(['freeze', 'pan']),
  // Traps and difficulty
  planks: Schema.optionalKey(ListOf(DoorId)),
  plankhp: Num(30),
  chewers: Num(0),
  doorway: Flag,
  openexits: Schema.optionalKey(ListOf(Schema.String)),
  // The dining room's chandelier lying in the table's gap, and the share of
  // its cleat's set-up already worked (src/world/stations/stations.ts).
  fallen: Flag,
  cleat: Num(0),
  // A room's find (src/world/dare/finds.ts): `findroom=Parlour` lays the
  // dare list's first thing hidden on that room's first hiding spot, with
  // `findwork` of its work done, and stands the player `findgap` px south
  // of it (0 stands them on it, at work).
  findroom: Schema.optionalKey(Schema.String),
  findwork: Num(0),
  findgap: Num(0),
  // `wake=Back,Window` wakes those doors' room (src/world/level/wakeUp.ts),
  // its rush alone: a wave's own spawns are dropped first.
  wake: Schema.optionalKey(ListOf(DoorId)),
  // A room tool (src/world/stations/toolRules.ts): the share of its set-up
  // already `worked`, or `firedms` since it fired, its effect on for what is
  // left of its time.
  tool: Schema.optionalKey(StationId),
  worked: Num(0),
  firedms: MaybeNum,
  // Which rolled house the run stands in, by its place in ARRANGEMENTS
  // (src/world/level/plan.ts): the first, the parlour west, the library
  // east, and the cellar beyond, unless given.
  house: Num(0),
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
  // The run modifiers on, as the lobby's mask: Friendly Fire 1, Big Crowd 2,
  // Broke 4, Glass 8 (src/world/run/modifiers.ts)
  mods: MaybeNum,
  // The earned looks: the hat and gun skin worn, the cosmetic ids bought
  // (`Fez`, `skin:Candy`), and the Bones earned (over the tenth of the
  // rank's points) and spent. `fresh` leaves the gifts reached unseen, so
  // they wear NEW badges and pips.
  hat: Schema.optionalKey(Hat),
  skin: Schema.optionalKey(GunSkin),
  // Hero and gun mastery (src/domain/mastery.ts): `heropoints` gives the
  // last hero that many points and each before it a share less, as
  // `gunmastery` does the guns, and `propstyle` is the prop style worn.
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
  // The Proof Shelf: a sample shelf (finds on three difficulties, the big
  // key on Easy, a crew with a bot) and a week of mission days, on a known
  // day.
  proof: Flag,
  // The Dare Journal: a sample journal (four milestones, two of them new,
  // two rooms opened, two heroes played) for its pages.
  journal: Flag,
  // NOTE: `journalall` reaches every milestone, so all four new things are
  // open on the list and the shelf.
  journalall: Flag,
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
  // With `coop=live`: the room's seats (default 4); `crowd` is its zombies.
  seats: MaybeNum,
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

export const decodeHarnessConfig = (
  search: string,
): Result.Result<HarnessConfig, Schema.SchemaError> =>
  Schema.decodeResult(HarnessConfig)(
    Record.fromEntries(new URLSearchParams(search)),
    { onExcessProperty: 'error', errors: 'all' },
  )
