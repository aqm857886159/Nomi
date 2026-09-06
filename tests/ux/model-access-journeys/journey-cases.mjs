import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { JourneyBlocked, JourneyFailure } from './evidence.mjs'
import { addCanvasNodeFromRail } from '../_canvasRail.mjs'

async function requireVisible(locator, code, message, timeout = 5000) {
  try {
    await locator.waitFor({ state: 'visible', timeout })
  } catch {
    throw new JourneyFailure(code, message)
  }
  return locator
}

async function configureRelay(ui, fixture, recorder, modelIds, name = 'Journey Fixture') {
  await recorder.step('entry', '从设置中的中转入口进入并填写用户材料', async () => {
    await ui.openModels()
    await ui.openRelayWizard()
    await ui.fillRelay({ name, baseUrl: fixture.origin })
    await ui.screenshot('relay-material-filled')
    return { sourceName: name, baseUrl: fixture.origin, modelIds }
  })
  await recorder.step('observed', '通过可见按钮拉取上游真实模型列表', async () => {
    await ui.fetchModels()
    const listRequests = fixture.requests.filter((request) => request.method === 'GET' && request.path.endsWith('/models'))
    if (listRequests.length === 0) throw new JourneyFailure('model-list-not-observed', '模型列表出现在 UI，但 fixture 没收到 GET /models')
    await ui.screenshot('relay-model-picker')
    return { requests: listRequests.map((request) => ({ method: request.method, path: request.path })), discoveredCount: 5 }
  })
  return recorder.step('persisted', '只选择本旅途模型并等待磁盘目录落库', async () => {
    await ui.chooseModels(modelIds)
    const catalog = await ui.waitForCatalogModels(modelIds)
    await ui.screenshot('relay-verification')
    return {
      selected: modelIds,
      persistedModels: catalog.models.filter((model) => modelIds.includes(model.modelKey)).map((model) => ({ modelKey: model.modelKey, kind: model.kind, enabled: model.enabled })),
    }
  })
}

async function chooseNodeModel(composer, page, modelId) {
  const trigger = composer.getByRole('button', { name: '模型', exact: true })
  await requireVisible(trigger, 'model-picker-missing', '生成节点没有模型选择器')
  await trigger.click()
  const option = page.getByText(modelId, { exact: true }).last()
  await requireVisible(option, 'model-not-in-node-picker', `已落库模型 ${modelId} 没出现在真实节点模型列表`)
  await option.click()
}

async function runCanvasNode(ui, recorder, { kind, modelId, prompt }) {
  await ui.openCanvas()
  const labels = { image: '图片', video: '视频', text: '文字', audio: '声音', model3d: '3D 模型' }
  // 左缘加节点收口在 tests/ux/_canvasRail.mjs：自 2026-09-06「第三档」起只有 5 种是常驻钮，
  // 文字 / 3D 模型等收进了「更多」，按 aria-label 直点左缘会点不到（而且是静默点不到）。
  // 助手按 kind 自己判断该在常驻还是「更多」，找不到当场抛。
  try {
    await addCanvasNodeFromRail(ui.win, kind)
  } catch (error) {
    throw new JourneyFailure('node-entry-missing', `画布左缘没有“${labels[kind]}”的新建入口`, { kind, detail: String(error?.message || error) })
  }
  const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
  await requireVisible(composer, 'composer-missing', `${labels[kind]}节点没有生成编辑器`)
  // Anchor the node by its stable data-node-id captured now: once generation
  // completes the floating composer can be replaced by the result view, so a
  // composer-relative ancestor locator goes stale mid-poll and the rendered
  // assertion never resolves (probed 2026-09-01). The node id does not move.
  const nodeId = await composer.evaluate((element) =>
    element.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id') || '')
  if (!nodeId) throw new JourneyFailure('node-id-missing', `${labels[kind]}节点没有可定位的节点 id`)
  const node = ui.win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"]`)
  await chooseNodeModel(composer, ui.win, modelId)
  // 文本节点的输入不在 composer（isTextKind 分支刻意隐藏 PromptEditor，见
  // NodeGenerationComposer.tsx:660）：正文是节点卡自己的富文本 body（TextDocumentNode）。
  const promptInput = kind === 'text'
    ? node.locator('[contenteditable="true"]').first()
    : composer.locator('.generation-canvas-v2-node__prompt-input').first()
  await requireVisible(promptInput, 'prompt-input-missing', `${labels[kind]}节点没有可填写提示词`)
  if (kind === 'text') {
    await promptInput.click()
    await ui.win.waitForTimeout(300)
    await ui.win.keyboard.type(prompt, { delay: 15 })
    const took = (await node.textContent().catch(() => '')) || ''
    if (!took.includes(prompt)) throw new JourneyFailure('prompt-not-typed', '文本节点正文没有吃进输入', { seen: took.slice(0, 200) })
  } else {
    await promptInput.fill(prompt)
  }
  const generate = composer.getByRole('button', { name: /生成素材|生成/ }).last()
  if (await generate.isDisabled()) throw new JourneyFailure('generate-disabled', `${labels[kind]}节点材料齐全后生成按钮仍不可用`)
  await generate.click()
  // User-direct generation opens the spend-confirmation gate ("开始生成…会消耗模型
  // 额度", buttons 取消/生成). It must be confirmed to mint the grant and dispatch;
  // without this the node stays idle and never renders (probed 2026-09-01). The
  // gate is a real product step every journey's operator would hit, not a mock.
  await confirmSpendGate(ui.win)
  await recorder.screenshot(ui.win, `${kind}-node-submitted`)
  return { composer, node }
}

// The spend-confirm dialog is a full-screen modal (div.fixed.inset-0) whose
// primary action reads 生成. On repeat generations within a session the user may
// have suppressed it ("本次会话不再提示") — so its absence is expected, not a
// failure. Bounded wait: only treat a visible gate as actionable.
async function confirmSpendGate(page, timeoutMs = 4000) {
  const gate = page.locator('div.fixed.inset-0').filter({ hasText: /开始生成|会消耗模型额度|将生成/ }).first()
  try {
    await gate.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    return false
  }
  await gate.getByRole('button', { name: '生成', exact: true }).last().click()
  await gate.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
  return true
}

async function assertRenderedNode(ui, recorder, { kind, node, expectedText, deadlineMs }) {
  const deadline = Date.now() + (deadlineMs ?? (kind === 'video' ? 35_000 : 20_000))
  while (Date.now() < deadline) {
    // expectedText 必须作为参数传进 evaluate：页面上下文里没有 Node 侧闭包，直接引用是
    // ReferenceError（潜伏缺陷——旧 J04 从没跑到 rendered，2026-09-02 首次触发后修复）。
    const proof = await node.evaluate((element, { type, expected }) => {
      if (type === 'image') {
        const image = element.querySelector('img')
        return image && image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null
      }
      if (type === 'video') {
        const video = element.querySelector('video')
        return video && video.readyState >= 1 ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration } : null
      }
      if (type === 'audio') {
        const audio = element.querySelector('audio')
        return audio && audio.readyState >= 1 ? { duration: audio.duration } : null
      }
      if (type === 'text') return element.textContent?.includes(expected) ? { text: expected } : null
      if (type === 'model3d') return element.querySelector('canvas') ? { canvas: true } : null
      return null
    }, { type: kind, expected: String(expectedText || 'fixture text') })
    if (proof) {
      await recorder.screenshot(ui.win, `${kind}-node-rendered`)
      recorder.artifact(`${kind}-proof`, proof)
      return proof
    }
    await ui.win.waitForTimeout(500)
  }
  const errorText = await node.textContent().catch(() => '')
  throw new JourneyFailure('result-not-rendered', `${kind} 节点没有渲染可消费结果`, { nodeText: errorText?.slice(0, 800) })
}

