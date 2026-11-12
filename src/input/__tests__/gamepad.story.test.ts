import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { Rumble } from '../../app/update/rumble'
import { FIXED_STEP_MS } from '../../shared/constants'
import { armedBreak, armedFight, openFloorWave } from '../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  isPausedPhase,
  settleRunCommands,
  showDialog,
  tick,
  zombieOf,
} from '../../test/testing'
import { isWieldingMelee } from '../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../world/party/party'
import { Arsenal } from '../../world/schema/worldSchema'
import { ZOMBIE_KINDS } from '../../world/zombies/zombies'

// A controller in a run, driven by PolledGamepad as the Subscription sends
// it: one Message per change, the buttons in the standard layout's order.

const FRAME_MS = 50

const BUTTON_COUNT = 17
const A = 0
const B = 1
const Y = 3
const RT = 7
const SELECT = 8
const START = 9
const DPAD_RIGHT = 15

const REST: ReadonlyArray<number> = [0, 0, 0, 0]

const padOf = ({
  axes = REST,
  held = [],
  index = 0,
}: Readonly<{
  axes?: ReadonlyArray<number>
  held?: ReadonlyArray<number>
  index?: number
}>) =>
  Message.PolledGamepad({
    index,
    axes,
    buttons: Array.makeBy(BUTTON_COUNT, position =>
      Array.contains(held, position) ? 1 : 0,
    ),
  })

const poll = (reading: Parameters<typeof padOf>[0]) =>
  Story.message(padOf(reading))

const rest = poll({})

const fighting: Model = armedFight

const preparing: Model = armedBreak

const isPaused = isPausedPhase

describe('a controller in a run', () => {
  it.effect('the left stick walks, and the controller becomes the device', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ axes: [1, 0, 0, 0] }),
      Story.model(current => {
        expect(current.lastDevice).toBe('Gamepad')
        expect(focusOf(current).intent.move.x).toBeCloseTo(1)
        expect(focusOf(current).intent.move.y).toBeCloseTo(0)
      }),
      tick(FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.x).toBeGreaterThan(
          focusOf(fighting).player.x,
        )
      }),
    ),
  )

  it.effect('the d-pad walks too', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ held: [DPAD_RIGHT] }),
      Story.model(current => {
        expect(focusOf(current).intent.move).toEqual({ x: 1, y: 0 })
      }),
    ),
  )

  it.effect('a stick inside its dead zone walks nowhere', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ axes: [0.2, 0.1, -0.15, 0] }),
      Story.model(current => {
        expect(current.lastDevice).toBe(fighting.lastDevice)
        expect(focusOf(current).intent.move).toEqual({ x: 0, y: 0 })
      }),
    ),
  )

  it.effect('a resting pad takes nothing from the mouse', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      rest,
      Story.model(current => {
        expect(current.lastDevice).toBe(fighting.lastDevice)
        expect(Option.isSome(current.input.maybeGamepad)).toBe(true)
      }),
    ),
  )

  it.effect('the right trigger fires where the right stick aims', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ axes: [0, 0, 0, -1], held: [RT] }),
      Story.model(current => {
        expect(focusOf(current).intent.trigger).toBe('Held')
      }),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(current.stats.shotsFired).toBeGreaterThan(0)
        expect(focusOf(current).player.facing.y).toBeLessThan(0)
      }),
      rest,
      Story.model(current => {
        expect(focusOf(current).intent.trigger).toBe('Released')
      }),
    ),
  )

  // NOTE: owner, 2026-11-12: one button cycles the weapons, one way only.
  it.effect('Y cycles gun, gun, knife, and round, once a press', () => {
    const holds = (tag: 'First' | 'Second' | 'Knife') =>
      Story.model<Model>(current => {
        const { player } = focusOf(current)
        expect(isWieldingMelee(player)).toBe(tag === 'Knife')
        if (tag !== 'Knife') {
          expect(Arsenal.isAnyOf([`Holding${tag}`])(player.arsenal)).toBe(true)
        }
      })
    return Story.story(
      APPLICATION,
      Story.given(fighting),
      holds('First'),
      rest,
      poll({ held: [Y] }),
      holds('Second'),
      poll({ held: [Y], axes: [0.5, 0, 0, 0] }),
      holds('Second'),
      rest,
      poll({ held: [Y] }),
      holds('Knife'),
      rest,
      poll({ held: [Y] }),
      holds('First'),
    )
  })

  it.effect('A readies up in a break, as the interact key does', () =>
    Story.story(
      APPLICATION,
      Story.given(preparing),
      rest,
      poll({ held: [A] }),
      settleRunCommands,
      Story.model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
    ),
  )
})

