// 真实旅程：保存失败 → 导出诊断包 → 包里的日志说得出「为什么」（2026-09-24 Windows 用户反馈的那个缺口）。
//
// 那天用户看到「项目保存失败，请检查本地磁盘权限」，发来的诊断包里却只有主进程日志——真因
// （`WorkspaceManifestLockBusyError`）只进了渲染层 console，打包版里没人接。单测钉的是「owner → 日志文件」；
// 这里钉的是**真 Electron 里整条路**：界面上一次真的保存失败 → 渲染层上报 → IPC → 主进程落盘 →
// 设置里点「导出诊断包」→ 盘上那个 zip 的 `logs/nomi-<日期>.log` 里有那一行，且不带项目名 / 本机路径。
//
// 怎么让保存真的失败：复现用户那天的真因——项目的 manifest 锁被「另一台机器上的进程」占着
// （`.nomi/manifest-transaction.lock/owner.json`，host 不是本机 → 主进程一律按忙处理）。
// 生产代码一行没为走查留口子；原生保存对话框在主进程侧打桩（同 diagnostics-bundle.walk.mjs）。
//
// 界面上那句话也在这里验：锁被占时是「项目正被别处占用」，不再把人支去查磁盘权限。
//
// 用法：pnpm run build && node tests/ux/renderer-failure-diagnostics.walk.mjs [zh-CN|en]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const LOCALE = process.argv[2] === 'en' ? 'en' : 'zh-CN'
const UI = LOCALE === 'en'
  ? { newProject: /^New blank project/, document: 'Creation document editor', inUse: 'This project is in use elsewhere', settings: 'Settings', general: 'General', exportBundle: 'Export bundle' }
  : { newProject: /^新建空白项目/, document: '创作文档编辑区', inUse: '项目正被别处占用', settings: '设置', general: '通用', exportBundle: '导出诊断' }
const DOCUMENT = `[aria-label="${UI.document}"] .tiptap[contenteditable="true"]`
const shotsDir = path.join(repoRoot, 'tests/ux/shots/renderer-failure-diagnostics', LOCALE)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-renderer-failure-walk-'))
const targetZip = path.join(outDir, 'bundle.zip')

const failures = []
function check(ok, label, detail = '') {
  if (ok) console.log(`  ✓ ${label}`)
  else { console.error(`  ✖ ${label} ${detail}`); failures.push(`${label} ${detail}`) }
}

const launched = await launchNomiApp({
  name: 'renderer-failure-diagnostics',
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})
const { app } = launched
let win = launched.win
let lockDir = null
try {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, targetZip)

  // ── 1. 像用户一样：项目库 → 新建空白项目 → 落在创作页 ─────────────────────────
  await clickOrFail(win.getByRole('button', { name: UI.newProject }), '新建空白项目')
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 2 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  await expectVisible(win.locator(DOCUMENT), '创作文档编辑区', stationTimeout({ operations: 2 }))
  const url = new URL(win.url())
  const projectId = url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  const project = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find((item) => item.id === projectId)
  check(Boolean(project?.rootPath), '新项目落在隔离项目目录', JSON.stringify(project))
  const projectFolderName = path.basename(project.rootPath)

  // ── 2. 复现真因：manifest 锁被另一台机器上的进程占着 ─────────────────────────
  lockDir = path.join(project.rootPath, '.nomi', 'manifest-transaction.lock')
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
    schemaVersion: 1, ownerId: 'walkthrough-foreign-owner', nonce: 'walkthrough-nonce', host: 'walkthrough-other-host',
    pid: 424242, processStartedAtMs: Date.now() - 60_000, createdAtMs: Date.now(),
  }))

  // ── 3. 真编辑 → 自动保存 → 失败提示出现在界面上 ──────────────────────────────
  // 三格预算：自动保存的防抖 + 主进程按「锁忙」重试到放弃（约 5s）+ 回到界面。
  await win.locator(DOCUMENT).click()
  await win.keyboard.type('雨夜里一只猫回头看镜头')
  await expectVisible(win.getByText(UI.inUse, { exact: true }).first(), `界面上的保存失败提示「${UI.inUse}」`, stationTimeout({ operations: 3 }))
  await screenshotSettled(win, { path: path.join(shotsDir, '01-save-failed.png') })

  // 占锁撤掉：后面导出诊断包、退出都不该再被它拖住。
  fs.rmSync(lockDir, { recursive: true, force: true })
  lockDir = null

  // ── 4. 设置 → 通用 → 导出诊断包（真按钮，主进程真组包） ─────────────────────────
  await clickOrFail(win.getByRole('button', { name: UI.settings, exact: true }).first(), '设置')
  await clickOrFail(win.getByRole('button', { name: UI.general, exact: true }), '通用')
  const section = win.locator('[data-settings-section="diagnostics"]')
  await expectVisible(section, '导出诊断包区块')
  await section.scrollIntoViewIfNeeded()
  await clickOrFail(section.getByRole('button', { name: UI.exportBundle, exact: true }), '导出诊断')
  await expect.poll(() => section.getAttribute('data-diagnostics-state'), { timeout: stationTimeout({ operations: 2 }) }).toBe('saved')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-bundle-saved.png') })

  // ── 5. 打开 zip：日志里有没有那一行 ─────────────────────────────────────────
  const files = unzipSync(new Uint8Array(fs.readFileSync(targetZip)))
  const dailyLog = Object.keys(files).find((name) => /^logs\/nomi-\d{4}-\d{2}-\d{2}\.log$/.test(name))
  check(Boolean(dailyLog), '包里有当天的运行日志', Object.keys(files).join(', '))
  const lines = strFromU8(files[dailyLog] ?? new Uint8Array()).split('\n')
  const saveLines = lines.filter((line) => /\bERROR renderer\s+project-save-failed\b/.test(line))
  check(saveLines.length >= 1, '日志里有渲染层上报的 project-save-failed', `（共 ${lines.length} 行）`)
  check(saveLines.some((line) => /Workspace manifest|WorkspaceManifestLock/.test(line)), '那一行带着真因（manifest 锁忙）', saveLines.join(' || '))
  check(saveLines.every((line) => line.includes('trigger=')), '那一行说得出是哪条保存路径触发的', saveLines.join(' || '))
  for (const leaked of [projectFolderName, os.userInfo().username, '雨夜里一只猫']) {
    check(saveLines.every((line) => !line.includes(leaked)), `那一行不含「${leaked}」（项目名 / 本机用户名 / 文档内容）`, saveLines.join(' || '))
  }
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  check(manifest.entries.some((entry) => entry.path === dailyLog && /界面上报的失败/.test(entry.what)), '清单如实写明日志里含界面上报的失败', JSON.stringify(manifest.entries))

  fs.writeFileSync(path.join(shotsDir, 'bundle-log-lines.txt'), `${saveLines.join('\n')}\n`)
  console.log(`\n包里的那一行：\n${saveLines.join('\n')}\n`)
  if (failures.length) throw new Error(failures.join('; '))
  console.log(`PASS: renderer failure reaches the diagnostics bundle → ${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  console.error(`RENDERER FAILURE WALK FAIL: ${error?.stack || error}`)
  console.error(launched.mainLogTail().slice(-40).join('\n'))
  process.exitCode = 1
} finally {
  if (lockDir) fs.rmSync(lockDir, { recursive: true, force: true })
  await launched.close().catch(() => undefined)
  fs.rmSync(outDir, { recursive: true, force: true })
}
