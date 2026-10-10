#!/usr/bin/env node
// 真实用户任务 · **真花钱，最小量**（R13 四件真实：真应用 / 真画布输入 / 真供应商 / 真出图）——列表视图「生成全部」的逐项勾选。
//
//   NOMI_SPEND_OK=1 node tests/ux/generation-list-generate-all.paid.mjs [--rehearse] [--packaged <Nomi 可执行文件的绝对路径>]
//
// --rehearse：预演，零付费。同样过 _paidRun 入口的全部闸，走到确认卡、点掉一项、断言框翻转、勾着的数量是 1，
// 然后点「取消」，断言一笔都没发（节点无提交、收据二 0 条）就退出。花钱之前的每一步都在预演里走一遍。
//
// 要证的一件事：分区头「生成全部」弹出的确认卡上，勾掉一项之后，**框真的变成未勾**，并且被勾掉的那个节点
// 不开出价、不派发、没有供应商任务；确认卡上的数量、实际发出的数量、账本里的记录三者一致（都是 1）。
// 零额度夹具证得到「勾选状态怎么流」，证不到「真供应商上只收到一笔」——所以这一条花真钱，但只花一张最小图。
//
// 夹具最小：一个项目、一个画布分组、组里 2 个还没生成的图片节点——直接写进种子项目数据（不靠界面框选建组，
// 那一步与要验的东西无关）；模型沿用 canvas-spend-policy.paid.mjs 已验证的被授权那一个（隔离副本里只发布它一个图模型），
// 提示词一句话。凭据、出网名单、三道闸、两张收据全部来自 _paidRun.mjs 的统一入口；脚本自己不碰真实资料目录。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect, expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk, spendReceipt } from './_paidRun.mjs'
import { switchGenerationView } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'

const IMAGE = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }
const IMAGE_LANDS_MS = stationTimeout({ turns: 1 })
// 入口的参数解析只认 --packaged：预演开关先取走再交给入口。
const REHEARSE = process.argv.includes('--rehearse')
if (REHEARSE) process.argv.splice(process.argv.indexOf('--rehearse'), 1)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-10-08-generation-list-view/paid')
const CHECKBOXES = '[data-v4-block="plan-rows"] input[type="checkbox"]'

const paid = await openPaidWalk('generation-list-generate-all.paid.mjs', 'generation-list-generate-all', [IMAGE])
const { walk } = paid