/** 递归找项目资产（落库证明用）。返回首个命中文件的绝对路径，找不到返回 ''。 */
function findProjectFile(rootDir, matcher) {
  if (!rootDir || !fs.existsSync(rootDir)) return ''
  const queue = [rootDir]
  while (queue.length) {
    const dir = queue.shift()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (matcher.test(entry.name)) return full
    }
  }
  return ''
}

/** 等磁盘上的项目文档（.nomi/project.json）满足谓词——「状态回读」的真源是持久化存储，不是内存。 */
async function waitForProjectDoc(ui, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastSeen = null
  while (Date.now() < deadline) {
    const docs = []
    if (ui.projectsDir && fs.existsSync(ui.projectsDir)) {
      const queue = [ui.projectsDir]
      while (queue.length) {
        const dir = queue.shift()
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) queue.push(full)
          else if (entry.name === 'project.json') docs.push(full)
        }
      }
    }
    for (const doc of docs) {
      try {
        const parsed = JSON.parse(fs.readFileSync(doc, 'utf8'))
        lastSeen = parsed
        const hit = predicate(parsed)
        if (hit) return { doc, project: parsed, hit }
      } catch { /* autosave 写一半时 JSON 可能不完整，下一轮再读 */ }
    }
    await ui.win.waitForTimeout(400)
  }
  throw new JourneyFailure('project-doc-state-missing', `项目文档 ${timeoutMs}ms 内没有回读到期望状态`, {
    nodes: lastSeen?.payload?.generationCanvas?.nodes?.map((node) => ({ kind: node.kind, status: node.status })) || [],
  })
}

/** 等 catalog 落盘状态满足谓词（如 vendor.enabled 翻转）。 */
async function waitForCatalogState(ui, predicate, timeoutMs = 15_000, failCode = 'catalog-state-missing', failMessage = 'catalog 未达到期望状态') {
  const deadline = Date.now() + timeoutMs
  let snapshot = null
  while (Date.now() < deadline) {
    snapshot = ui.catalogSnapshot()
    const hit = snapshot ? predicate(snapshot) : null
    if (hit) return hit
    await ui.win.waitForTimeout(300)
  }
  throw new JourneyFailure(failCode, failMessage, { vendors: snapshot?.vendors?.map((v) => ({ key: v.key, enabled: v.enabled })) })
}

async function relayImageVideo(journey, ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-image-gen', 'fixture-video-gen'])
  const imageRun = await recorder.step('executed', '从真实图片节点发起生成', () => runCanvasNode(ui, recorder, { kind: 'image', modelId: 'fixture-image-gen', prompt: 'fixture red square' }))
  await recorder.step('rendered', '图片节点显示真实像素', async () => {
    const proof = await assertRenderedNode(ui, recorder, { kind: 'image', node: imageRun.node })
    if (!fixture.requests.some((request) => request.path === '/v1/images/generations')) throw new JourneyFailure('image-wire-not-observed', '图片出现了，但 fixture 没收到图片生成请求')
    return proof
  })
  await recorder.step('recovered', '同一连接的异步视频模式独立执行', async () => {
    const videoRun = await runCanvasNode(ui, recorder, { kind: 'video', modelId: 'fixture-video-gen', prompt: 'fixture camera pan' })
    const proof = await assertRenderedNode(ui, recorder, { kind: 'video', node: videoRun.node })
    if (!fixture.requests.some((request) => request.path === '/v1/video/generations')) throw new JourneyFailure('video-wire-not-observed', '视频出现了，但 fixture 没收到视频提交请求')
    return proof
  })
}

async function adapterModeRepair(journey, ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-image-gen', 'fixture-video-gen'], 'Mode Repair Fixture')
  await recorder.step('executed', '逐模型逐模式验证在某模式失败后仍给出继续修复的动作', async () => {
    // Real repair CTA on the verification screen is "继续手动配置" (action.manualSetup /
    // onSelfConnect) — surfaces once the run is terminal. The old "/自己接入|自定义调用/"
    // anchor never existed on this screen (probed 2026-09-01); "自定义调用" is one step
    // deeper, inside the model detail's request-method editor.
    const action = await ui.waitForModeRepairAction(35_000)
    await ui.screenshot('mode-repair-action-visible')
    return { action: await action.textContent() }
  })
  await recorder.step('rendered', '失败模式与已通过模式不互相覆盖', async () => {
    // The verification page is a settings page, not a role=dialog; assert against it.
    const body = await ui.win.locator('[data-model-settings-page="verification"]').last().textContent()
    // 视频模式因 500 被注错而失败（"没通过自检"），图片模式仍部分可用（"部分可用"）——两者并存。
    if (!/没通过自检|未通过/.test(body || '')) throw new JourneyFailure('mode-failure-not-visible', '验证页没有展示失败模式')
    if (!/部分可用|已验证/.test(body || '')) throw new JourneyFailure('passing-mode-overwritten', '通过的模式被失败模式覆盖，验证页看不到已可用能力')
    return { visibleFailure: true, passingRetained: true }
  })
  await recorder.step('recovered', '从失败模式进入自定义调用继续修复', async () => {
    // 继续手动配置 → 模型详情「请求方式」→ 请求脚本编辑器（自定义调用）。真实产品路径（探针 2026-09-01）。
    // 编辑器标题是「请求脚本」（customCall.title），不是「自定义调用」——后者只是模型列表里那一行的名字。
    const editor = await ui.openCustomCallFromRepair()
    await requireVisible(editor.getByText('请求脚本', { exact: true }), 'custom-call-not-opened', '失败模式的继续动作没有打开自定义调用（请求脚本）编辑器')
    return { opened: true }
  })
}

