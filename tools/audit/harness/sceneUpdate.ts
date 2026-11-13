// NOTE: what the harness adds to the game's update: what a scene keeps after
// every update (`god`, `gasroom`), the Message log, and the scene's first
// Model with the Profile, a hold, or a melee set up. Freezing, `tick`, and
// the other scene settings that change what reaches update are handler
// Layers in entry.ts.

import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Melee, type Model, type Zombie } from '@game/app/model'
import { withInput } from '@game/app/update/step'
import { markLooksSeen } from '@game/domain/unlocks'
import type { ProfileTab } from '@game/features/profile/model'
import { pressHoldButton, pressKey, releaseAll } from '@game/input/input'
import { MouseButton } from '@game/input/inputSchema'
import { PLAYER_MAX_HP } from '@game/shared/constants'
import { freshGun } from '@game/world/gear/weapons'
import { modifyFocus } from '@game/world/party/party'

import { CALM, ROAMING } from './room'
import type { SceneSettings } from './settings'

// NOTE: `hold` holds the interact key (on touch, a finger on the hold
// button) from the first frame, so `tick=N` shows the ring N frames in.
const HOLD_POINTER_ID = 99
const STAB_POINTER_ID = 98

// NOTE: `gasroom=N` keeps N Kaboomers in the room: when shots and chain bursts
// pop them, new ones walk in at the doors, so a measurement window stays full
// of fusing, bursting, and spawning Kaboomers.
const GASBAG_DOORS: ReadonlyArray<readonly [number, number]> = [
  [160, 8],
  [312, 90],
  [160, 172],
  [8, 90],
]
const topUpGasbags = (gasbagRoom: number, model: Model): Model => {
  const alive = Array.filter(
    model.zombies,
    z => z.kind === 'Exploder' && z.state._tag === 'Walking',
  ).length
  const missing = Math.max(0, Math.min(4, gasbagRoom - alive))
  if (missing === 0 || model.phase._tag !== 'Wave') {
    return model
  }
  const fresh = globalThis.Array.from({ length: missing }, (_, i): Zombie => {
    const [x, y] = GASBAG_DOORS[
      (model.nextEntityId + i) % GASBAG_DOORS.length
    ] ?? [0, 0]
    return {
      id: model.nextEntityId + i,
      kind: 'Exploder',
      x,
      y,
      speed: 22,
      hp: 3,
      maxHp: 3,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: 0,
      state: { _tag: 'Walking' },
      action: ROAMING,
      frenzy: CALM,
    }
  })
  return modifyFields(model, {
    zombies: zombies => [...zombies, ...fresh],
    nextEntityId: id => id + missing,
  })
}

// NOTE: any dispatch's tag, a child's envelope included.
type TaggedMessage = Readonly<{ _tag: string }>

const QUIET_MESSAGES = new Set([
  'TickedFrame',
  'MovedPointer',
  'MovedMouse',
  'CompletedPlaySound',
  'CompletedCueMusic',
  'FailedCueMusic',
  'FailedPlaySound',
])

// NOTE: what the harness adds after every update: full health with `god`,
// and fresh Kaboomers at the doors with `gasroom`. Every dispatch reaches it,
// a child's envelope too, so it reads only the tag.
export const keepScene: {
  (model: Model, message: TaggedMessage): (settings: SceneSettings) => Model
  (settings: SceneSettings, model: Model, message: TaggedMessage): Model
} = Function.dual(
  3,
  (settings: SceneSettings, model: Model, message: TaggedMessage): Model => {
    const { god, gasbagRoom } = settings
    const kept = god
      ? modifyFocus(model, { player: p => ({ ...p, hp: PLAYER_MAX_HP }) })
      : model
    return gasbagRoom > 0 && message._tag === 'TickedFrame'
      ? topUpGasbags(gasbagRoom, kept)
      : kept
  },
)

