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

tester.run('no-floating-story', ruleOf('no-floating-story'), {
  valid: [
    "it.effect('runs', () => Story.story(APPLICATION, Story.given(home)))",
    "it.effect('runs', () => { return Scene.scene(APPLICATION, Scene.given(home)) })",
    "it.effect.each(rows)('runs %s', row => Story.story(APPLICATION, Story.given(row)))",
    'it.effect("binds", () => Effect.gen(function* () { const done = yield* Story.story(APPLICATION, Story.given(home)); expect(done).toBe(home) }))',
    "it.effect('loops', () => Effect.forEach(SEEDS, seed => Story.story(APPLICATION, Story.given(seeded(seed)))))",
    "it.effect('all', () => Effect.all(Array.map(SEEDS, seed => Story.story(APPLICATION, Story.given(seeded(seed))))))",
    "it.effect('maps', () => Story.story(APPLICATION, Story.given(home)).pipe(Effect.map(done => done.phase)))",
    'const bulletsAfter = (model) => Story.story(APPLICATION, Story.given(model)).pipe(Effect.map(({ bullets }) => bullets))',
    "import { story } from 'foldkit/story'\nit.effect('bare', () => story(CO_OP, given(home)))",
    // NOTE: the plain form over an update function runs on the spot.
    "import { story } from 'foldkit/story'\ntest('plain', () => { story(update, given(home)) })",
    "import { scene } from 'foldkit/scene'\ntest('plain', () => { scene(ROOT, given(home)) })",
    "test('plain', () => { story(coopUpdate, given(home)) })",
    "test('plain', () => { Scene.scene({ update, view }, Scene.given(home)) })",
  ],
  invalid: [
    one(
      "test('never runs', () => Story.story(APPLICATION, Story.given(home)))",
    ),
    one(
      "it('never runs', () => { return Scene.scene(APPLICATION, Scene.given(home)) })",
    ),
    one(
      "it.effect('drops', () => Effect.gen(function* () { Array.forEach(SEEDS, seed => Story.story(APPLICATION, Story.given(seeded(seed)))) }))",
    ),
    one(
      "it.effect('drops', () => Effect.gen(function* () { Array.map(SEEDS, seed => Story.story(APPLICATION, Story.given(seeded(seed)))) }))",
    ),
    one(
      "it.effect('drops', () => Effect.gen(function* () { Story.story(APPLICATION, Story.given(home)) }))",
    ),
    one(
      "it.effect('drops', () => Effect.gen(function* () { SEEDS.forEach(function* (seed) { yield* Story.story(APPLICATION, Story.given(seed)) }) }))",
    ),
    one(
      "describe('a sweep', () => { Array.forEach(SEEDS, seed => { it.effect('x', () => Effect.void); Story.story(APPLICATION, Story.given(seed)) }) })",
    ),
    one(
      "import { story as runStory } from 'foldkit/story'\ntest('bare', () => runStory(CO_OP, given(home)))",
    ),
    one(
      "test('a Block', () => { Scene.scene({ block: ShopBlock, layer, viewInputs }, Scene.given(home)) })",
    ),
    one(
      "test('a spread config', () => { Scene.scene({ ...COOP, viewInputs }, Scene.given(home)) })",
    ),
  ],
})

