import { Config, Console, Effect, Function, Option } from 'effect'

const knob = (name: string) => Config.String(name).pipe(Config.option)

const KNOBS = Effect.runSync(
  Config.all({
    AIM: knob('AIM'),
    AIM_EVERY: knob('AIM_EVERY'),
    AIM_NOISE: knob('AIM_NOISE'),
    AMMO: knob('AMMO'),
    BOSS_BERTH: knob('BOSS_BERTH'),
    BOSS_TRACE: knob('BOSS_TRACE'),
    CRACK_BERTH: knob('CRACK_BERTH'),
    DEBUG: knob('DEBUG'),
    ENGAGE: knob('ENGAGE'),
    ENGAGE_PX: knob('ENGAGE_PX'),
    FLEE_PX: knob('FLEE_PX'),
    FOCUS_PX: knob('FOCUS_PX'),
    FRIDGE: knob('FRIDGE'),
    GUN: knob('GUN'),
    HUMAN_SHAKE: knob('HUMAN_SHAKE'),
    KITCHEN: knob('KITCHEN'),
    KITE: knob('KITE'),
    LAG_FRAMES: knob('LAG_FRAMES'),
    LANDING_MARGIN: knob('LANDING_MARGIN'),
    MOVE_EVERY: knob('MOVE_EVERY'),
    NO_ASSIST: knob('NO_ASSIST'),
    NO_DODGE: knob('NO_DODGE'),
    NO_FOCUS: knob('NO_FOCUS'),
    NO_GNOME: knob('NO_GNOME'),
    NO_PICKUPS: knob('NO_PICKUPS'),
    NO_PLANKS: knob('NO_PLANKS'),
    NOTICE_DEGREES: knob('NOTICE_DEGREES'),
    NOTICE_PX: knob('NOTICE_PX'),
    OVERSHOOT: knob('OVERSHOOT'),
    PANIC_PX: knob('PANIC_PX'),
    PICKUP_SEEK_PX: knob('PICKUP_SEEK_PX'),
    REACTION_MS: knob('REACTION_MS'),
    RESERVE: knob('RESERVE'),
    ROOMS: knob('ROOMS'),
    SETTLE_FRAMES: knob('SETTLE_FRAMES'),
    SWITCH_RATIO: knob('SWITCH_RATIO'),
    VIEW: knob('VIEW'),
    WATCHED: knob('WATCHED'),
  }),
)

type Knob = keyof typeof KNOBS

export const knobText = (name: Knob): string | undefined =>
  Option.getOrUndefined(KNOBS[name])

export const isKnobSet = (name: Knob): boolean => Option.isSome(KNOBS[name])

export const knobNumber: {
  (fallback: number): (name: Knob) => number
  (name: Knob, fallback: number): number
} = Function.dual(2, (name: Knob, fallback: number): number =>
  Number(knobText(name) ?? fallback),
)

export const traceLine = (...parts: ReadonlyArray<unknown>): void =>
  Effect.runSync(Console.log(...parts))
