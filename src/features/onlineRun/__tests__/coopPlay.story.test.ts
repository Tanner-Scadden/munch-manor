import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { DialogBlock } from '@foldkit/ui'

import { ShopDialogBinding } from '../../../app/bindings'
import { CoopBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { AudioState, Lesson, type Model } from '../../../app/model'
import { initialModel, update } from '../../../app/pureApp'
import { PlaySound } from '../../../app/update/sound'
import { positionVariation } from '../../../audio/audio'
import { withShopDialogOpen } from '../../../test/model.fixture'
import { withSeat } from '../../../test/model.fixture'
import {
  APPLICATION,
  buyAtCounter,
  closeDialog,
  showDialog,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  actionCodeOf,
  ownWorldOf,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import {
  focusOf,
  leadSeatOf,
  maybePlayerAt,
  modifyFocus,
} from '../../../world/party/party'
import {
  type Bullet,
  GameEvent,
  Phase,
  Pierce,
  RunMode,
  ShopState,
} from '../../../world/schema/worldSchema'
import { aimTracers } from '../../../world/step/firing'
import { SeatAction } from '../../../world/step/stepWorld'
import { beginPreparation, startWaveEarly } from '../../../world/waves/waves'
import { Message as CoopMessage } from '../../coop/message'
import { Screen } from '../../coop/model'
import { freshRoom, maybeRoomOf } from '../../coop/roomState'
import { FocusCoopElement } from '../../coop/steps'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { RememberRoom } from '../../coop/update'
import { DialogBinding } from '../../shop/bindings'

// An online co-op run in the root (src/features/onlineRun/coopPlay.ts): the room's World drawn
// as the game, this player's own seat as the player, presses sent to the
// room as seat actions, the shop opening when the room says so, and no
// pause. The room and its network are the co-op Block's, faked here
// with a session already holding a World.

const graduated: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
})

const OWN_SLOT = 1

const roomWorld = startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS)

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

