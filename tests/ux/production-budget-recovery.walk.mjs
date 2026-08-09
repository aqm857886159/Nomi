import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-budget-ux-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-budget-recovery')
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const env = {
  ...process.env,
  NOMI_E2E: '1',
  NOMI_E2E_PRODUCTION_FIXTURE: '1',
  NOMI_E2E_PRODUCTION_MISSING_BUDGET: '1',
  NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
  NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
  NOMI_SETTINGS_DIR: userDataDir,
  NOMI_PROJECTS_DIR: projectsDir,
  NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability'),
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForRun(window, projectId, runId, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), {
      pid: projectId,
      rid: runId,
    })
    if (run && predicate(run)) return run
    await delay(200)
  }
  throw new Error('Timed out waiting for production run state')
}

async function openRunFromTaskCenter(window) {
  await window.locator('[data-task-center-trigger="true"]').click()
  const row = window
    .locator('[data-nomi-right-panel="tasks"]', { hasText: 'brand.promo' })
    .locator('[role="button"]', { hasText: 'brand.promo' })
    .first()
  await row.waitFor({ timeout: 10_000 })
  await row.click()
  await window.locator('[data-production-status-title]').waitFor({ timeout: 10_000 })
}

let app
let exitCode = 0
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env,
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.setViewportSize({ width: 1280, height: 820 })
  await window.getByText('新建空白项目', { exact: false }).first().click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await window.evaluate(() =>
    new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'),
  )
  if (!projectId) throw new Error('Project did not open')

  const created = await window.evaluate(async (pid) => {
    const bridge = window.nomiDesktop?.productionRuns
    return bridge?.createDraft({
      projectId: pid,
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex', actorId: 'codex' },
      brief: { goal: 'Test a truthful Nomi production budget recovery', durationSeconds: 60 },
      policy: {
        maxSpend: null,
        allowedProviders: ['nomi-e2e-fixture'],
        allowedModels: ['nomi-e2e-fixture-video'],
      },
    })
  }, projectId)
  const runId = created?.runId
  if (!runId) throw new Error('Production run was not created')

  await window.evaluate(
    async ({ pid, rid }) => {
      const bridge = window.nomiDesktop?.productionRuns
      const run = await bridge?.read(pid, rid)
      await bridge?.command(pid, rid, {
        commandId: crypto.randomUUID(),
        expectedRevision: run.revision,
        type: 'gate.decide',
        payload: { gateId: 'gate-direction-v1', status: 'approved' },
        issuedAt: new Date().toISOString(),
      })
    },
    { pid: projectId, rid: runId },
  )

  const planned = await waitForRun(window, projectId, runId, (run) => run.status === 'awaiting_storyboard_review')
  const storyboard = planned.artifacts.find((artifact) => artifact.kind === 'storyboard')
  if (!storyboard) throw new Error('Storyboard fixture was not produced')
  await window.evaluate(
    async ({ pid, rid, artifactId }) => {
      const bridge = window.nomiDesktop?.productionRuns
      const run = await bridge?.read(pid, rid)
      await bridge?.command(pid, rid, {
        commandId: crypto.randomUUID(),
        expectedRevision: run.revision,
        type: 'plan.attach',
        payload: {
          artifactId,
          bindings: [
            {
              nodeId: 'shot-1',
              provider: 'nomi-e2e-fixture',
              model: 'nomi-e2e-fixture-video',
              stageId: 'generate',
            },
          ],
        },
        issuedAt: new Date().toISOString(),
      })
    },
    { pid: projectId, rid: runId, artifactId: storyboard.artifactId },
  )

  await openRunFromTaskCenter(window)
  await window.locator('[data-production-primary-action]').click()
  await window.locator('[data-production-hard-budget="missing"]').waitFor({ timeout: 5_000 })
  await window.getByRole('button', { name: '去设置预算' }).waitFor({ timeout: 5_000 })
  await window.screenshot({ path: path.join(shotsDir, '01-missing-budget-contract.png') })

  await window.getByRole('button', { name: '去设置预算' }).click()
  const budgetInput = window.locator('[data-settings-field="hard-budget"]')
  await budgetInput.waitFor({ timeout: 5_000 })
  const focused = await budgetInput.evaluate((element) => document.activeElement === element)
  if (!focused) throw new Error('Hard budget field did not receive focus')
  const waitingRun = await window.evaluate(
    ({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid),
    { pid: projectId, rid: runId },
  )
  const contractGate = waitingRun.gates.find((gate) => gate.scope === 'budget_envelope')
  if (contractGate?.status !== 'waiting') throw new Error('Opening budget settings rejected the production contract')
  await window.screenshot({ path: path.join(shotsDir, '02-budget-setting-focused.png') })

  await budgetInput.fill('25')
  await window.waitForFunction(
    async () => (await window.nomiDesktop?.settings?.automationPolicy?.get())?.maxSpend === 25,
  )
  const run = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), {
    pid: projectId,
    rid: runId,
  })
  if (run.budget.authorized !== 0) throw new Error('Budget recovery unexpectedly authorized spend')
  console.log(`PRODUCTION BUDGET RECOVERY WALK PASS: ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
} finally {
  const child = app?.process?.()
  if (app) await Promise.race([app.close().catch(() => undefined), delay(3_000)])
  if (child && child.exitCode === null) child.kill('SIGKILL')
  process.exitCode = exitCode
}
