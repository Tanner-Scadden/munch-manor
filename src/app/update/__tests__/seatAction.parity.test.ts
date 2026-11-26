import { Array, Effect, Option, Order, Record, Struct } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { SHOTGUN, holdingFirst, withPistol } from '../../../test/arsenals'
import {
  DISTANT_SPAWN,
  crewInWave,
  quietWave,
  readyModel,
  withArsenal,
  withKnifeOut,
  withSeatLife,
} from '../../../test/model.fixture'
import {
  BELOW_NORTH_DOOR,
  type RootSteps,
  WORLD_KEYS,
  modelAfter,
  send,
  settleRunCommands,
  steps,
} from '../../../test/testing'
import {
  actionCodeOf,
  heldAction,
  seatActionOf,
} from '../../../world/net/roomWorld'
import { MEDIC_RULES } from '../../../world/party/medic'
import { COOP_RULES, leadSeatOf, modifyFocus } from '../../../world/party/party'
import type { World } from '../../../world/schema/world'
import { idleIntent } from '../../../world/schema/worldSchema'
import { SeatAction, applySeatAction } from '../../../world/step/stepWorld'
import { Message } from '../../message'
import { BreakClock, Life, type Model, Phase } from '../../model'

const CUE_KEYS: ReadonlySet<keyof World> = new Set(['lessons', 'debutCard'])

const RULE_KEYS = Array.filter(WORLD_KEYS, key => !CUE_KEYS.has(key))

const ruleFieldsOf = (world: World) => ({
  ...Struct.pick(world, RULE_KEYS),
  seats: Array.map(world.seats, state =>
    UiStruct.evolve(state, { intent: () => idleIntent }),
  ),
})

type Row = Readonly<{
  from: Model
  action: SeatAction
  presses: RootSteps
}>

const inWave = quietWave(3)

const withTraps = (base: Model, barricades: number, turrets: number): Model =>
  modifyFocus(base, {
    trapStock: () => ({ Barricade: barricades, Turret: turrets }),
    selectedTrap: () => 'Barricade',
    player: player =>
      UiStruct.evolve(player, {
        x: () => BELOW_NORTH_DOOR.x,
        y: () => BELOW_NORTH_DOOR.y,
      }),
  })

const inBreak = UiStruct.evolve(readyModel, {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: 20_000,
      durationMs: 20_000,
      clock: BreakClock.Counting(),
      spawns: [DISTANT_SPAWN],
    }),
})

const downedLead = withSeatLife(
  0,
  Life.Downed({
    bleedMs: COOP_RULES.bleedOutMs / 2,
    reviveMs: 0,
    callMs: MEDIC_RULES.cooldownMs,
  }),
)(crewInWave(2))

const ROWS: { readonly [Tag in SeatAction['_tag']]: Row } = {
  Swap: {
    from: withArsenal(inWave, holdingFirst(SHOTGUN)),
    action: SeatAction.Swap(),
    presses: send(Message.ClickedSwapButton()),
  },
  Melee: {
    from: inWave,
    action: SeatAction.Melee(),
    presses: send(Message.ClickedMeleeSlot()),
  },
  Draw: {
    from: withKnifeOut(withArsenal(inWave, holdingFirst(SHOTGUN))),
    action: SeatAction.Draw({ slot: 'Second' }),
    presses: send(Message.ClickedGunSlot({ slot: 'Second' })),
  },
  Reload: {
    from: withKnifeOut(
      modifyFocus(inWave, {
        player: player =>
          withPistol(player, pistol =>
            UiStruct.evolve(pistol, { loaded: () => 2 }),
          ),
      }),
    ),
    action: SeatAction.Reload(),
    presses: send(Message.ClickedReloadButton()),
  },
  PlaceTrap: {
    from: withTraps(inBreak, 1, 0),
    action: SeatAction.PlaceTrap(),
    presses: send(Message.ClickedPlaceTrapButton()),
  },
  NextTrap: {
    from: withTraps(inWave, 1, 1),
    action: SeatAction.NextTrap(),
    presses: send(Message.ClickedNextTrapButton()),
  },
  Ready: {
    from: inBreak,
    action: SeatAction.Ready(),
    presses: send(Message.ClickedStartWaveButton()),
  },
  CallMedic: {
    from: downedLead,
    action: SeatAction.CallMedic(),
    presses: send(Message.ClickedMedicButton()),
  },
}

