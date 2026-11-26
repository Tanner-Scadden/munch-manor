import {
  Array,
  Clock,
  Effect,
  Match,
  Option,
  Record,
  Ref,
  Result,
  Schema,
  Stream,
  String,
  pipe,
} from 'effect'
import { EventLog } from 'effect/eventlog'

import type { Matchmaking } from '@munch/netcode'
import {
  ChangedReady,
  EndedGame,
  KickedPlayer,
  LeftRoom,
  type Lobby,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  type RoomTicket,
  Session,
  normalizeRoomCode,
} from '@munch/netcode'
import {
  type LobbyClient,
  type RoomClient,
  type RoomRequestFailed,
  TokenUnavailable,
  connectRoom,
  createRoom,
  followLobby,
  joinRoom,
  roomSocketUrl,
  startQuickPlay,
} from '@munch/netcode/browser'

import { nextAnimationFrame } from '../../src/platform/splash'
import { newIdentity } from '../../src/shared/sessionApi'
import { MANOR, levelOf } from '../../src/world/level/arena'
import {
  type OwnSeat,
  ROOM_WORLD,
  type RoomWorld,
  actionCodeOf,
  heldAction,
} from '../../src/world/net/roomWorld'
import { playersOf } from '../../src/world/party/party'
import { SeatAction } from '../../src/world/step/stepWorld'
import { type Identity, type MintedSession, mintSession } from './session'

declare const __MP_API_ORIGIN__: string

const ARENA_WIDTH = MANOR.width
const ARENA_HEIGHT = MANOR.height
const ARENA_TOP = MANOR.top
const ARENA_LEFT = MANOR.left
const DOT_RADIUS = 6
const WALKER_RADIUS = 5

type Play = Session.Session<RoomWorld, OwnSeat>

const SLOT_COLORS = ['#ff7a59', '#59c2ff', '#b4ff59', '#ff59d6']
const IDENTITY_KEY = 'munch-mp-dev:identity'
const NAME_KEY = 'munch-mp-dev:name'
const RENEW_BEFORE_MS = 60_000

const byId = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) {
    throw new Error(`No #${id}`)
  }
  return found
}

const worldSvg = (): SVGSVGElement => {
  const found = document.getElementById('world')
  if (!(found instanceof SVGSVGElement)) {
    throw new Error('No #world')
  }
  return found
}

const ui = {
  name: byId('name', HTMLInputElement),
  quick: byId('quick', HTMLButtonElement),
  queue: byId('queue', HTMLDivElement),
  queueText: byId('queue-text', HTMLSpanElement),
  accept: byId('accept', HTMLButtonElement),
  keepWaiting: byId('keep-waiting', HTMLButtonElement),
  cancel: byId('cancel', HTMLButtonElement),
  create: byId('create', HTMLButtonElement),
  code: byId('code', HTMLInputElement),
  join: byId('join', HTMLButtonElement),
  entry: byId('entry', HTMLDivElement),
  room: byId('room', HTMLElement),
  link: byId('link', HTMLSpanElement),
  members: byId('members', HTMLUListElement),
  ready: byId('ready', HTMLButtonElement),
  end: byId('end', HTMLButtonElement),
  leave: byId('leave', HTMLButtonElement),
  world: worldSvg(),
  stats: byId('stats', HTMLPreElement),
  status: byId('status', HTMLPreElement),
  debug: byId('debug', HTMLPreElement),
}

const say = (line: string) =>
  Effect.sync(() => {
    ui.status.textContent = line
  })

const params = new URLSearchParams(location.search)

const apiOrigin = (): string =>
  params.get('api') ?? (__MP_API_ORIGIN__ || location.origin)

const decodeIdentity = Option.liftThrowable(EventLog.decodeIdentityString)

const loadIdentity: Effect.Effect<Identity> = Effect.gen(function* () {
  const stored = Option.flatMap(
    Option.fromNullishOr(sessionStorage.getItem(IDENTITY_KEY)),
    decodeIdentity,
  )
  if (Option.isSome(stored)) {
    return stored.value
  }
  const identity = yield* newIdentity
  yield* Effect.sync(() =>
    sessionStorage.setItem(
      IDENTITY_KEY,
      EventLog.encodeIdentityString(identity),
    ),
  )
  return identity
})

