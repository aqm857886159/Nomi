// R13 走查：3D 场景全景图导入反馈可见性（2026-07-24 微信群用户「导入没反应」根治验证）。
// ① 非 2:1 图导入 → warning toast 必须画在全屏编辑器之上（elementFromPoint 遮挡探针 + 截图人眼）
//    + 场景背景真的变成全景 + 面板出现常驻「可能拉伸」提示；
// ② 移除后导入标准 2:1 图 → success toast 可见。
// 用法：pnpm run build && node scripts/scene3d-panorama-import-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.scene3d-panorama-lab')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const base = '/tmp/nomi-panorama-walk'
const projectsDir = path.join(base, 'projects')
const settingsDir = path.join(base, 'settings')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })

const nonStandardJpg = process.env.PANO_NONSTD || '/tmp/pano-nonstd.jpg'
const standardJpg = process.env.PANO_STD || '/tmp/pano-std.jpg'
for (const f of [nonStandardJpg, standardJpg]) {
  if (!fs.existsSync(f)) { console.error('缺测试图: ' + f + '（先用 ffmpeg 生成）'); process.exit(1) }
}

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

// 遮挡探针：toast 元素中心点 elementFromPoint 命中的节点必须还在 toast 自己内部——
// 证明反馈层真的画在全屏编辑器之上（DOM visible 证不了 z 层，栽过）。
async function assertToastOnTop(win, textSnippet, label) {
  const probe = await win.evaluate((snippet) => {
    const nodes = [...document.querySelectorAll('[class*="Notification"], [role="alert"]')]
    const target = nodes.find((n) => (n.textContent || '').includes(snippet))
    if (!target) return { found: false }
    const r = target.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { found: true, laidOut: false }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      found: true,
      laidOut: true,
      onTop: !!hit && (target.contains(hit) || hit.contains(target)),
      hitTag: hit ? hit.tagName + '.' + String(hit.className).slice(0, 60) : null,
    }
  }, textSnippet)
  if (!probe.found) fail(`${label}：toast 没出现（找不到含「${textSnippet}」的通知）`)
  else if (!probe.laidOut) fail(`${label}：toast 无布局`)
  else if (!probe.onTop) fail(`${label}：toast 被盖住了！中心点命中 ${probe.hitTag}`)
  else ok(`${label}：toast 在最顶层（elementFromPoint 命中自身）`)
  return probe.found && probe.onTop
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1', NOMI_PROJECTS_DIR: projectsDir, NOMI_SETTINGS_DIR: settingsDir },
})
try {
  const win = await app.firstWindow()
  const shot = async (name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    window.__nomiE2E = true
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.waitForTimeout(1500)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(1500)
  await win.locator('[aria-label="添加3D 场景节点"]').first().click()
  await win.waitForTimeout(1000)
  await win.locator('[aria-label="打开 3D 编辑器"]').first().click()
  await win.waitForTimeout(3000)
  for (let step = 1; step <= 5; step += 1) {
    await win.getByRole('button', { name: step < 5 ? '下一步' : '开始使用', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(350)
  }
  await win.getByRole('button', { name: '跳过', exact: true }).first().click({ timeout: 1500 }).catch(() => {})
  await win.waitForTimeout(500)

  // ── 属性面板 → 全景图分区滚到可见 ──
  const panoHeading = win.getByText('全景图', { exact: true }).last()
  await panoHeading.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => fail('属性面板里找不到「全景图」分区'))
  await shot('01-environment-panel-before-import.png')

  const fileInput = win.locator('input[type="file"][accept="image/*"]').last()

  // ── ① 非 2:1 图（2210×1005 ≈ 用户那张 2.2:1）：照常导入 + warning toast 可见 + 常驻拉伸提示 ──
  await fileInput.setInputFiles(nonStandardJpg)
  await win.waitForTimeout(900)
  await assertToastOnTop(win, '可能有拉伸', '非 2:1 warning')
  await shot('02-nonstandard-import-toast-visible.png')
  const hintCount = await win.getByText('非 2:1 标准全景图', { exact: false }).count()
  if (hintCount > 0) ok('面板出现常驻「可能拉伸」提示')
  else fail('面板没有常驻拉伸提示')
  await win.waitForTimeout(2500)
  await shot('03-nonstandard-panorama-applied.png')
  const applied = await win.getByText('pano-nonstd', { exact: false }).count()
  if (applied > 0) ok('非 2:1 图已导入（面板显示文件名，没被拒收）')
  else fail('非 2:1 图似乎没导入成功')

  // ── ② 移除 → 标准 2:1 图：success toast 可见 ──
  await win.locator('[title="移除全景图"]').first().click({ timeout: 3000 }).catch(() => fail('点不到移除全景图'))
  await win.waitForTimeout(600)
  await fileInput.setInputFiles(standardJpg)
  await win.waitForTimeout(1200)
  await assertToastOnTop(win, '全景图已导入', '标准 2:1 success')
  await shot('04-standard-import-success-toast.png')
  await win.waitForTimeout(2000)
  await shot('05-standard-panorama-applied.png')

  console.log('\n人眼终审素材:', outDir)
  console.log('  02 —— warning toast 必须清晰浮在全屏编辑器右上（这是根治的核心画面）')
  console.log('  03/05 —— 3D 场景背景必须真的变成测试图（彩条图案），不再是纯色')
  console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
} finally {
  await app.close().catch(() => {})
}
process.exit(failures === 0 ? 0 : 1)
