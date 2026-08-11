import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-budget-ux-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-budget-recovery')
const locale = process.env.NOMI_E2E_LOCALE === 'en' ? 'en' : 'zh-CN'
const shotPrefix = locale === 'en' ? 'en-' : ''
const labels = locale === 'en'
  ? {
      newProject: 'New blank project',
      openPolicy: 'Complete production policy',
      close: 'Close',
      approve: 'Approve and continue',
    }
  : {
      newProject: '新建空白项目',
      openPolicy: '完善制作策略',
      close: '关闭',
      approve: '批准并继续',
    }
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

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
  let window
  ;({ app, win: window } = await launchNomiApp({
    name: 'production-budget-recovery',
    userDataDir,
    settingsDir: userDataDir,
    projectsDir,
    env: {
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_PRODUCTION_MISSING_POLICY: '1',
      NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability'),
    },
    settleMs: 0,
  }))
  await window.setViewportSize({ width: 1280, height: 820 })
  if (locale === 'en') {
    await window.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'en'))
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
  }
  await window.getByText(labels.newProject, { exact: false }).first().click()
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
        allowedProviders: [],
        allowedModels: [],
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
              provider: 'kie',
              model: 'gpt-image-2-text-to-image',
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
  await window.locator('[data-production-policy-issue="budget"]').waitFor({ timeout: 5_000 })
  await window.locator('[data-production-policy-issue="providers"]', { hasText: 'kie' }).waitFor({ timeout: 5_000 })
  await window.locator('[data-production-policy-issue="models"]', { hasText: 'gpt-image-2-text-to-image' }).waitFor({ timeout: 5_000 })
  await window.getByRole('button', { name: labels.openPolicy }).waitFor({ timeout: 5_000 })
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}01-incomplete-policy-contract.png`) })

  await window.getByRole('button', { name: labels.openPolicy }).click()
  const budgetInput = window.locator('[data-settings-field="hard-budget"]')
  await budgetInput.waitFor({ timeout: 5_000 })
  const focused = await budgetInput.evaluate((element) => document.activeElement === element)
  if (!focused) throw new Error('Hard budget field did not receive focus')
  const waitingRun = await window.evaluate(
    ({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid),
    { pid: projectId, rid: runId },
  )
  const contractGate = waitingRun.gates.find((gate) => gate.scope === 'budget_envelope')
  if (contractGate?.status !== 'waiting') throw new Error('Opening production policy settings rejected the contract')
  await window.locator('[data-production-policy-context]', { hasText: 'kie · gpt-image-2-text-to-image' }).waitFor({ timeout: 5_000 })
  const providerInput = window.locator('[data-settings-field="production-provider"][data-policy-key="kie"]')
  const modelInput = window.locator('[data-settings-field="production-model"][data-policy-key="kie:gpt-image-2-text-to-image"]')
  await providerInput.waitFor({ timeout: 5_000 })
  await modelInput.waitFor({ timeout: 5_000 })
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}02-policy-settings-focused.png`) })

  await budgetInput.fill('25')
  await window.waitForFunction(
    async () => (await window.nomiDesktop?.settings?.automationPolicy?.get())?.maxSpend === 25,
  )
  await providerInput.check()
  await window.waitForFunction(
    async () => (await window.nomiDesktop?.settings?.automationPolicy?.get())?.allowedProviders.includes('kie'),
  )
  await modelInput.check()
  await window.waitForFunction(
    async () => (await window.nomiDesktop?.settings?.automationPolicy?.get())?.allowedModels.includes('gpt-image-2-text-to-image'),
  )
  let run = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), {
    pid: projectId,
    rid: runId,
  })
  if (run.budget.authorized !== 0) throw new Error('Policy recovery unexpectedly authorized spend before approval')

  await window.getByRole('button', { name: labels.close }).click()
  await window.locator('[data-production-primary-action]').click()
  await window.locator('[data-production-hard-budget="set"]').waitFor({ timeout: 5_000 })
  await window.locator('[data-production-provider-model-status="allowed"]').waitFor({ timeout: 5_000 })
  if (await window.locator('[data-production-policy-readiness="incomplete"]').count()) {
    throw new Error('Completed policy still rendered as incomplete')
  }
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}03-ready-contract.png`) })

  run = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), {
    pid: projectId,
    rid: runId,
  })
  if (run.budget.authorized !== 0) throw new Error('Reviewing the ready contract authorized spend before approval')
  await window.getByRole('button', { name: labels.approve }).click()
  run = await waitForRun(window, projectId, runId, (candidate) => candidate.budget.authorized === 25)
  if (run.gates.find((gate) => gate.scope === 'budget_envelope')?.status !== 'approved') {
    throw new Error('Ready contract was not approved')
  }
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}04-approved-production.png`) })
  console.log(`PRODUCTION POLICY RECOVERY WALK PASS (${locale}): ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
} finally {
  const child = app?.process?.()
  if (app) await Promise.race([app.close().catch(() => undefined), delay(3_000)])
  if (child && child.exitCode === null) child.kill('SIGKILL')
  process.exitCode = exitCode
}