const makeToken = (
  origin: string,
  identity: Identity,
): Effect.Effect<Effect.Effect<string, TokenUnavailable>> =>
  Effect.map(Ref.make<Option.Option<MintedSession>>(Option.none()), cached =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis
      const current = yield* Ref.get(cached)
      if (
        Option.isSome(current) &&
        current.value.expiresMs - RENEW_BEFORE_MS > nowMs
      ) {
        return current.value.token
      }
      const session = yield* Effect.mapError(
        mintSession(origin, identity),
        error => TokenUnavailable.make({ reason: error.reason }),
      )
      yield* Ref.set(cached, Option.some(session))
      return session.token
    }),
  )

const rememberRoom = (code: string) =>
  Effect.sync(() => {
    const url = new URL(location.href)
    url.searchParams.set('room', code)
    history.replaceState(null, '', url)
  })

const whenClicked = (button: HTMLButtonElement): Effect.Effect<void> =>
  Effect.callback<void>(resume => {
    const clicked = () => resume(Effect.void)
    button.addEventListener('click', clicked, { once: true })
    return Effect.sync(() => button.removeEventListener('click', clicked))
  })

class NotARoomCode extends Schema.TaggedError<
  NotARoomCode,
  { readonly brand: unique symbol }
>()('NotARoomCode', { typed: Schema.String }) {}

class QuickPlayEnded extends Schema.TaggedError<
  QuickPlayEnded,
  { readonly brand: unique symbol }
>()('QuickPlayEnded', { message: Schema.String }) {}

type EntryError =
  | NotARoomCode
  | QuickPlayEnded
  | RoomRequestFailed
  | TokenUnavailable

const describeError = (error: EntryError): string =>
  Match.valueTags(error, {
    RoomRequestFailed: ({ refusal }) => refusal._tag,
    NotARoomCode: ({ typed }) => `${typed} is not a room code`,
    QuickPlayEnded: ({ message }) => `Quick Play ended: ${message}`,
    TokenUnavailable: ({ reason }) => `could not sign in (${reason})`,
  })

const nameNow = (): string => {
  sessionStorage.setItem(NAME_KEY, ui.name.value)
  return ui.name.value
}

type Choice = 'Create' | 'Join' | 'Quick'

const queueLine = (waiting: Matchmaking.QuickServer): string =>
  waiting._tag === 'Waiting'
    ? waiting.offerPlayers > 0
      ? `Start with ${waiting.offerPlayers} players? ${waiting.accepted} of ${waiting.offerPlayers} said yes. Waiting: ${Array.join(waiting.names, ', ')}`
      : `Waiting for players: ${waiting.waiting} of ${waiting.groupSize} (you are number ${waiting.position}). ${Array.join(waiting.names, ', ')}`
    : ''

const quickPlay = (
  origin: string,
  token: Effect.Effect<string, TokenUnavailable>,
): Effect.Effect<RoomTicket, QuickPlayEnded> =>
  Effect.scoped(
    Effect.gen(function* () {
      const quick = yield* startQuickPlay({ origin, token, name: nameNow() })
      const value_1 = yield* Effect.context()
      const runFork = Effect.runForkWith(value_1)
      ui.queue.hidden = false
      ui.accept.onclick = () => runFork(quick.answer(true))
      ui.keepWaiting.onclick = () => runFork(quick.answer(false))
      const cancelled = whenClicked(ui.cancel).pipe(
        Effect.andThen(quick.cancel),
        Effect.andThen(
          Effect.fail(QuickPlayEnded.make({ message: 'Cancelled' })),
        ),
      )
      const matched = Stream.runFoldEffect(
        quick.events,
        () => Option.none<RoomTicket>(),
        (found, event) =>
          Match.valueTags(event, {
            Heard: ({ message }) =>
              Match.valueTags(message, {
                Matched: ({ code, slot }) => Effect.succeedSome({ code, slot }),
                Refused: ({ reason }) =>
                  QuickPlayEnded.make({ message: reason }),
                Waiting: waiting =>
                  Effect.gen(function* () {
                    const offered = waiting.offerPlayers > 0
                    ui.queueText.textContent = queueLine(waiting)
                    ui.accept.hidden = !offered
                    ui.keepWaiting.hidden = !offered
                    if (offered && autoQuick) {
                      yield* quick.answer(true)
                    }
                    return found
                  }),
              }),
            Dropped: ({ reason }) =>
              Option.isNone(found)
                ? QuickPlayEnded.make({ message: reason })
                : Effect.succeed(found),
            Connecting: () => Effect.succeed(found),
          }),
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(QuickPlayEnded.make({ message: 'The queue closed' })),
            onSome: ticket => Effect.succeed(ticket),
          }),
        ),
      )
      return yield* Effect.raceFirst(matched, cancelled)
    }),
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ui.queue.hidden = true
      }),
    ),
  )

