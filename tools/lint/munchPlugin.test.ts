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
    "const next = modifyFocus(model, { shopCategory: () => 'Guns' })",
  ],
  invalid: [
    one("import { beginReload } from '../weapons'"),
    one('const next = modifyFields(model, { wallet: () => wallet })'),
    one('const next = modifyFocus(model, { player: player => player })'),
    one('const next = modifySeat(world, 1, { trapStock: () => stock })'),
    one(
      'const next = modifyFields(model, { seats: atSeat(1, { wallet: () => wallet }) })',
    ),
  ],
})

tester.run('key-action-once', ruleOf('key-action-once'), {
  valid: ["import { playerKeyAction } from '../keyActions'"],
  invalid: [one("import { isInteractTaken } from '../purchase'")],
})

tester.run('no-binding-field-write', ruleOf('no-binding-field-write'), {
  valid: [
    'const step = CoopBinding.requestKeepTracers(shot)',
    'const next = modifyFields(model, { cosmeticRngState: () => state })',
  ],
  invalid: [
    one(
      'const next = modifyFields(model, { coop: coop => keepTracers(coop) })',
    ),
    one('const next = modifyFields(model, { shopDialog: () => closed })'),
    one('const next = modifyFields(shop, { dialog: () => closed })'),
  ],
})

tester.run('live-test-note', ruleOf('live-test-note'), {
  valid: [
    "it.effect('waits on the TestClock', () => program)",
    "// NOTE: real document events.\nit.live('hears a release', () => program)",
  ],
  invalid: [one("it.live('hears a release', () => program)")],
})

tester.run('no-tag-chain on a tag string', ruleOf('no-tag-chain'), {
  valid: ["if (tag === 'Swap') { swap() }"],
  invalid: [
    one(
      "function f(tag) { if (tag === 'Swap') { return 1 } if (tag === 'Reload') { return 2 } return 0 }",
    ),
    one("if (kindTag === 'A') { a() } else if (kindTag === 'B') { b() }"),
  ],
})

tester.run('disable-needs-reason', ruleOf('disable-needs-reason'), {
  valid: [
    '// NOTE: the page owns this timer.\n// oxlint-disable-next-line no-restricted-globals\nsetTimeout(run, 10)',
    '// oxlint-disable-next-line no-shadow -- Effect names the interface after its namespace\ninterface Annotations {}',
  ],
  invalid: [
    one(
      '// oxlint-disable-next-line no-restricted-globals\nsetTimeout(run, 10)',
    ),
    // NOTE: written in two parts, so the Effect language service does not
    // read the string as a directive of this file's own.
    one(
      '// @effect-' +
        'diagnostics-next-line globalDate:off\nconst now = Date.now()',
    ),
  ],
})

tester.run('folder-imports', ruleOf('folder-imports'), {
  valid: [
    {
      code: "import { stepWorld } from '../step/stepWorld'",
      filename: '/repo/src/world/net/roomWorld.ts',
    },
    {
      code: "import { mulberry32 } from '../../shared/prng'",
      filename: '/repo/src/world/step/firing.ts',
    },
    {
      code: "import { Array } from 'effect'\nimport { modifyFields } from 'foldkit/struct'",
      filename: '/repo/src/world/step/firing.ts',
    },
    {
      code: "import type { Reader } from '@munch/netcode'",
      filename: '/repo/src/world/net/worldCodec.ts',
    },
    {
      code: "import { type Reader } from '@munch/netcode'",
      filename: '/repo/src/world/net/worldCodec.ts',
    },
    {
      code: "import { Model } from '../model'",
      filename: '/repo/src/app/update/play.ts',
    },
    {
      code: "import { home } from '../../test/model.fixture'",
      filename: '/repo/src/world/zombies/__tests__/boss.story.test.ts',
    },
    {
      code: "import { bossAt } from './boss.fixture'",
      filename: '/repo/src/world/zombies/__tests__/bossAttacks.story.test.ts',
    },
    {
      code: "import { Html } from 'foldkit/html'",
      filename: '/repo/src/features/home/homeView.ts',
    },
    {
      code: "import { Message } from '../message'",
      filename: '/repo/src/app/update/save.ts',
    },
    {
      code: "import { HomeMessage } from './message'",
      filename: '/repo/src/features/home/homeView.ts',
    },
    {
      code: "import { Message } from '../../app/message'",
      filename: '/repo/src/features/home/__tests__/home.story.test.ts',
    },
  ],
  invalid: [
    {
      code: "import type { Model } from '../../app/model'",
      filename: '/repo/src/world/step/simulation.ts',
      errors: 1,
    },
    {
      code: "export { screenOf } from '../render/screen'",
      filename: '/repo/src/world/names.ts',
      errors: 1,
    },
    {
      code: "import { PlayerInput } from '@munch/netcode'",
      filename: '/repo/src/world/net/roomWorld.ts',
      errors: 1,
    },
    {
      code: "import { Html } from 'foldkit/html'",
      filename: '/repo/src/world/step/firing.ts',
      errors: 1,
    },
    {
      code: "import { ZOMBIE_SPEED } from '../world/zombies/zombies'",
      filename: '/repo/src/shared/constants.ts',
      errors: 1,
    },
    {
      code: "const testing = import('../../test/testing')",
      filename: '/repo/src/features/home/update.ts',
      errors: 1,
    },
    {
      code: "import { atStall } from './__tests__/shop.fixture'",
      filename: '/repo/src/features/shop/update.ts',
      errors: 1,
    },
    {
      code: "import { Message } from '../../app/message'",
      filename: '/repo/src/features/home/homeView.ts',
      errors: 1,
    },
    {
      code: "import type { Message } from '../app/message.ts'",
      filename: '/repo/src/input/touchControls.ts',
      errors: 1,
    },
  ],
})
