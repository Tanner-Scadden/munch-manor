import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { positionVariation } from './audio'
import { CoopBinding, ShopDialogBinding } from './bindings'
import { Message as CoopMessage } from './coop/message'
import { Screen } from './coop/model'
import { freshRoom, maybeRoomOf } from './coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import { FocusCoopElement, RememberRoom } from './coop/update'
import { aimTracers } from './firing'
import { update } from './main'
import { Message } from './message'
import { AudioState, Lesson, type Model, initialModel } from './model'
import { leadSeatOf, maybePlayerAt, withSeat } from './party'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  actionCodeOf,
  ownWorldOf,
  startRoomWorld,
} from './roomWorld'
import { SeatAction } from './stepWorld'
import { PlaySound } from './update/sound'
import { asVeteran } from './veteran'
import { beginPreparation, startWaveEarly } from './waves'
import {
  type Bullet,
  GameEvent,
  Phase,
  Pierce,
  RunMode,
  ShopState,
} from './worldSchema'

// An online co-op run in the root (src/coopPlay.ts): the room's World drawn
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
  test('the room World draws as the game with this player as the player', () => {
    const ownX = Option.getOrThrow(maybePlayerAt(roomWorld.world, OWN_SLOT))
      .player.x
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
        expect(leadSeatOf(current).slot).toBe(OWN_SLOT)
        expect(current.player.x).toBe(ownX)
        expect(current.party._tag).toBe('Crew')
        expect(current.lessons).toEqual(graduated.lessons)
      }),
    )
  })

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

  test('a wave with a zombie you have not met raises its card, and the run goes on', () => {
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
    story(
      update,
      given(newcomer),
      message(roomFrame(100)),
      model(current => {
        expect(current.debutCard._tag).toBe('Hidden')
      }),
      model(current => {
        const waved = update(drawWave(current), roomFrame(200)).model
        expect(waved.phase._tag).toBe('Wave')
        expect(waved.debutCard._tag).toBe('Showing')
        const later = update(waved, roomFrame(300)).model
        expect(later.phase._tag).toBe('Wave')
        expect(later.debutCard).toMatchObject({ _tag: 'Showing' })
        expect(
          update(later, Message.ClickedDebutCardButton()).model.debutCard._tag,
        ).toBe('Showing')
      }),
    )
  })

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
    const [, tracers] = aimTracers(world, 7, -1)
    expect(tracers.length).toBe(1)
    const tracer = Option.getOrThrow(Array.head(tracers))
    expect(tracer.id).toBe(-1)
    expect(
      Math.hypot(tracer.x - world.player.x, tracer.y - world.player.y),
    ).toBeGreaterThan(0)
    expect(
      Math.sign(tracer.velocityX) === Math.sign(world.player.facing.x) ||
        world.player.facing.x === 0,
    ).toBe(true)
  })

  test('presses go to the room, and there is no pause', () => {
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      message(Message.PressedKey({ code: 'KeyQ' })),
      message(Message.ClickedReloadButton()),
      message(Message.PressedKey({ code: 'Enter' })),
      message(Message.ClickedPauseButton()),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.TickedFrame({ deltaTime: 16 })),
      model(current => {
        expect(queuedOf(current)).toEqual([
          actionCodeOf(SeatAction.Swap()),
          actionCodeOf(SeatAction.Reload()),
          actionCodeOf(SeatAction.Ready()),
        ])
        expect(current.phase._tag).toBe('Preparation')
      }),
    )
  })

  test('the room opening the stall opens the shop, and closing it tells the room', () => {
    const atStall = {
      ...roomWorld,
      world: withSeat(
        beginPreparation(roomWorld.world, 2, 20_000),
        OWN_SLOT,
        world =>
          modifyFields(world, {
            shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
          }),
      ),
    }
    story(
      update,
      given(inRun(atStall)),
      message(roomFrame(100)),
      Command.resolve(
        Dialog.test.ShowDialog,
        DialogBlock.Message.SucceededShowDialog(),
      ),
      model(current => {
        expect(current.shopDialog.isOpen).toBe(true)
      }),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(current.shopDialog.isOpen).toBe(false)
        expect(Array.takeRight(queuedOf(current), 2)).toEqual([
          actionCodeOf(SeatAction.Buy({ item: 'Shotgun' })),
          actionCodeOf(SeatAction.LeaveCounter()),
        ])
      }),
    )
  })

  test('the room sending the player off the counter closes the shop', () => {
    const offCounter = {
      ...roomWorld,
      world: withSeat(startWaveEarly(roomWorld.world), OWN_SLOT, world =>
        modifyFields(world, { shop: () => ShopState.Dismissed() }),
      ),
    }
    const shopping = modifyFields(inRun(offCounter), {
      shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
      shopDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
    })
    story(
      update,
      given(shopping),
      message(roomFrame(100)),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(current.shopDialog.isOpen).toBe(false)
        expect(current.shop).toEqual(ShopState.Dismissed())
      }),
    )
  })

  test('leaving the room goes home', () => {
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      message(toParentMessage(CoopBinding, CoopMessage.CompletedLeaveRoom())),
      Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Command.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      model(current => {
        expect(current.coop.screen._tag).toBe('Hub')
        expect(current.phase._tag).toBe('Ready')
        expect(current.party._tag).toBe('Solo')
      }),
    )
  })
})
