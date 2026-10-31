import { Array, Effect, Option, Schema, pipe } from 'effect'
import type { ManagedResource } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { isTickingShot } from '../ammoWarning'
import {
  type AudioEngine,
  type AudioEngineError,
  type PlayOutcome,
  SoundEffect,
  acquireAudioEngine,
  playSound,
  positionVariation,
  releaseAudioEngine,
  resumeAudio,
} from '../audio'
import { makeCommand, makeManagedResources, makeResource } from '../definition'
import { maybeLandedBetween, prizeSpotOf, revealOf } from '../fridgeReveal'
import { Message } from '../message'
import { AudioState, GameEvent, type Model, type Player } from '../model'
import { PICKUPS } from '../powerups'
import { TRAPS } from '../traps'
import { WEAPONS, heldWeapon } from '../weapons'
import { ZOMBIE_KINDS, isArmorShedAt } from '../zombies'
import type { UpdateStep } from './step'

// AUDIO

export const AudioEngineResource = makeResource<AudioEngine>()('AudioEngine')

const wantsAudioEngine = (audio: AudioState): boolean =>
  AudioState.match(audio, {
    Locked: () => false,
    Unlocking: () => true,
    Suspended: () => true,
    Ready: () => true,
    Unavailable: () => false,
  })

export const managedResources = makeManagedResources(entry => ({
  audioEngine: entry('ManageAudioEngine', Schema.Option(Schema.Null), {
    resource: AudioEngineResource,
    modelToMaybeRequirements: model =>
      wantsAudioEngine(model.audio) ? Option.some(null) : Option.none(),
    onAcquired: () => Message.AcquiredAudioEngine(),
    onAcquireError: error =>
      Message.FailedAcquireAudioEngine({ reason: String(error) }),
    onReleased: () => Message.ReleasedAudioEngine(),
    handler: function* () {
      return {
        acquire: () => acquireAudioEngine,
        release: releaseAudioEngine,
      }
    },
  }),
}))

export const audioFailureReason = (
  error: AudioEngineError | ManagedResource.ResourceNotAvailable,
): string =>
  error._tag === 'AudioEngineError'
    ? error.reason
    : `${error.resource} is not acquired`

export const ResumeAudio = makeCommand('ResumeAudio', {
  messages: [Message.CompletedResumeAudio, Message.FailedResumeAudio],
  handler: function* () {
    return () =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(resumeAudio),
        Effect.map(playback => Message.CompletedResumeAudio({ playback })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedResumeAudio({ reason: audioFailureReason(error) }),
          ),
        ),
      )
  },
})

export const PlaySound = makeCommand('PlaySound', {
  args: { sound: SoundEffect, variation: Schema.Number },
  messages: [Message.CompletedPlaySound, Message.FailedPlaySound],
  handler: function* () {
    return ({ sound, variation }) =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(engine => playSound(engine, sound, variation)),
        Effect.map(outcome => Message.CompletedPlaySound({ sound, outcome })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedPlaySound({
              sound,
              reason: audioFailureReason(error),
            }),
          ),
        ),
      )
  },
})

const MUTE_KEY = 'KeyM'
const MUSIC_KEY = 'KeyN'

export const isSoundAudible = (model: Model): boolean =>
  AudioState.isAnyOf(['Ready'])(model.audio) && model.soundSetting === 'On'

export type SoundCue = Readonly<{ sound: SoundEffect; variation: number }>

