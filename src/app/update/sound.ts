import { Array, Effect, Function, Option, Schema, pipe } from 'effect'
import type { ManagedResource } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  type AudioEngine,
  type AudioEngineError,
  type PlayOutcome,
  SoundEffect,
  acquireAudioEngine,
  playSound,
  playSoundAt,
  positionVariation,
  releaseAudioEngine,
  resumeAudio,
} from '../../audio/audio'
import { maybeTuneCue } from '../../features/dare/musicBox'
import { scratchesBetween } from '../../features/dare/pocketCard'
import {
  maybeLandedBetween,
  prizeSpotOf,
  revealOf,
} from '../../features/fridge/fridgeReveal'
import { isTickingShot } from '../../features/hud/ammoWarning'
import { maybeKitchenSound } from '../../features/kitchen/kitchenCall'
import { STATION_SOUNDS } from '../../features/stations/stationView'
import { mendedSpots } from '../../render/heroTells'
import { PICKUPS } from '../../world/gear/powerups'
import { TRAPS } from '../../world/gear/traps'
import { WEAPONS, heldWeapon } from '../../world/gear/weapons'
import { PANTRY_SOUNDS } from '../../world/kitchen/pantry'
import { focusOf } from '../../world/party/party'
import { ZOMBIE_KINDS, isArmorShedAt } from '../../world/zombies/zombies'
import {
  ApplicationBlock,
  makeManagedResources,
  makeResource,
} from '../definition'
import { Message } from '../message'
import { AudioState, GameEvent, type Model, Phase, type Player } from '../model'
import { type UpdateStep, defineHandlers } from './step'

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

