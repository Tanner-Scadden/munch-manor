// NOTE: the harness's room: the run a scene starts in, built from the
// query (the wave, the phase, guns, money, a crowd, a lineup, the boss,
// staged zombies, the HUD's extras, and a staged end screen).

import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf, openExitIn } from '@game/arena'
import { BOSS_RULES, hasBoss, planBoss } from '@game/boss'
import { activeBots, addBot, seatCallings } from '@game/bots'
import { cameraOf, worldToView } from '@game/camera'
import { DECAL_MAX } from '@game/constants'
import { noteRecords } from '@game/endBeat'
import { rollSpawns } from '@game/endlessWaves'
import { KITCHEN_EXIT } from '@game/exits'
import { withBests } from '@game/home'
import {
  Arsenal,
  type Boosts,
  type Boss,
  type BossMove,
  BreakClock,
  type Decal,
  type DecalKind,
  type Glob,
  Melee,
  type Model,
  MouseButton,
  Phase,
  type PickupKind,
  RunMode,
  Stick,
  type WeaponKind,
  type Zombie,
  type ZombieKind,
  initialModel,
} from '@game/model'
import { raiseDebutCard } from '@game/onboarding'
import { advanceParticles } from '@game/particles'
import { creditKills, seatCrew } from '@game/party'
import { startOrResume } from '@game/runFlow'
import { shedParts } from '@game/simulation'
import { planFor } from '@game/wavePlans'
import { pause } from '@game/waves'
import { STARTING_PISTOL, freshGun, mapGuns } from '@game/weapons'
import { withWorld } from '@game/world'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, scaledHp } from '@game/zombies'

import { type SceneSettings } from './settings'

export const ROAMING: Zombie['action'] = { _tag: 'Roaming' }
export const CALM: Zombie['frenzy'] = { _tag: 'Calm' }

const KINDS: ReadonlyArray<DecalKind> = [
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
]

const makeDecals = (count: number): Array<Decal> => {
  const out: Array<Decal> = []
  let s = 12345
  const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 0xffffffff
  for (let i = 0; i < count; i++) {
    out.push({
      kind: KINDS[i % KINDS.length] ?? 'Blood',
      x: Math.round(24 + r() * 272),
      y: Math.round(24 + r() * 132),
      width: 2 + Math.round(r() * 5),
      height: 1 + Math.round(r() * 3),
    })
  }
  return out
}

const FRIDGE_GUNS: Readonly<Record<'cooker' | 'pan' | 'freeze', WeaponKind>> = {
  cooker: 'Cooker',
  pan: 'Pan',
  freeze: 'Freeze',
}

