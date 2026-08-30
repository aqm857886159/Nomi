#!/usr/bin/env node
// Phase 6 real-user acceptance: the resident shell must close a real task through
// the Host, not merely render controls. The provider is loopback-only and zero quota.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect } from './_assert.mjs'
import { flattenRequestText, FIXTURE_API_KEY, FIXTURE_IMAGE_ALT_MODEL, FIXTURE_TEXT_MODEL, FIXTURE_VENDOR, FIXTURE_VIDEO_ALT_MODEL, FIXTURE_VIDEO_MODEL } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, DOCUMENT, readProject, recorded } from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const walk = await createRuntimeWalk('resident-real-tasks')
// Seed the same persisted preference a user would set in Settings > AI. The
// walk still goes through the real IPC reader and renderer auto-selection path;
// no node is pre-seeded, so the assertion can prove a new card inherits it.
fs.writeFileSync(path.join(walk.report.tempRoot, 'settings', 'generation-model-defaults.json'), `${JSON.stringify({
  schemaVersion: 1,
  byTaskKind: {
    text_to_image: { vendorKey: FIXTURE_VENDOR, modelKey: 'agent-runtime-image' },
    image_edit: { vendorKey: FIXTURE_VENDOR, modelKey: 'agent-runtime-image' },
    text_to_video: { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_VIDEO_MODEL },
    image_to_video: { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_VIDEO_MODEL },
  },
}, null, 2)}\n`, 'utf8')
const trace = []
const traceDir = path.join(walk.outputDir, 'trace')
fs.mkdirSync(traceDir, { recursive: true })
const failures = []
const assertions = []
let lastScreenshot = null
let lastHostSnapshot = null
let lastDomainSnapshot = null
let failure
const rendererErrors = []

function savedDocument(payload, projectId) {
  const documents = Array.isArray(payload?.workbenchDocuments) ? payload.workbenchDocuments : []
  const activeId = payload?.activeDocumentId
  return documents.find((candidate) => candidate.id === activeId) ?? documents.find((candidate) => candidate.id === `${projectId}:document`) ?? documents[0]
}

function readHostSnapshot(tempRoot, immutableProjectUuid, projectGeneration = 1) {
  const root = path.join(tempRoot, 'settings', 'project-agent-host')
  const prefix = `project-agent.${immutableProjectUuid}.g${projectGeneration}`
  const directories = fs.existsSync(root) ? fs.readdirSync(root).filter((entry) => entry === prefix) : []
  const file = directories[0] ? path.join(root, directories[0], 'snapshot-v1.json') : ''
  if (!file || !fs.existsSync(file)) return null
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
  return envelope?.state ?? null
}

async function step(role, action, target, operation) {
  const at = new Date().toISOString()
  let result = 'ok'
  try {
    const value = await operation()
    if (value !== undefined) result = value
    if (typeof result === 'string' && result.endsWith('.png')) lastScreenshot = result
    trace.push({ at, role, action, target, result })
    return value
  } catch (error) {
    result = error instanceof Error ? error.message : String(error)
    trace.push({ at, role, action, target, result })
    throw error
  }
}

function check(label, condition, details = '') {
  if (!condition) failures.push(`${label}${details ? ` (${details})` : ''}`)
  assertions.push({
    label,
    expected: true,
    actual: Boolean(condition),
    details,
    screenshot: lastScreenshot,
    hostSnapshot: lastHostSnapshot,
    domainSnapshot: lastDomainSnapshot,
  })
  console.log(`${condition ? '✓' : '✗'} ${label}${details ? ` · ${details}` : ''}`)
}

function attachScreenshot(labels, screenshot) {
  const wanted = new Set(Array.isArray(labels) ? labels : [labels])
  for (const assertion of assertions) if (wanted.has(assertion.label)) assertion.screenshot = screenshot
}

async function selectCanvasNode(win, nodeId, label) {
  const node = win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"]`).first()
  await node.waitFor({ state: 'visible', timeout: 30_000 })
  const box = await node.boundingBox()
  if (!box) throw new Error(`${label} node has no visible bounds`)
  // Click the card body, away from connection handles and the floating composer.
  await node.click({ position: { x: Math.min(90, Math.max(24, box.width / 2)), y: Math.min(72, Math.max(24, box.height / 3)) } })
  return node
}

async function approveGenerationSpend(win, label) {
  const spend = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  await spend.waitFor({ state: 'visible', timeout: 30_000 })
  check(`${label} shows one explicit spend confirmation`, await spend.getByRole('button', { name: '生成', exact: true }).count() === 1)
  await clickOrFail(spend.getByRole('button', { name: '生成', exact: true }), `${label}确认生成`)
}

