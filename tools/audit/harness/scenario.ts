// NOTE: a scene's Model: the room (room.ts) with what the query adds
// around it, from the home menu's state to the fridge, the planks, sync,
// and the look, then co-op staged over it.

import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { withBests } from '@game/home'
import {
  DifficultyCard,
  FridgeDoor,
  Lesson,
  type Model,
  Oven,
  Tour,
  Trap,
  TrapHint,
  type Zombie,
  ZombieAction,
} from '@game/model'
import { LinkFlow, PlayerScopeStatus, SyncState } from '@game/playerSync'

import { withCoop } from './coopStage'
import { CALM, ROAMING, roomModel } from './room'
import { type SceneSettings } from './settings'

// NOTE: Mystery Leftovers. `fridge=open|offering|slammed` with `fridgeMs` left sets
// the fridge's door (`prize` names an open door's prize), `fridgeseed` sets
// the fridge's own stream, so a real pull draws a chosen prize, `lobs` puts
// three Pressure Cooker lids in the air ahead of the player (one landing a
// few frames before `tick` runs out), and `iced=freeze|pan` stands zombies
// in front of the player, frozen and chilled or reeling.
const ICED_SPOTS: ReadonlyArray<
  Readonly<{
    dx: number
    dy: number
    kind: 'Shambler' | 'Runner' | 'Exploder' | 'Tank'
    freeze: 'Frozen' | 'Chilled' | 'Roaming'
    pan: 'Reeling' | 'Roaming'
  }>
> = [
  { dx: 18, dy: -6, kind: 'Shambler', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 24, dy: 8, kind: 'Runner', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 44, dy: 0, kind: 'Tank', freeze: 'Chilled', pan: 'Roaming' },
  { dx: 30, dy: -8, kind: 'Exploder', freeze: 'Frozen', pan: 'Reeling' },
  { dx: 12, dy: 3, kind: 'Shambler', freeze: 'Roaming', pan: 'Roaming' },
]

const icedAction = (action: 'Frozen' | 'Chilled' | 'Roaming' | 'Reeling') =>
  action === 'Frozen'
    ? ZombieAction.Frozen({ remainingMs: 3000, durationMs: 3200 })
    : action === 'Chilled'
      ? ZombieAction.Chilled({ remainingMs: 3000 })
      : action === 'Reeling'
        ? ZombieAction.Reeling({ remainingMs: 600, durationMs: 700 })
        : ZombieAction.Roaming()

const LID_FLIGHT_MS = 520

const withLeftovers = (settings: SceneSettings, start: Model): Model => {
  const { config, px, py } = settings
  let model = start
  const door = config.fridge
  if (door !== undefined) {
    model = modifyFields(model, {
      fridge: fridge => ({
        ...fridge,
        door:
          door === 'open'
            ? FridgeDoor.Open({
                prize: config.prize ?? 'Cooker',
                slot: 0,
                remainingMs: config.fridgeMs,
                durationMs: 1100,
              })
            : door === 'offering'
              ? FridgeDoor.Offering({
                  prize: config.prize ?? 'Cooker',
                  slot: 0,
                  remainingMs: config.fridgeMs,
                  durationMs: 6000,
                })
              : FridgeDoor.Slammed({
                  remainingMs: config.fridgeMs,
                  durationMs: 30_000,
                }),
      }),
    })
  }
  const fridgeSeed = config.fridgeseed
  if (fridgeSeed !== undefined) {
    model = modifyFields(model, {
      loot: loot => ({ ...loot, fridgeRngState: fridgeSeed >>> 0 }),
    })
  }
  const iced = config.iced
  if (iced !== undefined) {
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...ICED_SPOTS.map((spot, index): Zombie => ({
          id: 9400 + index,
          kind: spot.kind,
          x: px + spot.dx,
          y: py + spot.dy,
          speed: spot.kind === 'Tank' ? 12 : 20,
          hp: spot.kind === 'Tank' ? 30 : 6,
          maxHp: spot.kind === 'Tank' ? 30 : 6,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: icedAction(iced === 'freeze' ? spot.freeze : spot.pan),
          frenzy: CALM,
        })),
      ],
    })
  }
  if (config.lobs) {
    const landsInMs = Math.max(20, ((config.tick ?? 0) - 5) * (1000 / 60))
    const flights = [
      { to: { x: px + 70, y: py - 28 }, remainingMs: landsInMs },
      { to: { x: px + 100, y: py - 4 }, remainingMs: landsInMs + 260 },
      { to: { x: px + 45, y: py - 44 }, remainingMs: landsInMs + 420 },
    ]
    model = modifyFields(model, {
      lobs: () =>
        flights.map((flight, index) => {
          const durationMs = Math.max(LID_FLIGHT_MS, flight.remainingMs + 120)
          const progress = 1 - flight.remainingMs / durationMs
          return {
            id: 9500 + index,
            x: px + (flight.to.x - px) * progress,
            y: py + (flight.to.y - py) * progress,
            from: { x: px, y: py },
            to: flight.to,
            remainingMs: flight.remainingMs,
            durationMs,
            charge: 0.8,
            tier: 0,
          }
        }),
    })
  }
  return model
}

