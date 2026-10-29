// ⑭ 删项目进系统回收站：macOS 真机闭环「进废纸篓 → 还原 → 下次启动回项目库」，外加一条「进不了废纸篓」
// （项目所在目录不可写 → 卡片还在、说清原因、什么都没删）。一次性核对脚本，不进 CI。
// 用法：node <本文件> <截图输出目录>（先 pnpm build；只在 macOS 跑，其它系统直接退出）
// 结果：每条断言一行 JSON 打到标准输出，全过 exit 0；2026-10-23 的一次结果存在同目录上层的 mac-roundtrip-result.jsonl。
//
// 为什么用一个一次性的小磁盘映像当「项目所在的盘」：
//   · macOS 的 ~/.Trash 默认不让命令行进程读（Operation not permitted，需要「完全磁盘访问」），在那里既看不到
//     项目进没进废纸篓、也没法还原、更清不掉——会往用户真实的废纸篓里留测试垃圾。
//   · 外接盘 / 磁盘映像上的废纸篓是 <卷>/.Trashes/<uid>，同一个系统接口（NSFileManager trashItemAtURL，
//     Electron 的 shell.trashItem 就是它）、同样记「放回原处」信息，但脚本读得了、搬得动，用完把映像卸载删掉，
//     用户真实的废纸篓一个字节都不碰。
// 全程只动本脚本自己建的映像、隔离 profile 和里面的测试项目；产品的删除按钮走真实界面点击。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('SKIP real-trash-roundtrip: 只在 macOS 真机跑（磁盘映像卷上的废纸篓）。')
  process.exit(0)
}
// 走查启动器默认安装 quiet-walk：窗口开在屏幕外，不抢用户的焦点。

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fromRepo = (rel) => pathToFileURL(path.join(repo, rel)).href
const { launchNomiApp, closeNomiApp } = await import(fromRepo('tests/ux/_launchApp.mjs'))
const { expectVisible, expectHidden, clickOrFail } = await import(fromRepo('tests/ux/_assert.mjs'))
const { backToLibrary, newProjectEntry, setAppLanguage } = await import(fromRepo('tests/ux/_shell.mjs'))
const { makeTempDir, cleanupTestTemp } = await import(fromRepo('scripts/_test-temp.mjs'))

const out = process.argv[2]
if (!out) throw new Error('用法：node real-trash-roundtrip.mjs <截图输出目录>')
fs.mkdirSync(out, { recursive: true })

const results = []
const check = (label, ok, detail = '') => {
  results.push([label, Boolean(ok), detail])
  if (!ok) throw new Error(`断言不成立：${label}${detail ? `（${detail}）` : ''}`)
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })

const work = makeTempDir('nomi-trash-roundtrip-work-')
const volumeName = `NomiTrashRoundtrip-${process.pid}`
const mount = `/Volumes/${volumeName}`
const image = path.join(work, 'volume')
let attached = false
let launched = null
const profileRoot = makeTempDir('nomi-trash-roundtrip-profile-')
const projectsDir = path.join(mount, 'projects')
const trashDir = path.join(mount, '.Trashes', String(process.getuid()))
const binned = () => (fs.existsSync(trashDir) ? fs.readdirSync(trashDir).filter((name) => name !== '.DS_Store') : [])
const launch = (name) => launchNomiApp({
  name,
  tempRoot: profileRoot,
  projectsDir,
  settleMs: 800,
  initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})