const enter = (
  origin: string,
  token: Effect.Effect<string, TokenUnavailable>,
  choice: Choice,
  typed: string,
): Effect.Effect<string, EntryError> =>
  Effect.gen(function* () {
    const ticket =
      choice === 'Create'
        ? yield* Effect.flatMap(token, held =>
            createRoom({ origin, token: held, name: nameNow() }),
          )
        : choice === 'Quick'
          ? yield* quickPlay(origin, token)
          : yield* Option.match(normalizeRoomCode(typed), {
              onNone: () => Effect.fail(NotARoomCode.make({ typed })),
              onSome: code =>
                Effect.flatMap(token, held =>
                  joinRoom({ origin, token: held, code, name: nameNow() }),
                ),
            })
    yield* rememberRoom(ticket.code)
    return ticket.code
  }).pipe(
    Effect.tapError(error =>
      say(`Could not get into a room: ${describeError(error)}`),
    ),
  )

const autoQuick = params.get('quick') === '1'

const pickRoom = (
  origin: string,
  token: Effect.Effect<string, TokenUnavailable>,
): Effect.Effect<string> => {
  const viaButtons = Effect.gen(function* () {
    const choice = yield* Effect.raceAll([
      Effect.as(whenClicked(ui.create), 'Create' as const),
      Effect.as(whenClicked(ui.join), 'Join' as const),
      Effect.as(whenClicked(ui.quick), 'Quick' as const),
    ])
    return yield* enter(origin, token, choice, ui.code.value)
  }).pipe(Effect.eventually)
  const linked = Option.flatMap(
    Option.fromNullishOr(params.get('room')),
    normalizeRoomCode,
  )
  return Option.isSome(linked)
    ? enter(origin, token, 'Join', linked.value).pipe(
        Effect.catch(() => viaButtons),
      )
    : autoQuick
      ? enter(origin, token, 'Quick', '').pipe(Effect.catch(() => viaButtons))
      : viaButtons
}

interface Controls {
  readonly keys: Set<string>
  readonly pointer: { at: Option.Option<{ x: number; y: number }> }
}

const listenToControls = (): Controls => {
  const controls: Controls = { keys: new Set(), pointer: { at: Option.none() } }
  window.addEventListener('keydown', event => {
    controls.keys.add(String.toLowerCase(event.key))
  })
  window.addEventListener('keyup', event => {
    controls.keys.delete(String.toLowerCase(event.key))
  })
  window.addEventListener('blur', () => controls.keys.clear())
  const toArena = (event: PointerEvent) => {
    const box = ui.world.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * ARENA_WIDTH + ARENA_LEFT,
      y: ((event.clientY - box.top) / box.height) * ARENA_HEIGHT + ARENA_TOP,
    }
  }
  ui.world.addEventListener('pointerdown', event => {
    ui.world.setPointerCapture(event.pointerId)
    controls.pointer.at = Option.some(toArena(event))
  })
  ui.world.addEventListener('pointermove', event => {
    if (Option.isSome(controls.pointer.at)) {
      controls.pointer.at = Option.some(toArena(event))
    }
  })
  const release = () => {
    controls.pointer.at = Option.none()
  }
  ui.world.addEventListener('pointerup', release)
  ui.world.addEventListener('pointercancel', release)
  return controls
}

const toward = (dx: number, dy: number): PlayerInput => {
  const length = Math.hypot(dx, dy)
  return length < 4
    ? NEUTRAL_INPUT
    : {
        ...NEUTRAL_INPUT,
        moveX: Math.round((dx / length) * MOVE_SCALE),
        moveY: Math.round((dy / length) * MOVE_SCALE),
      }
}

const isBot = params.get('bot') === '1'

const readyIn = (world: Option.Option<RoomWorld>): number =>
  Option.match(world, {
    onNone: () => 0,
    onSome: room =>
      room.world.phase._tag === 'Preparation'
        ? heldAction(actionCodeOf(SeatAction.Ready()), room.world.phase.wave)
        : 0,
  })

