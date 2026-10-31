import { Array, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { cameraOf, screenCameraOf, worldToView } from '@game/camera'
import { PLAYER_MAX_HP, STICK_RADIUS_PX } from '@game/constants'
import * as CoopModel from '@game/coop/model'
import { type WorldState, coopWorld } from '@game/coop/seam'
import { update } from '@game/main'
import { Message } from '@game/message'
import {
  AudioState,
  type Model,
  MouseButton,
  Stick,
  type Vector,
} from '@game/model'
import { CueMusic, cueMusicFrom } from '@game/musicPlan'
import {
  isDowned,
  leadSeatOf,
  modifyLeadSeat,
  playersOf,
  withSeat,
} from '@game/party'
import { Difficulty } from '@game/playerData'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  MOVE_SCALE,
  actionCodeOf,
  heldAction,
  roomWorldFor,
} from '@game/roomWorld'
import { screenOf } from '@game/screen'
import { SeatAction } from '@game/stepWorld'
import { PlaySound } from '@game/update/sound'
import { Life } from '@game/worldSchema'
import { isWalking } from '@game/zombies'
import {
  type LobbyMember,
  NEUTRAL_INPUT,
  type PlayerInput,
  Room,
} from '@munch/netcode'

// THE DIRECTOR
//
// NOTE: the video tool's side of the harness (tools/video). With `director`
// in the query the page never ticks on its own: the tool asks for frames
// with `window.__director.step(n)`, and each of those n ticks is one fixed
// 1/60 s, with the shot's scripted inputs applied first. The sounds and
// music cues the game asks for are logged by tick instead of played, so the
// tool renders the soundtrack offline from the same log. A shot is a seed,
// a staged scene, and this script, so two renders are the same frames.

const Point = Schema.Tuple([Schema.Finite, Schema.Finite])

// NOTE: a stretch of ticks, from `from` up to before `to`: the keys held
// (such as KeyW or Enter), the touch move stick's direction (x and y in
// -1..1), where to aim (the nearest zombie on its feet, or an offset from
// the player), and the trigger. `turn` bends the aim by degrees, so a
// portrait shot shows the aim assist pulling it back on.
const Segment = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
  move: Schema.optionalKey(Point),
  aim: Schema.optionalKey(Schema.Union([Schema.Literal('nearest'), Point])),
  turn: Schema.optionalKey(Schema.Finite),
  fire: Schema.optionalKey(Schema.Boolean),
})
type Segment = typeof Segment.Type

// NOTE: a key pressed and let go on one tick.
const Tap = Schema.Struct({ at: Schema.Finite, key: Schema.String })

// NOTE: a co-op shot steps the room's World here, every seat played by a
// bot, on the lobby's difficulty. `preroll` ticks play before the first
// captured frame, so a later wave is under way when the shot starts.
// NOTE: `revive` downs one seat on purpose at `at`, with `bleedMs` left on
// its clock, and from `walkAt` sends a teammate to stand still beside it.
// With `spot` the seat to be downed walks there first, so the camera knows
// where to look;
// `god` keeps every other seat at full hearts.
const Revive = Schema.Struct({
  down: Schema.Finite,
  reviver: Schema.Finite,
  at: Schema.Finite,
  walkAt: Schema.Finite,
  bleedMs: Schema.Finite,
  spot: Schema.optionalKey(Point),
})

const CoopPlan = Schema.Struct({
  seed: Schema.Finite,
  preroll: Schema.Finite,
  difficulty: Schema.optionalKey(Difficulty),
  god: Schema.optionalKey(Schema.Boolean),
  revive: Schema.optionalKey(Revive),
})
type CoopPlan = typeof CoopPlan.Type

// NOTE: a pixel art card drawn over the game (cards.ts) from `from` up to
// before `to`.
const Card = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  card: Schema.Literals(['Title', 'End', 'Couch']),
})
export type Card = typeof Card.Type

// NOTE: a lobby staged with its seats (such as `coop=host`) filling in on
// cue: from `at`, the first `seats` members sit in it and the first
// `ready` of them have pressed READY.
const LobbyKey = Schema.Struct({
  at: Schema.Finite,
  seats: Schema.Finite,
  ready: Schema.Finite,
})

