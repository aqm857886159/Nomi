#!/usr/bin/env node
// 真实付费核对 · 外部助手（MCP stdio）过门 → Nomi 真窗确认 → 一次出图（#1560 + #1574 + #1584）。**只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/external-agent-gate-confirm.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/external-agent-gate-confirm.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 只花**一张**图：外部 MCP 客户端通过真实 stdio 协议向当前 Nomi 窗口提交 `generation.single-shot`（apimart/gpt-image-2，1:1），
// 经 `nomi_operation_plan` → `nomi_operation_preview`（0 笔供应商请求）→ `nomi_operation_gate(request)` 弹出 Nomi 语义确认卡 → 用户点一次确认 → 恰好 1 次出图。
// 判据：
//   - plan / preview 阶段发往 api.apimart.ai 的创建请求 = 0；
//   - `nomi_operation_gate` 弹出确认卡且写明模型与提示词；
//   - 点确认后，发往 api.apimart.ai 的 POST /v1/images/generations 恰好 1 次，请求体带 `model: "gpt-image-2"` 与对应提示词；
//   - 真付费时：原 MCP 请求成功返回且产出持久 Artifact，无重复提交。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk } from './_paidRun.mjs'
import { parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { stationTimeout } from './_station-budget.mjs'

const SCRIPT = 'external-agent-gate-confirm.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-22-paid-five-entries/external-agent-gate-confirm')
const APIMART_HOST = 'api.apimart.ai'
const MODEL = { vendorKey: 'apimart', modelKey: 'gpt-image-2' }
const PROMPT = '一只纸船漂在清晨平静的湖面上，柔和暖光，胶片质感'
const LANDS_MS = stationTimeout({ turns: 4 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function proofFor(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

const paid = await openPaidWalk(SCRIPT, 'external-agent-gate-confirm', [MODEL], {
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: 1,
  buildMarkers: ['generation.single-shot'],
})
const { walk } = paid
const evidence = { script: SCRIPT, startedAt: new Date().toISOString(), model: `${MODEL.vendorKey}/${MODEL.modelKey}` }
let mcp
let failure
try {
  const started = await walk.start({ first: true })
  const { win } = started
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId } = await walk.newProject()
  evidence.projectId = projectId

  const token = fs.readFileSync(path.join(started.capabilityDir, 'token'), 'utf8').trim()
  mcp = spawnMcpStdioClient({
    settingsDir: started.settingsDir,
    userDataDir: started.userDataDir,
    projectsDir: started.projectsDir,
    capabilityDir: started.capabilityDir,
    clientInfo: { name: 'Paid external agent gate confirm', version: '1.0' },
    capabilities: {},
    env: {
      NOMI_MCP_CLIENT: 'codex',
      NOMI_MCP_CLIENT_PROOF: proofFor(token, 'codex'),
      ...(paid.rehearsal ? { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '' } : {}),
    },
  })
  const initResult = await mcp.initialize()
  expect(Boolean(initResult?.result), 'MCP stdio 与当前 Nomi 窗口握手成功').toBe(true)

  const opened = parseToolResult(await mcp.callTool('nomi_session_open', {
    bootstrap: { mode: 'current_project' },
  }))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  if (typeof leaseHandle !== 'string' || leaseHandle.length <= 20) {
    throw new Error(`session/open 未返回当前项目句柄：${JSON.stringify(opened).slice(0, 500)}`)
  }

  const ledgerBefore = paid.readAllowedRequests().length
  const candidate = {
    candidateId: 'paid-external-gate-candidate',
    revision: 1,
    moduleId: 'generation.single-shot',
    providerId: MODEL.vendorKey,
    modelId: MODEL.modelKey,
    mode: 'text_to_image',
    prompt: PROMPT,
    parameters: { aspectRatio: '1:1' },
    references: [],
  }
  const created = parseToolResult(await mcp.callTool('nomi_operation_plan', { leaseHandle, projectId, candidate }))
  if (created.isError) throw new Error(`nomi_operation_plan 失败：${JSON.stringify(created.json ?? created.text)}`)
  const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
  expect(typeof operationId === 'string' && operationId.length > 0, '创建语义单镜草稿成功').toBe(true)

  const preview = parseToolResult(await mcp.callTool('nomi_operation_preview', { leaseHandle, projectId, operationId }))
  if (preview.isError) throw new Error(`nomi_operation_preview 失败：${JSON.stringify(preview.json ?? preview.text)}`)
  const contract = preview.json?.contract ?? {}
  if (contract.providerId !== MODEL.vendorKey || contract.modelId !== MODEL.modelKey) {
    throw new Error(`预览目录对不上：实际 ${contract.providerId}/${contract.modelId}，应是 ${MODEL.vendorKey}/${MODEL.modelKey}`)
  }
  const preConfirmCreates = findImageCreates(paid.readAllowedRequests().slice(ledgerBefore)).length
  if (preConfirmCreates !== 0) throw new Error(`确认前就发出了 ${preConfirmCreates} 次创建请求`)
  evidence.operationId = operationId

  // 等项目首次持久化落稳后再过门，避免确认卡与开项目写盘竞态。
  await sleep(1000)
  const gatePromise = mcp.callTool('nomi_operation_gate', { phase: 'request', leaseHandle, projectId, operationId }, { timeoutMs: LANDS_MS })
  const gateCard = win.locator(SPEND_DIALOG).first()
  await expectVisible(gateCard, '外部助手过门弹出 Nomi 语义确认卡', stationTimeout({ operations: 2 }))
  const cardText = await gateCard.innerText()
  if (!cardText.includes(`${MODEL.vendorKey}/${MODEL.modelKey}`) || !cardText.includes('纸船')) {
    throw new Error(`确认卡缺少模型或提示词：${cardText.slice(0, 300)}`)
  }
  await walk.snap('before-confirm')
  await clickOrFail(gateCard.locator('[data-spend-confirm-action="confirm"]'), '确认卡主确认按钮', { noWaitAfter: true })

  if (paid.rehearsal) {
    const deadline = Date.now() + stationTimeout({ operations: 3 })
    while (findImageCreates(paid.readAllowedRequests().slice(ledgerBefore)).length === 0 && Date.now() < deadline) {
      await sleep(500)
    }
    evidence.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore))
    if (evidence.request.problems.length) throw new Error(`请求体判据没过：${evidence.request.problems.join('；')}`)
  } else {
    const gateRes = parseToolResult(await gatePromise)
    if (gateRes.isError) throw new Error(`确认后 MCP gate 返回错误：${JSON.stringify(gateRes.json ?? gateRes.text)}`)
    evidence.gateOutcome = gateRes.outcome ?? gateRes.json ?? null
    const deadline = Date.now() + LANDS_MS
    let reconciled = null
    const approved = gateRes.outcome?.approved || gateRes.json?.approved || {}
    const upgradedLease = typeof approved.leaseHandle === 'string' ? approved.leaseHandle : leaseHandle
    while (!reconciled && Date.now() < deadline) {
      const checkRes = parseToolResult(await mcp.callTool('nomi_operation_control', { action: 'reconcile', leaseHandle: upgradedLease, projectId, operationId, outcome: 'found' }, { timeoutMs: stationTimeout({ operations: 2 }) }))
      const artifactId = checkRes.outcome?.artifactId || checkRes.json?.artifactId || checkRes.json?.artifact?.artifactId || null
      if (!checkRes.isError && artifactId) reconciled = { artifactId, outcome: checkRes.outcome ?? checkRes.json }
      else await sleep(2000)
    }
    evidence.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore))
    evidence.reconciled = reconciled
    await walk.snap('after-confirm')
    const after = [
      ...evidence.request.problems,
      ...(reconciled?.artifactId ? [] : ['确认后未产出可持久化 Artifact']),
    ]
    if (after.length) throw new Error(`核对没过：${after.join('；')}`)
  }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await mcp?.terminate().catch(() => {})
  await paid.finish(failure)
  const report = {
    ...evidence,
    finishedAt: new Date().toISOString(),
    paidCalls: walk.report.paidCalls ?? null,
    spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })),
    result: failure ? 'failed' : 'passed',
    error: failure ? String(failure.message ?? failure).slice(0, 600) : null,
  }
  fs.writeFileSync(path.join(walk.report.outputDir, 'paid-summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (!paid.rehearsal) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
}

function findImageCreates(entries) {
  return entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/images\/generations$/.test(new URL(entry.url).pathname))
}

function judgeLedger(entries) {
  const creates = findImageCreates(entries)
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的图片创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到图片创建请求的请求体')
  else {
    if (body.model !== MODEL.modelKey) problems.push(`model 是 ${JSON.stringify(body.model)}，应是 ${MODEL.modelKey}`)
    if (!String(body.prompt ?? '').includes('纸船')) problems.push(`prompt 丢了原文：${JSON.stringify(body.prompt)}`)
  }
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null }
}
