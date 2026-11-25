// R16：真实 MCP stdio 客户端请求批量建节点。没有 elicitation 能力的客户端走 Nomi 窗口内的方案门。
// 真人确认前画布为空，确认后按回执中的身份读回三张镜头卡。全程不生成。
import path from 'node:path'
import os from 'node:os'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { switchGenerationView, switchWorkspace } from './_shell.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { uiText } from './full-walk/invariants.mjs'

const shotsDir = assertOutsideRepo(makeTempDir('nomi-plangate-evidence-'))
process.env.EVIDENCE_DIR = shotsDir
const dirs = makeIsolatedDirs('nomi-plangate-')
let passed = 0
function check(condition, label) {
  expect(condition, label).toBeTruthy()
  passed += 1
  console.log(`  ✓ ${label}`)
}

const run = await launchNomiApp({
  ...dirs,
  settingsDir: dirs.settingsDir,
  projectsDir: dirs.projectsDir,
  name: 'plan-gate',
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
  syntheticCredentialStorage: true,
})
const { win } = run
let client
try {
  client = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'plan-gate-walk', version: '1.0' },
    capabilities: {},
    env: { NOMI_APP_NAME: 'nomi' },
    syntheticCredentialStorage: true,
  })
  const init = await client.initialize()
  check(init?.result, 'stdio MCP 服务完成握手')

  const created = await client.callToolOrThrow('nomi_project_create', { name: '方案门走查' })
  const { id: projectId, projectSelectionHandle } = parseToolResult(created).json
  check(projectId && projectSelectionHandle, '建项目并取得项目选择句柄')
  await win.reload()
  await win.locator(`[data-project-card][data-project-id="${projectId}"]`).click()
  await switchWorkspace(win, 'generation')
  await switchGenerationView(win, 'canvas')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-app-ready.png') })

  const session = await client.callToolOrThrow('nomi_session_open', { projectSelectionHandle })
  const { leaseHandle } = parseToolResult(session).json
  check(leaseHandle, '为所选项目打开已验证的 MCP 租约')
  const nodes = win.locator('.generation-canvas-v2-node[data-node-id]')
  const emptyCanvas = win.locator('[data-empty-canvas-tasks="true"]')
  const emptyCanvasProof = await proveProbe(emptyCanvas, '隔离项目打开时画布为空')
  await expectAbsent(nodes, { provenBy: emptyCanvasProof })

  const add = client.callToolOrThrow('nomi_canvas_edit', {
    projectId,
    leaseHandle,
    operation: 'create_canvas_nodes',
    summary: '添加面馆方案的三张镜头卡',
    nodes: [
      { clientId: 'shop', kind: 'shot', title: 'S1 空店', prompt: '深夜面馆空荡的店面' },
      { clientId: 'table', kind: 'shot', title: 'S2 擦桌', prompt: '老陈擦拭木桌' },
      { clientId: 'curtain', kind: 'shot', title: 'S3 门帘', prompt: '门帘一挑，女儿进门' },
    ],
  }).then(result => ({ result }), error => ({ error }))

  const planCard = win.getByRole('dialog', { name: uiText('zh-CN', 'runtime.capability.planTitle'), exact: true })
  await Promise.race([
    expect(planCard).toBeVisible(),
    add.then(({ error }) => { throw error ?? new Error('MCP 在真人确认前已结束') }),
  ])
  await expectAbsent(nodes, { provenBy: emptyCanvasProof, message: '确认前画布没有新节点' })
  check(await planCard.isVisible(), 'MCP 批量落节点先弹出应用内方案门，画布仍为空')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-plan-gate-card.png') })
  await planCard.locator('[data-spend-confirm-action="confirm"]').click()
  const { result, error } = await add
  if (error) throw error
  const added = parseToolResult(result).json
  const ids = added.affectedNodeIds
  check(Array.isArray(ids) && new Set(ids).size === 3, '确认后 MCP 回执有三个不同的节点 ID')
  check(!added.cancelled, '确认路径 cancelled 未置位')
  await expect(nodes).toHaveCount(3)
  for (const id of ids) await expect(nodes.and(win.locator(`[data-node-id="${id}"]`))).toBeAttached()
  await screenshotSettled(win, { path: path.join(shotsDir, '03-after-confirm.png') })
  console.log(`PLAN-GATE PASS: ${passed}/${passed} 项断言`)
} finally {
  await client?.terminate()
  await run.close()
}