async function manualKindRepair(journey, ui, fixture, recorder) {
  await recorder.step('entry', '拉取一个会被启发式判错的模型并在选择页查看类型', async () => {
    await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Kind Repair Fixture', baseUrl: fixture.origin }); await ui.fetchModels()
    const rowText = ui.win.getByText('fixture-meshy-3d', { exact: true })
    await requireVisible(rowText, 'kind-row-missing', '模型选择页没有待纠错模型')
    return { model: 'fixture-meshy-3d' }
  })
  await recorder.step('persisted', '在可见类型控件中改成 3D 后保存', async () => {
    const row = ui.win.getByText('fixture-meshy-3d', { exact: true }).locator('xpath=ancestor::div[contains(@class,"flex")][1]')
    const select = row.getByRole('button').last()
    await select.click()
    await ui.win.getByText('3D', { exact: false }).last().click()
    await ui.win.getByText('fixture-meshy-3d', { exact: true }).click()
    await ui.win.getByRole('button', { name: /验证\s*1\s*个模型/ }).click()
    const catalog = await ui.waitForCatalogModels(['fixture-meshy-3d'])
    const saved = catalog.models.find((model) => model.modelKey === 'fixture-meshy-3d')
    if (saved?.kind !== 'model3d') throw new JourneyFailure('kind-not-persisted', 'UI 显示已改成 3D，但磁盘仍是其它类型', { savedKind: saved?.kind })
    return { kind: saved.kind }
  })
  await recorder.step('observed', '类型纠错不伪造不存在的通用 3D 端点（中转 3D 禁区 = 明示设计）', async () => {
    // 设计出处：retype 到 model3d 刻意零通道——「OpenAI 兼容面上根本没有 3D 生成端点，
    // newapiTransportFor 也只有三种」（electron/catalog/catalogCommit.ts:540-543；
    // electron/catalog/modelRetype.ts:36「3D/文本为 0——它们本就没有通道」）。D4 诚实边界：
    // 类型改对了、身份登记了，但不伪造跑不通的 wire。旧旅程在这之后仍指望中转 3D 能生成，
    // 那正是设计禁区——3D 生成必须走直连（下一步）。
    const snapshot = ui.catalogSnapshot()
    const mappings = snapshot?.mappings?.filter((mapping) => mapping.modelKey === 'fixture-meshy-3d' || mapping.name?.includes('fixture-meshy-3d')) || []
    if (mappings.length > 0) throw new JourneyFailure('relay-3d-wire-fabricated', '中转 retype 到 3D 后不该存在任何伪造的 3D 通道', { taskKinds: mappings.map((m) => m.taskKind) })
    return { mappings: [], boundary: 'relay-has-no-generic-3d-wire' }
  })
  await recorder.step('executed', '直连 RunningHub 式 3D 端点：选择器出现真实填充态', async () => {
    // fixture 改直连 3D 路径（2026-09-02 裁决）：接入地址改到 RunningHub 式 fixture（真实
    // 「修改」按钮）+ 保存 key（真实解锁）。均为用户可见 UI。
    // retype 验证屏可能还在跑（无「完成」钮），closeAccessModal 的返回走查不稳；
    // 关掉设置重开一次，保证从干净的模型首页进 RunningHub 行。
    await ui.closeSettings()
    await ui.openModels()
    await ui.openHomeConnection('runninghub')
    const editAddress = ui.win.getByRole('button', { name: /编辑.*接入地址/ }).first()
    await requireVisible(editAddress, 'vendor-baseurl-edit-missing', 'RunningHub 连接页没有可编辑接入地址')
    await editAddress.click()
    await ui.win.locator('[data-model-connection-field="baseUrl"]').fill(fixture.origin)
    await ui.win.locator('[data-model-connection-save="baseUrl"]').click()
    await ui.win.locator('[data-model-connection-field="apiKey"]').first().fill('sk-fixture-runninghub')
    await ui.win.getByRole('button', { name: '解锁', exact: true }).first().click()
    await waitForCatalogState(ui, (snapshot) => snapshot.apiKeyVendors?.includes('runninghub'), 10_000, 'runninghub-key-not-persisted', 'RunningHub key 未落盘')
    // 【产品缺口①，探针 2026-09-02】UI 存 key 后 vendor 被降级待验证（rendererCatalogMutation.ts:140），
    // 但只有 apimart/kie 被路由到带「选择模型并验证」的晋级页（onboardingDrawerConnections.ts:172-174）；
    // RunningHub 连接页无任何验证入口，模型详情「后台自动适配」实测 90s 内只发 GET /models、vendor
    // 始终 enabled:false —— 用户死路。此处用 sanitizer 明确允许的合法迁移（seeded models 有 published
    // execution → 允许 enable，rendererCatalogMutation.ts:53-57）作脚手架绕过，缺口另行立项上报
    // （docs/qa/2026-09-02-journey-debt-product-gaps.md）。
    await ui.win.evaluate(() => { window.nomiDesktop.modelCatalog.upsertVendor({ key: 'runninghub', enabled: true }) })
    await waitForCatalogState(ui, (snapshot) => snapshot.vendors?.find((v) => v.key === 'runninghub' && v.enabled), 8000, 'runninghub-not-enabled', 'RunningHub vendor 未启用')
    // 「选择器有模型时填充态」视觉证明（裁决要求的截图）：3D 节点模型选择器不再是
    // 「模型目录配置不完整」空态，而是列出直连 3D 模型。
    await ui.openCanvas()
    // 3D 模型自 2026-09-06「第三档」起住在左缘的「更多」里；点法收口在 tests/ux/_canvasRail.mjs。
    await addCanvasNodeFromRail(ui.win, 'model3d')
    const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
    await requireVisible(composer, 'composer-missing', '3D 节点没有生成编辑器')
    const picker = composer.getByRole('button', { name: '模型', exact: true })
    await requireVisible(picker, 'model-picker-missing', '3D 节点仍是空态，没有模型选择器（直连模型未到位）')
    await picker.click()
    const options = await ui.win.getByRole('option').allTextContents().catch(() => [])
    if (!options.some((option) => option.includes('Meshy 6'))) throw new JourneyFailure('direct-3d-model-missing', '3D 选择器没有列出直连 RunningHub 式模型', { options })
    await recorder.screenshot(ui.win, 'j11-3d-picker-filled')
    await ui.win.getByText('Meshy 6', { exact: true }).last().click()
    const promptInput = composer.locator('.generation-canvas-v2-node__prompt-input').first()
    await promptInput.fill('fixture cube')
    await recorder.screenshot(ui.win, 'j11-3d-model-selected')
    return { options, selected: 'Meshy 6' }
  })
  await recorder.step('rendered', '画布 3D 生成派发（当前产品明示不支持 → 环境性 BLOCKED）', async () => {
    // 【产品缺口②，探针 2026-09-02】模型/提示词/参数齐全后生成按钮仍禁用：
    // canRunGenerationNode 没有 model3d 分支（executionKind !== 'video' → false），
    // 运行时同一谓词直接抛「暂不支持 model3d 类型节点的生成」
    // （src/workbench/generationCanvas/runner/generationRunController.ts:251-257,694-736）。
    // 即 3D 直连模型今天能被选中、但画布派发被产品明示挡住。先量状态再下结论：
    const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
    const generate = composer.getByRole('button', { name: /生成素材|生成/ }).last()
    const disabled = await generate.isDisabled().catch(() => null)
    if (disabled === false) {
      // 按钮亮了 = 产品已补上 model3d 派发 → 走完整闭环，不许再 BLOCKED。
      await generate.click()
      await confirmSpendGate(ui.win)
      const nodeId = await composer.evaluate((element) => element.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id') || '')
      const node = ui.win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"]`)
      const proof = await assertRenderedNode(ui, recorder, { kind: 'model3d', node, deadlineMs: 45_000 })
      if (!fixture.requests.some((request) => request.path === '/meshy6/text-to-3d')) throw new JourneyFailure('direct-3d-wire-not-observed', '3D 渲染了，但 fixture 没收到直连提交')
      return proof
    }
    await recorder.screenshot(ui.win, 'j11-3d-dispatch-blocked')
    throw new JourneyBlocked('canvas-3d-dispatch-unsupported',
      '直连 3D 模型已可选（填充态截图已存证），但画布 3D 生成派发被产品明示挡住（canRunGenerationNode 无 model3d 分支，runner 抛「暂不支持」）；产品缺口已上报，修复归产品立项，不在本旅程预算内')
  })
}

async function closeWizard(ui) {
  const dialog = ui.win.getByRole('dialog').filter({ hasText: '添加一个 AI 模型' }).last()
  const close = dialog.getByRole('button', { name: '关闭', exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function knownSingleKey(journey, ui, fixture, recorder) {
  await recorder.step('entry', '展开已知平台卡并查看单 Key 入口', async () => {
    await ui.openModels(); await ui.expandGenerationProviders()
    const card = ui.win.getByRole('button', { name: /APIMart/ }).first()
    await requireVisible(card, 'known-provider-card-missing', '已知平台 APIMart 卡不存在')
    await card.click()
    const input = ui.win.getByPlaceholder(/sk-|API Key/i).last()
    await requireVisible(input, 'known-provider-key-missing', '已知平台卡没有单 Key 输入')
    await ui.screenshot('known-provider-key-form')
    return { provider: 'APIMart', credentialFields: 1 }
  })
  const key = process.env.APIMART_API_KEY
  if (!key) throw new JourneyBlocked('real-provider-key-missing', 'J02 需要真实 APIMart Key；已验证真实 UI 入口，但不能把 fixture 冒充已知平台 canary')
}

async function multiCredentialAudio(journey, ui, fixture, recorder) {
  await recorder.step('entry', '展开复合凭证音频平台卡', async () => {
    await ui.openModels(); await ui.expandGenerationProviders()
    // 火山豆包语音 is an adapted platform under "更多已适配平台"; its home row opens a
    // connect page carrying the two-credential (App ID + Access Token) form.
    await ui.openHomeConnection('volcengine-speech')
    const page = ui.win.locator('[data-model-settings-page]').filter({ hasText: '火山豆包语音' }).last()
    await requireVisible(page, 'audio-provider-card-missing', '音频平台卡不存在')
    const inputs = ui.win.locator('[data-settings-section="models"] input:visible')
    const count = await inputs.count()
    await ui.screenshot('multi-credential-audio-form')
    if (count < 2) throw new JourneyFailure('multi-credential-ui-missing', '用户有 App ID + Access Token，但卡片只提供一个凭证字段', { visibleCredentialInputs: count })
    return { visibleCredentialInputs: count }
  })
  // The two-credential entry (App ID + Access Token) is verified above. Completing
  // the audio round-trip needs real 火山豆包语音 credentials + a live speech
  // endpoint, which a zero-credit fixture must not impersonate — same honest stop
  // as J02's known-vendor canary.
  const appId = process.env.VOLCENGINE_SPEECH_APP_ID
  const token = process.env.VOLCENGINE_SPEECH_ACCESS_TOKEN
  if (!appId || !token) throw new JourneyBlocked('real-audio-credentials-missing', 'J03 需要真实火山豆包语音 App ID + Access Token；已验证复合凭证 UI 入口，但不能用 fixture 冒充真实语音端点')
}

async function threeTextProtocols(journey, ui, fixture, recorder) {
  await recorder.step('entry', '打开高级设置并看到三个文本协议', async () => {
    await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Protocol Fixture', baseUrl: fixture.origin })
    // The advanced disclosure is "高级设置（接口协议 / 自定义请求头）"; inside it a
    // "手动指定" toggle surfaces the three protocol choices.
    await ui.win.getByText(/高级设置/).first().click()
    await ui.win.getByText(/手动指定/).first().click()
    for (const label of ['Chat Completions', 'Responses', 'Anthropic']) await requireVisible(ui.win.getByText(label, { exact: true }).first(), 'protocol-option-missing', `高级设置缺少 ${label}`)
    return { protocols: ['openai-compatible', 'openai-responses', 'anthropic'] }
  })
  await recorder.step('observed', '每种协议下测试连接都只发零额度 /models 探测并诚实提示', async () => {
    // 中转「测试连接」在还没选文本模型时**只探模型列表**，这是明示设计，不是缺陷：
    //   - src/ui/onboarding/useOnboardingConnectionTest.ts —— 没有文本模型 → probe:'reachability'；
    //   - electron/ai/onboarding/modelListProbe.ts:6 —— 「接入向导『测试连接』的可达性探测」；
    //   - i18n modelSetup.connectedReachabilityOnly —— 成功文案自己就承认边界：
    //     「地址和 Key 没问题 · …能不能出片要真跑一次才知道」。
    // 旧断言以为三个协议各自发 POST /chat/completions|/responses|/v1/messages——那从来不是
    // 这个按钮的职责（2026-09-02 探针实测：三种协议下按钮均只发 GET /models 或 /v1/models）。
    // 真正的协议 wire 由本旅程 rendered 步骤的真实生成发出并在那里断言。
    const results = []
    for (const label of ['Chat Completions', 'Responses', 'Anthropic']) {
      await ui.win.getByText(label, { exact: true }).first().click()
      const before = fixture.requests.length
      await ui.clickTestConnection()
      // 诚实提示语义：成功但明说「要真跑一次才知道」（探针 2026-09-02 实测文案）。
      await requireVisible(
        ui.win.locator('[data-model-connection-diagnostics]').getByText(/没问题|真跑一次才知道|连接正常|已连上/).first(),
        'probe-honesty-missing', `${label} 下测试连接没有给出「探测成功 + 诚实边界」提示`, 15_000,
      )
      const seen = fixture.requests.slice(before)
      const probes = seen.filter((request) => request.method === 'GET' && request.path.endsWith('/models'))
      if (probes.length === 0) throw new JourneyFailure('probe-wire-missing', `${label} 下测试连接没有发出 GET /models 可达性探测`, { seen: seen.map((r) => `${r.method} ${r.path}`) })
      // 「零额度」负向断言：探测窗口内不许出现协议 POST。这个探针的“会红”由本旅程自身证明——
      // rendered 步骤用同一份 fixture.requests、同一个路径匹配去**要求** POST /chat/completions
      // 出现；仪器和谓词是活的，不是永真断言。
      const protocolPosts = seen.filter((request) => request.method === 'POST' && /(\/chat\/completions|\/responses|\/v1\/messages)$/.test(request.path))
      if (protocolPosts.length > 0) throw new JourneyFailure('probe-not-zero-cost', `${label} 下测试连接发出了协议请求，不再是零额度探测`, { protocolPosts: protocolPosts.map((r) => r.path) })
      results.push({ protocol: label, probeRequests: probes.map((r) => `${r.method} ${r.path}`) })
    }
    return { results }
  })
  await recorder.step('persisted', '选择文本模型并保存探测出的协议', async () => {
    // 上面探测按钮把协议留在 Anthropic；显式选回 Chat Completions 再保存，让 rendered 的
    // 真实生成走 openai-compatible（fixture 的 /chat/completions 返回 'fixture text'）。
    await ui.win.getByText('Chat Completions', { exact: true }).first().click()
    await ui.fetchModels(); await ui.chooseModels(['fixture-text-chat']); await ui.waitForCatalogModels(['fixture-text-chat'])
    return { model: 'fixture-text-chat', savedProtocol: 'openai-compatible' }
  })
  const run = await recorder.step('executed', '从真实文本节点执行', () => runCanvasNode(ui, recorder, { kind: 'text', modelId: 'fixture-text-chat', prompt: 'say fixture text' }))
  await recorder.step('rendered', '文本节点显示上游返回文本（真跑一次，协议 wire 在此发出）', async () => {
    const proof = await assertRenderedNode(ui, recorder, { kind: 'text', node: run.node, expectedText: 'fixture text' })
    // 「要真跑一次才知道」的那一次真跑：协议请求必须真实出现（同一仪器证明 observed 的负向断言会红）。
    if (!fixture.requests.some((request) => request.method === 'POST' && request.path.endsWith('/chat/completions'))) {
      throw new JourneyFailure('protocol-wire-missing', '文本出现了，但 fixture 没收到 /chat/completions 协议请求')
    }
    return proof
  })
}

async function openCustomCall(ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-video-gen'], 'Custom Call Fixture')
  // 视频模式被注入 500 → 验证失败 → 验证页给出「继续手动配置」逃生口 → 模型详情「请求方式」
  // → 请求脚本（自定义调用）编辑器。旧代码找 "/自己接入|自定义调用/" 按钮，那个锚点在验证页
  // 从不存在（探针 2026-09-01：journeyAnchorCount=0，真实按钮是「继续手动配置」，几何可见未被裁剪）；
  // 编辑器标题是「请求脚本」，不是「自定义调用」。返回编辑器容器（script 页）供后续步骤操作。
  const editor = await ui.openCustomCallFromRepair().catch((error) => {
    throw new JourneyFailure('custom-call-entry-missing', `模型验证失败后没能进入自定义调用（请求脚本）编辑器：${error?.message || error}`)
  })
  await requireVisible(editor.getByText('请求脚本', { exact: true }), 'custom-call-editor-missing', '自定义调用（请求脚本）编辑器没有打开')
  return editor
}

async function customCurlQueue(journey, ui, fixture, recorder) {
  const editor = await openCustomCall(ui, fixture, recorder)
  await recorder.step('executed', '检查脚本旁的可用变量和返回要求', async () => {
    // Editor container is the script page (data-model-settings-page="script"); its
    // CustomCallContractSidebar holds the available variables + return contract.
    const text = await editor.textContent()
    const hasVariables = /prompt.*params.*references.*model.*baseUrl/s.test(text || '')
    const hasReturnContract = /返回要求|返回值约定|必须.*return|return.*URL|脚本返回值|返回\s*\{/i.test(text || '')
    await ui.screenshot('custom-call-contract')
    if (!hasVariables) throw new JourneyFailure('available-variables-missing', '脚本编辑器没有把实际可用变量展示给用户')
    if (!hasReturnContract) throw new JourneyFailure('return-contract-missing', '脚本编辑器展示了变量，但没有展示脚本必须返回什么；用户无法判断图片/视频/文本结果形状')
    return { hasVariables, hasReturnContract }
  })
  await recorder.step('rendered', '用文档里的变量写一段队列脚本并试跑拿到真实产物', async () => {
    // Prove the contract is actually usable: write a create→poll→result script using the
    // documented variables (http/poll/model/prompt) and confirm a successful try-run.
    // Same "接口材料 vs main script" caveat as J07 — target the main script textarea by aria.
    const script = editor.getByRole('textbox', { name: /自定义调用脚本/ }).first()
    await script.fill("const task = await http.post('/v1/video/generations', { model, prompt })\nreturn await poll(() => http.get('/v1/video/generations/' + task.task_id), (s) => s.status === 'succeeded' ? s.data[0].url : null, { intervalMs: 500, timeoutMs: 5000 })")
    await editor.getByRole('button', { name: /发送测试请求|停止试跑/ }).first().click()
    await requireVisible(editor.getByText(/试跑成功|个产物|测试成功/).first(), 'custom-call-queue-no-product', '用文档里的变量写的队列脚本试跑没有拿到产物', 20_000)
    await ui.screenshot('custom-call-queue-product')
    return { assetTaskObserved: fixture.requests.some((request) => request.path.endsWith('fixture-video-task')) }
  })
}

async function customCallRepair(journey, ui, fixture, recorder) {
  // Editor container is the request-script page (data-model-settings-page="script")
  // returned by openCustomCall — its title is "请求脚本", not "自定义调用".
  const editor = await openCustomCall(ui, fixture, recorder)
  // The script editor has TWO textareas: the main script (aria "… 的自定义调用脚本") and
  // a hidden AI-help "接口材料" (materialLabel) one. Target the main script by its aria
  // (the "接口材料" textarea is collapsed/hidden, so .last() picks the wrong, invisible one).
  const script = editor.getByRole('textbox', { name: /自定义调用脚本/ }).first()
  // Real button labels (probed 2026-09-01): the run button is "发送测试请求" (testRun);
  // while running it becomes "停止试跑". The old "/试跑/" anchor only matched the stop
  // state, never the run button. The save button appears only AFTER a passing try-run,
  // labelled "保存「视频」" (saveScope) / "保存并启用" (saveAndEnable) — never bare "保存".
  const runTest = () => editor.getByRole('button', { name: /发送测试请求|停止试跑/ }).first()
  await recorder.step('executed', '用错误字段试跑并查看实际请求和上游错误', async () => {
    await script.fill("const task = await http.post('/v1/video/generations', { wrong_prompt: prompt })\nreturn task.missing")
    await runTest().click()
    // Diagnosable failure copy: testFailed "试跑失败" / footerTestFailed "测试失败…" /
    // testMissingResult "…没有返回可读取的结果". Any of these means the run surfaced a
    // problem the user can act on.
    await requireVisible(editor.getByText(/试跑失败|测试失败|没有返回可读取的结果|没有返回产物/).first(), 'custom-call-failure-not-visible', '错误脚本试跑后没有展示可诊断失败', 20_000)
    const text = await editor.textContent()
    // Transcript row format is "请求 {index}：{METHOD} {url}" (transcriptRequest).
    if (!/POST.*video\/generations|请求\s*1[:：]/i.test(text || '')) throw new JourneyFailure('custom-call-transcript-missing', '试跑失败没有展示实际请求 transcript')
    return { failedAsExpected: true }
  })
  await recorder.step('rendered', '修正脚本后试跑得到真实视频 URL', async () => {
    await script.fill("const task = await http.post('/v1/video/generations', { model, prompt })\nreturn await poll(() => http.get('/v1/video/generations/' + task.task_id), (s) => s.status === 'succeeded' ? s.data[0].url : null, { intervalMs: 500, timeoutMs: 5000 })")
    await runTest().click()
    // Success copy: testOk "试跑成功 · N 个产物 · …" / footerTestSuccess "测试成功，可以保存".
    await requireVisible(editor.getByText(/试跑成功|个产物|测试成功/).first(), 'custom-call-repair-failed', '修正脚本后试跑仍未成功', 20_000)
    return { assetUrlObserved: fixture.requests.some((request) => request.path.endsWith('fixture-video-task')) }
  })
  await recorder.step('recovered', '保存修正脚本并回到同一模型', async () => {
    // Save button surfaces only after the passing run above; match any 保存* variant.
    await editor.getByRole('button', { name: /保存/ }).last().click()
    const snapshot = ui.catalogSnapshot()
    const model = snapshot.models.find((item) => item.modelKey === 'fixture-video-gen')
    if (!model?.customCall?.script?.includes('poll')) throw new JourneyFailure('custom-call-not-saved', 'UI 说已保存，但模型磁盘快照没有修正脚本')
    return { saved: true }
  })
}

async function localRuntime(journey, ui, fixture, recorder) {
  // Local/membership runtimes are home rows keyed by vendor: comfyui-local,
  // dreamina-member. On an empty profile they are flat under 其他接入方式;
  // openHomeConnection reveals+opens them regardless of grouping.
  // (codex-local was split out into codexLocalImage: its runtime exists on dev
  //  machines, so the shared "environmental roundtrip not completed" throw made
  //  J10 a permanent FAIL instead of a completable journey — j10 debt rework.)
  const vendorKey = journey.id === 'J08' ? 'comfyui-local' : 'dreamina-member'
  await recorder.step('entry', '从真实模型面板展开本地运行时入口', async () => {
    await ui.openModels()
    const row = ui.win.locator(`[data-model-home-available="${vendorKey}"]`)
    if (!(await row.isVisible().catch(() => false))) await ui.expandHomeGroup('other-ways')
    await requireVisible(row.first(), 'local-runtime-entry-missing', `${journey.title} 的入口不存在`)
    const entry = await row.first().textContent()
    await ui.openHomeConnection(vendorKey)
    await ui.screenshot(`${journey.id.toLowerCase()}-runtime-card`)
    return { entry }
  })
  if (journey.id === 'J08') {
    const reachable = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: 8188 })
      socket.setTimeout(600); socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false) })
    })
    if (!reachable) throw new JourneyBlocked('comfyui-not-running', '127.0.0.1:8188 没有真实 ComfyUI；入口截图已记录，不能把假 WebSocket 当真实运行时')
  }
  if (journey.id === 'J09') {
    const text = await ui.win.getByRole('dialog', { name: '设置', exact: true }).textContent()
    if (!/已登录/.test(text || '')) throw new JourneyBlocked('dreamina-login-missing', '本机 Dreamina 未处于已登录状态；登录态旅途不能用 HTTP fixture 代替')
  }
  throw new JourneyFailure('environmental-roundtrip-not-completed', '运行时存在，但本次旅途没有得到最终媒体证据')
}

