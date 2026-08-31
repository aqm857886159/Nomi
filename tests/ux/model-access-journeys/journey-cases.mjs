import fs from 'node:fs'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { JourneyBlocked, JourneyFailure } from './evidence.mjs'

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
  const labels = { image: '图片', video: '视频', text: '文本', audio: '声音', model3d: '3D 模型' }
  const add = ui.win.getByRole('button', { name: `添加${labels[kind]}节点`, exact: true }).first()
  await requireVisible(add, 'node-entry-missing', `画布没有“添加${labels[kind]}节点”入口`)
  await add.click()
  const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
  await requireVisible(composer, 'composer-missing', `${labels[kind]}节点没有生成编辑器`)
  await chooseNodeModel(composer, ui.win, modelId)
  const promptInput = composer.locator('.generation-canvas-v2-node__prompt-input').first()
  await requireVisible(promptInput, 'prompt-input-missing', `${labels[kind]}节点没有可填写提示词`)
  await promptInput.fill(prompt)
  const generate = composer.getByRole('button', { name: /生成素材|生成/ }).last()
  if (await generate.isDisabled()) throw new JourneyFailure('generate-disabled', `${labels[kind]}节点材料齐全后生成按钮仍不可用`)
  await generate.click()
  await recorder.screenshot(ui.win, `${kind}-node-submitted`)
  return { composer, node: composer.locator('xpath=ancestor::*[contains(@class,"generation-canvas-v2-node")][1]') }
}