tester.run('no-plain-story', ruleOf('no-plain-story'), {
  valid: [
    "import { Scene, Story } from 'foldkit'\nit.effect('runs', () => Story.story(APPLICATION, Story.given(home)))",
    "it.effect('a child', () => Scene.scene({ block: ShopBlock, layer, viewInputs }, Scene.given(home)))",
    "it.effect('a spread config', () => Scene.scene({ ...COOP, viewInputs }, Scene.given(home)))",
    "import { initialModel, subscriptions, type update } from '../app/pureApp'",
    "import type { update } from '../../app/pureApp'",
    // NOTE: a view of its own over the acquired root, a custom renderer.
    "it.effect('title', () => Story.withBlock(APPLICATION, block => Scene.scene({ update: block.update, view: titled(block.view) }, Scene.given(home))))",
  ],
  invalid: [
    one("import { story } from 'foldkit/story'"),
    one("import { given, scene } from 'foldkit/scene'"),
    one("import { initialModel, update } from '../../app/pureApp'"),
    one("import { init } from '../../../src/app/pureApp'"),
    one("test('plain', () => { Story.story(update, Story.given(home)) })"),
    one("test('plain', () => { Scene.scene(ROOT, Scene.given(home)) })"),
    one(
      "test('plain', () => { Scene.scene({ update, view }, Scene.given(home)) })",
    ),
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
      filename: '/repo/src/features/lobby/view.ts',
    },
    {
      code: "import { Message } from '../message'",
      filename: '/repo/src/app/update/save.ts',
    },
    {
      code: "import { HomeMessage } from './message'",
      filename: '/repo/src/features/home/homeSchema.ts',
    },
    {
      code: "import { Message } from '../../app/message'",
      filename: '/repo/src/features/home/__tests__/home.story.test.ts',
    },
    {
      code: "import type { Model } from '../app/model'",
      filename: '/repo/src/render/camera.ts',
    },
    {
      code: "import { type ApplicationViewBuilder } from '../../app/composition'",
      filename: '/repo/src/features/hud/wavePreview.ts',
    },
    {
      code: "import { iconView } from '../../ui/menuParts'\nimport { maybeRunRoom } from '../../model/onlineRun'",
      filename: '/repo/src/features/coop/view.ts',
    },
    {
      code: "import { hatRiseOf } from '../art/sprites/hatArt'\nimport { maybeRoomOf } from '../model/coopRoom'",
      filename: '/repo/src/render/partyView.ts',
    },
    {
      code: "import { HeroPickerBlock } from '../heroes/block'\nimport { isPickerOpen } from '../heroes/model'\nimport { PickOutcome } from '../heroes/inMessage'",
      filename: '/repo/src/features/lobby/steps.ts',
    },
    {
      code: "import { GuideLayer } from '../guide/layer'",
      filename: '/repo/src/features/munchopedia/layer.ts',
    },
    {
      code: "import { CharacterBlock } from './blocks/look/block'\nimport { cleanName } from '../../model/playerName'",
      filename: '/repo/src/features/profile/composition.ts',
    },
    {
      code: "import { hudShapes } from './hud'\nimport { endOverlayShapes } from '../../features/end/endView'",
      filename: '/repo/src/screens/game/overlay.ts',
    },
    {
      code: "import { isEndScreen } from '../../../model/run'",
      filename: '/repo/src/features/end/__tests__/endBeat.story.test.ts',
    },
    {
      code: "import { hudShapes } from '../../../screens/game/hud'\nimport { kitchenCall } from '../../kitchen/kitchenCall'",
      filename: '/repo/src/features/hud/__tests__/hud.scene.test.ts',
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
      filename: '/repo/src/features/home/homeSchema.ts',
      errors: 1,
    },
    {
      code: "import { atStall } from './__tests__/shop.fixture'",
      filename: '/repo/src/features/shop/update.ts',
      errors: 1,
    },
    {
      code: "import { Message } from '../../app/message'",
      filename: '/repo/src/features/end/endView.ts',
      errors: 1,
    },
    {
      code: "import type { Message } from '../app/message.ts'",
      filename: '/repo/src/input/keyGrab.ts',
      errors: 1,
    },
    {
      code: "import { worldLayerShapes } from '../app/worldView'",
      filename: '/repo/src/render/screen.ts',
      errors: 1,
    },
    {
      code: "import { maybeRoomOf } from '../features/coop/roomState'",
      filename: '/repo/src/render/partyView.ts',
      errors: 1,
    },
    {
      code: "import { stepWhen } from '../../app/stepWhen'",
      filename: '/repo/src/features/coop/update.ts',
      errors: 1,
    },
    {
      code: "import { type Model, DifficultyCard } from '../../app/model'",
      filename: '/repo/src/features/end/endView.ts',
      errors: 1,
    },
    {
      code: "import type { Model, Tour } from '../app/model'",
      filename: '/repo/src/platform/save.ts',
      errors: 1,
    },
    {
      code: "import type * as App from '../../app/model'",
      filename: '/repo/src/features/hud/hud.ts',
      errors: 1,
    },
    {
      code: "import type { CoopBinding } from '../../app/bindings'",
      filename: '/repo/src/features/end/endView.ts',
      errors: 1,
    },
    {
      code: "import { isAskingForFeedback } from '../features/home/home'",
      filename: '/repo/src/domain/run.ts',
      errors: 1,
    },
    {
      code: "import { isLearned } from '../onboarding/onboarding'",
      filename: '/repo/src/features/shop/stall.ts',
      errors: 1,
    },
    {
      code: "import type { Room } from '../coop/model'",
      filename: '/repo/src/features/end/crewAwards.ts',
      errors: 1,
    },
    {
      code: "import { specialsNoteOf } from '../heroes/callingSpecials'",
      filename: '/repo/src/features/lobby/view.ts',
      errors: 1,
    },
    {
      code: "import { GuideBlock } from '../guide/block'",
      filename: '/repo/src/features/lobby/bindings.ts',
      errors: 1,
    },
    {
      code: "import { HeroPickerBlock } from '../coop/block'",
      filename: '/repo/src/features/heroes/view.ts',
      errors: 1,
    },
    {
      code: "const view = import('../features/hud/hud')",
      filename: '/repo/src/render/juice.ts',
      errors: 1,
    },
    {
      code: "import { worldLayerShapes } from '../game/worldView'",
      filename: '/repo/src/screens/home/homeView.ts',
      errors: 1,
    },
    {
      code: "import { dialogShell } from '../../app/dialogs'",
      filename: '/repo/src/screens/home/homeView.ts',
      errors: 1,
    },
    {
      code: "import { hudShapes } from '../../screens/game/hud'",
      filename: '/repo/src/features/fridge/fridgeRevealView.ts',
      errors: 1,
    },
    {
      code: "import { overlayShapes } from '../screens/game/overlay'",
      filename: '/repo/src/render/juice.ts',
      errors: 1,
    },
  ],
})