const TAGS = Struct.keys(ROWS)

const KEY_ROWS: ReadonlyArray<readonly [string, Row]> = [
  [
    'Digit2',
    {
      from: withArsenal(inWave, holdingFirst(SHOTGUN)),
      action: SeatAction.Draw({ slot: 'Second' }),
      presses: send(Message.PressedKey({ code: 'Digit2' })),
    },
  ],
  [
    'Digit1',
    {
      from: withKnifeOut(withArsenal(inWave, holdingFirst(SHOTGUN))),
      action: SeatAction.Draw({ slot: 'First' }),
      presses: send(Message.PressedKey({ code: 'Digit1' })),
    },
  ],
  [
    'Digit3',
    {
      from: inWave,
      action: SeatAction.Melee(),
      presses: send(Message.PressedKey({ code: 'Digit3' })),
    },
  ],
]

const padPress = (button: number) =>
  steps(
    ...Array.map([[], [button]], held =>
      send(
        Message.PolledGamepad({
          index: 0,
          axes: [0, 0, 0, 0],
          buttons: Array.makeBy(17, position =>
            Array.contains(held, position) ? 1 : 0,
          ),
        }),
      ),
    ),
  )

const PAD_ROWS: ReadonlyArray<readonly [string, Row]> = Array.map(
  [
    ['pad Y', 3, 'Swap'],
    ['pad B', 1, 'Melee'],
    ['pad X', 2, 'Reload'],
    ['pad LT', 6, 'PlaceTrap'],
    ['pad LB', 4, 'NextTrap'],
    ['pad A', 0, 'Ready'],
  ] as const,
  ([name, button, tag]) =>
    [
      name,
      {
        from: ROWS[tag].from,
        action: ROWS[tag].action,
        presses: padPress(button),
      },
    ] as const,
)

const inSinglePlayer = (from: Model, presses: RootSteps) =>
  modelAfter(from, steps(presses, settleRunCommands))

const inRoom = (world: World, action: SeatAction): World => {
  const read = Option.getOrThrow(
    seatActionOf(world, heldAction(actionCodeOf(action), 1)),
  )
  return applySeatAction(world, leadSeatOf(world).slot, read)
}

describe('one rule set for player actions', () => {
  test('every seat action has a parity row', () => {
    expect(Array.sort(TAGS, Order.String)).toEqual(
      Array.sort(Record.keys(SeatAction.cases), Order.String),
    )
  })

  it.effect.each(TAGS)('%s through single player matches the room', tag =>
    Effect.gen(function* () {
      const { from, action, presses } = ROWS[tag]
      const roomWorld = inRoom(from, action)
      expect(
        ruleFieldsOf(roomWorld),
        'the row starts where the action does something',
      ).not.toEqual(ruleFieldsOf(from))
      const played = yield* inSinglePlayer(from, presses)
      expect(ruleFieldsOf(played)).toEqual(ruleFieldsOf(roomWorld))
    }),
  )

  it.effect.each([...KEY_ROWS, ...PAD_ROWS])(
    '%s through single player matches the room',
    ([, row]) =>
      Effect.gen(function* () {
        const roomWorld = inRoom(row.from, row.action)
        expect(ruleFieldsOf(roomWorld)).not.toEqual(ruleFieldsOf(row.from))
        const played = yield* inSinglePlayer(row.from, row.presses)
        expect(ruleFieldsOf(played)).toEqual(ruleFieldsOf(roomWorld))
      }),
  )
})
