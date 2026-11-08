// The Look tab's Schemas: a look's two toggles and its sections. Its parts
// are src/domain/looks.ts.

import { Schema } from 'effect'

// NOTE: the look's two on and off parts, each one tap.
export const LookToggle = Schema.Literals(['Beard', 'Glasses'])
export type LookToggle = typeof LookToggle.Type

// NOTE: the Look tab's little tabs: the body, skin, beard, and glasses; the
// hair; the outfit; and the gear, a hat and a gun skin.
export const LookSection = Schema.Literals(['Body', 'Hair', 'Outfit', 'Gear'])
export type LookSection = typeof LookSection.Type