// ── 种子项目：一个分组 + 2 个还没生成的图片节点（启动前写好；形状同 agent-timeline-ops.walk.mjs 的种法）──
const projectId = 'generation-list-generate-all'
const projectName = '列表生成全部（最小量）'
const projectRoot = path.join(walk.report.tempRoot, 'projects', projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const NODE_IDS = ['list-paid-a', 'list-paid-b']
const PROMPTS = ['清晨海边的灯塔', '雨后的石板小巷']
const seedNodes = NODE_IDS.map((id, index) => ({
  id, kind: 'image', title: '', prompt: PROMPTS[index], categoryId: 'shots', status: 'idle',
  position: { x: 80 + index * 420, y: 120 }, size: { width: 360, height: 203 },
  meta: { modelVendor: IMAGE.vendorKey, modelKey: IMAGE.modelKey },
}))
const seedGroup = { id: 'list-paid-group', name: '最小量一组', categoryId: 'shots', nodeIds: NODE_IDS, createdAt: 1, updatedAt: 1 }
const generationCanvas = { nodes: seedNodes, edges: [], selectedNodeIds: [], groups: [seedGroup] }
const workbenchDocument = { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const seedProject = {
  id: projectId, name: projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, workbenchDocument, timeline: null, generationCanvas,
  payload: { workbenchDocument, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(seedProject, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(seedProject, null, 2))
walk.report.projectId = projectId
walk.report.projectRoot = projectRoot
walk.report.rehearsal = REHEARSE

let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  // 从项目库打开种子项目（真人的走法）。
  const card = win.getByText(projectName, { exact: false }).first()
  await expect(card, '项目库里有种子项目').toBeVisible({ timeout: stationTimeout() })
  await card.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作|Continue/ }).first(), '打开种子项目')
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: stationTimeout() })
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()

  const nodesOnDisk = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  const nodeOnDisk = async (id) => (await nodesOnDisk()).find((node) => node.id === id)
  // 截图存两份：走查输出目录（留档）+ 仓库证据目录（给 PR 看）。
  const snapEvidence = async (label) => {
    const file = await walk.snap(label)
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.copyFileSync(file, path.join(evidenceDir, path.basename(file)))
    return file
  }

  // ① 花钱之前：种子节点落在被授权的模型上、都还没生成。
  for (const id of NODE_IDS) {
    const node = await nodeOnDisk(id)
    expect({ vendor: node?.meta?.modelVendor, model: node?.meta?.modelKey, runs: node?.runs?.length ?? 0, result: node?.result ?? null }, '花钱之前：节点在被授权的模型上、还没生成')
      .toEqual({ vendor: IMAGE.vendorKey, model: IMAGE.modelKey, runs: 0, result: null })
  }

  // ② 切到列表，点这一组的「生成全部」。
  await switchGenerationView(win, 'list')
  await expect(win.locator('[data-generation-list]'), '列表视图出现').toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator('[data-section-generate]'), '只有这一个分区有「生成全部」').toHaveCount(1)
  await clickOrFail(win.locator('[data-section-generate]').first(), '分区头「生成全部」')
  const dialog = win.locator(SPEND_DIALOG)
  const dialogProof = await proveProbe(dialog, '一下跑两份：弹确认卡')
  const boxes = win.locator(CHECKBOXES)
  expect(await boxes.count(), '确认卡上有 2 行').toBe(2)
  expect(await win.locator(`${CHECKBOXES}:checked`).count(), '两行都默认勾选').toBe(2)

  // ③ 点掉第 2 行：这一行的框必须真的变成未勾（以前行数据只传一次，点了会被弹回）。
  const secondLabel = (await boxes.nth(1).getAttribute('aria-label')) ?? ''
  await boxes.nth(1).click()
  expect(await boxes.nth(1).isChecked(), '点掉第 2 行之后，这一行的框是未勾').toBe(false)
  expect(await boxes.nth(0).isChecked(), '第 1 行仍是勾选').toBe(true)
  const cardCount = await win.locator(`${CHECKBOXES}:checked`).count()
  expect(cardCount, '确认卡上勾着的数量 = 1').toBe(1)
  await snapEvidence(REHEARSE ? 'rehearsal-confirm-card-after-untick' : 'confirm-card-after-untick')

  if (REHEARSE) {
    // 预演到此为止：点「取消」，一笔都不发。
    await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), '确认卡「取消」')
    await expectAbsent(dialog, { provenBy: dialogProof, message: '取消之后确认卡退场' })
    await waitForVisualQuiescence(win)
    for (const id of NODE_IDS) {
      const node = await nodeOnDisk(id)
      expect({ runs: node.runs?.length ?? 0, result: node.result ?? null, task: node.progress?.taskId ?? null }, `预演：取消 = 节点 ${id} 一笔都没发`).toEqual({ runs: 0, result: null, task: null })
    }
    const receipt = spendReceipt(projectRoot)
    expect(receipt.media.length, '预演：收据二里供应商任务数为 0').toBe(0)
    walk.report.rehearsalProviderRequests = receipt.media.length
    walk.report.verified = ['rehearsal-unticked-row-flips', 'rehearsal-checked-count-is-1', 'rehearsal-cancel-sends-nothing']
  } else {
    // ④ 确认：只有被勾着的那一个出任务。
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认卡「确认」', { noWaitAfter: true })
    const submitted = async () => (await nodesOnDisk()).filter((node) => NODE_IDS.includes(node.id) && (node.runs?.length ?? 0) > 0).map((node) => node.id)
    await expect.poll(async () => (await submitted()).length, { message: '被勾着的那个节点开始提交', timeout: stationTimeout() }).toBe(1)
    const [spentId] = await submitted()
    const skippedId = spentId === NODE_IDS[0] ? NODE_IDS[1] : NODE_IDS[0]
    // 确认卡第 1 行是 a（勾着）、第 2 行是 b（点掉）：归属读项目落盘的节点状态，不读收据条目的 nodeId（制作 Run 来源的条目没有它）。
    expect(spentId, '被勾着的是第 1 个节点 a').toBe(NODE_IDS[0])
    await snapEvidence('generating')

    await expect.poll(async () => (await nodeOnDisk(spentId))?.result?.url ?? '', { message: '被勾着的那个节点的真图落地', timeout: IMAGE_LANDS_MS }).toMatch(/^nomi-local:\/\//)
    await waitForVisualQuiescence(win)

    // ⑤ 对账：被点掉的节点、出图的节点、供应商任务数、三处数量。
    const spent = await nodeOnDisk(spentId)
    const skipped = await nodeOnDisk(skippedId)
    expect({ runs: skipped.runs?.length ?? 0, result: skipped.result ?? null, task: skipped.progress?.taskId ?? null }, '被点掉的节点：没有任务、没有结果').toEqual({ runs: 0, result: null, task: null })
    expect(['idle', undefined].includes(skipped.status), `被点掉的节点仍是「还没生成」（实际状态：${skipped.status}）`).toBe(true)
    expect(Boolean(spent.result?.url), '被勾着的节点有图').toBe(true)
    expect(spent.runs?.length, '被勾着的节点恰好一次提交').toBe(1)
    // 被勾掉的是确认卡第 2 行：行名能对上节点就记一笔（对不上不阻断，只进报告）。
    walk.report.untickedRowMatchedNode = Boolean(secondLabel) && [skipped.title, skipped.prompt].some((text) => typeof text === 'string' && text.length > 0 && (text.includes(secondLabel) || secondLabel.includes(text.slice(0, 4))))
    const receipt = spendReceipt(projectRoot)
    const tasks = receipt.media.filter((entry) => entry.taskId)
    expect(tasks.length, '供应商任务数恰好 1 个（收据二）').toBe(1)
    expect([tasks[0].runId, tasks[0].jobId].some((value) => String(value ?? '').includes(NODE_IDS[0])), `收据条目的 runId / jobId 里带着 a 的节点 id（实际：${tasks[0].runId} / ${tasks[0].jobId}）`).toBe(true)
    expect(receipt.media.length, '账本里的记录恰好 1 条').toBe(1)
    expect([cardCount, tasks.length, receipt.media.length], '确认卡上的数量 = 实际发出的数量 = 账本里的记录').toEqual([1, 1, 1])
    await snapEvidence('list-after-result')
    walk.report.verified = ['unticked-row-flips-in-the-card', 'unticked-node-no-task-no-result', 'one-provider-task', 'card-count-equals-dispatched-equals-ledger']
  }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
