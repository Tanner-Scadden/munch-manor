// The Lobby as the root draws it, for the lobby's Scenes: a child is a
// leaf in the root's Scene, so its insides are read in a Scene of its own,
// made with the props the root's view hands it at that step.

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

import { FocusHomeButton } from '../../../app/update/home'
import { childrenOf } from '../../../test/sceneTesting'
import type { AppScene, RootStep, SceneStep } from '../../../test/testing'
import { Lobby } from '../block'
import { LobbyProps } from '../model'

const isLobbyProps = Schema.is(LobbyProps)

// NOTE: the props the root's view hands the Lobby (src/app/lobbyView.ts),
// or none while it is not drawn.
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

// NOTE: whether the root draws the Lobby (up, or folding back into PLAY).
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

// NOTE: a Scene of the Lobby with the props the root hands it now.
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

// NOTE: an attribute on the Lobby's card, `undefined` for none.
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

// NOTE: leaving the lobby (BACK, Escape, or a tap on the dim) folds the
// card back into PLAY and hands focus back to PLAY, reporting nothing.
export const focusesPlay: RootStep = s =>
  s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop)
