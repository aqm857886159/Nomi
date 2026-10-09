import { makeTempDir } from './_test-temp.mjs'
// 否决门 spike：打包后的 Nomi.app 在当前签名状态下，macOS 通知还弹不弹。
//
// 为什么需要它：Electron 42 把 macOS 通知从 NSUserNotification 迁到 UNNotification，
// 后者要求 app「已代码签名」。本仓是 ad-hoc 签名（build.mac.identity=null +
// scripts/after-pack-mac.cjs 手工 `codesign --sign -`，为绕开 XProtect 误报），
// 而「ad-hoc 算不算已签名」没有权威说法，只能实测。
//
// 为什么必须测**打包版**而不是 `electron .`：UNNotification 的授权是按 bundle id 记的。
// 用官方 Electron.app 跑只能测到 com.github.Electron，测不到我们的 com.nomi.app +
// after-pack 的签名结果。两者结论可能不同。
//
// 为什么断言点在主进程：本仓两处通知代码（notificationIpc.ts / productionNotificationsDesktop.ts）
// 都只调 show()、都不监听 'failed'，前者还直接 return { ok: true }。
// 也就是说失败时**界面无异常、日志无记录**——只有在主进程里挂上 'failed' 才看得见。
//
// 用法：node scripts/notification-signing-spike.mjs release/mac-arm64/Nomi.app
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

if (process.platform !== 'darwin') {
  console.log('本 spike 只针对 macOS，其他平台跳过')
  process.exit(0)
}

const bundlePath = path.resolve(process.argv[2] || '')
const executablePath = path.join(bundlePath, 'Contents', 'MacOS', 'Nomi')
if (!fs.existsSync(executablePath)) {
  console.log(`✖ 找不到打包产物：${executablePath}\n  先跑 npx electron-builder --mac dir --arm64`)
  process.exit(1)
}

// 先把「被测物到底是什么签名」记录下来——否则结论无从归属。
// codesign 把这些信息写在 **stderr**，不是 stdout——只读 stdout 会拿到空串，
// 于是签名字段全打成 "?"，等于这次结论无从归属。必须合并 stderr。
const sig = execFileSync('/bin/sh', ['-c', `/usr/bin/codesign -dv --verbose=2 ${JSON.stringify(bundlePath)} 2>&1`], { encoding: 'utf8' })
  .toString()
const grab = (re) => (sig.match(re)?.[1] ?? '?').trim()
console.log(`  🔏 被测物：${bundlePath}`)
console.log(`     Identifier=${grab(/Identifier=(.+)/)}  Signature=${grab(/Signature=(.+)/)}  Team=${grab(/TeamIdentifier=(.+)/)}`)

const tempRoot = makeTempDir('nomi-notif-spike-')
const { app } = await launchNomiApp({
  name: 'notification-signing-spike',
  executablePath,
  userDataDir: tempRoot,
  settingsDir: tempRoot,
  projectsDir: path.join(tempRoot, 'projects'),
  settleMs: 1200,
})

let verdict
try {
  verdict = await app.evaluate(async ({ Notification, app: electronApp }) => {
    const base = { electron: process.versions.electron, bundleId: electronApp.getName() }
    if (!Notification.isSupported()) return { ...base, verdict: 'UNSUPPORTED', isSupported: false }
    return await new Promise((resolve) => {
      const notification = new Notification({
        title: 'Nomi 通知验证',
        body: `Electron ${process.versions.electron} · 当前签名状态`,
      })
      let settled = false
      const done = (result) => { if (!settled) { settled = true; resolve({ ...base, isSupported: true, ...result }) } }
      notification.on('failed', (_event, error) => done({ verdict: 'FAILED', error: String(error) }))
      notification.on('show', () => done({ verdict: 'SHOWN' }))
      notification.show()
      // 既不 show 也不 failed 也是一种结果（静默丢弃），必须能区分出来。
      setTimeout(() => done({ verdict: 'NO_EVENT_TIMEOUT' }), 8000)
    })
  })
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log(`  📣 electron=${verdict.electron}  isSupported=${verdict.isSupported}  verdict=${verdict.verdict}`)
if (verdict.error) console.log(`     error=${verdict.error}`)

if (verdict.verdict === 'SHOWN') {
  console.log('\n✅ 否决门通过：当前签名状态下通知正常弹出，升级可继续。')
  process.exit(0)
}
console.log(`\n❌ 否决门未通过（${verdict.verdict}）：升级在解决签名/授权之前不予合并。`)
console.log('   理由：两处通知代码都不监听 failed，失败时应用会「报告成功但什么都不弹」，')
console.log('   等于拿用户可见功能换 Chromium 更新，且没有任何告警。')
process.exit(1)
