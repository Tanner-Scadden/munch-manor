import {
  Array,
  type Effect,
  Function,
  Match,
  Option,
  Schema,
  type Scope,
} from 'effect'

import { Component } from '@effect/ui'
import { HtmlScene } from '@effect/ui/html/testing'
import type { Locator } from '@effect/ui/testing'

import { FocusHomeButton } from '#app/update/home.ts'
import { Lobby } from '#features/lobby/block.ts'
import { LobbyProps } from '#features/lobby/model.ts'
import { childrenOf } from '#test/sceneTesting.ts'
import type { AppScene, RootStep, SceneStep } from '#test/testing.ts'

const isLobbyProps = Schema.is(LobbyProps)

export const lobbyPropsIn = (s: AppScene): Option.Option<LobbyProps> =>
  Array.findFirst(childrenOf(s.view), node =>
    Match.value(node).pipe(
      Match.tag('Child', child =>
        child.key === 'lobby' && isLobbyProps(child.props)
          ? Option.some(child.props)
          : Option.none(),
      ),
      Match.orElse(() => Option.none()),
    ),
  )

export const expectLobbyDrawn =
  (isDrawn: boolean): SceneStep =>
  s =>
    s.check(() => {
      if (Option.isSome(lobbyPropsIn(s)) !== isDrawn) {
        throw new Error(
          isDrawn ? 'the Lobby is not drawn' : 'the Lobby is still drawn',
        )
      }
    })

export const lobbySceneIn = (
  s: AppScene,
): Effect.Effect<LobbyScene, never, Scope.Scope> =>
  HtmlScene.make(
    Lobby,
    Option.getOrThrowWith(
      lobbyPropsIn(s),
      () => new Error('the root draws no Lobby'),
    ),
  )

export type LobbyScene = HtmlScene.Steps<typeof Lobby>

export const lobbyAttr: {
  (
    name: string,
    expected: string | undefined,
  ): (locator: Locator.Locator) => (s: LobbyScene) => LobbyScene
  (
    locator: Locator.Locator,
    name: string,
    expected: string | undefined,
  ): (s: LobbyScene) => LobbyScene
} = Function.dual(
  3,
  (locator: Locator.Locator, name: string, expected: string | undefined) =>
    (s: LobbyScene): LobbyScene =>
      s.check(() => {
        const actual = s.get(locator).attrs?.[name]
        if (actual !== expected) {
          throw new Error(
            `${locator.description} has ${name}=${globalThis.String(actual)}, wanted ${globalThis.String(expected)}`,
          )
        }
      }),
)

export const focusesPlay: RootStep = s =>
  s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop)
