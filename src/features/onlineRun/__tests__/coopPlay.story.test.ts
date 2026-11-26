import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import { AudioState, Lesson, type Model } from '../../../app/model'
import { PlaySound } from '../../../app/update/sound'
import { type SoundEffect, positionVariation } from '../../../audio/audio'
import { Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { withKeys } from '../../../test/model.fixture'
import {
  type StoryStep,
  changeModel,
  checkModel,
  checkPendingSounds,
  modelAfter,
  press,
  resolveFocusCoop,
  send,
  settleRunCommands,
  steps,
} from '../../../test/testing'
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
import { freshRoom } from '../../coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { RememberRoom, SendRoomFrames } from '../../coop/update'
import { UNFOLD_MS, isPocketCardBlocking } from '../../dare/pocketCard'
import { endKindOf } from '../../end/endBeat'
import { maybeIntroFrameOf } from '../../intro/introBeat'
import { OWN_SLOT, graduated, roomWorld } from './onlineRun.fixture'

const inRun = (world: RoomWorld, isAnchored = false): Model =>
  UiStruct.evolve(graduated, {
    coop: coop =>
      UiStruct.evolve(coop, {
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

const roomFrame = (nowMs: number): StoryStep =>
  send(Message.TickedRoomFrame({ nowMs }))

const countOf = (
  sounds: ReadonlyArray<SoundEffect>,
  sound: SoundEffect,
): number => Array.filter(sounds, heard => heard === sound).length

const showing = (current: Model, world: RoomWorld): Model =>
  UiStruct.evolve(current, {
    coop: coop =>
      UiStruct.evolve(coop, {
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

const sendFrames: StoryStep = s =>
  s.resolve(SendRoomFrames, Message.CompletedSendRoomFrames({ bytes: [] }))

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
    world: UiStruct.evolve(fresh.world, {
      phase: () => Phase.Arriving({ elapsedMs, cut: 'Full' }),
    }),
  })
  const beatOf = (current: Model) =>
    Option.map(maybeIntroFrameOf(current), ({ beat }) => beat)

  it.effect(
    "plays off the room's clock, and a skip waits at the door for the room's slam",
    () =>
      modelAfter(
        inRun(arrivingAt(0)),
        steps(
          roomFrame(100),
          checkModel(current => {
            expect(current.phase._tag).toBe('Arriving')
            expect(beatOf(current)).toEqual(Option.some('Drive'))
          }),
          press('Escape'),
          checkModel(current => {
            expect(current.introSkip).toBe('Skipped')
            expect(current.phase).toEqual(
              Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
            )
            expect(beatOf(current)).toEqual(Option.some('Knock'))
          }),
          changeModel(current =>
            showing(current, arrivingAt(slamAtMs('Full') - 500)),
          ),
          roomFrame(200),
          checkModel(current => {
            expect(beatOf(current)).toEqual(Option.some('Knock'))
          }),
          changeModel(current =>
            showing(current, arrivingAt(slamAtMs('Full') + 20)),
          ),
          roomFrame(300),
          checkModel(current => {
            expect(beatOf(current)).toEqual(Option.some('Slam'))
          }),
          changeModel(current => showing(current, pastArrival(fresh))),
          roomFrame(400),
          checkModel(current => {
            expect(current.phase._tag).toBe('Preparation')
            expect(current.stats.runMs).toBeLessThan(500)
          }),
        ),
      ),
  )

  it.effect(
    "the dare card comes out on the room's slam, and the room never waits for it",
    () =>
      modelAfter(
        UiStruct.evolve(inRun(arrivingAt(slamAtMs('Full') + 20)), {
          lessons: lessons =>
            UiStruct.evolve(lessons, { dareCard: () => Lesson.Pending() }),
        }),
        steps(
          roomFrame(100),
          changeModel(current => showing(current, pastArrival(fresh))),
          roomFrame(200),
          checkModel(current => {
            expect(current.phase._tag).toBe('Preparation')
            expect(current.pocketCard._tag).toBe('Reading')
            expect(isPocketCardBlocking(current)).toBe(false)
          }),
          ...Array.makeBy(UNFOLD_MS / 50, index => roomFrame(250 + index * 50)),
          send(Message.PressedKey({ code: 'Enter' })),
          checkModel(current => {
            expect(current.pocketCard._tag).toBe('Folding')
            expect(queuedOf(current)).toEqual([
              actionCodeOf(SeatAction.Ready()),
            ])
          }),
        ),
      ),
  )

  const newcomer = (world: RoomWorld): Model =>
    UiStruct.evolve(inRun(world), { introSeen: () => 'Unseen' })

  it.effect('the whole intro in a room marks it seen', () =>
    modelAfter(
      newcomer(arrivingAt(0)),
      steps(
        roomFrame(100),
        checkModel(current => {
          expect(current.introSeen).toBe('Seen')
        }),
      ),
    ),
  )

  it.effect('the short intro in a room leaves it unseen', () => {
    const short = startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS)
    return modelAfter(
      newcomer(short),
      steps(
        roomFrame(100),
        checkModel(current => {
          expect(current.phase._tag).toBe('Arriving')
          expect(current.introSeen).toBe('Unseen')
        }),
      ),
    )
  })
})

describe('an online co-op run', () => {
  it.effect(
    'the room World draws as the game with this player as the player',
    () => {
      const ownX = Option.getOrThrow(maybePlayerAt(roomWorld.world, OWN_SLOT))
        .player.x
      return modelAfter(
        inRun(roomWorld),
        steps(
          roomFrame(100),
          checkModel(current => {
            expect(current.phase._tag).toBe('Preparation')
            expect(leadSeatOf(current).slot).toBe(OWN_SLOT)
            expect(focusOf(current).player.x).toBe(ownX)
            expect(current.party._tag).toBe('Crew')
            expect(current.lessons).toEqual(graduated.lessons)
          }),
        ),
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
      const audible = UiStruct.evolve(inRun(withShots, true), {
        audio: () => AudioState.Ready,
        settings: settings =>
          UiStruct.evolve(settings, { soundSetting: () => 'On' }),
      })
      return modelAfter(
        audible,
        steps(
          roomFrame(2000),
          s =>
            s.expectHas(
              PlaySound.make({
                sound: 'ShotgunBlast',
                variation: positionVariation(200, 60),
              }),
            ),
          checkPendingSounds(sounds => {
            expect(countOf(sounds, 'ShotgunBlast')).toBe(1)
          }),
          sendFrames,
        ),
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
        const newcomer = UiStruct.evolve(inRun(roomWorld), {
          introducedKinds: () => [],
        })
        const preparing = yield* modelAfter(
          newcomer,
          steps(
            roomFrame(100),
            checkModel(current => {
              expect(current.debutCard._tag).toBe('Hidden')
            }),
          ),
        )
        return yield* modelAfter(
          showing(preparing, waveWorld),
          steps(
            roomFrame(200),
            checkModel(waved => {
              expect(waved.phase._tag).toBe('Wave')
              expect(waved.debutCard._tag).toBe('Hidden')
              expect(waved.introducedKinds).toEqual([])
            }),
            roomFrame(300),
            checkModel(later => {
              expect(later.phase._tag).toBe('Wave')
              expect(later.debutCard._tag).toBe('Hidden')
            }),
          ),
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
          modelAfter(
            UiStruct.evolve(
              inRun(
                {
                  ...roomWorld,
                  tick: 1,
                  events: [{ tick: 1, events: [step(x, y)] }],
                },
                true,
              ),
              {
                audio: () => AudioState.Ready,
                settings: settings =>
                  UiStruct.evolve(settings, { soundSetting: () => 'On' }),
              },
            ),
            steps(
              roomFrame(2000),
              checkPendingSounds(sounds => {
                expect(countOf(sounds, 'Stomp')).toBe(heard)
              }),
              sendFrames,
            ),
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
          world: UiStruct.evolve(startWaveEarly(roomWorld.world), {
            mode: () => RunMode.Endless(),
            difficulty: difficulty =>
              UiStruct.evolve(difficulty, { chosen: () => 'Hard' }),
            phase: current =>
              Phase.isAnyOf(['GameOver'])(phase) ? phase : current,
          }),
        })
        const playing = yield* modelAfter(
          inRun(endless(Phase.Ready())),
          steps(
            roomFrame(100),
            checkModel(current => {
              expect(current.phase._tag).toBe('Wave')
            }),
          ),
        )
        return yield* modelAfter(
          showing(playing, endless(Phase.GameOver({ wave: 14 }))),
          steps(
            roomFrame(200),
            checkModel(lost => {
              expect(lost.phase._tag).toBe('GameOver')
              expect(lost.difficulty.chosen).toBe(graduated.difficulty.chosen)
              expect(lost.bests.byDifficulty.Hard.maybeBestEndlessWave).toEqual(
                Option.some(14),
              )
              expect(
                lost.bests.byDifficulty.Normal.maybeBestEndlessWave,
              ).toEqual(
                graduated.bests.byDifficulty.Normal.maybeBestEndlessWave,
              )
            }),
          ),
        )
      }),
  )

  it.effect(
    'a crew that leaves by the back door ends CHICKEN on every client, paid as left early',
    () =>
      Effect.gen(function* () {
        const leftEarly: RoomWorld = {
          ...roomWorld,
          world: UiStruct.evolve(roomWorld.world, {
            phase: () => Phase.LeftEarly({ wave: 3 }),
          }),
        }
        const playing = yield* modelAfter(
          inRun(roomWorld),
          steps(
            roomFrame(100),
            checkModel(current => {
              expect(current.phase._tag).toBe('Preparation')
            }),
          ),
        )
        return yield* modelAfter(
          showing(playing, leftEarly),
          steps(
            roomFrame(200),
            settleRunCommands,
            checkModel(left => {
              expect(left.phase).toEqual(Phase.LeftEarly({ wave: 3 }))
              expect(endKindOf(left)).toEqual(Option.some('Chicken'))
              expect(left.lastRunEnding).toBe('LeftEarly')
              const gain = Option.getOrThrow(left.runGains.maybeRankGain)
              expect(gain.bonuses).not.toContain('FirstEscape')
              expect(left.bonuses.escapedOn).toEqual(
                graduated.bonuses.escapedOn,
              )
            }),
          ),
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
          world: UiStruct.evolve(roomWorld.world, {
            bullets: () => [
              bulletAt(40, OWN_SLOT, 'Pistol'),
              bulletAt(41, 0, 'Pistol'),
              bulletAt(42, OWN_SLOT, 'Peashooter'),
            ],
          }),
        }
        const tracer = { ...bulletAt(-1, OWN_SLOT, 'Pistol'), x: own.x + 10 }
        const withTracer = UiStruct.evolve(inRun(withBullets), {
          coop: coop =>
            UiStruct.evolve(coop, {
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
        return yield* modelAfter(
          withTracer,
          steps(roomFrame(100), s => {
            const drawn = s.model
            const later = roomFrame(150)(s).model
            expect(Array.map(drawn.bullets, bullet => bullet.id)).toEqual([
              41, 42, -1,
            ])
            expect(flownOf(drawn).x).toBeGreaterThan(tracer.x)
            expect(flownOf(later).x).toBeGreaterThan(flownOf(drawn).x)
            expect(later.zombies).toEqual(drawn.zombies)
            return s
          }),
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
    modelAfter(
      inRun(roomWorld),
      steps(
        roomFrame(100),
        send(Message.PressedKey({ code: 'KeyQ' })),
        send(Message.ClickedReloadButton()),
        send(Message.PressedKey({ code: 'Enter' })),
        send(Message.ClickedPauseButton()),
        send(Message.PressedKey({ code: 'Escape' })),
        send(Message.TickedFrame({ deltaTime: 16 })),
        checkModel(current => {
          expect(queuedOf(current)).toEqual([
            actionCodeOf(SeatAction.Swap()),
            actionCodeOf(SeatAction.Reload()),
            actionCodeOf(SeatAction.Ready()),
          ])
          expect(current.phase._tag).toBe('Preparation')
        }),
      ),
    ),
  )

  it.effect('the number keys go to the room as draws', () =>
    modelAfter(
      inRun(roomWorld),
      steps(
        roomFrame(100),
        send(Message.PressedKey({ code: 'Digit2' })),
        send(Message.PressedKey({ code: 'Digit1' })),
        send(Message.PressedKey({ code: 'Digit3' })),
        checkModel(current => {
          expect(queuedOf(current)).toEqual([
            actionCodeOf(SeatAction.Draw({ slot: 'Second' })),
            actionCodeOf(SeatAction.Draw({ slot: 'First' })),
            actionCodeOf(SeatAction.Melee()),
          ])
        }),
      ),
    ),
  )

  it.effect('Tab opens the dare card, and the room never waits for it', () =>
    modelAfter(
      inRun(roomWorld),
      steps(
        roomFrame(100),
        press('Tab'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
          expect(isPocketCardBlocking(current)).toBe(false)
        }),
        ...Array.makeBy(4, index => roomFrame(150 + index * 50)),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
        }),
        press('Enter'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
          expect(queuedOf(current)).toEqual([actionCodeOf(SeatAction.Ready())])
        }),
      ),
    ),
  )

  it.effect("the crew's one key ring comes from the room", () =>
    modelAfter(
      inRun({ ...roomWorld, world: withKeys(roomWorld.world, 6) }),
      steps(
        roomFrame(100),
        checkModel(current => {
          expect(heldKeys(current)).toBe(6)
        }),
      ),
    ),
  )

  it.effect('leaving the room goes home', () =>
    modelAfter(
      inRun(roomWorld),
      steps(
        roomFrame(100),
        send(Message.CompletedLeaveRoom()),
        s => s.resolve(RememberRoom, Component.noop),
        resolveFocusCoop,
        checkModel(current => {
          expect(current.coop.screen._tag).toBe('Hub')
          expect(current.phase._tag).toBe('Ready')
          expect(current.party._tag).toBe('Solo')
        }),
      ),
    ),
  )
})