export const scenarioModel = (settings: SceneSettings): Model =>
  withCoop(settings.config, scenarioModelOf(settings))

const scenarioModelOf = (settings: SceneSettings): Model => {
  const { config } = settings
  let model = roomModel(settings)
  const runs = config.runs
  if (runs !== undefined) {
    model = modifyFields(model, {
      bests: bests => ({ ...bests, runsPlayed: runs }),
    })
  }
  const learned = config.learned
  if (learned !== undefined) {
    model = modifyFields(model, {
      lessons: lessons => ({
        ...lessons,
        ...Object.fromEntries(
          learned.map(name => [name, Lesson.Learned({ atMs: 0 })]),
        ),
      }),
    })
  }
  const traphint = config.traphint
  if (traphint !== undefined) {
    model = modifyFields(model, {
      trapHint: () => TrapHint.Showing(),
      selectedTrap: () => traphint,
    })
  }
  const quest = config.quest
  if (quest !== undefined) {
    model =
      quest === 'kitchendone'
        ? modifyFields(model, { kitchenTour: () => Tour.Done({ ageMs: 0 }) })
        : modifyFields(model, {
            firstBreakQuest: () =>
              quest === 'done' ? Tour.Done({ ageMs: 0 }) : Tour.Running(),
          })
  }
  const newer = config.newer
  if (newer !== undefined) {
    model = modifyFields(model, {
      maybeNewerBuild: () => Option.some(newer || 'next'),
    })
  }
  if (config.unwrap) {
    model = modifyFields(model, { updateGift: () => 'Unwrapping' })
  }
  if (config.install) {
    model = modifyFields(model, { installOffer: () => 'Ready' })
  }
  if (config.support) {
    model = modifyFields(model, {
      maybeSupportUrl: () => Option.some('https://buy.stripe.com/test_harness'),
    })
  }
  if (config.bests) {
    model = modifyFields(
      withBests(model, current => ({
        ...current,
        maybeBestEndlessWave: Option.some(12),
        maybeFastestWinMs: Option.some(402_000),
      })),
      { bests: bests => ({ ...bests, totalKills: 341 }) },
    )
  }
  const kills = config.kills
  if (kills !== undefined) {
    const counts = Object.fromEntries(kills)
    model = modifyFields(model, {
      bests: bests => {
        const killsByKind = { ...bests.killsByKind, ...counts }
        return {
          ...bests,
          killsByKind,
          totalKills: Object.values(killsByKind).reduce(
            (sum, count) => sum + count,
            0,
          ),
        }
      },
    })
  }
  model = modifyFields(model, {
    home: home => ({
      ...home,
      mode: config.homemode === 'endless' ? 'Endless' : home.mode,
      maybeSeenNewsDay: config.newsseen
        ? Option.some('October 29, 2026')
        : home.maybeSeenNewsDay,
      openedEntries: config.opened ?? home.openedEntries,
      newEntries: config.newentries ?? home.newEntries,
    }),
  })
  model = modifyFields(model, {
    difficultyCard: () =>
      config.ask ? DifficultyCard.Unseen() : DifficultyCard.Seen(),
    difficulty: setting => ({
      chosen: config.difficulty ?? setting.chosen,
      nightmare: config.nightmare ?? setting.nightmare,
    }),
  })
  const ovenState = config.ovens
  if (ovenState !== undefined) {
    model = modifyFields(model, {
      ovens: ovens =>
        ovens.map(() =>
          ovenState === 'belch'
            ? Oven.Belching({ remainingMs: config.ovenMs, burnedTicks: 4 })
            : Oven.Cooling({ remainingMs: config.ovenMs }),
        ),
    })
  }
  if (config.slip) {
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...[
          { x: 152, y: -62 },
          { x: 47, y: -92 },
          { x: 65, y: -32 },
        ].map((at, index) => ({
          id: 9300 + index,
          kind: 'Shambler' as const,
          x: at.x,
          y: at.y,
          speed: 20,
          hp: 3,
          maxHp: 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: { _tag: 'Dazed' as const, remainingMs: 800, durationMs: 900 },
          frenzy: CALM,
        })),
      ],
    })
  }
  model = withLeftovers(settings, model)
  const planks = config.planks
  if (planks !== undefined) {
    model = modifyFields(model, {
      traps: traps => [
        ...traps,
        ...planks.map((door, index) =>
          Trap.Barricade({
            id: 9000 + index,
            door,
            hp: config.plankhp,
            hitRemainingMs: 0,
          }),
        ),
      ],
    })
  }
  const chewers = config.chewers
  if (chewers > 0) {
    const spots = [
      { x: 16, y: 84 },
      { x: 16, y: 96 },
      { x: 30, y: 88 },
      { x: 34, y: 100 },
      { x: 44, y: 80 },
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.slice(0, chewers).map((at, index) => ({
          id: 9100 + index,
          kind: index === 4 ? ('Tank' as const) : ('Shambler' as const),
          x: at.x,
          y: at.y,
          speed: 18,
          hp: index === 4 ? 30 : 3,
          maxHp: index === 4 ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  // NOTE: zombies mid-entry at every door, hurt so their bars show: two in
  // the north doorway behind the lintel, one just inside the north wall, and
  // one in each other doorway, and one in the kitchen's doorway when it is
  // open.
  if (config.doorway) {
    const spots: ReadonlyArray<
      readonly ['Shambler' | 'Runner' | 'Tank', number, number]
    > = [
      ['Tank', 216, 6],
      ['Runner', 226, -2],
      ['Shambler', 200, 22],
      ['Tank', 240, 26],
      ['Shambler', 90, 172],
      ['Shambler', 5, 88],
      ['Runner', 315, 92],
      ...(config.openexits?.includes('Kitchen') === true
        ? ([['Shambler', 70, 8]] as const)
        : []),
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.map(([kind, x, y], index) => ({
          id: 9200 + index,
          kind,
          x,
          y,
          speed: 0,
          hp: kind === 'Tank' ? 10 : 1,
          maxHp: kind === 'Tank' ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  const openexits = config.openexits
  if (openexits !== undefined) {
    model = modifyFields(model, {
      level: level => ({ ...level, openExits: openexits }),
    })
  }
  const name = config.name
  if (name !== undefined) {
    model = modifyFields(model, { playerName: () => name })
  }
  const sync = config.sync
  if (sync !== undefined) {
    const devices = config.devices
    model = modifyFields(model, {
      syncState: () =>
        sync === 'local'
          ? SyncState.LocalOnly()
          : sync === 'connecting'
            ? SyncState.Connecting()
            : sync === 'offline'
              ? SyncState.Offline({ devices })
              : SyncState.Synced({ devices }),
      playerScopeStatus: () =>
        sync === 'broken'
          ? PlayerScopeStatus.Failed({ reason: 'harness' })
          : PlayerScopeStatus.Ready({ seq: 1, fresh: sync === 'synced' }),
    })
  }
  const link = config.link
  if (link !== undefined) {
    model = modifyFields(model, {
      linkFlow: () =>
        link === 'requesting'
          ? LinkFlow.Requesting()
          : link === 'showing'
            ? LinkFlow.Showing({ code: 'KZ7QWM' })
            : link === 'entering'
              ? LinkFlow.Entering({ code: 'KZ7' })
              : link === 'redeeming'
                ? LinkFlow.Redeeming({ code: 'KZ7QWM' })
                : link === 'linked'
                  ? LinkFlow.Linked()
                  : LinkFlow.Failed({ problem: 'WrongCode' }),
    })
  }
  const look = config.look
  if (look !== undefined) {
    const [
      body,
      hairStyle,
      hairColor,
      skinTone,
      shirtColor,
      outfit,
      print,
      beard,
      glasses,
    ] = look
    model = modifyFields(model, {
      appearance: a => ({
        body: body || a.body,
        hairStyle: hairStyle || a.hairStyle,
        hairColor: hairColor || a.hairColor,
        skinTone: skinTone || a.skinTone,
        shirtColor: shirtColor || a.shirtColor,
        outfit: outfit || a.outfit,
        print: print || a.print,
        beard: beard === 'Beard' || a.beard,
        glasses: glasses === 'Glasses' || a.glasses,
      }),
    })
  }
  return model
}
