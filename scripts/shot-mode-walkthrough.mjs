// R13 真机走查：小说片段 → 拆镜头(默认图片分镜) → 方案编辑器 → 落画布 → 真生成一张 →
// 转视频 → 整理画布。截图人眼判断。用法：NOMI_WALK_FOREGROUND_OK=1 node scripts/shot-mode-walkthrough.mjs
// （真实资料起，装不了安静仪表、窗口会到前台；没带放行变量就不起 App、按 125 跳过）
import { exitIfWalkSkipped, launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.shot-mode-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const STORY = '叶林握紧了口袋里那张皱巴巴的缴费单。深夜的便利店里只有他一个店员，白炽灯把货架照得惨白。玻璃门外，一个穿深色西装的中年男人站在雨里，隔着玻璃朝他微笑。叶林认得那张脸——三天前在地下诊所走廊里见过。男人推门进来，把一份文件放在收银台上："考虑得怎么样？一个肾，够你妹妹两年的药钱。"'

// isolate:false：本脚本今天就跑在真实 profile 上（真 key / 真项目库），隔离会让它「跑得起来但结果全错」。
const { app, win } = await launchNomiApp({
  name: 'shot-mode',
  isolate: false,
  settleMs: 1800,
  foreground: '真实资料真生成走查（真 key / 真项目库）',
}).catch(exitIfWalkSkipped)
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  // 新建空白项目（避免残留节点污染判定）
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  // 创作区：写故事进文稿
  const editor = win.locator('[aria-label="创作文档编辑区"]')
  await editor.first().waitFor({ timeout: 10000 })
  await editor.first().click()
  await editor.first().fill(STORY).catch(async () => {
    // contenteditable fallback
    await win.keyboard.insertText(STORY)
  })
  await win.waitForTimeout(600)

  // 展开创作助手（若收着）
  const expand = win.locator('[aria-label="展开创作助手"]')
  if ((await expand.count()) > 0) { await expand.first().click(); await win.waitForTimeout(600) }

  // 发「拆镜头」→ 动作卡
  const input = win.locator('[aria-label="创作 AI 输入"]')
  await input.first().waitFor({ timeout: 8000 })
  await input.first().fill('拆镜头')
  await win.locator('[aria-label="创作 AI 发送"]').first().click()
  const card = win.locator('[data-action-card="storyboard"]')
  await card.first().waitFor({ timeout: 15000 })
  await win.waitForTimeout(400)
  await shot(win, '01-action-card-default-image.png') // 验：开关存在、默认「图片分镜」高亮

  // 点拆成镜头（默认 image 模式）→ 等真 LLM 出方案编辑器
  await win.locator('[data-action-run="storyboard"]').first().click()
  console.log('  ⏳ 等 planner 拆镜头（真 LLM）…')
  const confirmBtn = win.getByRole('button', { name: '确认落画布', exact: false })
  await confirmBtn.first().waitFor({ timeout: 180000 })
  await win.waitForTimeout(800)
  await shot(win, '02-plan-editor-image-shots.png') // 验：镜卡「类型 图片」、无时长

  // 确认落画布
  await confirmBtn.first().click()
  console.log('  ⏳ 落画布…')
  await win.waitForTimeout(4000)
  await shot(win, '03-canvas-image-shots.png') // 验：图片镜头节点 + 占位卡带「镜头 N」

  // 选第一个镜头节点 → 真生成一张图（额度默认授权）
  const firstShotNode = win.locator('[data-kind="image"][data-node-id]').filter({ hasText: '镜头' }).first()
  const anyImageNode = (await firstShotNode.count()) ? firstShotNode : win.locator('[data-kind="image"][data-node-id]').first()
  await anyImageNode.click({ position: { x: 40, y: 40 } })
  await win.waitForTimeout(1200)
  await shot(win, '04-node-selected-composer.png')
  // composer 的生成按钮（选中节点浮出）
  let generated = false
  for (const label of ['生成', '开始生成']) {
    const btn = win.getByRole('button', { name: label, exact: true })
    if ((await btn.count()) > 0) {
      await btn.first().click().catch(() => {})
      generated = true
      break
    }
  }
  if (generated) {
    console.log('  ⏳ 真生成一张图（≤240s）…')
    // 等该节点出图：img 出现在节点里
    const deadline = Date.now() + 240000
    let ok = false
    while (Date.now() < deadline) {
      const imgs = await win.locator('[data-kind="image"] img').count().catch(() => 0)
      if (imgs > 0) { ok = true; break }
      await win.waitForTimeout(3000)
    }
    console.log(ok ? '  ✓ 出图了' : '  ⚠️ 240s 内没出图（可能没接图片模型/额度）——继续走查其余步骤')
    await win.waitForTimeout(1000)
    await shot(win, '05-generated-with-badge.png') // 验：生成后「镜头 N」角标常显
    if (ok) {
      // hover 出「转视频」按钮 → 点
      const node = win.locator('[data-kind="image"] img').first()
      await node.hover()
      await win.waitForTimeout(600)
      await shot(win, '06-convert-button-visible.png')
      const convert = win.locator('[data-convert-shot-to-video]')
      if ((await convert.count()) > 0) {
        await convert.first().click()
        await win.waitForTimeout(1500)
        await shot(win, '07-video-node-derived.png') // 验：派生视频节点 + 同镜号 + 连线
      } else {
        console.log('  ⚠️ 转视频按钮没找到')
      }
    }
  } else {
    console.log('  ⚠️ 没找到生成按钮——截图记录现场')
    await shot(win, '05-no-generate-button.png')
  }

  // 整理画布
  const tidy = win.locator('[aria-label="整理画布"]')
  if ((await tidy.count()) > 0) {
    await tidy.first().click()
    await win.waitForTimeout(1500)
    await shot(win, '08-tidy-result.png') // 验：按镜号归位
  }

  console.log('\n=== 页面错误(' + errors.length + ') ===')
  for (const e of errors.slice(0, 8)) console.log('  ✗ ' + e.slice(0, 200))
} finally {
  await app.close().catch(() => {})
}