try {
  let { win } = await walk.start({ first: true })
  win.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()) })
  win.on('pageerror', (error) => rendererErrors.push(error?.stack || error?.message || String(error)))
  // The fixture file intentionally uses a plaintext sentinel so it never
  // pretends to be a production credential. Promote it through the real
  // model-catalog IPC before submitting; the runtime only accepts the
  // safeStorage form, which is the same path a user takes in settings.
  await step('budget-sensitive-user', 'connect-loopback-model', 'model settings', async () => {
    const result = await win.evaluate(({ vendor, key }) => window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendor, { apiKey: key, enabled: true }), { vendor: FIXTURE_VENDOR, key: FIXTURE_API_KEY })
    if (!result || result.enabled !== true) throw new Error('loopback model credential was not saved')
  })
  const project = await step('novice-creator', 'create-project', 'project library', () => walk.newProject())
  const { projectId, projectRoot } = project
  const document = win.locator(DOCUMENT)
  const original = '真实用户任务：清晨的咖啡馆里，创作者整理镜头并开始拍摄。'
  await step('novice-creator', 'write-document', 'Creation document', async () => {
    await document.fill(original)
    await expect.poll(async () => JSON.stringify(savedDocument((await readProject(win, projectId)).payload, projectId))).toContain(original)
  })

  const resident = win.locator('[data-agent-resident][data-agent-surface="creation"]')
  await resident.waitFor({ state: 'visible', timeout: 30_000 })
  check('resident shell is the only visible Agent surface', await win.locator('[data-agent-resident]:visible').count() === 1)
  await step('novice-creator', 'inspect-run-mode', 'resident composer', async () => {
    await clickOrFail(resident.locator('[data-agent-mode-trigger="true"]'), '打开模式菜单')
    const menu = win.locator('[data-agent-menu="模式"]')
    await menu.waitFor({ state: 'visible', timeout: 10_000 })
    check('mode menu exposes the four deliberate levels', await menu.locator('[data-agent-menu-item]').count() === 4)
    const modeMenuScreenshot = await step('novice-creator', 'capture', 'mode menu', () => walk.snap('resident-mode-menu'))
    attachScreenshot('mode menu exposes the four deliberate levels', modeMenuScreenshot)
    await clickOrFail(menu.locator('[data-agent-menu-item="ask"]'), '选择 Ask 模式')
  })
  check('selected run mode is reflected on the resident shell', await resident.getAttribute('data-agent-run-mode') === 'ask')

  const plainRequest = walk.fixture.expectText({
    label: 'resident natural-language question',
    match: (body) => flattenRequestText(body).includes('请先读一下当前文稿') && !body.messages?.some((message) => message.tool_calls),
    reply: { type: 'text', text: '我已读完当前文稿，可以按你的目标继续。' },
  })
  await step('novice-creator', 'send-message', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请先读一下当前文稿，告诉我下一步怎么做。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送 resident 自然语言任务')
  })
  const plainWire = await recorded(plainRequest.received, 'resident natural-language request')
  check('resident sends the user text to the real loopback model', flattenRequestText(plainWire.body).includes('请先读一下当前文稿'))
  await expect(resident).toContainText('我已读完当前文稿')
  const plainScreenshot = await step('novice-creator', 'capture', 'plain response', () => walk.snap('resident-plain-response'))
  attachScreenshot(['resident shell is the only visible Agent surface', 'selected run mode is reflected on the resident shell', 'resident sends the user text to the real loopback model', 'resident-natural-language-response'], plainScreenshot)

  // Return to the default balanced mode before the write path; this proves the
  // setting is per-round UI state, not a hidden permanent permission change.
  await clickOrFail(resident.locator('[data-agent-mode-trigger="true"]'), '重新打开模式菜单')
  await clickOrFail(win.locator('[data-agent-menu="模式"] [data-agent-menu-item="balanced"]'), '恢复平衡模式')
  check('balanced mode can be selected for the next task', await resident.getAttribute('data-agent-run-mode') === 'balanced')

  const toolId = 'resident-doc-append-1'
  const append = '真实闭环回执：她按下录制键。'
  const appendRequest = walk.fixture.expectText({
    label: 'resident document write proposal',
    match: (body) => flattenRequestText(body).includes('请在文末加一句收尾') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: toolId, name: 'append_to_end', args: { content: append } },
  })
  const appendFollowup = walk.fixture.expectText({
    label: 'resident approved document result',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === toolId),
    reply: { type: 'text', text: '文稿已按批准内容追加，并保留了原文。' },
  })
  await step('novice-creator', 'send-write-request', 'resident composer', async () => {
    await resident.locator('[data-agent-composer] textarea').fill('请在文末加一句收尾，先给我确认后再写入。')
    await clickOrFail(resident.locator('[data-agent-send]'), '发送文档写入任务')
  })
  const appendWire = await recorded(appendRequest.received, 'resident document proposal request')
  check('resident advertises the creation-editor request to the model', appendWire.body.tools?.some((tool) => tool.function?.name === 'append_to_end'))
  const approval = resident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '修改文稿' }).last()
  await approval.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(document).toHaveText(original)
  check('document is unchanged before explicit approval', !(await document.innerText()).includes(append))
  const documentApprovalText = await approval.innerText()
  check('document approval keeps the action and impact in the first layer', documentApprovalText.includes('修改文稿') && documentApprovalText.includes('1 条内容') && !documentApprovalText.includes(append))
  const documentPendingScreenshot = await step('novice-creator', 'capture', 'document approval pending', () => walk.snap('resident-document-approval-pending'))
  attachScreenshot(['balanced mode can be selected for the next task', 'document is unchanged before explicit approval', 'document approval keeps the action and impact in the first layer'], documentPendingScreenshot)
  const documentDetails = approval.locator('[data-agent-approval-details]')
  await documentDetails.locator('summary').click()
  check('document approval reveals the exact write only on demand', (await approval.innerText()).includes(append))
  await documentDetails.locator('summary').click()
  await step('novice-creator', 'approve-tool', 'resident approval card', () => clickOrFail(approval.locator('[data-agent-action="approve"]'), '批准文档追加'))
  await recorded(appendFollowup.received, 'resident approved document follow-up')
  await expect(resident).toContainText('文稿已按批准内容追加')
  await expect(document).toContainText(append)
  await expect.poll(async () => JSON.stringify(savedDocument((await readProject(win, projectId)).payload, projectId))).toContain(append)
  check('approved document write persists in the domain owner', (await document.innerText()).includes(append))
  const creationVisibleText = await resident.innerText()
  check('tool card uses a human-readable action instead of an internal capability id', creationVisibleText.includes('修改文稿') && !creationVisibleText.includes('append_to_end') && !creationVisibleText.includes('result-'))
  check('completed document work leaves no active queue rows', await resident.locator('[data-agent-queue-item]').count() === 0)
  check('completed proposal is a receipt without misleading approval controls', await resident.locator('[data-agent-action="approve-plan"], [data-agent-action="edit-plan"]').count() === 0)
  check('resident exposes token usage after the real turn', await resident.locator('[data-agent-usage]').count() === 1 && (await resident.locator('[data-agent-usage]').innerText()).includes('tokens'))
  const costText = await resident.locator('[data-agent-cost]').innerText()
  check('resident exposes an explicit cost state instead of hiding spend', await resident.locator('[data-agent-cost]').count() === 1 && ['费用待确认', '价格已载入', '单次约', 'Cost to confirm', 'Price loaded', 'About ¥'].some((label) => costText.includes(label)))
  const documentApprovedScreenshot = await step('novice-creator', 'capture', 'approved document result', () => walk.snap('resident-document-approved'))
  attachScreenshot(['approved document write persists in the domain owner', 'tool card uses a human-readable action instead of an internal capability id', 'completed document work leaves no active queue rows', 'completed proposal is a receipt without misleading approval controls', 'resident exposes token usage after the real turn', 'resident exposes an explicit cost state instead of hiding spend'], documentApprovedScreenshot)
  const toolChip = resident.locator('[data-agent-tool-chips] button').filter({ hasText: '修改文稿' }).last()
  check('completed tool is represented as a compact inspectable chip', await toolChip.count() === 1)
  if (await toolChip.count()) {
    await toolChip.click()
    check('tool chip expands a human-readable result detail', await resident.locator('[data-agent-tool-detail]').count() === 1 && (await resident.locator('[data-agent-tool-detail]').innerText()).includes('结果'))
    await toolChip.click()
    const toolHeader = resident.locator('[data-agent-tool-header]')
    await toolHeader.click()
    check('tool run collapses as one attention-sized group', await toolHeader.getAttribute('aria-expanded') === 'false' && await resident.locator('[data-agent-tool-detail]').count() === 0)
    await toolHeader.click()
  }

  const savedAfterDocument = await readProject(win, projectId)
  const hostState = readHostSnapshot(walk.report.tempRoot, savedAfterDocument.immutableProjectUuid, savedAfterDocument.projectGeneration)
  lastHostSnapshot = hostState
  lastDomainSnapshot = savedAfterDocument.payload
  check('Host keeps the user, assistant, proposal and tool items as one persisted history', Boolean(hostState && hostState.items.some((item) => item.kind === 'tool' && item.resultRef)))

  await step('professional-storyboarder', 'switch-surface', 'Generation canvas', async () => {
    await win.locator('nav.nomi-stepper [data-mode="generation"]').click()
    await win.locator('[data-agent-resident][data-agent-surface="generation"]').waitFor({ state: 'visible', timeout: 30_000 })
  })
  // A novice does not speak in tool/schema language. This exact request is a
  // regression guard for the original refusal: it must become an image card,
  // then follow the same approval and existing composer path as every other
  // generated image.
  const generationResident = win.locator('[data-agent-resident][data-agent-surface="generation"]')
  const catToolId = 'resident-cat-avatar-create-1'
  const catRequest = walk.fixture.expectText({
    label: 'resident natural image generation intent',
    match: (body) => flattenRequestText(body).includes('帮我生成一个小猫头像') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: catToolId, name: 'create_canvas_nodes', args: {
      summary: '一张小猫头像图片卡。',
      nodes: [{ clientId: 'resident-cat-avatar', kind: 'image', title: '小猫头像', prompt: '一只可爱的橘色小猫头像，柔和光线，居中构图。', modelKey: 'agent-runtime-image', modeId: 't2i', params: { size: '1024x1024' } }],
    } },
  })
  const catFollowup = walk.fixture.expectText({
    label: 'resident natural image generation receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === catToolId),
    reply: { type: 'text', text: '小猫头像卡已创建，可以在现有图片面板中确认并生成。' },
  })
  await step('novice-creator', 'request-natural-image', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('帮我生成一个小猫头像')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送小猫头像任务')
  })
  await recorded(catRequest.received, 'resident natural image generation request')
  const catApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await catApproval.waitFor({ state: 'visible', timeout: 30_000 })
  check('natural image request is not rejected as answer-only chat', !(await generationResident.innerText()).includes('无法生成') && !(await generationResident.innerText()).includes('不能生成'))
  await step('novice-creator', 'approve-natural-image', 'resident approval card', () => clickOrFail(catApproval.locator('[data-agent-action="approve"]'), '批准小猫头像建卡'))
  await recorded(catFollowup.received, 'resident natural image generation receipt')
  await expect(generationResident).toContainText('小猫头像卡已创建')
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.some((node) => node.title === '小猫头像')).toBe(true)
  const catScreenshot = await step('novice-creator', 'capture', 'natural image result', () => walk.snap('resident-natural-image-result'))
  attachScreenshot('natural image request is not rejected as answer-only chat', catScreenshot)

  const canvasToolId = 'resident-canvas-create-1'
  const canvasRequest = walk.fixture.expectText({
    label: 'resident canvas node proposal with reference edge',
    match: (body) => flattenRequestText(body).includes('请创建两个镜头卡') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: canvasToolId, name: 'create_canvas_nodes', args: {
      summary: '两个镜头卡和一条 reference 关系。',
      nodes: [
        { clientId: 'resident-source', kind: 'image', title: '清晨咖啡馆广角', prompt: '清晨咖啡馆，红色杯子，广角。', modelKey: 'agent-runtime-image', modeId: 't2i', params: { size: '1024x1024' } },
        { clientId: 'resident-target', kind: 'video', title: '杯沿推近', prompt: '同一只红色杯子，缓慢推近。', modelKey: FIXTURE_VIDEO_MODEL, modeId: 't2v', params: { aspect_ratio: '16:9', resolution: '720p', duration: 5 } },
      ],
      edges: [{ sourceClientId: 'resident-source', targetClientId: 'resident-target', mode: 'reference' }],
    } },
  })
  const canvasFollowup = walk.fixture.expectText({
    label: 'resident canvas receipt returns to the model',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === canvasToolId),
    reply: { type: 'text', text: '两个镜头卡已落到画布，reference 关系也已保留。' },
  })
  await step('professional-storyboarder', 'send-canvas-request', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建两个镜头卡，并把第一个作为第二个的 reference；只建卡和连线，不要生成。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送画布建卡任务')
  })
  await recorded(canvasRequest.received, 'resident canvas request')
  const canvasApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await canvasApproval.waitFor({ state: 'visible', timeout: 30_000 })
  const beforeCanvas = (await readProject(win, projectId)).payload.generationCanvas
  check('canvas keeps the previously approved natural image card while the next proposal is pending', beforeCanvas.nodes.length === 1 && beforeCanvas.edges.length === 0)
  const canvasPendingText = await canvasApproval.innerText()
  check('canvas approval keeps the user-facing decision in the first layer', canvasPendingText.includes('2 个镜头卡') && !canvasPendingText.includes('agent-runtime-image') && !canvasPendingText.includes('16:9'))
  const canvasPendingScreenshot = await step('budget-sensitive-user', 'capture', 'canvas approval summary', () => walk.snap('resident-canvas-approval-summary'))
  attachScreenshot('canvas approval keeps the user-facing decision in the first layer', canvasPendingScreenshot)
  const canvasDetails = canvasApproval.locator('[data-agent-approval-details]')
  await canvasDetails.locator('summary').click()
  const canvasExpandedText = await canvasApproval.innerText()
  check('canvas approval reveals model, prompt and generation parameters on demand', canvasExpandedText.includes('agent-runtime-image') && canvasExpandedText.includes('agent-runtime-video') && canvasExpandedText.includes('清晨咖啡馆') && canvasExpandedText.includes('16:9') && canvasExpandedText.includes('720p') && canvasExpandedText.includes('5'))
  check('canvas approval makes the no-generation boundary explicit', canvasExpandedText.includes('只建卡') || canvasExpandedText.includes('未提交生成') || canvasExpandedText.includes('按需生成'))
  const canvasDetailsScreenshot = await step('budget-sensitive-user', 'capture', 'canvas approval details', () => walk.snap('resident-canvas-approval-details'))
  attachScreenshot(['canvas approval reveals model, prompt and generation parameters on demand', 'canvas approval makes the no-generation boundary explicit'], canvasDetailsScreenshot)
  const proposalEditor = canvasApproval.locator('[data-agent-proposal-editor]')
  check('canvas approval mounts the generation parameter editor', await proposalEditor.count() === 1)
  await proposalEditor.getByRole('button', { name: /编辑生成参数|Edit generation settings/ }).click()
  const imageProposalEditor = proposalEditor.locator('[data-agent-proposal-node="resident-source"]')
  const videoProposalEditor = proposalEditor.locator('[data-agent-proposal-node="resident-target"]')
  await imageProposalEditor.locator('[aria-label="模型"], [aria-label="Model"]').selectOption(FIXTURE_IMAGE_ALT_MODEL)
  await imageProposalEditor.locator('[aria-label="模式"], [aria-label="Mode"]').selectOption('t2i')
  await imageProposalEditor.locator('[data-agent-parameter-control="size"]').selectOption('1536x1024')
  check('approval edits image model, mode and size through the same node contract', await imageProposalEditor.locator('[aria-label="模型"], [aria-label="Model"]').inputValue() === FIXTURE_IMAGE_ALT_MODEL && await imageProposalEditor.locator('[aria-label="模式"], [aria-label="Mode"]').inputValue() === 't2i' && await imageProposalEditor.locator('[data-agent-parameter-control="size"]').inputValue() === '1536x1024')
  await videoProposalEditor.locator('[aria-label="模型"], [aria-label="Model"]').selectOption(FIXTURE_VIDEO_ALT_MODEL)
  await videoProposalEditor.locator('[aria-label="模式"], [aria-label="Mode"]').selectOption('i2v')
  await videoProposalEditor.locator('[data-agent-parameter-control="aspect_ratio"]').selectOption('9:16')
  await videoProposalEditor.locator('[data-agent-parameter-control="resolution"]').selectOption('1080p')
  await videoProposalEditor.locator('textarea').fill('同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。')
  const durationControl = videoProposalEditor.locator('[data-agent-parameter-control="duration"]').first()
  await durationControl.fill('8')
  check('approval edits video model, mode, prompt and every visible generation parameter', await videoProposalEditor.locator('[aria-label="模型"], [aria-label="Model"]').inputValue() === FIXTURE_VIDEO_ALT_MODEL && await videoProposalEditor.locator('[aria-label="模式"], [aria-label="Mode"]').inputValue() === 'i2v' && await videoProposalEditor.locator('[data-agent-parameter-control="aspect_ratio"]').inputValue() === '9:16' && await videoProposalEditor.locator('[data-agent-parameter-control="resolution"]').inputValue() === '1080p' && await videoProposalEditor.locator('textarea').inputValue() === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && await durationControl.inputValue() === '8')
  const editedCanvasScreenshot = await step('budget-sensitive-user', 'capture', 'edited canvas approval', () => walk.snap('resident-canvas-approval-edited'))
  attachScreenshot(['approval edits image model, mode and size through the same node contract', 'approval edits video model, mode, prompt and every visible generation parameter'], editedCanvasScreenshot)
  await step('professional-storyboarder', 'approve-canvas-write', 'resident approval card', () => clickOrFail(canvasApproval.locator('[data-agent-action="approve"]'), '批准画布建卡'))
  const canvasResultWire = await recorded(canvasFollowup.received, 'resident canvas result')
  check('approved effective parameters return through the Host tool result', canvasResultWire.body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === canvasToolId))
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 3, edges: 1 })
  const landedCanvas = (await readProject(win, projectId)).payload.generationCanvas
  lastHostSnapshot = readHostSnapshot(walk.report.tempRoot, savedAfterDocument.immutableProjectUuid, savedAfterDocument.projectGeneration)
  lastDomainSnapshot = (await readProject(win, projectId)).payload
  const landedEditedVideo = landedCanvas.nodes.find((node) => node.title === '杯沿推近')
  const landedEditedImage = landedCanvas.nodes.find((node) => node.title === '清晨咖啡馆广角')
  check('approved canvas write persists every edited generation field and the reference edge', landedCanvas.nodes.length === 3 && landedCanvas.edges[0]?.mode === 'reference' && landedEditedImage?.meta?.modelKey === FIXTURE_IMAGE_ALT_MODEL && landedEditedImage?.meta?.size === '1536x1024' && landedEditedVideo?.prompt === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && landedEditedVideo?.meta?.modelKey === FIXTURE_VIDEO_ALT_MODEL && landedEditedVideo?.meta?.archetype?.modeId === 'i2v' && landedEditedVideo?.meta?.aspect_ratio === '9:16' && landedEditedVideo?.meta?.resolution === '1080p' && landedEditedVideo?.meta?.duration === 8)
  const generationVisibleText = await generationResident.innerText()
  check('canvas approval card exposes the shot-card action and hides raw ids', generationVisibleText.includes('创建或修改镜头卡') && !generationVisibleText.includes('create_canvas_nodes') && !generationVisibleText.includes('result-'))
  check('canvas completion leaves only active queue work visible', await generationResident.locator('[data-agent-queue-item]').count() === 0)
  const canvasApprovedScreenshot = await step('professional-storyboarder', 'capture', 'canvas result', () => walk.snap('resident-canvas-committed'))
  attachScreenshot(['approved canvas write persists both nodes and the reference edge', 'canvas approval card exposes the shot-card action and hides raw ids', 'canvas completion leaves only active queue work visible'], canvasApprovedScreenshot)

  // The Host only plans and commits nodes. Generation itself remains a user-facing
  // composer action so every paid-capable run crosses the same spend confirmation,
  // catalog mapping and domain result materializer as production.
  const sourceNode = landedCanvas.nodes.find((node) => node.title === '清晨咖啡馆广角')
  const targetNode = landedCanvas.nodes.find((node) => node.title === '杯沿推近')
  if (!sourceNode || !targetNode) throw new Error('Expected the approved canvas to contain image and video nodes')

  const imageNode = await step('budget-sensitive-user', 'select-image-node', 'image composer', () => selectCanvasNode(win, sourceNode.id, 'image'))
  const imageGenerate = imageNode.locator('button[aria-label="生成素材"]')
  await imageGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  check('image generation is idle before the user submits it', walk.fixture.images.length === 0 && await imageNode.getAttribute('data-status') !== 'success')
  await step('budget-sensitive-user', 'submit-image-generation', 'image composer', () => clickOrFail(imageGenerate, '提交图片生成'))
  await approveGenerationSpend(win, '图片生成')
  await expect(imageNode).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const imageGenerationProject = await readProject(win, projectId)
  const persistedImageNode = imageGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === sourceNode.id)
  check('real image generation calls the loopback catalog endpoint with the approved model and size', walk.fixture.images.length === 1 && walk.fixture.images[0]?.path === '/v1/images/generations' && walk.fixture.images[0]?.body?.model === FIXTURE_IMAGE_ALT_MODEL && walk.fixture.images[0]?.body?.size === '1536x1024')
  check('image result is materialized back into the canvas domain owner', persistedImageNode?.status === 'success' && persistedImageNode.result?.type === 'image' && Boolean(persistedImageNode.result.url))
  const imageScreenshot = await step('budget-sensitive-user', 'capture', 'image generated', () => walk.snap('resident-image-generated'))
  attachScreenshot(['real image generation calls the loopback catalog endpoint with the approved model and size', 'image result is materialized back into the canvas domain owner'], imageScreenshot)

  const videoNode = await step('professional-storyboarder', 'select-video-node', 'video composer', () => selectCanvasNode(win, targetNode.id, 'video'))
  const videoGenerate = videoNode.locator('button[aria-label="生成素材"]')
  await videoGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  check('video generation waits for the generated reference instead of submitting early', walk.fixture.videos.length === 0 && await videoNode.getAttribute('data-status') !== 'success')
  await step('professional-storyboarder', 'submit-video-generation', 'video composer', () => clickOrFail(videoGenerate, '提交视频生成'))
  await approveGenerationSpend(win, '视频生成')
  await expect(videoNode).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const videoGenerationProject = await readProject(win, projectId)
  const persistedVideoNode = videoGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === targetNode.id)
  const videoRequest = walk.fixture.videos[0]
  const videoBody = videoRequest?.body ?? {}
  check('real video generation calls the catalog video endpoint once', walk.fixture.videos.length === 1 && videoRequest?.path === '/v1/videos')
  check('video request carries every approved model, mode-derived parameter and generated image reference', videoBody.model === FIXTURE_VIDEO_ALT_MODEL && videoBody.prompt === '同一只红色杯子，八秒缓慢推近，保留咖啡馆环境。' && videoBody.aspect_ratio === '9:16' && videoBody.resolution === '1080p' && videoBody.duration === 8 && typeof videoBody.image === 'string' && videoBody.image.length > 0)
  check('video result is materialized as a playable domain asset', persistedVideoNode?.status === 'success' && persistedVideoNode.result?.type === 'video' && Boolean(persistedVideoNode.result.url))
  const videoScreenshot = await step('professional-storyboarder', 'capture', 'video generated', () => walk.snap('resident-video-generated'))
  attachScreenshot(['real video generation calls the catalog video endpoint once', 'video request carries every approved model, mode-derived parameter and generated image reference', 'video result is materialized as a playable domain asset'], videoScreenshot)

  // Text generation is also exercised through a real text node and the streaming
  // /v1/chat/completions path, rather than treating the Host's assistant reply as
  // a substitute for a generated canvas artifact.
  const textCreateToolId = 'resident-text-create-1'
  const textCreateRequest = walk.fixture.expectText({
    label: 'resident text node proposal',
    match: (body) => flattenRequestText(body).includes('请创建一个文本节点') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: textCreateToolId, name: 'create_canvas_nodes', args: {
      summary: '一个可生成的文本卡。',
      nodes: [{ clientId: 'resident-text', kind: 'text', title: '片头文案', prompt: '为这段视频写一句简洁片头文案。', modelKey: FIXTURE_TEXT_MODEL }],
    } },
  })
  const textCreateFollowup = walk.fixture.expectText({
    label: 'resident text node receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === textCreateToolId),
    reply: { type: 'text', text: '文本卡已创建。' },
  })
  await step('novice-creator', 'request-text-node', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建一个文本节点，准备生成片头文案。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送文本建卡任务')
  })
  await recorded(textCreateRequest.received, 'resident text node proposal')
  const textApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await textApproval.waitFor({ state: 'visible', timeout: 30_000 })
  await step('novice-creator', 'approve-text-node', 'resident approval card', () => clickOrFail(textApproval.locator('[data-agent-action="approve"]'), '批准文本建卡'))
  await recorded(textCreateFollowup.received, 'resident text node follow-up')
  await expect(generationResident).toContainText('文本卡已创建')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return canvas.nodes.some((node) => node.kind === 'text' && node.title === '片头文案')
  }, { timeout: 30_000 }).toBe(true)
  const canvasWithText = await readProject(win, projectId)
  const textNode = canvasWithText.payload.generationCanvas.nodes.find((node) => node.kind === 'text' && node.title === '片头文案')
  if (!textNode) throw new Error('Approved text node was not persisted')
  const textNodeView = await step('novice-creator', 'select-text-node', 'text composer', () => selectCanvasNode(win, textNode.id, 'text'))
  const textGenerate = textNodeView.locator('button[aria-label="生成素材"]')
  await textGenerate.waitFor({ state: 'visible', timeout: 30_000 })
  const generatedText = '真实文本生成回执：镜头从安静准备开始。'
  const textGeneration = walk.fixture.expectText({
    label: 'resident text generation request',
    match: (body) => body.model === FIXTURE_TEXT_MODEL && flattenRequestText(body).includes('片头文案') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'text', text: generatedText },
  })
  check('text node generation is idle before the user submits it', walk.fixture.requests.length > 0 && await textNodeView.getAttribute('data-status') !== 'success')
  await step('novice-creator', 'submit-text-generation', 'text composer', () => clickOrFail(textGenerate, '提交文本生成'))
  await approveGenerationSpend(win, '文本生成')
  await recorded(textGeneration.received, 'resident text generation request')
  await expect(textNodeView).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
  const textGenerationProject = await readProject(win, projectId)
  const persistedTextNode = textGenerationProject.payload.generationCanvas.nodes.find((node) => node.id === textNode.id)
  const textContent = JSON.stringify(persistedTextNode?.contentJson ?? {})
  check('real text generation uses the selected text model stream', walk.fixture.requests.some((record) => record.body?.model === FIXTURE_TEXT_MODEL && flattenRequestText(record.body).includes('片头文案')))
  check('text result is written into the text node domain owner', persistedTextNode?.status === 'success' && persistedTextNode.result?.type === 'text' && persistedTextNode.result.text?.includes(generatedText) && textContent.includes(generatedText))
  const textScreenshot = await step('novice-creator', 'capture', 'text generated', () => walk.snap('resident-text-generated'))
  attachScreenshot(['real text generation uses the selected text model stream', 'text result is written into the text node domain owner'], textScreenshot)

  // Settings contract: create a fresh image card without a modelKey. The
  // renderer must load the persisted task default and write the resolved
  // vendor/model identity into the node before the user opens its controls.
  const defaultImageToolId = 'resident-default-image-create-1'
  const defaultImageRequest = walk.fixture.expectText({
    label: 'resident default image node proposal',
    match: (body) => flattenRequestText(body).includes('使用设置默认图片模型') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: defaultImageToolId, name: 'create_canvas_nodes', args: {
      summary: '一张使用默认图片模型的卡。',
      nodes: [{ clientId: 'resident-default-image', kind: 'image', title: '默认图片模型卡', prompt: '默认模型验收，不提交生成。' }],
    } },
  })
  const defaultImageFollowup = walk.fixture.expectText({
    label: 'resident default image node receipt',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === defaultImageToolId),
    reply: { type: 'text', text: '图片卡已创建，将使用设置中的默认模型。' },
  })
  await step('budget-sensitive-user', 'request-default-image-node', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请创建一张使用设置默认图片模型的图片卡，不要生成。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送默认图片模型建卡任务')
  })
  await recorded(defaultImageRequest.received, 'resident default image node proposal')
  const defaultImageApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '创建或修改镜头卡' }).last()
  await defaultImageApproval.waitFor({ state: 'visible', timeout: 30_000 })
  await step('budget-sensitive-user', 'approve-default-image-node', 'resident approval card', () => clickOrFail(defaultImageApproval.locator('[data-agent-action="approve"]'), '批准默认图片模型建卡'))
  await recorded(defaultImageFollowup.received, 'resident default image node follow-up')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    const node = canvas.nodes.find((candidate) => candidate.kind === 'image' && candidate.title === '默认图片模型卡')
    return node?.meta?.modelKey ?? ''
  }, { timeout: 30_000 }).toBe('agent-runtime-image')
  const defaultImageProject = await readProject(win, projectId)
  const defaultImageNode = defaultImageProject.payload.generationCanvas.nodes.find((candidate) => candidate.kind === 'image' && candidate.title === '默认图片模型卡')
  if (!defaultImageNode) throw new Error('Default image node was not persisted')
  check('new image card inherits the configured default model identity', defaultImageNode.meta?.modelKey === 'agent-runtime-image' && defaultImageNode.meta?.modelVendor === FIXTURE_VENDOR)
  const defaultImageView = await step('budget-sensitive-user', 'select-default-image-node', 'existing image composer', () => selectCanvasNode(win, defaultImageNode.id, 'default image'))
  const defaultModelTrigger = defaultImageView.locator('[aria-label="模型"]')
  await defaultModelTrigger.waitFor({ state: 'visible', timeout: 30_000 })
  check('existing image composer exposes the configured model control', (await defaultModelTrigger.innerText()).includes('Fixture 图片') || (await defaultModelTrigger.innerText()).includes('agent-runtime-image'))
  const defaultParameterTrigger = defaultImageView.locator('[aria-label="生成参数"]')
  check('existing image composer exposes its parameter control', await defaultParameterTrigger.count() === 1)
  const defaultImageScreenshot = await step('budget-sensitive-user', 'capture', 'default image model controls', () => walk.snap('resident-default-image-controls'))
  attachScreenshot(['new image card inherits the configured default model identity', 'existing image composer exposes the configured model control', 'existing image composer exposes its parameter control'], defaultImageScreenshot)

  const composerGeometry = await win.evaluate(() => {
    const composer = document.querySelector('.generation-canvas-v2-node__composer-card')
    const anchor = document.querySelector('.generation-canvas-v2-node__composer')
    const node = anchor?.parentElement
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const timeline = document.querySelector('.workbench-generation__timeline')
    if (!composer || !stage || !timeline || !anchor || !node) return { missing: { composer: !composer, stage: !stage, timeline: !timeline, anchor: !anchor, node: !node } }
    const rect = composer.getBoundingClientRect(); const timelineRect = timeline.getBoundingClientRect(); const nodeRect = node.getBoundingClientRect(); const anchorRect = anchor.getBoundingClientRect()
    return { composer: { top: rect.top, bottom: rect.bottom, height: rect.height }, anchor: { top: anchorRect.top, bottom: anchorRect.bottom, height: anchorRect.height }, node: { top: nodeRect.top, bottom: nodeRect.bottom, height: nodeRect.height }, timeline: { top: timelineRect.top }, flip: anchor.getAttribute('data-flipped') }
  })
  check('generation composer remains reachable above the timeline', Boolean(composerGeometry && 'composer' in composerGeometry && composerGeometry.composer.bottom <= composerGeometry.timeline.top + 1))

  const canvasBeforeDeny = (await readProject(win, projectId)).payload.generationCanvas
  const denyToolId = 'resident-canvas-delete-denied-1'
  const denyRequest = walk.fixture.expectText({
    label: 'resident denied canvas mutation',
    match: (body) => flattenRequestText(body).includes('请删除第一个镜头卡') && !body.messages?.some((message) => message.role === 'tool'),
    reply: { type: 'tool', id: denyToolId, name: 'delete_canvas_nodes', args: { nodeIds: ['resident-source'] } },
  })
  const denyFollowup = walk.fixture.expectText({
    label: 'resident denied canvas result',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === denyToolId),
    reply: { type: 'text', text: '已拒绝删除，两个镜头卡仍保留。' },
  })
  await step('failure-recovery-user', 'request-dangerous-change', 'resident composer', async () => {
    await generationResident.locator('[data-agent-composer] textarea').fill('请删除第一个镜头卡，但先让我确认。')
    await clickOrFail(generationResident.locator('[data-agent-send]'), '发送删除镜头卡任务')
  })
  await recorded(denyRequest.received, 'resident denied canvas request')
  const denyApproval = generationResident.locator('[data-agent-item-kind="approval"]').filter({ hasText: '删除镜头卡' }).last()
  await denyApproval.waitFor({ state: 'visible', timeout: 30_000 })
  const denyPendingScreenshot = await step('failure-recovery-user', 'capture', 'deny approval pending', () => walk.snap('resident-canvas-deny-pending'))
  check('dangerous action is named before the user decides', (await denyApproval.innerText()).includes('删除镜头卡'))
  attachScreenshot('dangerous action is named before the user decides', denyPendingScreenshot)
  await step('failure-recovery-user', 'deny-tool', 'resident approval card', () => clickOrFail(denyApproval.locator('[data-agent-action="deny"]'), '拒绝删除镜头卡'))
  await recorded(denyFollowup.received, 'resident denied canvas follow-up')
  await expect(generationResident).toContainText('已拒绝删除')
  const afterDenyCanvas = (await readProject(win, projectId)).payload.generationCanvas
  check('denied canvas mutation leaves domain state unchanged', JSON.stringify(afterDenyCanvas) === JSON.stringify(canvasBeforeDeny))
  const deniedCardText = await generationResident.locator('[data-agent-turn-id]').filter({ hasText: '已取消' }).last().innerText().catch(() => '')
  check('denied operation is a neutral receipt without retry actions', deniedCardText.includes('已取消') && await generationResident.locator('[data-agent-turn-id]').filter({ hasText: '已取消' }).last().locator('[data-agent-action="retry"], [data-agent-action="edit-prompt"]').count() === 0)
  const denyScreenshot = await step('failure-recovery-user', 'capture', 'denied canvas result', () => walk.snap('resident-canvas-denied'))
  attachScreenshot(['denied canvas mutation leaves domain state unchanged', 'denied operation is a neutral receipt without retry actions'], denyScreenshot)

  // Evidence must be read after the denied turn settles; a pre-deny snapshot
  // would falsely claim that Host history covers the rejection path.
  const deniedProject = await readProject(win, projectId)
  lastHostSnapshot = readHostSnapshot(walk.report.tempRoot, deniedProject.immutableProjectUuid, deniedProject.projectGeneration)
  lastDomainSnapshot = deniedProject.payload
  const deniedHostItems = lastHostSnapshot?.items?.filter((item) => item.turnId && item.turnId === lastHostSnapshot.turns?.at(-1)?.turnId) ?? []
  check('Host persists the denied decision as declined, without a retryable runtime failure', deniedHostItems.some((item) => item.kind === 'failure' && item.status === 'declined' && item.code === 'capability_declined') && !deniedHostItems.some((item) => item.kind === 'failure' && item.status === 'failed' && item.retryable))
  attachScreenshot('Host persists the denied decision as declined, without a retryable runtime failure', denyScreenshot)

  const finalHostPath = path.join(walk.outputDir, 'evidence-host-final.json')
  const finalDomainPath = path.join(walk.outputDir, 'evidence-domain-final.json')
  fs.writeFileSync(finalHostPath, JSON.stringify(lastHostSnapshot, null, 2))
  fs.writeFileSync(finalDomainPath, JSON.stringify(lastDomainSnapshot, null, 2))
  check('all media requests stayed inside the zero-quota loopback fixture', walk.report.paidCalls === 0 && walk.fixture.images.length === 1 && walk.fixture.videos.length === 1)
  check('real-user journey stays free of renderer errors', rendererErrors.length === 0, rendererErrors.slice(0, 2).join(' | '))
  lastScreenshot = walk.report.screenshots.at(-1) ?? lastScreenshot
  for (const assertion of assertions) {
    assertion.screenshot ||= lastScreenshot
    assertion.hostSnapshot = finalHostPath
    assertion.domainSnapshot = finalDomainPath
  }
  walk.report.trace = trace
  walk.report.failures = failures
  walk.report.assertions = assertions
  walk.report.verified = [
    'resident-natural-language-response',
    'resident-document-approval-persistence',
    'resident-host-history-persistence',
    'resident-canvas-reference-write',
    'resident-canvas-deny-persistence',
    'resident-image-generation',
    'resident-video-generation',
    'resident-text-generation',
    'resident-natural-image-intent',
    'zero-quota',
  ]
  if (failures.length) throw new Error(`Real-user acceptance assertions failed: ${failures.join('; ')}`)
  walk.fixture.assertClean()
} catch (error) {
  failure = error
  if (rendererErrors.length) console.error('Renderer diagnostics:', rendererErrors.slice(0, 5).join(' | '))
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(traceDir, 'trace.json'), JSON.stringify(trace, null, 2))
  fs.writeFileSync(path.join(walk.outputDir, 'assertions.json'), JSON.stringify(assertions, null, 2))
  await walk.finish(failure)
}