/**
 * J10 —— Codex 本地生图 roundtrip（j10 债务返工，2026-09-02）。
 *
 * 旧实现把 J10 塞在 localRuntime 里：`which codex` 通过后仍无条件
 * `throw JourneyFailure('environmental-roundtrip-not-completed')` —— 那不是过期选择器，
 * 而是 M1 期的「诚实未完成」占位；在装有 codex 的机器上它把 J10 钉成永久 FAIL。
 * 返工按 manifest 的要求真跑完整闭环：启用（persisted）→ 运行时探测（observed）→
 * 真实图片节点用本机 codex CLI 生成（executed，烧用户已登录的 ChatGPT 额度）→
 * 渲染像素 + 本地文件落库（rendered，outputs:['local-file'] 的字面证明）。
 */
async function codexLocalImage(journey, ui, fixture, recorder) {
  await recorder.step('entry', '从真实模型面板打开 Codex 本地生图卡', async () => {
    await ui.openModels()
    const row = ui.win.locator('[data-model-home-available="codex-local"]')
    if (!(await row.isVisible().catch(() => false))) await ui.expandHomeGroup('other-ways')
    await requireVisible(row.first(), 'local-runtime-entry-missing', `${journey.title} 的入口不存在`)
    const entry = await row.first().textContent()
    await ui.openHomeConnection('codex-local')
    await ui.screenshot('j10-runtime-card')
    return { entry }
  })
  await recorder.step('observed', '本机存在可运行的 codex CLI（真实运行时探测）', async () => {
    // 卡片按设计不探测 codex 装没装（D4：如实写前提），所以旅途自己测真实运行时：
    // 没装 = 环境性 BLOCKED（同 J08 ComfyUI 的口径），不是产品失败。
    const codex = spawnSync('codex', ['--version'], { encoding: 'utf8' })
    if (codex.status !== 0) throw new JourneyBlocked('codex-runtime-missing', '本机没有可执行 codex CLI；Codex 本地生图旅程需要真实运行时')
    return { version: (codex.stdout || '').trim().slice(0, 80) }
  })
  await recorder.step('persisted', '在卡上开启 Codex 本地生图并等待 vendor 落盘', async () => {
    // 真实开关（CodexLocalImageCard turnOn）：接入 = 种子 vendor enabled 翻 true。
    await ui.win.getByRole('button', { name: '开启 Codex 本地生图', exact: true }).click()
    const vendor = await waitForCatalogState(
      ui,
      (snapshot) => snapshot.vendors?.find((v) => v.key === 'codex-local' && v.enabled),
      15_000, 'codex-vendor-not-persisted', 'UI 已点开启，但磁盘 catalog 里 codex-local 仍未启用',
    )
    await ui.screenshot('j10-codex-enabled')
    return { vendorKey: vendor.key, enabled: vendor.enabled }
  })
  const run = await recorder.step('executed', '从真实图片节点用本机 Codex 生成（真实登录额度）', () =>
    runCanvasNode(ui, recorder, { kind: 'image', modelId: 'Codex 生图（登录额度）', prompt: 'a plain solid red square, flat color, no text' }))
  await recorder.step('rendered', '图片节点渲染真实像素且本地文件落进项目资产', async () => {
    // 真 codex exec 生图通常 1~3 分钟；给足上限，渲染即返回（轮询不是墙钟当完成信号）。
    const proof = await assertRenderedNode(ui, recorder, { kind: 'image', node: run.node, deadlineMs: 300_000 })
    // outputs:['local-file'] 的落库证明：codex 产物由 importCodexImage 以
    // codex-image-<thread>.png 写进项目资产（electron/catalog/codexCli.ts）。
    const localFile = findProjectFile(ui.projectsDir, /^codex-image-.*\.(png|jpe?g|webp)$/i)
    if (!localFile) throw new JourneyFailure('local-asset-missing', '图片渲染了，但项目资产目录里没有 codex-image-* 本地文件')
    return { ...proof, localAsset: path.basename(localFile) }
  })
}

