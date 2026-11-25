#!/usr/bin/env node
// Card 12 real-scale probe: the real built-in catalog, zero-credit draft_shots, 33 shots.
// The same script is run from the baseline and the changed worktree; its normalized snapshot is
// the byte-level acceptance artifact, while the guarded trace reports each catalog resolve.
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

import { DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, chooseAssistantModel, createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas } from './agent-runtime-walk-support.mjs'
import { prepareIsolatedCatalog, repoRoot } from './_launchApp.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const SHOT_COUNT = 33
const MARKER = 'CARD12_REAL_33_ZERO_CREDIT'
const PLAN_CALL = 'card12-real-33-plan'
const profilerModule = path.join(repoRoot, 'tests/ux/_card12CpuProfiler.cjs')
const tempDir = makeTempDir('nomi-card12-draft-shots-')
const profilePath = path.join(tempDir, 'draft.cpuprofile')
process.env.NOMI_WALK_OUT ||= tempDir
process.env.EVIDENCE_DIR ||= tempDir

function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (!fs.existsSync(file)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`)
      await new Promise((resolve) => setImmediate(resolve))
    }
  })()
}

function topCpuFunctions(profile, count = 5) {
  const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node.callFrame]))
  const totals = new Map()
  for (let index = 0; index < (profile.samples ?? []).length; index += 1) {
    const frame = nodes.get(profile.samples[index])
    if (!frame) continue
    const key = `${frame.functionName || '(anonymous)'} @ ${frame.url || '[native]'}`
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0))
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([functionName, microseconds]) => ({ functionName, microseconds }))
}

function stableRunSnapshot(run) {
  return {
    status: run?.status,
    generationPlan: run?.generationPlan,
    jobs: run?.jobs ?? [],
  }
}

const walk = await createRuntimeWalk('card12-draft-shots-performance', {
  generationProvider: 'apimart',
  mainRequire: [profilerModule],
  env: {
    NOMI_CARD12_TRACE: '1',
    NOMI_CARD12_CPU_PROFILE: profilePath,
  },
})
prepareIsolatedCatalog(walk.settingsDir)

let failure
try {
  const { win, app } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)

  const draftShots = Array.from({ length: SHOT_COUNT }, (_, index) => ({
    title: `真实目录镜 ${index + 1}`,
    prompt: `CARD12 real catalog shot ${index + 1}`,
    taskKind: 'text_to_image',
    model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`,
  }))
  const planner = walk.fixture.expectText({
    label: 'the real 33-shot zero-credit draft request',
    match: (body) => flattenRequestText(body).includes(MARKER),
    reply: {
      type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
        shots: draftShots,
      },
    },
  })
  const drafted = walk.fixture.expectText({
    label: 'the real 33-shot draft result',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL),
    reply: { type: 'text', text: 'CARD12_REAL_33_DONE：33 镜草稿已建立，未生成。' },
  })

  const beforeMs = performance.now()
  app.process().kill('SIGUSR1')
  await sendCanvas(win, `${MARKER}：建立 33 镜草稿，不要生成，不要调用供应商。`)
  await recorded(planner.received, 'real 33-shot draft request', DEFAULT_TIMEOUT_MS)
  const result = await recorded(drafted.received, 'real 33-shot draft result', stationTimeout({ operations: 4 }))
  const draftMessage = result.body.messages.find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
  const draftText = flattenRequestText({ messages: [draftMessage] })
  const operationId = /"operationId":"([^"]+)"/.exec(draftText)?.[1]
  expect(operationId, draftText).toBeTruthy()
  const afterMs = performance.now()
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length, { timeout: DEFAULT_TIMEOUT_MS }).toBe(SHOT_COUNT)
  app.process().kill('SIGUSR2')
  await waitForFile(profilePath)

  const project = await readProject(win, projectId)
  const runPath = path.join(walk.report.projectRoot, '.nomi', 'runs', operationId, 'run.json')
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8')).run
  expect(run.generationPlan?.shots).toHaveLength(SHOT_COUNT)
  expect(walk.fixture.images).toHaveLength(0)
  const catalog = JSON.parse(fs.readFileSync(path.join(walk.settingsDir, 'model-catalog.json'), 'utf8'))
  const snapshot = {
    catalog: {
      version: catalog.version,
      vendors: catalog.vendors,
      models: catalog.models,
      mappings: catalog.mappings,
    },
    draft: stableRunSnapshot(run),
    nodeCount: project.payload.generationCanvas.nodes.length,
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  const report = {
    shots: SHOT_COUNT,
    baselineNote: 'Acceptance asks for ~2 min to <10 s; this run records the measured wall time even when baseline is below one minute.',
    elapsedMs: Number((afterMs - beforeMs).toFixed(3)),
    cpuTop5: topCpuFunctions(profile),
    shotResolveTrace: 'See NOMI_CARD12_TRACE=1 card12-shot-resolve lines in the process log; one line per shot.',
    zeroCredit: walk.fixture.images.length === 0,
    textRequests: walk.fixture.requests.length,
    imageRequests: walk.fixture.images.length,
    snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    snapshot,
  }
  fs.writeFileSync(path.join(walk.outputDir, 'card12-real-33-report.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(walk.outputDir, 'card12-real-33-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n')
  walk.report.card12 = report
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
