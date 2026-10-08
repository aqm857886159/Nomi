// 目录自检先验它会红：每一条规则都拿一份故意写坏的目录喂进去，必须报出那一条。
import assert from 'node:assert/strict'
import test from 'node:test'

import { CLICK_TARGET_CONTRACT, FULL_WALK_INVENTORY, FULL_WALK_JOURNEYS, FULL_WALK_PLAYBOOKS, STORYBOARD_CLICK_TARGETS } from '../tests/ux/full-walk/catalog.mjs'
import { loadDictionaries } from '../tests/ux/full-walk/invariants.mjs'
import { USER_REPORTED_ISSUES } from '../tests/ux/full-walk/userReports.mjs'
import { checkFullWalkCatalog, checkRuleRegistry, hasI18nKey, loadTelemetryEventNames, symbolDeclared } from './check-full-walk-catalog.mjs'

const dictionaries = loadDictionaries()
const telemetryEvents = loadTelemetryEventNames()
const check = (catalog) => checkFullWalkCatalog(catalog, { dictionaries, telemetryEvents })
const real = { journeys: FULL_WALK_JOURNEYS, playbooks: FULL_WALK_PLAYBOOKS, inventory: FULL_WALK_INVENTORY, clickTargets: STORYBOARD_CLICK_TARGETS, clickContract: CLICK_TARGET_CONTRACT }
const clone = (value) => JSON.parse(JSON.stringify(value))

test('the checked-in catalog holds', () => {
  assert.deepEqual(check(real), [])
})

test('an owner symbol that is not declared in its file is caught', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  journeys[0].states[0].owner = 'src/workbench/observability/narrate.ts#noSuchNarrator'
  assert.match(check({ ...real, journeys }).join('\n'), /没有声明 noSuchNarrator/)
})

test('duplicate playbook scripts are caught so script numbers stay unique', () => {
  const playbooks = clone(FULL_WALK_PLAYBOOKS)
  playbooks[1].script = playbooks[0].script
  assert.match(check({ ...real, playbooks }).join('\\n'), /script 重复/)
})

test('a journey without any script is caught', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  journeys[1].scripts = []
  assert.match(check({ ...real, journeys }).join('\n'), /至少挂一条剧本/)
})

test('a non-terminal state without a deadline is caught, and a system state cannot claim to wait for the user', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  const queued = journeys[0].states.find((state) => state.id === 'queued')
  delete queued.deadline
  assert.match(check({ ...real, journeys }).join('\n'), /非终态必须写 deadline/)
  queued.deadline = { waitsFor: 'user' }
  assert.match(check({ ...real, journeys }).join('\n'), /只有用户态能写「等用户」/)
  queued.deadline = { ref: 'src/workbench/generationCanvas/runner/generationPhaseDeadline.ts#GENERATION_PHASE_DEADLINE', key: 'no-such-phase' }
  assert.match(check({ ...real, journeys }).join('\n'), /没有「no-such-phase」这一格/)
})

test('a visible-text key missing from either dictionary is caught', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  journeys[0].states[0].visibleText = ['generationCommon.noSuchKey']
  const problems = check({ ...real, journeys }).join('\n')
  assert.match(problems, /generationCommon\.noSuchKey 在 zh-CN/)
  assert.match(problems, /generationCommon\.noSuchKey 在 en/)
})

test('a metric event that telemetry does not register is caught', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  journeys[0].metric = { success: 'generation.finished{result=success}', failure: 'generation.completed{result=failure}' }
  assert.match(check({ ...real, journeys }).join('\n'), /generation\.finished 不在/)
})

test('an orphan playbook and an inventory row with neither journey nor gap are caught', () => {
  const journeys = clone(FULL_WALK_JOURNEYS)
  for (const journey of journeys) journey.scripts = journey.scripts.filter((script) => !script.includes('pb06'))
  assert.match(check({ ...real, journeys }).join('\n'), /pb06-failure-small-window：没有挂在任何一条旅程上/)
  const inventory = clone(FULL_WALK_INVENTORY)
  delete inventory[0].gap
  assert.match(check({ ...real, inventory }).join('\n'), /要么挂一条旅程（journey），要么写 gap/)
})

test('every rule named in the user-issue register is classified, and an unclassified rule is caught', () => {
  assert.deepEqual(checkRuleRegistry({ issues: USER_REPORTED_ISSUES }), [])
  const issues = [{ id: 'U99', rules: ['card-scope-mismatch', 'made-up-rule'] }]
  assert.deepEqual(checkRuleRegistry({ issues }), ['用户问题 U99：规则 made-up-rule 没在 rules.mjs 登记底层设计问题'])
})

test('a rule literal in walk source that is not classified is caught; surface-* is one family', () => {
  const sources = [{ file: 'tests/ux/full-walk/playbooks/pbXX.walk.mjs', text: "await monitor.violate({ invariant: 4, rule: 'invented-claim', key: 'x' })\nconst known = { rule: 'surface-rightPanel' }" }]
  assert.deepEqual(checkRuleRegistry({ sources }), ['tests/ux/full-walk/playbooks/pbXX.walk.mjs：规则 invented-claim 没在 rules.mjs 登记底层设计问题'])
})

test('helpers: declarations and plural keys', () => {
  assert.equal(symbolDeclared('export default function Foo() {}', 'Foo'), true)
  assert.equal(symbolDeclared('const POLL_DELAY_CAP_MS = 15_000;', 'POLL_DELAY_CAP_MS'), true)
  assert.equal(symbolDeclared('// function Ghost() {}', 'Ghost'), false)
  assert.equal(hasI18nKey({ a: { b_one: 'x' } }, 'a.b'), true)
  assert.equal(hasI18nKey({ a: {} }, 'a.b'), false)
})

test('⑫ click targets: a row without a user expectation, an empty observation or a dangling owner is caught', () => {
  assert.ok(STORYBOARD_CLICK_TARGETS.length >= 6, '分镜表的可点目标至少登记行、镜号、复选框、⋯、参数格、生成')
  const clickTargets = clone(STORYBOARD_CLICK_TARGETS)
  clickTargets[0].userExpectation = ''
  clickTargets[1].actualObservation = ' '
  clickTargets[2].owner = 'src/workbench/creation/storyboard/StoryboardShotTable.tsx#noSuchTable'
  delete clickTargets[3].useCases
  const problems = check({ ...real, clickTargets }).join('\n')
  assert.match(problems, /userExpectation 要写一句/)
  assert.match(problems, /actualObservation 不许空着/)
  assert.match(problems, /没有声明 noSuchTable/)
  assert.match(problems, /缺 useCases 列/)
})
