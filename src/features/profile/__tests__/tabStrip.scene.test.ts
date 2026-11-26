import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlPlay } from '@effect/ui/html/testing'
import { TestHost } from '@effect/ui/testing'
import { expect, layer } from '@effect/vitest'

import { type Model } from '#app/model.ts'
import { profilePropsOf } from '#app/views/profileView.ts'
import { Profile } from '#features/profile/block.ts'
import { Events } from '#features/profile/message.ts'
import { inPortrait } from '#test/model.fixture.ts'

import { profileOpenOn, profileTab } from './profile.fixture.ts'

layer(TestHost.layer())('the tab strip', it => {
  const playOn = (model: Model) => HtmlPlay.make(Profile, profilePropsOf(model))

  const lastSwitch = (emitted: ReadonlyArray<Events>) => Array.last(emitted)

  it.effect('a tab the arrow keys move to switches to it', () =>
    Effect.forEach(
      [
        profileOpenOn('Settings'),
        inPortrait(
          UiStruct.evolve(profileOpenOn('Settings'), {
            lastDevice: () => 'Touch',
          }),
        ),
      ],
      model =>
        Effect.gen(function* () {
          const play = yield* playOn(model)
          yield* play.focus(profileTab('Name'))
          expect(lastSwitch(play.root.emitted)).toStrictEqual(
            Option.some(Events.SwitchedTab({ tab: 'Name' })),
          )
          yield* play.focus(profileTab('Mastery'))
          expect(lastSwitch(play.root.emitted)).toStrictEqual(
            Option.some(Events.SwitchedTab({ tab: 'Mastery' })),
          )
        }),
      { discard: true },
    ),
  )

  it.effect('a tap on a tab switches to it', () =>
    Effect.gen(function* () {
      const play = yield* playOn(profileOpenOn('Settings'))
      yield* play.click(profileTab('Account'))
      expect(lastSwitch(play.root.emitted)).toStrictEqual(
        Option.some(Events.SwitchedTab({ tab: 'Account' })),
      )
      yield* play.click(profileTab('Look'))
      expect(lastSwitch(play.root.emitted)).toStrictEqual(
        Option.some(Events.SwitchedTab({ tab: 'Look' })),
      )
    }),
  )
})
