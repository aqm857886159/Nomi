import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { createReleaseCoreSteps } from './_releaseCoreCompareSteps.mjs'

export async function runReleaseCoreCompare(mode, openPaid) {
  const { values } = parseArgs({ options: { 'target-root': { type: 'string' }, commit: { type: 'string' }, output: { type: 'string' }, locale: { type: 'string', default: 'zh-CN' } } })
  assert.ok(path.isAbsolute(values['target-root'] ?? ''), '--target-root must be absolute')
  assert.match(values.commit ?? '', /^[a-f0-9]{40}$/, '--commit requires the archived source SHA')
  assert.ok(path.isAbsolute(values.output ?? ''), '--output must be an absolute evidence directory')
  assert.ok(['zh-CN', 'en'].includes(values.locale), 'Supported locales: zh-CN, en')
  if (mode === 'paid') assert.equal(values.locale, 'zh-CN', 'The paid comparison uses identical Chinese inputs')
  else assert.notEqual(process.env.NOMI_SPEND_OK, '1', 'Rehearsal must not opt in to spending')
  const root = fs.realpathSync(values['target-root']), out = path.resolve(values.output)
  assert.ok(!fs.existsSync(path.join(out, 'result.json')), 'Never overwrite a comparison receipt')
  fs.mkdirSync(out, { recursive: true })
  process.chdir(out)
  const scratch = path.join(out, 'scratch')
  fs.mkdirSync(scratch, { recursive: true })
  process.env.TMPDIR = scratch
  // Both older harnesses parse argv themselves; comparison options belong only to this driver.
  process.argv = process.argv.slice(0, 2)
  const load = relative => import(pathToFileURL(path.join(root, relative)).href)
  const { createRuntimeWalk } = await load('tests/ux/agent-runtime-walk-support.mjs')
  const { assertPaidBuildReady, DEFAULT_PAID_BRAIN, spendReceipt } = await load('tests/ux/_paidRun.mjs')
  // Install only shared test instrumentation beside the target's test dependencies, never product code.
  for (const name of ['Proxy', 'Hosting']) fs.copyFileSync(new URL(`./_generationLockExit${name}.mjs`, import.meta.url), path.join(root, `tests/ux/.releaseCore${name}.mjs`))
  const { createGenerationLockExitProxy } = await load('tests/ux/.releaseCoreProxy.mjs')
  const { draftTask, seedBatch, batchTask } = await createReleaseCoreSteps(load)
  assertPaidBuildReady(root, { markers: ['data-storyboard-batch'] })
  const bytes = fs.readFileSync(new URL('./release-core-compare.input.json', import.meta.url))
  const input = JSON.parse(bytes)
  const contract = { inputHash: createHash('sha256').update(bytes).digest('hex'), brain: DEFAULT_PAID_BRAIN, image: input.image, parameters: input.parameters,
    language: 'zh', locale: values.locale, draftTurns: 1, maxImages: 5 }
  const result = { schema: 1, mode, commit: values.commit, complete: false, contract, build: JSON.parse(fs.readFileSync(path.join(root, 'dist/build-stamp.json'))),
    draft: null, batch: null, startedAt: new Date().toISOString() }
  let paid, walk, proxy, failure
  const launchEnv = {}
  try {
    if (mode === 'paid') {
      paid = await openPaid(load, 'release-core-compare.paid.mjs', 'release-core-compare', [DEFAULT_PAID_BRAIN, input.image], {
        buildMarkers: ['data-storyboard-batch'], argv: [],
        createWalk: async (name, options) => {
          Object.assign(launchEnv, options.env)
          return createRuntimeWalk(name, { ...options, env: launchEnv })
        },
      })
      walk = paid.walk
      const target = walk.report.networkAllowlist.find(origin => origin === 'https://api.apimart.ai')
      assert.ok(target, 'Authorized image/text upstream origin is missing')
      proxy = await createGenerationLockExitProxy({ target, imageModel: input.image.modelKey, maxImages: 5 })
      proxy.setLimit(5)
      Object.assign(launchEnv, { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: target, to: proxy.origin }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: [proxy.origin, walk.fixture.baseURL].join(',') })
    } else {
      walk = await createRuntimeWalk('release-core-compare', { generationProvider: 'apimart', trustFixtureOrigin: true, env: { NOMI_WALK_ALLOW_ORIGINS: '' } })
      // Only isolated fixture settings change; the tested application and its catalog code stay intact.
      const file = path.join(walk.settingsDir, 'model-catalog.json')
      const catalog = JSON.parse(fs.readFileSync(file))
      const template = catalog.models.find(row => row.kind === 'text')
      catalog.models = catalog.models.filter(row => !(row.vendorKey === DEFAULT_PAID_BRAIN.vendorKey && row.modelKey === DEFAULT_PAID_BRAIN.modelKey))
      catalog.models.push({ ...template, ...DEFAULT_PAID_BRAIN, labelZh: 'Release comparison brain', enabled: true, published: true })
      fs.writeFileSync(file, JSON.stringify(catalog))
    }
    let { win, app } = await walk.start({ first: true })
    const launchedRoot = await app.evaluate(({ app }) => app.getAppPath())
    assert.equal(fs.realpathSync(launchedRoot), root, 'The archived version must actually be launched')
    await win.evaluate(locale => { localStorage.setItem('nomi:locale:v1', locale); localStorage.setItem('__nomiE2E', '1') }, values.locale)
    await win.reload()
    if (paid) await paid.lockToAuthorizedModels(win)
    const brainLabel = paid ? paid.label(DEFAULT_PAID_BRAIN.vendorKey, DEFAULT_PAID_BRAIN.modelKey) : 'Release comparison brain'
    console.log(`[release-core] ${mode} ${values.locale}: draft`)
    result.draft = await draftTask({ walk, win, input, brainLabel, rehearsal: mode === 'rehearsal', locale: values.locale })
    assert.equal(proxy ? proxy.records.length : walk.fixture.images.length, 0, 'No image requests during the draft')
    const draftRoot = result.draft.project.projectRoot
    result.draftSpend = spendReceipt(draftRoot)
    assert.equal((await win.evaluate(id => window.nomiDesktop.projects.readAsync(id), result.draft.project.projectId)).payload.generationCanvas?.nodes?.filter(n => n.runs?.length || n.result).length ?? 0, 0, 'Draft must not submit media')
    await walk.stopApp()
    const batch = seedBatch(walk, input)
    Object.assign(walk.report, { projectId: batch.projectId, projectRoot: batch.projectRoot })
    ;({ win } = await walk.start())
    console.log(`[release-core] ${mode} ${values.locale}: batch`)
    result.batch = await batchTask({ walk, win, input, batch })
    for (const shot of result.batch.shots.filter(shot => shot.nodeId)) {
      assert.equal(shot.modelVendor, input.image.vendorKey)
      assert.equal(shot.modelKey, input.image.modelKey)
      assert.deepEqual(shot.params, input.parameters, 'Actual node parameters must match the fixed input')
    }
    result.complete = true
    result.requests = proxy ? proxy.records : walk.fixture.images.map(row => ({ path: row.path, body: row.body, taskId: row.taskId }))
    assert.ok(result.requests.length <= 5, 'Five images maximum')
    if (mode === 'rehearsal') {
      assert.equal(result.draft.success, true)
      assert.equal(result.draft.shotCount, 4)
      assert.equal(result.draft.failures, 0)
      assert.deepEqual(result.batch.shots.map(shot => shot.outcome), Array(5).fill('success'))
      assert.equal(result.batch.busyReleased, true)
      assert.equal(result.requests.length, 5)
    }
    fs.cpSync(path.join(draftRoot, '.nomi/agent-sessions'), path.join(out, 'draft-transcripts'), { recursive: true })
    fs.copyFileSync(path.join(batch.projectRoot, '.nomi/project.json'), path.join(out, 'batch-project.json'))
  } catch (error) {
    failure = error
    result.complete = false
    result.error = error.stack
    process.exitCode = 1
  } finally {
    if (walk) {
      walk.report.releaseCoreCompare = result
      try { if (paid) await paid.finish(failure); else await walk.finish(failure) }
      catch (error) { result.complete = false; result.teardownError = error.stack; process.exitCode = 1 }
      if (walk.report.result !== 'passed') { result.complete = false; process.exitCode = 1 }
      fs.cpSync(walk.outputDir, path.join(out, 'runtime'), { recursive: true })
    }
    if (proxy) await proxy.close()
    if (walk) result.screenshots = fs.readdirSync(walk.outputDir).filter(name => name.endsWith('.png')).map(name => path.join(out, 'runtime', name))
    result.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  console.log(`${mode}: ${result.complete ? 'complete' : 'partial'}; ${path.join(out, 'result.json')}`)
}