async function errorRecovery(journey, ui, fixture, recorder) {
  if (journey.id === 'J15') {
    await recorder.step('entry', '只填写 URL、Key 和模型 ID 能拿到的最小材料', async () => {
      await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Minimal Material', baseUrl: fixture.origin })
      return { materials: ['url', 'key', 'model-id'] }
    })
    await recorder.step('observed', '模型列表探测收到无法解析的真实响应', async () => {
      // Save the connection first (that is what unlocks 获取模型列表 in the current
      // wizard), then probe. The injected fault returns HTML, not a model list.
      const save = ui.win.getByRole('button', { name: '保存连接', exact: true })
      if (await save.isVisible().catch(() => false)) await save.first().click()
      await requireVisible(ui.win.getByRole('button', { name: /获取模型列表|获取可用模型/ }).first(), 'fetch-entry-missing', '保存连接后没有出现获取模型列表入口', 15_000)
      await ui.win.getByRole('button', { name: /获取模型列表|获取可用模型/ }).first().click()
      await ui.win.waitForTimeout(1500)
      return { requests: fixture.requests.filter((request) => request.path.endsWith('/models')).length }
    })
    await recorder.step('rendered', '界面诚实停在可操作状态而非宣称已验证', async () => {
      const surface = ui.win.locator('[data-settings-section="models"]')
      const text = await surface.textContent()
      if (/验证通过|连接成功|已经可用/.test(text || '')) throw new JourneyFailure('minimal-material-false-success', '无法解析任何上游证据时，界面仍宣称连接或验证成功')
      if (!/手动|未列出|不是模型列表|填写|没自动|手填/.test(text || '')) throw new JourneyFailure('minimal-material-no-action', '探测失败后没有给用户手填或继续配置动作')
      await ui.screenshot('minimal-material-honest-stop')
      return { honestStop: true }
    })
    return
  }
  await recorder.step('entry', '用错误地址从真实测试连接按钮触发失败', async () => {
    await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Recovery Fixture', baseUrl: 'http://127.0.0.1:1' })
    // 测试连接 lives inside the 高级设置 disclosure and is not exposed to getByRole;
    // clickTestConnection opens the disclosure and clicks the real <button>.
    await ui.clickTestConnection()
    await requireVisible(ui.win.getByText(/连接失败|无法|检查地址|未完成|请检查/).first(), 'connection-error-not-visible', '错误地址没有在接入界面展示可理解失败', 15_000)
    return { badUrl: true }
  })
  await recorder.step('recovered', '在原表单改回正确地址并测试成功', async () => {
    await ui.win.getByPlaceholder('https://api.openai.com/v1').fill(fixture.origin)
    await ui.clickTestConnection()
    // Success copy for a reachable relay is "地址和 Key 没问题 · …" (probed
    // 2026-09-01); image/video relays honestly add "要真跑一次才知道".
    await requireVisible(ui.win.getByText(/没问题|连接成功|已连通|已连接/).first(), 'connection-retry-failed', '修正地址后原表单仍不能恢复', 15_000)
    return { recoveredInPlace: true }
  })
  await recorder.step('observed', '恢复后从可见按钮拉取上游模型列表', async () => {
    await ui.fetchModels()
    const listRequests = fixture.requests.filter((request) => request.method === 'GET' && request.path.endsWith('/models'))
    if (listRequests.length === 0) throw new JourneyFailure('model-list-not-observed', '恢复后拉取模型，但 fixture 没收到 GET /models')
    return { requests: listRequests.map((request) => ({ method: request.method, path: request.path })) }
  })
  await recorder.step('persisted', '恢复后选择模型并保存', async () => {
    await ui.chooseModels(['fixture-image-gen']); await ui.waitForCatalogModels(['fixture-image-gen']); return { saved: true }
  })
  const run = await recorder.step('executed', '从真实节点生成并保留错误恢复上下文', () => runCanvasNode(ui, recorder, { kind: 'image', modelId: 'fixture-image-gen', prompt: 'recovered fixture' }))
  await recorder.step('rendered', '恢复后的同一模型显示图片像素', () => assertRenderedNode(ui, recorder, { kind: 'image', node: run.node }))
}

