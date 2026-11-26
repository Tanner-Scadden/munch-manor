import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { Melee, type Model, type Zombie } from '@game/app/model'
import { RootDialog } from '@game/app/rootDialog'
import { withInput } from '@game/app/update/step'
import { markLooksSeen } from '@game/domain/unlocks'
import type { ProfileTab } from '@game/features/profile/model'
import { TutorialReset } from '@game/features/profile/resetFlow'
import { pressHoldButton, pressKey, releaseAll } from '@game/input/input'
import { MouseButton } from '@game/input/inputSchema'
import { PLAYER_MAX_HP } from '@game/shared/constants'
import { freshGun } from '@game/world/gear/weapons'
import { modifyFocus } from '@game/world/party/party'

import { CALM, ROAMING } from './room'
import type { SceneSettings } from './settings'

const HOLD_POINTER_ID = 99
const STAB_POINTER_ID = 98

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
  return UiStruct.evolve(model, {
    zombies: zombies => [...zombies, ...fresh],
    nextEntityId: id => id + missing,
  })
}

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

const preparedProfile = (model: Model, tab: ProfileTab): Model =>
  withInput(
    UiStruct.evolve(tab === 'Look' ? markLooksSeen(model) : model, {
      profile: profile =>
        UiStruct.evolve(profile, {
          tutorialReset: () => TutorialReset.Idle,
          tab: () => tab,
          fx: () => 'Still',
          nameDraft: () => model.playerName,
        }),
      rootDialog: () => RootDialog.Profile,
    }),
    releaseAll,
  )

export type Scene = Readonly<{
  model: Model
  maybeLookSection: Option.Option<string>
}>

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

export const sceneOf: {
  (model: Model): (settings: SceneSettings) => Scene
  (settings: SceneSettings, model: Model): Scene
} = Function.dual(2, (settings: SceneSettings, model: Model): Scene => {
  const { config, freezeAfter } = settings
  const seeded =
    config.seed !== undefined || Number.isFinite(freezeAfter)
      ? UiStruct.evolve(model, { rngState: () => config.seed ?? 1 })
      : model
  const maybeProfileTab = profileTabOf(settings)
  const opened = Option.match(maybeProfileTab, {
    onNone: () => seeded,
    onSome: tab =>
      preparedProfile(UiStruct.evolve(seeded, { screenMs: () => 99999 }), tab),
  })
  const holding = config.hold
    ? UiStruct.evolve(opened, {
        input: input =>
          opened.lastDevice === 'Touch'
            ? pressHoldButton(input, HOLD_POINTER_ID)
            : pressKey(input, 'Enter'),
      })
    : opened
  const panned = config.pan
    ? modifyFocus(holding, {
        player: player =>
          UiStruct.evolve(player, {
            melee: () =>
              Melee.Pan({ pan: { ...freshGun('Pan'), tier: config.tier } }),
          }),
      })
    : holding
  const knifed =
    config.knife || config.stab
      ? modifyFocus(panned, {
          player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
        })
      : panned
  const held = config.stab
    ? UiStruct.evolve(knifed, {
        input: input =>
          UiStruct.evolve(input, {
            mouseButton: () => MouseButton.Held({ pointerId: STAB_POINTER_ID }),
          }),
      })
    : knifed
  return {
    model: held,
    maybeLookSection: Option.fromUndefinedOr(config.looksection),
  }
})