try {
  // ── 0. 一次性的小磁盘映像当项目所在的盘（它自己的废纸篓）。
  run('hdiutil', ['create', '-size', '64m', '-fs', 'APFS', '-volname', volumeName, '-type', 'SPARSE', image])
  run('hdiutil', ['attach', '-nobrowse', '-owners', 'on', '-mountpoint', mount, `${image}.sparseimage`]) // owners on：目录权限位照常生效（2b 要用）
  attached = true
  fs.mkdirSync(projectsDir, { recursive: true })
  check('废纸篓一开始是空的（映像刚建）', binned().length === 0)

  // ── 1. 第一次启动：真界面建一个项目，里面放一个标记文件。
  launched = await launch('trash-roundtrip-1')
  let page = launched.win
  await page.waitForTimeout(1500)
  await clickOrFail(newProjectEntry(page), '新建项目')
  await expectVisible(page.locator('[data-workspace-mode]').first(), '没进工作区')
  await backToLibrary(page)
  let card = page.locator('[data-project-card="true"]').first()
  await expectVisible(card, '项目库里没有卡片')
  const projectId = await card.getAttribute('data-project-id')
  const folders = fs.readdirSync(projectsDir).filter((name) => !name.startsWith('.'))
  check('项目文件夹建在映像卷的默认项目根里', folders.length === 1, folders.join(','))
  const folder = path.join(projectsDir, folders[0])
  const token = `trash-roundtrip-${Date.now()}`
  fs.mkdirSync(path.join(folder, 'assets', 'imported'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'assets', 'imported', 'marker.txt'), token)

  // ── 2. 确认框（中 / 英）：写的是「废纸篓 / Trash」，取消不删。
  for (const locale of ['zh-CN', 'en']) {
    await setAppLanguage(page, locale)
    await card.hover()
    await clickOrFail(card.getByRole('button', { name: /删除项目|Delete project/ }).first(), `点删除按钮（${locale}）`)
    await page.waitForTimeout(500)
    const text = (await page.locator('[role="dialog"]').last().innerText()).replace(/\s+/g, ' ')
    results.push([`${locale} 确认框文字`, true, text])
    check(`${locale} 确认框按 macOS 叫法说「${locale === 'en' ? 'Trash' : '废纸篓'}」`, locale === 'en' ? /Trash/.test(text) && !/Recycle Bin/.test(text) : /废纸篓/.test(text) && !/回收站/.test(text), text)
    check(`${locale} 确认框不再说永久删除`, !/永久删除|permanently deleted/.test(text))
    await page.screenshot({ path: path.join(out, `mac-confirm-${locale}.png`) })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check(`${locale} 取消后卡片还在、文件夹还在`, (await card.isVisible()) && fs.existsSync(folder))
  }

  // ── 2b. 进不了废纸篓：把项目所在的目录设成不可写（系统没法把文件夹挪走），确认删除 → 卡片还在、卡片上说清原因、
  //        文件夹和素材原样、废纸篓里什么都没有。原因文字是系统原文（macOS 中文系统）经分类后的那句人话。
  await setAppLanguage(page, 'zh-CN')
  fs.chmodSync(projectsDir, 0o555)
  try {
    await card.hover()
    await clickOrFail(card.getByRole('button', { name: /删除项目/ }).first(), '点删除按钮（项目所在目录不可写）')
    await clickOrFail(page.locator('[data-confirm-dialog-confirm]').first(), '确认删除（项目所在目录不可写）')
    const refused = page.locator(`[data-project-card][data-project-id="${projectId}"] [role="alert"]`).first()
    await expectVisible(refused, '进不了废纸篓，卡片上却没说原因')
    const refusedText = (await refused.innerText()).replace(/\s+/g, ' ')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(out, 'mac-trash-refused-zh-CN.png') })
    check('进不了废纸篓：卡片上说「没有权限」并说明项目没有被删除', /没有权限/.test(refusedText) && /没有被删除/.test(refusedText), refusedText)
    check('进不了废纸篓：卡片还在、文件夹和素材原样', (await card.isVisible()) && fs.readFileSync(path.join(folder, 'assets', 'imported', 'marker.txt'), 'utf8') === token)
    check('进不了废纸篓：废纸篓里什么都没有', binned().length === 0)
  } finally {
    fs.chmodSync(projectsDir, 0o755)
  }

  // ── 3. 真删：确认「删除」→ 项目文件夹进废纸篓。
  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /删除项目/ }).first(), '点删除按钮')
  await clickOrFail(page.locator('[data-confirm-dialog-confirm]').first(), '确认删除')
  await expectVisible(page.locator('[data-toast-message]').first(), '删完没有提示')
  const toastText = (await page.locator('[data-toast-message]').first().innerText()).replace(/\s+/g, ' ')
  await page.waitForTimeout(900) // 等提示滑进来、确认框淡出，截图才完整
  await page.screenshot({ path: path.join(out, 'mac-after-delete-zh-CN.png') })
  await expectHidden(card, '删完卡片还在')
  check('提示说「已移到废纸篓」并交代还原和回库', /已移到废纸篓/.test(toastText) && /还原/.test(toastText) && /项目库/.test(toastText), toastText)
  check('原路径不在了', !fs.existsSync(folder))
  const inBin = binned()
  check('废纸篓里恰好有这个项目文件夹', inBin.length === 1 && inBin[0] === path.basename(folder), inBin.join(','))
  check('文件夹整个在里面、素材原样', fs.readFileSync(path.join(trashDir, inBin[0], 'assets', 'imported', 'marker.txt'), 'utf8') === token)
  check('系统记了「放回原处」信息（ptbL / ptbN）', ['ptbL', 'ptbN'].every((tag) => fs.readFileSync(path.join(trashDir, '.DS_Store')).includes(tag)))
  await page.reload()
  await page.waitForTimeout(1500)
  check('刷新后项目库里没有这个项目', (await page.locator(`[data-project-card][data-project-id="${projectId}"]`).count()) === 0)

  // ── 4. 从废纸篓还原（Finder 的「放回原处」就是把它搬回原位；这里直接搬）。
  fs.renameSync(path.join(trashDir, inBin[0]), folder)
  check('还原后文件夹回到原位、素材在', fs.readFileSync(path.join(folder, 'assets', 'imported', 'marker.txt'), 'utf8') === token)
  check('还原后废纸篓空了', binned().length === 0)
  await closeNomiApp(launched.app)
  launched = null

  // ── 5. 下次启动：项目回到项目库，能打开。
  launched = await launch('trash-roundtrip-2')
  page = launched.win
  await page.waitForTimeout(1500)
  card = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expectVisible(card, '重启后项目没有回到项目库')
  check('重启后同一个项目（同 id）回到项目库', (await card.count()) === 1)
  await page.screenshot({ path: path.join(out, 'mac-after-relaunch-zh-CN.png') })
  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作|Continue/ }).first(), '打开还原回来的项目')
  await expectVisible(page.locator('[data-workspace-mode]').first(), '还原回来的项目打不开')
  check('还原回来的项目能打开', true)
} catch (error) {
  results.push(['走查中断', false, String(error?.message || error)])
  await launched?.win?.screenshot({ path: path.join(out, 'mac-99-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  // 收尾：关 App、删隔离 profile（测试自己的 rm，不走产品删除）、卸载并删掉映像。废纸篓里不剩任何东西。
  if (launched) await launched.close().catch(() => undefined)
  else cleanupTestTemp(profileRoot)
  if (attached) {
    results.push(['收尾时映像卷的废纸篓里没有本走查的项目', binned().length === 0, binned().join(',')])
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { run('hdiutil', ['detach', ...(attempt >= 2 ? ['-force'] : []), mount]); attached = false; break } catch { await new Promise((resolve) => setTimeout(resolve, 1000)) }
    }
  }
  results.push(['映像已卸载', !attached, mount])
  cleanupTestTemp(work)
}
for (const [label, ok, detail] of results) console.log(JSON.stringify({ label, ok, detail }))
if (results.some(([, ok]) => !ok)) process.exitCode = 1