const inputNow = (
  controls: Controls,
  own: Option.Option<OwnSeat>,
  world: Option.Option<RoomWorld>,
  nowMs: number,
): PlayerInput => {
  if (isBot) {
    const angle = Math.floor(nowMs / 400) * 0.5
    return {
      ...toward(Math.cos(angle) * 100, Math.sin(angle) * 100),
      action: readyIn(world),
    }
  }
  const held = (...names: ReadonlyArray<string>) =>
    Array.some(names, name => controls.keys.has(name)) ? 1 : 0
  const x = held('d', 'arrowright') - held('a', 'arrowleft')
  const y = held('s', 'arrowdown') - held('w', 'arrowup')
  if (x !== 0 || y !== 0) {
    return toward(x * 100, y * 100)
  }
  return Option.match(Option.all([controls.pointer.at, own]), {
    onNone: () => NEUTRAL_INPUT,
    onSome: ([target, seat]) =>
      toward(target.x - seat.player.x, target.y - seat.player.y),
  })
}

const nameOfSlot = (lobby: Option.Option<Lobby>, slot: number): string =>
  Option.match(
    Option.flatMap(lobby, held =>
      Array.findFirst(held.members, member => member.slot === slot),
    ),
    { onNone: () => `Player ${slot + 1}`, onSome: member => member.name },
  )

const SVG_NS = 'http://www.w3.org/2000/svg'

const svgOf = (
  tag: string,
  attributes: Readonly<Record<string, string | number>>,
  text?: string,
): SVGElement => {
  const element = document.createElementNS(SVG_NS, tag)
  Array.forEach(Record.toEntries(attributes), ([name, value]) => {
    element.setAttribute(name, `${value}`)
  })
  if (text !== undefined) {
    element.textContent = text
  }
  return element
}

const draw = (
  world: Option.Option<RoomWorld>,
  play: Play,
  lobby: Option.Option<Lobby>,
) => {
  ui.world.setAttribute('viewBox', `0 0 ${ARENA_WIDTH} ${ARENA_HEIGHT}`)
  ui.world.setAttribute('preserveAspectRatio', 'none')
  const shapes: Array<SVGElement> = [
    svgOf('rect', {
      x: 0,
      y: 0,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      fill: '#1d1a26',
    }),
    svgOf('rect', {
      x: 0.5,
      y: 0.5,
      width: ARENA_WIDTH - 1,
      height: ARENA_HEIGHT - 1,
      fill: 'none',
      stroke: '#3b3350',
    }),
  ]
  const text = (
    content: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    anchor: 'start' | 'middle' = 'start',
  ): SVGElement =>
    svgOf(
      'text',
      {
        x,
        y,
        fill,
        'font-family': 'monospace',
        'font-size': size,
        'text-anchor': anchor,
      },
      content,
    )
  Option.match(world, {
    onNone: () => {
      shapes.push(
        text(
          Option.match(lobby, {
            onNone: () => 'Create or join a room',
            onSome: current =>
              current.status === 'Playing'
                ? 'Connecting to the game...'
                : `Room ${current.code}: the run starts when everyone is READY.`,
          }),
          20,
          30,
          16,
          '#a99cc4',
        ),
      )
    },
    onSome: drawn => {
      const level = levelOf(drawn.world)
      const room = svgOf('g', {
        transform: `translate(${-ARENA_LEFT} ${-ARENA_TOP})`,
      })
      room.append(
        svgOf('rect', {
          x: level.bounds.left,
          y: level.bounds.top,
          width: level.bounds.right - level.bounds.left,
          height: level.bounds.bottom - level.bounds.top,
          fill: 'none',
          stroke: '#3b3350',
        }),
      )
      Array.forEach(drawn.world.zombies, zombie => {
        room.append(
          svgOf('circle', {
            cx: zombie.x,
            cy: zombie.y,
            r: WALKER_RADIUS,
            fill: '#5f8f3e',
          }),
        )
      })
      Array.forEach(drawn.world.bullets, bullet => {
        room.append(
          svgOf('rect', {
            x: bullet.x - 1,
            y: bullet.y - 1,
            width: 2,
            height: 2,
            fill: '#ffe9a8',
          }),
        )
      })
      Array.forEach(playersOf(drawn.world), ({ seat, player }) => {
        const { slot } = seat
        const mine = Option.exists(play.slot, own => own === slot)
        const away = seat.presence === 'Away'
        const body = svgOf('g', { opacity: away ? 0.35 : 1 })
        body.append(
          svgOf('circle', {
            cx: player.x,
            cy: player.y,
            r: DOT_RADIUS,
            fill: SLOT_COLORS[slot] ?? '#fff',
            ...(mine ? { stroke: '#fff', 'stroke-width': 2 } : {}),
          }),
          text(
            `${nameOfSlot(lobby, slot)} ${seat.kills}${away ? ' away' : ''}`,
            player.x,
            player.y - DOT_RADIUS - 3,
            9,
            '#e8e2f0',
            'middle',
          ),
        )
        room.append(body)
      })
      shapes.push(
        room,
        text(
          `tick ${drawn.tick}  ${drawn.world.phase._tag}${'wave' in drawn.world.phase ? ` ${drawn.world.phase.wave}` : ''}`,
          6,
          ARENA_HEIGHT - 6,
          10,
          '#a99cc4',
        ),
      )
    },
  })
  if (play.phase._tag === 'Ended') {
    shapes.push(text(`Game over: ${play.phase.reason}`, 20, 54, 16, '#ffd36e'))
  }
  ui.world.replaceChildren(...shapes)
}