// NOTE: every Message the runtime dispatches, its children's envelopes
// included, as `Tag:ChildTag` chains, for the tap and close audits. The
// runtime reports each update through its `slow` hook, with a budget no
// update can beat.
export const logMessage = (incoming: unknown) => {
  const chain = (message: unknown): Array<string> =>
    typeof message === 'object' &&
    message !== null &&
    '_tag' in message &&
    typeof message._tag === 'string'
      ? [message._tag, ...('message' in message ? chain(message.message) : [])]
      : []
  const tags = chain(incoming)
  if (tags[0] !== undefined && !QUIET_MESSAGES.has(tags[0])) {
    window.__messages.push(Array.join(tags, ':'))
  }
}

// NOTE: the Profile's state open on a tab, as openProfile
// (src/app/update/profile.ts) and the Profile's RequestedOpen set it,
// without its menu check: the tab and the name draft, the input let go. The Dialog's own open is its Binding's
// operation, which the scene's init runs (entry.ts).
const preparedProfile = (model: Model, tab: ProfileTab): Model =>
  withInput(
    modifyFields(tab === 'Look' ? markLooksSeen(model) : model, {
      profile: profile =>
        modifyFields(profile, {
          tutorialReset: () => 'Idle',
          tab: () => tab,
          fx: () => 'Still',
          nameDraft: () => model.playerName,
        }),
    }),
    releaseAll,
  )

// NOTE: a scene's first Model, and whether its init opens the Profile.
export type Scene = Readonly<{ model: Model; isProfileOpen: boolean }>

const profileTabOf = (settings: SceneSettings): Option.Option<ProfileTab> => {
  const { config } = settings
  const profileTab = config.profile
  if (!config.picker && profileTab === undefined) {
    return Option.none()
  }
  return Option.some(
    profileTab === 'name'
      ? 'Name'
      : profileTab === 'account'
        ? 'Account'
        : profileTab === 'settings'
          ? 'Settings'
          : profileTab === 'mastery'
            ? 'Mastery'
            : 'Look',
  )
}

// NOTE: the scene's Model from the current config: seeded when it is frozen
// or given a seed, with the Profile readied by `picker` or `profile`. The
// `tick` frames it plays ahead come through the frame Subscription
// (entry.ts), so the Commands they give run as they would frame by frame.
export const sceneOf: {
  (model: Model): (settings: SceneSettings) => Scene
  (settings: SceneSettings, model: Model): Scene
} = Function.dual(2, (settings: SceneSettings, model: Model): Scene => {
  const { config, freezeAfter } = settings
  const seeded =
    config.seed !== undefined || Number.isFinite(freezeAfter)
      ? modifyFields(model, { rngState: () => config.seed ?? 1 })
      : model
  const maybeProfileTab = profileTabOf(settings)
  const opened = Option.match(maybeProfileTab, {
    onNone: () => seeded,
    onSome: tab =>
      preparedProfile(modifyFields(seeded, { screenMs: () => 99999 }), tab),
  })
  const lookSection = config.looksection
  const sectioned =
    lookSection === undefined
      ? opened
      : modifyFields(opened, {
          profile: profile =>
            modifyFields(profile, {
              character: picker =>
                modifyFields(picker, { section: () => lookSection }),
            }),
        })
  const holding = config.hold
    ? modifyFields(sectioned, {
        input: input =>
          sectioned.lastDevice === 'Touch'
            ? pressHoldButton(input, HOLD_POINTER_ID)
            : pressKey(input, 'Enter'),
      })
    : sectioned
  const panned = config.pan
    ? modifyFocus(holding, {
        player: player =>
          modifyFields(player, {
            melee: () =>
              Melee.Pan({ pan: { ...freshGun('Pan'), tier: config.tier } }),
          }),
      })
    : holding
  const knifed =
    config.knife || config.stab
      ? modifyFocus(panned, {
          player: player => modifyFields(player, { wield: () => 'Melee' }),
        })
      : panned
  const held = config.stab
    ? modifyFields(knifed, {
        input: input =>
          modifyFields(input, {
            mouseButton: () => MouseButton.Held({ pointerId: STAB_POINTER_ID }),
          }),
      })
    : knifed
  return { model: held, isProfileOpen: Option.isSome(maybeProfileTab) }
})
