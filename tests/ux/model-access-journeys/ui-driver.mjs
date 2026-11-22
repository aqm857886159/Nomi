import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from '../_launchApp.mjs'
import { stationTimeout } from '../_station-budget.mjs'
import { uiText } from '../full-walk/invariants.mjs'
import { JourneyFailure } from './evidence.mjs'
import { canvasAddBar, newProjectEntry } from '../_shell.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Model-access UI driver — reconfigured 2026-09-01 to main's current IA.
//
// What changed vs the old driver (all probed against a real Electron build, not
// guessed — see walkthrough-repair-probe-first): the model workspace is the
// `ModelSettingsHome` (`OnboardingDrawer`) reached from the settings "模型" tab.
// Its entry rows carry stable `data-model-home-*` markers, which we anchor on
// instead of translated text (text drifts; markers are the component's own API):
//   - `[data-model-home-action="custom-api"]`  → relay / custom-base-URL wizard
//   - `[data-model-home-available="<vendorKey>"]` → a preset/known connection row
//   - `[data-model-home-action="other-ways"]`  → collapsed local/membership group
//     (only rendered collapsed once other connections exist; on an empty profile
//      the local/membership rows are flat under 其他接入方式)
//   - `[data-model-home-action="direct-script"]` → advanced "I already have a script"
//
// The relay wizard is a *page inside the models tab* (not a separate dialog), and
// its real flow is: fill → 保存连接 → 获取模型列表 → inline picker → 添加 N 个
// → adaptation page (完成). The old driver looked for 添加一个 AI 模型 / 拉取模型 /
// 选择模型 / 接入并验证 which no longer exist on this path. The wizard has no
// 测试连接 button any more (D-1117-delete-verification, 2026-11-18): nothing probes
// before 保存连接, and a wrong address shows up as the model-list failure.
// ─────────────────────────────────────────────────────────────────────────────

const WALK_LOCALE = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const copyText = (key) => uiText(WALK_LOCALE, key)
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const copyPattern = (key, replacements = {}) => {
  let pattern = escapeRegExp(copyText(key))
  for (const [token, replacement] of Object.entries(replacements)) pattern = pattern.replace(escapeRegExp(token), replacement)
  return new RegExp(pattern)
}
const WALK_COPY = WALK_LOCALE === 'en'
  ? {
      settings: copyText('settings.title'), models: copyText('settings.tab.models'), vendorNamePlaceholder: copyText('modelSetup.vendorNamePlaceholder'),
      baseUrlPlaceholder: copyText('modelSetup.openAiUrlPlaceholder'), apiKeyPlaceholder: copyText('modelSetup.apiKeyPlaceholder'),
      advanced: copyText('modelSetup.advanced'), manualProtocol: copyText('modelSetup.manualProtocol'),
      saveConnection: copyText('modelSetup.saveConnection'),
      fetchModels: new RegExp([copyText('onboardingProviders.modelControls.fetch'), copyText('modelSetup.fetchModels'), copyText('onboardingProviders.modelControls.refetch')].map(escapeRegExp).join('|')),
      addModels: copyPattern('onboardingProviders.modelControls.addModels', { '{{count}}': '\\d+' }),
      done: copyText('modelSetup.done'), back: copyText('common.back'), manualSetup: copyText('onboardingProviders.adapterVerification.action.manualSetup'),
      requestMethod: copyPattern('onboardingProviders.workspace.capability.openRequest', { '{{name}}': '.*' }),
      generate: copyText('generationCommon.composer.generate'),
    }
  : {
      settings: copyText('settings.title'), models: copyText('settings.tab.models'), vendorNamePlaceholder: copyText('modelSetup.vendorNamePlaceholder'),
      baseUrlPlaceholder: copyText('modelSetup.openAiUrlPlaceholder'), apiKeyPlaceholder: copyText('modelSetup.apiKeyPlaceholder'),
      advanced: copyText('modelSetup.advanced'), manualProtocol: copyText('modelSetup.manualProtocol'),
      saveConnection: copyText('modelSetup.saveConnection'),
      fetchModels: new RegExp([copyText('onboardingProviders.modelControls.fetch'), copyText('modelSetup.fetchModels'), copyText('onboardingProviders.modelControls.refetch')].map(escapeRegExp).join('|')),
      addModels: copyPattern('onboardingProviders.modelControls.addModels', { '{{count}}': '\\d+' }),
      done: copyText('modelSetup.done'), back: copyText('common.back'), manualSetup: copyText('onboardingProviders.adapterVerification.action.manualSetup'),
      requestMethod: copyPattern('onboardingProviders.workspace.capability.openRequest', { '{{name}}': '.*' }),
      generate: copyText('generationCommon.composer.generate'),
    }