export const Plan = Schema.Struct({
  segments: Schema.Array(Segment),
  taps: Schema.Array(Tap),
  coop: Schema.optionalKey(CoopPlan),
  cards: Schema.Array(Card),
  lobby: Schema.optionalKey(Schema.Array(LobbyKey)),
})
export type Plan = typeof Plan.Type

export const decodePlan = Schema.decodeUnknownSync(Schema.fromJsonString(Plan))

export type AudioCue =
  | Readonly<{
      tick: number
      _tag: 'Sound'
      sound: string
      variation: number
    }>
  | Readonly<{
      tick: number
      _tag: 'Music'
      mood: string
      level: string
      stinger: string
    }>

// NOTE: one Command the game's update gives back.
export type GameCommand = NonNullable<
  ReturnType<typeof update>['commands']
>[number]
export type Return = Readonly<{
  model: Model
  commands?: ReadonlyArray<GameCommand> | undefined
}>
type Step = (model: Model, message: Message) => Return

// NOTE: the args the sound and music Commands carry, read back for the log.
const decodeSoundArgs = Schema.decodeUnknownSync(
  Schema.Struct({ sound: Schema.String, variation: Schema.Number }),
)
const decodeMusicArgs = Schema.decodeUnknownSync(
  Schema.Struct({
    mood: Schema.String,
    level: Schema.String,
    stinger: Schema.String,
  }),
)

const FIXED_TICK_MS = 1000 / 60
const TOUCH_POINTER_MOVE = 31
const TOUCH_POINTER_AIM = 32
const MOUSE_POINTER = 1

let plan: Plan = { segments: [], taps: [], cards: [] }
let tick = 0
let cues: Array<AudioCue> = []
let isShooting = false
const scriptedKeys = new Set<string>()
let maybeRoom: Option.Option<{ world: WorldState; nowMs: number }> =
  Option.none()
// NOTE: the preroll plays before the shot's first tick, so the shot's own
// script (a revive) waits for it to end.
let isPrerolled = false

export const audioLog = (): ReadonlyArray<AudioCue> => cues
export const currentTick = (): number => tick

// NOTE: the card showing on the tick the page last stepped to, with how
// many ticks it has been up.
export const cardNow = (): Option.Option<
  Readonly<{ card: Card['card']; age: number }>
> =>
  Option.map(
    Array.findFirst(
      plan.cards,
      card => isShooting && card.from <= tick && tick < card.to,
    ),
    card => ({ card: card.card, age: tick - card.from }),
  )

// NOTE: where each seat stands on the screen, and the world's window on
// it, in game pixels of the screen, for the split screen of devices.
export const seatsOnScreen = (
  model: Model,
): Readonly<{
  world: Readonly<{ x: number; y: number; width: number; height: number }>
  seats: ReadonlyArray<Readonly<{ slot: number; x: number; y: number }>>
}> => ({
  world: screenOf(model).world,
  seats: Option.match(maybeRoom, {
    onNone: () => [
      { slot: 0, ...worldToView(screenCameraOf(model), model.player) },
    ],
    onSome: ({ world }) =>
      Array.map(playersOf(world.world), ({ slot, player }) => ({
        slot,
        ...worldToView(screenCameraOf(model), player),
      })),
  }),
})

// COMMANDS

// NOTE: the sound and music Commands become log lines; the rest run.
const logAudio = (
  commands: ReadonlyArray<GameCommand>,
  atTick: number,
): ReadonlyArray<GameCommand> =>
  Array.filter(commands, command => {
    if (command.name === PlaySound.name) {
      const { sound, variation } = decodeSoundArgs(command.args)
      cues.push({ tick: atTick, _tag: 'Sound', sound, variation })
      return false
    } else if (command.name === CueMusic.name) {
      cues.push({
        tick: atTick,
        _tag: 'Music',
        ...decodeMusicArgs(command.args),
      })
      return false
    } else {
      return true
    }
  })

// NOTE: a Message between ticks, such as a click on the shop, is heard
// with the next tick.
export const logBetweenTicks = (result: Return): Return =>
  isShooting
    ? { ...result, commands: logAudio(result.commands ?? [], tick) }
    : result

// NOTE: audible, so update asks for every sound and music change; the
// Commands never reach the page's audio engine.
const audible = (model: Model): Model =>
  modifyFields(model, {
    audio: () => AudioState.Ready(),
    soundSetting: () => 'On' as const,
    musicSetting: () => 'On' as const,
    pageVisibility: () => 'Visible' as const,
  })

