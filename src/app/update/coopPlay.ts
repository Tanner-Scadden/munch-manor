import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Room as CoopRoom } from '../../domain/coopRoom'
import { maybeRunRoom, runDifficultyOf } from '../../domain/onlineRun'
import { launchPrize } from '../../features/fridge/fridgeReveal'
import {
  ageDebutCard,
  raiseDebutCardFrom,
} from '../../features/onboarding/onboarding'
import { crewRunKeyOf } from '../../platform/analyticsRun'
import { TURRET_WEAPON } from '../../world/gear/traps'
import { levelOf } from '../../world/level/arena'
import { inputOfIntent, ownWorldOf } from '../../world/net/roomWorld'
import { focusOf } from '../../world/party/party'
import { tallyFrame } from '../../world/run/stats'
import { type World, withWorld } from '../../world/schema/world'
import {
  type Bullet,
  GameEvent,
  HitStop,
  Phase,
  RunMode,
  type SeatState,
  type Vector,
} from '../../world/schema/worldSchema'
import { aimTracers, flyTracers } from '../../world/step/firing'
import { stopForHits, thawTick } from '../../world/step/hitStop'
import { isRoundActive } from '../../world/waves/waves'
import { footfallNearness } from '../../world/zombies/zombies'
import { CoopBinding } from '../bindings'
import { makeStep } from '../definition'
import {
  advanceCosmetics,
  clampFrameDelta,
  endRoundOnClient,
  leanFor,
  refreshIntent,
} from '../frame'
import type { Model } from '../model'
import { freshRun } from '../runReset'
import {
  frameSoundCues,
  fridgeLandCues,
  isOwnShot,
  kitchenCues,
  mendCues,
  playSounds,
  playStartSoundWhen,
  shotSoundCue,
} from './sound'
import { toModel, unchanged } from './step'

// The root's half of an online co-op run (MULTIPLAYER.md, Phase 2): the
// game's own scene, HUD, and touch controls drawn from the room's
// World. Each frame the client derives its intent from its own input and
// camera, the co-op Submodel sends it with any press and hands back the
// World to draw (everyone else 100 ms behind, its own player predicted)
// and the events the drawing reached. The root puts its own seat in the
// World's player fields (focusSeat), so every view draws it as the player,
// then makes particles, shake, popups, and sounds from the events with its
// own cosmetic stream, and freezes its own picture for hit-stop. The room
// alone decides hits, keys, and deaths.

// THE ROOM'S WORLD IN THE ROOT

// NOTE: the room's seats, with this client's own (the first) keeping what
// the client owns: its intent and its purchase hold.
const takeOwnSeat = (own: SeatState, seats: World['seats']): World['seats'] => {
  const [first, ...rest] = seats
  return [
    modifyFields(first, {
      intent: () => own.intent,
      purchase: () => own.purchase,
    }),
    ...rest,
  ]
}

// NOTE: the fields the room owns, from the World with this client's own
// seat in the player fields, and the room's difficulty beside the save's,
// for the run's summary. The rest stay the client's: its intent and hold,
// the run's stats and the gates, and the save's difficulty.
const takeRoomWorld = (
  model: Model,
  world: World,
  events: ReadonlyArray<GameEvent>,
): Model =>
  modifyFields(model, {
    phase: () => world.phase,
    pacing: () => world.pacing,
    boss: () => world.boss,
    frenzyPacks: () => world.frenzyPacks,
    intensity: () => world.intensity,
    mode: () => world.mode,
    zombies: () => world.zombies,
    bullets: () => world.bullets,
    lobs: () => world.lobs,
    elapsedMs: () => world.elapsedMs,
    frameEvents: () => events,
    // NOTE: the room's traps, taken as the room decided them.
    // oxlint-disable-next-line munch/seat-action-once
    traps: () => world.traps,
    pickups: () => world.pickups,
    level: () => world.level,
    ovens: () => world.ovens,
    fridge: () => world.fridge,
    pantry: () => world.pantry,
    crates: () => world.crates,
    keys: () => world.keys,
    cases: () => world.cases,
    stove: () => world.stove,
    gasValve: () => world.gasValve,
    party: () => world.party,
    seats: () => takeOwnSeat(focusOf(model), world.seats),
    maybeRoomDifficulty: () => Option.some(world.difficulty.chosen),
    maybeRoomModifiers: () => Option.some(world.modifiers),
  })

