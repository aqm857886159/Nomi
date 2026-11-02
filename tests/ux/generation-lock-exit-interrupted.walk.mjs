#!/usr/bin/env node
// 验收线提供的回归走查：真窗 + 假服务商。图片 POST 还压在代理里时进程没了，重启后这一节点还能不能再发。
// 用法：node i6-quit-during-post.walk.mjs sigkill|window-close   （从 PR 工作树目录运行）
// 模拟的是同步图片供应商：POST 的寿命 = 整个生成时长。代理回复压 12 秒，比退出时长长。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const { expect } = await import(`${ROOT}/node_modules/@playwright/test/index.mjs`)
const { stationTimeout } = await import(`${ROOT}/tests/ux/_station-budget.mjs`)
const { registerTestTemp } = await import(`${ROOT}/scripts/_test-temp.mjs`)
const { launchNomiApp, closeNomiApp, descendantPids } = await import(`${ROOT}/tests/ux/_launchApp.mjs`)
const { newProjectEntry, canvasFitView, closeRailDrawer, collapseAgentPanel, switchWorkspace, switchGenerationView } = await import(`${ROOT}/tests/ux/_shell.mjs`)
const { createAgentRuntimeFixture, FIXTURE_APIMART_API_KEY, FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL } = await import(`${ROOT}/tests/ux/agent-runtime-fixture.mjs`)
const { createGenerationLockExitProxy } = await import(`${ROOT}/tests/ux/_generationLockExitProxy.mjs`)
const { prepareLockExitStoryboard } = await import(`${ROOT}/tests/ux/_generationLockExitSteps.mjs`)
const { readProject } = await import(`${ROOT}/tests/ux/agent-runtime-walk-support.mjs`)
const { openStoryboardEditor } = await import(`${ROOT}/tests/ux/_creationResourceTree.mjs`)
const { waitForVisualQuiescence } = await import(`${ROOT}/tests/ux/_assert.mjs`)
const { uiText } = await import(`${ROOT}/tests/ux/full-walk/invariants.mjs`)

const MODE = ['window-close', 'reload'].includes(process.argv[2]) ? process.argv[2] : 'sigkill'
const POST_LIFE_MS = 12_000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const locale = process.env.NOMI_LOCK_EXIT_LOCALE ?? 'zh-CN'
const t = key => uiText(locale, key)
const out = path.resolve(process.env.NOMI_LOCK_EXIT_OUT)
const shots = path.resolve(process.env.NOMI_LOCK_EXIT_SHOTS)
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(shots, { recursive: true })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const tempRoot = registerTestTemp(fs.mkdtempSync(path.join(out, 'isolated-i6-')))
const settingsDir = path.join(tempRoot, 'settings'), userDataDir = path.join(tempRoot, 'user-data'), projectsDir = path.join(tempRoot, 'projects')
const fixture = await createAgentRuntimeFixture({ rootDir: ROOT, settingsDir, userDataDir, appName: 'nomi', generationProvider: 'apimart' })
const proxy = await createGenerationLockExitProxy({ target: fixture.baseURL, imageModel: FIXTURE_APIMART_MODEL, fakeDelayMs: POST_LIFE_MS })
let app, page, project
const launch = async () => {
  const started = await launchNomiApp({ name: 'generation-lock-exit', tempRoot, settingsDir, userDataDir, projectsDir, settleMs: 0, viewportSize: { width: 1280, height: 860 },
    mainRequire: [path.join(ROOT, 'scripts/walkthrough-network-guard.cjs'), path.join(ROOT, 'tests/ux/_quietWalk.cjs')],
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_FIXTURE_BASE_URL: proxy.origin,
      NOMI_E2E_FIXTURE_API_KEY: FIXTURE_APIMART_API_KEY, NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: [fixture.baseURL, proxy.origin].join(','),
      NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: proxy.origin }, { from: fixture.baseURL, to: proxy.origin }]) },
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' }, args: ['--no-proxy-server'] })
  app = started.app; page = started.win
  page.setDefaultTimeout(stationTimeout({ operations: 3 }))
}
const reopen = async () => { await launch(); await page.locator('[data-project-card]', { hasText: project.name }).first().click() }
/** 只杀自己起的这棵进程树，按 PID。 */
const killOwnTree = async () => {
  const child = app.process(), pids = [child.pid, ...descendantPids(child.pid)]
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* 已经没了 */ } }
  for (const stream of [child.stdin, child.stdout, child.stderr]) { try { stream?.destroy() } catch { /* 已关 */ } }
  try { child.unref() } catch { /* 没句柄 */ }
  app = null
  await sleep(500)
}
/** 用户点窗口的 X：渲染层弹确认 → 确认 → 关窗；Windows 上窗口全关就退出，这里手动走同一步。 */
const closeLikeUser = async () => {
  const child = app.process()
  const exited = new Promise(resolve => child.once('exit', () => resolve(true)))
  const startedAt = Date.now()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() })
  report.windowCloseConfirmClicked = await page.getByRole('button', { name: t('common.close'), exact: true }).last().click({ timeout: 4000 }).then(() => true, error => String(error).slice(0, 120))
  await sleep(300)
  await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0) }).catch(() => undefined)
  const clean = await Promise.race([exited, sleep(8000).then(() => false)])
  report.windowCloseExit = { clean, ms: Date.now() - startedAt }
  if (!clean) await killOwnTree(); else app = null
}