// NOTE: starts a shot on the scene the query staged: the log restarts with
// the music the scene's phase plays, and a co-op shot seats the room.
export const startShot = (model: Model, next: Plan): Return => {
  plan = next
  stagedMembers = Option.match(
    Option.flatMap(roomOf(model), room => room.maybeLobby),
    { onNone: () => [], onSome: lobby => lobby.members },
  )
  tick = 0
  isShooting = true
  scriptedKeys.clear()
  cues = []
  const heard = audible(model)
  const opening = logAudio(cueMusicFrom(model)(heard).commands ?? [], 0)
  const maybeCoop = Option.fromNullishOr(next.coop)
  maybeRoom = Option.map(maybeCoop, coop => ({
    world: roomWorldFor({
      ...DEFAULT_ROOM_SETTINGS,
      difficulty: coop.difficulty ?? DEFAULT_ROOM_SETTINGS.difficulty,
    }).start(roomSlots(model), coop.seed),
    nowMs: 0,
  }))
  return Option.match(maybeCoop, {
    onNone: () => ({ model: heard, commands: opening }),
    onSome: coop => {
      // NOTE: a room staged in its lobby (such as `coop=host`, four seats)
      // starts playing here.
      let current = withRoomOf(heard, room => ({
        ...room,
        maybeLobby: Option.map(room.maybeLobby, lobby => ({
          ...lobby,
          status: 'Playing' as const,
        })),
        session: {
          ...room.session,
          phase: { _tag: 'Playing' as const },
          slot: Option.some(room.slot),
          frames: [],
          renderedMs: 0,
        },
        eventsTick: 0,
      }))
      isPrerolled = false
      for (let index = 0; index < coop.preroll; index++) {
        current = coopTick(current, false).model
      }
      isPrerolled = true
      cues = Array.filter(cues, cue => cue._tag === 'Music')
      return { model: current, commands: opening }
    },
  })
}

// SINGLE PLAYER

const activeSegments = (atTick: number): ReadonlyArray<Segment> =>
  Array.filter(
    plan.segments,
    segment => segment.from <= atTick && atTick < segment.to,
  )

const byDistance = <A extends { distance: number }>(
  items: ReadonlyArray<A>,
): ReadonlyArray<A> =>
  [...items].sort((first, second) => first.distance - second.distance)

const nearestTo = (model: Model, from: Vector): Option.Option<Vector> =>
  Option.map(
    Array.head(
      byDistance(
        Array.filter(model.zombies, isWalking).map(zombie => ({
          x: zombie.x,
          y: zombie.y,
          distance: (zombie.x - from.x) ** 2 + (zombie.y - from.y) ** 2,
        })),
      ),
    ),
    ({ x, y }) => ({ x, y }),
  )

const turned = (offset: Vector, degrees: number): Vector => {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  }
}

const aimOffset = (model: Model, segment: Segment): Option.Option<Vector> => {
  const aim = segment.aim
  if (aim === undefined) {
    return Option.none()
  }
  const offset =
    aim === 'nearest'
      ? Option.map(nearestTo(model, model.player), target => ({
          x: target.x - model.player.x,
          y: target.y - model.player.y,
        }))
      : Option.some({ x: aim[0], y: aim[1] })
  return Option.map(offset, raw => turned(raw, segment.turn ?? 0))
}

const unit = (vector: Vector): Vector => {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
  return length === 0 ? vector : { x: vector.x / length, y: vector.y / length }
}

// NOTE: a thumb on a stick at the lower left (move) or right (aim) of the
// window, pushed to `reach` of its radius in a direction.
const stickAt = (
  pointerId: number,
  originX: number,
  originY: number,
  direction: Vector,
  reach: number,
): Stick =>
  Stick.Active({
    pointerId,
    originX,
    originY,
    currentX: originX + direction.x * STICK_RADIUS_PX * reach,
    currentY: originY + direction.y * STICK_RADIUS_PX * reach,
  })

