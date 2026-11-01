// NOTE: the harness's update around the game's: what a scene keeps after
// every update (`god`, `gasroom`), freezing and `tick`, the Message log,
// and the scene's first Model with the Profile, a hold, or a melee set up.

import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'

import { DialogBlock } from '@foldkit/ui'
import { ProfileDialogBinding } from '@game/bindings'
import { PLAYER_MAX_HP } from '@game/constants'
import { pressHoldButton, pressKey, releaseAll } from '@game/input'
import { update } from '@game/main'
import { Message } from '@game/message'
import {
  Melee,
  type Model,
  MouseButton,
  type ProfileTab,
  type Zombie,
} from '@game/model'
import { stepWhen } from '@game/stepWhen'
import { withInput } from '@game/update/step'
import { markLooksSeen } from '@game/update/unlocks'
import { RUNNING_BUILD } from '@game/version'
import { freshGun, mapGuns } from '@game/weapons'

import type * as Director from './director'
import { CALM, ROAMING } from './room'
import { type HarnessPage, type SceneSettings } from './settings'

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
  const alive = model.zombies.filter(
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

const FIXED_FRAME_MS = 1000 / 60

const QUIET_MESSAGES = new Set([
  'TickedFrame',
  'MovedPointer',
  'MovedMouse',
  'CompletedPlaySound',
  'CompletedCueMusic',
  'FailedCueMusic',
  'FailedPlaySound',
])

export type HarnessReturn = Director.Return

// NOTE: what the harness adds after every update: full health with `god`,
// and fresh Kaboomers at the doors with `gasroom`.
export const keepScene = (
  settings: SceneSettings,
  result: HarnessReturn,
  message: Message,
): HarnessReturn => {
  const { god, gasbagRoom } = settings
  const kept = god
    ? {
        ...result,
        model: modifyFields(result.model, {
          player: p => ({ ...p, hp: PLAYER_MAX_HP }),
        }),
      }
    : result
  return gasbagRoom > 0 && message._tag === 'TickedFrame'
    ? { ...kept, model: topUpGasbags(gasbagRoom, kept.model) }
    : kept
}

// NOTE: `tick=N` plays N frames of a fixed 1/60 second at once, before the
// first render, and holds the picture there. The game is deterministic, so
// this is the picture `freeze=N` waits N real frames for, with no waiting.
// The Commands those frames give, such as opening the shop's dialog, run
// once the scene is in, as they would have frame by frame.
const advance = (
  settings: SceneSettings,
  scene: HarnessReturn,
  frames: number,
): HarnessReturn => {
  let current = scene.model
  const commands = [...(scene.commands ?? [])]
  for (let frame = 0; frame < frames; frame++) {
    const message = Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
    const next = keepScene(settings, update(current, message), message)
    current = next.model
    commands.push(...(next.commands ?? []))
  }
  return { model: current, commands }
}

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
    window.__messages.push(tags.join(':'))
  }
}

export const gameUpdate = (
  page: HarnessPage,
  model: Model,
  incoming: Message,
): HarnessReturn => {
  const { settings } = page
  const { config, freezeAfter, instrument } = settings
  const isFrozenFrame =
    incoming._tag === 'TickedFrame' && page.framesRun >= freezeAfter
  const isFreezing = Number.isFinite(freezeAfter)
  if (isFrozenFrame) {
    return { model }
  }
  // NOTE: a director shot steps the co-op room itself, on the shot's clock.
  if (config.director && incoming._tag === 'TickedRoomFrame') {
    return { model }
  }
  if (isFreezing && incoming._tag === 'CompletedGenerateSeed') {
    return { model }
  }
  // NOTE: a frozen run starts counting frames once the surface is measured,
  // so how long the first render takes cannot change which frame the
  // measurement lands on, and two builds freeze on the same picture.
  if (
    isFreezing &&
    incoming._tag === 'TickedFrame' &&
    Option.isNone(model.maybeSurface)
  ) {
    return { model }
  }
  if (
    config.fit !== undefined &&
    incoming._tag === 'CompletedDetectScreenFit'
  ) {
    return {
      model: modifyFields(model, {
        screenFit: () => (config.fit === 'home' ? 'HomeScreen' : 'Fullscreen'),
      }),
    }
  }
  if (
    config.sync !== undefined &&
    (incoming._tag === 'UpdatedSyncStatus' ||
      incoming._tag === 'UpdatedPlayerScopeStatus')
  ) {
    return { model }
  }
  if (config.rotate && incoming._tag === 'CompletedDetectOrientationLock') {
    return {
      model: modifyFields(model, { orientationLock: () => 'Supported' }),
    }
  }
  // NOTE: `install` keeps Chrome's offer on, and `greet` reads as the page
  // just reloaded onto this build. The gift never reloads the harness: it
  // stays mid-unwrap, as `unwrap` shows it.
  if (config.install && incoming._tag === 'ChangedInstallOffer') {
    return { model }
  }
  if (incoming._tag === 'CompletedWaitForUnwrap') {
    return { model }
  }
  const message =
    incoming._tag === 'TickedFrame' && isFreezing
      ? Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
      : config.greet && incoming._tag === 'CompletedReadUpdateMarker'
        ? Message.CompletedReadUpdateMarker({
            maybeBuild: Option.some(RUNNING_BUILD),
          })
        : incoming
  if (message._tag === 'TickedFrame') {
    page.framesRun++
  }
  window.__isFrozen = page.framesRun >= freezeAfter
  const t0 = performance.now()
  const result = update(model, message)
  if (instrument && message._tag === 'TickedFrame') {
    window.__timings.update.push(performance.now() - t0)
  }
  const next = keepScene(settings, result, message)
  window.__model = next.model
  return next
}

