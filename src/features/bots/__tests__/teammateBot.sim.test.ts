import { Array, Context, Effect, Layer, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { expect, layer } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { addBot } from '../../../domain/bots'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { atSeat } from '../../../test/model.fixture'
import {
  APPLICATION,
  SURFACE,
  isPlaying,
  messageIfAny,
  settleRunCommands,
  startedRun,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { modifyFocus, playersOf } from '../../../world/party/party'

// Whole waves with three teammate bots (src/features/bots/teammateBot.ts): the human
// stands at the spawn pressing READY through every break, and the bots do
// the rest. They fight, buy, and ready up, and the same seed plays the same
// run twice.

const FRAMES = 60 * 90

// NOTE: how often the human looks for a break to press READY in, and how
// often the sounds, cues, and save writes the frames raise are completed,
// so the pending list stays short.
const READY_EVERY = 60

// NOTE: each bot starts with a little cash, so the first breaks that open
// the stall have something to spend.
const withThreeBots = Effect.map(
  startedRun(
    addBot(
      addBot(
        addBot(
          modifyFields(asVeteran(initialModel), {
            maybeSurface: () => Option.some(SURFACE),
          }),
        ),
      ),
    ),
  ),
  started =>
    Array.reduce(Array.range(1, 3), started, (current, slot) =>
      atSeat(current, slot, world =>
        modifyFocus(world, {
          player: player => modifyFields(player, { hp: () => 3 }),
        }),
      ),
    ),
)

// NOTE: one frame of the human: in a break, every READY_EVERY frames, READY
// pressed and let go; then the frame, while the run is still on.
const humanFrame = (frame: number) =>
  Story.steps(
    ...(frame % READY_EVERY === 0
      ? [
          messageIfAny(current =>
            Phase.guards.Preparation(current.phase)
              ? Option.some(Message.PressedKey({ code: 'Enter' }))
              : Option.none(),
          ),
          messageIfAny(current =>
            Array.contains(current.input.pressedKeys, 'Enter')
              ? Option.some(Message.ReleasedKey({ code: 'Enter' }))
              : Option.none(),
          ),
          settleRunCommands,
        ]
      : []),
    messageIfAny(current =>
      isPlaying(current)
        ? Option.some(Message.TickedFrame({ deltaTime: FIXED_STEP_MS }))
        : Option.none(),
    ),
  )

const play = (start: Model) =>
  Story.story(
    APPLICATION,
    Story.given(start),
    ...Array.makeBy(FRAMES, humanFrame),
    settleRunCommands,
  )

const waveOf = (current: Model): number =>
  'wave' in current.phase ? current.phase.wave : 0

// NOTE: the run played once, from the same start, shared by the file's
// tests as the run they read.
class PlayedRun extends Context.Service<
  PlayedRun,
  Readonly<{ start: Model; end: Model }>
>()('munch-manor/features/bots/__tests__/teammateBot.sim.test/PlayedRun') {}

const PlayedRunLayer = Layer.effect(
  PlayedRun,
  Effect.gen(function* () {
    const start = yield* withThreeBots
    return { start, end: yield* play(start) }
  }),
)

layer(PlayedRunLayer, { timeout: 60_000 })(
  'three bots and a human who only presses READY',
  it => {
    it.effect('clear waves, each bot kills, and the crew finds keys', () =>
      Effect.gen(function* () {
        const { end } = yield* PlayedRun
        expect(waveOf(end)).toBeGreaterThanOrEqual(3)
        const crew = playersOf(end)
        expect(crew).toHaveLength(4)
        for (const bot of Array.drop(crew, 1)) {
          expect(bot.seat.kills).toBeGreaterThan(0)
        }
        expect(end.keys.found).toBeGreaterThan(0)
      }),
    )

    it.effect(
      'the human is not carried to the end: bots hold, but the wave still bites',
      () =>
        Effect.gen(function* () {
          const { end } = yield* PlayedRun
          const human = playersOf(end)[0]
          expect(human?.seat.kills).toBe(0)
          expect(end.stats.kills.Shambler).toBeGreaterThan(0)
        }),
    )

    it.effect('the same seed plays the same run', () =>
      Effect.gen(function* () {
        const { start, end } = yield* PlayedRun
        const again = yield* play(start)
        expect(playersOf(again)).toEqual(playersOf(end))
        expect(again.phase).toEqual(end.phase)
      }),
    )
  },
)
