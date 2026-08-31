import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-provider-recovery-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-provider-recovery')
const locale = process.env.NOMI_E2E_LOCALE === 'en' ? 'en' : 'zh-CN'
const shotPrefix = locale === 'en' ? 'en-' : ''
const labels = locale === 'en'
  ? {
      newProject: 'New blank project',
      approve: 'Approve and continue',
      replacement: 'Replacement',
      providerUnavailable: 'Provider unavailable before submission',
      replacementContract: 'Review the replacement production contract',
      backupAlpha: 'Backup Alpha',
      backupBeta: 'Backup Beta',
    }
  : {
      newProject: '新建空白项目',
      approve: '批准并继续',
      replacement: '替代供应商',
      providerUnavailable: '供应商在提交前不可用',
      replacementContract: '核对新的制作合同',
      backupAlpha: '备选接口甲',
      backupBeta: '备选接口乙',
    }

const providerKeys = new Map([
  [labels.backupAlpha, 'backup-alpha'],
  [labels.backupBeta, 'backup-beta'],
])
const modelKey = 'nomi-recovery-image'
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const env = {
  ...process.env,
  NOMI_E2E: '1',
  NOMI_E2E_PRODUCTION_FIXTURE: '1',
  NOMI_E2E_PRODUCTION_MISSING_POLICY: '1',
  NOMI_E2E_PRODUCTION_FAIL_PROVIDER_AFTER_PREFLIGHT: 'broken-relay',
  NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
  NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
  NOMI_SETTINGS_DIR: userDataDir,
  NOMI_PROJECTS_DIR: projectsDir,
  NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability'),
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(condition, message) {
  if (!condition) throw new Error(`PRODUCTION PROVIDER RECOVERY FAIL: ${message}`)
}

async function waitForRun(window, projectId, runId, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), {
      pid: projectId,
      rid: runId,
    })
    if (last && predicate(last)) return last
    await delay(200)
  }
  throw new Error(`Timed out waiting for production run state: ${JSON.stringify(last)}`)
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

