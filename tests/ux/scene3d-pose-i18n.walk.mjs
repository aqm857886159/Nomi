// 真机走查（R13）：3D 人偶**姿势面板的英文界面**。
//
// 盯的是 2026-09-01 修掉的那个 bug：面板文案原本硬编码在 scene3dConstants 的 title/label 上，
// 词典里 40 条 scene3d.inspector.pose* 译文齐备却零引用 —— 英文界面整片姿势面板显示中文。
// 数据层已由 scene3dPoseI18n.test.ts 钉住（每个 key 解析得出、英文侧无汉字）；
// 这里补机器测不出的那半：**英文字串比中文长得多**，标签列原本是固定 42px 栅格，
// "Forward lean" 实测要 46px —— 断词换行、预设按钮 h-8 直接被文字撑破。
// 这类只有真机截图 + 量 DOM 才看得见，故单独一条走查。
//
// 零额度：纯本地 3D 渲染，不碰任何生成 API。隔离 userData + 项目目录，不污染真实数据。
// 用法：pnpm run build && node tests/ux/scene3d-pose-i18n.walk.mjs
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'

const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-pose-i18n-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

// 用 --lang 在**首启**就把 i18n 初始化成英文（不 reload —— 原地刷新会打断项目会话、面板静默空掉）。
const { app, win } = await launchNomiApp({
  name: 'scene3d-pose-i18n',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  args: ['--lang=en-US'],
  env: { NOMI_E2E_SMOKE: '1', NOMI_TEST_SYSTEM_LOCALE: '1' },
  settleMs: 1800,
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))

  await win.keyboard.press('Escape').catch(() => {})
  const card = win.locator('[data-project-card]').first()
  if (await card.count()) await clickOrFail(card, '项目卡')
  else await clickOrFail(win.getByText('New blank project', { exact: false }).first(), '新建空白项目')

  // 等真实信号,不拿长 sleep 当「打开完了」——真实耗时会变,sleep 不够长就读到空 → 假绿。
  const genTab = win.getByRole('button', { name: 'Generate', exact: false }).first()
  await expectVisible(genTab, '项目打开后应出现「Generate」页签', 30_000)
  await win.keyboard.press('Escape').catch(() => {})
  await clickOrFail(genTab, 'Generate 页签')

  // 节点菜单里的 3D 场景（英文 "3D Scene"）。锚点写死到真实文案，不用模糊兜底——
  // 兜底会点中隔壁的「3D 模型」节点，后面每一步跟着假红（scene3d-pose-click 就栽过）。
  const sceneNode = win.getByRole('button', { name: '3D Scene', exact: false }).first()
  await expectVisible(sceneNode, '生成画布应有「3D Scene」节点菜单项', 20_000)
  await clickOrFail(sceneNode, '3D Scene 节点')

  const openEditor = win.getByRole('button', { name: 'Open 3D editor', exact: false }).first()
  await expectVisible(openEditor, '3D 节点空态应有「Open 3D editor」', 20_000)
  await clickOrFail(openEditor, 'Open 3D editor')

  const editor = win.locator('[aria-label="3D 场景编辑器"], [aria-label="3D scene editor"]').first()
  await expectVisible(editor, '英文界面下 3D 编辑器应打开', 30_000)
  check('英文界面能打开 3D 编辑器', true)

  // 选中假人 → 姿势 tab。对象行按**英文默认名**点：默认名不再落盘，
  // 空名由 scene3dObjectNames 在显示时按「类型 + 序号」现算，英文界面就是 Character A。
  const mannequinRow = win.getByRole('button', { name: 'Character A', exact: true }).first()
  await expectVisible(mannequinRow, '场景对象列表应有英文默认名「Character A」', 20_000)
  await clickOrFail(mannequinRow, 'Character A 行')

  const poseTab = win.getByRole('button', { name: 'Pose', exact: true }).first()
  await expectVisible(poseTab, '选中假人后应出现「Pose」页签', 20_000)
  await clickOrFail(poseTab, 'Pose 页签')

  const presets = win.getByText('Pose presets', { exact: false }).first()
  await expectVisible(presets, '姿势面板应有英文「Pose presets」标题', 20_000)
  check('姿势预设区标题是英文「Pose presets」', true)

  await screenshotSettled(win, { path: path.join(outDir, 'pose-i18n-en-panel.png') })

  // ── 量 DOM：这两条是截图之外、人眼容易放过的 ──
  // ① **姿势面板这一片**不该残留汉字（这正是当年的 bug）。范围锁到「Pose presets」所在的属性面板。
  //    （左侧对象树的默认名 2026-09-02 起也已本地化，见 scene3dObjectNames；这里仍只量属性面板，
  //     对象树另有 scene3dObjectNames.test.ts 从数据层钉住。）
  const panelHan = await win.evaluate(() => {
    const anchor = [...document.querySelectorAll('div')].find((el) => el.textContent?.trim() === 'Pose presets')
    const panel = anchor?.closest('.grid')?.parentElement ?? anchor?.parentElement?.parentElement
    if (!panel) return ['<找不到姿势面板容器>']
    const texts = []
    for (const el of panel.querySelectorAll('span, div, button')) {
      if (el.children.length > 0) continue
      const text = (el.textContent ?? '').trim()
      if (text && /[一-鿿]/.test(text)) texts.push(text)
    }
    return [...new Set(texts)]
  })
  if (panelHan.length > 0) throw new Error(`英文界面姿势面板仍有中文：${panelHan.slice(0, 8).join(' / ')}`)
  check('英文界面下姿势面板无残留中文', true)

  // ② 标签列/预设按钮不该被文字撑破:scrollWidth 超出 clientWidth = 放不下(英文比中文长得多)。
  const overflow = await win.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('label > span:first-child')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`标签 ${(el.textContent ?? '').trim()}(${el.scrollWidth}>${el.clientWidth})`)
    }
    for (const el of document.querySelectorAll('button')) {
      const text = (el.textContent ?? '').trim()
      if (!text || el.children.length > 0) continue
      if (el.scrollHeight > el.clientHeight + 1) out.push(`按钮 ${text}(高 ${el.scrollHeight}>${el.clientHeight})`)
    }
    return out
  })
  if (overflow.length > 0) throw new Error(`英文文案撑破控件：${overflow.slice(0, 10).join(' / ')}`)
  check('姿势控件标签/预设按钮未被英文撑破', true)

  if (errors.length > 0) throw new Error(`页面级 JS 错误：${errors.slice(0, 2).join(' / ')}`)
  check('无页面级 JS 错误', true)
} catch (error) {
  check('走查跑完', false, String(error).split('\n')[0])
  await screenshotSettled(win, { path: path.join(outDir, 'pose-i18n-FAIL.png') }).catch(() => {})
} finally {
  console.log('\n═══ 结果 ═══')
  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  await app.close().catch(() => {})
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} 项未通过`)
    process.exit(1)
  }
  console.log('\n全部通过')
}