const maybeEventSound = (event: GameEvent): Option.Option<SoundEffect> =>
  GameEvent.match(event, {
    Fired: ({ weapon }) => Option.some(WEAPONS[weapon].sound),
    ZombieHit: ({ kind }) => Option.some(ZOMBIE_KINDS[kind].hitSound),
    ZombieKilled: ({ kind }) => Option.some(ZOMBIE_KINDS[kind].deathSound),
    Exploded: () => Option.some<SoundEffect>('Boom'),
    Footfall: ({ kind, nearness }) =>
      nearness > 0
        ? Option.flatMap(
            ZOMBIE_KINDS[kind].maybeFootfall,
            ({ maybeSound }) => maybeSound,
          )
        : Option.none<SoundEffect>(),
    PlayerHurt: () => Option.some<SoundEffect>('PlayerHurt'),
    BulletStruck: () => Option.none<SoundEffect>(),
    RanDry: () => Option.some<SoundEffect>('DryClick'),
    DryFired: () => Option.some<SoundEffect>('DryClick'),
    ReloadStarted: () => Option.some<SoundEffect>('MagOut'),
    Reloaded: () => Option.some<SoundEffect>('MagIn'),
    WaveCleared: () => Option.some<SoundEffect>('Payday'),
    PackWarned: ({ formation }) =>
      Option.some<SoundEffect>(formation === 'Horde' ? 'DinnerBell' : 'Groan'),
    TrapHit: () => Option.none<SoundEffect>(),
    TrapCracked: ({ kind }) => Option.some(TRAPS[kind].crackSound),
    TrapBroken: ({ kind }) => Option.some(TRAPS[kind].breakSound),
    PickupDropped: () => Option.some<SoundEffect>('LootPop'),
    PickupGrabbed: ({ kind }) => Option.some(PICKUPS[kind].sound),
    PickupFizzled: () => Option.none<SoundEffect>(),
    BoostFaded: () => Option.some<SoundEffect>('PowerDown'),
    Burped: () => Option.none<SoundEffect>(),
    PartShed: ({ kind, stage }) =>
      Option.some<SoundEffect>(
        isArmorShedAt(kind, stage) ? 'Clang' : 'LimbPop',
      ),
    BossRoared: () => Option.some<SoundEffect>('BossRoar'),
    BossWoundUp: ({ attack }) =>
      Option.some<SoundEffect>(
        attack === 'Charge' ? 'BossChargeUp' : 'BossWindUp',
      ),
    BossStomped: () => Option.some<SoundEffect>('BossStomp'),
    BossBelched: () => Option.some<SoundEffect>('BossBelch'),
    BossRushed: () => Option.some<SoundEffect>('BossRush'),
    BossRammed: () => Option.none<SoundEffect>(),
    BossBonked: () => Option.some<SoundEffect>('BossBonk'),
    BossSpat: () => Option.some<SoundEffect>('BossSpit'),
    GlobLanded: () => Option.some<SoundEffect>('BossSplat'),
    BossEnraged: () => Option.some<SoundEffect>('BossRoar'),
    ZombieGrabbed: () => Option.some<SoundEffect>('Heave'),
    ShieldRaised: () => Option.some<SoundEffect>('Yank'),
    ZombieThrown: () => Option.some<SoundEffect>('Whoosh'),
    ZombieLanded: () => Option.some<SoundEffect>('Thud'),
    CrawlerStirred: () => Option.some<SoundEffect>('Rumble'),
    CrawlerSurfaced: () => Option.some<SoundEffect>('Burrow'),
    AnklesGrabbed: () => Option.some<SoundEffect>('Clutch'),
    PackFrenzied: () => Option.some<SoundEffect>('Howl'),
    PackWiped: () => Option.some<SoundEffect>('PackBonus'),
    OvenBelched: () => Option.some<SoundEffect>('BossBelch'),
    Purchased: () => Option.some<SoundEffect>('Purchase'),
    PurchaseRefused: () => Option.some<SoundEffect>('Denied'),
    ExitOpened: () => Option.some<SoundEffect>('Crash'),
    FridgeOpened: () => Option.some<SoundEffect>('FridgeSpin'),
    FridgeSlammed: () => Option.some<SoundEffect>('Rumble'),
    PrizeTaken: () => Option.some<SoundEffect>('Swap'),
    PrizeLeft: () => Option.some<SoundEffect>('Thud'),
    DudBurped: () => Option.none<SoundEffect>(),
    LidLaunched: () => Option.some<SoundEffect>('Whoosh'),
    LidBlasted: () => Option.some<SoundEffect>('Boom'),
    CookerPopped: () => Option.some<SoundEffect>('Pop'),
    PanSwung: () => Option.some<SoundEffect>('Whoosh'),
    PanClanged: () => Option.some<SoundEffect>('Clang'),
    PanSmashed: () => Option.some<SoundEffect>('BossStomp'),
    PanFlattened: () => Option.some<SoundEffect>('Clang'),
    KnifeStabbed: () => Option.some<SoundEffect>('Swish'),
    KnifeHit: () => Option.some<SoundEffect>('Stab'),
    HomeRun: () => Option.some<SoundEffect>('BossBonk'),
    FreezeSprayed: () => Option.some<SoundEffect>('PowerDown'),
    ZombieFrozen: () => Option.none<SoundEffect>(),
    ZombieShattered: () => Option.some<SoundEffect>('Crack'),
    ZombieSlipped: () => Option.some<SoundEffect>('Thud'),
    PlayerDowned: () => Option.some<SoundEffect>('PlayerHurt'),
    PlayerRevived: () => Option.some<SoundEffect>('Clutch'),
    FriendlyFire: () => Option.some<SoundEffect>('PlayerHurt'),
  })

