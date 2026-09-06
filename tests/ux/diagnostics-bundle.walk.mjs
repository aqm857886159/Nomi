// R16/R13 真实旅程：出了问题 → 设置 → 隐私与诊断 → 导出诊断包 → 打开 zip 看看里面是什么。
//
// 这条走查存在的理由，是单测证不了的那一半：单测钉的是「给定这些输入，组包函数产出什么」；
// 这里钉的是「**真 Electron 里**这条路走得通，且包里确实没有密钥」——从渲染层的按钮，
// 经 IPC、主进程的目录/项目解析，一直到盘上那个 zip。
//
// 保存对话框是原生模态，Playwright 点不了它。所以在主进程侧给 `dialog.showSaveDialog` 打桩
// （`app.evaluate`）——**不在生产代码里留 E2E 逃生口**（那会是个永远开着的口子，P1）。
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, expectVisible, clickOrFail } from './_assert.mjs'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/diagnostics-bundle')
fs.mkdirSync(shotsDir, { recursive: true })
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-diagnostics-walk-'))
const targetZip = path.join(outDir, 'bundle.zip')

const failures = []
let shotNumber = 0
async function shot(win, name) {
  shotNumber += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shotNumber).padStart(2, '0')}-${name}.png`) })
}

const { app, win } = await launchNomiApp({ name: 'diagnostics-bundle' })
try {
  // 原生保存对话框的桩：直接答「用户选了这个路径」。装在主进程里，生产代码一行没动。
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, targetZip)

  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(key, 'seen')
    window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
  })
  await win.reload()

  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  const section = win.locator('[data-settings-section="diagnostics"]')
  await expectVisible(section, '导出诊断包区块')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('data-diagnostics-state')) !== 'idle') failures.push('刚打开时应为 idle')
  await shot(win, '01-idle')

  await clickOrFail(section.getByRole('button', { name: '导出诊断包', exact: true }), '导出诊断包')
  await expectVisible(section.locator('[data-diagnostics-result]'), '导出结果行')
  const state = await section.getAttribute('data-diagnostics-state')
  if (state !== 'saved') failures.push(`导出后应为 saved，实际 ${state}`)
  await shot(win, '02-saved')

  // ── 盘上那个 zip 到底是什么 ──────────────────────────────────────────────
  if (!fs.existsSync(targetZip)) throw new Error(`诊断包没有落盘：${targetZip}`)
  const files = unzipSync(new Uint8Array(fs.readFileSync(targetZip)))
  const names = Object.keys(files)
  const manifest = JSON.parse(strFromU8(files['manifest.json'] || new Uint8Array()))

  if (manifest.schemaVersion !== 1) failures.push('清单缺 schemaVersion')
  if (!manifest.app?.version || !manifest.app?.electron) failures.push('清单缺 Nomi / Electron 版本')
  if (!manifest.system?.platform) failures.push('清单缺系统信息')
  if (!names.some((name) => /^logs\/nomi-\d{4}-\d{2}-\d{2}\.log$/.test(name))) {
    failures.push(`包里没有当天的运行日志（app 启动时应已写下 session-start）：${names.join(', ')}`)
  }
  // 清单必须如实描述包里有什么——它是收到 zip 的人唯一的目录。
  const listed = manifest.entries.map((entry) => entry.path).sort()
  const actual = names.filter((name) => name !== 'manifest.json').sort()
  if (JSON.stringify(listed) !== JSON.stringify(actual)) {
    failures.push(`清单与实际条目对不上：清单 ${listed.join(',')} vs 实际 ${actual.join(',')}`)
  }
  if (!manifest.excluded?.some((item) => item.why === 'never-collected-by-design')) {
    failures.push('清单没有写明「密钥/提示词/素材路径从不收集」')
  }

  // 最重要的一条：整个包里不许出现凭据材料或本机绝对路径。
  // 逐条目扫而不是拼成一大块：报「哪一份漏了」才有排查价值，报「包里有个 /Users/」等于让人重新猜一遍。
  for (const name of names) {
    const text = strFromU8(files[name])
    for (const forbidden of [/\bsk-[A-Za-z0-9_-]{8,}/, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/, /\/Users\/[^/\s",]+\//]) {
      const hit = text.match(forbidden)
      if (hit) failures.push(`${name} 里出现了不该有的内容：${hit[0].slice(0, 60)}（上下文：${text.slice(Math.max(0, hit.index - 80), hit.index + 80).replace(/\s+/g, ' ')}）`)
    }
  }

  console.log(
    `PASS: diagnostics bundle journey; ${names.length} entries (${manifest.totalBytes} bytes); ${shotNumber} screenshots → ${path.relative(repoRoot, shotsDir)}`,
  )
  if (failures.length) throw new Error(failures.join('; '))
  await app.close()
} catch (error) {
  console.error(`DIAGNOSTICS WALK FAIL: ${error?.stack || error}`)
  await app.close().catch(() => undefined)
  process.exitCode = 1
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
