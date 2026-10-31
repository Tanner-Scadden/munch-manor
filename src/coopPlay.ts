import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import { CoopBinding } from './composition'
import type { Room as CoopRoom } from './coop/model'
import { isInLobby, keepTracers, maybeRoomOf } from './coop/update'
import { makeStep } from './definition'
import { aimTracers, flyTracers } from './firing'
import {
  advanceCosmetics,
  clampFrameDelta,
  leanFor,
  refreshIntent,
} from './frame'
import { launchPrize } from './fridgeReveal'
import { stopForHits, thawTick } from './juice'
import { type Model, Phase } from './model'
import { ageDebutCard, raiseDebutCardFrom } from './onboarding'
import { isCoop, shopOf } from './party'
import { inputOfIntent, ownWorldOf } from './roomWorld'
import { freshRun } from './runReset'
import { isBrowsing } from './shop'
import { tallyFrame } from './stats'
import { TURRET_WEAPON } from './traps'
import { syncShopDialog } from './update/shop'
import {
  frameSoundCues,
  fridgeLandCues,
  isOwnShot,
  playSounds,
  playStartSoundWhen,
  shotSoundCue,
} from './update/sound'
import { toModel, unchanged } from './update/step'
import { endRoundOnClient, isRoundActive } from './waves'
import { type World, withWorld } from './world'
import {
  type Bullet,
  type Difficulty,
  GameEvent,
  HitStop,
  ShopState,
  type Vector,
} from './worldSchema'
import { footfallNearness } from './zombies'

// The root's half of an online co-op run (MULTIPLAYER.md, Phase 2): the
// game's own scene, HUD, shop, and touch controls drawn from the room's
// World. Each frame the client derives its intent from its own input and
// camera, the co-op Submodel sends it with any press and hands back the
// World to draw (everyone else 100 ms behind, its own player predicted)
// and the events the drawing reached. The root puts its own seat in the
// World's player fields (focusSeat), so every view draws it as the player,
// then makes particles, shake, popups, and sounds from the events with its
// own cosmetic stream, and freezes its own picture for hit-stop. The room
// alone decides hits, money, and deaths.

// NOTE: a room whose run is on, its lobby Playing.
export const maybeRunRoom = (model: Model): Option.Option<CoopRoom> =>
  Option.filter(maybeRoomOf(model.coop), room => !isInLobby(room))

// NOTE: a run is drawn from the room once its first World has come.
export const isOnlineRun = (model: Model): boolean =>
  Option.exists(maybeRunRoom(model), room => Option.isSome(room.maybeWorld))

// NOTE: the World a room run left in the root, after its room is gone.
export const isLeftFromRoom = (model: Model): boolean =>
  isCoop(model) &&
  model.localPlayers <= 1 &&
  !Phase.isAnyOf(['Ready'])(model.phase) &&
  Option.isNone(maybeRoomOf(model.coop))

// NOTE: the difficulty a run plays on: the room's, which its host picked,
// while the player is in a room that has sent a World, else their own.
export const runDifficultyOf = (model: Model): Difficulty =>
  Option.getOrElse(
    Option.flatMap(maybeRoomOf(model.coop), room =>
      Option.map(
        room.maybeWorld,
        roomWorld => roomWorld.world.difficulty.chosen,
      ),
    ),
    () => model.difficulty.chosen,
  )

// THE ROOM'S WORLD IN THE ROOT

// NOTE: while the room has this player at the counter the client keeps its
// own Browsing (the row it focused) or its own Dismissed (LEAVE sent, the
// room a round trip behind), so a dialog it closed stays closed.
const heldShop = (own: ShopState, room: ShopState): ShopState =>
  isBrowsing(room) && !ShopState.isAnyOf(['Away'])(own) ? own : room

// NOTE: the fields the room owns, from the World with this client's own
// seat in the player fields. The rest stay the client's: its intent, the
// run's stats and the gates, the save's difficulty, the money count-up,
// the shop's open tab, and, while the room still has the player at the
// counter, their focused row or their own LEAVE on its way (heldShop).
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
    player: () => world.player,
    zombies: () => world.zombies,
    bullets: () => world.bullets,
    lobs: () => world.lobs,
    wallet: wallet => modifyFields(world.wallet, { shown: () => wallet.shown }),
    elapsedMs: () => world.elapsedMs,
    frameEvents: () => events,
    traps: () => world.traps,
    pickups: () => world.pickups,
    boosts: () => world.boosts,
    trapStock: () => world.trapStock,
    selectedTrap: () => world.selectedTrap,
    level: () => world.level,
    ovens: () => world.ovens,
    fridge: () => world.fridge,
    laserSight: () => world.laserSight,
    shop: shop => heldShop(shop, world.shop),
    party: () => world.party,
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

const ownShopOf = (model: Model): Option.Option<ShopState> =>
  Option.flatMap(maybeDrawnOf(model), ({ room, world }) =>
    shopOf(world, room.slot),
  )

// OWN TRACERS

// NOTE: your own gun's bullets are drawn from your own shots, the instant
// they fire (src/simulation.ts, aimTracers), so the room's copy of them,
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

// NOTE: the drawing of one frame. A run starting (or the next one after the
// end screen) resets the client's run fields first. While the client's own
// hit-stop holds, the picture stays, and the events wait in the session.
const drawRoom = (frameMs: number, maybeShopBefore: Option.Option<ShopState>) =>
  makeStep(stepModel =>
    Option.match(maybeDrawnOf(stepModel), {
      onNone: () => unchanged,
      onSome: ({ room, world }) => {
        const isStart =
          !isRoundActive(stepModel.phase) && isRoundActive(world.phase)
        const base = isStart
          ? { ...stepModel, ...freshRun(stepModel) }
          : stepModel
        const thaw = thawTick(base.hitStop, frameMs)
        const events = heardBy(world.player, room.frameEvents)
        const shot = traceOwnShots(base, room, world, frameMs)
        const traced = modifyFields(base, {
          cosmeticRngState: () => shot.cosmeticRngState,
          coop: coop =>
            keepTracers(
              coop,
              shot.tracers,
              shot.fired,
              shot.struck,
              Array.filter(
                events,
                event =>
                  GameEvent.isAnyOf(['ZombieHit'])(event) &&
                  Option.exists(
                    event.maybeShooter,
                    shooter => shooter === room.slot,
                  ),
              ).length,
            ),
        })
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
            modifyFields(traced, { hitStop: () => thaw.hitStop }),
            modifyFields(world, {
              bullets: bullets => [
                ...Array.filter(
                  bullets,
                  bullet => !isOwnGunBullet(bullet, room.slot),
                ),
                ...shot.tracers,
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
            ...(room.predictedShots > 0 ? [shotSoundCue(world.player)] : []),
            ...frameSoundCues(
              Array.filter(events, event => !isOwnShot(event, room.slot)),
            ),
            ...fridgeLandCues(base, drawn),
          ]),
          playStartSoundWhen(isStart),
          syncShopDialog(Option.exists(maybeShopBefore, isBrowsing)),
        ])
      },
    }),
  )

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
        controls: inputOfIntent(intended.intent, 0),
        nowMs,
        isPictureHeld: isFrozen(thawTick(stepModel.hitStop, frameMs).hitStop),
      }),
      drawRoom(frameMs, ownShopOf(stepModel)),
    ])
  })
