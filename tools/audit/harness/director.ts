import { Array, Function, Option, Result, Schema } from 'effect'

import { Command, UiStruct } from '@effect/ui'
import { Message } from '@game/app/message'
import { AudioState, type Model, type Vector } from '@game/app/model'
import { update } from '@game/app/pureApp'
import { CueMusic } from '@game/app/update/music'
import { PlaySound } from '@game/app/update/sound'
import * as CoopModel from '@game/domain/coopRoom'
import { type WorldState, coopWorld } from '@game/domain/coopRoom'
import { MouseButton, Stick } from '@game/input/inputSchema'
import { cameraOf, screenCameraOf, worldToView } from '@game/render/camera'
import { screenOf } from '@game/render/screen'
import { PLAYER_MAX_HP, STICK_RADIUS_PX } from '@game/shared/constants'
import { Difficulty } from '@game/shared/playerData'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  MOVE_SCALE,
  actionCodeOf,
  heldAction,
  roomWorldFor,
} from '@game/world/net/roomWorld'
import {
  focusOf,
  isDowned,
  modifySeat,
  modifySeatRecord,
  playersOf,
  seatStateAt,
} from '@game/world/party/party'
import { Life } from '@game/world/schema/worldSchema'
import { SeatAction } from '@game/world/step/stepWorld'
import { isWalking } from '@game/world/zombies/zombies'
import {
  type LobbyMember,
  NEUTRAL_INPUT,
  type PlayerInput,
  Room,
} from '@munch/netcode'

const Point = Schema.Tuple([Schema.Finite, Schema.Finite])

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

const Tap = Schema.Struct({ at: Schema.Finite, key: Schema.String })

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

const Card = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  card: Schema.Literals(['Title', 'End', 'Couch']),
})
export type Card = typeof Card.Type

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

const decodePlanJson = Schema.decodeResult(Schema.fromJsonString(Plan))

export const decodePlan = (plan: string): Plan =>
  Result.getOrThrow(decodePlanJson(plan))

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

type GameCommand = ReturnType<typeof update>['commands'][number]
export type Return = Readonly<{
  model: Model
  commands?: ReadonlyArray<GameCommand> | undefined
}>
type Step = (model: Model, message: Message) => Return

const soundArgsOption = Schema.decodeUnknownOption(
  Schema.Struct({ sound: Schema.String, variation: Schema.Finite }),
)
const decodeSoundArgs = (args: unknown) =>
  Option.getOrThrow(soundArgsOption(args))
const musicArgsOption = Schema.decodeUnknownOption(
  Schema.Struct({
    mood: Schema.String,
    level: Schema.String,
    stinger: Schema.String,
  }),
)
const decodeMusicArgs = (args: unknown) =>
  Option.getOrThrow(musicArgsOption(args))

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
let isPrerolled = false

export const audioLog = (): ReadonlyArray<AudioCue> => cues
export const currentTick = (): number => tick

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

export const seatsOnScreen = (
  model: Model,
): Readonly<{
  world: Readonly<{ x: number; y: number; width: number; height: number }>
  seats: ReadonlyArray<Readonly<{ slot: number; x: number; y: number }>>
}> => ({
  world: screenOf(model).world,
  seats: Option.match(maybeRoom, {
    onNone: () => [
      { slot: 0, ...worldToView(screenCameraOf(model), focusOf(model).player) },
    ],
    onSome: ({ world }) =>
      Array.map(playersOf(world.world), ({ seat: { slot }, player }) => ({
        slot,
        ...worldToView(screenCameraOf(model), player),
      })),
  }),
})

const logAudio = (
  commands: ReadonlyArray<Readonly<{ name: string; args?: unknown }>>,
  atTick: number,
): void =>
  Array.forEach(commands, command => {
    if (command.name === Command.nameOf(PlaySound)) {
      const { sound, variation } = decodeSoundArgs(command.args)
      cues.push({ tick: atTick, _tag: 'Sound', sound, variation })
    } else if (command.name === Command.nameOf(CueMusic)) {
      cues.push({
        tick: atTick,
        _tag: 'Music',
        ...decodeMusicArgs(command.args),
      })
    }
  })

export const logSound: {
  (variation: number): (sound: string) => void
  (sound: string, variation: number): void
} = Function.dual(2, (sound: string, variation: number): void => {
  if (isShooting) {
    cues.push({ tick, _tag: 'Sound', sound, variation })
  }
})

export const logMusic = (
  cue: Readonly<{ mood: string; level: string; stinger: string }>,
): void => {
  if (isShooting) {
    cues.push({ tick, _tag: 'Music', ...cue })
  }
}

