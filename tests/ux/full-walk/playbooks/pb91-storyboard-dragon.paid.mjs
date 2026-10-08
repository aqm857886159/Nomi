#!/usr/bin/env node
// 剧本 PB91 · 付费 1 行 · 「分镜里写『巨龙』，真出图，结果是龙不是人」
//
// 2026-09-30 用户报：分镜里把图片提示词写成「巨龙」，生成出来的却是人物。根因是分镜行发出去的
// 不是行上写的那句（引用角色锚的身份特征被追加、定妆卡被连成参考图）。这条剧本用**真供应商**把同一行再走一遍：
// 方案里这一镜引用着一个带身份特征的角色锚，用户把提示词改写成「一条巨龙盘在山顶」，点行内生成。
//
// 只花 1 张最便宜的出图模型（APIMart Z-Image Turbo，一张）。护栏、凭据副本与收据全走 tests/ux/_paidRun.mjs
// （CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、用户 Nomi 开着拒跑、原库指纹跑前跑后比对、凭据副本用完即删）。
// 核对：
//   · 节点上存的提示词（= 发出去的提示词，同一个出口）逐字等于「一条巨龙盘在山顶」，没有任何追加；
//   · 供应商只收到这一笔；
//   · 出来的图由人眼看（截图落在证据目录）——机器判不了「是龙还是人」，这一条必须人眼看。
//
// 用法：NOMI_SPEND_OK=1 node tests/ux/full-walk/playbooks/pb91-storyboard-dragon.paid.mjs
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { openPaidWalk, spendReceipt } from '../../_paidRun.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { openStoryboardEditor } from '../../_creationResourceTree.mjs'

const SCRIPT = 'pb91-storyboard-dragon.paid.mjs'
const CHEAPEST = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }
const DESIGN = 'pb91-dragon'
const DRAGON = '一条巨龙盘在山顶'

const paid = await openPaidWalk(SCRIPT, 'full-walk-storyboard-dragon', [CHEAPEST])
const { walk } = paid
let failure
const findings = []
try {
  let { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  const { projectId, projectRoot } = await walk.newProject()
  await win.waitForFunction(() => typeof window.__nomiCapabilityApply === 'function', undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const read = () => win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
  const documentId = (await read()).payload.workbenchDocuments[0].id
  const plan = {
    title: '巨龙真出图',
    anchors: [{ id: 'hero', kind: 'character', name: '林薇', description: '短发，风衣，眼神冷', staticFeatures: '黑色齐肩短发、瓜子脸的年轻女子，左眉有一道浅疤', carrier: 'visual' }],
    shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: ['hero'], prompt: '林薇站在天台边缘，风衣被吹起', modelKey: CHEAPEST.modelKey, modelVendor: CHEAPEST.vendorKey }],
  }
  const saved = await win.evaluate(({ projectId, documentId, designId, plan }) => window.__nomiCapabilityApply('storyboard.upsert-design', { projectId, documentId, designId, plan }),
    { projectId, documentId, designId: DESIGN, plan })
  expect(saved, '方案落到左栏那份存储').toMatchObject({ status: 'saved', designId: DESIGN })

  // 像用户一样：创作页 → 点开方案 → 把第 1 镜的提示词改写成「巨龙」→ 点行内生成。
  await clickOrFail(win.locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
  await openStoryboardEditor(win, DESIGN, '侧栏选中分镜方案')
  const editor = win.locator('[data-storyboard-editor="true"]:visible')
  await expect(editor, '分镜编辑器出现').toBeVisible({ timeout: stationTimeout() })
  const box = editor.locator('[data-storyboard-row="1"] [data-storyboard-prompt-block] [contenteditable="true"]').first()
  await clickOrFail(box, '第 1 镜的提示词框')
  await win.keyboard.press('Control+A')
  await win.keyboard.type(DRAGON, { delay: 15 })
  await expect(box, '提示词框里就是刚打的那句').toHaveText(DRAGON)
  await walk.snap('dragon-row-before-generate')
  await clickOrFail(editor.locator('[data-storyboard-row="1"] [data-storyboard-generate-state]').first(), '第 1 镜行内的 ↑', { noWaitAfter: true })

  const nodes = async () => (await read()).payload.generationCanvas.nodes ?? []
  const nodeOf = async () => (await nodes()).find((node) => node.meta?.shotId === 'shot-1')
  await expect.poll(async () => (await nodeOf())?.status, { message: '这一镜落定（成功或失败）', timeout: stationTimeout({ operations: 12 }) }).toMatch(/^(success|error|recoverable)$/)
  const landed = await nodeOf()
  const receipt = spendReceipt(projectRoot)
  walk.report.dragon = { status: landed.status, error: landed.error ?? null, sentPrompt: landed.prompt, media: receipt.media }
  if (landed.prompt !== DRAGON) findings.push({ invariant: 3, rule: 'sent-prompt-unseen-addition', message: `节点上的提示词（发出去的那份）不是行上写的「${DRAGON}」：${JSON.stringify(landed.prompt)}` })
  if (receipt.media.length !== 1) findings.push({ invariant: 1, rule: 'exactly-one-submission', message: `供应商收到 ${receipt.media.length} 笔（应恰好 1 笔）` })
  const edgesIn = ((await read()).payload.generationCanvas.edges ?? []).filter((edge) => edge.target === landed.id).length
  if (edgesIn !== 0) findings.push({ invariant: 3, rule: 'sent-references', message: `这一镜被连了 ${edgesIn} 张行上没有的参考图` })
  // 出来的那张图在 App 关闭后随临时目录一起没了：当场拷进证据目录，人眼要看「是龙还是人」。
  const resultUrl = landed.result?.url
  const relative = typeof resultUrl === 'string' ? /^nomi-local:\/\/asset\/[^/]+\/(.+)$/.exec(resultUrl)?.[1] : null
  if (relative) {
    const source = path.join(projectRoot, ...decodeURIComponent(relative).split('/'))
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(walk.outputDir, 'dragon-result.png'))
  }
  await walk.snap('dragon-row-after-generate')
  walk.report.dragon.findings = findings
  fs.writeFileSync(path.join(walk.outputDir, 'full-walk-findings.json'), JSON.stringify(findings, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 2
} finally {
  await paid.finish(failure)
}
if (!failure && findings.some((finding) => finding.invariant)) process.exitCode = 1