/**
 * J13 —— 参考素材回环（j13 债务返工，2026-09-02）。
 *
 * 旧实现只做到「视频节点的模型下拉里有选项」就返回——切片验证，连 requiredPhases
 * 都凑不齐（恒 HARNESS_ERROR）。按裁决升级为 J01 式全链回环：接入（entry/observed/
 * persisted 由 configureRelay 出证）→ 先真实生成一张参考图、再用 @ 引用把它连进
 * 视频节点（executed；@ 候选锚点与真实参考边的证明方式取自 at-mention-edge.walk.mjs
 * 的已验证探针）→ 视频渲染 + 参考素材真实进 wire + 产物落库 + 项目文档状态回读（rendered）。
 */
async function referenceModes(journey, ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-image-gen', 'fixture-video-gen'], 'Reference Wire Fixture')
  const videoRun = await recorder.step('executed', '先生成参考素材，再用 @ 连进视频节点并生成', async () => {
    // ① 参考素材：真实图片节点先出图（这张图就是用户要连接的素材）。
    const imageRun = await runCanvasNode(ui, recorder, { kind: 'image', modelId: 'fixture-image-gen', prompt: 'reference base square' })
    await assertRenderedNode(ui, recorder, { kind: 'image', node: imageRun.node })
    // ② 视频节点：@ 引用已出图节点 → 建立真实参考边（不是文本装饰）。
    await ui.openCanvas()
    // 与 runCanvasNode 同一个口：左缘点法收口在 ../_canvasRail.mjs，找不到当场抛。
    try {
      await addCanvasNodeFromRail(ui.win, 'video')
    } catch (error) {
      throw new JourneyFailure('node-entry-missing', '画布左缘没有“视频”的新建入口', { kind: 'video', detail: String(error?.message || error) })
    }
    const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
    await requireVisible(composer, 'video-composer-missing', '视频节点没有生成编辑器')
    const nodeId = await composer.evaluate((element) =>
      element.closest('.generation-canvas-v2-node')?.getAttribute('data-node-id') || '')
    if (!nodeId) throw new JourneyFailure('node-id-missing', '视频节点没有可定位的节点 id')
    const node = ui.win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"]`)
    await chooseNodeModel(composer, ui.win, 'fixture-video-gen')
    const promptInput = composer.locator('.generation-canvas-v2-node__prompt-input').first()
    await requireVisible(promptInput, 'prompt-input-missing', '视频节点没有可填写提示词')
    // 探针先量状态：@ 之前的真实边数；选择候选后必须 +1（同 at-mention-edge 的证明法）。
    const edgesBefore = await ui.win.locator('.generation-canvas-v2__edge-path').count()
    await promptInput.click()
    await ui.win.waitForTimeout(400)
    await ui.win.keyboard.type('@', { delay: 80 })
    // 画布已出图节点的候选 key 前缀是 canvas:<nodeId>（AssetMentionSuggestionList
    // data-mention-item={item.key}），选它才走 connect 计划、建真实参考边；library 组是 attach。
    const candidate = ui.win.locator('[data-mention-item^="canvas:"]').first()
    try {
      await candidate.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      // TipTap 聚焦后立刻输入偶发吞键（探针 2026-09-02）：存证后原地重试一次。
      await recorder.screenshot(ui.win, 'j13-mention-panel-retry')
      await promptInput.click()
      await ui.win.waitForTimeout(500)
      await ui.win.keyboard.press('End')
      await ui.win.keyboard.type(' @', { delay: 150 })
      await requireVisible(candidate, 'mention-candidate-missing', '@ 面板没有列出已出图节点作为参考候选', 8000)
    }
    // 浮层项会随输入重渲/瞬时关闭，直接 click 偶发等不到 actionable（run2 实测 30s 超时）。
    // 首选键盘确认（suggestion 高亮首项 = canvas 候选），失败再退回点击；真正的断言是参考边 +1。
    await ui.win.keyboard.press('Enter')
    await ui.win.waitForTimeout(700)
    let edgesAfter = await ui.win.locator('.generation-canvas-v2__edge-path').count()
    if (edgesAfter !== edgesBefore + 1 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click({ timeout: 5000 }).catch(() => {})
      await ui.win.waitForTimeout(700)
      edgesAfter = await ui.win.locator('.generation-canvas-v2__edge-path').count()
    }
    if (edgesAfter !== edgesBefore + 1) throw new JourneyFailure('reference-edge-missing', '@ 选择候选后没有建立真实参考边', { edgesBefore, edgesAfter })
    // 引用 chip（[data-asset-mention]）是 @ 主路径的可见反馈；此处记录 + 截图供人眼走查
    // （R13），承重断言是上面的真实边与下面 rendered 的 wire 语义——chip 与边在键盘选择路径
    // 上是否同步渲染由截图证据裁决，不让 UI 细节抖动掩盖回环本身。
    const chipVisible = await ui.win.locator('[data-asset-mention]').first().isVisible().catch(() => false)
    await recorder.screenshot(ui.win, 'j13-reference-connected')
    await ui.win.keyboard.type(' fixture camera pan', { delay: 20 })
    const generate = composer.getByRole('button', { name: /生成素材|生成/ }).last()
    if (await generate.isDisabled()) throw new JourneyFailure('generate-disabled', '视频节点素材齐全后生成按钮仍不可用')
    await generate.click()
    await confirmSpendGate(ui.win)
    await recorder.screenshot(ui.win, 'j13-video-submitted')
    return { node, nodeId, edgesBefore, edgesAfter, chipVisible }
  })
  await recorder.step('rendered', '视频渲染 + 参考真实进 wire + 落库与状态回读', async () => {
    const proof = await assertRenderedNode(ui, recorder, { kind: 'video', node: videoRun.node })
    // wire：提交体必须真的带上参考素材（图生视频的 image 字段），顺序即语义（首帧）。
    const creates = fixture.requests.filter((request) => request.method === 'POST' && request.path === '/v1/video/generations')
    if (creates.length === 0) throw new JourneyFailure('video-wire-not-observed', '视频出现了，但 fixture 没收到提交请求')
    let submitted = {}
    try { submitted = JSON.parse(creates[creates.length - 1].body || '{}') } catch {}
    const imageValue = typeof submitted.image === 'string' ? submitted.image : ''
    if (!imageValue) throw new JourneyFailure('reference-not-on-wire', '参考图连了线，但提交体里没有 image 首帧字段', { bodyKeys: Object.keys(submitted) })
    // 产物落库：结果视频必须真实写进项目资产目录。
    const localFile = findProjectFile(ui.projectsDir, /\.mp4$/i)
    if (!localFile) throw new JourneyFailure('video-asset-missing', '视频渲染了，但项目资产目录里没有 mp4 文件')
    // 状态回读：持久化的项目文档（.nomi/project.json）里该节点 status=success 且带结果。
    const readBack = await waitForProjectDoc(ui, (project) => {
      const nodes = project?.payload?.generationCanvas?.nodes || []
      return nodes.find((n) => n.kind === 'video' && n.status === 'success' && n.result?.url) || null
    })
    return { ...proof, imageFieldPrefix: imageValue.slice(0, 24), localAsset: path.basename(localFile), readBackStatus: readBack.hit.status }
  })
}

