import { Schema } from 'effect'

export const LookToggle = Schema.Literals(['Beard', 'Glasses'])
export type LookToggle = typeof LookToggle.Type

export const LookSection = Schema.Literals(['Body', 'Hair', 'Outfit', 'Gear'])
export type LookSection = typeof LookSection.Type