const shortId = (playerId: string) => String.slice(0, 6)(playerId)

const renderLobby = (
  lobby: Lobby,
  me: string,
  write: <A, E>(effect: Effect.Effect<A, E>) => void,
  lobbyClient: LobbyClient,
) => {
  const isHost = lobby.host === me
  const mine = Array.findFirst(lobby.members, member => member.playerId === me)
  ui.entry.hidden = true
  ui.room.textContent = `${lobby.visibility} room ${lobby.code} (${lobby.status}, run ${lobby.round})`
  const link = new URL(location.href)
  link.searchParams.set('room', lobby.code)
  ui.link.textContent = `Invite: ${link.toString()}`
  ui.members.replaceChildren(
    ...Array.map(lobby.members, member => {
      const item = document.createElement('li')
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = SLOT_COLORS[member.slot] ?? '#fff'
      item.append(
        swatch,
        `${member.name}${member.playerId === me ? ' (you)' : ''}${
          member.playerId === lobby.host ? ' (host)' : ''
        } ${member.ready ? 'READY' : 'not ready'} `,
      )
      if (isHost && member.playerId !== me) {
        const kick = document.createElement('button')
        kick.textContent = 'kick'
        kick.addEventListener('click', () =>
          write(
            lobbyClient.write(KickedPlayer, {
              by: me,
              playerId: member.playerId,
            }),
          ),
        )
        item.append(kick)
      }
      return item
    }),
  )
  ui.ready.disabled = lobby.status !== 'Lobby' || Option.isNone(mine)
  ui.ready.textContent = Option.exists(mine, member => member.ready)
    ? 'NOT READY'
    : 'READY'
  ui.end.disabled = !isHost || lobby.status !== 'Playing'
  ui.leave.disabled = Option.isNone(mine)
  Option.map(lobby.result, result =>
    say(
      `Last game ${result.round}: ${result.reason} after ${Math.round(result.ticks / 60)} s. ${Array.join(
        Array.map(
          result.scores,
          score =>
            `${nameOfSlot(Option.some(lobby), score.slot)}: ${score.score}`,
        ),
        ', ',
      )}`,
    ).pipe(Effect.runSync),
  )
}

interface Sample {
  readonly atMs: number
  readonly stats: Session.Stats
}

const STATS_WINDOW_MS = 5000

const ratesOf = (samples: ReadonlyArray<Sample>) =>
  Option.match(Option.all([Array.head(samples), Array.last(samples)]), {
    onNone: () => ({ downKBs: 0, upPerSecond: 0, inputsPerSecond: 0 }),
    onSome: ([first, last]) => {
      const seconds = Math.max(0.001, (last.atMs - first.atMs) / 1000)
      return {
        downKBs: (last.stats.bytesIn - first.stats.bytesIn) / 1024 / seconds,
        upPerSecond: (last.stats.framesOut - first.stats.framesOut) / seconds,
        inputsPerSecond:
          (last.stats.inputsOut - first.stats.inputsOut) / seconds,
      }
    },
  })