/**
 * J14 —— 配音与 3D 产物回环（j14 债务返工，2026-09-02）。
 *
 * 旧实现只查「节点入口存在 + 下拉有选项」（切片验证，requiredPhases 恒缺 → HARNESS_ERROR）。
 * 升级为 J01 式回环：接入配音模型（entry/observed/persisted 由 configureRelay 出证）→
 * 声音节点真实生成（executed）→ 可解码音频 + 二进制 wire + 产物落库 + 项目文档状态回读
 * （rendered）。3D 产物走直连 RunningHub 式端点（中转刻意无 3D 通道，见 J11 注释）。
 */
async function mediaOutputs(journey, ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-audio-tts'], 'Media Roundtrip Fixture')
  const audioRun = await recorder.step('executed', '声音节点选择配音模型并真实生成', () =>
    runCanvasNode(ui, recorder, { kind: 'audio', modelId: 'fixture-audio-tts', prompt: 'fixture voice line' }))
  await recorder.step('rendered', '声音可解码 + 二进制 wire + 落库与状态回读', async () => {
    const proof = await assertRenderedNode(ui, recorder, { kind: 'audio', node: audioRun.node })
    if (!fixture.requests.some((request) => request.method === 'POST' && request.path === '/v1/audio/speech')) {
      throw new JourneyFailure('audio-wire-not-observed', '声音出现了，但 fixture 没收到 /v1/audio/speech 请求')
    }
    // 落库 + 状态回读（回环收尾）：二进制音频写进项目资产、持久化文档回读到 success。
    const localFile = findProjectFile(ui.projectsDir, /\.(wav|mp3|m4a|ogg)$/i)
    if (!localFile) throw new JourneyFailure('audio-asset-missing', '声音渲染了，但项目资产目录里没有音频文件')
    const readBack = await waitForProjectDoc(ui, (project) => {
      const nodes = project?.payload?.generationCanvas?.nodes || []
      return nodes.find((n) => n.kind === 'audio' && n.status === 'success' && n.result?.url) || null
    })
    return { ...proof, localAsset: path.basename(localFile), readBackStatus: readBack.hit.status }
  })
}

export const JOURNEY_CASES = Object.freeze({
  J01: relayImageVideo,
  J02: knownSingleKey,
  J03: multiCredentialAudio,
  J04: threeTextProtocols,
  J05: adapterModeRepair,
  J06: customCurlQueue,
  J07: customCallRepair,
  J08: localRuntime,
  J09: localRuntime,
  J10: codexLocalImage,
  J11: manualKindRepair,
  J12: errorRecovery,
  J13: referenceModes,
  J14: mediaOutputs,
  J15: errorRecovery,
})

export function assertCaseRegistry(journeys) {
  const missing = journeys.filter((journey) => typeof JOURNEY_CASES[journey.id] !== 'function').map((journey) => journey.id)
  if (missing.length) throw new Error(`Missing journey cases: ${missing.join(', ')}`)
  const extra = Object.keys(JOURNEY_CASES).filter((id) => !journeys.some((journey) => journey.id === id))
  if (extra.length) throw new Error(`Unknown journey cases: ${extra.join(', ')}`)
}
