// R16 真实旅程 · MCP lease 绑的项目 ≠ Nomi 里打开的项目
//
// 复现的是 docs/qa/2026-09-06-agent-mcp-restart-real-user-pass.md §2.5 报的那件事：外部宿主用
// nomi_project_create 自己建了项目 P、拿到绑 P 的 lease，然后 nomi_export_job / nomi_media_query
// 回 `project_scope_required: an active project is required`——因为渲染层适配器读的是「人正好在
// Nomi 里打开着的那个项目」，把主进程 lease 校验后递过来的 projectId 丢了。
//
// 真实性：真 Electron GUI（打开项目 Q）+ 真 MCP stdio 进程（lease 绑项目 P），走真 loopback RPC →
// 真渲染层适配器。全程零额度、不碰 provider。GUI **始终停在 Q**，直到第 6 段才按错误提示打开 P
// ——那一段是在证「我们给的下一步真的走得通」，不是一句没人能满足的话。
//
// 两个面分别验（根因合同 docs/fixes/2026-09-06-mcp-lease-project-binding.root-cause.json）：
//   · 可寻址面（nomi_media_query / nomi_export_job）——按 lease 的 projectId 直接寻址，GUI 开着谁都无关。
//   · 实时面（nomi_timeline_read / nomi_timeline_edit）——真相在打开的那个项目的 store 里，
//     所以拒，但错误必须点名两个项目 + 给下一步。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { assertBuilt, makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'

assertBuilt()
const dirs = makeIsolatedDirs('nomi-mcp-lease-binding-')
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const fixturePng = path.join(dirs.tempRoot, 'lease-fixture.png')
fs.writeFileSync(fixturePng, PNG_BYTES)