const queuedOf = (current: Model): ReadonlyArray<number> =>
  Option.match(maybeRoomOf(current.coop), {
    onNone: () => [],
    onSome: room => room.presses.queued,
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

  test('the room copy of your own shot stays quiet; a teammate shot sounds', () => {
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
    const shotSounds = (current: Model, frame: number) =>
      Array.filter(
        update(current, roomFrame(frame)).commands ?? [],
        command =>
          command.name === PlaySound.name &&
          command.args !== undefined &&
          'sound' in command.args &&
          command.args['sound'] === 'ShotgunBlast',
      )
    const heard = shotSounds(audible, 2000)
    expect(Array.map(heard, command => command.args)).toEqual([
      { sound: 'ShotgunBlast', variation: positionVariation(200, 60) },
    ])
  })

  it.effect(
    'a wave with a zombie you have not met raises no card in co-op, and the run goes on',
    () => {
      const waveWorld: RoomWorld = {
        ...roomWorld,
        world: startWaveEarly(roomWorld.world),
      }
      const newcomer = modifyFields(inRun(roomWorld), {
        introducedKinds: () => [],
      })
      const drawWave = (current: Model): Model =>
        modifyFields(current, {
          coop: coop =>
            modifyFields(coop, {
              screen: () =>
                Option.match(maybeRoomOf(coop), {
                  onNone: () => coop.screen,
                  onSome: room =>
                    Screen.InRoom({
                      room: {
                        ...room,
                        session: playingSession(waveWorld, OWN_SLOT),
                      },
                    }),
                }),
            }),
        })
      return Story.story(
        APPLICATION,
        Story.given(newcomer),
        Story.message(roomFrame(100)),
        Story.model(current => {
          expect(current.debutCard._tag).toBe('Hidden')
        }),
        Story.model(current => {
          const waved = update(drawWave(current), roomFrame(200)).model
          expect(waved.phase._tag).toBe('Wave')
          expect(waved.debutCard._tag).toBe('Hidden')
          expect(waved.introducedKinds).toEqual([])
          const later = update(waved, roomFrame(300)).model
          expect(later.phase._tag).toBe('Wave')
          expect(later.debutCard._tag).toBe('Hidden')
        }),
      )
    },
  )

  test('a footstep sounds by how near it is to this player, not the lead', () => {
    const own = Option.getOrThrow(
      maybePlayerAt(roomWorld.world, OWN_SLOT),
    ).player
    const step = (x: number, y: number) =>
      GameEvent.Footfall({ x, y, kind: 'Tank', nearness: 0 })
    const stomps = (x: number, y: number) =>
      Array.filter(
        update(
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
          roomFrame(2000),
        ).commands ?? [],
        command =>
          command.name === PlaySound.name &&
          command.args !== undefined &&
          'sound' in command.args &&
          command.args['sound'] === 'Stomp',
      ).length
    expect(stomps(own.x + 10, own.y)).toBe(1)
    expect(stomps(own.x + 200, own.y)).toBe(0)
  })

  test('a lost co-op endless run records its best wave on the room difficulty', () => {
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
    const showing = (current: Model, world: RoomWorld): Model =>
      modifyFields(current, {
        coop: coop =>
          modifyFields(coop, {
            screen: () =>
              Option.match(maybeRoomOf(coop), {
                onNone: () => coop.screen,
                onSome: room =>
                  Screen.InRoom({
                    room: {
                      ...room,
                      session: playingSession(world, OWN_SLOT),
                    },
                  }),
              }),
          }),
      })
    const playing = update(inRun(endless(Phase.Ready())), roomFrame(100)).model
    expect(playing.phase._tag).toBe('Wave')
    const lost = update(
      showing(playing, endless(Phase.GameOver({ wave: 14 }))),
      roomFrame(200),
    ).model
    expect(lost.phase._tag).toBe('GameOver')
    expect(lost.difficulty.chosen).toBe(graduated.difficulty.chosen)
    expect(lost.bests.byDifficulty.Hard.maybeBestEndlessWave).toEqual(
      Option.some(14),
    )
    expect(lost.bests.byDifficulty.Normal.maybeBestEndlessWave).toEqual(
      graduated.bests.byDifficulty.Normal.maybeBestEndlessWave,
    )
  })

  test('your own shots draw from your own tracers; everyone else from the room', () => {
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
    const drawn = update(withTracer, roomFrame(100)).model
    expect(Array.map(drawn.bullets, bullet => bullet.id)).toEqual([41, 42, -1])
    const flown = Option.getOrThrow(
      Array.findFirst(drawn.bullets, bullet => bullet.id === -1),
    )
    expect(flown.x).toBeGreaterThan(tracer.x)
    const later = update(drawn, roomFrame(150)).model
    const further = Option.getOrThrow(
      Array.findFirst(later.bullets, bullet => bullet.id === -1),
    )
    expect(further.x).toBeGreaterThan(flown.x)
    expect(later.zombies).toEqual(drawn.zombies)
  })

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

  it.effect(
    'the room opening the stall opens the shop, and closing it tells the room',
    () => {
      const atStall = {
        ...roomWorld,
        world: withSeat(
          beginPreparation(roomWorld.world, 2, 20_000),
          OWN_SLOT,
          world =>
            modifyFocus(world, {
              shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
            }),
        ),
      }
      return Story.story(
        APPLICATION,
        Story.given(inRun(atStall)),
        Story.message(roomFrame(100)),
        showDialog(),
        Story.model(current => {
          expect(current.shopDialog.dialog.isOpen).toBe(true)
        }),
        buyAtCounter('Shotgun'),
        Story.messageIn(
          [ShopDialogBinding, DialogBinding],
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        Story.model(current => {
          expect(current.shopDialog.dialog.isOpen).toBe(false)
          expect(Array.takeRight(queuedOf(current), 2)).toEqual([
            actionCodeOf(SeatAction.Buy({ item: 'Shotgun' })),
            actionCodeOf(SeatAction.LeaveCounter()),
          ])
        }),
      )
    },
  )

  it.effect(
    'the room sending the player off the counter closes the shop',
    () => {
      const offCounter = {
        ...roomWorld,
        world: withSeat(startWaveEarly(roomWorld.world), OWN_SLOT, world =>
          modifyFocus(world, { shop: () => ShopState.Dismissed() }),
        ),
      }
      const shopping = modifyFocus(withShopDialogOpen(inRun(offCounter)), {
        shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
      })
      return Story.story(
        APPLICATION,
        Story.given(shopping),
        Story.message(roomFrame(100)),
        closeDialog(),
        Story.model(current => {
          expect(current.shopDialog.dialog.isOpen).toBe(false)
          expect(focusOf(current).shop).toEqual(ShopState.Dismissed())
        }),
      )
    },
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
