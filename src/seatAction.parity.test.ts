import { Array, Option, Order, Struct } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { DialogBlock } from '@foldkit/ui'

import { ShopDialogBinding } from './bindings'
import { update } from './main'
import { Message } from './message'
import { BreakClock, type Model, Phase, ShopState } from './model'
import {
  DISTANT_SPAWN,
  midWaveAtStall,
  quietWave,
  readyModel,
  withArsenal,
} from './model.fixture'
import { leadSeatOf } from './party'
import { actionCodeOf, heldAction, seatActionOf } from './roomWorld'
import { SeatAction, applySeatAction } from './stepWorld'
import {
  BELOW_NORTH_DOOR,
  SHOTGUN,
  WORLD_KEYS,
  holdingFirst,
  withPistol,
} from './testing'
import type { World } from './world'

// One rule set for player actions (AGENTS.md "Code shape"): every seat
// action, pressed through single player's own Messages, leaves the World
// exactly as the co-op room's seat action does from the same World. The
// room's side reads the press back from its wire code, as a room does. The
// table is keyed by the SeatAction union's tags, so a new action without a
// row fails to typecheck, and the first test fails too.

// NOTE: World fields that are single player's cues around an action, not
// its rule: the intent is read again from the input after a press, and
// the lessons and the new zombie card are the tutorial's.
const CUE_KEYS: ReadonlySet<keyof World> = new Set([
  'intent',
  'lessons',
  'debutCard',
])

const RULE_KEYS = Array.filter(WORLD_KEYS, key => !CUE_KEYS.has(key))

const ruleFieldsOf = (world: World) => Struct.pick(world, RULE_KEYS)

// NOTE: a Message the root's update takes, its children's included.
type RootMessage = Parameters<typeof update>[1]

type Row = Readonly<{
  from: Model
  action: SeatAction
  presses: ReadonlyArray<RootMessage>
}>

const inWave = quietWave(3)

const withKnifeOut = (base: Model): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { wield: () => 'Melee' }),
  })

// NOTE: by the north door, where a Plank Pile goes.
const withTraps = (base: Model, barricades: number, turrets: number): Model =>
  modifyFields(base, {
    trapStock: () => ({ Barricade: barricades, Turret: turrets }),
    selectedTrap: () => 'Barricade',
    player: player =>
      modifyFields(player, {
        x: () => BELOW_NORTH_DOOR.x,
        y: () => BELOW_NORTH_DOOR.y,
      }),
  })

const inBreak = modifyFields(readyModel, {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: 20_000,
      durationMs: 20_000,
      clock: BreakClock.Counting(),
      spawns: [DISTANT_SPAWN],
    }),
  wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
})

// NOTE: at the counter with the dialog up and a heart down. Rattles' focus
// stays on the Shotgun row, so a buy moves no focus.
const atCounter = modifyFields(inBreak, {
  shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
  shopDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
  player: player => modifyFields(player, { hp: hp => hp - 1 }),
})

const ROWS: { readonly [Tag in SeatAction['_tag']]: Row } = {
  Swap: {
    from: withArsenal(inWave, holdingFirst(SHOTGUN)),
    action: SeatAction.Swap(),
    presses: [Message.ClickedSwapButton()],
  },
  Melee: {
    from: inWave,
    action: SeatAction.Melee(),
    presses: [Message.ClickedMeleeSlot()],
  },
  Draw: {
    from: withKnifeOut(withArsenal(inWave, holdingFirst(SHOTGUN))),
    action: SeatAction.Draw({ slot: 'Second' }),
    presses: [Message.ClickedGunSlot({ slot: 'Second' })],
  },
  Reload: {
    from: withKnifeOut(
      modifyFields(inWave, {
        player: player =>
          withPistol(player, pistol =>
            modifyFields(pistol, { loaded: () => 2 }),
          ),
      }),
    ),
    action: SeatAction.Reload(),
    presses: [Message.ClickedReloadButton()],
  },
  PlaceTrap: {
    from: withTraps(inBreak, 1, 0),
    action: SeatAction.PlaceTrap(),
    presses: [Message.ClickedPlaceTrapButton()],
  },
  NextTrap: {
    from: withTraps(inWave, 1, 1),
    action: SeatAction.NextTrap(),
    presses: [Message.ClickedNextTrapButton()],
  },
  Buy: {
    from: atCounter,
    action: SeatAction.Buy({ item: 'Heart' }),
    presses: [Message.ClickedBuyButton({ item: 'Heart' })],
  },
  // NOTE: the shop dialog closed: its close, then the Command's result.
  LeaveCounter: {
    from: atCounter,
    action: SeatAction.LeaveCounter(),
    presses: [
      toParentMessage(ShopDialogBinding, DialogBlock.Message.RequestedClose()),
      toParentMessage(
        ShopDialogBinding,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
    ],
  },
  Ready: {
    from: inBreak,
    action: SeatAction.Ready(),
    presses: [Message.ClickedStartWaveButton()],
  },
  BuyAmmo: {
    from: midWaveAtStall('Smg', 10),
    action: SeatAction.BuyAmmo(),
    presses: [Message.ClickedAmmoTag()],
  },
}

const TAGS = Struct.keys(ROWS)

// NOTE: single player's side: its Messages through the root's update.
const inSinglePlayer = (
  from: Model,
  presses: ReadonlyArray<RootMessage>,
): Model =>
  Array.reduce(presses, from, (current, press) => update(current, press).model)

// NOTE: the room's side: the press read back from its wire code, on the
// seat that pressed it.
const inRoom = (world: World, action: SeatAction): World => {
  const read = Option.getOrThrow(
    seatActionOf(world, heldAction(actionCodeOf(action), 1)),
  )
  return applySeatAction(world, leadSeatOf(world).slot, read)
}

describe('one rule set for player actions', () => {
  test('every seat action has a parity row', () => {
    expect(Array.sort(TAGS, Order.String)).toEqual(
      Array.sort(
        Array.map(
          SeatAction.members,
          member => member.fields._tag.schema.literal,
        ),
        Order.String,
      ),
    )
  })

  test.each(TAGS)('%s through single player matches the room', tag => {
    const { from, action, presses } = ROWS[tag]
    const roomWorld = inRoom(from, action)
    expect(
      ruleFieldsOf(roomWorld),
      'the row starts where the action does something',
    ).not.toEqual(ruleFieldsOf(from))
    expect(ruleFieldsOf(inSinglePlayer(from, presses))).toEqual(
      ruleFieldsOf(roomWorld),
    )
  })
})
