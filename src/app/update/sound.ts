import { Array, Effect, Function, Option, Schema, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import {
  AudioState,
  GameEvent,
  type Model,
  Phase,
  type Player,
} from '#app/model.ts'
import {
  AudioEngine,
  type PlayOutcome,
  SoundEffect,
  playSound,
  playSoundAt,
  positionVariation,
  resumeAudio,
} from '#audio/audio.ts'
import { AudioEvent, stepAudio } from '#audio/audioFlow.ts'
import { SoundMessage } from '#audio/message.ts'
import { maybeTuneCue } from '#features/dare/musicBox.ts'
import { scratchesBetween } from '#features/dare/pocketCard.ts'
import {
  maybeLandedBetween,
  prizeSpotOf,
  revealOf,
} from '#features/fridge/fridgeReveal.ts'
import { isTickingShot } from '#features/hud/ammoWarning.ts'
import { maybeKitchenSound } from '#features/kitchen/kitchenCall.ts'
import { STATION_SOUNDS } from '#features/stations/stationView.ts'
import { strikesBetween } from '#render/actionPose.ts'
import { mendedSpots } from '#render/heroTells.ts'
import { maybeDripHeard } from '#render/iso/leaks.ts'
import { didStrikeBetween } from '#render/iso/mood.ts'
import type { Motion } from '#render/renderSchema.ts'
import { PICKUPS } from '#world/gear/powerups.ts'
import { TRAPS } from '#world/gear/traps.ts'
import { WEAPONS, heldWeapon } from '#world/gear/weapons.ts'
import { PANTRY_SOUNDS } from '#world/kitchen/pantry.ts'
import { levelOf } from '#world/level/arena.ts'
import { isWadingAt } from '#world/level/leaks.ts'
import { focusOf } from '#world/party/party.ts'
import { vectorLength } from '#world/step/geometry.ts'
import { isRoundActive } from '#world/waves/waves.ts'
import { ZOMBIE_KINDS, isArmorShedAt } from '#world/zombies/zombies.ts'

import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step.ts'

export class AcquireAudioEngine extends Command.Service<AcquireAudioEngine>()(
  'app/AcquireAudioEngine',
  { args: {}, success: SoundMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { engine } = yield* AudioEngine
      return () =>
        engine.pipe(
          Effect.match({
            onSuccess: () => SoundMessage.SucceededAcquireAudioEngine(),
            onFailure: error =>
              SoundMessage.FailedAcquireAudioEngine({ reason: error.reason }),
          }),
        )
    }),
  )
}

export class ResumeAudio extends Command.Service<ResumeAudio>()(
  'app/ResumeAudio',
  { args: {}, success: SoundMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { engine } = yield* AudioEngine
      return () =>
        engine.pipe(
          Effect.flatMap(resumeAudio),
          Effect.match({
            onSuccess: playback =>
              SoundMessage.CompletedResumeAudio({ playback }),
            onFailure: error =>
              SoundMessage.FailedResumeAudio({ reason: error.reason }),
          }),
        )
    }),
  )
}

const reportPlayed = (
  sound: SoundEffect,
  outcome: PlayOutcome,
): SoundMessage | Component.Noop =>
  outcome === 'DroppedWhileSuspended'
    ? SoundMessage.CompletedPlaySound({ sound, outcome })
    : Component.noop

const PlayResult = Schema.Union([SoundMessage, Component.Noop])

export class PlaySound extends Command.Service<PlaySound>()('app/PlaySound', {
  args: { sound: SoundEffect, variation: Schema.Finite },
  success: PlayResult,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { engine } = yield* AudioEngine
      return ({ sound, variation }) =>
        engine.pipe(
          Effect.flatMap(built => playSound(built, sound, variation)),
          Effect.map(outcome => reportPlayed(sound, outcome)),
          Effect.catch(error =>
            Effect.as(
              Effect.logWarning('play sound', sound, error.reason),
              Component.noop,
            ),
          ),
        )
    }),
  )
}

export class PlayPlaced extends Command.Service<PlayPlaced>()(
  'app/PlayPlaced',
  {
    args: { sound: SoundEffect, volume: Schema.Finite, pan: Schema.Finite },
    success: PlayResult,
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { engine } = yield* AudioEngine
      return ({ sound, volume, pan }) =>
        engine.pipe(
          Effect.flatMap(built => playSoundAt(built, sound, { volume, pan })),
          Effect.map(outcome => reportPlayed(sound, outcome)),
          Effect.catch(error =>
            Effect.as(
              Effect.logWarning('play placed sound', sound, error.reason),
              Component.noop,
            ),
          ),
        )
    }),
  )
}

