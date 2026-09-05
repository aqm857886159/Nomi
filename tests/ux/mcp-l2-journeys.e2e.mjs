import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, packagedMcpRuntime, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { startFakeApimartServer, writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { expectAbsent, expectHidden, expectVisible, proveProbe } from './_assert.mjs'

const dirs = makeIsolatedDirs('nomi-mcp-l2-')
const packagedBundle = process.argv.includes('--packaged')
  ? String(process.argv[process.argv.indexOf('--packaged') + 1] || '')
  : ''
const mcpRuntime = packagedBundle ? packagedMcpRuntime(packagedBundle, dirs.tempRoot) : null
const artifactDir = path.join(dirs.tempRoot, 'tests', 'ux', 'mcp-l2')
fs.mkdirSync(artifactDir, { recursive: true })
const trace = (name) => path.join(artifactDir, `${name}.jsonl`)
const screenshotSize = (filePath) => {
  const bytes = fs.readFileSync(filePath)
  assert.equal(bytes.slice(0, 8).toString('hex'), '89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length }
}
const takeScreenshot = async (win, name) => {
  const filePath = path.join(artifactDir, `${name}.png`)
  await win.screenshot({ path: filePath })
  const size = screenshotSize(filePath)
  assert.ok(size.width > 0 && size.height > 0 && size.bytes > 0, `${name} screenshot has dimensions`)
}
const resultData = (result) => result?.structuredContent?.nomiRunData || result?.structuredContent?.nomiOutcome || {}
const resultTextJson = (result) => {
  const parsed = parseToolResult(result)
  return parsed.json || resultData(result)
}
const call = async (mcp, name, args, options) => {
  const result = await mcp.callTool(name, args, options)
  if (result?.isError) {
    console.log(`  ${name} error=`, JSON.stringify(result))
    if (typeof mcp?.stderrText === 'function') console.log(`  ${name} stderr=`, mcp.stderrText())
    throw new Error(`${name}: ${parseToolResult(result).text}`)
  }
  return result
}

let gui
let provider
let mcp
let declinedClient
let landedClient
let c9bClient
let c10Client
let passed = 0
const check = (condition, message) => { assert.ok(condition, message); passed += 1; console.log(`  ✓ ${message}`) }

try {
  provider = await startFakeApimartServer({ pendingPolls: 1 })
  // Seed the real GUI bootstrap with the encrypted fixture credential. The
  // fixture origin is selected by the E2E env; the catalog itself stays on
  // the shipped APIMart identity and pricing scope.
  writeFakeApimartCatalog(dirs.settingsDir, dirs.userDataDir, provider.origin, { withKey: false })
  gui = await launchNomiApp({
    name: 'mcp-l2-journeys', userDataDir: dirs.userDataDir, settingsDir: dirs.settingsDir, projectsDir: dirs.projectsDir, capabilityDir: dirs.capabilityDir,
    env: {
      NOMI_APP_NAME: 'Nomi',
      NOMI_CAPABILITY_DIR: dirs.capabilityDir,
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      // In packaged mode app.isPackaged===true guards the fixture; opt back in
      // with the three-flag escape hatch (NOMI_E2E + NOMI_E2E_PRODUCTION_FIXTURE
      // + NOMI_E2E_PACKAGED_FIXTURE) so the export driver uses the fixture path
      // instead of assertDraftFilmReady against the renderer timeline state.
      ...(mcpRuntime ? { NOMI_E2E_PACKAGED_FIXTURE: '1' } : {}),
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_E2E_APIMART_REFERENCE_URL: `${provider.origin}/fixture/image.png`,
      NOMI_E2E_APIMART_API_KEY: 'mcp-l2-loopback-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
    args: ['--disable-gpu', '--disable-software-rasterizer'], settleMs: 0, syntheticCredentialStorage: true,
    ...(mcpRuntime ? { executablePath: mcpRuntime.executablePath } : {}),
  })
  const win = gui.win
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  console.log('  GUI hash=', await win.evaluate(() => window.location.hash))
  check(Boolean(projectId), 'GUI 打开隔离项目')
  await win.waitForTimeout(5_000)

  mcp = spawnMcpStdioClient({
    ...dirs, tracePath: trace('C7-C12'), captureStderr: true,
    clientInfo: { name: 'Codex MCP L2', version: 'e2e' }, capabilities: {},
    ...(mcpRuntime ? { runtime: mcpRuntime } : {}),
    env: {
      NOMI_APP_NAME: 'Nomi',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_E2E_APIMART_REFERENCE_URL: `${provider.origin}/fixture/image.png`,
      NOMI_E2E_APIMART_API_KEY: 'mcp-l2-loopback-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    }, syntheticCredentialStorage: true,
  })
  const initialized = await mcp.initialize()
  check(Boolean(initialized?.result), 'C7 initialize 成功')
  const projects = await call(mcp, 'nomi_read', { target: 'projects' })
  const projectsData = resultTextJson(projects)
  console.log('  C7 projects payload=', JSON.stringify({ text: parseToolResult(projects).text, structured: projects.structuredContent }))
  const listedProjects = projectsData.projects || resultData(projects).projects || []
  const listed = listedProjects.find((item) => item.id === projectId) || listedProjects[0]
  check(Boolean(listed?.id), 'C7 nomi_read(projects) 返回当前项目')
  const createdForSession = await call(mcp, 'nomi_project_create', { name: 'C7-C12 real journey' })
  const createdData = resultTextJson(createdForSession)
  const journeyProjectId = createdData.id || resultData(createdForSession).id
  const projectSelectionHandle = createdData.projectSelectionHandle || resultData(createdForSession).projectSelectionHandle
  check(Boolean(journeyProjectId && projectSelectionHandle), 'C7 项目选择句柄来自真实 project_create')
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, journeyProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), journeyProjectId, { timeout: 10_000 })
  const opened = await call(mcp, 'nomi_session_open', { projectSelectionHandle })
  const openedData = resultTextJson(opened)
  const leaseHandle = openedData.leaseHandle || resultData(opened).leaseHandle
  check(typeof leaseHandle === 'string' && leaseHandle.length > 20, 'C7 session/open 返回可用 leaseHandle')

  // C7-T14: the Agent handles provider variance, while Nomi owns only the
  // secure credential handoff, proposal persistence gate, and paid two-phase.
  const integrationStarted = await call(mcp, 'nomi_integration', {
    action: 'begin', kind: 'http-api-provider', name: 'C7 relay proposal', baseUrl: provider.origin,
    authType: 'bearer', authHeader: 'Authorization', docs: `${provider.origin}/docs`,
  })
  const integrationStartData = resultTextJson(integrationStarted)
  const integrationSessionId = integrationStartData.id || resultData(integrationStarted).id
  const credentialHandoff = await call(mcp, 'nomi_integration', {
    action: 'open_credentials', sessionId: integrationSessionId, expectedRevision: integrationStartData.revision,
  })
  check(resultTextJson(credentialHandoff).stage === 'needs_credential', 'C7 T14 open_credentials 只打开 Nomi 安全页')
  // open_credentials 现在还有一个 GUI 副作用：把 Nomi 叫到前台并停在「设置 → 模型 → 添加一个 AI 模型」，
  // 供应商名从持久 handoff 还原。这是 PR #528 要证明的那件事，所以在这里正面断言它，
  // 而不是让它以「后面某个点击被模态挡住」的形式暴露出来。
  const settingsOverlay = win.locator('[data-settings-overlay="true"]')
  await expectVisible(settingsOverlay, 'C7 T14 open_credentials 把设置对话框带到前台')
  const addModelPage = settingsOverlay.locator('[data-model-settings-page="add"]')
  await expectVisible(addModelPage, 'C7 T14 设置停在「添加一个 AI 模型」页')
  const providerNameInput = settingsOverlay.getByPlaceholder('如：TOAPI 中转')
  await expectVisible(providerNameInput, 'C7 T14 添加页带供应商名输入框')
  check(await providerNameInput.inputValue() === 'C7 relay proposal', 'C7 T14 供应商名从持久 handoff 预填')
  // 关掉的方式必须是用户手上真有的那两个（Escape / 关闭钮），不是 force click 绕过 aria-modal。
  // 模型页是抽屉里的下钻页：第一下 Escape 退回模型首页，第二下才关整个对话框——两级都断言，
  // 「Escape 能关设置」这条无障碍基本项因此是被证明的，不是被假设的。
  await win.keyboard.press('Escape')
  await expectHidden(addModelPage, 'C7 T14 Escape 从添加页退回模型首页')
  await win.keyboard.press('Escape')
  await expectHidden(settingsOverlay, 'C7 T14 再按一次 Escape 关闭设置对话框')
  const credentialSaved = await win.evaluate(async (id) => {
    const onboarding = window.nomiDesktop?.onboarding
    const current = await onboarding?.integrationSessionGet?.(id)
    const saved = await onboarding?.integrationSessionSaveCredential?.({ sessionId: id, expectedRevision: Number(current?.revision), apiKey: 'mcp-l2-proposal-key' })
    if (saved?.credentialStatus !== 'ready') throw new Error('T14 fixture credential was not saved')
    const handoffs = await onboarding?.integrationHandoffList?.() || []
    return { queued: handoffs.filter((item) => item.sessionId === id && item.target === 'credential').length }
  }, integrationSessionId)
  // 密钥落地后，那条持久「去填 key」请求必须由写它的那层收走。留着它 = 用户下次打开设置→模型
  // 又被拽回一个已经接好的供应商的添加页（走查里这条 fixture 原本自己 ack 掉，把这个缺口盖住了）。
  check(credentialSaved.queued === 0, 'C7 T14 密钥落地后持久凭据 handoff 被收走')
  const afterCredential = await call(mcp, 'nomi_read', { target: 'integration', sessionId: integrationSessionId })
  const afterCredentialData = resultTextJson(afterCredential)
  const rejectedProposal = await mcp.callTool('nomi_integration', {
    action: 'propose', sessionId: integrationSessionId, expectedRevision: afterCredentialData.revision,
    proposal: { candidates: [{ modelKey: 'relay-image', kind: 'image' }], selections: [{ modelKey: 'missing-model' }] },
  })
  check(rejectedProposal.isError && /proposal\.selections|candidate/i.test(parseToolResult(rejectedProposal).text), 'C7 T14 propose 返回字段级可读打回原因')
  const proposed = await call(mcp, 'nomi_integration', {
    action: 'propose', sessionId: integrationSessionId, expectedRevision: afterCredentialData.revision,
    proposal: { candidates: [{ modelKey: 'relay-image', kind: 'image' }], selections: [{ modelKey: 'relay-image' }] },
  })
  const proposedData = resultTextJson(proposed)
  check(proposedData.stage === 'needs_spend_confirmation', 'C7 T14 propose 通过强 schema 落库门')
  const proposalConfirm = await call(mcp, 'nomi_integration', {
    action: 'confirm', sessionId: integrationSessionId, expectedRevision: proposedData.revision, idempotencyKey: 'c7-t14-paid-phase',
  })
  const proposalConfirmData = resultTextJson(proposalConfirm)
  check(Boolean(proposalConfirmData.challengeId), 'C7 T14 confirm 只生成不可变花费挑战')
  const afterConfirm = await call(mcp, 'nomi_read', { target: 'integration', sessionId: integrationSessionId })
  const afterConfirmData = resultTextJson(afterConfirm)
  const bypassStart = await mcp.callTool('nomi_integration', {
    action: 'start', sessionId: integrationSessionId, expectedRevision: afterConfirmData.revision,
    idempotencyKey: 'c7-t14-paid-phase', receipt: 'not-a-trusted-receipt',
  })
  check(bypassStart.isError && /receipt|approval|收据|确认|invalid/i.test(parseToolResult(bypassStart).text), 'C7 T14 start 无可信收据不可绕过 confirm')
  check(provider.hits.filter((hit) => /^\/v1\/(images|videos)\/generations$/.test(hit.url || '')).length === 0, 'C7 T14 付费绕过失败且未提交供应商任务')
  const proxyOff = await call(mcp, 'nomi_integration_manage', { action: 'set_proxy', vendorKey: 'apimart', enabled: false })
  check(resultTextJson(proxyOff).enabled === false, 'C7 管理动词可关闭单连接代理')

  const fourNodes = [0, 1, 2, 3].map((index) => ({ clientId: `c8-shot-${index + 1}`, kind: 'shot', title: `镜头 ${index + 1}`, prompt: `湖边纸船镜头 ${index + 1}`, position: { x: index * 380, y: 0 } }))
  declinedClient = spawnMcpStdioClient({ ...dirs, tracePath: trace('C8-decline'), capabilities: { elicitation: {} }, elicitationAction: 'decline', syntheticCredentialStorage: true, runtime: mcpRuntime, env: { NOMI_APP_NAME: 'Nomi' } })
  await declinedClient.initialize()
  const c8Project = await call(declinedClient, 'nomi_project_create', { name: 'C8 four-shot confirmation' })
  const c8ProjectData = resultTextJson(c8Project)
  const c8ProjectId = c8ProjectData.id || resultData(c8Project).id
  const c8ProjectSelectionHandle = c8ProjectData.projectSelectionHandle || resultData(c8Project).projectSelectionHandle
  check(Boolean(c8ProjectId && c8ProjectSelectionHandle), 'C8 项目选择句柄来自独立 project_create')
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, c8ProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), c8ProjectId, { timeout: 10_000 })
  const c8DeclinedSession = await call(declinedClient, 'nomi_session_open', { projectSelectionHandle: c8ProjectSelectionHandle })
  const c8DeclinedSessionData = resultTextJson(c8DeclinedSession)
  const c8DeclinedLease = c8DeclinedSessionData.leaseHandle || resultData(c8DeclinedSession).leaseHandle
  const declined = await call(declinedClient, 'nomi_canvas_edit', { projectId: c8ProjectId, leaseHandle: c8DeclinedLease, operation: 'create_canvas_nodes', summary: '在画布落下四镜方案', nodes: fourNodes })
  const declinedData = resultTextJson(declined)
  console.log('  C8 decline payload=', JSON.stringify({ elicitationCount: declinedClient.elicitationCount(), text: parseToolResult(declined).text, structured: declined.structuredContent }))
  check(declinedData.cancelled === true && declinedData.reason === 'declined', 'C8 elicitation decline 返回 typed reason=declined')
  await declinedClient.terminate()
  declinedClient = null

  landedClient = spawnMcpStdioClient({ ...dirs, tracePath: trace('C8-land'), capabilities: {}, syntheticCredentialStorage: true, runtime: mcpRuntime, env: { NOMI_APP_NAME: 'Nomi' } })
  await landedClient.initialize()
  const landedProject = await call(landedClient, 'nomi_project_create', { name: 'C8 four-shot landed' })
  const landedProjectData = resultTextJson(landedProject)
  const landedProjectId = landedProjectData.id || resultData(landedProject).id
  const landedProjectSelectionHandle = landedProjectData.projectSelectionHandle || resultData(landedProject).projectSelectionHandle
  check(Boolean(landedProjectId && landedProjectSelectionHandle), 'C8 落地项目选择句柄来自独立 project_create')
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, landedProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), landedProjectId, { timeout: 10_000 })
  const c8LandedSession = await call(landedClient, 'nomi_session_open', { projectSelectionHandle: landedProjectSelectionHandle })
  const c8LandedSessionData = resultTextJson(c8LandedSession)
  const c8LandedLease = c8LandedSessionData.leaseHandle || resultData(c8LandedSession).leaseHandle
  const addPromise = landedClient.callTool('nomi_canvas_edit', { projectId: landedProjectId, leaseHandle: c8LandedLease, operation: 'create_canvas_nodes', summary: '在画布落下四镜方案', nodes: fourNodes })
  const planCard = win.locator('div.fixed.inset-0').filter({ hasText: /在画布落一套方案|落到画布/ }).first()
  await planCard.waitFor({ timeout: 20_000 })
  await takeScreenshot(win, 'C8-four-shots-landed')
  await planCard.locator('button').last().click()
  const landed = await addPromise
  const landedData = resultTextJson(landed)
  const nodeIds = landedData.affectedNodeIds || landedData.ids || landedData.nodeIds || resultData(landed).affectedNodeIds || []
  check(Array.isArray(nodeIds) && nodeIds.length === 4, 'C8 方案确认后四镜真实落画布')
  await landedClient.terminate()
  landedClient = null

  const c9ProjectResult = await call(mcp, 'nomi_project_create', { name: 'C9 semantic four-shot generation' })
  const c9ProjectData = resultTextJson(c9ProjectResult)
  const c9ProjectId = c9ProjectData.id || resultData(c9ProjectResult).id
  const c9SelectionHandle = c9ProjectData.projectSelectionHandle || resultData(c9ProjectResult).projectSelectionHandle
  check(Boolean(c9ProjectId && c9SelectionHandle), 'C9 项目选择句柄来自真实 project_create')
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, c9ProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), c9ProjectId, { timeout: 10_000 })
  await win.getByText('C9 semantic four-shot generation', { exact: true }).waitFor({ timeout: 20_000 })
  // Let the renderer finish its normal project-persistence tick before the
  // challenge is sealed. The stale-receipt leg below is deliberate; this
  // settle window keeps that leg attributable to the explicit revision write
  // instead of the first project-open persistence pass.
  await win.waitForTimeout(1_000)
  const c9Session = await call(mcp, 'nomi_session_open', { projectSelectionHandle: c9SelectionHandle })
  const c9SessionData = resultTextJson(c9Session)
  const c9Lease = c9SessionData.leaseHandle || resultData(c9Session).leaseHandle
  check(typeof c9Lease === 'string' && c9Lease.length > 20, 'C9 session/open 返回生成 lease')

  const generationContextResult = await call(mcp, 'nomi_read', { target: 'generation_context', projectId: c9ProjectId, leaseHandle: c9Lease })
  const generationContext = resultTextJson(generationContextResult)
  const videoModel = (generationContext.videoModels || resultData(generationContextResult).videoModels || []).find((model) => model.providerId === 'apimart')
  check(Boolean(videoModel?.modelId), 'C9 generation_context 返回假供应商视频模型')
  const importedReference = await call(mcp, 'nomi_asset_import', { projectId: c9ProjectId, path: provider.referencePath, title: 'C9 reference' })
  const importedData = resultTextJson(importedReference)
  console.log('  C9 imported reference payload=', JSON.stringify({ text: parseToolResult(importedReference).text, structured: importedReference.structuredContent }))
  const referenceAssetId = importedData.assetId || resultData(importedReference).assetId
  check(typeof referenceAssetId === 'string' && referenceAssetId.length > 0, 'C9 参考媒体经 nomi_asset_import 进入项目')
  const reference = {
    assetId: referenceAssetId,
    kind: 'image',
    role: 'character',
    version: Number(importedData.version || resultData(importedReference).version || 1),
    contentHash: importedData.contentHash || resultData(importedReference).contentHash,
  }
  const mode = (videoModel.modes || []).find((item) => item.transportTaskKind === 'image_to_video')
  const c9Shots = [0, 1, 2, 3].map((index) => ({
    shotId: `c9-shot-${index + 1}`,
    role: 'shot',
    included: true,
    candidate: {
      candidateId: `c9-candidate-${index + 1}`,
      revision: 1,
      moduleId: 'generation.single-shot',
      providerId: videoModel.providerId,
      modelId: videoModel.modelId,
      ...(videoModel.variants?.[0]?.id ? { variantId: videoModel.variants[0].id } : {}),
      mode: 'image_to_video',
      ...(mode?.id ? { modeId: mode.id } : {}),
      prompt: `湖边纸船连续镜头 ${index + 1}`,
      parameters: {},
      references: [reference],
    },
  }))
  const planned = await call(mcp, 'nomi_operation_plan', { projectId: c9ProjectId, leaseHandle: c9Lease, shots: c9Shots })
  const plannedData = resultTextJson(planned)
  let operationId = plannedData.operation?.operationId || resultData(planned).operation?.operationId
  check(typeof operationId === 'string' && operationId.length > 0, 'C9 operation_plan 创建四镜草稿')
  const preview = await call(mcp, 'nomi_operation_preview', { projectId: c9ProjectId, leaseHandle: c9Lease, operationId })
  const previewData = resultTextJson(preview)
  check(previewData.pricing?.shots?.length === 4 || previewData.pricing?.total?.unknownShotCount !== undefined, 'C9 operation_preview 返回四镜定价投影')
  // C9-stale: a real project write after challenge creation invalidates the
  // receipt. This is the production fail-closed contract, not a swallowed
  // error: the result is retained and asserted before a fresh operation is
  // planned. The bridge call uses the same persisted project record boundary
  // as the app rename/save path, and only mutates this isolated E2E project.
  const staleOperationId = operationId
  const staleGatePromise = mcp.callTool('nomi_operation_gate', { projectId: c9ProjectId, leaseHandle: c9Lease, operationId: staleOperationId, phase: 'request' }, { timeoutMs: 120_000 })
  const generationCard = win.locator('div.fixed.inset-0').filter({ hasText: /允许 Nomi 生成这一批镜头|生成这一批镜头/ }).first()
  await generationCard.waitFor({ timeout: 20_000 })
  await takeScreenshot(win, 'C9-generation-gate-stale')
  const staleRevisionWrite = await win.evaluate((id) => {
    const projects = window.nomiDesktop?.projects
    const current = projects?.read?.(id)
    if (!projects?.save || !current) throw new Error('C9 stale-receipt probe could not read the isolated project')
    const before = Number(current.revision)
    const saved = projects.save(id, {
      ...current,
      // A real persisted user-visible project edit is enough to invalidate a
      // generation approval receipt. Keep the project isolated and make the
      // edit explicit so the report can distinguish it from an accidental
      // renderer save race.
      name: `${String(current.name || 'C9 project')} stale-receipt edit`,
    })
    return { before, after: Number(saved?.revision) }
  }, c9ProjectId)
  check(Number.isInteger(staleRevisionWrite.before) && staleRevisionWrite.after === staleRevisionWrite.before + 1, 'C9 stale leg 真实项目保存使 revision 单调增加')
  await generationCard.locator('[data-production-action="confirm"]').click()
  const staleGate = await staleGatePromise
  const staleOutcome = staleGate?.structuredContent?.nomiOutcome || resultData(staleGate)
  check(staleGate?.isError === true && staleOutcome.errorCode === 'receipt_invalid', 'C9 stale receipt 被结构化拒绝为 receipt_invalid（不吞错）')
  check(provider.hits.filter((hit) => /^\/v1\/(images|videos)\/generations$/.test(hit.url || '')).length === 0, 'C9 stale receipt 失败不触达供应商')
  const cancelledStale = await call(mcp, 'nomi_operation_control', { projectId: c9ProjectId, leaseHandle: c9Lease, operationId: staleOperationId, action: 'cancel' })
  const cancelledStaleData = resultTextJson(cancelledStale)
  check((cancelledStaleData.operation || resultData(cancelledStale).operation)?.state === 'cancelled', 'C9 stale sealed Run 取消后不留可提交计划')

  const retryPlanned = await call(mcp, 'nomi_operation_plan', { projectId: c9ProjectId, leaseHandle: c9Lease, shots: c9Shots })
  const retryPlannedData = resultTextJson(retryPlanned)
  operationId = retryPlannedData.operation?.operationId || resultData(retryPlanned).operation?.operationId
  check(typeof operationId === 'string' && operationId.length > 0 && operationId !== staleOperationId, 'C9 receipt_invalid 后重新创建四镜 operation')
  const retryPreview = await call(mcp, 'nomi_operation_preview', { projectId: c9ProjectId, leaseHandle: c9Lease, operationId })
  const retryPreviewData = resultTextJson(retryPreview)
  check(retryPreviewData.pricing?.shots?.length === 4 || retryPreviewData.pricing?.total?.unknownShotCount !== undefined, 'C9 re-confirm 前重新生成四镜定价投影')
  const retryGatePromise = mcp.callTool('nomi_operation_gate', { projectId: c9ProjectId, leaseHandle: c9Lease, operationId, phase: 'request' }, { timeoutMs: 120_000 })
  await generationCard.waitFor({ timeout: 20_000 })
  await takeScreenshot(win, 'C9-generation-gate-reconfirm')
  await generationCard.locator('[data-production-action="confirm"]').click()
  const gated = await retryGatePromise
  if (gated?.isError) {
    console.log('  nomi_operation_gate retry error=', JSON.stringify(gated))
    throw new Error(`nomi_operation_gate retry: ${parseToolResult(gated).text}`)
  }
  const gatedData = resultTextJson(gated)
  const challenge = gatedData.challenge || resultData(gated).challenge
  const gateShots = challenge?.shots?.shots || []
  check(gateShots.length === 4 && gateShots.every((shot) => Array.isArray(shot.referenceMedia) && shot.referenceMedia.some((item) => item.assetId === referenceAssetId)), 'C9 gate challenge 含四镜参考媒体投影')
  // J06 — gate challenge 不再硬编 ETA，应给 coldstart 区间（waitSecondsHigh > waitSeconds, etaBasis='coldstart'）
  const gateEtaBasis = challenge?.shots?.etaBasis
  const gateWaitLow = challenge?.shots?.waitSeconds
  const gateWaitHigh = challenge?.shots?.waitSecondsHigh
  check(gateEtaBasis === 'coldstart' && typeof gateWaitLow === 'number' && typeof gateWaitHigh === 'number' && gateWaitHigh > gateWaitLow, 'C9 gate challenge ETA 为 coldstart 区间而非固定点值')
  check(Boolean(gatedData.started || resultData(gated).started), 'C9 gate request 完成确认并进入 execute')

  // C9b: 「在调用方点同意」端到端旅程
  // 验证：客户端声明 elicitation 时，确认弹在调用方（surface: 'client'），Nomi 应用内生成确认卡不出现。
  // 两段式（expectAbsent 需阳性基线，_assert.mjs 签名强制）：
  //   Phase A 基线：无 elicitation 的 mcp 客户端触发 gate → GUI 确认卡真的会浮（proveProbe 证探针活）。
  //   Phase B 不变量：有 elicitation 的 c9bClient 触发 gate → 客户端自动 accept → 0 张 GUI 卡。
  // 注：elicitation 路径确认后由主进程验收 client confirmation receipt，直接进入 execute；
  // 因而这条 E2E 同时覆盖「弹在调用方且 Nomi 卡不出现」与「确认后真实启动」两个不变量。
  // Phase A 必须落在 GUI 当前 C9 项目，才能证明 Nomi 兜底卡确实会浮出。
  // Phase B 改用 c9bClient 自己创建的项目；project selection handle 是
  // connection-bound，不能把主 mcp 的句柄跨连接交给 c9bClient。
  const c9bProjectId = c9ProjectId
  const c9bLease = c9Lease
  const c9bReference = reference
  check(Boolean(c9bProjectId && c9bLease), 'C9b 复用当前已打开项目与主连接 lease')
  // 两镜计划（比 C9 少，仅用来激活 gate 门，不需要四镜）
  const c9bShots = [0, 1].map((index) => ({
    shotId: `c9b-shot-${index + 1}`, role: 'shot', included: true,
    candidate: {
      candidateId: `c9b-candidate-${index + 1}`, revision: 1, moduleId: 'generation.single-shot',
      providerId: videoModel.providerId, modelId: videoModel.modelId,
      ...(videoModel.variants?.[0]?.id ? { variantId: videoModel.variants[0].id } : {}),
      mode: 'image_to_video', ...(mode?.id ? { modeId: mode.id } : {}),
      prompt: `C9b 客户端确认旅程 ${index + 1}`, parameters: {}, references: [c9bReference],
    },
  }))
  // Phase A 基线：用无 elicitation 的 mcp 客户端触发 gate，证 GUI 卡真的会出现（探针活）
  const c9bBaselinePlanned = await call(mcp, 'nomi_operation_plan', { projectId: c9bProjectId, leaseHandle: c9bLease, shots: c9bShots })
  const c9bBaselinePlannedData = resultTextJson(c9bBaselinePlanned)
  const c9bBaselineOperationId = c9bBaselinePlannedData.operation?.operationId || resultData(c9bBaselinePlanned).operation?.operationId
  check(typeof c9bBaselineOperationId === 'string' && c9bBaselineOperationId.length > 0, 'C9b Phase A 基线计划已创建')
  await call(mcp, 'nomi_operation_preview', { projectId: c9bProjectId, leaseHandle: c9bLease, operationId: c9bBaselineOperationId })
  const c9bGenerationCard = win.locator('div.fixed.inset-0').filter({ hasText: /允许 Nomi 生成这一批镜头|生成这一批镜头/ }).first()
  const c9bBaselineGatePromise = mcp.callTool('nomi_operation_gate', { projectId: c9bProjectId, leaseHandle: c9bLease, operationId: c9bBaselineOperationId, phase: 'request' }, { timeoutMs: 30_000 })
  // proveProbe 阻塞至卡出现：若等不到，说明 Phase A 基线失效，后续 expectAbsent 是空话——在这里报红
  const c9bBaselineProof = await proveProbe(c9bGenerationCard, 'Phase A 基线：无 elicitation 客户端触发 gate 时 Nomi 会弹出 GUI 确认卡', 20_000)
  check(true, 'C9b Phase A 基线成立：非 elicitation 客户端 → GUI 生成确认卡浮出（探针活，expectAbsent 有意义）')
  await takeScreenshot(win, 'C9b-phase-a-baseline-gui-card')
  // 关闭基线卡（不确认，避免实际启动生成）
  await c9bGenerationCard.locator('button').filter({ hasText: /忽略|取消/ }).first().click().catch(() =>
    c9bGenerationCard.locator('button').last().click().catch(() => {}))
  await c9bGenerationCard.waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {})
  await c9bBaselineGatePromise.catch(() => {})
  // Phase B：c9bClient（声明 elicitation）在自己的项目上创建计划。
  // projectSelectionHandle 是 connection-bound（含 sessionId/connectionNonce），
  // 不能把 Phase A 的 mcp 句柄跨连接交给 c9bClient；这样测到的只会是
  // lease_invalid，而不是调用方 elicitation 的真实语义。独立项目还避免
  // 第二个 active Run 抢走 Nomi 任务中心的当前卡，保证 C12 后续 UI 走查
  // 仍然指向四镜 C9 Run。
  c9bClient = spawnMcpStdioClient({
    ...dirs, tracePath: trace('C9b-elicitation'), captureStderr: true,
    capabilities: { elicitation: {} }, elicitationAction: 'accept', syntheticCredentialStorage: true,
    runtime: mcpRuntime,
    env: {
      NOMI_APP_NAME: 'Nomi',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_E2E_APIMART_REFERENCE_URL: `${provider.origin}/fixture/image.png`,
      NOMI_E2E_APIMART_API_KEY: 'mcp-l2-loopback-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
  })
  await c9bClient.initialize()
  const c9bElicitProject = await call(c9bClient, 'nomi_project_create', { name: 'C9b elicitation isolated project' })
  const c9bElicitProjectData = resultTextJson(c9bElicitProject)
  const c9bElicitProjectId = c9bElicitProjectData.id || resultData(c9bElicitProject).id
  const c9bElicitSelectionHandle = c9bElicitProjectData.projectSelectionHandle || resultData(c9bElicitProject).projectSelectionHandle
  check(Boolean(c9bElicitProjectId && c9bElicitSelectionHandle), 'C9b Phase B elicitation 项目选择句柄来自同一连接 project_create')
  const c9bElicitSession = await call(c9bClient, 'nomi_session_open', { projectSelectionHandle: c9bElicitSelectionHandle })
  const c9bElicitSessionData = resultTextJson(c9bElicitSession)
  const c9bElicitLease = c9bElicitSessionData.leaseHandle || resultData(c9bElicitSession).leaseHandle
  check(typeof c9bElicitLease === 'string' && c9bElicitLease.length > 20, 'C9b Phase B elicitation 客户端 session/open 成功')
  const c9bElicitImportedReference = await call(c9bClient, 'nomi_asset_import', { projectId: c9bElicitProjectId, path: provider.referencePath, title: 'C9b reference' })
  const c9bElicitImportedData = resultTextJson(c9bElicitImportedReference)
  const c9bElicitReference = {
    assetId: c9bElicitImportedData.assetId || resultData(c9bElicitImportedReference).assetId,
    kind: 'image', role: 'character',
    version: Number(c9bElicitImportedData.version || resultData(c9bElicitImportedReference).version || 1),
    contentHash: c9bElicitImportedData.contentHash || resultData(c9bElicitImportedReference).contentHash,
  }
  const c9bElicitShots = [0, 1].map((index) => ({
    shotId: `c9b-elicit-shot-${index + 1}`, role: 'shot', included: true,
    candidate: {
      candidateId: `c9b-elicit-candidate-${index + 1}`, revision: 1, moduleId: 'generation.single-shot',
      providerId: videoModel.providerId, modelId: videoModel.modelId,
      ...(videoModel.variants?.[0]?.id ? { variantId: videoModel.variants[0].id } : {}),
      mode: 'image_to_video', ...(mode?.id ? { modeId: mode.id } : {}),
      prompt: `C9b elicitation 路径 ${index + 1}`, parameters: {}, references: [c9bElicitReference],
    },
  }))
  const c9bElicitPlanned = await call(c9bClient, 'nomi_operation_plan', { projectId: c9bElicitProjectId, leaseHandle: c9bElicitLease, shots: c9bElicitShots })
  const c9bElicitPlannedData = resultTextJson(c9bElicitPlanned)
  const c9bElicitOperationId = c9bElicitPlannedData.operation?.operationId || resultData(c9bElicitPlanned).operation?.operationId
  check(typeof c9bElicitOperationId === 'string' && c9bElicitOperationId.length > 0, 'C9b Phase B elicitation 客户端 operation_plan 成功')
  await call(c9bClient, 'nomi_operation_preview', { projectId: c9bElicitProjectId, leaseHandle: c9bElicitLease, operationId: c9bElicitOperationId })
  // 触发 gate——elicitation 客户端自动 accept，确认在调用方侧发生
  // callTool 不抛 isError 错误（只抛协议级错误），结果保留以供断言
  const c9bGateResult = await c9bClient.callTool('nomi_operation_gate', { projectId: c9bElicitProjectId, leaseHandle: c9bElicitLease, operationId: c9bElicitOperationId, phase: 'request' }, { timeoutMs: 30_000 })
  console.log('  C9b gate result=', JSON.stringify({
    isError: c9bGateResult?.isError,
    elicitationCount: c9bClient.elicitationCount(),
    started: Boolean(resultTextJson(c9bGateResult)?.started),
  }))
  // 断言 1：客户端真的被问了（surface: 'client' 的直接证据）
  check(c9bClient.elicitationCount() >= 1, 'C9b ① elicitationCount ≥ 1：客户端被问了，确认在调用方侧发生（surface: client）')
  // 断言 2：主进程能验收客户端确认收据并继续 execute。该路径曾因
  // verifyClientGenerationConfirmation 未接入而退回 human_approval_required。
  const c9bOutcome = resultTextJson(c9bGateResult)
  check(c9bGateResult?.isError !== true && Boolean(c9bOutcome?.started),
    'C9b ② 客户端确认收据被主进程验收，gate 返回 started=true')
  // 断言 3：Nomi 应用内生成确认卡全程未出现（两段式，阳性基线由 Phase A proveProbe 证明）
  await expectAbsent(c9bGenerationCard, { provenBy: c9bBaselineProof, message: 'C9b ③ elicitation 客户端确认时 Nomi 应用内生成确认卡不应出现' })
  check(true, 'C9b ③ Nomi 应用内生成确认卡持续缺席（expectAbsent 通过：不存在且保持窗口内未冒出）')
  await takeScreenshot(win, 'C9b-phase-b-no-gui-card')
  await c9bClient.terminate()
  c9bClient = null
  const providerSubmissionsBeforeC10 = provider.hits.filter((hit) => /^\/v1\/(images|videos)\/generations$/.test(hit.url || '')).length

  // C10: while the same confirmed batch is still being observed, drop a second
  // real MCP client's stdin. This leaves its long-poll request in flight and
  // exercises the server's disconnect cancellation path without touching the
  // provider submission seam.
  c10Client = spawnMcpStdioClient({
    ...dirs, tracePath: trace('C10-disconnect'), captureStderr: true,
    capabilities: {}, syntheticCredentialStorage: true,
    runtime: mcpRuntime,
    env: {
      NOMI_APP_NAME: 'Nomi',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_APIMART_BASE_URL: provider.origin,
      NOMI_E2E_APIMART_REFERENCE_URL: `${provider.origin}/fixture/image.png`,
      NOMI_E2E_APIMART_API_KEY: 'mcp-l2-loopback-key',
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
  })
  await c10Client.initialize()
  const c10Project = await call(c10Client, 'nomi_project_create', { name: 'C10 disconnect recovery' })
  const c10ProjectData = resultTextJson(c10Project)
  const c10ProjectId = c10ProjectData.id || resultData(c10Project).id
  const c10SelectionHandle = c10ProjectData.projectSelectionHandle || resultData(c10Project).projectSelectionHandle
  check(Boolean(c10ProjectId && c10SelectionHandle), 'C10 独立断连项目选择句柄有效')
  const c10Session = await call(c10Client, 'nomi_session_open', { projectSelectionHandle: c10SelectionHandle })
  const c10SessionData = resultTextJson(c10Session)
  const c10Lease = c10SessionData.leaseHandle || resultData(c10Session).leaseHandle
  const c10RunResult = await call(c10Client, 'nomi_run_start', {
    projectId: c10ProjectId,
    playbook: 'brand.promo',
    brief: { goal: '验证断连回收，不提交供应商任务' },
  })
  const c10RunData = resultTextJson(c10RunResult)
  const c10RunId = c10RunData.runId || resultData(c10RunResult).runId
  check(typeof c10Lease === 'string' && typeof c10RunId === 'string', 'C10 断连项目已建立可观察 Run')
  const c10InFlight = c10Client.callTool('nomi_read', {
    target: 'run_events', projectId: c10ProjectId, runId: c10RunId, afterCursor: 999_999, waitMs: 25_000,
  }, { timeoutMs: 30_000 }).then(() => null, (error) => error)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const c10Exit = await c10Client.disconnect()
  const c10Cancelled = await c10InFlight
  check(c10Exit?.code === 0, 'C10 stdin 断连后 stdio server 正常收口')
  check(c10Cancelled instanceof Error && /exited|cancel/i.test(c10Cancelled.message), 'C10 在飞 run_events 请求被断连取消')
  check(/cancelled \d+ in-flight request/.test(c10Client.stderrText()), 'C10 stderr 留下断连取消日志')
  check(provider.hits.filter((hit) => /^\/v1\/(images|videos)\/generations$/.test(hit.url || '')).length <= providerSubmissionsBeforeC10, 'C10 断连未新增供应商提交')
  c10Client = null

  let cursor = 0
  let finalEvents = null
  let terminalRunStatus = ''
  const terminalStatuses = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'attention'])
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const events = await call(mcp, 'nomi_read', { target: 'run_events', projectId: c9ProjectId, runId: operationId, afterCursor: cursor, waitMs: 1_000 })
    const eventsData = resultTextJson(events)
    finalEvents = eventsData
    cursor = Number.isInteger(eventsData.nextCursor) ? eventsData.nextCursor : cursor
    const observedRun = await call(mcp, 'nomi_read', { target: 'run', projectId: c9ProjectId, runId: operationId })
    terminalRunStatus = String(resultTextJson(observedRun).status || resultData(observedRun).status || '')
    if (terminalStatuses.has(terminalRunStatus) || terminalRunStatus === 'awaiting_rough_cut_review') break
  }
  check(Boolean(finalEvents) && Number.isInteger(finalEvents.nextCursor), 'C9 nomi_read(run_events) 轮询返回真实事件账本')
  const c9Run = await call(mcp, 'nomi_read', { target: 'run', projectId: c9ProjectId, runId: operationId })
  const c9RunData = resultTextJson(c9Run)
  console.log('  C9 terminal events=', JSON.stringify(finalEvents))
  console.log('  C9 run payload=', JSON.stringify({ text: parseToolResult(c9Run).text, structured: c9Run.structuredContent }))
  check(terminalRunStatus === 'awaiting_rough_cut_review', 'C9 run_events 轮询观察到粗剪审核终态')
  const c9Artifacts = c9RunData.artifacts || resultData(c9Run).artifacts || []
  check(c9Artifacts.length >= 4 && c9Artifacts.every((artifact) => typeof artifact.projectRelativePath === 'string' && artifact.projectRelativePath.length > 0), 'C9 四镜物化且每个 artifact 带 projectRelativePath')
  check(provider.hits.filter((hit) => /^\/v1\/(images|videos)\/generations$/.test(hit.url || '')).length === providerSubmissionsBeforeC10, 'C10 对账后没有新增供应商提交或孤儿付费提交')
  const videoArtifact = c9Artifacts.find((artifact) => artifact.kind === 'video') || c9Artifacts[0]
  const artifactResult = await call(mcp, 'nomi_read', { target: 'artifact', projectId: c9ProjectId, runId: operationId, artifactId: videoArtifact.artifactId })
  check(Boolean(artifactResult.structuredContent?.nomiRunData), 'C11 artifact structuredContent 带 nomiRunData')
  const artifactData = resultTextJson(artifactResult)
  check(Boolean(artifactData.poster || artifactResult.structuredContent?.nomiRunData?.poster), 'C11 视频 artifact structuredContent 带 poster')
  const posterBlock = (artifactResult.content || []).find((block) => block?.type === 'image' && block?.mimeType === 'image/jpeg' && typeof block?.data === 'string' && block.data.length > 0)
  check(Boolean(posterBlock), 'C11 视频 artifact MCP content 带可显 poster')

  // C12: the production driver has already arranged the real generated nodes;
  // read and validate that timeline through the MCP editing surface before
  // approving the export gate.
  const timelineRead = await call(mcp, 'nomi_timeline_read', { projectId: c9ProjectId, leaseHandle: c9Lease, operation: 'read' })
  const timeline = resultTextJson(timelineRead)
  const timelineTracks = Array.isArray(timeline.tracks) ? timeline.tracks : []
  console.log('  C12 timeline summary=', JSON.stringify({ operation: timeline.operation, revision: timeline.revision, tracks: timelineTracks.map((track) => ({ type: track.type, clips: track.clips?.length, clipTypes: (track.clips || []).map((clip) => clip.type) })) }))
  check(timeline.operation === 'read_timeline' && typeof timeline.revision === 'string', 'C12 nomi_timeline_read 返回真实时间轴修订号')
  const timelineArtifact = c9Artifacts.find((artifact) => artifact.kind === 'timeline')
  check(Boolean(timelineArtifact?.artifactId), 'C12 Run 产物包含持久时间轴编排')
  const timelineContentResult = await call(mcp, 'nomi_read', { target: 'artifact_content', projectId: c9ProjectId, runId: operationId, artifactId: timelineArtifact.artifactId })
  const timelineContent = timelineContentResult.structuredContent?.nomiOutcome || resultTextJson(timelineContentResult)
  check(timelineContent.artifactId === timelineArtifact.artifactId, 'C12 artifact_content 读回时间轴 artifact')
  const c9ProjectRoot = fs.readdirSync(dirs.projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirs.projectsDir, entry.name))
    .find((root) => {
      try { return JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8')).id === c9ProjectId } catch { return false }
    })
  assert.ok(c9ProjectRoot, 'C12 project root exists before timeline read')
  const timelineFile = JSON.parse(fs.readFileSync(path.join(c9ProjectRoot, timelineArtifact.projectRelativePath), 'utf8'))
  const arrangedClips = timelineFile.timelineContract?.clips || timelineFile.arrangement?.timelineContract?.clips || []
  console.log('  C12 persisted timeline=', JSON.stringify({ kind: timelineFile.kind, clips: arrangedClips.length, durationFrames: timelineFile.timelineContract?.durationFrames || timelineFile.arrangement?.timelineContract?.durationFrames }))
  check(Array.isArray(arrangedClips) && arrangedClips.length >= 4, 'C12 持久时间轴编排包含四个生成镜头')
  await win.getByText('预览', { exact: true }).click()
  await takeScreenshot(win, 'C12-timeline-before-export')

  const c9ReadyForExport = await call(mcp, 'nomi_read', { target: 'run', projectId: c9ProjectId, runId: operationId })
  const c9ReadyData = resultTextJson(c9ReadyForExport)
  const exportGate = (c9ReadyData.gates || resultData(c9ReadyForExport).gates || []).find((gate) => gate.scope === 'export' && gate.status === 'waiting')
  check(Boolean(exportGate?.gateId), 'C12 读到等待中的 export gate')
  const taskCenter = win.locator('[data-task-center-trigger="true"]')
  await taskCenter.click()
  const taskPanel = win.locator('[data-nomi-right-panel="tasks"]')
  const cardTexts = await taskPanel.locator('[data-production-task-card]').allTextContents()
  console.log('  C12 task cards=', JSON.stringify(cardTexts))
  // The task center keeps the last opened Run card mounted; select the semantic
  // Run row when another production Run currently owns that card.
  let productionCard = taskPanel.locator('[data-production-task-card]').filter({ hasText: /导出|成片|export/i }).first()
  if (await productionCard.count() === 0) {
    const semanticRunRow = taskPanel.getByText(/generation\.single-shot/).first()
    await semanticRunRow.waitFor({ timeout: 20_000 })
    await semanticRunRow.click()
    productionCard = taskPanel.locator('[data-production-task-card]').filter({ hasText: /导出|成片|export/i }).first()
  }
  await productionCard.waitFor({ timeout: 20_000 })
  await productionCard.locator('[data-production-primary-action]').click()
  const roughCutConfirm = win.locator('[data-confirm-dialog-confirm="true"]:visible').first()
  await roughCutConfirm.waitFor({ timeout: 20_000 })
  await roughCutConfirm.click()
  let reviewedStatus = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reviewed = await call(mcp, 'nomi_read', { target: 'run', projectId: c9ProjectId, runId: operationId })
    const reviewedData = resultTextJson(reviewed)
    reviewedStatus = String(reviewedData.status || resultData(reviewed).status || '')
    if (reviewedStatus === 'awaiting_export') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  check(reviewedStatus === 'awaiting_export', 'C12 粗剪审看确认后进入 awaiting_export')
  if (await taskPanel.isVisible().catch(() => false)) await win.locator('[data-task-center-trigger="true"]').click()
  await win.locator('[data-task-center-trigger="true"]').click()
  const exportPrimary = taskPanel.locator('[data-production-task-card] [data-production-primary-action]').first()
  await exportPrimary.waitFor({ timeout: 20_000 })
  await exportPrimary.click()
  const exportDialog = win.locator('.fixed.inset-0').filter({ hasText: /审看粗剪并批准导出/ }).last()
  await exportDialog.waitFor({ timeout: 20_000 })
  await takeScreenshot(win, 'C12-export-gate')
  await exportDialog.locator('button').last().click()
  await win.waitForTimeout(500)
  check(true, 'C12 export gate 经 Nomi 任务中心确认卡批准')

  let completedRun = c9RunData
  let completedStatus = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const observed = await call(mcp, 'nomi_read', { target: 'run', projectId: c9ProjectId, runId: operationId })
    completedRun = resultTextJson(observed)
    completedStatus = String(completedRun.status || resultData(observed).status || '')
    if (completedStatus === 'completed' || completedStatus === 'needs_attention') break
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  check(completedStatus === 'completed', 'C12 export driver 完成并回写 Run')
  const exportArtifact = (completedRun.artifacts || []).find((artifact) => artifact.kind === 'export')
  check(typeof exportArtifact?.projectRelativePath === 'string' && exportArtifact.projectRelativePath.startsWith('exports/'), 'C12 Run 产物带项目内 MP4 路径')
  const projectRoot = c9ProjectRoot
  const runDir = path.join(projectRoot, '.nomi', 'runs', operationId)
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
  const executionPath = path.join(runDir, 'export-execution.json')
  const execution = JSON.parse(fs.readFileSync(executionPath, 'utf8'))
  check(manifest.execution?.backend === execution.backend && Array.isArray(manifest.timeline?.tracks) && Object.keys(manifest.assets || {}).length > 0, 'C12 run manifest 与 export execution 的 tracks/assets/backend 对账')
  const ffmpegLogPath = path.join(runDir, 'ffmpeg.log')
  check(fs.existsSync(ffmpegLogPath) && fs.statSync(ffmpegLogPath).size >= 0, 'C12 manifest 对应 ffmpeg.log 已落盘')
  check(typeof execution.buildSha === 'string' && execution.buildSha.length > 0, 'C12 export-execution.json 落盘 buildSha')
  await mcp.terminate()
  mcp = null
  console.log(`MCP-L2 PASS: ${passed} assertions; mode=${mcpRuntime ? 'packaged' : 'development'}; artifacts=${artifactDir}`)
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
} finally {
  await declinedClient?.terminate().catch(() => undefined)
  await landedClient?.terminate().catch(() => undefined)
  await c9bClient?.terminate().catch(() => undefined)
  await c10Client?.terminate().catch(() => undefined)
  await mcp?.terminate().catch(() => undefined)
  await provider?.close().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
}
