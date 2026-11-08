// NOTE: where a file of `src` may sit (AGENTS.md "Folders"), read by
// tools/lint/folders.ts and its test.

import { Array, Option, String } from 'effect'

const LAYERS: ReadonlyArray<string> = [
  'app',
  'screens',
  'features',
  'ui',
  'domain',
  'render',
  'art',
  'audio',
  'input',
  'platform',
  'world',
  'shared',
  'test',
]

const LOOSE_FILES: ReadonlyArray<string> = ['vite-env.d.ts']

const isTest = (file: string): boolean => String.endsWith('.test.ts')(file)

const isFixture = (file: string): boolean =>
  String.endsWith('.fixture.ts')(file)

const parentOf = (file: string): string =>
  Option.getOrElse(
    Array.get(Array.reverse(String.split('/')(file)), 1),
    () => '',
  )

const isInTests = (file: string): boolean => parentOf(file) === '__tests__'

// NOTE: what is wrong with one file's place, if anything.
export const problemOf = (file: string): Option.Option<string> => {
  const segments = String.split('/')(file)
  const layer = Option.getOrElse(Array.head(segments), () => '')
  if (segments.length === 1) {
    return Array.contains(LOOSE_FILES, file)
      ? Option.none()
      : Option.some(
          `sits straight in src: move it into its layer's folder (${Array.join(LAYERS, ', ')}).`,
        )
  }
  if (!Array.contains(LAYERS, layer)) {
    return Option.some(
      `src/${layer}/ is not a layer: use one of ${Array.join(LAYERS, ', ')}.`,
    )
  }
  if (String.includes('__tests__/')(file) && !isInTests(file)) {
    return Option.some(
      'is in a folder inside __tests__/: tests sit straight in __tests__/.',
    )
  }
  if (isTest(file) && !isInTests(file)) {
    return Option.some(
      'is a test outside __tests__/: move it into the __tests__/ folder beside the code it tests.',
    )
  }
  if (isFixture(file) && !isInTests(file) && layer !== 'test') {
    return Option.some(
      "is a fixture outside __tests__/: move it into its tests' __tests__/ folder, or src/test/ when several folders' tests share it.",
    )
  }
  if (!isTest(file) && !isFixture(file) && isInTests(file)) {
    return Option.some(
      'is not a test or a fixture, so it does not belong in __tests__/: move it beside the code it serves.',
    )
  }
  return Option.none()
}