const MUTE_KEY = 'KeyM'
const MUSIC_KEY = 'KeyN'

export const isSoundAudible = (model: Model): boolean =>
  AudioState.$is('Ready')(model.audio) && model.settings.soundSetting === 'On'

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
    BigKeyBurst: () => Option.some<SoundEffect>('PrizeJackpot'),
    FrontDoorOpened: () => Option.some<SoundEffect>('Crash'),
    SteppedOut: () => Option.some<SoundEffect>('RankUp'),
  })

const maybeEventSoundCue = (event: GameEvent): Option.Option<SoundCue> =>
  Option.map(maybeEventSound(event), sound => ({
    sound,
    variation: positionVariation(event.x, event.y),
  }))

export const isOwnShot: {
  (ownSlot: number): (event: GameEvent) => boolean
  (event: GameEvent, ownSlot: number): boolean
} = Function.dual(
  2,
  (event: GameEvent, ownSlot: number): boolean =>
    GameEvent.isAnyOf(['Fired'])(event) &&
    Option.exists(event.maybeShooter, shooter => shooter === ownSlot),
)

export const shotSoundCue = (player: Player): SoundCue => ({
  sound: WEAPONS[heldWeapon(player.arsenal)].sound,
  variation: positionVariation(player.x, player.y),
})

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

export const mendCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  pipe(
    mendedSpots(after, before.cosmetics.tellWatch),
    Array.take(1),
    Array.map(spot => ({
      sound: 'Tink' as const,
      variation: positionVariation(spot.x, spot.y),
    })),
  ),
)

const STRIKE_SOUNDS: Readonly<
  Record<Motion, Option.Option<SoundCue['sound']>>
> = {
  Compress: Option.some('ChestPush'),
  Hammer: Option.some('HammerTap'),
  Rummage: Option.none(),
  Yank: Option.none(),
  Haul: Option.none(),
  Crank: Option.none(),
  Pull: Option.none(),
  Push: Option.none(),
  Shove: Option.none(),
  Stir: Option.none(),
  Pry: Option.none(),
}

export const strikeCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  pipe(
    strikesBetween(before.cosmetics.actionWatch, after.cosmetics.actionWatch),
    Array.flatMap(({ motion, x, y }) =>
      Option.toArray(
        Option.map(STRIKE_SOUNDS[motion], sound => ({
          sound,
          variation: positionVariation(x, y),
        })),
      ),
    ),
    Array.take(1),
  ),
)

export const pocketScratchCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  scratchesBetween(before, after) > 0
    ? [{ sound: 'Scribble' as const, variation: 0 }]
    : [],
)

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

