import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Room as CoopRoom } from '../../domain/coopRoom'
import { maybeRunRoom, runDifficultyOf } from '../../domain/onlineRun'
import { raiseCloche } from '../../features/cloche/clocheReveal'
import type { Model as CoopModel } from '../../features/coop/model'
import { keepTracers } from '../../features/coop/roomState'
import {
  type CoopResult,
  asRequest,
  tickRoom,
} from '../../features/coop/update'
import {
  agePocketCard,
  raisePocketCardFrom,
} from '../../features/dare/pocketCard'
import { launchPrize } from '../../features/fridge/fridgeReveal'
import {
  ageDebutCard,
  raiseDebutCardFrom,
} from '../../features/onboarding/onboarding'
import { crewRunKeyOf } from '../../platform/analyticsRun'
import * as DetMath from '../../shared/detMath'
import { TURRET_WEAPON } from '../../world/gear/traps'
import { levelOf } from '../../world/level/arena'
import { inputOfIntent, ownWorldOf } from '../../world/net/roomWorld'
import { focusOf } from '../../world/party/party'
import { isArriving, isRunUnderway } from '../../world/run/arrival'
import { tallyFrame } from '../../world/run/stats'
import {
  type World,
  modifyWorldFields,
  withWorld,
} from '../../world/schema/world'
import {
  type Bullet,
  GameEvent,
  HitStop,
  Phase,
  type SeatState,
  type Vector,
} from '../../world/schema/worldSchema'
import { aimTracers, flyTracers } from '../../world/step/firing'
import { stopForHits, thawTick } from '../../world/step/hitStop'
import { footfallNearness } from '../../world/zombies/zombies'
import {
  advanceCosmetics,
  clampFrameDelta,
  endRoundOnClient,
  leanFor,
  refreshIntent,
  withFirePressSeen,
} from '../frame'
import type { Model } from '../model'
import { freshRun } from '../runReset'
import { playIntroSounds } from './intro'
import { rumbleFor } from './rumble'
import {
  frameSoundCues,
  fridgeLandCues,
  isOwnShot,
  kitchenCues,
  mendCues,
  playPlaced,
  playSounds,
  playStartSoundWhen,
  pocketScratchCues,
  shotSoundCue,
  strikeCues,
  thunderCues,
} from './sound'
import { type UpdateStep, toModel } from './step'

export const applyCoop =
  (result: CoopResult): UpdateStep =>
  $ =>
    $.evolve({ coop: () => result.model }).run(...(result.commands ?? []))

const inCoop =
  (rule: (coop: CoopModel) => CoopResult): UpdateStep =>
  $ =>
    applyCoop(asRequest(rule)($.model.coop))($)

const takeOwnSeat = (own: SeatState, seats: World['seats']): World['seats'] => {
  const [first, ...rest] = seats
  return [
    UiStruct.evolve(first, {
      intent: () => own.intent,
      purchase: () => own.purchase,
    }),
    ...rest,
  ]
}

const takeRoomWorld = (
  model: Model,
  world: World,
  events: ReadonlyArray<GameEvent>,
): Model =>
  UiStruct.evolve(takeRoomFields(model, world, events), {
    seats: () => takeOwnSeat(focusOf(model), world.seats),
    roomRun: UiStruct.evolve({
      maybeRoomDifficulty: () => Option.some(world.difficulty.chosen),
      maybeRoomModifiers: () => Option.some(world.modifiers),
      maybeRoomDareMark: () => Option.some(world.dareMark),
    }),
  })

const takeRoomFields = (
  model: Model,
  world: World,
  events: ReadonlyArray<GameEvent>,
): Model =>
  modifyWorldFields(model, {
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
    dare: () => world.dare,
    dareThings: () => world.dareThings,
    gasValve: () => world.gasValve,
    stations: () => world.stations,
    party: () => world.party,
  })

const isFrozen = HitStop.isAnyOf(['Frozen'])

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
            DetMath.hypot(event.x - listener.x, event.y - listener.y),
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
      cosmeticRngState: model.cosmetics.cosmeticRngState,
    }
  }
  const [cosmeticRngState, fired] = aimTracers(
    world,
    room.slot,
    model.cosmetics.cosmeticRngState,
    -1 - room.tracerCount,
  )
  return {
    tracers: [...flown.tracers, ...fired],
    fired: fired.length,
    struck: flown.struck,
    cosmeticRngState,
  }
}

