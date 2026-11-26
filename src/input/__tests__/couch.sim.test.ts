import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../shared/constants'
import {
  type AppStory,
  changeModel,
  checkModel,
  isPlaying,
  messageIfAny,
  modelAfter,
  playedThrough,
  resolveFocusLobby,
  send,
  settleRunCommands,
  steps,
  storyOf,
  throughIntro,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import {
  focusOf,
  forEachSeat,
  modifyFocus,
  playersOf,
} from '../../world/party/party'
import { withWorld } from '../../world/schema/world'
import { FINAL_WAVE } from '../../world/waves/wavePlans'

const SURFACE = { left: 0, top: 0, width: 320, height: 180 }
const MAX_FRAMES = 120_000
const FRAMES_PER_MOVE = 75
const WAVE_STRETCH = 120

const P1_MOVES: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyW'],
  ['KeyD'],
  ['KeyS'],
  ['KeyA'],
]
const P2_MOVES: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyL'],
  ['KeyI'],
  ['KeyJ'],
  ['KeyK'],
]
const MOVE_KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
]

const FRAME = Message.TickedFrame({ deltaTime: FIXED_STEP_MS })

const isHeld = (current: Model, code: string): boolean =>
  Array.contains(current.input.pressedKeys, code)

const tap = (code: string): ReadonlyArray<Message> => [
  Message.PressedKey({ code }),
  Message.ReleasedKey({ code }),
]

type Target = Readonly<{ x: number; y: number; distance: number }>

const nearestZombie = (current: Model): Option.Option<Target> =>
  Array.reduce(
    Array.filter(current.zombies, zombie => zombie.state._tag === 'Walking'),
    Option.none<Target>(),
    (best, zombie) => {
      const distance =
        (zombie.x - focusOf(current).player.x) ** 2 +
        (zombie.y - focusOf(current).player.y) ** 2
      return Option.isNone(best) || distance < best.value.distance
        ? Option.some({ x: zombie.x, y: zombie.y, distance })
        : best
    },
  )

const walking = (frame: number): ReadonlyArray<string> => {
  const step = Math.floor(frame / FRAMES_PER_MOVE)
  return [
    ...(P1_MOVES[step % P1_MOVES.length] ?? []),
    ...(P2_MOVES[(step + 1) % P2_MOVES.length] ?? []),
  ]
}

const holdFor = (current: Model, frame: number): ReadonlyArray<Message> => {
  const wanted = walking(frame)
  return [
    ...Array.map(
      Array.filter(
        MOVE_KEYS,
        key => isHeld(current, key) && !Array.contains(wanted, key),
      ),
      code => Message.ReleasedKey({ code }),
    ),
    ...Array.map(
      Array.filter(wanted, key => !isHeld(current, key)),
      code => Message.PressedKey({ code }),
    ),
  ]
}

const breakFrame = (current: Model, frame: number): ReadonlyArray<Message> => [
  ...holdFor(current, frame),
  ...tap('KeyO'),
  ...tap('KeyY'),
  ...tap('Enter'),
  FRAME,
]

const refillHearts = (current: Model): Model =>
  withWorld(current, world =>
    forEachSeat(world, seatWorld =>
      modifyFocus(seatWorld, {
        player: player => UiStruct.evolve(player, { hp: () => PLAYER_MAX_HP }),
      }),
    ),
  )

const waveFrame = (frame: number) => [
  ...Array.map(MOVE_KEYS, code =>
    messageIfAny(current =>
      isHeld(current, code) && !Array.contains(walking(frame), code)
        ? Option.some(Message.ReleasedKey({ code }))
        : Option.none(),
    ),
  ),
  ...Array.map(walking(frame), code =>
    messageIfAny(current =>
      isHeld(current, code)
        ? Option.none()
        : Option.some(Message.PressedKey({ code })),
    ),
  ),
  messageIfAny(current =>
    isHeld(current, 'KeyU')
      ? Option.none()
      : Option.some(Message.PressedKey({ code: 'KeyU' })),
  ),
  ...(frame % 4 === 0
    ? [
        messageIfAny(current =>
          Option.map(nearestZombie(current), ({ x, y }) =>
            Message.MovedMouse({ clientX: x, clientY: y }),
          ),
        ),
        messageIfAny(current =>
          current.input.mouseButton._tag === 'Held'
            ? Option.none()
            : Option.map(nearestZombie(current), ({ x, y }) =>
                Message.PressedPointer({
                  pointerId: 1,
                  device: 'Mouse',
                  clientX: x,
                  clientY: y,
                }),
              ),
        ),
      ]
    : []),
  send(FRAME),
  changeModel(refillHearts),
]

const waveStretch = (
  start: Model,
  first: number,
  length: number,
): Effect.Effect<ReadonlyArray<Model>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const ends: Array<Model> = []
      const s = yield* storyOf(start)
      steps<AppStory>(
        ...Array.flatMap(
          Array.makeBy(length, index => first + index),
          frame => [
            ...waveFrame(frame),
            checkModel((current: Model) => {
              ends.push(current)
            }),
          ],
        ),
        settleRunCommands,
      )(s)
      return ends
    }),
  )

type Played = Readonly<{ end: Model; frames: number }>

const playFrom = (played: Played): Effect.Effect<Played> =>
  played.frames >= MAX_FRAMES ||
  !isPlaying(played.end) ||
  played.end.stats.wavesCleared >= FINAL_WAVE
    ? Effect.succeed(played)
    : Effect.flatMap(
        Phase.guards.Preparation(played.end.phase)
          ? Effect.map(
              playedThrough(played.end, breakFrame(played.end, played.frames)),
              end => ({ end: refillHearts(end), frames: played.frames + 1 }),
            )
          : Effect.map(
              waveStretch(
                played.end,
                played.frames,
                Math.min(WAVE_STRETCH, MAX_FRAMES - played.frames),
              ),
              ends => {
                const over = Array.findFirstIndex(
                  ends,
                  current => !Phase.guards.Wave(current.phase),
                )
                const last = Option.getOrElse(over, () => ends.length - 1)
                return {
                  end: Option.getOrThrow(Array.get(ends, last)),
                  frames: played.frames + last + 1,
                }
              },
            ),
        playFrom,
      )

describe('two keyboards on one desktop', () => {
  it.effect(
    'play the ten tuned waves together',
    () =>
      Effect.gen(function* () {
        const ready = yield* playedThrough(
          UiStruct.evolve(asVeteran(initialModel), {
            rngState: () => 10,
            localPlayers: () => 2,
            difficulty: () => ({ chosen: 'Normal', nightmare: 'Unlocked' }),
          }),
          [Message.MeasuredGameSurface(SURFACE)],
        )
        const started = yield* modelAfter(
          ready,
          steps<AppStory>(
            ...Array.map(tap('Enter'), message => send(message)),
            resolveFocusLobby(),
            ...Array.map(tap('Enter'), message => send(message)),
            throughIntro,
            settleRunCommands,
          ),
        )
        expect(playersOf(started)).toHaveLength(2)
        const { end, frames } = yield* playFrom({ end: started, frames: 0 })
        expect(end.phase._tag).toBe('Preparation')
        expect(end.stats.wavesCleared).toBe(FINAL_WAVE)
        const [, mate] = playersOf(end)
        expect(end.keys.found).toBeGreaterThan(0)
        expect(mate?.seat.kills).toBeGreaterThan(0)
        expect(frames).toBeLessThan(MAX_FRAMES)
      }),
    300_000,
  )
})