export const thunderCues: {
  (after: Model): (before: Model) => ReadonlyArray<SoundCue>
  (before: Model, after: Model): ReadonlyArray<SoundCue>
} = Function.dual(2, (before: Model, after: Model): ReadonlyArray<SoundCue> =>
  didStrikeBetween({ world: after, previousMs: before.elapsedMs })
    ? [
        {
          sound: 'Thunder' as const,
          variation: positionVariation(after.elapsedMs, 0),
        },
      ]
    : [],
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
  $ =>
    isSoundAudible($.model) && Array.isReadonlyArrayNonEmpty(cues)
      ? $.run(...Array.map(cues, cue => PlaySound.make(cue)))
      : $.model

const maybeDripCue = (before: Model, after: Model) =>
  isRoundActive(after.phase)
    ? maybeDripHeard({
        world: after,
        level: levelOf(after),
        listener: focusOf(after).player,
        previousMs: before.elapsedMs,
      })
    : Option.none()

const WADE_STRIDE_MS = 320
const WADE_VOLUME = 0.7

const isWalkingInWater = (model: Model): boolean => {
  const { player, intent } = focusOf(model)
  return vectorLength(intent.move) > 0 && isWadingAt(levelOf(model), player)
}

const isWadeDue = (before: Model, after: Model): boolean =>
  isRoundActive(after.phase) &&
  isWalkingInWater(after) &&
  (!isWalkingInWater(before) ||
    Math.floor(after.elapsedMs / WADE_STRIDE_MS) !==
      Math.floor(before.elapsedMs / WADE_STRIDE_MS))

export const playPlaced: {
  (after: Model): (before: Model) => UpdateStep
  (before: Model, after: Model): UpdateStep
} = Function.dual(
  2,
  (before: Model, after: Model): UpdateStep =>
    $ =>
      isSoundAudible($.model)
        ? $.run(
            ...Option.toArray(
              Option.map(maybeTuneCue(before, after), placement =>
                PlayPlaced.make({ sound: 'MusicBox', ...placement }),
              ),
            ),
            ...Option.toArray(
              Option.map(maybeDripCue(before, after), placement =>
                PlayPlaced.make({ sound: 'Drip', ...placement }),
              ),
            ),
            ...(isWadeDue(before, after)
              ? [
                  PlayPlaced.make({
                    sound: 'Wade',
                    volume: WADE_VOLUME,
                    pan: 0,
                  }),
                ]
              : []),
          )
        : $.model,
)

export const uiCue = (sound: SoundEffect): SoundCue => ({ sound, variation: 0 })

export const tapSound: UpdateStep = playSounds([uiCue('Pop')])

export const playStartSoundWhen = (isRoundStart: boolean): UpdateStep =>
  playSounds(isRoundStart ? [uiCue('Start')] : [])

export const playSwapSoundWhen = (isSwap: boolean): UpdateStep =>
  playSounds(isSwap ? [uiCue('Swap')] : [])

const moveAudio =
  (event: AudioEvent, onMoved: UpdateStep = unchanged): UpdateStep =>
  $ => {
    const after = stepAudio($.model.audio, event)
    const moved = combine([
      modelStep(model => UiStruct.evolve(model, { audio: () => after })),
      onMoved,
    ])
    return (after === $.model.audio ? unchanged : moved)($)
  }

const askToResume: UpdateStep = $ => $.run(ResumeAudio.make())

const askForEngine: UpdateStep = $ => $.run(AcquireAudioEngine.make())

const playStartSoundOnResume: UpdateStep = $ =>
  playStartSoundWhen(isFreshRun($.model))($)

const notePlayOutcome = (outcome: PlayOutcome): UpdateStep =>
  outcome === 'DroppedWhileSuspended'
    ? moveAudio(AudioEvent.WentQuiet)
    : unchanged

export const unlockAudio: UpdateStep = $ =>
  AudioState.$match($.model.audio, {
    Locked: () => moveAudio(AudioEvent.Unlocked, askForEngine)($),
    Unlocking: () => $.model,
    Suspended: () => askToResume($),
    Ready: () => $.model,
    Unavailable: () => $.model,
  })

export const toggleSound = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: UiStruct.evolve({
      soundSetting: setting => (setting === 'On' ? 'Muted' : 'On'),
    }),
  })

const toggleSoundFromKey = (model: Model, code: string): Model =>
  code === MUTE_KEY ? toggleSound(model) : model

export const toggleMusic = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: UiStruct.evolve({
      musicSetting: setting => (setting === 'On' ? 'Off' : 'On'),
    }),
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

const isFreshRun = (model: Model): boolean =>
  Phase.matchOrElse(
    model.phase,
    {
      Arriving: ({ elapsedMs }) => elapsedMs < START_SOUND_GRACE_MS,
      Preparation: () => model.elapsedMs < START_SOUND_GRACE_MS,
    },
    () => false,
  )

export const soundHandlers = defineHandlers({
  ClickedMuteButton: $ => $.combine(modelStep(toggleSound), unlockAudio),

  ClickedMusicButton: $ => $.combine(modelStep(toggleMusic), unlockAudio),

  SucceededAcquireAudioEngine: moveAudio(AudioEvent.GotEngine, askToResume),

  FailedAcquireAudioEngine: moveAudio(AudioEvent.FailedToGetEngine),

  CompletedResumeAudio: ($, { playback }) =>
    playback === 'Running'
      ? moveAudio(AudioEvent.Resumed, playStartSoundOnResume)($)
      : moveAudio(AudioEvent.WentQuiet)($),

  FailedResumeAudio: $ => $.model,

  CompletedPlaySound: ($, { outcome }) => notePlayOutcome(outcome)($),
})
