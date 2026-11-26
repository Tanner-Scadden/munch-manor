import { Array, Option } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { RoomRequest, Screen } from '#domain/coopRoom.ts'
import { freshRoom } from '#features/coop/roomState.ts'
import {
  ScreenEvent,
  screenMachine,
  stepScreen,
} from '#features/coop/screenFlow.ts'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(screenMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

const inRoom = Screen.InRoom({ room: freshRoom('MNCH', 1) })

describe("co-op's screens", () => {
  test('every screen answers only the events it means to', () => {
    expect(registered()).toEqual([
      'Asking/FailedToGetRoom',
      'Asking/GotRoom',
      'Closed/AskedForRoom',
      'Closed/Opened',
      'Code/AskedForRoom',
      'Code/ClosedCoop',
      'Code/RefusedCode',
      'Code/TypedCode',
      'Code/WentBack',
      'Hub/AskedForRoom',
      'Hub/ChoseCode',
      'Hub/ChoseQuickPlay',
      'Hub/ClosedCoop',
      'InRoom/LeftRoom',
      'Queue/HeardQueue',
      'Queue/LeftQueue',
      'Queue/LostQueue',
      'Queue/Matched',
    ])
    expect(Machine.definition(screenMachine).anyState).toEqual([])
  })

  test('a hub button pressed while in a room leaves the room alone', () => {
    expect(stepScreen(inRoom, ScreenEvent.ChoseQuickPlay)).toBe(inRoom)
    expect(stepScreen(inRoom, ScreenEvent.TypedCode({ typed: 'AB' }))).toBe(
      inRoom,
    )
    expect(stepScreen(inRoom, ScreenEvent.LeftQueue)).toBe(inRoom)
  })

  test('a leave that lands after a kick keeps the kick on the hub', () => {
    const kicked = stepScreen(
      inRoom,
      ScreenEvent.LeftRoom({ maybeProblem: Option.some('Kicked') }),
    )
    expect(
      stepScreen(kicked, ScreenEvent.LeftRoom({ maybeProblem: Option.none() })),
    ).toBe(kicked)
  })

  test('a room asked for by code that fails goes back to the code', () => {
    const asking = Screen.Asking({
      request: RoomRequest.Join({ code: 'MNCH' }),
    })
    expect(
      stepScreen(asking, ScreenEvent.FailedToGetRoom({ problem: 'Full' })),
    ).toEqual(Screen.Code({ typed: 'MNCH', maybeProblem: Option.some('Full') }))
    const creating = Screen.Asking({ request: RoomRequest.Create() })
    expect(
      stepScreen(creating, ScreenEvent.FailedToGetRoom({ problem: 'Full' })),
    ).toEqual(Screen.Hub({ maybeProblem: Option.some('Full') }))
  })

  test('only quick play takes a match, and only asking takes a room', () => {
    const hub = Screen.Hub({ maybeProblem: Option.none() })
    expect(
      stepScreen(hub, ScreenEvent.Matched({ code: 'MNCH', slot: 0 })),
    ).toBe(hub)
    expect(
      stepScreen(hub, ScreenEvent.GotRoom({ code: 'MNCH', slot: 0 })),
    ).toBe(hub)
  })
})