const maybeEventSoundCue = (event: GameEvent): Option.Option<SoundCue> =>
  Option.map(maybeEventSound(event), sound => ({
    sound,
    variation: positionVariation(event.x, event.y),
  }))

// NOTE: a co-op client predicts its own shots and sounds them at once
// (src/coopPlay.ts), so the room's own copy of each, later, stays quiet.
export const isOwnShot = (event: GameEvent, ownSlot: number): boolean =>
  GameEvent.isAnyOf(['Fired'])(event) &&
  Option.exists(event.maybeShooter, shooter => shooter === ownSlot)

// NOTE: the shot sound of the gun a player holds, where they stand.
export const shotSoundCue = (player: Player): SoundCue => ({
  sound: WEAPONS[heldWeapon(player.arsenal)].sound,
  variation: positionVariation(player.x, player.y),
})

// NOTE: the fridge's spin landing between two frames plays its prize's
// sting there (src/fridgeReveal.ts). It is read from the door, not from an
// event, so the room's World needs nothing new for it.
export const fridgeLandCues = (
  before: Model,
  after: Model,
): ReadonlyArray<SoundCue> =>
  before.fridge.door === after.fridge.door
    ? []
    : pipe(
        maybeLandedBetween(before.fridge.door, after.fridge.door),
        Option.flatMap(prize =>
          Option.map(prizeSpotOf(after), spot => ({
            sound: revealOf(prize).sting,
            variation: positionVariation(spot.x, spot.y),
          })),
        ),
        Option.toArray,
      )

export const frameSoundCues = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<SoundCue> =>
  pipe(
    events,
    Array.map(maybeEventSoundCue),
    Array.getSomes,
    Array.dedupeWith((first, second) => first.sound === second.sound),
  )

// NOTE: a low tick on each of the last few shots of a gun that can run dry.
export const ammoTickCues = (model: Model): ReadonlyArray<SoundCue> =>
  isTickingShot(model.player, model.frameEvents)
    ? [
        {
          sound: 'AmmoTick',
          variation: positionVariation(model.player.x, model.player.y),
        },
      ]
    : []

export const playSounds =
  (cues: ReadonlyArray<SoundCue>): UpdateStep =>
  stepModel => {
    if (isSoundAudible(stepModel)) {
      return {
        model: stepModel,
        commands: Array.map(cues, cue => PlaySound(cue)),
      }
    } else {
      return { model: stepModel }
    }
  }

export const uiCue = (sound: SoundEffect): SoundCue => ({ sound, variation: 0 })

export const playStartSoundWhen = (isRoundStart: boolean): UpdateStep =>
  playSounds(isRoundStart ? [uiCue('Start')] : [])

export const playSwapSoundWhen = (isSwap: boolean): UpdateStep =>
  playSounds(isSwap ? [uiCue('Swap')] : [])

// NOTE: a sound dropped while the engine is suspended means the browser
// suspended it under a Ready engine: the next tap resumes it.
export const notePlayOutcome =
  (outcome: PlayOutcome): UpdateStep =>
  model =>
    outcome === 'DroppedWhileSuspended' &&
    AudioState.isAnyOf(['Ready'])(model.audio)
      ? {
          model: modifyFields(model, {
            audio: () => AudioState.Suspended(),
          }),
        }
      : { model }

export const unlockAudio: UpdateStep = stepModel =>
  AudioState.match(stepModel.audio, {
    Locked: () => ({
      model: modifyFields(stepModel, { audio: () => AudioState.Unlocking() }),
    }),
    Unlocking: () => ({ model: stepModel }),
    Suspended: () => ({ model: stepModel, commands: [ResumeAudio()] }),
    Ready: () => ({ model: stepModel }),
    Unavailable: () => ({ model: stepModel }),
  })

export const toggleSound = (model: Model): Model =>
  modifyFields(model, {
    soundSetting: setting => (setting === 'On' ? 'Muted' : 'On'),
  })

const toggleSoundFromKey = (model: Model, code: string): Model =>
  code === MUTE_KEY ? toggleSound(model) : model

export const toggleMusic = (model: Model): Model =>
  modifyFields(model, {
    musicSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

const toggleMusicFromKey = (model: Model, code: string): Model =>
  code === MUSIC_KEY ? toggleMusic(model) : model

export const toggleAudioFromKey = (model: Model, code: string): Model =>
  toggleMusicFromKey(toggleSoundFromKey(model, code), code)
