import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '../..')
const source = fs.readFileSync(path.join(root, 'src/workbench/NomiStudioApp.tsx'), 'utf8')
const view = fs.readFileSync(path.join(root, 'src/workbench/project/projectOpenView.ts'), 'utf8')
const hydration = source.slice(source.indexOf('const hydrateProjectView ='), source.indexOf('const openProject ='))

function hydrationCallback(text) {
  const tree = ts.createSourceFile('NomiStudioApp.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'hydrateProjectView') callback = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(callback, 'Shared production hydration callback is missing')
  return { tree, callback }
}

function assertAwaitedAdmission(text) {
  const { tree, callback } = hydrationCallback(text)
  const awaited = new Set()
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isAwaitExpression(node.parent)) awaited.add(node.expression.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(callback)
  for (const name of ['surfaceEpoch.waitUntilSuspended', 'openProjectAgentLane', 'recoverPendingProposalReceipt']) {
    assert.ok(awaited.has(name), `${name} must be awaited at the actual call site`)
  }
  const body = callback.body.statements.find(ts.isTryStatement).tryBlock.statements
  assert.equal(body[0].getText(tree), 'await surfaceEpoch.waitUntilSuspended()')
  assert.equal(body[1].getText(tree), 'surfaceEpoch.assertCurrent()')
  assert.equal(body[2].getText(tree), 'preloadProjectView()')
}

function compileFunction(expression, globals) {
  const exports = {}
  const compiled = ts.transpileModule(`export default (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, { ...globals, exports })
  return exports.default
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function flush() { for (let i = 0; i < 15; i += 1) await Promise.resolve() }

// Run the actual TS callback and actual lane owner, with deferred external ports.
// This does not mount React or replace a production hydration implementation.
function controlledHydration() {
  const acks = [deferred(), deferred()], lane = deferred(), recovery = deferred()
  const events = [], sequence = { current: 0 }, hydrating = { current: false }
  class Superseded extends Error {}
  let epochNumber = 0, opening = false
  const laneText = fs.readFileSync(path.join(root, 'src/workbench/project/projectAgentLaneOpen.ts'), 'utf8')
  const laneTree = ts.createSourceFile('lane.ts', laneText, ts.ScriptTarget.Latest, true)
  const laneFunction = laneTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openProjectAgentLane')
  const openProjectAgentLane = compileFunction(laneFunction.getText(laneTree).replace(/^export /, ''), { LaneCommandFailure: Error })
  const globals = {
    markProjectOpenStart() {}, hydrationSequenceRef: sequence, hydratingProjectRef: hydrating,
    projectSurface: { beginHydration() {
      const current = ++epochNumber
      return { waitUntilSuspended: () => acks[current - 1].promise,
        assertCurrent() { if (current !== epochNumber) throw new Superseded() },
        commitCanvasRead: async () => ({ binding: { workspaceId: 'fixture' } }),
      }
    } },
    setView: value => events.push(`view:${value}`), setOpeningProject: value => { opening = value; events.push(`opening:${value}`) },
    setFeedback() {}, preloadProjectView: () => events.push('preload'),
    laneClient: { context: () => null, open: () => { events.push('lane'); return lane.promise } },
    abandonPendingCanvasWrite() {}, clearCommittedProposal() {},
    ensureProjectPersistenceService: async () => ({ module: { consumeCategoryMigrationDiagnostic() {}, consumeRetiredStoryboardTableCount: () => 0 }, service: {} }),
    hydrateWorkbenchProjectWithRecovery: async () => ({ id: 'fixture' }), t: value => value, report() {}, refreshProjects() {},
    activeProjectIdRef: { current: null }, setActiveProject() {},
    measureProjectOpenStage: (_name, action) => action(), openProjectAgentLane,
    laneReceiptClient: { readProposalReceipt: async () => ({}) }, hydrateCommittedProposalReceipt() {},
    recoverPendingProposalReceipt: () => { events.push('recovery'); return recovery.promise },
    logRendererError() {}, markProjectOpenMoment() {}, navigate() {}, buildStudioUrl: id => id,
    runProjectAssetHealthCheck: async () => {}, notify() {}, ProjectHydrationSupersededError: Superseded, LaneCommandFailure: Error,
  }
  const { tree, callback } = hydrationCallback(source)
  return { run: compileFunction(callback.getText(tree), globals), acks, lane, recovery, events, hydrating, opening: () => opening, Superseded }
}

test('every shared hydration shows progress before awaiting main and keeps studio behind receipt recovery', () => {
  const progress = hydration.indexOf('setOpeningProject(true)')
  assert.ok(progress >= 0 && progress < hydration.indexOf('await surfaceEpoch.waitUntilSuspended()'), 'No visible opening state before the first main wait')
  assert.ok(hydration.indexOf('setView(\'studio\')') > hydration.indexOf('await recoverPendingProposalReceipt()'))
  assert.match(hydration, /hydrationSequenceRef\.current === hydrationSequence[\s\S]*setOpeningProject\(false\)/, 'A superseded hydration must not dismiss current progress')
  assert.match(source, /openingProject \? <GenerationCanvasLoading/)
})

test('generation chunk imports overlap hydration only after the outgoing Surface ACK', () => {
  assertAwaitedAdmission(source)
  assert.throws(() => assertAwaitedAdmission(source.replace('await openProjectAgentLane(', 'void openProjectAgentLane(')), /must be awaited/)
  assert.throws(() => assertAwaitedAdmission(source.replace('await surfaceEpoch.waitUntilSuspended()\n        surfaceEpoch.assertCurrent()', 'await surfaceEpoch.waitUntilSuspended()')), /assertCurrent/)
  const preload = hydration.indexOf('preloadProjectView()')
  assert.ok(preload > hydration.indexOf('await surfaceEpoch.waitUntilSuspended()'), 'View imports must not precede the suspend ACK')
  assert.ok(preload < hydration.indexOf('await ensureProjectPersistenceService()'), 'Required view chunks still wait behind disk/lane hydration')
  assert.match(view, /loadWorkbenchShell\(\)\.then\([\s\S]*preloadGenerationWorkspace/)
  assert.match(view, /loadGenerationCanvas\(\)\.then\([\s\S]*preloadGenerationCanvas/)
  assert.match(view, /workspaceMode === 'generation'/)
})

test('actual hydration waits for deferred ACK, lane and receipt recovery before exposing studio', async () => {
  const state = controlledHydration()
  const result = state.run('fixture')
  assert.equal(state.opening(), true)
  assert.deepEqual(state.events, ['view:library', 'opening:true'])
  state.acks[0].resolve(); await flush()
  assert.ok(state.events.includes('preload'))
  assert.ok(state.events.includes('lane'))
  assert.equal(state.events.includes('view:studio'), false)
  state.lane.resolve({ ok: true, workspaceId: 'fixture' }); await flush()
  assert.ok(state.events.includes('recovery'))
  assert.equal(state.events.includes('view:studio'), false)
  state.recovery.resolve()
  assert.equal(await result, true)
  assert.equal(state.events.includes('view:studio'), true)
  assert.equal(state.opening(), false)
})

test('superseded actual hydration cannot preload or dismiss the newer opening state', async () => {
  const state = controlledHydration()
  const old = state.run('old').catch(error => error)
  const current = state.run('new')
  state.acks[0].resolve()
  assert.ok(await old instanceof state.Superseded)
  assert.equal(state.events.includes('preload'), false)
  assert.equal(state.opening(), true)
  assert.equal(state.hydrating.current, true)
  state.acks[1].resolve(); state.lane.resolve({ ok: true, workspaceId: 'fixture' }); state.recovery.resolve()
  assert.equal(await current, true)
  assert.equal(state.opening(), false)
  assert.equal(state.events.filter(event => event === 'view:studio').length, 1)
})

test('the same production chunk factories serve preload and lazy render without optional feature imports', () => {
  assert.match(source, /lazyWithChunkBoundary\('工作台', loadWorkbenchShell\)/)
  assert.match(source, /lazyWithChunkBoundary\(\s*[^,]+,\s*loadGenerationCanvas/)
  const shell = fs.readFileSync(path.join(root, 'src/workbench/WorkbenchShell.tsx'), 'utf8')
  const canvas = fs.readFileSync(path.join(root, 'src/workbench/generationCanvas/components/GenerationCanvas.tsx'), 'utf8')
  assert.match(shell, /export const preloadGenerationWorkspace = \(\) => import\("\.\/generation\/GenerationWorkspace"\)/)
  assert.match(shell, /"生成区",\s*preloadGenerationWorkspace/)
  assert.match(canvas, /export const preloadGenerationCanvas = \(\) => import\('\.\.\/reactFlow\/GenerationCanvasReactFlow'\)/)
  assert.match(canvas, /lazyWithChunkBoundary\('React Flow 画布', preloadGenerationCanvas\)/)
  assert.doesNotMatch(view, /NomiMarkdown|CreationWorkspace|PreviewWorkspace|StoryboardWorkspace/)
})
