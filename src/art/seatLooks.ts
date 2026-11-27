import { Array, Function, Option } from 'effect'

import type { Lobby, LobbyMember } from '@munch/netcode'

import { lookOfCode } from '#shared/records/lookCodes.ts'
import { type Calling, callingOfCode } from '#shared/records/playerData.ts'
import type { Appearance } from '#world/schema/worldSchema.ts'

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
    propStyle: 'Stock',
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
    propStyle: 'Stock',
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
    propStyle: 'Stock',
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
    propStyle: 'Stock',
  },
]

export const seatLook = (seat: number): Appearance =>
  Option.getOrElse(Array.get(SEAT_LOOKS, seat % SEAT_LOOKS.length), () =>
    Array.headNonEmpty(SEAT_LOOKS),
  )

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

export const callingOfMember = (member: LobbyMember): Calling =>
  Option.getOrElse(callingOfCode(member.calling), (): Calling => 'You')

export const seatLookOf: {
  (
    ownSeat: number,
    seat: number,
    maybeLobby: Option.Option<Lobby>,
  ): (ownLook: Appearance) => Appearance
  (
    ownLook: Appearance,
    ownSeat: number,
    seat: number,
    maybeLobby: Option.Option<Lobby>,
  ): Appearance
} = Function.dual(
  4,
  (
    ownLook: Appearance,
    ownSeat: number,
    seat: number,
    maybeLobby: Option.Option<Lobby>,
  ): Appearance =>
    seat === ownSeat
      ? ownLook
      : Option.getOrElse(memberLookAt(maybeLobby, seat), () => seatLook(seat)),
)