function projectRootFor(projectId) {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(projectsDir, entry.name)
    try {
      const descriptor = JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8'))
      if (descriptor.id === projectId) return root
    } catch {
      // Ignore unrelated directories.
    }
  }
  return null
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
  check(Boolean(projectId), 'isolated project did not open')

  await window.evaluate(async ({ alpha, beta, sharedModel }) => {
    const catalog = window.nomiDesktop?.modelCatalog
    const vendors = [
      { key: 'broken-relay', name: 'Offline Primary' },
      { key: 'backup-alpha', name: alpha },
      { key: 'backup-beta', name: beta },
    ]
    for (const vendor of vendors) {
      catalog?.upsertVendor({ ...vendor, enabled: true, authType: 'none' })
      catalog?.upsertModel({
        vendorKey: vendor.key,
        modelKey: sharedModel,
        labelZh: 'Recovery Image',
        kind: 'image',
        enabled: true,
        meta: { canonicalModelId: 'nomi-recovery-image' },
      })
    }
    const policyApi = window.nomiDesktop?.settings?.automationPolicy
    const currentPolicy = await policyApi?.get()
    await policyApi?.set({
      ...currentPolicy,
      maxSpend: 12,
      allowedProviders: ['broken-relay'],
      allowedModels: [sharedModel],
      maxAttemptsPerJob: 1,
    })
  }, { alpha: labels.backupAlpha, beta: labels.backupBeta, sharedModel: modelKey })

  const created = await window.evaluate(async (pid) => {
    return window.nomiDesktop?.productionRuns?.createDraft({
      projectId: pid,
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex', actorId: 'codex' },
      brief: { goal: 'Verify safe provider recovery without a paid request', durationSeconds: 60 },
    })
  }, projectId)
  const runId = created?.runId
  check(Boolean(runId), 'production run was not created')

  await window.evaluate(async ({ pid, rid }) => {
    const bridge = window.nomiDesktop?.productionRuns
    const run = await bridge?.read(pid, rid)
    return bridge?.command(pid, rid, {
      commandId: crypto.randomUUID(),
      expectedRevision: run.revision,
      type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' },
      issuedAt: new Date().toISOString(),
    })
  }, { pid: projectId, rid: runId })

  const planned = await waitForRun(window, projectId, runId, (run) => run.status === 'awaiting_storyboard_review')
  const storyboard = planned.artifacts.find((artifact) => artifact.kind === 'storyboard')
  check(Boolean(storyboard), 'fixture storyboard was not produced')
  await window.evaluate(async ({ pid, rid, artifactId, sharedModel }) => {
    const bridge = window.nomiDesktop?.productionRuns
    const run = await bridge?.read(pid, rid)
    return bridge?.command(pid, rid, {
      commandId: crypto.randomUUID(),
      expectedRevision: run.revision,
      type: 'plan.attach',
      payload: {
        artifactId,
        bindings: [{ nodeId: 'shot-1', provider: 'broken-relay', model: sharedModel, stageId: 'generate' }],
      },
      issuedAt: new Date().toISOString(),
    })
  }, { pid: projectId, rid: runId, artifactId: storyboard.artifactId, sharedModel: modelKey })

  await openRunFromTaskCenter(window)
  await window.locator('[data-production-primary-action]').click()
  const contract = window.locator('[data-spend-confirm-dialog]')
  await contract.waitFor({ timeout: 5_000 })
  await contract.getByRole('button', { name: labels.approve }).click()

  let run = await waitForRun(window, projectId, runId, (candidate) =>
    candidate.status === 'needs_attention'
    && candidate.jobs.some((job) => job.status === 'not_dispatched'),
  )
  check(run.jobs.every((job) => !job.providerTaskId), 'failed provider unexpectedly returned a task receipt')
  check(run.budget.authorized === 12, 'approved contract authorization was not recorded')
  check(run.budget.reserved === 0 && run.budget.actual === 0 && run.budget.unsettled === 0, 'provider failure created spend or a liability')
  await window.getByText(labels.providerUnavailable, { exact: true }).waitFor({ timeout: 10_000 })
  const recovery = window.locator('[data-production-recovery]')
  await recovery.waitFor({ timeout: 10_000 })
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}01-provider-unavailable.png`) })

  const replacementTrigger = window.getByRole('button', { name: labels.replacement })
  const initialReplacement = (await replacementTrigger.textContent()) || ''
  const targetLabel = initialReplacement.includes(labels.backupAlpha) ? labels.backupBeta : labels.backupAlpha
  const targetProvider = providerKeys.get(targetLabel)
  check(Boolean(targetProvider), 'replacement provider key could not be resolved')
  await replacementTrigger.click()
  const targetOption = window.getByRole('option', { name: new RegExp(targetLabel) })
  await targetOption.waitFor({ timeout: 5_000 })
  await targetOption.click()
  check((await replacementTrigger.textContent())?.includes(targetLabel), 'user-selected replacement was not retained')
  check((await window.locator('[data-production-primary-action]').textContent())?.includes(targetLabel), 'primary action did not follow the selected replacement')
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}02-alternative-selected.png`) })

  await window.locator('[data-production-primary-action]').click()
  const switchDialogRoot = window.locator('[data-confirm-dialog="confirm"]')
  const switchDialog = switchDialogRoot.getByRole('dialog')
  await switchDialog.waitFor({ timeout: 5_000 })
  await delay(180)
  const switchDialogStyle = await switchDialog.evaluate((element) => {
    const style = getComputedStyle(element)
    return { opacity: Number(style.opacity), backgroundColor: style.backgroundColor }
  })
  check(switchDialogStyle.opacity === 1, 'replacement confirmation did not reach a readable steady state')
  check(!['transparent', 'rgba(0, 0, 0, 0)'].includes(switchDialogStyle.backgroundColor), 'replacement confirmation has no surface background')
  check((await switchDialog.textContent())?.includes(targetLabel), 'replacement confirmation did not name the selected provider')
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}03-switch-confirmation.png`) })
  await switchDialogRoot.locator('[data-confirm-dialog-confirm="true"]').click()

  const replacementContract = window.locator('[data-spend-confirm-dialog]')
  await replacementContract.waitFor({ timeout: 10_000 })
  await switchDialog.waitFor({ state: 'detached', timeout: 5_000 })
  await replacementContract.getByText(labels.replacementContract, { exact: true }).waitFor({ timeout: 5_000 })
  check((await replacementContract.textContent())?.includes(targetLabel), 'new contract did not show the selected provider')
  run = await waitForRun(window, projectId, runId, (candidate) =>
    candidate.planVersion === 2
    && candidate.status === 'awaiting_contract'
    && candidate.gates.some((gate) => gate.gateId === 'gate-contract-v2' && gate.status === 'waiting'),
  )
  check(run.gates.some((gate) => gate.gateId === 'gate-contract-v1' && gate.status === 'revoked'), 'old contract was not revoked')
  check(run.jobs.some((job) => job.status === 'detached' && job.provider === 'broken-relay'), 'old provider job was not detached')
  check(run.jobs.some((job) => job.status === 'authorization_required' && job.provider === targetProvider), 'replacement job did not use the selected provider')
  check(run.budget.authorized === 0 && run.budget.reserved === 0 && run.budget.actual === 0 && run.budget.unsettled === 0, 'replacement contract retained authorization or spend')
  const projectRoot = projectRootFor(projectId)
  check(Boolean(projectRoot), 'isolated project root was not found')
  check(!fs.existsSync(path.join(projectRoot, 'assets', 'generated', `fixture-${runId}.mp4`)), 'replacement generated before the new contract was approved')
  await window.screenshot({ path: path.join(shotsDir, `${shotPrefix}04-replacement-contract-waiting.png`) })

  await window.keyboard.press('Escape')
  await replacementContract.waitFor({ state: 'detached', timeout: 5_000 })
  run = await window.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { pid: projectId, rid: runId })
  check(run.status === 'awaiting_contract', 'dismissing the replacement contract resumed production')
  check(run.gates.some((gate) => gate.gateId === 'gate-contract-v2' && gate.status === 'waiting'), 'dismissing the replacement contract decided the gate')
  console.log(`PRODUCTION PROVIDER RECOVERY WALK PASS (${locale}): ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
} finally {
  const child = app?.process?.()
  if (app) await Promise.race([app.close().catch(() => undefined), delay(3_000)])
  if (child && child.exitCode === null) child.kill('SIGKILL')
  process.exitCode = exitCode
}
