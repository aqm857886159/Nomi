// P4 S5 — 打开项目补齐 J3（真 Electron + 真渲染管线 + 真 store，零额度）。
//
// 证 reconcile 的**渲染半程**：materialize-shots 是「确认即落」与「打开项目补齐」共用的一个家（P1）。
// 补齐场景 = 载荷里带上已完成镜的 result（模拟「确认时项目没开、生成已跑完、现在打开项目补落 + 回填」）。
// 断言：补齐落节点+组+回填 result；**跑两次幂等**（不重复建节点/组、result 不叠加）；detach 后再补齐**不复活**。
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot } from './_mcpJourney.mjs'
import { clickOrFail } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/p4-s5-canvas-reconcile')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const RUN_ID = 'run-s5-reconcile'
const OP_ID = `canvas-landing:${RUN_ID}`

// 补齐载荷：2 镜，其中 shot-1 已完成（带本地 result）、shot-2 还没（无 result）。
function reconcilePayload(projectId) {
  return {
    projectId, runId: RUN_ID, materializationOperationId: OP_ID, planName: '恢复的批次',
    shots: [
      { shotId: 'shot-1', role: 'shot', kind: 'video', title: '镜头 1', prompt: '已完成镜', result: { id: 'production-job-shot-1', type: 'video', url: 'nomi-local://asset/p/shot-1.mp4', createdAt: Date.now() } },
      { shotId: 'shot-2', role: 'shot', kind: 'video', title: '镜头 2', prompt: '未完成镜' },
    ],
  }
}

let gui
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`S5 RECONCILE FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

try {
  gui = await launchNomiApp({ name: 'p4-s5-canvas-reconcile', args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'], settleMs: 0 })
  const win = gui.win

  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await clickOrFail(newProjectEntry(win), '库页「新建空白项目」')
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '工作区切换到「生成」')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: 15_000 })
  check(true, 'E2E 桥挂上')
  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1]).get('projectId'))

  // ── 第一次补齐：落 2 节点 + 组 + 回填 shot-1 的 result ──
  await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', payload)
  }, reconcilePayload(projectId))
  const first = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    const nodes = s.nodes.filter((n) => n.meta?.materializationOperationId === opId)
    const group = s.groups.find((g) => g.materializationOperationId === opId)
    const shot1 = nodes.find((n) => n.meta?.productionShotId === 'shot-1')
    return { nodeCount: nodes.length, groupMembers: group?.nodeIds?.length ?? 0, shot1HasResult: Boolean(shot1?.result?.url), shot1ResultId: shot1?.result?.id }
  }, OP_ID)
  check(first.nodeCount === 2, `补齐落 2 个节点（实得 ${first.nodeCount}）`)
  check(first.groupMembers === 2, `建组收 2 个节点（实得 ${first.groupMembers}）`)
  check(first.shot1HasResult, '已完成镜 shot-1 的 result 被回填（补齐带 result）')
  check(first.shot1ResultId === 'production-job-shot-1', 'shot-1 result id 正确')

  // ── 第二次补齐（幂等）：节点/组不重复，result 不叠加 ──
  await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', payload)
  }, reconcilePayload(projectId))
  const second = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    const nodes = s.nodes.filter((n) => n.meta?.materializationOperationId === opId)
    const groups = s.groups.filter((g) => g.materializationOperationId === opId)
    const shot1 = nodes.find((n) => n.meta?.productionShotId === 'shot-1')
    return { nodeCount: nodes.length, groupCount: groups.length, shot1HistoryLen: (shot1?.history || []).length }
  }, OP_ID)
  check(second.nodeCount === 2, `幂等：第二次补齐仍 2 个节点（实得 ${second.nodeCount}）`)
  check(second.groupCount === 1, `幂等：只 1 个分镜组（不重复建组，实得 ${second.groupCount}）`)
  check(second.shot1HistoryLen <= 1, `幂等：shot-1 result 不叠加历史（history≤1，实得 ${second.shot1HistoryLen}）`)

  await win.screenshot({ path: path.join(shotsDir, '01-reconciled.png') })

  // ── detach 后再补齐不复活：删 shot-2 节点 → 再补齐 → shot-2 不重建（撤销事实优先）──
  // 现行设计（concept-owners「制作镜头的节点还在不在画布上」）：Run 里记着 detached 的镜照样投进补齐载荷，
  // 但带 existingOnly——渲染层只许动画布上已有的节点，绝不新建。这里按主进程真实投影的形状发载荷，断言渲染层守住它。
  const shot2Id = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    const shot2 = s.nodes.find((n) => n.meta?.materializationOperationId === opId && n.meta?.productionShotId === 'shot-2')
    if (shot2) s.deleteNode(shot2.id)
    return shot2?.id ?? null
  }, OP_ID)
  check(Boolean(shot2Id), 'shot-2 节点删掉了（模拟用户删 / 撤销）')
  await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    payload.shots = payload.shots.map((shot) => (shot.shotId === 'shot-2' ? { ...shot, existingOnly: true } : shot))
    return window.__nomiCapabilityApply('production.materialize-shots', payload)
  }, reconcilePayload(projectId))
  const third = await win.evaluate(({ opId, removedId }) => {
    const s = window.__nomiCanvasStore.getState()
    const nodes = s.nodes.filter((n) => n.meta?.materializationOperationId === opId)
    const shot1 = nodes.find((n) => n.meta?.productionShotId === 'shot-1')
    return {
      shot2Count: nodes.filter((n) => n.meta?.productionShotId === 'shot-2').length,
      removedBack: s.nodes.some((n) => n.id === removedId),
      shot1ResultId: shot1?.result?.id,
      shot1HistoryLen: (shot1?.history || []).length,
    }
  }, { opId: OP_ID, removedId: shot2Id })
  check(third.shot2Count === 0 && !third.removedBack, `detached 的 shot-2 按 existingOnly 投影：不新建、不复活（实得 shot-2 节点 ${third.shot2Count} 个）`)
  check(third.shot1ResultId === 'production-job-shot-1' && third.shot1HistoryLen <= 1, `同一次补齐里 shot-1 照常、结果不叠加（history=${third.shot1HistoryLen}）`)

  const stat = fs.statSync(path.join(shotsDir, '01-reconciled.png'))
  check(stat.size > 0, `截图 01-reconciled.png 落地且非空（${stat.size} 字节）`)

  console.log(`\nS5 RECONCILE PASS: ${passed} 断言；补齐落节点+组+回填 result，跑两次幂等，provider=0。`)
  console.log('  截图 →', shotsDir)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
