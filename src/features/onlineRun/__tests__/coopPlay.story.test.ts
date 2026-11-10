import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { CoopBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { AudioState, Lesson, type Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PlaySound } from '../../../app/update/sound'
import { type SoundEffect, positionVariation } from '../../../audio/audio'
import { Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { withKeys } from '../../../test/model.fixture'
import {
  APPLICATION,
  changeModel,
  checkPendingSounds,
  press,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { heldKeys } from '../../../world/keys/keys'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  actionCodeOf,
  ownWorldOf,
  pastArrival,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import { focusOf, leadSeatOf, maybePlayerAt } from '../../../world/party/party'
import { slamAtMs } from '../../../world/run/arrival'
import {
  type Bullet,
  GameEvent,
  Phase,
  Pierce,
  RunMode,
} from '../../../world/schema/worldSchema'
import { aimTracers } from '../../../world/step/firing'
import { SeatAction } from '../../../world/step/stepWorld'
import { startWaveEarly } from '../../../world/waves/waves'
import { Message as CoopMessage } from '../../coop/message'
import { freshRoom } from '../../coop/roomState'
import { FocusCoopElement } from '../../coop/steps'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { RememberRoom, SendRoomFrames } from '../../coop/update'
import { UNFOLD_MS, isPocketCardBlocking } from '../../dare/pocketCard'
import { maybeIntroFrameOf } from '../../intro/introBeat'

// An online co-op run in the root (src/app/update/coopPlay.ts): the room's World drawn
// as the game, this player's own seat as the player, presses sent to the
// room as seat actions, the crew's one key ring, and no pause. The room and its network are the co-op Block's, faked here
// with a session already holding a World.

const graduated: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
})

const OWN_SLOT = 1

const roomWorld = pastArrival(
  startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS),
)

const inRun = (world: RoomWorld, isAnchored = false): Model =>
  modifyFields(graduated, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: {
              ...freshRoom(CODE, OWN_SLOT),
              maybePlayerId: Option.some(`player-${OWN_SLOT}`),
              maybeLobby: Option.some(
                lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')], 'Playing'),
              ),
              link: 'Online',
              session: {
                ...playingSession(world, OWN_SLOT),
                anchor: isAnchored
                  ? Option.some({ tick: 0, atMs: 0 })
                  : Option.none(),
              },
            },
          }),
      }),
  })

const roomFrame = (nowMs: number) => Message.TickedRoomFrame({ nowMs })

const countOf = (
  sounds: ReadonlyArray<SoundEffect>,
  sound: SoundEffect,
): number => Array.filter(sounds, heard => heard === sound).length

// NOTE: the run with the room's session swapped for one holding `world`,
// as a new World arriving from the room would leave it.
const showing = (current: Model, world: RoomWorld): Model =>
  modifyFields(current, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Option.match(maybeRoomOf(coop), {
            onNone: () => coop.screen,
            onSome: room =>
              Screen.InRoom({
                room: { ...room, session: playingSession(world, OWN_SLOT) },
              }),
          }),
      }),
  })

// NOTE: an anchored room's frame sends this player's input to the room.
const sendFrames = Story.Command.resolve(
  SendRoomFrames,
  CoopMessage.CompletedSendRoomFrames({ bytes: [] }),
)

const queuedOf = (current: Model): ReadonlyArray<number> =>
  Option.match(maybeRoomOf(current.coop), {
    onNone: () => [],
    onSome: room => room.presses.queued,
  })