describe('pausing and leaving by controller', () => {
  it.effect('Start pauses, and Start again resumes', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      rest,
      poll({ held: [START] }),
      Story.model(current => {
        expect(isPaused(current)).toBe(true)
      }),
      rest,
      poll({ held: [START] }),
      Story.model(current => {
        expect(isPaused(current)).toBe(false)
      }),
    ),
  )

  it.effect('from pause, Select asks to leave and A leaves for home', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      rest,
      poll({ held: [START] }),
      rest,
      poll({ held: [SELECT] }),
      showDialog(),
      Story.model(current => {
        expect(current.panel).toBe('LeaveRun')
      }),
      rest,
      poll({ held: [A] }),
      closeDialog(),
      Story.model(current => {
        expect(Phase.isAnyOf(['Ready'])(current.phase)).toBe(true)
      }),
    ),
  )

  it.effect('B stays in the paused run', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      rest,
      poll({ held: [START] }),
      rest,
      poll({ held: [SELECT] }),
      showDialog(),
      rest,
      poll({ held: [B] }),
      closeDialog(),
      Story.model(current => {
        expect(isPaused(current)).toBe(true)
      }),
    ),
  )

  it.effect('a controller unplugged mid-wave pauses the run', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ axes: [1, 0, 0, 0], held: [RT] }),
      Story.message(Message.DisconnectedGamepad({ index: 0 })),
      Story.model(current => {
        expect(isPaused(current)).toBe(true)
        expect(current.input.maybeGamepad).toEqual(Option.none())
        expect(focusOf(current).intent.move).toEqual({ x: 0, y: 0 })
        expect(focusOf(current).intent.trigger).toBe('Released')
      }),
    ),
  )

  it.effect('another controller unplugged changes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      poll({ axes: [1, 0, 0, 0] }),
      Story.message(Message.DisconnectedGamepad({ index: 2 })),
      Story.model(current => {
        expect(isPaused(current)).toBe(false)
        expect(focusOf(current).intent.move.x).toBeCloseTo(1)
      }),
    ),
  )
})

// RUMBLE

const PLAYER_X = 180
const PLAYER_Y = 130

// NOTE: a Runner at full speed just off the player on the open dining
// room floor, so a bite comes in the first second.
const bitten = (model: Model): Model =>
  modifyFocus(
    modifyFields(model, {
      zombies: () => [
        zombieOf('Runner', 1, PLAYER_X - 30, PLAYER_Y, {
          speed: ZOMBIE_KINDS.Runner.speedMax,
        }),
      ],
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_X,
          y: () => PLAYER_Y,
          hp: hp => hp + 50,
        }),
    },
  )

const biteBase: Model = openFloorWave

type RumbleArgs = Parameters<typeof Rumble>[0]

// NOTE: resolves every pending Rumble, handing its args to `into`.
const takeRumbles =
  (into: Array<RumbleArgs>) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> =>
    Array.reduce(simulation.commands, simulation, (current, command) =>
      Option.match(Story.Command.argsOf(Rumble)(command), {
        onNone: () => current,
        onSome: args => {
          into.push(args)
          return Story.Command.resolve(
            Rumble(args),
            Message.CompletedRumble(),
          )(current)
        },
      }),
    )

const rumblesOver = (start: Model) =>
  Effect.suspend(() => {
    const rumbles: Array<RumbleArgs> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      poll({ axes: [0, 0, 1, 0] }),
      ...Array.flatMap(
        Array.makeBy(60, () => tick(FIXED_STEP_MS)),
        step => [step, takeRumbles(rumbles), settleRunCommands],
      ),
    ).pipe(Effect.as<ReadonlyArray<RumbleArgs>>(rumbles))
  })

describe('rumble', () => {
  it.effect('a bite rumbles the controller in hand', () =>
    Effect.gen(function* () {
      const rumbles = yield* rumblesOver(bitten(biteBase))
      expect(rumbles.length).toBeGreaterThan(0)
      expect(rumbles[0]?.index).toBe(0)
      expect(rumbles[0]?.strong ?? 0).toBeGreaterThan(0)
    }),
  )

  it.effect('with RUMBLE off, a bite rumbles nothing', () =>
    Effect.gen(function* () {
      const rumbles = yield* rumblesOver(
        bitten(modifyFields(biteBase, { rumbleSetting: () => 'Off' })),
      )
      expect(rumbles).toEqual([])
    }),
  )
})
