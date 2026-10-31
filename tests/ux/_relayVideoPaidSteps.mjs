import path from 'node:path'
import fs from 'node:fs'
import { expect } from './_assert.mjs'
import { relayDeclaration } from './_relayVideoFixture.mjs'
import { relayModelClient, prepareRelayVideo, generateRelayVideo, createRelayProject } from './_relayVideoWalk.mjs'
import { configureRelayMinimumThroughVisibleUi } from './_relayVideoCapabilityUi.mjs'
import { lockSpendToModels } from './_paidRun.mjs'
import { readAuthorizedRows } from './_paidEnvKey.mjs'

export async function runRelayVideoPaidSteps({ paid, win, plan, mcpEnv = {}, readCreates, readCreateBodies, freeOnly = false }) {
  const { walk } = paid
  await paid.lockToAuthorizedModels(win) // includes the visible credential page owned by _paidEnvKey
  const card = relayDeclaration(plan.baseUrl, { id: plan.modelKey, shape: plan.shape, queryPath: plan.queryPath })
  card.sources = [{ url: plan.sourceUrl, evidence: 'Explicit creation, query, output URL and documented minimum settings' }]
  card.models[0].modes[0].sourceUrls = [plan.sourceUrl]
  Object.assign(card.models[0].modes[0].create.body, { duration: plan.duration, resolution: plan.resolution, aspect_ratio: '16:9', audio: false })
  card.models[0].parameters[0].min = plan.duration
  card.models[0].parameters[0].default = plan.duration
  card.models[0].parameters[1].options = [{ value: plan.resolution, label: plan.resolution }]
  card.models[0].parameters[1].default = plan.resolution
  const client = await relayModelClient({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, tempRoot: walk.report.tempRoot,
    env: { NOMI_WALK_ALLOW_ORIGINS: (walk.report.networkAllowlist ?? []).join(','), ...mcpEnv } })
  try {
    walk.report.declaration = await client.call('nomi_model_setup', { action: 'submit_declaration', vendorKey: plan.vendorKey, declaration: JSON.stringify(card) })
  } finally { await client.close() }
  const model = { vendorKey: plan.vendorKey, modelKey: plan.modelKey }
  // The new row did not exist at the initial credential lock. Reuse its owner after declaring it.
  walk.report.disabledAfterDeclaration = await lockSpendToModels(win, await readAuthorizedRows(win, [model]))
  const capture = (tag) => walk.snap(`relay-${tag}`)
  walk.report.inputPreparation = await configureRelayMinimumThroughVisibleUi(win, plan, capture)
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model, capture })
  // A newly selected model may retain the node's previous values. Set the minimum visibly.
  await prepared.node.locator('[data-parameter-summary]').click()
  const duration = win.locator('[data-agent-parameter-panel] [data-agent-parameter-control="duration"]')
  const slider = duration.getByRole('slider')
  if (await slider.count()) await slider.press('Home')
  else await duration.getByRole('spinbutton').fill(String(plan.duration))
  const resolution = win.locator('[data-agent-parameter-panel] [data-agent-parameter-control="resolution"]')
  if (await resolution.count()) await resolution.getByRole('radio', { name: plan.resolution, exact: true }).click()
  await win.keyboard.press('Escape')
  await capture('minimum-settings')
  walk.report.freeSegment = { prepared: true, settings: { duration: plan.duration, resolution: plan.resolution, audio: false }, nodeId: prepared.nodeId }
  // Exact minimums are sealed in this one declaration: no paid try_model, no alternative-route POST.
  expect(card.models[0].modes[0].create.body.duration).toBe(plan.duration)
  expect(card.models[0].modes[0].create.body.resolution).toBe(plan.resolution)
  const visibleSettings = await prepared.node.locator('[data-node-composer-footer]').innerText()
  expect(visibleSettings, 'the visible minimum resolution agrees with the sealed request').toContain(plan.resolution)
  expect(visibleSettings, 'the visible minimum duration agrees with the sealed request').toMatch(new RegExp(`(^|\\D)${plan.duration}(?:s|秒|\\s*sec)`))
  expect(readCreates(), 'free preparation has not submitted a generation').toBe(0)
  if (freeOnly) { walk.report.stoppedBeforeGeneration = true; return { projectRoot: prepared.projectRoot, nodeId: prepared.nodeId } }
  walk.report.landed = await generateRelayVideo({ win, prepared, capture })
  expect(readCreates(), 'the whole script submits exactly one generation').toBe(1)
  expect(readCreateBodies(), 'the actual request uses the visible minimum settings').toEqual([
    expect.objectContaining({ model: plan.modelKey, duration: plan.duration, resolution: plan.resolution, audio: false }),
  ])
  walk.report.generationCreateCount = readCreates()
  fs.copyFileSync(walk.report.landed.media.filePath, path.join(walk.outputDir, 'landed.mp4'))
  const { readProductionRuns } = await import('./_paidRun.mjs')
  const tasks = new Set(readProductionRuns(prepared.projectRoot).flatMap((run) => run.jobs ?? []).map((job) => job.providerTaskId).filter(Boolean))
  expect(tasks.size, 'the single generation creates exactly one provider task').toBe(1)
  walk.report.providerTaskIds = [...tasks]
  return { projectRoot: path.resolve(prepared.projectRoot), nodeId: prepared.nodeId }
}
