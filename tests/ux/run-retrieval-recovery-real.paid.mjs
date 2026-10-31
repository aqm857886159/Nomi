#!/usr/bin/env node
// 真付费：最小档图片一笔。提交 → 关掉 App → 把这家的地址改到不通的端口（封锁取回）→ 重开，观察者第一次查询失败 →
// 点重新取回又失败 → 老项目的错误卡 → 改回地址重开 → 重新取回落地。POST=1：只有第一次提交花钱，之后都是免费查询。
// 先过零费用演练 run-retrieval-recovery-real.rehearsal.walk.mjs；产物里没有修复标记时入口拒跑。
import fs from 'node:fs'
import path from 'node:path'
import { ENV_KEY_VENDOR } from './_paidEnvKey.mjs'
import { openPaidWalk, spendReceipt } from './_paidRun.mjs'
import { RECOVERY_BUILD_MARKER, recoveryJourney } from './_runRetrievalRecoverySteps.mjs'

const SCRIPT = 'run-retrieval-recovery-real.paid.mjs'
const MODEL = { vendorKey: ENV_KEY_VENDOR, modelKey: process.env.NOMI_RETRIEVAL_RECOVERY_MODEL || 'gpt-image-2' }
const paid = await openPaidWalk(SCRIPT, 'run-retrieval-recovery-real', [MODEL], { buildMarkers: [RECOVERY_BUILD_MARKER] })
const { walk } = paid
const catalogFile = path.join(walk.settingsDir, 'model-catalog.json')
let failure
try {
  const first = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(first.win)
  const project = await walk.newProject()
  await walk.stopApp()
  let saved = null
  const reopen = async () => {
    const { win } = await walk.start()
    await win.locator('[data-project-card]', { hasText: project.name }).first().click()
    await win.locator('.generation-canvas-v2__stage').waitFor({ timeout: 60_000 })
    await win.waitForFunction(() => Boolean(window.__nomiCanvasStore))
    return win
  }
  const report = await recoveryJourney({
    locale: 'zh-CN',
    projectRoot: project.projectRoot,
    node: { kind: 'image', vendor: MODEL.vendorKey, modelKey: MODEL.modelKey, prompt: 'A small blue marble on a plain table' },
    open: reopen,
    close: () => walk.stopApp(),
    faultOn: async () => {
      saved = fs.readFileSync(catalogFile)
      const catalog = JSON.parse(saved)
      for (const vendor of catalog.vendors) if (vendor.key === MODEL.vendorKey) vendor.baseUrlHint = 'http://127.0.0.1:9'
      fs.writeFileSync(catalogFile, JSON.stringify(catalog))
    },
    faultOff: async () => {
      await walk.stopApp()
      fs.writeFileSync(catalogFile, saved)
      return reopen()
    },
    // 只有提交花钱：数账本里的媒体笔数。查询次数在演练里数，这里落地本身就证明查过。
    posts: () => spendReceipt(project.projectRoot).media.length,
    shot: async (name, locator) => { await locator.screenshot({ path: path.join(walk.outputDir, `${name}.png`) }) },
  })
  walk.report.numbers = report
  console.log('RUN_RETRIEVAL_RECOVERY_PAID', JSON.stringify(report))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