// NOTE: only keys the script pressed are let go, so a key the scene holds
// (`hold`) stays down.
const withKeys = (
  model: Model,
  wanted: ReadonlyArray<string>,
  step: Step,
): Return => {
  const held = model.input.pressedKeys
  const released = Array.filter(
    held,
    key => scriptedKeys.has(key) && !wanted.includes(key),
  )
  const pressed = Array.filter(wanted, key => !held.includes(key))
  Array.forEach(released, key => scriptedKeys.delete(key))
  Array.forEach(pressed, key => scriptedKeys.add(key))
  const start: Return = { model }
  return Array.reduce(
    [
      ...Array.map(released, code => Message.ReleasedKey({ code })),
      ...Array.map(pressed, code => Message.PressedKey({ code })),
    ],
    start,
    (current, message) => {
      const next = step(current.model, message)
      return {
        model: next.model,
        commands: [...(current.commands ?? []), ...(next.commands ?? [])],
      }
    },
  )
}

const withAim = (model: Model, segments: ReadonlyArray<Segment>): Model => {
  const isTouch = model.lastDevice === 'Touch'
  const firing = Array.some(segments, segment => segment.fire === true)
  const maybeAim = Array.findFirst(segments, segment =>
    aimOffset(model, segment),
  )
  const maybeMove = Array.findFirst(segments, segment =>
    Option.fromNullishOr(segment.move),
  )
  if (isTouch) {
    return modifyFields(model, {
      input: input => ({
        ...input,
        moveStick: Option.match(maybeMove, {
          onNone: () => Stick.Idle(),
          onSome: ([x, y]) =>
            stickAt(
              TOUCH_POINTER_MOVE,
              Math.round(window.innerWidth * 0.2),
              Math.round(window.innerHeight * 0.8),
              { x, y },
              1,
            ),
        }),
        aimStick: Option.match(maybeAim, {
          onNone: () => Stick.Idle(),
          onSome: offset =>
            firing
              ? stickAt(
                  TOUCH_POINTER_AIM,
                  Math.round(window.innerWidth * 0.8),
                  Math.round(window.innerHeight * 0.8),
                  unit(offset),
                  0.9,
                )
              : Stick.Idle(),
        }),
      }),
    })
  }
  return modifyFields(model, {
    input: input => ({
      ...input,
      mouseButton: firing
        ? MouseButton.Held({ pointerId: MOUSE_POINTER })
        : MouseButton.Released(),
      maybeMouseInView: Option.match(maybeAim, {
        onNone: () => input.maybeMouseInView,
        onSome: offset =>
          Option.some(
            worldToView(cameraOf(model), {
              x: model.player.x + offset.x,
              y: model.player.y + offset.y,
            }),
          ),
      }),
    }),
  })
}

// NOTE: the staged lobby's members as the scene seated them, so a lobby
// script can seat them one by one.
let stagedMembers: ReadonlyArray<LobbyMember> = []

const withLobbyScript = (model: Model): Model =>
  Option.match(
    Array.findLast(plan.lobby ?? [], key => key.at <= tick),
    {
      onNone: () => model,
      onSome: key =>
        withRoomOf(model, room => ({
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            members: Array.map(
              stagedMembers.slice(0, key.seats),
              (member, index) => ({ ...member, ready: index < key.ready }),
            ),
          })),
        })),
    },
  )

const soloTick = (unscripted: Model, step: Step): Return => {
  const model = withLobbyScript(unscripted)
  const segments = activeSegments(tick)
  const keyed = withKeys(
    model,
    Array.flatMap(segments, segment => segment.keys ?? []),
    step,
  )
  const tapped = Array.reduce(
    Array.filter(plan.taps, tap => tap.at === tick),
    keyed,
    (current, tap) => {
      const down = step(current.model, Message.PressedKey({ code: tap.key }))
      const up = step(down.model, Message.ReleasedKey({ code: tap.key }))
      return {
        model: up.model,
        commands: [
          ...(current.commands ?? []),
          ...(down.commands ?? []),
          ...(up.commands ?? []),
        ],
      }
    },
  )
  const ticked = step(
    withAim(tapped.model, segments),
    Message.TickedFrame({ deltaTime: FIXED_TICK_MS }),
  )
  return {
    model: ticked.model,
    commands: [...(tapped.commands ?? []), ...(ticked.commands ?? [])],
  }
}

// CO-OP

const roomOf = (model: Model): Option.Option<CoopModel.Room> =>
  model.coop.screen._tag === 'InRoom'
    ? Option.some(model.coop.screen.room)
    : Option.none()