const report = { mode: MODE, postLifeMs: POST_LIFE_MS, stages: {}, screenshots: [] }
const walk = (dir, hits = []) => { for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full, hits); else hits.push(full) } return hits }
const nomiFiles = () => walk(projectsDir).filter(file => /canvas-runs\/open|canvas-/.test(file)).map(file => path.relative(projectsDir, file))
const runJob = () => {
  for (const file of walk(projectsDir)) {
    if (!/\.json$/.test(file) || !/canvas-/.test(file) || /canvas-runs\/open/.test(file)) continue
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (value?.jobs?.[0]) return { file: path.basename(file), status: value.jobs[0].status, providerTaskId: value.jobs[0].providerTaskId ?? null } } catch { /* 不是 JSON */ }
  }
  return null
}
const nodes = async () => (await readProject(page, project.id)).payload.generationCanvas.nodes
const shot = async name => { await waitForVisualQuiescence(page).catch(() => undefined); const file = path.join(shots, `${locale}-i6-${MODE}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
const setWalkTheme = async dark => page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.dataset.nomiColorScheme = dark ? 'dark' : 'light'; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.documentElement.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light') }, dark)
let design, assetId
const snap = async label => {
  const all = await nodes().catch(() => [])
  const n = all.find(x => x.id === assetId)
  report.stages[label] = { at: new Date().toISOString(), status: n?.status, error: n?.error ?? null, runs: (n?.runs ?? []).map(r => ({ id: r.id, status: r.status, taskId: r.taskId ?? null })), resultId: n?.result?.id ?? null, posts: proxy.records.length, markers: nomiFiles(), job: runJob(), nodeStatuses: Object.fromEntries(all.map(x => [x.meta?.anchorId ?? x.meta?.shotId ?? x.id, x.status])) }
  console.log('STAGE', label, JSON.stringify(report.stages[label]))
}
const canvas = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page); await page.waitForFunction(() => Boolean(window.__nomiCanvasStore)); await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id); await canvasFitView(page); await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), id); await expect(page.locator(`[data-node-id="${id}"]`).first()).toBeVisible() }
const clickGenerateOnCanvas = async () => { await page.locator(`[data-node-id="${assetId}"] [data-bar-segment="generate"]`).first().click() }
const list = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'list'); if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click(); const node = (await nodes()).find(n => n.id === id); await page.locator(node.meta.anchorId ? `[data-list-anchor="${design.id}:${node.meta.anchorId}"], [data-list-unreferenced-asset="${id}"]` : `[data-list-card="${id}"]`).first().click() }
const anchorRow = async anchorId => {
  await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
  if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click()
  const row = page.locator(`[data-storyboard-anchor-row="${anchorId}"]`); await row.scrollIntoViewIfNeeded(); return row
}

let failure
try {
  await launch()
  await newProjectEntry(page).click()
  await expect(page.locator('.tiptap[contenteditable="true"]').first()).toBeVisible()
  const projectId = await page.evaluate(() => new URL(location.href).searchParams.get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId'))
  project = (await page.evaluate(() => window.nomiDesktop.projects.listAsync())).find(value => value.id === projectId)
  design = await prepareLockExitStoryboard({ page, projectId, proxy, fixture, model: { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: FIXTURE_APIMART_MODEL }, textLabel: FIXTURE_TEXT_MODEL_LABEL, locale, screenshotDir: shots })
  await openStoryboardEditor(page, design.id); await page.locator('[data-place-storyboard]').click()
  await expect.poll(async () => (await readProject(page, projectId)).payload.generationCanvas.nodes.length).toBe(5)
  const bound = (await readProject(page, projectId)).payload.generationCanvas.nodes
  const asset = bound.find(n => n.meta.anchorId); assetId = asset.id; report.assetNode = asset.id; report.anchorId = asset.meta.anchorId
  proxy.setLimit(5)
  await canvas(asset.id); await clickGenerateOnCanvas()
  await expect.poll(() => proxy.records.length, { timeout: stationTimeout({ operations: 1 }) }).toBe(1)
  await sleep(800) // 让 run-started 和 Run 落盘走完，POST 还在代理里压着
  await snap('post-in-flight')

  if (MODE === 'reload') await page.reload(); else if (MODE === 'sigkill') await killOwnTree(); else await closeLikeUser()
  await sleep(300)
  report.stages.afterExitDisk = { markers: nomiFiles(), job: runJob() }
  console.log('STAGE after-exit-disk', JSON.stringify(report.stages.afterExitDisk))
  if (MODE !== 'reload') await reopen()
  await canvas(asset.id);
  await expect.poll(async () => (await nodes()).find(node => node.id === assetId)?.status).toBe(MODE === 'reload' ? 'recoverable' : 'error'); await snap('after-restart'); await shot('1-after-restart-canvas')
  if (locale === 'en' && MODE === 'window-close') { await setWalkTheme(true); await shot('approved-EnDarkCanvas'); await setWalkTheme(false) }

  if (MODE === 'reload') {
    const open = await page.evaluate(projectId => window.nomiDesktop.tasks.canvasOpenRuns({ projectId }), project.id)
    expect(open.find(entry => entry.nodeId === assetId)).toMatchObject({ reason: 'in_flight', hasTaskId: false })
    expect((await nodes()).find(node => node.id === assetId)?.error ?? '').not.toContain('submission-unknown')
    await page.locator(`[data-node-id="${assetId}"]`).getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true }).click()
    await expect.poll(async () => (await nodes()).find(node => node.id === assetId)?.status, { timeout: stationTimeout({ operations: 4 }) }).toBe('success')
    expect(proxy.records.length).toBe(1)
    await shot('reload-free-result')
  } else {
  const before = (await nodes()).find(n => n.id === asset.id)
  const beforeRuns = JSON.stringify(before.runs ?? [])
  await clickGenerateOnCanvas()
  await expect.poll(async () => Boolean((await nodes()).find(n => n.id === asset.id)?.error) || await page.getByText(t('generationCommon.spend.resend.unknown'), { exact: true }).first().isVisible(), { timeout: stationTimeout({ operations: 3 }) }).toBe(true)
  await snap('before-confirm')
  const after = (await nodes()).find(n => n.id === asset.id)
  // Log the original user error before asserting the new confirmation behavior.
  console.log('MANUAL_RESEND_PROBE', after.error ?? 'no refusal')
  await expect(page.getByText(t('generationCommon.spend.resend.unknown'), { exact: true }).first()).toBeVisible()
  expect(JSON.stringify(after.runs ?? [])).toBe(beforeRuns)
  expect(proxy.records.length).toBe(1)
  await page.getByRole('button', { name: t('common.cancel'), exact: true }).last().click()
  const anchor = await anchorRow(asset.meta.anchorId); await shot('restart-storyboard')
  if (locale === 'zh-CN' && MODE === 'window-close') { await setWalkTheme(true); await shot('approved-ZhDarkStoryboard'); await setWalkTheme(false) }
  await anchor.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.main'), exact: true }).click()
  await expect(page.locator('[data-spend-confirm-dialog]:visible').first()).toBeVisible();await shot('confirm-storyboard')
  if (locale === 'en' && MODE === 'window-close') { await setWalkTheme(true); await shot('approved-EnDarkConfirm'); await setWalkTheme(false) }
  await page.locator('[data-spend-confirm-dialog]:visible').getByRole('button', { name: t('common.cancel'), exact: true }).click()
  await list(asset.id); await shot('restart-list')
  await page.locator('[data-list-detail-preview]').getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.main'), exact: true }).click()
  await expect(page.locator('[data-spend-confirm-dialog]:visible').first()).toBeVisible();await shot('confirm-list')
  if (locale === 'en' && MODE === 'window-close') await shot('approved-EnLightList')
  await page.locator('[data-spend-confirm-dialog]:visible').getByRole('button', { name: t('common.cancel'), exact: true }).click()
  expect(proxy.records.length).toBe(1)
  expect(JSON.stringify((await nodes()).find(node => node.id === assetId).runs)).toBe(beforeRuns)
  // F6: the unresolved asset is not priced or retried by another batch.
  await openStoryboardEditor(page, design.id);await closeRailDrawer(page, 'docs');await collapseAgentPanel(page)
  await page.locator('[data-storyboard-batch]').click()
  const dialog = page.locator('[data-spend-confirm-dialog]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: design.plan.anchors.find(value => value.id === asset.meta.anchorId).name, exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox')).toHaveCount(4)
  await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(() => proxy.records.length).toBe(2)
  await expect.poll(async () => page.locator('[data-place-storyboard]').isEnabled(), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  expect(proxy.records.filter(record => record.prompt.includes(design.plan.shots[0].prompt.slice(0, 8))).length).toBe(0)
  await expect(page.getByText(t('generationCommon.batchPlan.openRunsSkipped').replace('{{count}}', '1'), { exact: true }).first()).toBeVisible()
  await shot('batch-skipped-notice')

  await canvas(asset.id); await clickGenerateOnCanvas(); await shot('confirm-canvas')
  await page.locator('[data-spend-confirm-action="confirm"]').last().click()
  await expect.poll(() => proxy.records.length).toBe(3)
  await expect.poll(async () => (await nodes()).find(n => n.id === asset.id)?.status, { timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  await snap('resent-success'); await shot('resent-success')
  await openStoryboardEditor(page, design.id);await closeRailDrawer(page, 'docs');await collapseAgentPanel(page)
  await page.locator('[data-storyboard-batch]').click();await expect(dialog).toBeVisible()
  await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(async () => proxy.records.length === 6 || await dialog.locator('[data-hosting-remember]').isVisible(), { timeout: stationTimeout({ operations: 5 }) }).toBe(true)
  if (await dialog.locator('[data-hosting-remember]').isVisible()) {
    await dialog.locator('[data-hosting-remember] input').check()
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  }
  await expect.poll(async () => (await nodes()).filter(node => node.result).length, { timeout: stationTimeout({ operations: 6 }) }).toBe(5)
  expect(proxy.records.length).toBe(6)
  await shot('batch-resumed-all-results')
  }

} catch (error) { failure = error; process.exitCode = 1; console.error(error); if (page) await page.screenshot({ path: path.join(out, `i6-${MODE}-FAIL.png`) }).catch(() => undefined) }
finally {
  if (app) await closeNomiApp(app).catch(() => undefined)
  await proxy.close(); await fixture.close()
  fs.writeFileSync(path.join(out, `${locale}-i6-${MODE}.json`), JSON.stringify({ commit, status: failure ? 'failed' : 'passed', error: failure?.message, report, requests: proxy.records }, null, 2))
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
