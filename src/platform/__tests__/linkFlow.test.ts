import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { LinkEvent, LinkFlow, linkMachine, stepLink } from '../linkFlow'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(linkMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

describe('the device link flow', () => {
  test('every state answers only the events it means to', () => {
    expect(registered()).toEqual([
      'Entering/AskedForCode',
      'Entering/PastedCode',
      'Entering/SubmittedCode',
      'Entering/TypedCode',
      'Failed/AskedForCode',
      'Failed/TypedCode',
      'Idle/AskedForCode',
      'Linked/AskedForCode',
      'Redeeming/FailedToRedeem',
      'Redeeming/Redeemed',
      'Requesting/FailedToGetCode',
      'Requesting/GotCode',
      'Showing/AskedForCode',
    ])
    expect(
      Array.map(Machine.definition(linkMachine).anyState, any => any.event),
    ).toEqual(['ChoseToEnterCode', 'Cancelled'])
  })

  test('a code that comes back after a cancel is dropped', () => {
    const cancelled = stepLink(LinkFlow.Requesting, LinkEvent.Cancelled)
    expect(stepLink(cancelled, LinkEvent.GotCode({ code: 'ABC234' }))).toEqual(
      LinkFlow.Idle,
    )
  })

  test('a redeem that lands after a cancel never links', () => {
    const cancelled = stepLink(
      LinkFlow.Redeeming({ code: 'ABC234' }),
      LinkEvent.Cancelled,
    )
    expect(stepLink(cancelled, LinkEvent.Redeemed)).toEqual(LinkFlow.Idle)
  })

  test('asking again while a code is on its way asks once', () => {
    expect(stepLink(LinkFlow.Requesting, LinkEvent.AskedForCode)).toEqual(
      LinkFlow.Requesting,
    )
  })

  test('a paste replaces only what the field held when it was read', () => {
    const entering = LinkFlow.Entering({ code: 'AB' })
    expect(
      stepLink(
        entering,
        LinkEvent.PastedCode({ text: 'abc-234', typed: 'AB' }),
      ),
    ).toEqual(LinkFlow.Entering({ code: 'ABC234' }))
    expect(
      stepLink(entering, LinkEvent.PastedCode({ text: 'abc-234', typed: 'A' })),
    ).toEqual(entering)
  })
})