// NOTE: the Profile open on a tab, as openProfile (src/update/profile.ts)
// opens it, without its menu check: the tab and the name draft, the input
// let go, then the Dialog's own open through its Binding.
const openProfileOn = (model: Model, tab: ProfileTab): HarnessReturn =>
  update(
    withInput(
      modifyFields(tab === 'Look' ? markLooksSeen(model) : model, {
        tutorialReset: () => 'Idle',
        profile: profile =>
          modifyFields(profile, {
            tab: () => tab,
            fx: () => 'Still',
            nameDraft: () => model.playerName,
          }),
      }),
      releaseAll,
    ),
    toParentMessage(ProfileDialogBinding, DialogBlock.Message.RequestedOpen()),
  )

// NOTE: the scene's Model from the current config: seeded when it is frozen
// or given a seed, with the Profile opened by `picker` or `profile`, and played
// `tick` frames ahead.
export const sceneOf = (
  settings: SceneSettings,
  model: Model,
): HarnessReturn => {
  const { config, freezeAfter } = settings
  const seeded =
    config.seed !== undefined || Number.isFinite(freezeAfter)
      ? modifyFields(model, { rngState: () => config.seed ?? 1 })
      : model
  const profileTab = config.profile
  const opened: HarnessReturn = stepWhen(
    (_: Model) => config.picker || profileTab !== undefined,
    current =>
      openProfileOn(
        modifyFields(current, { screenMs: () => 99999 }),
        profileTab === 'name'
          ? 'Name'
          : profileTab === 'account'
            ? 'Account'
            : profileTab === 'settings'
              ? 'Settings'
              : 'Look',
      ),
  )(seeded)
  const lookSection = config.looksection
  const sectioned: HarnessReturn =
    lookSection === undefined
      ? opened
      : {
          ...opened,
          model: modifyFields(opened.model, {
            character: picker =>
              modifyFields(picker, { section: () => lookSection }),
          }),
        }
  const holding: HarnessReturn = config.hold
    ? {
        ...sectioned,
        model: modifyFields(sectioned.model, {
          input: input =>
            sectioned.model.lastDevice === 'Touch'
              ? pressHoldButton(input, HOLD_POINTER_ID)
              : pressKey(input, 'Enter'),
        }),
      }
    : sectioned
  const panned: HarnessReturn = config.pan
    ? {
        ...holding,
        model: modifyFields(holding.model, {
          player: player =>
            modifyFields(player, {
              melee: () =>
                Melee.Pan({ pan: { ...freshGun('Pan'), tier: config.tier } }),
            }),
        }),
      }
    : holding
  const knifed: HarnessReturn =
    config.knife || config.stab
      ? {
          ...panned,
          model: modifyFields(panned.model, {
            player: player => modifyFields(player, { wield: () => 'Melee' }),
          }),
        }
      : panned
  const held: HarnessReturn = config.stab
    ? {
        ...knifed,
        model: modifyFields(knifed.model, {
          input: input =>
            modifyFields(input, {
              mouseButton: () =>
                MouseButton.Held({ pointerId: STAB_POINTER_ID }),
            }),
        }),
      }
    : knifed
  const dried: HarnessReturn = config.dry
    ? {
        ...held,
        model: modifyFields(held.model, {
          player: player =>
            modifyFields(player, {
              arsenal: arsenal =>
                mapGuns(arsenal, gun =>
                  modifyFields(gun, { rounds: () => 0, loaded: () => 0 }),
                ),
            }),
        }),
      }
    : held
  return config.tick === undefined
    ? dried
    : advance(settings, dried, config.tick)
}