const musicCuesOf = (heard: Model) =>
  Array.filter(
    update(
      UiStruct.evolve(heard, { audio: () => AudioState.Suspended() }),
      Message.CompletedResumeAudio({ playback: 'Running' }),
    ).commands,
    command => command.name === Command.nameOf(CueMusic),
  )

const audible = (model: Model): Model =>
  UiStruct.evolve(model, {
    audio: () => AudioState.Ready(),
    pageVisibility: () => 'Visible' as const,
    settings: UiStruct.evolve({
      soundSetting: () => 'On' as const,
      musicSetting: () => 'On' as const,
    }),
  })

export const startShot: {
  (next: Plan): (model: Model) => Return
  (model: Model, next: Plan): Return
} = Function.dual(2, (model: Model, next: Plan): Return => {
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
  logAudio(musicCuesOf(heard), 0)
  const maybeCoop = Option.fromNullishOr(next.coop)
  maybeRoom = Option.map(maybeCoop, coop => ({
    world: roomWorldFor({
      ...DEFAULT_ROOM_SETTINGS,
      difficulty: coop.difficulty ?? DEFAULT_ROOM_SETTINGS.difficulty,
    }).start(roomSlots(model), coop.seed),
    nowMs: 0,
  }))
  return Option.match(maybeCoop, {
    onNone: () => ({ model: heard }),
    onSome: coop => {
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
      return { model: current }
    },
  })
})

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
        Array.map(Array.filter(model.zombies, isWalking), zombie => ({
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
      ? Option.map(nearestTo(model, focusOf(model).player), target => ({
          x: target.x - focusOf(model).player.x,
          y: target.y - focusOf(model).player.y,
        }))
      : Option.some({ x: aim[0], y: aim[1] })
  return Option.map(offset, raw => turned(raw, segment.turn ?? 0))
}

const unit = (vector: Vector): Vector => {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
  return length === 0 ? vector : { x: vector.x / length, y: vector.y / length }
}

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
    return UiStruct.evolve(model, {
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
  return UiStruct.evolve(model, {
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
              x: focusOf(model).player.x + offset.x,
              y: focusOf(model).player.y + offset.y,
            }),
          ),
      }),
    }),
  })
}

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
      UiStruct.evolve(model, {
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
const RUG_CENTER = { x: 180, y: 158 }
const FIRE_REACH = 72
const KEEP_FRAMES = 12

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
      Array.findFirst(playersOf(world.world), seat => seat.seat.slot === down),
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
    seat => seat.seat.slot === slot,
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
          Array.map(Array.filter(world.world.zombies, isWalking), zombie => ({
            x: zombie.x,
            y: zombie.y,
            distance: (zombie.x - player.x) ** 2 + (zombie.y - player.y) ** 2,
          })),
        ),
      )
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
    world = modifySeat(world, revive.down, {
      player: player => UiStruct.evolve(player, { hp: () => 0 }),
    })
  }
  if (revive !== undefined && isPrerolled && tick === revive.at + 1) {
    world = isDowned(seatStateAt(world, revive.down).seat)
      ? modifySeatRecord(world, revive.down, seat =>
          UiStruct.evolve(seat, {
            life: () =>
              Life.Downed({ bleedMs: revive.bleedMs, reviveMs: 0, callMs: 0 }),
          }),
        )
      : world
  }
  if (coop.god === true) {
    world = Array.reduce(
      playersOf(world),
      world,
      (current, { seat: { slot }, seat }) =>
        isDownedOnPurpose(coop, slot) || isDowned(seat)
          ? current
          : modifySeat(current, slot, {
              player: player =>
                UiStruct.evolve(player, { hp: () => PLAYER_MAX_HP }),
            }),
    )
  }
  return world === held.world ? held : { ...held, world }
}

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
      const drawn = update(staged, Message.TickedRoomFrame({ nowMs }))
      return isCaptured ? drawn : { model: drawn.model }
    },
  })

export const stepShot: {
  (ticks: number, step: Step): (model: Model) => Return
  (model: Model, ticks: number, step: Step): Return
} = Function.dual(3, (model: Model, ticks: number, step: Step): Return => {
  let current: Return = { model }
  for (let index = 0; index < ticks; index++) {
    const next = Option.isSome(maybeRoom)
      ? coopTick(current.model, true)
      : soloTick(current.model, step)
    logAudio(next.commands ?? [], tick)
    current = { model: next.model }
    tick++
  }
  return current
})