const withRoomOf = (
  model: Model,
  change: (room: CoopModel.Room) => CoopModel.Room,
): Model =>
  Option.match(roomOf(model), {
    onNone: () => model,
    onSome: room =>
      modifyFields(model, {
        coop: coop => ({
          ...coop,
          screen: CoopModel.Screen.InRoom({ room: change(room) }),
        }),
      }),
  })

const roomSlots = (model: Model): ReadonlyArray<number> =>
  Option.match(
    Option.flatMap(roomOf(model), room => room.maybeLobby),
    {
      onNone: () => [0],
      onSome: lobby => Array.map(lobby.members, member => member.slot),
    },
  )

const READY_CODE = actionCodeOf(SeatAction.Ready())
const READY_EVERY_TICKS = 60
const ORBIT_TICKS = 480
const ORBIT_RADIUS = 44
const RUG_CENTER = { x: 160, y: 100 }
const FIRE_REACH = 72
const KEEP_FRAMES = 12

// NOTE: every seat plays itself: it presses READY again each second (the
// room takes a press when the value changes), walks a slow circle round
// the rug a quarter turn from the others, and fires at the zombie nearest
// it.
// NOTE: a reviver walks to the downed seat and stands still once beside
// it; every other seat circles the rug.
const REVIVE_STOP_PX = 7

const spotFor = (
  world: WorldState,
  slot: number,
  atTick: number,
): Option.Option<Vector> => {
  const revive = Option.fromNullishOr(plan.coop?.revive)
  const maybeDowned = Option.flatMap(
    Option.filter(
      revive,
      ({ reviver, walkAt }) =>
        isPrerolled && reviver === slot && tick >= walkAt,
    ),
    ({ down }) =>
      Array.findFirst(playersOf(world.world), seat => seat.slot === down),
  )
  if (Option.isSome(maybeDowned)) {
    return Option.some(maybeDowned.value.player)
  }
  const maybeMark = Option.flatMap(
    Option.filter(revive, ({ down }) => isPrerolled && down === slot),
    ({ spot }) => Option.fromNullishOr(spot),
  )
  if (Option.isSome(maybeMark)) {
    return Option.some({ x: maybeMark.value[0], y: maybeMark.value[1] })
  }
  const angle = (atTick / ORBIT_TICKS) * 2 * Math.PI + (slot * Math.PI) / 2
  return Option.some({
    x: RUG_CENTER.x + Math.cos(angle) * ORBIT_RADIUS,
    y: RUG_CENTER.y + Math.sin(angle) * ORBIT_RADIUS * 0.7,
  })
}

const isReviving = (slot: number): boolean =>
  isPrerolled &&
  plan.coop?.revive !== undefined &&
  plan.coop.revive.reviver === slot &&
  tick >= plan.coop.revive.walkAt

const botInput = (
  world: WorldState,
  slot: number,
  atTick: number,
): PlayerInput => {
  const seated = Array.findFirst(
    playersOf(world.world),
    seat => seat.slot === slot,
  )
  return Option.match(seated, {
    onNone: () => NEUTRAL_INPUT,
    onSome: ({ player }) => {
      const spot = Option.getOrElse(spotFor(world, slot, atTick), () => player)
      const toSpot = { x: spot.x - player.x, y: spot.y - player.y }
      const distance = Math.sqrt(toSpot.x * toSpot.x + toSpot.y * toSpot.y)
      const pace =
        isReviving(slot) && distance < REVIVE_STOP_PX
          ? 0
          : Math.min(1, isReviving(slot) ? 1 : distance / 12)
      const walk = unit(toSpot)
      const nearest = Array.head(
        byDistance(
          Array.filter(world.world.zombies, isWalking).map(zombie => ({
            x: zombie.x,
            y: zombie.y,
            distance: (zombie.x - player.x) ** 2 + (zombie.y - player.y) ** 2,
          })),
        ),
      )
      // NOTE: a bot holds its fire until a zombie is close, so the room
      // fills up first.
      const target = Option.map(
        Option.filter(nearest, zombie => zombie.distance < FIRE_REACH ** 2),
        zombie => unit({ x: zombie.x - player.x, y: zombie.y - player.y }),
      )
      return {
        moveX: Math.round(walk.x * pace * MOVE_SCALE),
        moveY: Math.round(walk.y * pace * MOVE_SCALE),
        aimX: Option.match(target, {
          onNone: () => 0,
          onSome: aim => Math.round(aim.x * AIM_REACH * 8) / 8,
        }),
        aimY: Option.match(target, {
          onNone: () => 0,
          onSome: aim => Math.round(aim.y * AIM_REACH * 8) / 8,
        }),
        buttons: Option.isSome(target) ? FIRE_BUTTON : 0,
        action: heldAction(READY_CODE, Math.floor(atTick / READY_EVERY_TICKS)),
      }
    },
  })
}