describe("an online co-op run's intro", () => {
  const fresh = startRoomWorld([0, OWN_SLOT], 7, {
    ...DEFAULT_ROOM_SETTINGS,
    intro: 'Full',
  })
  const arrivingAt = (elapsedMs: number): RoomWorld => ({
    ...fresh,
    world: modifyFields(fresh.world, {
      phase: () => Phase.Arriving({ elapsedMs, cut: 'Full' }),
    }),
  })
  const beatOf = (current: Model) =>
    Option.map(maybeIntroFrameOf(current), ({ beat }) => beat)

  it.effect(
    "plays off the room's clock, and a skip waits at the door for the room's slam",
    () =>
      Story.story(
        APPLICATION,
        Story.given(inRun(arrivingAt(0))),
        Story.message(roomFrame(100)),
        Story.model(current => {
          expect(current.phase._tag).toBe('Arriving')
          expect(beatOf(current)).toEqual(Option.some('Drive'))
        }),
        press('Escape'),
        Story.model(current => {
          expect(current.introSkip).toBe('Skipped')
          expect(current.phase).toEqual(
            Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
          )
          expect(beatOf(current)).toEqual(Option.some('Knock'))
        }),
        changeModel(current =>
          showing(current, arrivingAt(slamAtMs('Full') - 500)),
        ),
        Story.message(roomFrame(200)),
        Story.model(current => {
          expect(beatOf(current)).toEqual(Option.some('Knock'))
        }),
        changeModel(current =>
          showing(current, arrivingAt(slamAtMs('Full') + 20)),
        ),
        Story.message(roomFrame(300)),
        Story.model(current => {
          expect(beatOf(current)).toEqual(Option.some('Slam'))
        }),
        changeModel(current => showing(current, pastArrival(fresh))),
        Story.message(roomFrame(400)),
        Story.model(current => {
          expect(current.phase._tag).toBe('Preparation')
          expect(current.stats.runMs).toBeLessThan(500)
        }),
      ),
  )

  it.effect(
    "the dare card comes out on the room's slam, and the room never waits for it",
    () =>
      Story.story(
        APPLICATION,
        Story.given(inRun(arrivingAt(slamAtMs('Full') + 20))),
        Story.message(roomFrame(100)),
        changeModel(current => showing(current, pastArrival(fresh))),
        Story.message(roomFrame(200)),
        Story.model(current => {
          expect(current.phase._tag).toBe('Preparation')
          expect(current.pocketCard._tag).toBe('Reading')
          expect(isPocketCardBlocking(current)).toBe(false)
        }),
        ...Array.makeBy(UNFOLD_MS / 50, index =>
          Story.message(roomFrame(250 + index * 50)),
        ),
        Story.message(Message.PressedKey({ code: 'Enter' })),
        Story.model(current => {
          expect(current.pocketCard._tag).toBe('Folding')
          expect(queuedOf(current)).toEqual([actionCodeOf(SeatAction.Ready())])
        }),
      ),
  )

  // NOTE: a newcomer who sits through the room's whole intro has seen it,
  // so their next room may skip the drive up; a short cut proves nothing.
  const newcomer = (world: RoomWorld): Model =>
    modifyFields(inRun(world), { introSeen: () => 'Unseen' })

  it.effect('the whole intro in a room marks it seen', () =>
    Story.story(
      APPLICATION,
      Story.given(newcomer(arrivingAt(0))),
      Story.message(roomFrame(100)),
      Story.model(current => {
        expect(current.introSeen).toBe('Seen')
      }),
    ),
  )

  it.effect('the short intro in a room leaves it unseen', () => {
    const short = startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS)
    return Story.story(
      APPLICATION,
      Story.given(newcomer(short)),
      Story.message(roomFrame(100)),
      Story.model(current => {
        expect(current.phase._tag).toBe('Arriving')
        expect(current.introSeen).toBe('Unseen')
      }),
    )
  })
})