const markIntroSeen = (model: Model, world: World): Model =>
  Phase.matchOrElse(
    world.phase,
    {
      Arriving: ({ cut }) =>
        cut === 'Full'
          ? UiStruct.evolve(model, { introSeen: () => 'Seen' })
          : model,
    },
    () => model,
  )

const drawRoom =
  (frameMs: number): UpdateStep =>
  $ => {
    const stepModel = $.model
    return Option.match(maybeDrawnOf(stepModel), {
      onNone: () => stepModel,
      onSome: ({ room, world }) => {
        const isStart =
          !isRunUnderway(stepModel.phase) && isRunUnderway(world.phase)
        const base = isStart
          ? markIntroSeen({ ...stepModel, ...freshRun(stepModel) }, world)
          : stepModel
        const events = heardBy(focusOf(world).player, room.frameEvents)
        const shot = traceOwnShots(base, room, world, frameMs)
        const confirmed = Array.filter(
          events,
          event =>
            GameEvent.isAnyOf(['ZombieHit'])(event) &&
            Option.exists(event.maybeShooter, shooter => shooter === room.slot),
        ).length
        return $.combine(
          toModel(
            UiStruct.evolve(base, {
              cosmetics: UiStruct.evolve({
                cosmeticRngState: () => shot.cosmeticRngState,
              }),
            }),
          ),
          inCoop(coop => ({
            model: keepTracers(
              coop,
              shot.tracers,
              shot.fired,
              shot.struck,
              confirmed,
            ),
          })),
          drawTraced({
            frameMs,
            base,
            room,
            world,
            events,
            tracers: shot.tracers,
            isStart,
          }),
        )
      },
    })
  }

type Traced = Readonly<{
  frameMs: number
  base: Model
  room: CoopRoom
  world: World
  events: ReadonlyArray<GameEvent>
  tracers: ReadonlyArray<Bullet>
  isStart: boolean
}>

const drawTraced =
  ({
    frameMs,
    base,
    room,
    world,
    events,
    tracers,
    isStart,
  }: Traced): UpdateStep =>
  $ => {
    const traced = $.model
    const thaw = thawTick(base.hitStop, frameMs)
    if (isFrozen(thaw.hitStop)) {
      return UiStruct.evolve(traced, {
        hitStop: () => thaw.hitStop,
        frameEvents: () => [],
      })
    }
    const applied = withWorld(
      takeRoomWorld(
        UiStruct.evolve(traced, {
          hitStop: () => thaw.hitStop,
          roomRun: UiStruct.evolve({
            maybeCrewRunKey: key =>
              Option.orElse(
                Option.map(room.maybeLobby, crewRunKeyOf),
                () => key,
              ),
            maybeRunNet: () => Option.some(room.session.stats.net),
          }),
        }),
        UiStruct.evolve(world, {
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
    const cosmetic = advanceCosmetics(
      isArriving(world.phase) ? applied : tallyFrame(base, applied, frameMs),
      frameMs,
      frameMs,
    )
    const drawn = raiseCloche(
      base,
      launchPrize(
        base,
        ageDebutCard(
          endRoundOnClient(
            base,
            raiseDebutCardFrom(
              base,
              leanFor(
                agePocketCard(raisePocketCardFrom(base, cosmetic), frameMs),
                frameMs,
              ),
            ),
            runDifficultyOf(base),
          ),
          frameMs,
        ),
      ),
    )
    return $.combine(
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
        ...strikeCues(base, drawn),
        ...kitchenCues(base, drawn),
        ...thunderCues(base, drawn),
        ...pocketScratchCues(base, drawn),
      ]),
      playPlaced(base, drawn),
      rumbleFor(events),
      playIntroSounds(base),
      playStartSoundWhen(isStart),
    )
  }

export const playRoomFrame =
  (nowMs: number): UpdateStep =>
  $ => {
    const stepModel = $.model
    const maybeBefore = maybeRunRoom(stepModel)
    const frameMs = clampFrameDelta(
      Option.match(maybeBefore, {
        onNone: () => 0,
        onSome: room => nowMs - room.session.renderedMs,
      }),
    )
    const intended = refreshIntent(stepModel)
    return $.combine(
      toModel(withFirePressSeen(intended)),
      inCoop(
        tickRoom({
          controls: inputOfIntent(focusOf(intended).intent, 0),
          nowMs,
          isPictureHeld: isFrozen(thawTick(stepModel.hitStop, frameMs).hitStop),
        }),
      ),
      drawRoom(frameMs),
    )
  }
