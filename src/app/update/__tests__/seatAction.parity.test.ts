import { Array, Effect, Option, Order, Struct } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { DialogBlock } from '@foldkit/ui'

import { DialogBinding } from '../../../features/shop/bindings'
import { withShopDialogOpen } from '../../../test/model.fixture'
import {
  DISTANT_SPAWN,
  crewInWave,
  quietWave,
  readyModel,
  withArsenal,
  withSeatLife,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_NORTH_DOOR,
  type RootSteps,
  SHOTGUN,
  WORLD_KEYS,
  buyAtCounter,
  closeDialog,
  holdingFirst,
  withPistol,
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
import { ShopDialogBinding } from '../../bindings'
import { Message } from '../../message'
import { BreakClock, Life, type Model, Phase, ShopState } from '../../model'

// One rule set for player actions (AGENTS.md "Code shape"): every seat
// action, pressed through single player's own Messages, leaves the World
// exactly as the co-op room's seat action does from the same World. The
// room's side reads the press back from its wire code, as a room does. The
// table is keyed by the SeatAction union's tags, so a new action without a
// row fails to typecheck, and the first test fails too.

// NOTE: World fields that are single player's cues around an action, not
// its rule: the intent is read again from the input after a press, and
// the lessons and the new zombie card are the tutorial's.
const CUE_KEYS: ReadonlySet<keyof World> = new Set(['lessons', 'debutCard'])

const RULE_KEYS = Array.filter(WORLD_KEYS, key => !CUE_KEYS.has(key))

// NOTE: every seat's intent is a cue too.
const ruleFieldsOf = (world: World) => ({
  ...Struct.pick(world, RULE_KEYS),
  seats: Array.map(world.seats, state =>
    modifyFields(state, { intent: () => idleIntent }),
  ),
})

// NOTE: a row's presses are the Story steps single player takes, as one
// group: the root's own Messages, or a child's by its Binding, with the
// Commands they leave resolved.
type Row = Readonly<{
  from: Model
  action: SeatAction
  presses: RootSteps
}>

const inWave = quietWave(3)

const withKnifeOut = (base: Model): Model =>
  modifyFocus(base, {
    player: player => modifyFields(player, { wield: () => 'Melee' }),
  })

// NOTE: by the north door, where a Plank Pile goes.
const withTraps = (base: Model, barricades: number, turrets: number): Model =>
  modifyFocus(base, {
    trapStock: () => ({ Barricade: barricades, Turret: turrets }),
    selectedTrap: () => 'Barricade',
    player: player =>
      modifyFields(player, {
        x: () => BELOW_NORTH_DOOR.x,
        y: () => BELOW_NORTH_DOOR.y,
      }),
  })

const inBreak = modifyFocus(
  modifyFields(readyModel, {
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: 20_000,
        durationMs: 20_000,
        clock: BreakClock.Counting(),
        spawns: [DISTANT_SPAWN],
      }),
  }),
  { wallet: () => ({ balance: 500, earned: 500, shown: 500 }) },
)

// NOTE: at the counter with the dialog up and a heart down. Rattles' focus
// stays on the Laser Sight's row, so a buy moves no focus.
const atCounter = modifyFocus(withShopDialogOpen(inBreak), {
  shop: () => ShopState.Browsing({ focusedItem: 'LaserSight' }),
  player: player => modifyFields(player, { hp: hp => hp - 1 }),
})

// NOTE: a crew in a fight with the lead down, their last shout cooled.
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
    presses: Story.steps(Story.message(Message.ClickedSwapButton())),
  },
  Melee: {
    from: inWave,
    action: SeatAction.Melee(),
    presses: Story.steps(Story.message(Message.ClickedMeleeSlot())),
  },
  Draw: {
    from: withKnifeOut(withArsenal(inWave, holdingFirst(SHOTGUN))),
    action: SeatAction.Draw({ slot: 'Second' }),
    presses: Story.steps(
      Story.message(Message.ClickedGunSlot({ slot: 'Second' })),
    ),
  },
  Reload: {
    from: withKnifeOut(
      modifyFocus(inWave, {
        player: player =>
          withPistol(player, pistol =>
            modifyFields(pistol, { loaded: () => 2 }),
          ),
      }),
    ),
    action: SeatAction.Reload(),
    presses: Story.steps(Story.message(Message.ClickedReloadButton())),
  },
  PlaceTrap: {
    from: withTraps(inBreak, 1, 0),
    action: SeatAction.PlaceTrap(),
    presses: Story.steps(Story.message(Message.ClickedPlaceTrapButton())),
  },
  NextTrap: {
    from: withTraps(inWave, 1, 1),
    action: SeatAction.NextTrap(),
    presses: Story.steps(Story.message(Message.ClickedNextTrapButton())),
  },
  Buy: {
    from: atCounter,
    action: SeatAction.Buy({ item: 'Heart' }),
    presses: Story.steps(buyAtCounter('Heart')),
  },
  // NOTE: the shop dialog closed: its close, then the Command's result.
  LeaveCounter: {
    from: atCounter,
    action: SeatAction.LeaveCounter(),
    presses: Story.steps(
      Story.messageIn(
        [ShopDialogBinding, DialogBinding],
        DialogBlock.Message.CanceledDialog(),
      ),
      closeDialog(),
    ),
  },
  Ready: {
    from: inBreak,
    action: SeatAction.Ready(),
    presses: Story.steps(Story.message(Message.ClickedStartWaveButton())),
  },
  CallMedic: {
    from: downedLead,
    action: SeatAction.CallMedic(),
    presses: Story.steps(Story.message(Message.ClickedMedicButton())),
  },
}

const TAGS = Struct.keys(ROWS)

// NOTE: single player's side: its presses through the root's update.
const inSinglePlayer = (from: Model, presses: RootSteps) =>
  Story.story(APPLICATION, Story.given(from), presses)

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
})
