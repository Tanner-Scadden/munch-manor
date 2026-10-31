import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'

import munch from './munchPlugin'

// NOTE: each rule of the project's oxlint plugin on the old pattern it was
// written against, and on the shape that replaced it.
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: 'ts' } },
})

const ruleOf = (name: string) => {
  const rule = munch.rules[name]
  if (rule === undefined) {
    throw new Error(`munch has no rule ${name}`)
  }
  return rule
}

const one = (code: string) => ({ code, errors: 1 })

tester.run('no-tag-chain', ruleOf('no-tag-chain'), {
  valid: [
    "if (x._tag === 'A') { a() }",
    "if (x._tag === 'A') { a() } else if (y._tag === 'B') { b() }",
    "const v = x._tag === 'A' ? 1 : 2",
  ],
  invalid: [
    one("if (x._tag === 'A') { a() } else if (x._tag === 'B') { b() }"),
    one(
      "function f() { if (x._tag === 'A') { return 1 } if (x._tag === 'B') { return 2 } return 3 }",
    ),
    one("const v = x._tag === 'A' ? 1 : x._tag === 'B' ? 2 : 3"),
  ],
})

tester.run('no-extract-tag', ruleOf('no-extract-tag'), {
  valid: ['type Turret = typeof Trap.Turret.Type'],
  invalid: [
    one("type Turret = Extract<Trap, { _tag: 'Turret' }>"),
    one("type Turret = Extract<Trap, Readonly<{ _tag: 'Turret' }>>"),
  ],
})

tester.run('no-raw-json', ruleOf('no-raw-json'), {
  valid: ['const text = Schema.encodeSync(Schema.fromJsonString(Save))(save)'],
  invalid: [one('JSON.parse(text)'), one('globalThis.JSON.stringify(value)')],
})

tester.run('no-conditional-step', ruleOf('no-conditional-step'), {
  valid: ['const result = stepWhen(isDue, step)(model)'],
  invalid: [
    one('const result = isDue ? step(model) : { model }'),
    one(
      'const result = isDue ? unchanged(model) : playSounds(cues)(keep(model))',
    ),
  ],
})

tester.run('no-world-spread', ruleOf('no-world-spread'), {
  valid: ['const next = withWorld(model, step)', 'const copy = { ...world }'],
  invalid: [
    one('const next = { ...model, ...world }'),
    one('const next = { ...model, ...result.world }'),
  ],
})

tester.run('no-menu-field', ruleOf('no-menu-field'), {
  valid: [
    'const open = isProfileOpen(model)',
    'const open = model.door.isOpen',
  ],
  invalid: [
    one('const open = model.profileDialog.isOpen'),
    one('const screen = model.coop.screen'),
  ],
})

tester.run('command-beside-update', ruleOf('command-beside-update'), {
  valid: [
    "const WriteSave = makeCommand('WriteSave', {}); const step = () => WriteSave(save)",
  ],
  invalid: [one("const WriteSave = Definition.makeCommand('WriteSave', {})")],
})

tester.run('no-run-in-tests', ruleOf('no-run-in-tests'), {
  valid: ['it.effect(() => Effect.gen(function* () { yield* program }))'],
  invalid: [
    one('await Effect.runPromise(program)'),
    one("import { runSync } from 'effect/Effect'"),
    {
      code: 'const runtime = ManagedRuntime.make(layer); await runtime.runPromise(program)',
      errors: 2,
    },
    one('Runtime.runFork(runtime)(program)'),
  ],
})

tester.run('tap-by-click', ruleOf('tap-by-click'), {
  valid: ['const attributes = [OnClick(Pressed()), OnPointerDown(Held())]'],
  invalid: [one('const attributes = [h.OnPointerUp(Released())]')],
})

tester.run('seat-action-once', ruleOf('seat-action-once'), {
  valid: [
    "import { actAsLead } from './action'",
    'const next = modifyFields(model, { hitStop: () => 0 })',
  ],
  invalid: [
    one("import { beginReload } from '../weapons'"),
    one('const next = modifyFields(model, { wallet: () => wallet })'),
  ],
})
