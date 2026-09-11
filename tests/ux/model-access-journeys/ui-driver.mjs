import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from '../_launchApp.mjs'
import { JourneyFailure } from './evidence.mjs'

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
// its real flow is: fill → 保存连接 → 获取模型列表 → inline picker → 验证 N 个模型
// → verification page (完成). The old driver looked for 添加一个 AI 模型 / 拉取模型 /
// 选择模型 / 接入并验证 which no longer exist on this path.
// ─────────────────────────────────────────────────────────────────────────────

export async function launchJourneyUi({ journey, recorder }) {
  const launched = await launchNomiApp({ name: `model-access-${journey.id.toLowerCase()}` })
  const { win, settingsDir } = launched
  const diagnostics = []
  win.on('pageerror', (error) => diagnostics.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => { if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const skip = win.locator('[data-splash-skip="true"]')
  if (await skip.isVisible().catch(() => false)) await skip.click()

  async function openModels() {
    await win.getByRole('button', { name: '设置', exact: true }).first().click()
    const dialog = win.getByRole('dialog', { name: '设置', exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 8000 })
    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible', timeout: 8000 })
    // The workspace is the ModelSettingsHome; wait for it to render before acting.
    await win.locator('[data-model-settings-page="home"]').waitFor({ state: 'visible', timeout: 8000 })
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
    await win.locator('[data-model-home-action="custom-api"]').first().click()
    // The wizard renders as a page (header 接入 API / 中转站). Anchor on the name
    // field placeholder — it is the first thing the fill step needs anyway.
    await win.getByPlaceholder('如：TOAPI 中转').waitFor({ state: 'visible', timeout: 8000 })
  }

  async function fillRelay({ name, baseUrl, apiKey = 'sk-fixture-key' }) {
    await win.getByPlaceholder('如：TOAPI 中转').fill(name)
    await win.getByPlaceholder('https://api.openai.com/v1').fill(baseUrl)
    await win.getByPlaceholder('sk-...').fill(apiKey)
  }

  // The protocol choices (Chat Completions / Responses / Anthropic) live behind
  // the "高级设置（接口协议 / 自定义请求头）" disclosure.
  async function openRelayProtocols() {
    await win.getByText(/高级设置/).first().click()
    await win.waitForTimeout(400)
  }

  // 测试连接 lives inside a SEPARATE "连接诊断（可选）" <details> disclosure
  // (data-model-connection-diagnostics), collapsed by default — not under 高级设置
  // (probed 2026-09-01). Open that <details> via its summary before the button
  // has any layout box.
  async function openConnectionDiagnostics() {
    const details = win.locator('[data-model-connection-diagnostics]')
    if ((await details.getAttribute('open')) !== null) return
    await details.locator('summary').first().click()
    await win.waitForTimeout(300)
  }

  // The 测试连接 button is a Mantine DesignButton whose accessible name is not
  // exposed to getByRole (probed 2026-09-01: getByRole button "测试连接" = 0 while
  // the real <button> exists). Anchor on the button element + its text inside the
  // diagnostics disclosure, scrolling it into view since it sits below the fold.
  async function clickTestConnection() {
    await openConnectionDiagnostics()
    const button = win.locator('[data-model-connection-diagnostics] button', { hasText: '测试连接' }).first()
    await button.waitFor({ state: 'visible', timeout: 8000 })
    await button.scrollIntoViewIfNeeded()
    await button.click()
  }

  // Relay wizard flow: 保存连接 unlocks 获取模型列表, which reveals the inline model
  // picker. Idempotent: skips 保存连接 if it is already gone (already saved).
  async function fetchModels() {
    const save = win.getByRole('button', { name: '保存连接', exact: true })
    if (await save.isVisible().catch(() => false)) {
      await save.first().click()
    }
    const fetch = win.getByRole('button', { name: /获取模型|获取可用模型|重新获取列表/ }).first()
    await fetch.waitFor({ state: 'visible', timeout: 15_000 })
    await fetch.click()
    // Picker is inline on the same page: model rows + a "验证 N 个模型" confirm.
    await win.getByRole('button', { name: /验证\s*\d+\s*个模型/ }).first().waitFor({ state: 'visible', timeout: 15_000 })
  }

  async function chooseModels(modelIds) {
    for (const modelId of modelIds) {
      const label = win.getByRole('button', { name: modelId, exact: true }).first()
      await label.waitFor({ state: 'visible', timeout: 5000 })
      await label.click()
    }
    // Confirm reads "验证 N 个模型"; N reflects the current selection count.
    const confirm = win.getByRole('button', { name: new RegExp(`验证\\s*${modelIds.length}\\s*个模型`) }).first()
    await confirm.waitFor({ state: 'visible', timeout: 5000 })
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
  // 全部重新验证 / 完成). Return to the model home so the settings tab can close.
  async function closeAccessModal() {
    const done = win.getByRole('button', { name: '完成', exact: true })
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      await win.waitForTimeout(300)
      return
    }
    // Not on the verification page: walk back out of any wizard page via 返回.
    for (let i = 0; i < 4; i += 1) {
      if (await win.locator('[data-model-settings-page="home"]').isVisible().catch(() => false)) return
      const back = win.getByRole('button', { name: '返回', exact: true }).first()
      if (!(await back.isVisible().catch(() => false))) return
      await back.click()
      await win.waitForTimeout(250)
    }
  }

  async function closeSettings() {
    await closeAccessModal()
    const dialog = win.getByRole('dialog', { name: '设置', exact: true })
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.locator('[data-settings-close]').first().click()
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }

  // ── Verification-failure repair path (probed 2026-09-01 against a real build) ──
  // When auto-adaptation guesses a mode wrong, the verification screen
  // (AdapterVerificationScreen) surfaces a per-model recovery block *once the whole
  // run is terminal* (stage failed/partial/needs_ai — a per-mode "没通过自检" badge
  // alone is NOT terminal, the run keeps testing the other models). The repair CTA
  // is category-driven by adapterFailureAdvice: a 5xx maps to category "server" →
  // primary "重新验证" plus the universal escape hatch "继续手动配置" (onSelfConnect).
  // There is NO "自己接入 / 自定义调用" button on this screen — that anchor never
  // existed here; "自定义调用" is the CustomCallEditor reached one step deeper. This
  // helper waits for the terminal repair action and returns its text.
  async function waitForModeRepairAction(timeoutMs = 40_000) {
    const action = win.getByRole('button', { name: '手动配置', exact: true }).first()
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
    const requestRow = win.getByRole('button', { name: /设置.*的请求方式/ }).first()
    await requestRow.waitFor({ state: 'visible', timeout: 8000 })
    await requestRow.click()
    const editor = win.locator('[data-model-settings-page="script"]').first()
    await editor.waitFor({ state: 'visible', timeout: 8000 })
    return editor
  }

  async function openCanvas() {
    // Idempotent: a journey opens the canvas once for the image step and again
    // for the video/recovery step. If the generation-canvas toolbar is already
    // mounted we are on it — re-running project navigation from the canvas would
    // hunt for a project-library card that is not on screen and time out.
    const canvasToolbar = win.locator('.generation-canvas-v2-toolbar')
    if (await canvasToolbar.isVisible().catch(() => false)) return
    await closeSettings()
    if (await canvasToolbar.isVisible().catch(() => false)) return
    const existing = win.locator('[data-project-card]').first()
    if (await existing.count()) await existing.click()
    else await win.getByText('新建空白项目', { exact: false }).first().click()
    await win.waitForTimeout(1800)
    // Land on the generation canvas so the node toolbar (添加X节点) is present.
    const generate = win.getByRole('button', { name: '生成', exact: false }).first()
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
    openConnectionDiagnostics,
    clickTestConnection,
    fillRelay,
    fetchModels,
    chooseModels,
    fetchAndChooseModels,
    waitForCatalogModels,
    catalogSnapshot,
    closeAccessModal,
    closeSettings,
    waitForModeRepairAction,
    openCustomCallFromRepair,
    openCanvas,
    screenshot: (name) => recorder.screenshot(win, name),
  }
}
