import { Array, Option } from 'effect'

import type { Lobby, LobbyMember } from '@munch/netcode'

import { type Calling, callingOfCode, lookOfCode } from '../playerData'
import type { Appearance } from '../worldSchema'

// NOTE: each player's own look rides in the lobby (the member's `look`,
// sent with the join). Your own seat wears your own look; a teammate whose
// look did not come, or does not read, wears one of these, by seat, in the
// lobby and in the run alike.
export const SEAT_LOOKS: Array.NonEmptyReadonlyArray<Appearance> = [
  {
    body: 'Broad',
    hairStyle: 'Short',
    hairColor: 'Brown',
    skinTone: 'Light',
    shirtColor: 'Blue',
    outfit: 'Tee',
    print: 'Plain',
    beard: false,
    glasses: false,
    hat: 'None',
    gunSkin: 'Stock',
  },
  {
    body: 'Slim',
    hairStyle: 'Ponytail',
    hairColor: 'Red',
    skinTone: 'Tan',
    shirtColor: 'Teal',
    outfit: 'Hoodie',
    print: 'Plain',
    beard: false,
    glasses: true,
    hat: 'None',
    gunSkin: 'Stock',
  },
  {
    body: 'Broad',
    hairStyle: 'Curly',
    hairColor: 'Black',
    skinTone: 'Deep',
    shirtColor: 'Yellow',
    outfit: 'Overalls',
    print: 'Plain',
    beard: true,
    glasses: false,
    hat: 'None',
    gunSkin: 'Stock',
  },
  {
    body: 'Slim',
    hairStyle: 'Long',
    hairColor: 'Pink',
    skinTone: 'Fair',
    shirtColor: 'Purple',
    outfit: 'Tee',
    print: 'Stripes',
    beard: false,
    glasses: false,
    hat: 'None',
    gunSkin: 'Stock',
  },
]

export const seatLook = (seat: number): Appearance =>
  Option.getOrElse(Array.get(SEAT_LOOKS, seat % SEAT_LOOKS.length), () =>
    Array.headNonEmpty(SEAT_LOOKS),
  )

// NOTE: looks are read every frame for the teammates in the run, so each
// code is read once.
const readLooks = new Map<string, Option.Option<Appearance>>()

const lookOfCodeOnce = (code: string): Option.Option<Appearance> => {
  const known = readLooks.get(code)
  if (known !== undefined) {
    return known
  }
  const read = lookOfCode(code)
  readLooks.set(code, read)
  return read
}

const memberLookAt = (
  maybeLobby: Option.Option<Lobby>,
  seat: number,
): Option.Option<Appearance> =>
  Option.flatMap(maybeLobby, lobby =>
    Option.flatMap(
      Array.findFirst(lobby.members, member => member.slot === seat),
      member => lookOfCodeOnce(member.look),
    ),
  )

// NOTE: the calling a lobby member brought, as text in the lobby; a word that
// is none of ours reads as YOU, which has no prop.
export const callingOfMember = (member: LobbyMember): Calling =>
  Option.getOrElse(callingOfCode(member.calling), (): Calling => 'You')

export const seatLookOf = (
  ownLook: Appearance,
  ownSeat: number,
  seat: number,
  maybeLobby: Option.Option<Lobby> = Option.none(),
): Appearance =>
  seat === ownSeat
    ? ownLook
    : Option.getOrElse(memberLookAt(maybeLobby, seat), () => seatLook(seat))