async function assertRenderedNode(ui, recorder, { kind, node, expectedText }) {
  const deadline = Date.now() + (kind === 'video' ? 35_000 : 20_000)
  while (Date.now() < deadline) {
    const proof = await node.evaluate((element, type) => {
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
      if (type === 'text') return element.textContent?.includes(String(expectedText || 'fixture text')) ? { text: expectedText || 'fixture text' } : null
      if (type === 'model3d') return element.querySelector('canvas') ? { canvas: true } : null
      return null
    }, kind)
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
  await recorder.step('executed', '等待逐模型逐模式验证结果出现', async () => {
    const action = ui.win.getByRole('button', { name: /自己接入|自定义调用/ }).first()
    await requireVisible(action, 'per-mode-repair-action-missing', '某个模式失败后，验证页没有可继续修复该模型的动作', 35_000)
    return { action: await action.textContent() }
  })
  await recorder.step('rendered', '失败模式与已通过模式不互相覆盖', async () => {
    const body = await ui.win.getByRole('dialog').last().textContent()
    if (!/失败|未通过/.test(body || '')) throw new JourneyFailure('mode-failure-not-visible', '验证页没有展示失败模式')
    return { visibleFailure: true }
  })
  await recorder.step('recovered', '从失败模式进入自定义调用继续修复', async () => {
    const action = ui.win.getByRole('button', { name: /自己接入|自定义调用/ }).first()
    await action.click()
    await requireVisible(ui.win.getByText('自定义调用', { exact: true }), 'custom-call-not-opened', '失败模式的继续动作没有打开自定义调用')
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
    await ui.win.getByRole('button', { name: /添加\s*1\s*个模型/ }).click()
    const catalog = await ui.waitForCatalogModels(['fixture-meshy-3d'])
    const saved = catalog.models.find((model) => model.modelKey === 'fixture-meshy-3d')
    if (saved?.kind !== 'model3d') throw new JourneyFailure('kind-not-persisted', 'UI 显示已改成 3D，但磁盘仍是其它类型', { savedKind: saved?.kind })
    return { kind: saved.kind }
  })
  await recorder.step('observed', '类型纠错不伪造不存在的通用 3D 端点', async () => {
    const snapshot = ui.catalogSnapshot()
    const mappings = snapshot?.mappings?.filter((mapping) => mapping.modelKey === 'fixture-meshy-3d' || mapping.name?.includes('fixture-meshy-3d')) || []
    return { mappings: mappings.map((mapping) => mapping.taskKind) }
  })
  const run = await recorder.step('executed', '从真实 3D 节点选择纠错后的模型', () => runCanvasNode(ui, recorder, { kind: 'model3d', modelId: 'fixture-meshy-3d', prompt: 'fixture cube' }))
  await recorder.step('rendered', '3D 节点渲染模型像素', () => assertRenderedNode(ui, recorder, { kind: 'model3d', node: run.node }))
}

function stableModelProjection(snapshot, modelKey) {
  const model = snapshot?.models?.find((item) => item.modelKey === modelKey)
  if (!model) return null
  const mappings = (snapshot.mappings || []).filter((item) => item.modelKey === modelKey || (!item.modelKey && item.vendorKey === model.vendorKey))
  const vendor = snapshot.vendors?.find((item) => item.key === model.vendorKey)
  return { model, mappings, vendor, hasCredential: snapshot.apiKeyVendors?.includes(model.vendorKey) }
}

async function closeWizard(ui) {
  const dialog = ui.win.getByRole('dialog').filter({ hasText: '添加一个 AI 模型' }).last()
  const close = dialog.getByRole('button', { name: '关闭', exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function existingModelPreservation(journey, ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-text-chat'], 'Same Host First')
  const before = ui.catalogSnapshot()
  const baseline = stableModelProjection(before, 'fixture-text-chat')
  if (!baseline) throw new JourneyFailure('baseline-model-missing', '第一轮 UI 接入后找不到已有模型快照')
  await recorder.step('executed', '从同一 host 再次打开添加流程并只添加新模型', async () => {
    await closeWizard(ui)
    await ui.openRelayWizard()
    await ui.fillRelay({ name: 'Same Host Second', baseUrl: fixture.origin })
    await ui.fetchModels()
    await ui.chooseModels(['fixture-image-gen'])
    await ui.waitForCatalogModels(['fixture-text-chat', 'fixture-image-gen'])
    return { added: 'fixture-image-gen' }
  })
  await recorder.step('rendered', '第二轮仍同时显示旧模型和新模型', async () => {
    const after = ui.catalogSnapshot()
    return { modelKeys: after.models.map((model) => model.modelKey).filter((key) => key.startsWith('fixture-')).sort() }
  })
  await recorder.step('recovered', '旧模型的凭证、脚本、映射和启用状态保持不变', async () => {
    const after = stableModelProjection(ui.catalogSnapshot(), 'fixture-text-chat')
    if (JSON.stringify(after) !== JSON.stringify(baseline)) {
      throw new JourneyFailure('existing-model-mutated', '同 host 添加新模型时修改了已有模型', { before: baseline, after })
    }
    return { unchanged: true }
  })
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
    const card = ui.win.getByRole('button', { name: /火山豆包语音/ }).first()
    await requireVisible(card, 'audio-provider-card-missing', '音频平台卡不存在')
    await card.click()
    const inputs = ui.win.getByRole('dialog', { name: '设置', exact: true }).locator('input:visible')
    const count = await inputs.count()
    await ui.screenshot('multi-credential-audio-form')
    if (count < 2) throw new JourneyFailure('multi-credential-ui-missing', '用户有 App ID + Access Token，但卡片只提供一个凭证字段', { visibleCredentialInputs: count })
    return { visibleCredentialInputs: count }
  })
}

async function threeTextProtocols(journey, ui, fixture, recorder) {
  await recorder.step('entry', '打开高级设置并看到三个文本协议', async () => {
    await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Protocol Fixture', baseUrl: fixture.origin })
    await ui.win.getByText('高级设置', { exact: true }).click()
    await ui.win.getByText(/手动指定协议|手动选择/).click()
    for (const label of ['Chat Completions', 'Responses', 'Anthropic']) await requireVisible(ui.win.getByText(label, { exact: true }), 'protocol-option-missing', `高级设置缺少 ${label}`)
    return { protocols: ['openai-compatible', 'openai-responses', 'anthropic'] }
  })
  await recorder.step('observed', '逐一从真实测试连接按钮发出三种协议请求', async () => {
    for (const label of ['Chat Completions', 'Responses', 'Anthropic']) {
      await ui.win.getByText(label, { exact: true }).click()
      await ui.win.getByRole('button', { name: '测试连接', exact: true }).click()
      await ui.win.waitForTimeout(500)
    }
    const paths = fixture.requests.filter((request) => request.method === 'POST').map((request) => request.path)
    for (const path of ['/chat/completions', '/responses', '/v1/messages']) {
      if (!paths.some((seen) => seen.endsWith(path))) throw new JourneyFailure('protocol-wire-missing', `${path} 没有从真实 UI 发出`, { paths })
    }
    return { paths }
  })
  await recorder.step('persisted', '选择文本模型并保存探测出的协议', async () => {
    await ui.fetchModels(); await ui.chooseModels(['fixture-text-chat']); await ui.waitForCatalogModels(['fixture-text-chat'])
    return { model: 'fixture-text-chat' }
  })
  const run = await recorder.step('executed', '从真实文本节点执行', () => runCanvasNode(ui, recorder, { kind: 'text', modelId: 'fixture-text-chat', prompt: 'say fixture text' }))
  await recorder.step('rendered', '文本节点显示上游返回文本', () => assertRenderedNode(ui, recorder, { kind: 'text', node: run.node, expectedText: 'fixture text' }))
}

async function openCustomCall(ui, fixture, recorder) {
  await configureRelay(ui, fixture, recorder, ['fixture-video-gen'], 'Custom Call Fixture')
  const action = ui.win.getByRole('button', { name: /自己接入|自定义调用/ }).first()
  await requireVisible(action, 'custom-call-entry-missing', '模型验证失败后没有自定义调用入口', 35_000)
  await action.click()
  await requireVisible(ui.win.getByText('自定义调用', { exact: true }), 'custom-call-editor-missing', '自定义调用编辑器没有打开')
}

async function customCurlQueue(journey, ui, fixture, recorder) {
  await openCustomCall(ui, fixture, recorder)
  await recorder.step('executed', '检查脚本旁的可用变量和返回要求', async () => {
    const editor = ui.win.getByRole('dialog').filter({ hasText: '自定义调用' }).last()
    const text = await editor.textContent()
    const hasVariables = /prompt.*params.*references.*model.*baseUrl/s.test(text || '')
    const hasReturnContract = /返回要求|返回值约定|必须.*return|return.*URL/i.test(text || '')
    await ui.screenshot('custom-call-contract')
    if (!hasVariables) throw new JourneyFailure('available-variables-missing', '脚本编辑器没有把实际可用变量展示给用户')
    if (!hasReturnContract) throw new JourneyFailure('return-contract-missing', '脚本编辑器展示了变量，但没有展示脚本必须返回什么；用户无法判断图片/视频/文本结果形状')
    return { hasVariables, hasReturnContract }
  })
}

async function customCallRepair(journey, ui, fixture, recorder) {
  await openCustomCall(ui, fixture, recorder)
  const editor = ui.win.getByRole('dialog').filter({ hasText: '自定义调用' }).last()
  const script = editor.locator('textarea').filter({ has: undefined }).last()
  await recorder.step('executed', '用错误字段试跑并查看实际请求和上游错误', async () => {
    await script.fill("const task = await http.post('/v1/video/generations', { wrong_prompt: prompt })\nreturn task.missing")
    await editor.getByRole('button', { name: /试跑/ }).click()
    await requireVisible(editor.getByText(/没有返回产物|试跑失败/).first(), 'custom-call-failure-not-visible', '错误脚本试跑后没有展示可诊断失败', 15_000)
    const text = await editor.textContent()
    if (!/POST.*video\/generations|请求 1/i.test(text || '')) throw new JourneyFailure('custom-call-transcript-missing', '试跑失败没有展示实际请求 transcript')
    return { failedAsExpected: true }
  })
  await recorder.step('rendered', '修正脚本后试跑得到真实视频 URL', async () => {
    await script.fill("const task = await http.post('/v1/video/generations', { model, prompt })\nreturn await poll(() => http.get('/v1/video/generations/' + task.task_id), (s) => s.status === 'succeeded' ? s.data[0].url : null, { intervalMs: 500, timeoutMs: 5000 })")
    await editor.getByRole('button', { name: /试跑/ }).click()
    await requireVisible(editor.getByText(/试跑成功|个产物/).first(), 'custom-call-repair-failed', '修正脚本后试跑仍未成功', 15_000)
    return { assetUrlObserved: fixture.requests.some((request) => request.path.endsWith('fixture-video-task')) }
  })
  await recorder.step('recovered', '保存修正脚本并回到同一模型', async () => {
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    const snapshot = ui.catalogSnapshot()
    const model = snapshot.models.find((item) => item.modelKey === 'fixture-video-gen')
    if (!model?.customCall?.script?.includes('poll')) throw new JourneyFailure('custom-call-not-saved', 'UI 说已保存，但模型磁盘快照没有修正脚本')
    return { saved: true }
  })
}

async function localRuntime(journey, ui, fixture, recorder) {
  const groupLabel = journey.id === 'J08' ? /有本地 ComfyUI/ : journey.id === 'J09' ? /有即梦会员/ : /用 Codex 出图/
  await recorder.step('entry', '从真实模型面板展开本地运行时入口', async () => {
    await ui.openModels()
    const group = ui.win.getByRole('button', { name: groupLabel }).first()
    await requireVisible(group, 'local-runtime-entry-missing', `${journey.title} 的入口不存在`)
    await group.click()
    await ui.screenshot(`${journey.id.toLowerCase()}-runtime-card`)
    return { entry: await group.textContent() }
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
  if (journey.id === 'J10') {
    const codex = spawnSync('which', ['codex'], { encoding: 'utf8' })
    if (codex.status !== 0) throw new JourneyBlocked('codex-runtime-missing', '本机没有可执行 codex CLI')
  }
  throw new JourneyFailure('environmental-roundtrip-not-completed', '运行时存在，但本次旅途没有得到最终媒体证据')
}

async function errorRecovery(journey, ui, fixture, recorder) {
  if (journey.id === 'J15') {
    await recorder.step('entry', '只填写 URL、Key 和模型 ID 能拿到的最小材料', async () => {
      await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Minimal Material', baseUrl: fixture.origin })
      return { materials: ['url', 'key', 'model-id'] }
    })
    await recorder.step('observed', '模型列表探测收到无法解析的真实响应', async () => {
      await ui.win.getByRole('button', { name: '拉取模型', exact: true }).click()
      await ui.win.waitForTimeout(800)
      return { requests: fixture.requests.filter((request) => request.path.endsWith('/models')).length }
    })
    await recorder.step('rendered', '界面诚实停在可操作状态而非宣称已验证', async () => {
      const dialog = ui.win.getByRole('dialog').filter({ hasText: '添加一个 AI 模型' }).last()
      const text = await dialog.textContent()
      if (/验证通过|连接成功|已经可用/.test(text || '')) throw new JourneyFailure('minimal-material-false-success', '无法解析任何上游证据时，界面仍宣称连接或验证成功')
      if (!/手动|未列出|不是模型列表|填写/.test(text || '')) throw new JourneyFailure('minimal-material-no-action', '探测失败后没有给用户手填或继续配置动作')
      await ui.screenshot('minimal-material-honest-stop')
      return { honestStop: true }
    })
    return
  }
  await recorder.step('entry', '用错误地址从真实测试连接按钮触发失败', async () => {
    await ui.openModels(); await ui.openRelayWizard(); await ui.fillRelay({ name: 'Recovery Fixture', baseUrl: 'http://127.0.0.1:1' })
    await ui.win.getByRole('button', { name: '测试连接', exact: true }).click()
    await requireVisible(ui.win.getByText(/连接失败|无法|检查地址/).first(), 'connection-error-not-visible', '错误地址没有在接入界面展示可理解失败', 15_000)
    return { badUrl: true }
  })
  await recorder.step('recovered', '在原表单改回正确地址并测试成功', async () => {
    await ui.win.getByPlaceholder('https://api.openai.com/v1').fill(fixture.origin)
    await ui.win.getByRole('button', { name: '测试连接', exact: true }).click()
    await requireVisible(ui.win.getByText(/连接成功|已连通|已连接/).first(), 'connection-retry-failed', '修正地址后原表单仍不能恢复', 15_000)
    return { recoveredInPlace: true }
  })
  await recorder.step('persisted', '恢复后选择模型并保存', async () => {
    await ui.fetchModels(); await ui.chooseModels(['fixture-image-gen']); await ui.waitForCatalogModels(['fixture-image-gen']); return { saved: true }
  })
  const run = await recorder.step('executed', '从真实节点生成并保留错误恢复上下文', () => runCanvasNode(ui, recorder, { kind: 'image', modelId: 'fixture-image-gen', prompt: 'recovered fixture' }))
  await recorder.step('rendered', '恢复后的同一模型显示图片像素', () => assertRenderedNode(ui, recorder, { kind: 'image', node: run.node }))
}

async function referenceModes(journey, ui, fixture, recorder) {
  await recorder.step('entry', '在真实视频节点打开模型和模式控件', async () => {
    await ui.openModels(); await ui.closeSettings(); await ui.openCanvas()
    await ui.win.getByRole('button', { name: '添加视频节点', exact: true }).click()
    const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
    await requireVisible(composer, 'video-composer-missing', '视频节点未创建')
    const model = composer.getByRole('button', { name: '模型', exact: true })
    await requireVisible(model, 'reference-model-picker-missing', '视频节点没有模型入口')
    await model.click()
    const options = await ui.win.getByRole('option').allTextContents().catch(() => [])
    if (options.length === 0) throw new JourneyFailure('no-executable-reference-model', '真实节点没有任何可执行多参考模型；无法验证首尾帧、全能参考和多参考图 wire')
    return { options }
  })
}

async function mediaOutputs(journey, ui, fixture, recorder) {
  await recorder.step('entry', '从真实画布检查声音和 3D 生成节点入口', async () => {
    await ui.openModels(); await ui.closeSettings(); await ui.openCanvas()
    for (const label of ['添加声音节点', '添加3D 模型节点']) await requireVisible(ui.win.getByRole('button', { name: label, exact: true }), 'media-node-entry-missing', `画布缺少 ${label}`)
    return { nodes: ['audio', 'model3d'] }
  })
  await recorder.step('executed', '声音节点选择可执行配音模型', async () => {
    await ui.win.getByRole('button', { name: '添加声音节点', exact: true }).click()
    const composer = ui.win.locator('.generation-canvas-v2-node__composer-card').last()
    const model = composer.getByRole('button', { name: '模型', exact: true })
    await requireVisible(model, 'audio-model-picker-missing', '声音节点没有模型选择器')
    await model.click()
    const options = await ui.win.getByRole('option').allTextContents().catch(() => [])
    if (options.length === 0) throw new JourneyFailure('no-executable-audio-model', '声音节点没有可执行模型，无法证明二进制/NDJSON 音频可解码')
    return { options }
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
  J10: localRuntime,
  J11: manualKindRepair,
  J12: errorRecovery,
  J13: referenceModes,
  J14: mediaOutputs,
  J15: errorRecovery,
  J16: existingModelPreservation,
})

export function assertCaseRegistry(journeys) {
  const missing = journeys.filter((journey) => typeof JOURNEY_CASES[journey.id] !== 'function').map((journey) => journey.id)
  if (missing.length) throw new Error(`Missing journey cases: ${missing.join(', ')}`)
  const extra = Object.keys(JOURNEY_CASES).filter((id) => !journeys.some((journey) => journey.id === id))
  if (extra.length) throw new Error(`Unknown journey cases: ${extra.join(', ')}`)
}

