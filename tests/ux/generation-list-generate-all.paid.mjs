#!/usr/bin/env node
// 真实用户任务 · **真花钱，最小量**（R13 四件真实：真应用 / 真画布输入 / 真供应商 / 真出图）——列表视图「生成全部」的逐项勾选。
//
//   NOMI_SPEND_OK=1 node tests/ux/generation-list-generate-all.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 要证的一件事：分区头「生成全部」弹出的确认卡上，勾掉一项之后，**框真的变成未勾**，并且被勾掉的那个节点
// 不开出价、不派发、没有供应商任务；确认卡上的数量、实际发出的数量、账本里的记录三者一致（都是 1）。
// 零额度夹具证得到「勾选状态怎么流」，证不到「真供应商上只收到一笔」——所以这一条花真钱，但只花一张最小图。
//
// 夹具最小：一个项目、一个画布分组、组里 2 个还没生成的图片节点；模型沿用 canvas-spend-policy.paid.mjs 已验证的
// 被授权那一个（隔离副本里只发布它一个图模型），分辨率选候选里面积最小的，提示词一句话。
// 凭据、出网名单、三道闸、两张收据全部来自 _paidRun.mjs 的统一入口；脚本自己不碰真实资料目录。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { groupSelectedNodes } from './_groupGenerate.mjs'
import { SPEND_DIALOG, openPaidWalk, spendReceipt } from './_paidRun.mjs'
import { switchGenerationView } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'

const IMAGE = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }
const IMAGE_LANDS_MS = stationTimeout({ turns: 1 })
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-10-08-generation-list-view/paid')
const CHECKBOXES = '[data-v4-block="plan-rows"] input[type="checkbox"]'

const paid = await openPaidWalk('generation-list-generate-all.paid.mjs', 'generation-list-generate-all', [IMAGE])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
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

  // 打开生成框的参数面板，在候选里挑面积最小的那一个（解析不出候选就保持默认，并记进报告）。
  async function pickSmallestSize(nodeId) {
    const summary = win.locator('[data-composer-host="canvas"] [data-parameter-summary]').first()
    await clickOrFail(summary, '生成框「生成参数」')
    const options = win.getByRole('option')
    const texts = await options.allInnerTexts()
    const area = (text) => {
      const match = text.match(/(\d+)\s*[×x]\s*(\d+)/i)
      return match ? Number(match[1]) * Number(match[2]) : Infinity
    }
    const best = texts.map((text, index) => ({ index, size: area(text) })).filter((entry) => Number.isFinite(entry.size)).sort((a, b) => a.size - b.size)[0]
    if (best) await clickOrFail(options.nth(best.index), `最小分辨率（${texts[best.index].trim()}）`)
    else (walk.report.sizeNotes ??= []).push(`${nodeId}：参数面板里没有可解析的分辨率候选，保持默认`)
    await win.keyboard.press('Escape')
  }

  // 像人一样加一个图片节点、写一句提示词、把分辨率调到最小；花钱前核对它落在被授权的模型上（不对就一分钱不花）。
  async function addImageNode(prompt) {
    const before = new Set((await nodesOnDisk()).map((node) => node.id))
    await clickOrFail(win.locator('[aria-label="添加图片节点"]').first(), '画布「添加图片节点」')
    const fresh = async () => (await nodesOnDisk()).find((node) => !before.has(node.id) && node.kind === 'image')?.id ?? null
    await expect.poll(fresh, { message: '新图片节点落盘', timeout: stationTimeout() }).not.toBeNull()
    const nodeId = await fresh()
    const editor = win.locator(`[data-node-id="${nodeId}"] div[contenteditable="true"]`).last()
    await clickOrFail(editor, '节点提示词输入框')
    await editor.fill(prompt)
    await expect.poll(async () => (await nodeOnDisk(nodeId))?.prompt ?? '', { message: '提示词落盘', timeout: stationTimeout() }).toContain(prompt.slice(0, 4))
    await pickSmallestSize(nodeId)
    const meta = (await nodeOnDisk(nodeId)).meta ?? {}
    expect({ vendor: meta.modelVendor, model: meta.modelKey }, '花钱之前：新节点的模型就是被授权的那一个').toEqual({ vendor: IMAGE.vendorKey, model: IMAGE.modelKey })
    return nodeId
  }

  // ① 夹具：2 个还没生成的图片节点，编成一组。
  const nodeA = await addImageNode('清晨海边的灯塔')
  const nodeB = await addImageNode('雨后的石板小巷')
  const blank = await findCanvasBlankPoint(win)
  expect(Boolean(blank), '画布上找得到空白处').toBe(true)
  await win.mouse.click(blank.x, blank.y)
  await clickOrFail(win.locator(`.react-flow__node[data-id="${nodeA}"]`), '选中节点 A')
  await clickOrFail(win.locator(`.react-flow__node[data-id="${nodeB}"]`), 'Shift 加选节点 B', { modifiers: ['Shift'] })
  await groupSelectedNodes(win)

  // ② 切到列表，点这一组的「生成全部」。
  await switchGenerationView(win, 'list')
  await expect(win.locator('[data-generation-list]'), '列表视图出现').toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator('[data-section-generate]'), '只有这一个分区有「生成全部」').toHaveCount(1)
  await clickOrFail(win.locator('[data-section-generate]').first(), '分区头「生成全部」')
  const dialog = win.locator(SPEND_DIALOG)
  await proveProbe(dialog, '一下跑两份：弹确认卡')
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
  await snapEvidence('confirm-card-after-untick')

  // ④ 确认：只有被勾着的那一个出任务。
  await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认卡「确认」', { noWaitAfter: true })
  const submitted = async () => (await nodesOnDisk()).filter((node) => [nodeA, nodeB].includes(node.id) && (node.runs?.length ?? 0) > 0).map((node) => node.id)
  await expect.poll(async () => (await submitted()).length, { message: '被勾着的那个节点开始提交', timeout: stationTimeout() }).toBe(1)
  const [spentId] = await submitted()
  const skippedId = spentId === nodeA ? nodeB : nodeA
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
  expect(tasks[0].nodeId, '这一个任务属于被勾着的那个节点').toBe(spentId)
  expect(receipt.media.length, '账本里的记录恰好 1 条').toBe(1)
  expect([cardCount, tasks.length, receipt.media.length], '确认卡上的数量 = 实际发出的数量 = 账本里的记录').toEqual([1, 1, 1])
  await snapEvidence('list-after-result')
  walk.report.verified = ['unticked-row-flips-in-the-card', 'unticked-node-no-task-no-result', 'one-provider-task', 'card-count-equals-dispatched-equals-ledger']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