export async function launchJourneyUi({ journey, recorder }) {
  const launched = await launchNomiApp({ name: `model-access-${journey.id.toLowerCase()}` })
  const { win, settingsDir } = launched
  const diagnostics = []
  win.on('pageerror', (error) => diagnostics.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => { if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`) })
  await win.evaluate((locale) => localStorage.setItem('nomi:locale:v1', locale), WALK_LOCALE)
  await win.reload({ waitUntil: 'domcontentloaded' })
  const skip = win.locator('[data-splash-skip="true"]')
  if (await skip.isVisible().catch(() => false)) await skip.click()

  async function openModels() {
    await win.getByRole('button', { name: WALK_COPY.settings, exact: true }).first().click()
    const dialog = win.getByRole('dialog', { name: WALK_COPY.settings, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: stationTimeout() })
    await dialog.getByRole('button', { name: WALK_COPY.models, exact: true }).click()
    await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible', timeout: stationTimeout() })
    // The workspace is the ModelSettingsHome; wait for it to render before acting.
    await win.locator('[data-model-settings-page="home"]').waitFor({ state: 'visible', timeout: stationTimeout() })
  }

  async function expandGenerationProviders() {
    // Model settings opens straight into the ModelSettingsHome ("添加模型服务"):
    // known platforms, custom-api and local runtimes are top-level rows, not a
    // collapsed "接入生成模型" group. Nothing to expand; assert the home rendered.
    await win.locator('[data-model-settings-page="home"]').waitFor({ state: 'visible', timeout: 8000 })
  }

  // The home groups extra adapted platforms behind a "更多已适配平台" row and
  // (once connections exist) local/membership rows behind "本地运行时与即梦会员".
  // On an empty profile the local rows are already flat, so this expand is
  // best-effort: absence of the toggle is fine.
  async function expandHomeGroup(marker) {
    const toggle = win.locator(`[data-model-home-action="${marker}"]`)
    if (!(await toggle.isVisible().catch(() => false))) return false
    if ((await toggle.getAttribute('aria-expanded')) === 'true') return true
    await toggle.click()
    await win.waitForTimeout(400)
    return true
  }

  // Open a preset/known connection row by its vendor key (data-model-home-available
  // is the stable anchor). Reveals it from either collapsed group first.
  async function openHomeConnection(vendorKey) {
    const row = win.locator(`[data-model-home-available="${vendorKey}"]`)
    if (!(await row.isVisible().catch(() => false))) await expandHomeGroup('more-adapted')
    if (!(await row.isVisible().catch(() => false))) await expandHomeGroup('other-ways')
    await row.first().waitFor({ state: 'visible', timeout: 8000 })
    await row.first().click()
  }

  async function openRelayWizard() {
    await expandGenerationProviders()
    // "自定义 API / 中转站" is the relay/custom-base-URL entry on the model home.
    const customApi = win.locator('[data-model-home-action="custom-api"]').first()
    if (!(await customApi.isVisible().catch(() => false))) {
      const otherWays = win.locator('[data-model-home-action="other-ways"]').first()
      if (await otherWays.isVisible().catch(() => false)) await otherWays.click()
    }
    await customApi.waitFor({ state: 'visible', timeout: stationTimeout() })
    await customApi.click()
    // The wizard renders as a page (header 接入 API / 中转站). Anchor on the name
    // field placeholder — it is the first thing the fill step needs anyway.
    await win.getByPlaceholder(WALK_COPY.vendorNamePlaceholder).waitFor({ state: 'visible', timeout: stationTimeout() })
  }

  async function fillRelay({ name, baseUrl, apiKey = 'sk-fixture-key' }) {
    await win.getByPlaceholder(WALK_COPY.vendorNamePlaceholder).fill(name)
    await win.getByPlaceholder(WALK_COPY.baseUrlPlaceholder).fill(baseUrl)
    await win.getByPlaceholder(WALK_COPY.apiKeyPlaceholder).fill(apiKey)
  }

  // The protocol choices (Chat Completions / Responses / Anthropic) live behind
  // the "高级设置（接口协议 / 自定义请求头）" disclosure.
  async function openRelayProtocols() {
    await win.getByText(WALK_COPY.advanced, { exact: true }).first().click()
    await win.waitForTimeout(400)
  }

  async function showManualProtocol() {
    await win.getByText(WALK_COPY.manualProtocol, { exact: true }).first().click()
  }

  // Relay wizard flow: 保存连接 unlocks 获取模型列表, which reveals the inline model
  // picker. Idempotent: skips 保存连接 if it is already gone (already saved).
  async function fetchModels() {
    const save = win.getByRole('button', { name: WALK_COPY.saveConnection, exact: true })
    if (await save.isVisible().catch(() => false)) {
      await save.first().click()
    }
    const fetch = win.getByRole('button', { name: WALK_COPY.fetchModels }).first()
    await fetch.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    await fetch.click()
    // Picker is inline on the same page: model rows + a "添加 N 个" confirm.
    await win.getByRole('button', { name: WALK_COPY.addModels }).first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  }

  async function chooseModels(modelIds) {
    for (const modelId of modelIds) {
      const label = win.getByRole('button', { name: modelId, exact: true }).first()
      await label.waitFor({ state: 'visible', timeout: 5000 })
      await label.click()
    }
    // Confirm reads "添加 N 个"; N reflects the current selection count.
    const confirm = win.getByRole('button', { name: WALK_COPY.addModels }).first()
    await confirm.waitFor({ state: 'visible', timeout: stationTimeout() })
    await confirm.click()
  }

  async function fetchAndChooseModels(modelIds) {
    await fetchModels()
    await chooseModels(modelIds)
  }

  async function waitForCatalogModels(modelIds, timeoutMs = 25_000) {
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (fs.existsSync(catalogPath)) {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
        if (modelIds.every((id) => catalog.models?.some((model) => model.modelKey === id))) return catalog
      }
      await win.waitForTimeout(300)
    }
    throw new JourneyFailure('models-not-persisted', `UI did not persist models within ${timeoutMs}ms`, { modelIds })
  }

  function catalogSnapshot() {
    const catalogPath = path.join(settingsDir, 'model-catalog.json')
    if (!fs.existsSync(catalogPath)) return null
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    return {
      vendors: raw.vendors,
      models: raw.models,
      mappings: raw.mappings,
      apiKeyVendors: Object.keys(raw.apiKeysByVendor || {}).sort(),
    }
  }

  // After 验证 N 个模型 the workspace shows the verification result page (返回 /
  // 重试 / 完成). Return to the model home so the settings tab can close.
  async function closeAccessModal() {
    const modelDialog = win.locator('[data-model-settings-dialog]')
    if (await modelDialog.isVisible()) await closeModelDetail()
    const done = win.getByRole('button', { name: WALK_COPY.done, exact: true })
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      await win.waitForTimeout(300)
      if (await modelDialog.isVisible()) await closeModelDetail()
      return
    }
    // Not on the verification page: walk back out of any wizard page via 返回.
    for (let i = 0; i < 4; i += 1) {
      if (await win.locator('[data-model-settings-page="home"]').isVisible().catch(() => false)) return
      const back = win.getByRole('button', { name: WALK_COPY.back, exact: true }).first()
      if (!(await back.isVisible().catch(() => false))) return
      await back.click()
      await win.waitForTimeout(250)
    }
  }

  async function closeSettings() {
    await closeAccessModal()
    const dialog = win.getByRole('dialog', { name: WALK_COPY.settings, exact: true })
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.locator('[data-settings-close]').first().click()
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }

  // 单模型格式任务点「完成」必须直接落到当前身份；再绕回首页会掩盖完成导航回旧行的回归。
  async function openModelDetail({ vendorKey, modelKey }) {
    const done = win.getByRole('button', { name: WALK_COPY.done, exact: true })
    await done.waitFor({ state: 'visible', timeout: stationTimeout() })
    await done.click()
    await win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`).waitFor({ state: 'visible', timeout: stationTimeout() })
    const detail = win.locator(`[data-model-settings-page="model"][data-model-settings-model="${modelKey}"]`)
    await detail.waitFor({ state: 'visible', timeout: stationTimeout() })
    return detail
  }

  // 模型详情是叠在连接页上的一层对话框（OnboardingDrawer 的 renderInModelDialog 同时渲染连接页和详情对话框），连接页那颗
  // 「返回」被它盖住、点不到——closeAccessModal 按角色取到的第一颗「返回」正是被盖住的那颗。所以先从详情自己的「返回」退一层。
  async function closeModelDetail() {
    const dialog = win.locator('[data-model-settings-dialog]')
    await dialog.locator('[data-model-settings-back]').first().click()
    await dialog.waitFor({ state: 'hidden', timeout: stationTimeout() })
  }

  // ── Verification-failure repair path (probed 2026-09-01 against a real build) ──
  // When auto-adaptation guesses a mode wrong, the verification screen
  // (AdapterVerificationScreen) surfaces a per-model recovery block *once the whole
  // run is terminal* (stage failed/partial/needs_ai — a per-mode "没通过自检" badge
  // alone is NOT terminal, the run keeps testing the other models). The repair CTA
  // is category-driven by adapterFailureAdvice: a 5xx maps to category "server" →
  // primary "重试" plus the universal escape hatch "继续手动配置" (onSelfConnect).
  // There is NO "自己接入 / 自定义调用" button on this screen — that anchor never
  // existed here; "自定义调用" is the CustomCallEditor reached one step deeper. This
  // helper waits for the terminal repair action and returns its text.
  async function waitForModeRepairAction(timeoutMs = 40_000) {
    const action = win.getByRole('button', { name: WALK_COPY.manualSetup, exact: true }).first()
    await action.waitFor({ state: 'visible', timeout: timeoutMs })
    return action
  }

  // Drive the real failure→custom-call path (probed 2026-09-01 against a real build):
  //   继续手动配置 → model detail page (data-model-settings-page="model") whose
  //   "请求方式" summary row (aria "设置 … 的请求方式") opens the request-script editor.
  // NOTE: the editor's own title is "请求脚本" (customCall.title), NOT "自定义调用" —
  // "自定义调用" is only the label of the *entry row* in the model list. The editor page
  // is data-model-settings-page="script" with data-model-access-entry="custom-call-script".
  // Returns the editor's script page (the stable container J06/J07 assert within).
  async function openCustomCallFromRepair() {
    const action = await waitForModeRepairAction()
    await action.click()
    // Land on the model detail page (rendered on top of the connection workspace).
    await win.locator('[data-model-settings-page="model"]').first().waitFor({ state: 'visible', timeout: 8000 })
    const requestRow = win.getByRole('button', { name: WALK_COPY.requestMethod }).first()
    await requestRow.waitFor({ state: 'visible', timeout: 8000 })
    await requestRow.click()
    const editor = win.locator('[data-model-settings-page="script"]').first()
    await editor.waitFor({ state: 'visible', timeout: 8000 })
    return editor
  }

  // 画布 store 的走查桥：项目工作台（ProductionCanvasLandingHost）挂载时读一次 localStorage.__nomiE2E，
  // 为 '1' 才把 store 挂到 window.__nomiCanvasStore。文字节点的步骤本体（_textTasksSteps.mjs addTextNode）靠它拿节点 id，
  // 所以要在第一次进项目工作台之前置旗；进去以后再置，这一次挂载读不到。
  async function enableCanvasBridge() {
    await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  }

  async function openCanvas() {
    // Idempotent: a journey opens the canvas once for the image step and again
    // for the video/recovery step. If the generation-canvas toolbar is already
    // mounted we are on it — re-running project navigation from the canvas would
    // hunt for a project-library card that is not on screen and time out.
    const canvasToolbar = canvasAddBar(win)
    if (await canvasToolbar.isVisible().catch(() => false)) return
    await closeSettings()
    if (await canvasToolbar.isVisible().catch(() => false)) return
    const existing = win.locator('[data-project-card]').first()
    if (await existing.count()) await existing.click()
    else await newProjectEntry(win).click()
    await win.waitForTimeout(1800)
    // Land on the generation canvas so the node toolbar (添加X节点) is present.
    const generate = win.getByRole('button', { name: WALK_COPY.generate, exact: false }).first()
    if (await generate.isVisible().catch(() => false)) await generate.click()
    await win.waitForTimeout(800)
  }

  return {
    ...launched,
    diagnostics,
    openModels,
    expandGenerationProviders,
    expandHomeGroup,
    openHomeConnection,
    openRelayWizard,
    openRelayProtocols,
    showManualProtocol,
    fillRelay,
    fetchModels,
    chooseModels,
    fetchAndChooseModels,
    waitForCatalogModels,
    catalogSnapshot,
    closeAccessModal,
    closeSettings,
    openModelDetail,
    closeModelDetail,
    waitForModeRepairAction,
    openCustomCallFromRepair,
    enableCanvasBridge,
    openCanvas,
    screenshot: (name) => recorder.screenshot(win, name),
    copy: WALK_COPY,
    locale: WALK_LOCALE,
  }
}