let gui
let mcp
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`MCP LEASE BINDING FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}
const proofFor = (token, client) =>
  crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')

const json = (result) => {
  const parsed = parseToolResult(result)
  return { ...parsed, data: parsed.json || parsed.outcome || {} }
}
const errorTextOf = (result) => {
  const parsed = parseToolResult(result)
  return `${parsed.text || ''} ${JSON.stringify(parsed.json || {})} ${JSON.stringify(result?.content || [])}`
}

function editPlan(baseRevision) {
  return {
    planId: 'lease-binding-plan',
    baseRevision,
    summary: '在时间轴开头加一条字幕',
    operations: [{
      kind: 'text', action: 'add', id: 'lease-binding-caption',
      text: '外部宿主写的字幕', style: 'caption', startFrame: 0, endFrame: 24,
    }],
  }
}

try {
  // ── 1 · 真 GUI 打开项目 Q（人正在编辑的那个） ─────────────────────────────────────────
  gui = await launchNomiApp({
    name: 'mcp-lease-project-binding',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    // capabilityDir 必须走**选项**：buildNomiLaunchEnv 把 NOMI_CAPABILITY_DIR 放在 extraEnv 之后，
    // 从 env 传会被启动器自己那份覆盖掉，MCP 客户端和 app 于是各读各的 token（ENOENT）。
    capabilityDir: dirs.capabilityDir,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    settleMs: 0,
  })
  const win = gui.win
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 15_000 })
  const openProjectId = await win.evaluate(
    () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'),
  )
  check(Boolean(openProjectId), `Nomi 窗口打开着项目 Q（${openProjectId}）`)

  // ── 2 · 外部宿主自己建项目 P 并拿到绑 P 的 lease ─────────────────────────────────────
  const token = fs.readFileSync(path.join(dirs.capabilityDir, 'token'), 'utf8').trim()
  mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'Claude Code lease binding', version: 'e2e' },
    env: { NOMI_MCP_CLIENT: 'claude', NOMI_MCP_CLIENT_PROOF: proofFor(token, 'claude') },
  })
  check(Boolean((await mcp.initialize())?.result), 'MCP stdio 与这个开着的 GUI 建立真实握手')

  const created = json(await mcp.callTool('nomi_project_create', { name: 'MCP 自己建的项目 P' }))
  const leaseProjectId = created.data.id
  const projectSelectionHandle = created.data.projectSelectionHandle
  check(Boolean(leaseProjectId && projectSelectionHandle), `宿主自己建了项目 P（${leaseProjectId}）`)
  check(leaseProjectId !== openProjectId, 'P 不是 Nomi 正打开的那个项目——这正是复现条件')

  const opened = json(await mcp.callTool('nomi_session_open', { projectSelectionHandle }))
  const leaseHandle = opened.data.leaseHandle
  const scope = opened.data.effectiveScope || []
  check(typeof leaseHandle === 'string' && leaseHandle.length > 20, 'session/open 返回绑 P 的 lease')
  check(['asset:read', 'export:read', 'timeline:read', 'timeline:write'].every((item) => scope.includes(item)),
    `lease 带齐本轮四个面的 scope（${scope.join(',')}）`)

  const stillOpen = await win.evaluate(
    () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'),
  )
  check(stillOpen === openProjectId, 'lease 签发没有动过人正在看的窗口，GUI 仍停在 Q')

  // ── 3 · 可寻址面：素材库按 lease 的项目寻址（旧代码在这里 project_scope_required） ─────
  const imported = json(await mcp.callTool('nomi_asset_import', { projectId: leaseProjectId, path: fixturePng }))
  check(!imported.isError, '素材导入进 P（不是 Q）')

  const media = await mcp.callTool('nomi_media_query', { leaseHandle, operation: 'list', limit: 10 })
  const mediaText = errorTextOf(media)
  check(!media.isError, `nomi_media_query 不再报 project_scope_required（GUI 开着 Q）：${mediaText.slice(0, 120)}`)
  const mediaData = json(media).data
  check(Number(mediaData.total) === 1, 'GUI 开着 Q，媒体查询返回的却是 P 的素材——身份来自 lease，不是 GUI')

  // ── 4 · 可寻址面：导出作业按 lease 的项目寻址 ────────────────────────────────────────
  const exportJob = await mcp.callTool('nomi_export_job', {
    leaseHandle, operation: 'status', jobId: 'lease-binding-missing-job',
  })
  const exportText = errorTextOf(exportJob)
  check(!exportText.includes('project_scope_required'),
    `nomi_export_job 过了项目闸，剩下的是作业级答复：${exportText.slice(0, 120)}`)

  // ── 5 · 实时面：拒，但错误得可行动 ──────────────────────────────────────────────────
  for (const [label, args] of [
    ['nomi_timeline_read', { leaseHandle, operation: 'read' }],
    ['nomi_timeline_edit', { leaseHandle, operation: 'preview', plan: editPlan('unknown-revision') }],
  ]) {
    const result = await mcp.callTool(label, args)
    const text = errorTextOf(result)
    check(result.isError === true, `${label} 在 P 没打开时失败（而不是悄悄改了 Q）`)
    check(text.includes(leaseProjectId) && text.includes(openProjectId),
      `${label} 的错误点名了 lease 绑的 P 和现在打开的 Q`)
    check(!text.includes('project_scope_required'), `${label} 不再返回没有下一步的 project_scope_required`)
  }

  // ── 6 · 我们给的下一步真的走得通：按提示在 Nomi 里打开 P，同一条 lease 立刻能编辑 ────
  await win.evaluate((id) => { window.location.hash = `#/studio?projectId=${id}` }, leaseProjectId)
  await win.waitForFunction((id) => window.location.hash.includes(`projectId=${id}`), leaseProjectId, { timeout: 15_000 })
  await win.waitForTimeout(1_500)

  const read = await mcp.callTool('nomi_timeline_read', { leaseHandle, operation: 'read' })
  check(!read.isError, '按错误里的下一步打开 P 之后，同一条 lease 读得到时间轴')
  const baseRevision = json(read).data.revision || json(read).data.timelineRevision
  check(typeof baseRevision === 'string' && baseRevision.length > 0, `拿到时间轴 revision（${baseRevision}）`)

  const preview = await mcp.callTool('nomi_timeline_edit', { leaseHandle, operation: 'preview', plan: editPlan(baseRevision) })
  check(!preview.isError, '提案（preview）在 P 上跑通')

  const applied = await mcp.callTool('nomi_timeline_edit', {
    leaseHandle, operation: 'apply', plan: editPlan(baseRevision),
  }, { timeoutMs: 60_000 })
  const appliedText = errorTextOf(applied)
  check(!applied.isError, `apply 落地（真人确认走 elicitation 自动同意）：${appliedText.slice(0, 120)}`)
  check(mcp.elicitationCount() >= 1, 'apply 之前确实向客户端要过一次真人确认')

  const afterExport = await mcp.callTool('nomi_export_job', {
    leaseHandle, operation: 'status', jobId: 'lease-binding-missing-job',
  })
  check(!errorTextOf(afterExport).includes('project_scope_required'), '导出面在 P 打开后仍然只答作业级问题')

  console.log(`\nMCP LEASE BINDING PASS: ${passed} assertions; 真 GUI + 真 stdio，零额度。`)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await mcp?.terminate().catch(() => undefined)
  await gui?.close?.().catch(() => undefined)
  process.exit(exitCode)
}