export const roomModel = (settings: SceneSettings): Model => {
  const { config, gasbagRoom, px, py } = settings
  const wave = config.wave
  if (wave === 0) {
    return initialModel
  }
  const mode =
    config.mode === 'endless' ? RunMode.Endless() : RunMode.Campaign()
  const begun = startOrResume(initialModel, mode)
  const started = config.kitchen
    ? modifyFields(begun, {
        level: level => openExitIn(level, KITCHEN_EXIT),
      })
    : begun
  const [rngState, spawns] = rollSpawns(
    started.rngState,
    wave,
    levelOf(started).doorIds,
  )
  const gun = config.gun
  const smgRounds = config.rounds ?? 360
  const shotgunRounds = config.rounds ?? 48
  const firstGun = config.first
  const first =
    firstGun === undefined
      ? STARTING_PISTOL
      : firstGun === 'smg'
        ? { ...freshGun('Smg'), rounds: smgRounds, tier: config.tier }
        : firstGun === 'shotgun'
          ? { ...freshGun('Shotgun'), rounds: shotgunRounds, tier: config.tier }
          : { ...freshGun(FRIDGE_GUNS[firstGun]), tier: config.tier }
  let model: Model = modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      config.start === 'wave'
        ? Phase.Wave({ wave, elapsedMs: config.elapsed, spawns })
        : Phase.Preparation({
            wave,
            remainingMs: config.prep,
            durationMs: 20000,
            spawns,
            clock:
              config.break === 'open'
                ? BreakClock.Waiting({ elapsedMs: config.breakMs })
                : BreakClock.Counting(),
          }),
    wallet: w => ({
      ...w,
      balance: config.money,
      shown: config.money,
      earned: config.money,
    }),
    decals: () => (config.fill ? makeDecals(DECAL_MAX) : []),
    trapStock: () => ({
      Barricade: config.barricades,
      Turret: config.turrets,
    }),
    player: p =>
      gun === 'smg'
        ? {
            ...p,
            arsenal: Arsenal.HoldingSecond({
              first,
              second: {
                kind: 'Smg',
                rounds: smgRounds,
                loaded: Math.min(config.loaded, smgRounds),
                tier: config.tier,
              },
            }),
          }
        : gun === 'pan'
          ? {
              ...p,
              arsenal: Arsenal.OneGun({ first }),
              melee: Melee.Pan({
                pan: { ...freshGun('Pan'), tier: config.tier },
              }),
              wield: 'Melee',
            }
          : gun === 'cooker' || gun === 'freeze'
            ? {
                ...p,
                arsenal: Arsenal.HoldingSecond({
                  first,
                  second: { ...freshGun(FRIDGE_GUNS[gun]), tier: config.tier },
                }),
              }
            : gun === 'shotgun'
              ? {
                  ...p,
                  arsenal: Arsenal.HoldingSecond({
                    first,
                    second: {
                      kind: 'Shotgun',
                      rounds: shotgunRounds,
                      loaded: Math.min(6, shotgunRounds),
                      tier: config.tier,
                    },
                  }),
                }
              : p,
  })
  const crowd = config.crowd ?? gasbagRoom
  const toughness = config.tough ? 40 : 1
  if (crowd > 0) {
    const kinds = [
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
      'Shambler',
      'Runner',
      'Shambler',
    ] as const
    const spots: ReadonlyArray<readonly [number, number]> = [
      [40, 40],
      [280, 40],
      [40, 140],
      [250, 120],
      [160, 30],
      [160, 150],
      [30, 90],
      [290, 90],
    ]
    const zombies = globalThis.Array.from({ length: crowd }, (_, i): Zombie => {
      const kind =
        gasbagRoom > 0
          ? 'Exploder'
          : i < 4
            ? 'Tank'
            : (kinds[i % kinds.length] ?? 'Shambler')
      const [sx, sy] = spots[i % spots.length] ?? [0, 0]
      return {
        id: 1000 + i,
        kind,
        x: sx + ((i * 7) % 13) - 6,
        y: sy + ((i * 5) % 11) - 5,
        speed: kind === 'Runner' ? 46 : kind === 'Tank' ? 12 : 22,
        hp: (kind === 'Tank' ? 14 : kind === 'Runner' ? 1 : 2) * toughness,
        maxHp: (kind === 'Tank' ? 30 : kind === 'Runner' ? 2 : 3) * toughness,
        knockback: { x: 0, y: 0 },
        hitRemainingMs: 0,
        state: { _tag: 'Walking' },
        action: ROAMING,
        frenzy: CALM,
      }
    })
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  const lineup = config.lineup
  const stageHp = (kind: LineupKind, maxHp: number, stage: number) =>
    stage === 0
      ? maxHp
      : Math.max(
          1,
          Math.floor(maxHp * (ZOMBIE_KINDS[kind].wear[stage - 1]?.below ?? 1)),
        )
  type LineupKind = ZombieKind
  const standing = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    maxHp: number,
    stage: number,
  ): Zombie => ({
    id,
    kind,
    x,
    y,
    speed: 0,
    hp: stageHp(kind, maxHp, stage),
    maxHp,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: { _tag: 'Walking' },
    action: ROAMING,
    frenzy: CALM,
  })
  if (lineup === 'wear') {
    const rows: Array<[LineupKind, number, number, number]> = [
      ['Shambler', 4, 50, 50],
      ['Runner', 2, 50, 72],
      ['Exploder', 7, 50, 96],
      ['Tank', 36, 180, 64],
      ['Thrower', 15, 180, 100],
      ['Crawler', 2, 50, 118],
    ]
    const zombies = rows.flatMap(([kind, maxHp, left, y], row) =>
      globalThis.Array.from(
        { length: ZOMBIE_KINDS[kind].wear.length + 1 },
        (_, stage) =>
          standing(
            1000 + row * 10 + stage,
            kind,
            left + stage * (kind === 'Tank' ? 30 : 28),
            y,
            maxHp,
            stage,
          ),
      ),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'sizes') {
    const kinds: Array<[LineupKind, number]> = [
      ['Crawler', 2],
      ['Runner', 2],
      ['Shambler', 4],
      ['Exploder', 7],
      ['Thrower', 15],
      ['Tank', 36],
    ]
    const zombies = kinds.map(([kind, maxHp], index) =>
      standing(1000 + index, kind, 70 + index * 24, 100, maxHp, 0),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'armor') {
    const stages = ZOMBIE_KINDS.Tank.wear.length + 1
    const at = (stage: number) => ({ x: 70 + stage * 50, y: 90 })
    const fresh = globalThis.Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, 0),
    )
    const worn = globalThis.Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, stage),
    )
    const before = modifyFields(model, { zombies: () => fresh })
    const after = modifyFields(model, { zombies: () => worn })
    model = modifyFields(
      advanceParticles(
        { ...after, ...shedParts(before, after) },
        1 / 60,
        1000 / 60,
      ),
      { nextEntityId: () => 2000 },
    )
  }
  if (lineup === 'boss') {
    const zombies = globalThis.Array.from({ length: 5 }, (_, stage) =>
      standing(1100 + stage, 'Boss', 48 + stage * 56, 80, 99, stage),
    )
    model = modifyFields(model, {
      zombies: () => zombies,
      nextEntityId: () => 2000,
    })
  }
  const bossParam = config.boss
  if (bossParam !== undefined) {
    const bossMaxHp = scaledHp(ZOMBIE_KINDS.Boss.hp, planFor(8).hpScale)
    const bossHp = Math.round(bossMaxHp * config.bosshp)
    const { bx, by } = config
    const bossZombie: Zombie = {
      ...standing(1500, 'Boss', bx, by, bossMaxHp, 0),
      hp: bossHp,
      speed: 10,
    }
    const door = config.door ?? 'East'
    const target = { x: config.tx, y: config.ty }
    const toTarget = Math.hypot(target.x - bx, target.y - by) || 1
    const direction = {
      x: (target.x - bx) / toTarget,
      y: (target.y - by) / toTarget,
    }
    const windMs = config.windMs
    const puddles = (config.puddles ?? []).map(([x, y]): Glob => ({
      _tag: 'Pooled',
      at: { x, y },
      remainingMs: config.puddleMs,
      durationMs: BOSS_RULES.puddleMs,
    }))
    const flying: ReadonlyArray<Glob> =
      bossParam === 'spit'
        ? [
            {
              _tag: 'Flying',
              from: { x: bx, y: by },
              to: target,
              remainingMs: config.globMs,
              durationMs: BOSS_RULES.spitFlightMs,
            },
          ]
        : []
    const moves: Readonly<Record<string, () => BossMove>> = {
      stomp: () => ({
        _tag: 'WindingUp',
        attack: 'Stomp',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      belch: () => ({
        _tag: 'WindingUp',
        attack: 'Belch',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      charge: () => ({
        _tag: 'Bracing',
        target,
        remainingMs: windMs,
        durationMs: BOSS_RULES.windUpMs.Charge,
      }),
      rush: () => ({
        _tag: 'Rushing',
        direction,
        remainingPx: toTarget + BOSS_RULES.chargeOvershootPx,
      }),
      dazed: () => ({
        _tag: 'Dazed',
        remainingMs: windMs,
        durationMs: BOSS_RULES.dazedMs,
      }),
    }
    const moveFor = (): BossMove =>
      (
        moves[bossParam] ??
        ((): BossMove => ({ _tag: 'Stalking', cooldownMs: config.cooldownMs }))
      )()
    const bossState: Boss =
      bossParam === 'arriving'
        ? {
            _tag: 'Arriving',
            door,
            hp: bossMaxHp,
            remainingMs: config.arriveMs,
            durationMs: 2600,
          }
        : {
            _tag: 'Fighting',
            id: 1500,
            standingMs: 4000,
            move: moveFor(),
            mood: config.enraged ? 'Enraged' : 'Calm',
            nextFar: 'Charge',
            belchMs: 60_000,
            globs: [...puddles, ...flying],
          }
    model = modifyFields(model, {
      boss: () => bossState,
      zombies: zombies =>
        bossParam === 'arriving' ? zombies : [...zombies, bossZombie],
      nextEntityId: () => 2000,
    })
  } else if (hasBoss(wave)) {
    const planned =
      model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
        ? model.phase.spawns
        : []
    const [bossRng, plannedBoss] = planBoss(
      levelOf(model).doorIds,
      model.rngState,
      wave,
      planned,
      model.difficulty.chosen,
    )
    model = modifyFields(model, {
      boss: () => plannedBoss,
      rngState: () => bossRng,
    })
  }
  const staged: Array<Zombie> = []
  const stagedZombie = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    extra: Partial<Zombie> = {},
  ): Zombie => ({
    ...standing(id, kind, x, y, ZOMBIE_KINDS[kind].hp, 0),
    speed: 20,
    ...extra,
  })
  if (config.gasbags) {
    staged.push(
      stagedZombie(1700, 'Exploder', 70, 60),
      stagedZombie(1701, 'Exploder', px + 22, py - 4, {
        hp: 1,
      }),
      stagedZombie(1702, 'Exploder', 240, 120, {
        hp: 0,
        state: { _tag: 'Fusing', remainingMs: config.fuseMs },
      }),
    )
  }
  if (config.frenzy) {
    const pack = 4242
    const kinds: Array<LineupKind> = [
      'Shambler',
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
    ]
    kinds.forEach((kind, index) =>
      staged.push(
        stagedZombie(
          1720 + index,
          kind,
          50 + (index % 3) * 10,
          80 + Math.floor(index / 3) * 12 + (index % 2) * 3,
          {
            frenzy: { _tag: 'Frenzied', pack, apartMs: 0 },
          },
        ),
      ),
    )
    staged.push(
      stagedZombie(1730, 'Shambler', 120, 150, {
        frenzy: { _tag: 'Fading', pack, remainingMs: 500 },
      }),
    )
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Horde' as const,
          value: 0,
          x: 40,
          y: 72,
          velocityX: 0,
          ageMs: config.hordeAge,
        },
        ...(config.wipe
          ? [
              {
                kind: 'Wipe' as const,
                value: 5,
                x: 200,
                y: 80,
                velocityX: 0,
                ageMs: 400,
              },
            ]
          : []),
      ],
    })
  }
  const chucker = config.chucker
  if (chucker === 'heft') {
    staged.push(
      stagedZombie(1740, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: {
          _tag: 'Hefting',
          victimId: 1741,
          remainingMs: config.heftMs,
          durationMs: 900,
        },
      }),
      stagedZombie(1741, 'Shambler', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Carried', byId: 1740 },
      }),
    )
  }
  if (chucker === 'throw') {
    const from = { x: config.cx ?? 240, y: config.cy ?? 60 }
    const to = { x: px, y: py }
    const durationMs = 900
    const remainingMs = config.flyMs
    const progress = 1 - remainingMs / durationMs
    staged.push(
      stagedZombie(1750, 'Thrower', from.x, from.y, {
        action: { _tag: 'Winded', remainingMs: 2000 },
      }),
      stagedZombie(
        1751,
        'Shambler',
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        {
          action: { _tag: 'Flying', from, to, remainingMs, durationMs },
        },
      ),
    )
  }
  if (chucker === 'taunt') {
    staged.push(
      stagedZombie(1755, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Winded', remainingMs: 3100 },
      }),
    )
  }
  if (chucker === 'shield') {
    const at = { x: config.cx ?? 200, y: config.cy ?? 80 }
    const aim = Math.atan2(py - at.y, px - at.x)
    staged.push(
      stagedZombie(1790, 'Thrower', at.x, at.y, {
        action: {
          _tag: 'Shielding',
          victimId: 1791,
          remainingMs: config.shieldMs,
          aim,
        },
      }),
      stagedZombie(
        1791,
        'Shambler',
        at.x + Math.cos(aim) * 7,
        at.y + Math.sin(aim) * 7,
        {
          action: { _tag: 'Shielded', byId: 1790 },
        },
      ),
    )
  }
  if (chucker === 'dazed') {
    staged.push(
      stagedZombie(1760, 'Shambler', px + 14, py + 4, {
        action: { _tag: 'Dazed', remainingMs: 700, durationMs: 1000 },
      }),
    )
  }
  const crawler = config.crawler
  if (crawler === 'surfacing') {
    staged.push(
      stagedZombie(1770, 'Crawler', config.wx, config.wy, {
        action: {
          _tag: 'Burrowed',
          remainingMs: config.surfMs,
          durationMs: 1500,
        },
      }),
      stagedZombie(1771, 'Crawler', 230, 50, {
        action: { _tag: 'Burrowed', remainingMs: 1100, durationMs: 1500 },
      }),
    )
  }
  if (crawler === 'cling') {
    staged.push(
      stagedZombie(1780, 'Crawler', px, py + 2, {
        action: { _tag: 'Clinging', remainingMs: 800 },
      }),
      stagedZombie(1781, 'Crawler', px + 40, py + 20),
    )
  }
  if (staged.length > 0) {
    model = modifyFields(model, {
      zombies: zombies => [...zombies, ...staged],
      nextEntityId: () => 3000,
    })
  }
  const sampleStats = {
    kills: {
      Shambler: 41,
      Runner: 17,
      Tank: 2,
      Exploder: 9,
      Thrower: 2,
      Crawler: 3,
      Boss: 0,
    },
    wavesCleared: Math.max(0, wave - 1),
    shotsFired: 1240,
    shotsHit: 532,
    heartsLost: 7,
    trapsPlaced: 3,
    runMs: 371_000,
  }
  if (config.stats) {
    model = modifyFields(model, {
      stats: s => ({ ...s, ...sampleStats }),
      wallet: w => ({ ...w, earned: 615 }),
    })
  }
  if (config.py !== undefined) {
    model = modifyFields(model, {
      player: p => ({ ...p, x: config.px ?? p.x, y: py }),
      hintBand: () => (py < 70 ? 'Bottom' : 'Top'),
    })
  }
  const { best, pistol, aim, card } = config
  if (best !== undefined) {
    model = withBests(model, bests => ({
      ...bests,
      maybeBestEndlessWave: Option.some(best),
    }))
  }
  if (pistol !== undefined) {
    model = modifyFields(model, {
      player: p => ({
        ...p,
        arsenal: mapGuns(p.arsenal, held =>
          held.kind === 'Pistol' ? { ...held, tier: pistol } : held,
        ),
      }),
    })
  }
  if (aim !== undefined) {
    const [aimX, aimY] = aim
    model = modifyFields(model, {
      input: input => ({
        ...input,
        mouseButton: MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: Option.some({ x: aimX, y: aimY }),
      }),
    })
  }
  // NOTE: `stick=dx,dy` holds the trigger aimed that way from the player:
  // on touch with the aim stick, thumbed down at the lower right, and with
  // a keyboard and mouse with the mouse button over that spot.
  const stick = config.stick
  if (stick !== undefined) {
    const [dx, dy] = stick
    const originX = Math.round(window.innerWidth * 0.8)
    const originY = Math.round(window.innerHeight * 0.72)
    const aimed = { x: model.player.x + dx, y: model.player.y + dy }
    model = modifyFields(model, {
      input: input =>
        config.device === 'touch'
          ? {
              ...input,
              aimStick: Stick.Active({
                pointerId: 2,
                originX,
                originY,
                currentX: originX + dx,
                currentY: originY + dy,
              }),
            }
          : {
              ...input,
              mouseButton: MouseButton.Held({ pointerId: 1 }),
              maybeMouseInView: Option.some(
                worldToView(cameraOf(model), aimed),
              ),
            },
    })
  }
  if (config.device === 'touch') {
    model = modifyFields(model, { lastDevice: () => 'Touch' as const })
  }
  const seen = config.seen
  if (seen !== undefined) {
    model = raiseDebutCard(
      modifyFields(model, {
        introducedKinds: () => (seen === 'all' ? ZOMBIE_KIND_ORDER : seen),
      }),
    )
  }
  const debutCard = model.debutCard
  if (card !== undefined && debutCard._tag === 'Showing') {
    model = modifyFields(model, {
      debutCard: () => ({ ...debutCard, ageMs: card }),
    })
  }
  const PICKUP_KINDS: ReadonlyArray<PickupKind> = [
    'RapidFire',
    'Damage',
    'Speed',
    'Pierce',
    'Burp',
    'Heart',
  ]
  const kindsOf = (
    picked: 'all' | ReadonlyArray<PickupKind> | undefined,
  ): ReadonlyArray<PickupKind> =>
    picked === undefined ? [] : picked === 'all' ? PICKUP_KINDS : picked
  const pickupKinds = kindsOf(config.pickups)
  if (pickupKinds.length > 0) {
    const pickupY = config.pickupY
    model = modifyFields(model, {
      pickups: () =>
        pickupKinds.map((kind, index) => ({
          id: 3000 + index,
          kind,
          x: Math.round(160 + (index - (pickupKinds.length - 1) / 2) * 26),
          y: pickupY,
          ageMs: config.pickupAge + index * 170,
        })),
    })
  }
  const seenPowerUps = kindsOf(config.seenpowerups)
  if (seenPowerUps.length > 0) {
    model = modifyFields(model, { seenPowerUps: () => seenPowerUps })
  }
  const boostKinds = kindsOf(config.boosts).filter(
    kind => kind !== 'Burp' && kind !== 'Heart',
  )
  if (boostKinds.length > 0) {
    const boostMs = config.boostMs
    model = modifyFields(model, {
      boosts: boosts => {
        const next: { -readonly [Kind in keyof Boosts]: Boosts[Kind] } = {
          ...boosts,
        }
        boostKinds.forEach((kind, index) => {
          next[kind] = {
            _tag: 'On',
            remainingMs: Math.max(1, boostMs - index * 2200),
            durationMs: 8000,
          }
        })
        return next
      },
    })
  }
  const calloutKind = config.callout
  if (calloutKind !== undefined) {
    model = modifyFields(model, {
      callouts: () => [
        {
          kind: calloutKind,
          look: config.calloutLook ?? 'Explained',
          x: model.player.x,
          y: model.player.y,
          ageMs: config.calloutAge,
        },
      ],
    })
  }
  if (config.bounty) {
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Kill' as const,
          value: 3,
          x: 90,
          y: 80,
          velocityX: 0,
          ageMs: 50,
        },
        {
          kind: 'Kill' as const,
          value: 20,
          x: 150,
          y: 80,
          velocityX: 0,
          ageMs: 400,
        },
        {
          kind: 'Payday' as const,
          value: 35,
          x: 225,
          y: 80,
          velocityX: 0,
          ageMs: 600,
        },
      ],
    })
  }
  const { party } = config
  const PARTY_KILLS: ReadonlyArray<number> = [31, 47, 12, 8]
  if (party !== undefined) {
    model = withWorld(model, world =>
      Array.reduce(
        Array.range(0, party - 1),
        seatCrew(world, party),
        (seated, slot) => creditKills(seated, slot, PARTY_KILLS[slot] ?? 0),
      ),
    )
  }
  // NOTE: `bots` seats that many teammate bots, as the lobby's + BOT does,
  // each with kills of their own.
  const { bots } = config
  if (bots !== undefined) {
    const rostered = Array.reduce(Array.range(1, bots), model, seated =>
      addBot(seated),
    )
    const crewBots = activeBots(rostered)
    model = modifyFields(
      withWorld(rostered, world =>
        Array.reduce(
          Array.range(1, crewBots.length),
          seatCallings(
            seatCrew(world, crewBots.length + 1),
            1,
            Array.map(crewBots, bot => bot.calling),
          ),
          (seated, slot) => creditKills(seated, slot, PARTY_KILLS[slot] ?? 0),
        ),
      ),
      { crewBots: () => crewBots },
    )
  }
  const phase = config.phase
  const beforeEnd = model
  if (phase === 'victory') {
    model = modifyFields(model, {
      phase: () => Phase.Victory(),
      stats: s => ({
        ...s,
        wavesCleared: 8,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 432 },
      }),
    })
  }
  if (phase === 'paused') {
    model = pause(model)
  }
  if (phase === 'gameover') {
    model = modifyFields(model, {
      phase: () => Phase.GameOver({ wave }),
      stats: s => ({
        ...s,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 123 },
      }),
    })
  }
  // NOTE: a staged end screen breaks the records the run would have, so
  // `best` below the wave shows its NEW BEST.
  return noteRecords(beforeEnd, model)
}
