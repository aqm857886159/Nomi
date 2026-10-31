#!/usr/bin/env node
// 真付费：最小档图片一笔。提交 → 关掉 App → 封锁这家的地址 → 重开，观察者第一次查询失败 →
// 点重新取回又失败 → 老项目的错误卡 → 解除封锁重开 → 重新取回落地。POST=1：只有第一次提交花钱，之后都是免费查询。
// 先过零费用演练 run-retrieval-recovery-real.rehearsal.walk.mjs（第三段就是这个断网）；产物里没有修复标记时入口拒跑。
// 模型选出图要等几十秒的那档：出图太快的话，App 还没关这一笔就落地了，没有东西可取回。换模型用 NOMI_RETRIEVAL_RECOVERY_MODEL。
import path from 'node:path'
import { ENV_KEY_VENDOR } from './_paidEnvKey.mjs'
import { openPaidWalk, spendReceipt } from './_paidRun.mjs'
import { collapseAgentPanel } from './_shell.mjs'
import { openCanvas } from './agent-runtime-walk-support.mjs'
import { RECOVERY_BUILD_MARKER, blockVendorOrigins, recoveryJourney, unblockVendorOrigins } from './_runRetrievalRecoverySteps.mjs'

const SCRIPT = 'run-retrieval-recovery-real.paid.mjs'
const MODEL = { vendorKey: ENV_KEY_VENDOR, modelKey: process.env.NOMI_RETRIEVAL_RECOVERY_MODEL || 'gpt-image-2' }
const paid = await openPaidWalk(SCRIPT, 'run-retrieval-recovery-real', [MODEL], { buildMarkers: [RECOVERY_BUILD_MARKER] })
const { walk } = paid
let failure
try {
  const first = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(first.win)
  const project = await walk.newProject()
  await walk.stopApp()
  const reopen = async () => {
    const { win } = await walk.start()
    // 画布 store 的走查桥只在这个开关下挂出来，进项目之前写上。
    await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
    await win.locator('[data-project-card]', { hasText: project.name }).first().click()
    await openCanvas(win)
    const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await consent.isVisible().catch(() => false)) await consent.click()
    await collapseAgentPanel(win)
    await win.waitForFunction(() => Boolean(window.__nomiCanvasStore))
    return win
  }
  const restartWith = async (between) => {
    await walk.stopApp()
    between()
    return reopen()
  }
  const apiOrigins = walk.report.networkAllowlist.filter(origin => /^https?:\/\//.test(origin))
  const { report } = await recoveryJourney({
    locale: 'zh-CN',
    scenario: 'restart',
    position: { x: 40, y: 40 },
    page: await reopen(),
    projectRoot: project.projectRoot,
    node: { kind: 'image', vendor: MODEL.vendorKey, modelKey: MODEL.modelKey, prompt: 'A small blue marble on a plain table' },
    interrupt: () => restartWith(() => blockVendorOrigins(apiOrigins)),
    faultOff: () => restartWith(unblockVendorOrigins),
    // 只有提交花钱：数账本里的媒体笔数。查询到不了供应商，夹具也不在，这里不数 GET；落地本身证明查过。
    posts: () => spendReceipt(project.projectRoot).media.length,
    shot: async (name, locator) => { await locator.screenshot({ path: path.join(walk.outputDir, `${name}.png`) }) },
  })
  walk.report.numbers = report
  console.log('RUN_RETRIEVAL_RECOVERY_PAID', JSON.stringify(report))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  unblockVendorOrigins()
  await paid.finish(failure)
}
