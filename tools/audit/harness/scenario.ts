// NOTE: a scene's Model: the room (room.ts) with what the query adds
// around it, from the home menu's state to the fridge, the planks, sync,
// and the look, then co-op staged over it.

import { Array, Option, Record, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  CaseState,
  DifficultyCard,
  FridgeDoor,
  Lesson,
  type Model,
  Oven,
  Phase,
  PocketCard,
  QuestTour,
  Tour,
  Trap,
  TrapHint,
  type Zombie,
  ZombieAction,
} from '@game/app/model'
import { addBot } from '@game/domain/bots'
import { isEndScreen, withBests } from '@game/domain/run'
import { unlocksAt } from '@game/domain/unlocks'
import { prizeUnlockId } from '@game/features/guide/shopGuide'
import {
  LinkFlow,
  PlayerScopeStatus,
  SyncState,
} from '@game/platform/playerSync'
import { heroIdOf } from '@game/shared/playerData'
import { dareCardOf, maybeLyingAt } from '@game/world/dare/dare'
import { DareThingState, Finale } from '@game/world/dare/dareSchema'
import { FIND_RULES, findStyleOfRoom } from '@game/world/dare/finds'
import { TRAPS } from '@game/world/gear/traps'
import { playerOfCalling } from '@game/world/heroes/callingPlayer'
import { rankOf, totalPointsOf } from '@game/world/heroes/rank'
import { levelOf } from '@game/world/level/arena'
import {
  ARRANGEMENTS,
  CHANDELIER_DROP,
  STACK_DROPS,
  roomSpotsOf,
} from '@game/world/level/plan'
import { tileCenter } from '@game/world/level/tileGrid'
import { wakeRoom } from '@game/world/level/wakeUp'
import { modifyFocus } from '@game/world/party/party'
import { bonusPercentOf, modifiersOfMask } from '@game/world/run/modifiers'
import { withWorld } from '@game/world/schema/world'
import { TOOL_RULES } from '@game/world/stations/toolRules'

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
  if (config.caseopen) {
    model = modifyFields(model, {
      cases: cases =>
        Array.map(cases, displayCase => ({
          ...displayCase,
          state: CaseState.Opened({ by: 0 }),
        })),
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
        ...Array.map(ICED_SPOTS, (spot, index): Zombie => ({
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
        Array.map(flights, (flight, index) => {
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

const QUEST_STAGES: {
  readonly [Stage in 'running' | 'card' | 'start' | 'done']: QuestTour
} = {
  running: QuestTour.Running({ isLockSeen: false }),
  card: QuestTour.Looking({ ageMs: 0 }),
  start: QuestTour.Starting(),
  done: QuestTour.Done({ ageMs: 0 }),
}

// NOTE: the first `count` things of the dare card found, as a player who
// walked onto them.
const withDareFound = (model: Model, count: number): Model => {
  const kinds = Array.map(
    Array.take(dareCardOf(model), count),
    ({ kind }) => kind,
  )
  return modifyFields(model, {
    dareThings: things =>
      Array.map(things, thing =>
        Array.contains(kinds, thing.kind)
          ? { ...thing, state: DareThingState.Found({ slot: 0 }) }
          : thing,
      ),
  })
}

// NOTE: the player `gap` px south of the first thing still lying in an
// open room, so a shot shows it in sight.
const nearDareThing = (model: Model, gap: number): Model =>
  Option.match(
    Array.findFirst(model.dareThings, thing =>
      maybeLyingAt(thing, levelOf(model)),
    ),
    {
      onNone: () => model,
      onSome: spot =>
        modifyFocus(model, {
          player: player => ({ ...player, x: spot.x, y: spot.y + gap }),
        }),
    },
  )

// NOTE: the dare list's first thing hidden on `room`'s first hiding spot,
// `share` of its find's work done, the player `gap` px south of it.
const atRoomFind = (
  model: Model,
  room: string,
  share: number,
  gap: number,
): Model => {
  const level = levelOf(model)
  return Option.match(
    Option.flatMap(
      Array.findFirst(roomSpotsOf(level.spec), spots => spots.room === room),
      ({ hiding }) => Array.head(hiding),
    ),
    {
      onNone: () => model,
      onSome: ({ tile }) => {
        const spot = tileCenter(tile)
        const workedMs = share * FIND_RULES[findStyleOfRoom(room)].workMs
        return modifyFocus(
          modifyFields(model, {
            dareThings: things =>
              Array.map(things, (thing, index) =>
                index === 0
                  ? {
                      ...thing,
                      state: DareThingState.Hidden({ ...spot, workedMs }),
                    }
                  : thing,
              ),
          }),
          { player: player => ({ ...player, x: spot.x, y: spot.y + gap }) },
        )
      },
    },
  )
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
        ...Record.fromEntries(
          Array.map(learned, name => [name, Lesson.Learned({ atMs: 0 })]),
        ),
      }),
    })
  }
  const traphint = config.traphint
  if (traphint !== undefined) {
    model = modifyFocus(
      modifyFields(model, { trapHint: () => TrapHint.Showing() }),
      { selectedTrap: () => traphint },
    )
  }
  const quest = config.quest
  if (quest !== undefined) {
    model =
      quest === 'kitchendone'
        ? modifyFields(model, { kitchenTour: () => Tour.Done({ ageMs: 0 }) })
        : modifyFields(model, {
            firstBreakQuest: () => QUEST_STAGES[quest],
          })
  }
  if (config.darefound > 0) {
    model = withDareFound(model, config.darefound)
  }
  const { pocket, pocketfold, dareopen } = config
  if (dareopen !== undefined) {
    const found = Array.filterMap(dareCardOf(model), ({ kind, isFound }) =>
      isFound ? Result.succeed(kind) : Result.fail(undefined),
    )
    const shown = Array.take(found, config.satchel)
    model = modifyFields(model, {
      pocketCard: () =>
        PocketCard.Opened({
          ageMs: dareopen,
          fresh: Array.drop(found, config.satchel),
        }),
      dareSatchel: () => shown,
    })
  }
  if (pocket !== undefined) {
    model = modifyFields(model, {
      pocketCard: () => PocketCard.Reading({ ageMs: pocket }),
    })
  }
  if (pocketfold !== undefined) {
    model = modifyFields(model, {
      pocketCard: () => PocketCard.Folding({ ageMs: pocketfold }),
    })
  }
  const finale = config.finale
  if (finale !== undefined) {
    model = modifyFields(withDareFound(model, dareCardOf(model).length), {
      dare: dare =>
        modifyFields(dare, {
          finale: () => (finale === 'open' ? Finale.Open() : Finale.Summoned()),
        }),
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
  const { calling } = config
  if (calling !== undefined) {
    model = modifyFocus(
      modifyFields(model, {
        calling: () => calling,
        // NOTE: the hero is bought, as a run starts only with one the player owns.
        boughtCosmetics: bought =>
          calling === 'You' ? bought : Array.union(bought, [heroIdOf(calling)]),
      }),
      {
        player: player => ({
          ...playerOfCalling(calling),
          x: player.x,
          y: player.y,
          facing: player.facing,
        }),
      },
    )
  }
  const { rank: rankPoints, rankgain: rankGain } = config
  if (rankPoints !== undefined) {
    model = modifyFields(model, {
      rank: rank => ({
        ...rank,
        earnedPoints: rankPoints,
        earnedBones: Math.floor(rankPoints / 10),
        isVeteranGranted: true,
      }),
    })
  }
  const { bones, spent, bought, hat, skin } = config
  if (bones !== undefined || spent !== undefined) {
    model = modifyFields(model, {
      rank: rank => ({
        ...rank,
        earnedBones: bones ?? rank.earnedBones,
        spentBones: spent ?? rank.spentBones,
        isVeteranGranted: true,
      }),
    })
  }
  if (bought !== undefined) {
    model = modifyFields(model, {
      boughtCosmetics: current => Array.union(current, bought),
    })
  }
  if (hat !== undefined) {
    model = modifyFields(model, {
      appearance: look => modifyFields(look, { hat: () => hat }),
    })
  }
  if (skin !== undefined) {
    model = modifyFields(model, {
      appearance: look => modifyFields(look, { gunSkin: () => skin }),
    })
  }
  if (!config.fresh) {
    model = modifyFields(model, {
      seenUnlocks: () => unlocksAt(rankOf(totalPointsOf(model.rank))),
    })
  }
  const prizes = config.prizes
  if (prizes !== undefined) {
    model = modifyFields(model, {
      seenUnlocks: seen => Array.union(seen, Array.map(prizes, prizeUnlockId)),
    })
  }
  if (rankGain !== undefined && isEndScreen(model.phase)) {
    model = modifyFields(model, {
      maybeRankGain: () =>
        Option.some({
          pointsBefore: Math.max(0, (rankPoints ?? 0) - rankGain),
          gained: rankGain,
          bonesGained: Math.floor(rankGain / 10),
          bonusPercent: bonusPercentOf(modifiersOfMask(config.mods ?? 0)),
        }),
    })
  }
  const { mods } = config
  if (mods !== undefined) {
    model = modifyFields(model, { modifiers: () => modifiersOfMask(mods) })
  }
  const kills = config.kills
  if (kills !== undefined) {
    const counts = Record.fromEntries(kills)
    model = modifyFields(model, {
      bests: bests => {
        const killsByKind = { ...bests.killsByKind, ...counts }
        return {
          ...bests,
          killsByKind,
          totalKills: Array.reduce(
            Record.values(killsByKind),
            0,
            (sum, count) => sum + count,
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
  model = Array.reduce(Array.range(1, config.lobbybots ?? 0), model, seated =>
    config.lobbybots === undefined ? seated : addBot(seated),
  )
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
        Array.map(ovens, () =>
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
        ...Array.map(
          [
            { x: 152, y: -62 },
            { x: 47, y: -92 },
            { x: 65, y: -32 },
          ],
          (at, index) => ({
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
            action: {
              _tag: 'Dazed' as const,
              remainingMs: 800,
              durationMs: 900,
            },
            frenzy: CALM,
          }),
        ),
      ],
    })
  }
  model = withLeftovers(settings, model)
  const planks = config.planks
  if (planks !== undefined) {
    model = modifyFields(model, {
      traps: traps => [
        ...traps,
        ...Array.map(planks, (door, index) =>
          Trap.Barricade({
            id: 9000 + index,
            door,
            hp: config.plankhp,
            maxHp: TRAPS.Barricade.hp,
            hitRemainingMs: 0,
          }),
        ),
      ],
    })
  }
  const chewers = config.chewers
  if (chewers > 0) {
    // NOTE: just inside the dining room's West door, rows 2 and 3.
    const spots = [
      { x: 16, y: 24 },
      { x: 16, y: 36 },
      { x: 30, y: 28 },
      { x: 34, y: 40 },
      { x: 44, y: 20 },
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...Array.map(spots.slice(0, chewers), (at, index) => ({
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
        ...Array.map(spots, ([kind, x, y], index) => ({
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
  // NOTE: the scene stands in one house, never the one its run happened to
  // roll, so a scenario draws the same rooms every time.
  const house = Option.getOrElse(Array.get(ARRANGEMENTS, config.house), () =>
    Array.headNonEmpty(ARRANGEMENTS),
  )
  model = modifyFields(model, {
    level: level => ({ ...level, arrangement: house }),
  })
  if (config.fallen) {
    model = modifyFields(model, {
      level: level => ({ ...level, dropped: [CHANDELIER_DROP] }),
      stations: stations => ({
        ...stations,
        Cleat: {
          ...stations.Cleat,
          workedMs: config.cleat * TOOL_RULES.Cleat.setUpMs,
        },
      }),
    })
  }
  const tool = config.tool
  if (tool !== undefined) {
    const rules = TOOL_RULES[tool]
    const firedms = config.firedms
    model = modifyFields(model, {
      stations: stations => ({
        ...stations,
        [tool]:
          firedms === undefined
            ? {
                ...stations[tool],
                workedMs: config.worked * rules.setUpMs,
              }
            : {
                workedMs: 0,
                cooldownMs: rules.cooldownMs - firedms,
                timesWorked: 1,
              },
      }),
      level: level =>
        firedms !== undefined &&
        (tool === 'NorthStack' || tool === 'SouthStack')
          ? { ...level, dropped: [...level.dropped, STACK_DROPS[tool].id] }
          : level,
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
      profile: profile =>
        modifyFields(profile, {
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
        }),
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
        hat: a.hat,
        gunSkin: a.gunSkin,
      }),
    })
  }
  const darenear = config.darenear
  if (darenear !== undefined) {
    model = nearDareThing(model, darenear)
  }
  const findroom = config.findroom
  if (findroom !== undefined) {
    model = atRoomFind(model, findroom, config.findwork, config.findgap)
  }
  const wake = config.wake
  if (wake !== undefined) {
    model = withWorld(
      modifyFields(model, {
        phase: phase =>
          Phase.isAnyOf(['Wave'])(phase)
            ? modifyFields(phase, { spawns: () => [] })
            : phase,
      }),
      world => wakeRoom(world, wake),
    )
  }
  return model
}