const isFrozen = HitStop.isAnyOf(['Frozen'])

// NOTE: the room scores a footstep against its lead seat; this client hears
// it, and shakes for it, by how near it is to its own player.
const heardBy = (
  listener: Vector,
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<GameEvent> =>
  Array.map(events, event =>
    GameEvent.isAnyOf(['Footfall'])(event)
      ? GameEvent.Footfall({
          ...event,
          nearness: footfallNearness(
            event.kind,
            Math.hypot(event.x - listener.x, event.y - listener.y),
          ),
        })
      : event,
  )

type Drawn = Readonly<{ room: CoopRoom; world: World }>

const maybeDrawnOf = (model: Model): Option.Option<Drawn> =>
  Option.flatMap(maybeRunRoom(model), room =>
    Option.map(room.maybeWorld, roomWorld => ({
      room,
      world: ownWorldOf(roomWorld, room.slot),
    })),
  )

// OWN TRACERS

// NOTE: your own gun's bullets are drawn from your own shots, the instant
// they fire (src/world/step/simulation.ts, aimTracers), so the room's copy of them,
// a round trip later, is not drawn too. A gnome's peas, and everyone
// else's bullets, come from the room.
const isOwnGunBullet = (bullet: Bullet, ownSlot: number): boolean =>
  bullet.shooter === ownSlot && bullet.weapon !== TURRET_WEAPON

type TracedShots = Readonly<{
  tracers: ReadonlyArray<Bullet>
  fired: number
  struck: number
  cosmeticRngState: number
}>

const traceOwnShots = (
  model: Model,
  room: CoopRoom,
  world: World,
  frameMs: number,
): TracedShots => {
  const flown = flyTracers(levelOf(world), world.zombies, room.tracers, frameMs)
  if (room.predictedShots <= 0) {
    return {
      tracers: flown.tracers,
      fired: 0,
      struck: flown.struck,
      cosmeticRngState: model.cosmeticRngState,
    }
  }
  const [cosmeticRngState, fired] = aimTracers(
    world,
    room.slot,
    model.cosmeticRngState,
    -1 - room.tracerCount,
  )
  return {
    tracers: [...flown.tracers, ...fired],
    fired: fired.length,
    struck: flown.struck,
    cosmeticRngState,
  }
}

// NOTE: KEEP GOING after a win starts the next round in the same World: the
// seats keep their revives and the crew its awards, though the client's own
// stats start over. So the revives and awards already paid at Victory stay
// paid; a new run (RUN IT BACK builds a new World) starts from zero.
const keepRankPaid = (before: Model, world: World, fresh: Model): Model =>
  Phase.isAnyOf(['Victory'])(before.phase) &&
  RunMode.isAnyOf(['Endless'])(world.mode)
    ? modifyFields(fresh, {
        rankPaid: paid =>
          modifyFields(paid, {
            awardsPaid: () => before.rankPaid.awardsPaid,
            revivesPaid: () => before.rankPaid.revivesPaid,
          }),
      })
    : fresh

// NOTE: the drawing of one frame. A run starting (or the next one after the
// end screen) resets the client's run fields first. This frame's own
// tracers go to the co-op Block through `requestKeepTracers`. While the
// client's own hit-stop holds, the picture stays, and the events wait in
// the session.
const drawRoom = (frameMs: number) =>
  makeStep(stepModel =>
    Option.match(maybeDrawnOf(stepModel), {
      onNone: () => unchanged,
      onSome: ({ room, world }) => {
        const isStart =
          !isRoundActive(stepModel.phase) && isRoundActive(world.phase)
        const base = isStart
          ? keepRankPaid(stepModel, world, {
              ...stepModel,
              ...freshRun(stepModel),
            })
          : stepModel
        const events = heardBy(focusOf(world).player, room.frameEvents)
        const shot = traceOwnShots(base, room, world, frameMs)
        return Update.combineSteps([
          toModel(
            modifyFields(base, {
              cosmeticRngState: () => shot.cosmeticRngState,
            }),
          ),
          CoopBinding.requestKeepTracers({
            tracers: shot.tracers,
            fired: shot.fired,
            looked: shot.struck,
            confirmed: Array.filter(
              events,
              event =>
                GameEvent.isAnyOf(['ZombieHit'])(event) &&
                Option.exists(
                  event.maybeShooter,
                  shooter => shooter === room.slot,
                ),
            ).length,
          }),
          drawTraced({
            frameMs,
            base,
            room,
            world,
            events,
            tracers: shot.tracers,
            isStart,
          }),
        ])
      },
    }),
  )

type Traced = Readonly<{
  frameMs: number
  base: Model
  room: CoopRoom
  world: World
  events: ReadonlyArray<GameEvent>
  tracers: ReadonlyArray<Bullet>
  isStart: boolean
}>

// NOTE: the rest of the frame, once the co-op Block keeps the tracers.
const drawTraced = ({
  frameMs,
  base,
  room,
  world,
  events,
  tracers,
  isStart,
}: Traced) =>
  makeStep(traced => {
    const thaw = thawTick(base.hitStop, frameMs)
    if (isFrozen(thaw.hitStop)) {
      return toModel(
        modifyFields(traced, {
          hitStop: () => thaw.hitStop,
          frameEvents: () => [],
        }),
      )
    }
    const applied = withWorld(
      takeRoomWorld(
        modifyFields(traced, {
          hitStop: () => thaw.hitStop,
          maybeCrewRunKey: key =>
            Option.orElse(Option.map(room.maybeLobby, crewRunKeyOf), () => key),
        }),
        modifyFields(world, {
          bullets: bullets => [
            ...Array.filter(
              bullets,
              bullet => !isOwnGunBullet(bullet, room.slot),
            ),
            ...tracers,
          ],
        }),
        events,
      ),
      taken => stopForHits(taken, frameMs),
    )
    const drawn = launchPrize(
      base,
      ageDebutCard(
        endRoundOnClient(
          base,
          raiseDebutCardFrom(
            base,
            leanFor(
              advanceCosmetics(
                tallyFrame(base, applied, frameMs),
                frameMs,
                frameMs,
              ),
              frameMs,
            ),
          ),
          runDifficultyOf(base),
        ),
        frameMs,
      ),
    )
    return Update.combineSteps([
      toModel(drawn),
      playSounds([
        ...(room.predictedShots > 0
          ? [shotSoundCue(focusOf(world).player)]
          : []),
        ...frameSoundCues(
          Array.filter(events, event => !isOwnShot(event, room.slot)),
        ),
        ...fridgeLandCues(base, drawn),
        ...mendCues(base, drawn),
        ...kitchenCues(base, drawn),
      ]),
      playStartSoundWhen(isStart),
    ])
  })

// NOTE: one frame of an online run: the controls go to the room through
// the co-op Block's `requestTickRoom`, then the root draws what came back.
export const playRoomFrame = (nowMs: number) =>
  makeStep(stepModel => {
    const maybeBefore = maybeRunRoom(stepModel)
    const frameMs = clampFrameDelta(
      Option.match(maybeBefore, {
        onNone: () => 0,
        onSome: room => nowMs - room.session.renderedMs,
      }),
    )
    const intended = refreshIntent(stepModel)
    return Update.combineSteps([
      toModel(intended),
      CoopBinding.requestTickRoom({
        controls: inputOfIntent(focusOf(intended).intent, 0),
        nowMs,
        isPictureHeld: isFrozen(thawTick(stepModel.hitStop, frameMs).hitStop),
      }),
      drawRoom(frameMs),
    ])
  })
