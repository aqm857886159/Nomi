import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 删一条方案 = **一个手势 + 一条撤销路**（2026-09-21 用户：「有个删除 icon 就行，
// 一串名字作为按钮很蠢」）。这条走查像真人一样用鼠标做完整件事，不灌 store、不调 IPC。
//
// 三条腿，每一条都答「用户怎么知道它成了 / 没成」：
//   A 探头 + 点删除图标 → 行没了、底部出撤销条 → **点撤销** → 它回到**原来的位置**；
//   B 再删一次 → **不点撤销**，等到撤销条自己消失 → 它是真的没了（重开面板也不回来）；
//   C 行聚焦时按 Delete → 同样删得掉（键盘那条路）。
//
// 一条反向基线（没有它，「没发现确认弹窗」和「压根没删成」长得一模一样）：
// 删除全程**不许出现任何确认模态**——那正是这次要拿掉的东西。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { ensureCreationResourceTree } from './_creationResourceTree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = makeTempDir('nomi-plan-delete-')
const projectsDir = path.join(tempRoot, 'projects')
const settingsDir = path.join(tempRoot, 'settings')
const outDir = process.env.PLAN_DELETE_OUT || path.join(repoRoot, 'tests/ux/shots/creation-plan-delete-undo')
fs.mkdirSync(outDir, { recursive: true })

const plan = (title) => ({
  title, profileKey: 'genre.short-drama', anchors: [], scenes: [{ id: 's1', title: '第一场' }],
  shots: [{ index: 1, shotId: 'shot-1', sceneId: 's1', shotKind: 'image', durationSec: 3, anchorIds: [], prompt: `${title} 第 1 镜` }],
})
const design = (id, title) => ({
  id, documentId: 'doc-a', title, plan: plan(title),
  committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12,
})

const projectRoot = path.join(projectsDir, 'plan-delete')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const record = {
  id: 'plan-delete', name: '删方案', version: 2, createdAt: 1, updatedAt: 2, savedAt: 2, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    // 两篇原稿：第二篇**只为阳性对照存在**。项目只剩一篇原稿时「删除原稿」是禁用的
    //（title 写着「项目至少需要保留一篇原稿」），那样就立不出「确认框确实会弹」这条基线。
    workbenchDocuments: [{
      id: 'doc-a', version: 1, title: '影子罢工了', updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '影子在清晨罢工。' }] }] },
    }, {
      id: 'doc-b', version: 1, title: '夜风计划', updatedAt: 20,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜天台的对峙。' }] }] },
    }],
    activeDocumentId: 'doc-a',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    // 三条：要删的是**中间**那条，因为「撤销把它放回原位」只有在中间才证得出来
    //（放回队首或队尾时，插错位置和插对位置的结果可能是同一个数组）。
    storyboardDesignsByDocumentId: {
      'doc-a': [design('d-1', '方案一'), design('d-2', '方案二'), design('d-3', '方案三')],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(record, null, 2))
}

const failures = []
const consoleErrors = []
const measured = []

