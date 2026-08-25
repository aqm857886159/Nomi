// F3 + F16b 真 UI 走查：选区入口与合并后的单张确认卡。
// 这条走查只用本地文稿与 E2E spend bridge，不调用供应商；四路隔离目录由启动器统一注入。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-f3-f16b-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectRoot = path.join(projectsDir, 'f3-f16b-project')
const shotsDir = path.resolve('tests/ux/shots/f3-f16b')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const story = '林薇在雨夜的老码头被人追赶，她穿过积水的巷子，霓虹灯牌在水面上碎成一片。'
const project = {
  id: 'f3-f16b-project', name: 'F3 F16b 走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'F3 F16b', updatedAt: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: story }] }] } },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project))

const { app, win } = await launchNomiApp({ name: 'f3-f16b', userDataDir: path.join(root, 'user-data'), settingsDir, projectsDir, settleMs: 900 })
try {
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  const projectCard = win.locator('[data-project-card]', { hasText: 'F3 F16b 走查' }).first()
  await expectVisible(projectCard, 'F3/F16b 走查项目存在')
  await projectCard.dblclick()
  const creationNav = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creationNav, '创作入口可见')
  await creationNav.click()

  const editor = win.locator('.ProseMirror').first()
  await expectVisible(editor, '创作编辑器可见')
  await editor.evaluate((el) => {
    const textNode = el.firstChild?.firstChild
    if (!textNode) throw new Error('文稿文本节点不存在')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, Math.min(12, textNode.textContent?.length || 0))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })
  const popover = win.locator('[role="toolbar"][aria-label="选中文本工具"]')
  await expectVisible(popover, '选中文字后浮条出现')
  const splitButton = popover.getByRole('button', { name: '拆成镜头', exact: true })
  const splitProof = await proveProbe(splitButton, '选中浮条上的「拆成镜头」探针可测到')
  await expectVisible(splitButton, '选中浮条上「拆成镜头」可见')
  await clickOrFail(splitButton, '选中浮条「拆成镜头」')
  await expectVisible(win.getByText(/正在拆镜头|拆镜头/, { exact: false }).first(), '点击选区入口后进入同一拆镜流程')
  await win.screenshot({ path: path.join(shotsDir, '01-f3-selection-light.png') })

  // E2E bridge feeds the real SpendConfirmDialog/store, including the merged disclosure.
  await win.evaluate(() => {
    window.__nomiSpendRemembered = false
    window.__nomiSpendConfirmE2E({
      title: '开始生成',
      message: '将生成 1 张画面 · 预计约 1 分钟 · 会消耗模型额度',
      confirmLabel: '生成',
      cancelLabel: '取消',
      light: true,
      rememberHosting: true,
      hostingDisclosure: {
        message: '这次要用到参考图，需先上传到公共临时托管——素材会离开本机，链接短期有效，并存在隐私风险。配置 KIE 后可改用它（免费，且会优先使用）。',
        rememberLabel: '记住我的选择，以后不再问',
      },
    })
  })
  const hostingBlock = win.locator('[data-hosting-disclosure="true"]')
  const spendCard = win.locator('div.fixed.inset-0').filter({ has: hostingBlock }).first()
  const cardProof = await proveProbe(hostingBlock, '需要匿名托管时合并确认卡与披露块确实出现')
  await expectVisible(hostingBlock, '花钱卡内含完整公共托管披露')
  await expectVisible(win.getByText('记住我的选择，以后不再问', { exact: true }), '卡内含记住选择勾选')
  await win.screenshot({ path: path.join(shotsDir, '02-f16b-hosting-light.png') })
  await win.getByText('记住我的选择，以后不再问', { exact: true }).click()
  // 同一张卡切换暗色截图，避免为视觉对账再打开第二个 pending 请求。
  await win.evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
  await win.screenshot({ path: path.join(shotsDir, '03-f16b-hosting-dark.png') })
  await expectVisible(hostingBlock, '暗模式下同一张合并卡仍可见')
  await clickOrFail(spendCard.getByRole('button', { name: '生成', exact: true }), '合并确认卡「生成」')
  await expectAbsent(hostingBlock, { provenBy: cardProof, message: '确认后不应再弹第二张独立托管卡' })
  const remembered = await win.evaluate(() => window.__nomiSpendRemembered === true)
  if (!remembered) throw new Error('记住选择后 anonymousAssetHosting 没有写回 allow')
  console.log('✅ F3/F16b 走查通过（选区拆镜入口、单卡披露、无第二卡、记住=allow、光/暗截图）')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(root, { recursive: true, force: true })
}
