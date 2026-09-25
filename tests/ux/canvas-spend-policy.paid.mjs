#!/usr/bin/env node
// 真实用户任务 · **真花钱**（R13 四件真实：真应用 / 真画布输入 / 真供应商 / 真出图）——本版付费确认新规则的画布那一半。
//
//   NOMI_SPEND_OK=1 node tests/ux/canvas-spend-policy.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 2026-09-26 定稿的规则（唯一判据 `spendConfirmationRequirement`，src/workbench/generationCanvas/spend/spendConfirm.ts）：
// 用户自己点的**单个**生成不弹确认；一下跑 ≥2 份、Agent 发起、首次匿名托管才弹；确认框里**不再有价格行**。
// 零额度夹具证得到「判据怎么判」，证不到「真供应商上按一下 ↑ 就真出一张图、任务面板只记一笔」——所以这一条花真钱。
//
//   T1 单个图片节点按 ↑ → 全程**没有**确认框 → 供应商恰收一笔 → 任务面板恰一行 → 图落在这个节点上；
//   T2 再放两个节点，点「生成全部」→ 弹确认框、框里没有价格 → 先「取消」：一笔都不发 →
//      切成 English 再点一次 → 确认 → 两笔、两张图（A 那一笔不重跑）。
//
// 模型：APIMart 最便宜的图模型 z-image-turbo（隔离副本里只发布它一个图模型，节点默认就落在它上，花销可预期）。
// 凭据：真实资料目录里的 safeStorage 密文 + Windows 的 Local State，原样拷进隔离副本（_realProfile.mjs），
// 明文 key 从头到尾不落任何文件、不进报告、不回显；跑完凭据副本当场删除，原库指纹跑前跑后比对。
import { clickOrFail, expect, expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { PRICE_LINE, SPEND_DIALOG, openPaidWalk, watchSpendDialogs } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'

const IMAGE = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }
const GENERATE_ALL = '[data-storyboard-run-all="true"][data-batch-scope="all"]'
const NODE_GENERATE = '[data-composer-host="canvas"] [data-bar-segment="generate"]'
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
const TASK_PANEL = '[data-nomi-right-panel="tasks"]'
/** 一张真图的等待上限：走公共预算 owner，不自造墙钟（它是安全网，完成信号是落盘的 result.url）。 */
const IMAGE_LANDS_MS = stationTimeout({ turns: 1 })
const paid = await openPaidWalk('canvas-spend-policy.paid.mjs', 'canvas-spend-policy', [IMAGE])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()

  const nodesOnDisk = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  const nodeOnDisk = async (id) => (await nodesOnDisk()).find((node) => node.id === id)

  /** 像人一样加一个图片节点、写提示词；花钱前核对它落在被授权的那个模型上（不对就一分钱不花）。 */
  async function addImageNode(prompt) {
    const before = new Set((await nodesOnDisk()).map((node) => node.id))
    await clickOrFail(win.locator('[aria-label="添加图片节点"]').first(), '画布「添加图片节点」')
    const fresh = async () => (await nodesOnDisk()).find((node) => !before.has(node.id) && node.kind === 'image')?.id ?? null
    await expect.poll(fresh, { message: '新图片节点落盘', timeout: stationTimeout() }).not.toBeNull()
    const nodeId = await fresh()
    const editor = win.locator(`[data-node-id="${nodeId}"] div[contenteditable="true"]`).last()
    await clickOrFail(editor, '节点提示词输入框')
    await editor.fill(prompt)
    await expect.poll(async () => (await nodeOnDisk(nodeId))?.prompt ?? '', { message: '提示词落盘', timeout: stationTimeout() }).toContain(prompt.slice(0, 6))
    const meta = (await nodeOnDisk(nodeId)).meta ?? {}
    expect({ vendor: meta.modelVendor, model: meta.modelKey }, '花钱之前：新节点的模型就是被授权的 z-image-turbo').toEqual({ vendor: IMAGE.vendorKey, model: IMAGE.modelKey })
    return nodeId
  }

  async function expectNoPriceLine(dialog, label) {
    const text = await dialog.innerText()
    expect(PRICE_LINE.test(text), `${label}：确认框里不再有价格行（实际：${text.replace(/\s+/g, ' ')}）`).toBe(false)
    return text
  }

  // ═══ T1 · 单个节点按 ↑：不弹框、恰一笔、任务面板恰一行、图落在节点上 ═══
  const nodeA = await addImageNode('清晨的海边灯塔，薄雾，柔和的逆光，写实摄影')
  const t1Watch = await watchSpendDialogs(win, { selector: `[data-node-id="${nodeA}"]`, attribute: 'data-status' })
  await clickOrFail(win.locator(NODE_GENERATE).first(), '节点底栏的 ↑（生成）', { noWaitAfter: true })
  await expect.poll(async () => (await nodeOnDisk(nodeA))?.result?.url ?? '', { message: 'T1：真图落在这个节点上', timeout: IMAGE_LANDS_MS }).toMatch(/^nomi-local:\/\//)
  const t1Log = await t1Watch.read()
  expect(t1Log.liveness, 'T1：观察者活着（看见节点走过「生成中」）——否则「没弹框」不作数').toContain('running')
  expect(t1Log.dialogs, 'T1：单个节点按 ↑，全程一次确认框都没出现').toBe(0)
  const doneA = await nodeOnDisk(nodeA)
  expect(doneA.runs?.length, 'T1：这个节点恰好一次提交').toBe(1)
  expect(doneA.runs[0].status, 'T1：那一次提交成功').toBe('success')
  expect(Boolean(doneA.result?.taskId), 'T1：结果带着供应商任务号').toBe(true)
  const imageA = win.locator(`[data-node-id="${nodeA}"] img`).first()
  await expect.poll(() => imageA.evaluate((img) => img.complete && img.naturalWidth > 0), { message: 'T1：节点上的图真的解码出来了', timeout: stationTimeout() }).toBe(true)
  await clickOrFail(win.locator(TASK_TRIGGER), '打开任务面板')
  const panel = win.locator(TASK_PANEL)
  await proveProbe(panel.locator(`[data-task-node-id="${nodeA}"]`), 'T1：任务面板里有这一笔')
  await expect(panel.locator('[data-task-node-id]'), 'T1：任务面板里恰好一行生成任务').toHaveCount(1)
  await walk.snap('t1-zh-single-generate-no-dialog-one-task')
  await win.keyboard.press('Escape')

  // ═══ T2 · 两个节点「生成全部」：弹框、无价格行；取消一笔不发；确认两笔两张 ═══
  const nodeB = await addImageNode('雨后的石板小巷，路灯倒影，电影感')
  const nodeC = await addImageNode('雪山脚下的木屋，炊烟，蓝调时刻')
  const blank = await findCanvasBlankPoint(win)
  expect(Boolean(blank), '画布上找得到空白处（取消选择才会出现底栏「生成全部」）').toBe(true)
  await win.mouse.click(blank.x, blank.y)
  const generateAll = win.locator(GENERATE_ALL)
  await expect(generateAll, 'T2：「生成全部」只算还没生成的两个（A 已出图不算）').toContainText('2', { timeout: stationTimeout() })
  await clickOrFail(generateAll, '底栏「生成全部」')
  const dialog = win.locator(SPEND_DIALOG)
  const dialogProof = await proveProbe(dialog, 'T2：一下跑两份，弹确认框')
  const zhText = await expectNoPriceLine(dialog, 'T2（中文）')
  expect(zhText, 'T2：确认框说清一下要跑几份').toMatch(/2\s*(张|个|份)/)
  await walk.snap('t2-zh-generate-all-dialog-no-price')
  const tasksBeforeCancel = await nodesOnDisk()
  await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), '确认框「取消」')
  await expectAbsent(dialog, { provenBy: dialogProof, message: 'T2：取消之后确认框退场' })
  await waitForVisualQuiescence(win)
  for (const id of [nodeB, nodeC]) {
    const node = await nodeOnDisk(id)
    expect({ runs: node.runs?.length ?? 0, result: node.result ?? null, task: node.progress?.taskId ?? null }, `T2：取消 = 节点 ${id} 一笔都没发`)
      .toEqual({ runs: 0, result: null, task: null })
  }
  expect((await nodeOnDisk(nodeA)).runs, 'T2：取消也没碰 A').toEqual(tasksBeforeCancel.find((node) => node.id === nodeA).runs)

  // 真人切语言：设置 → 通用 → English（与 agent-spend-real-image.paid.mjs 同一走法），再点一次「生成全部」。
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」')
  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言分段控件「English」')
  await expect(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '界面已切到 English').toBeVisible()
  await clickOrFail(win.locator('[data-settings-close]'), '设置对话框「关闭」按钮')
  await win.mouse.click(blank.x, blank.y)
  await expect(generateAll, 'T2 (EN): Generate all still counts the two pending nodes').toContainText('2', { timeout: stationTimeout() })
  await clickOrFail(generateAll, 'Generate all (EN)')
  await proveProbe(dialog, 'T2 (EN): the confirmation dialog appears')
  await expectNoPriceLine(dialog, 'T2 (EN)')
  await walk.snap('t2-en-generate-all-dialog-no-price')
  await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), 'confirm (EN)', { noWaitAfter: true })
  for (const id of [nodeB, nodeC]) {
    await expect.poll(async () => (await nodeOnDisk(id))?.result?.url ?? '', { message: `T2：节点 ${id} 的真图落地`, timeout: IMAGE_LANDS_MS }).toMatch(/^nomi-local:\/\//)
  }
  const finalNodes = await nodesOnDisk()
  for (const id of [nodeA, nodeB, nodeC]) {
    const node = finalNodes.find((candidate) => candidate.id === id)
    expect(node.runs?.length, `节点 ${id} 恰好一次提交（确认两份 = 两笔；A 不重跑）`).toBe(1)
    expect(Boolean(node.result?.taskId), `节点 ${id} 的结果带着供应商任务号`).toBe(true)
  }
  const taskIds = new Set(finalNodes.map((node) => node.result?.taskId).filter(Boolean))
  expect(taskIds.size, '整场恰好三笔供应商任务（T1 一笔 + T2 两笔）').toBe(3)
  // 画布只渲染视口里的卡；像用户一样点「适应视图」把三张都收进来再看（程序不替用户挪画布）。
  await clickOrFail(win.getByRole('button', { name: /^(适应视图|Fit view)$/ }).first(), 'Fit view')
  await waitForVisualQuiescence(win)
  for (const id of [nodeA, nodeB, nodeC]) {
    const image = win.locator(`[data-node-id="${id}"] img`).first()
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0), { message: `节点 ${id} 的图真的解码出来了`, timeout: stationTimeout() }).toBe(true)
  }
  await walk.snap('t2-en-two-real-images-landed')
  walk.report.verified = ['t1-single-generate-no-dialog', 't1-one-provider-task-one-task-row', 't2-batch-dialog-without-price-line', 't2-cancel-spends-nothing', 't2-confirm-two-tasks-two-results']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
