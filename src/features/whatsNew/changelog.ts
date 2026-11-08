import { Array, Option, Schema, String, pipe } from 'effect'

import changelogMarkdown from '../../../CHANGELOG.md?raw'

// CHANGELOG

export const NewsBullet = Schema.Struct({
  emoji: Schema.String,
  text: Schema.NonEmptyString,
})
export type NewsBullet = typeof NewsBullet.Type

export const NewsDay = Schema.Struct({
  date: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  maybeIntro: Schema.Option(Schema.String),
  bullets: Schema.NonEmptyArray(NewsBullet),
})
export type NewsDay = typeof NewsDay.Type

type DraftDay = Readonly<{
  heading: string
  lines: ReadonlyArray<string>
}>

const DAY_PREFIX = '## '
const BULLET_PREFIX = '- '

const isDayHeading = String.startsWith(DAY_PREFIX)
const isBullet = String.startsWith(BULLET_PREFIX)

const draftDays = (lines: ReadonlyArray<string>): ReadonlyArray<DraftDay> =>
  Array.reduce(lines, [], (days: ReadonlyArray<DraftDay>, line) => {
    if (isDayHeading(line)) {
      return Array.append(days, {
        heading: String.slice(DAY_PREFIX.length)(line),
        lines: [],
      })
    } else {
      return Option.match(Array.last(days), {
        onNone: () => days,
        onSome: day =>
          Array.append(Array.dropRight(days, 1), {
            heading: day.heading,
            lines: Array.append(day.lines, line),
          }),
      })
    }
  })

const splitOnce = (
  text: string,
  separator: string,
): Readonly<{ head: string; rest: string }> =>
  pipe(
    String.indexOf(separator)(text),
    Option.match({
      onNone: () => ({ head: text, rest: '' }),
      onSome: index => ({
        head: String.slice(0, index)(text),
        rest: String.slice(index + separator.length)(text),
      }),
    }),
  )

const bulletOf = (line: string): NewsBullet => {
  const { head, rest } = splitOnce(
    String.slice(BULLET_PREFIX.length)(line),
    ' ',
  )
  return { emoji: head, text: String.trim(rest) }
}

const rawDay = (draft: DraftDay) => {
  const { head, rest } = splitOnce(draft.heading, ': ')
  const lines = Array.filter(
    Array.map(draft.lines, String.trim),
    String.isNonEmpty,
  )
  return {
    date: String.trim(head),
    title: String.trim(rest),
    maybeIntro: pipe(
      Array.filter(lines, line => !isBullet(line)),
      Array.head,
    ),
    bullets: Array.map(Array.filter(lines, isBullet), bulletOf),
  }
}

// NOTE: CHANGELOG.md is the only source. Each `## <date>: <title>` heading
// starts a day, its first plain line is the intro, and each `- <emoji>
// <text>` line is a bullet. A day that does not decode, such as one with no
// bullets, is skipped instead of breaking the menu.
export const parseChangelog = (markdown: string): ReadonlyArray<NewsDay> =>
  pipe(
    draftDays(String.split(markdown, '\n')),
    Array.map(draft => Schema.decodeUnknownOption(NewsDay)(rawDay(draft))),
    Array.getSomes,
  )

export const NEWS_DAYS: ReadonlyArray<NewsDay> =
  parseChangelog(changelogMarkdown)

export const maybeNewestNewsDay: Option.Option<NewsDay> = Array.head(NEWS_DAYS)

// HEADLINES

const HEADLINE_MAX_WORDS = 7

// NOTE: a bullet's first clause, seven words at most, for the greeting after
// an update: "PLAY is one big arrow now" from the whole line.
export const newsHeadline = (text: string): string => {
  const clause = pipe(
    String.split(text, /[:,.;!?](?:\s|$)/),
    Array.headNonEmpty,
    String.trim,
  )
  const words = String.split(clause, /\s+/)
  return words.length > HEADLINE_MAX_WORDS
    ? `${Array.join(Array.take(words, HEADLINE_MAX_WORDS), ' ')}…`
    : clause
}