const { app, win } = await launchNomiApp({ name: 'creation-plan-delete-undo', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
win.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)) })
win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error?.message || error).slice(0, 300)}`))
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }

/** 侧栏里的方案标题，**按顺序**。撤销对不对全看这个序。 */
const planTitles = async () => win.locator('[data-storyboard-title="true"]').allTextContents()

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })

  const card = win.locator('[data-project-card]', { hasText: '删方案' }).first()
  await card.hover()
  const cont = card.getByText('继续创作', { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click()
  else await card.dblclick()
  await expectVisible(win.locator('[data-workspace-mode]'), '打开项目后工作台没起来')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '进创作页')
  await ensureCreationResourceTree(win, '创作页')

  const before = await planTitles()
  measured.push({ step: '开场', titles: before })
  if (before.length !== 3) failures.push(`开场侧栏应有 3 条方案，实际 ${before.length} 条：${before.join(' / ')}`)
  await snap('01-three-plans.png')

  /**
   * 「删方案不弹确认」这条断言需要一个**阳性对照**，否则它和「选择器写错了」
   * 在观测上一模一样（`expectAbsent` 强制要 `provenBy` 就是为了这个）。
   *
   * 对照用的是**删原稿**那条路——它这次没改，仍然走 `confirmDialog`。
   * 所以：同一个 `[role="dialog"]` 选择器，在原稿那条路上找得到（基线成立），
   * 在方案那条路上找不到（这次的改动）。开局先把这个基线做出来再取消掉。
   */
  await clickOrFail(win.locator('[data-document-row="doc-a"] [data-resource-menu-trigger="document"]'), '打开原稿行的 ⋮ 菜单（只为立阳性对照）')
  await clickOrFail(win.locator('[data-resource-action="delete"]'), '点原稿菜单里的删除')
  const dialogProof = await proveProbe(win.locator('[role="dialog"]'), '删原稿仍然会弹确认对话框')
  await clickOrFail(win.getByRole('button', { name: '取消', exact: false }).first(), '取消掉这次原稿删除——基线立完就撤，不动数据')
  await win.waitForTimeout(400)
  measured.push({ step: '阳性对照', dialogProbe: dialogProof.label })

  // ───────── 腿 A：hover 探头 → 点删除图标 → 撤销 ─────────
  const row = win.locator('[data-swipe-row="true"]').filter({ has: win.locator('[data-storyboard-row="d-2"]') }).first()
  await expectVisible(row, '找不到「方案二」那一行的手势壳')

  // 探头：hover 之前删除区是被行盖住的，hover 之后它露出来一截。**量位移**，
  // 不是量「按钮存在不存在」——按钮一直都在，用户能不能点到它靠的是行让开没让开。
  const closedX = await row.locator('[data-storyboard-row="d-2"]').evaluate((node) => node.getBoundingClientRect().x)
  await row.hover()
  await win.waitForTimeout(450)
  const peekedX = await row.locator('[data-storyboard-row="d-2"]').evaluate((node) => node.getBoundingClientRect().x)
  const nudge = Math.round(closedX - peekedX)
  measured.push({ step: 'hover 探头位移', nudge })
  if (nudge < 20) failures.push(`hover 时行只让开了 ${nudge}px——删除区没露出来，用户点不到它`)
  await snap('02-hover-peek.png')

  await clickOrFail(row.locator('[data-swipe-delete="true"]'), '点「方案二」行上的删除图标')

  // 反向基线：不许弹确认。这正是这次要拿掉的东西，所以它必须被断言，而不是「没看见」。
  await expectAbsent(win.locator('[role="dialog"]'), { provenBy: dialogProof, message: '点了删除却弹出了确认对话框——删除该是一个手势，不是一道题' })

  await win.waitForTimeout(900)
  const afterDelete = await planTitles()
  measured.push({ step: '删完', titles: afterDelete })
  if (afterDelete.length !== 2) failures.push(`删完应剩 2 条，实际 ${afterDelete.length} 条：${afterDelete.join(' / ')}`)
  if (afterDelete.some((title) => title.includes('方案二'))) failures.push('点了删除，「方案二」还在侧栏里')

  /**
   * 撤销那颗钮必须**按它所在的那条通知**去找，不能全局 `getByRole('撤销').first()`：
   * toast 走 portal 挂在 body 末尾，而界面别处也有叫「撤销」的钮（任务卡上就有一颗）。
   * 全局取 `.first()` 拿到的是 DOM 里更靠前的那一颗——点下去什么都不会发生，
   * 而截图里 toast 好端端地在，看起来就像「撤销坏了」。第一版我正是这么写的。
   */
  const undoToast = win.locator('[data-notification-reason="undo-operation"]')
  const undo = undoToast.getByRole('button', { name: '撤销', exact: false })
  await expectVisible(undoToast, '删完没有出现撤销——先做后撤的模型里，撤销条就是那条退路')
  const undoCount = await undo.count()
  measured.push({ step: '撤销钮', count: undoCount })
  if (undoCount !== 1) failures.push(`撤销那条通知里有 ${undoCount} 颗「撤销」钮，期望 1 颗`)
  await snap('03-deleted-with-undo.png')

  await clickOrFail(undo, '点撤销')
  await win.waitForTimeout(600)
  const afterUndo = await planTitles()
  measured.push({ step: '撤销后', titles: afterUndo })
  // **顺序**要一模一样：放回队尾的写法也能让它「回来」，但用户得重新找一遍。
  if (afterUndo.join('|') !== before.join('|')) {
    failures.push(`撤销后的顺序不对：期望 ${before.join(' / ')}，实际 ${afterUndo.join(' / ')}`)
  }
  await snap('04-after-undo.png')

  // ───────── 腿 B：再删一次，**不撤销**，等它到时真提交 ─────────
  const row2 = win.locator('[data-swipe-row="true"]').filter({ has: win.locator('[data-storyboard-row="d-2"]') }).first()
  await row2.hover()
  await win.waitForTimeout(400)
  await clickOrFail(row2.locator('[data-swipe-delete="true"]'), '再次点「方案二」的删除图标')
  await win.waitForTimeout(900)
  // 撤销条自己消失之后才算「真的提交了」。这里等的是它的存续时间（5s）+ 一点余量。
  const undoProof = await proveProbe(win.locator('[data-notification-reason="undo-operation"]'), '删完确实会出现一条撤销')
  await expectAbsent(win.locator('[data-notification-reason="undo-operation"]'), { provenBy: undoProof, message: '撤销条到点了还不走' }, stationTimeout({ operations: 2 }))
  const afterExpire = await planTitles()
  measured.push({ step: '到时提交', titles: afterExpire })
  if (afterExpire.length !== 2) failures.push(`没点撤销、等它到时之后应剩 2 条，实际 ${afterExpire.length} 条`)
  if (afterExpire.some((title) => title.includes('方案二'))) failures.push('撤销条过期后「方案二」又回来了——那不是删除，那是闪了一下')
  await snap('05-expired-committed.png')

  // ───────── 腿 C：键盘那条路（行聚焦 → Delete）─────────
  const row3 = win.locator('[data-swipe-row="true"]').filter({ has: win.locator('[data-storyboard-row="d-3"]') }).first()
  await row3.focus()
  await win.waitForTimeout(400)
  await row3.press('Delete')
  await win.waitForTimeout(900)
  const afterKey = await planTitles()
  measured.push({ step: '键盘删', titles: afterKey })
  if (afterKey.some((title) => title.includes('方案三'))) failures.push('行聚焦时按 Delete 没删掉——键盘那条路断了')
  await expectAbsent(win.locator('[role="dialog"]'), { provenBy: dialogProof, message: '键盘删也不许弹确认' })
  await snap('06-keyboard-delete.png')

  // ───────── ⋮ 菜单里的删除走的是同一条路（不留第二条）─────────
  const undo3 = win.locator('[data-notification-reason="undo-operation"]')
  if (!(await undo3.isVisible().catch(() => false))) {
    failures.push('键盘删之后没有撤销——⋮ 菜单、图标、键盘三个入口必须落到同一条删除+撤销路径上')
  }
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
} finally {
  await closeAppHard(app)
}

if (consoleErrors.length) failures.push(`控制台报错 ${consoleErrors.length} 条：${consoleErrors.slice(0, 3).join(' | ')}`)

const report = [
  '# creation · plan delete is a gesture with undo',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `shots: ${outDir}`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: hover nudges the row open, clicking the trash icon deletes with no confirm dialog, the undo pill restores it to its ORIGINAL position, letting the pill expire commits the delete for real, and Delete on the focused row takes the same path.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