describe('an online co-op run', () => {
  it.effect(
    'the room World draws as the game with this player as the player',
    () => {
      const ownX = Option.getOrThrow(maybePlayerAt(roomWorld.world, OWN_SLOT))
        .player.x
      return Story.story(
        APPLICATION,
        Story.given(inRun(roomWorld)),
        Story.message(roomFrame(100)),
        Story.model(current => {
          expect(current.phase._tag).toBe('Preparation')
          expect(leadSeatOf(current).slot).toBe(OWN_SLOT)
          expect(focusOf(current).player.x).toBe(ownX)
          expect(current.party._tag).toBe('Crew')
          expect(current.lessons).toEqual(graduated.lessons)
        }),
      )
    },
  )

  it.effect(
    'the room copy of your own shot stays quiet; a teammate shot sounds',
    () => {
      const shot = (slot: number, x: number) =>
        GameEvent.Fired({
          x,
          y: 60,
          direction: { x: 1, y: 0 },
          weapon: 'Shotgun',
          maybeShooter: Option.some(slot),
        })
      const withShots: RoomWorld = {
        ...roomWorld,
        tick: 1,
        events: [{ tick: 1, events: [shot(OWN_SLOT, 40), shot(0, 200)] }],
      }
      const audible = modifyFields(inRun(withShots, true), {
        audio: () => AudioState.Ready(),
        soundSetting: () => 'On',
      })
      return Story.story(
        APPLICATION,
        Story.given(audible),
        Story.message(roomFrame(2000)),
        Story.Command.expectHas(
          PlaySound({
            sound: 'ShotgunBlast',
            variation: positionVariation(200, 60),
          }),
        ),
        checkPendingSounds(sounds => {
          expect(countOf(sounds, 'ShotgunBlast')).toBe(1)
        }),
        sendFrames,
      )
    },
  )

  it.effect(
    'a wave with a zombie you have not met raises no card in co-op, and the run goes on',
    () =>
      Effect.gen(function* () {
        const waveWorld: RoomWorld = {
          ...roomWorld,
          world: startWaveEarly(roomWorld.world),
        }
        const newcomer = modifyFields(inRun(roomWorld), {
          introducedKinds: () => [],
        })
        const preparing = yield* Story.story(
          APPLICATION,
          Story.given(newcomer),
          Story.message(roomFrame(100)),
          Story.model(current => {
            expect(current.debutCard._tag).toBe('Hidden')
          }),
        )
        return yield* Story.story(
          APPLICATION,
          Story.given(showing(preparing, waveWorld)),
          Story.message(roomFrame(200)),
          Story.model(waved => {
            expect(waved.phase._tag).toBe('Wave')
            expect(waved.debutCard._tag).toBe('Hidden')
            expect(waved.introducedKinds).toEqual([])
          }),
          Story.message(roomFrame(300)),
          Story.model(later => {
            expect(later.phase._tag).toBe('Wave')
            expect(later.debutCard._tag).toBe('Hidden')
          }),
        )
      }),
  )

  it.effect(
    'a footstep sounds by how near it is to this player, not the lead',
    () =>
      Effect.gen(function* () {
        const own = Option.getOrThrow(
          maybePlayerAt(roomWorld.world, OWN_SLOT),
        ).player
        const step = (x: number, y: number) =>
          GameEvent.Footfall({ x, y, kind: 'Tank', nearness: 0 })
        const stomps = (x: number, y: number, heard: number) =>
          Story.story(
            APPLICATION,
            Story.given(
              modifyFields(
                inRun(
                  {
                    ...roomWorld,
                    tick: 1,
                    events: [{ tick: 1, events: [step(x, y)] }],
                  },
                  true,
                ),
                {
                  audio: () => AudioState.Ready(),
                  soundSetting: () => 'On',
                },
              ),
            ),
            Story.message(roomFrame(2000)),
            checkPendingSounds(sounds => {
              expect(countOf(sounds, 'Stomp')).toBe(heard)
            }),
            sendFrames,
          )
        yield* stomps(own.x + 10, own.y, 1)
        yield* stomps(own.x + 200, own.y, 0)
      }),
  )

  it.effect(
    'a lost co-op endless run records its best wave on the room difficulty',
    () =>
      Effect.gen(function* () {
        const endless = (phase: Phase): RoomWorld => ({
          ...roomWorld,
          world: modifyFields(startWaveEarly(roomWorld.world), {
            mode: () => RunMode.Endless(),
            difficulty: difficulty =>
              modifyFields(difficulty, { chosen: () => 'Hard' }),
            phase: current =>
              Phase.isAnyOf(['GameOver'])(phase) ? phase : current,
          }),
        })
        const playing = yield* Story.story(
          APPLICATION,
          Story.given(inRun(endless(Phase.Ready()))),
          Story.message(roomFrame(100)),
          Story.model(current => {
            expect(current.phase._tag).toBe('Wave')
          }),
        )
        return yield* Story.story(
          APPLICATION,
          Story.given(showing(playing, endless(Phase.GameOver({ wave: 14 })))),
          Story.message(roomFrame(200)),
          Story.model(lost => {
            expect(lost.phase._tag).toBe('GameOver')
            expect(lost.difficulty.chosen).toBe(graduated.difficulty.chosen)
            expect(lost.bests.byDifficulty.Hard.maybeBestEndlessWave).toEqual(
              Option.some(14),
            )
            expect(lost.bests.byDifficulty.Normal.maybeBestEndlessWave).toEqual(
              graduated.bests.byDifficulty.Normal.maybeBestEndlessWave,
            )
          }),
        )
      }),
  )

  it.effect(
    'your own shots draw from your own tracers; everyone else from the room',
    () =>
      Effect.gen(function* () {
        const own = Option.getOrThrow(
          maybePlayerAt(roomWorld.world, OWN_SLOT),
        ).player
        const bulletAt = (
          id: number,
          shooter: number,
          weapon: Bullet['weapon'],
        ): Bullet => ({
          id,
          x: own.x + 30,
          y: own.y,
          velocityX: 200,
          velocityY: 0,
          remainingMs: 600,
          weapon,
          damage: 1,
          knockback: 0,
          glaze: 'Plain',
          pierce: Pierce.Stops(),
          shooter,
        })
        const withBullets: RoomWorld = {
          ...roomWorld,
          world: modifyFields(roomWorld.world, {
            bullets: () => [
              bulletAt(40, OWN_SLOT, 'Pistol'),
              bulletAt(41, 0, 'Pistol'),
              bulletAt(42, OWN_SLOT, 'Peashooter'),
            ],
          }),
        }
        const tracer = { ...bulletAt(-1, OWN_SLOT, 'Pistol'), x: own.x + 10 }
        const withTracer = modifyFields(inRun(withBullets), {
          coop: coop =>
            modifyFields(coop, {
              screen: () =>
                Option.match(maybeRoomOf(coop), {
                  onNone: () => coop.screen,
                  onSome: room =>
                    Screen.InRoom({
                      room: { ...room, tracers: [tracer], tracerCount: 1 },
                    }),
                }),
            }),
        })
        const flownOf = (current: Model) =>
          Option.getOrThrow(
            Array.findFirst(current.bullets, bullet => bullet.id === -1),
          )
        return yield* Story.story(
          APPLICATION,
          Story.given(withTracer),
          Story.message(roomFrame(100)),
          Story.models(
            Story.steps(Story.message(roomFrame(150))),
            (drawn, later) => {
              expect(Array.map(drawn.bullets, bullet => bullet.id)).toEqual([
                41, 42, -1,
              ])
              expect(flownOf(drawn).x).toBeGreaterThan(tracer.x)
              expect(flownOf(later).x).toBeGreaterThan(flownOf(drawn).x)
              expect(later.zombies).toEqual(drawn.zombies)
            },
          ),
        )
      }),
  )

  test('a predicted shot fires its tracers from the muzzle on the same frame', () => {
    const world = ownWorldOf(roomWorld, OWN_SLOT)
    const [, tracers] = aimTracers(world, OWN_SLOT, 7, -1)
    expect(tracers.length).toBe(1)
    const tracer = Option.getOrThrow(Array.head(tracers))
    expect(tracer.id).toBe(-1)
    expect(
      Math.hypot(
        tracer.x - focusOf(world).player.x,
        tracer.y - focusOf(world).player.y,
      ),
    ).toBeGreaterThan(0)
    expect(
      Math.sign(tracer.velocityX) ===
        Math.sign(focusOf(world).player.facing.x) ||
        focusOf(world).player.facing.x === 0,
    ).toBe(true)
  })

  it.effect('presses go to the room, and there is no pause', () =>
    Story.story(
      APPLICATION,
      Story.given(inRun(roomWorld)),
      Story.message(roomFrame(100)),
      Story.message(Message.PressedKey({ code: 'KeyQ' })),
      Story.message(Message.ClickedReloadButton()),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.message(Message.ClickedPauseButton()),
      Story.message(Message.PressedKey({ code: 'Escape' })),
      Story.message(Message.TickedFrame({ deltaTime: 16 })),
      Story.model(current => {
        expect(queuedOf(current)).toEqual([
          actionCodeOf(SeatAction.Swap()),
          actionCodeOf(SeatAction.Reload()),
          actionCodeOf(SeatAction.Ready()),
        ])
        expect(current.phase._tag).toBe('Preparation')
      }),
    ),
  )

  it.effect("the crew's one key ring comes from the room", () =>
    Story.story(
      APPLICATION,
      Story.given(inRun({ ...roomWorld, world: withKeys(roomWorld.world, 6) })),
      Story.message(roomFrame(100)),
      Story.model(current => {
        expect(heldKeys(current)).toBe(6)
      }),
    ),
  )

  it.effect('leaving the room goes home', () =>
    Story.story(
      APPLICATION,
      Story.given(inRun(roomWorld)),
      Story.message(roomFrame(100)),
      Story.messageIn(CoopBinding, CoopMessage.CompletedLeaveRoom()),
      Story.Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Story.Command.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      Story.model(current => {
        expect(current.coop.screen._tag).toBe('Hub')
        expect(current.phase._tag).toBe('Ready')
        expect(current.party._tag).toBe('Solo')
      }),
    ),
  )
})