const playRoom = (
  origin: string,
  code: string,
  me: string,
  token: Effect.Effect<string, TokenUnavailable>,
) =>
  Effect.gen(function* () {
    const startMs = yield* Clock.currentTimeMillis
    const lobbyClient = yield* followLobby({
      origin,
      code,
      clientId: `tab-${String.slice(0, 8)(me)}`,
      token,
    })
    const room: RoomClient = yield* connectRoom({
      url: roomSocketUrl(origin, code),
      token,
    })
    const lobby = yield* Ref.make<Option.Option<Lobby>>(Option.none())
    const play = yield* Ref.make<Play>(Session.makeSession(startMs))
    const samples = yield* Ref.make<ReadonlyArray<Sample>>([])
    const connection = yield* Ref.make('Connecting')
    const controls = listenToControls()
    const value_2 = yield* Effect.context()
    const runFork = Effect.runForkWith(value_2)
    const write = <A, E>(effect: Effect.Effect<A, E>) => {
      runFork(
        effect.pipe(
          Effect.catch(error => say(`Not sent: ${globalThis.String(error)}`)),
        ),
      )
    }

    ui.ready.onclick = () =>
      write(
        Effect.flatMap(Ref.get(lobby), current =>
          lobbyClient.write(ChangedReady, {
            by: me,
            ready: !Option.exists(current, held =>
              Array.some(
                held.members,
                member => member.playerId === me && member.ready,
              ),
            ),
          }),
        ),
      )
    ui.end.onclick = () => write(lobbyClient.write(EndedGame, { by: me }))
    ui.leave.onclick = () =>
      write(
        Effect.gen(function* () {
          yield* lobbyClient.write(LeftRoom, { by: me })
          yield* room.leave
          yield* Effect.sleep('300 millis')
          const url = new URL(location.href)
          url.searchParams.delete('room')
          location.href = url.toString()
        }),
      )

    yield* Effect.forkScoped(
      Stream.runForEach(lobbyClient.events, event =>
        Match.value(event).pipe(
          Match.tag('Updated', updated =>
            Effect.andThen(
              Ref.set(lobby, Option.some(updated.lobby)),
              Effect.sync(() =>
                renderLobby(updated.lobby, me, write, lobbyClient),
              ),
            ),
          ),
          Match.tag('Rejected', ({ reason }) =>
            say(`The room said no: ${reason}`),
          ),
          Match.tag('Stopped', ({ reason }) =>
            say(`Left the lobby: ${reason}`),
          ),
          Match.orElse(() => Effect.void),
        ),
      ),
    )

    yield* Effect.forkScoped(
      Stream.runForEach(room.events, event =>
        Match.valueTags(event, {
          Received: received =>
            Effect.gen(function* () {
              const current = yield* Ref.get(play)
              const next = Session.receive(
                ROOM_WORLD,
                current,
                received.frame,
                received.bytes,
                received.atMs,
              )
              if (Result.isFailure(next)) {
                return yield* say(
                  `A message did not apply: ${next.failure.reason}`,
                )
              }
              yield* Ref.set(play, next.success)
              yield* Ref.set(connection, 'Connected')
            }),
          Ponged: ({ sentMs, atMs }) =>
            Ref.update(play, current =>
              Session.heardPong(current, sentMs, atMs),
            ),
          Connecting: ({ attempt }) =>
            Effect.gen(function* () {
              const nowMs = yield* Clock.currentTimeMillis
              yield* Ref.update(play, current =>
                Session.reconnecting(current, nowMs),
              )
              yield* Ref.set(connection, `Connecting (try ${attempt + 1})`)
            }),
          Dropped: ({ reason }) => Ref.set(connection, `Dropped: ${reason}`),
          Stopped: ({ reason }) => Ref.set(connection, `Stopped: ${reason}`),
        }),
      ),
    )

    const frame = Effect.gen(function* () {
      yield* nextAnimationFrame
      const nowMs = yield* Clock.currentTimeMillis
      const before = yield* Ref.get(play)
      const input = inputNow(
        controls,
        before.predicted,
        Option.map(Array.last(before.frames), latest => latest.world),
        nowMs,
      )
      const ticked = Session.tickInput(ROOM_WORLD, before, input, nowMs)
      const sent = yield* Effect.forEach(ticked.outgoing, room.send)
      const counted = Array.reduce(
        Array.getSomes(sent),
        ticked.session,
        (session, bytes) => Session.countSent(session, bytes),
      )
      const rendered = Session.render(ROOM_WORLD, counted, nowMs)
      yield* Ref.set(play, rendered.session)
      const currentLobby = yield* Ref.get(lobby)
      draw(rendered.world, rendered.session, currentLobby)
      const window = yield* Ref.updateAndGet(samples, held =>
        pipe(
          Array.append(held, { atMs: nowMs, stats: rendered.session.stats }),
          Array.filter(sample => nowMs - sample.atMs <= STATS_WINDOW_MS),
        ),
      )
      const rates = ratesOf(window)
      const stats = rendered.session.stats
      const others = Option.match(rendered.world, {
        onNone: () => [],
        onSome: world =>
          Array.filter(
            playersOf(world.world),
            seated =>
              !Option.exists(
                rendered.session.slot,
                slot => slot === seated.seat.slot,
              ),
          ),
      })
      const status = yield* Ref.get(connection)
      ui.stats.textContent = Array.join(
        [
          `you ${shortId(me)} slot ${Option.getOrElse(rendered.session.slot, () => -1)}  ${rendered.session.phase._tag}  ${status}`,
          `round trip ${Math.round(rendered.session.rttMs)} ms   down ${rates.downKBs.toFixed(2)} KB/s   up ${rates.upPerSecond.toFixed(1)} msg/s (inputs ${rates.inputsPerSecond.toFixed(1)}/s)`,
          `drawn ${Session.INTERPOLATION_MS} ms behind, ${rendered.session.frames.length} messages held   ack ${rendered.session.ack}   corrections ${stats.corrections} (last ${stats.lastCorrectionPx.toFixed(1)} px, max ${stats.maxCorrectionPx.toFixed(1)} px)`,
        ],
        '\n',
      )
      ui.debug.textContent = yield* Schema.encodeEffect(
        Schema.fromJsonString(Schema.Unknown),
      )({
        me,
        code,
        slot: Option.getOrNull(rendered.session.slot),
        phase: rendered.session.phase._tag,
        worldPhase: Option.match(rendered.world, {
          onNone: () => null,
          onSome: world => world.world.phase._tag,
        }),
        lobbyStatus: Option.match(currentLobby, {
          onNone: () => null,
          onSome: held => held.status,
        }),
        visibility: Option.match(currentLobby, {
          onNone: () => null,
          onSome: held => held.visibility,
        }),
        names: Option.match(currentLobby, {
          onNone: () => [],
          onSome: held => Array.map(held.members, member => member.name),
        }),
        members: Option.match(currentLobby, {
          onNone: () => 0,
          onSome: held => held.members.length,
        }),
        connection: status,
        rttMs: Math.round(rendered.session.rttMs),
        downKBs: rates.downKBs,
        upPerSecond: rates.upPerSecond,
        inputsPerSecond: rates.inputsPerSecond,
        bytesIn: stats.bytesIn,
        framesIn: stats.framesIn,
        framesOut: stats.framesOut,
        corrections: stats.corrections,
        maxCorrectionPx: stats.maxCorrectionPx,
        tick: Option.match(rendered.world, {
          onNone: () => null,
          onSome: world => world.tick,
        }),
        others: Array.map(others, seated => ({
          slot: seated.seat.slot,
          x: seated.player.x,
          y: seated.player.y,
          away: seated.seat.presence === 'Away',
        })),
        own: Option.match(rendered.session.shown, {
          onNone: () => null,
          onSome: own => ({ x: own.player.x, y: own.player.y }),
        }),
      }).pipe(Effect.orDie)
    })

    return yield* Effect.forever(frame)
  })

const main = Effect.gen(function* () {
  const origin = apiOrigin()
  ui.name.value = params.get('name') ?? sessionStorage.getItem(NAME_KEY) ?? ''
  yield* say(`Signing in at ${origin}...`)
  const identity = yield* loadIdentity
  const token = yield* makeToken(origin, identity)
  yield* Effect.retry(token, { times: 3 })
  yield* say(
    `Signed in as ${shortId(identity.publicKey)}${isBot ? ' (bot)' : ''}.`,
  )
  const code = yield* pickRoom(origin, token)
  yield* say(`In room ${code}.`)
  return yield* Effect.scoped(playRoom(origin, code, identity.publicKey, token))
})

Effect.runFork(
  main.pipe(
    Effect.catchCause(cause =>
      say(`The dev page stopped: ${globalThis.String(cause)}`),
    ),
  ),
)