export const ResumeAudio = ApplicationBlock.makeCommand('ResumeAudio', {
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

export const PlaySound = ApplicationBlock.makeCommand('PlaySound', {
  args: { sound: SoundEffect, variation: Schema.Finite },
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

// NOTE: the music box's tune, placed by where it is from the player
// (src/features/dare/musicBox.ts).
export const PlayTune = ApplicationBlock.makeCommand('PlayTune', {
  args: { volume: Schema.Finite, pan: Schema.Finite },
  messages: [Message.CompletedPlaySound, Message.FailedPlaySound],
  handler: function* () {
    return ({ volume, pan }) =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(engine =>
          playSoundAt(engine, 'MusicBox', { volume, pan }),
        ),
        Effect.map(outcome =>
          Message.CompletedPlaySound({ sound: 'MusicBox', outcome }),
        ),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedPlaySound({
              sound: 'MusicBox',
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
    DryFired: () => Option.some<SoundEffect>('DryClick'),
    ReloadStarted: () => Option.some<SoundEffect>('MagOut'),
    Reloaded: () => Option.some<SoundEffect>('MagIn'),
    WaveCleared: () => Option.some<SoundEffect>('Payday'),
    RushedIn: () => Option.some<SoundEffect>('RankUp'),
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
    ChandelierFell: () => Option.some<SoundEffect>('Crash'),
    ShelfSwung: () => Option.some<SoundEffect>('Crash'),
    FridgeOpened: () => Option.some<SoundEffect>('FridgeSpin'),
    FridgeSlammed: () => Option.some<SoundEffect>('Rumble'),
    PrizeTaken: () => Option.some<SoundEffect>('Swap'),
    CaseOpened: () => Option.some<SoundEffect>('PackBonus'),
    PrizeLeft: () => Option.some<SoundEffect>('Thud'),
    DudBurped: () => Option.none<SoundEffect>(),
    PantryTaken: ({ goodie }) => Option.some(PANTRY_SOUNDS[goodie]),
    // NOTE: a key's ching as it flies to the ring (src/world/keys/keys.ts).
    KeysFound: () => Option.some<SoundEffect>('Purchase'),
    CrateTaken: () => Option.some<SoundEffect>('Swap'),
    TrapMended: () => Option.some<SoundEffect>('Tink'),
    StationWorked: ({ station }) => Option.some(STATION_SOUNDS[station]),
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
    MedicCalled: () => Option.some<SoundEffect>('MedicCall'),
    TeammateSaved: () => Option.some<SoundEffect>('Rescue'),
    GunLeveled: () => Option.some<SoundEffect>('RankUp'),
    DareFound: () => Option.some<SoundEffect>('PrizeJackpot'),
    DareListDone: () => Option.some<SoundEffect>('RankUp'),
    // NOTE: Uncle Chunk's big key bursts out of him: the jackpot's chime.
    BigKeyBurst: () => Option.some<SoundEffect>('PrizeJackpot'),
    FrontDoorOpened: () => Option.some<SoundEffect>('Crash'),
    SteppedOut: () => Option.some<SoundEffect>('RankUp'),
  })

const maybeEventSoundCue = (event: GameEvent): Option.Option<SoundCue> =>
  Option.map(maybeEventSound(event), sound => ({
    sound,
    variation: positionVariation(event.x, event.y),
  }))

// NOTE: a co-op client predicts its own shots and sounds them at once
// (src/app/update/coopPlay.ts), so the room's own copy of each, later, stays quiet.
export const isOwnShot: {
  (ownSlot: number): (event: GameEvent) => boolean
  (event: GameEvent, ownSlot: number): boolean
} = Function.dual(
  2,
  (event: GameEvent, ownSlot: number): boolean =>
    GameEvent.isAnyOf(['Fired'])(event) &&
    Option.exists(event.maybeShooter, shooter => shooter === ownSlot),
)

// NOTE: the shot sound of the gun a player holds, where they stand.
export const shotSoundCue = (player: Player): SoundCue => ({
  sound: WEAPONS[heldWeapon(player.arsenal)].sound,
  variation: positionVariation(player.x, player.y),
})

// NOTE: the fridge's spin landing between two frames plays its prize's
// sting there (src/features/fridge/fridgeReveal.ts). It is read from the door, not from an
// event, so the room's World needs nothing new for it.
export const fridgeLandCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
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
      ),
)

// NOTE: a trap mended between two frames rings its tink there, read from the
// traps' health (src/render/heroTells.ts), so the room's World needs nothing new.
export const mendCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  pipe(
    mendedSpots(after, before.tellWatch),
    Array.take(1),
    Array.map(spot => ({
      sound: 'Tink' as const,
      variation: positionVariation(spot.x, spot.y),
    })),
  ),
)

// NOTE: the dare card from the pocket scratches each thing on in pencil
// (src/features/dare/pocketCard.ts), read from its age.
export const pocketScratchCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  scratchesBetween(before, after) > 0
    ? [{ sound: 'Scribble' as const, variation: 0 }]
    : [],
)

// NOTE: the kitchen behind its boards rattles or simmers now and then when
// the player is near (src/features/kitchen/kitchenCall.ts), read from the elapsed time.
export const kitchenCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  pipe(
    maybeKitchenSound(before, after),
    Option.map(sound => ({
      sound,
      variation: positionVariation(
        focusOf(after).player.x,
        focusOf(after).player.y,
      ),
    })),
    Option.toArray,
  ),
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

// NOTE: a low tick on each of the last few shots of a magazine.
export const ammoTickCues = (model: Model): ReadonlyArray<SoundCue> =>
  isTickingShot(focusOf(model).player, model.frameEvents)
    ? [
        {
          sound: 'AmmoTick',
          variation: positionVariation(
            focusOf(model).player.x,
            focusOf(model).player.y,
          ),
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

// NOTE: the music box's tune between two frames, when it is due and heard.
export const playTune: {
  (after: Model): (before: Model) => UpdateStep
  (before: Model, after: Model): UpdateStep
} = Function.dual(
  2,
  (before: Model, after: Model): UpdateStep =>
    stepModel =>
      Option.match(maybeTuneCue(before, after), {
        onNone: () => ({ model: stepModel }),
        onSome: placement =>
          isSoundAudible(stepModel)
            ? { model: stepModel, commands: [PlayTune(placement)] }
            : { model: stepModel },
      }),
)

export const uiCue = (sound: SoundEffect): SoundCue => ({ sound, variation: 0 })

// NOTE: a soft pop on the home menu's own buttons, so a tap feels pressed.
export const tapSound: UpdateStep = playSounds([uiCue('Pop')])

export const playStartSoundWhen = (isRoundStart: boolean): UpdateStep =>
  playSounds(isRoundStart ? [uiCue('Start')] : [])

export const playSwapSoundWhen = (isSwap: boolean): UpdateStep =>
  playSounds(isSwap ? [uiCue('Swap')] : [])

// NOTE: a sound dropped while the engine is suspended means the browser
// suspended it under a Ready engine: the next tap resumes it.
const notePlayOutcome =
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

export const toggleAudioFromKey: {
  (code: string): (model: Model) => Model
  (model: Model, code: string): Model
} = Function.dual(2, (model: Model, code: string): Model =>
  toggleMusicFromKey(toggleSoundFromKey(model, code), code),
)

const START_SOUND_GRACE_MS = 1000

// NOTE: a run is fresh in its intro's first moment, or its first break's
// when it had none.
const isFreshRun = (model: Model): boolean =>
  Phase.matchOrElse(
    model.phase,
    {
      Arriving: ({ elapsedMs }) => elapsedMs < START_SOUND_GRACE_MS,
      Preparation: () => model.elapsedMs < START_SOUND_GRACE_MS,
    },
    () => false,
  )

// NOTE: the mute and music buttons, the audio engine, and each sound and
// tune (src/audio/message.ts).
export const soundHandlers = defineHandlers({
  ClickedMuteButton: model => unlockAudio(toggleSound(model)),

  ClickedMusicButton: model => unlockAudio(toggleMusic(model)),

  AcquiredAudioEngine: model => ({
    model: modifyFields(model, { audio: () => AudioState.Suspended() }),
    commands: [ResumeAudio()],
  }),

  FailedAcquireAudioEngine: model => ({
    model: modifyFields(model, { audio: () => AudioState.Unavailable() }),
  }),

  ReleasedAudioEngine: model => ({ model }),

  CompletedResumeAudio: (model, { playback }) => {
    if (playback === 'Running') {
      const ready = modifyFields(model, { audio: () => AudioState.Ready() })
      return playStartSoundWhen(isFreshRun(ready))(ready)
    } else {
      return {
        model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      }
    }
  },

  FailedResumeAudio: model => ({
    model: modifyFields(model, { audio: () => AudioState.Suspended() }),
  }),

  CompletedPlaySound: (model, { outcome }) => notePlayOutcome(outcome)(model),

  FailedPlaySound: model => ({ model }),

  CompletedCueMusic: model => ({ model }),

  FailedCueMusic: model => ({ model }),
})