const isDownedOnPurpose = (coop: CoopPlan, slot: number): boolean =>
  coop.revive?.down === slot && isPrerolled && tick >= coop.revive.at

// NOTE: the shot's own hand on the room before it steps: on `at` the
// downed seat drops to zero hearts (the room downs it that tick), a tick
// later its bleed out clock is set, and `god` keeps the rest standing.
const scripted = (
  held: WorldState,
  maybeCoop: CoopPlan | undefined,
): WorldState => {
  if (maybeCoop === undefined) {
    return held
  }
  const coop = maybeCoop
  const revive = coop.revive
  let world = held.world
  if (revive !== undefined && isPrerolled && tick === revive.at) {
    world = withSeat(world, revive.down, seatWorld =>
      modifyFields(seatWorld, {
        player: player => modifyFields(player, { hp: () => 0 }),
      }),
    )
  }
  if (revive !== undefined && isPrerolled && tick === revive.at + 1) {
    world = withSeat(world, revive.down, seatWorld =>
      isDowned(leadSeatOf(seatWorld))
        ? modifyLeadSeat(seatWorld, seat =>
            modifyFields(seat, {
              life: () => Life.Downed({ bleedMs: revive.bleedMs, reviveMs: 0 }),
            }),
          )
        : seatWorld,
    )
  }
  if (coop.god === true) {
    world = Array.reduce(playersOf(world), world, (current, { slot, seat }) =>
      isDownedOnPurpose(coop, slot) || isDowned(seat)
        ? current
        : withSeat(current, slot, seatWorld =>
            modifyFields(seatWorld, {
              player: player =>
                modifyFields(player, { hp: () => PLAYER_MAX_HP }),
            }),
          ),
    )
  }
  return world === held.world ? held : { ...held, world }
}

// NOTE: the room's World steps here, as the GameRoom would, and arrives as
// the newest of the frames the client holds, with the room's clock set so
// the client draws exactly that tick. Then the client's own frame runs, as
// an online run's does.
const coopTick = (model: Model, isCaptured: boolean): Return =>
  Option.match(Option.all([maybeRoom, roomOf(model)]), {
    onNone: () => ({ model }),
    onSome: ([held, room]) => {
      const slots = roomSlots(model)
      const world = coopWorld.step(
        scripted(held.world, plan.coop),
        Array.map(slots, slot => ({
          slot,
          input: botInput(held.world, slot, held.world.tick),
          presence: 'Here' as const,
          viewLagTicks: 0,
          rttMs: 0,
        })),
      )
      const nowMs = held.nowMs + FIXED_TICK_MS
      maybeRoom = Option.some({ world, nowMs })
      const session = room.session
      const staged = withRoomOf(model, () => ({
        ...room,
        session: {
          ...session,
          frames: Array.takeRight(
            [...session.frames, { tick: world.tick, world, atMs: nowMs }],
            KEEP_FRAMES,
          ),
          anchor: Option.some({
            tick: world.tick + session.interpolationMs / Room.TICK_MS,
            atMs: nowMs,
          }),
        },
      }))
      // NOTE: the game's own handler for the room's frame, as an online
      // run gets it (src/update/coop.ts).
      const drawn = update(staged, Message.TickedRoomFrame({ nowMs }))
      return isCaptured ? drawn : { model: drawn.model }
    },
  })

// STEPPING

export const stepShot = (model: Model, ticks: number, step: Step): Return => {
  let current: Return = { model }
  for (let index = 0; index < ticks; index++) {
    const next = Option.isSome(maybeRoom)
      ? coopTick(current.model, true)
      : soloTick(current.model, step)
    current = {
      model: next.model,
      commands: [
        ...(current.commands ?? []),
        ...logAudio(next.commands ?? [], tick),
      ],
    }
    tick++
  }
  return current
}
