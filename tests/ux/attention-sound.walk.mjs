// Real settings/IPC/file import journey. Only the OS player is replaced, so no audible output.
// 用法：pnpm build && NOMI_WALK_FOREGROUND_OK=1 node tests/ux/attention-sound.walk.mjs
// 窗口有没有焦点决定提示音响不响，要真焦点，窗口会到前台；没带放行变量就不起 App、按 125 跳过。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { exitIfWalkSkipped, launchNomiApp, repoRoot } from './_launchApp.mjs'
import { screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { expect } from '@playwright/test'
const shots = path.join(repoRoot, 'tests/ux/shots/attention-sound')
fs.mkdirSync(shots, { recursive: true })
const { app, win, settingsDir } = await launchNomiApp({
  name: 'attention-sound',
  foreground: '窗口有没有焦点决定提示音，安静模式下 focus 是空操作、窗口永远没焦点',
}).catch(exitIfWalkSkipped)
try {
  await app.evaluate(({ Notification }) => {
    Notification.isSupported = () => false
    const cp = process.getBuiltinModule('child_process')
    const original = cp.spawn
    globalThis.attentionCalls = []
    cp.spawn = (command, args, options) => {
      if (!['afplay', 'paplay', 'aplay', 'powershell.exe'].includes(command)) return original(command, args, options)
      globalThis.attentionCalls.push({ command, args })
      const child = new (process.getBuiltinModule('events').EventEmitter)()
      child.kill = () => { child.emit('exit', 0); return true }
      process.nextTick(() => child.emit('spawn'))
      return child
    }
  })
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
  })
  await win.reload()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 1000) })
  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  const section = win.locator('[data-settings-section="attention-sound"]')
  await section.scrollIntoViewIfNeeded()
  const toggle = section.getByRole('switch', { name: '需要我时响一声', exact: true })
  await expect(toggle).toBeChecked()
  await section.evaluate((element) => {
    const content = element.closest('[data-settings-content]')
    content.scrollTop += element.getBoundingClientRect().top - content.getBoundingClientRect().top
  })
  await screenshotSettled(win, { path: path.join(shots, 'settings-1440.png'), scale: 'css' })
  await toggle.focus(); await toggle.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(section.getByRole('checkbox').first()).toBeDisabled()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide() })
  const notify = () => win.evaluate(() => window.nomiDesktop.notifications.show({ title: 'Nomi', body: 'approval', event: 'decision' }))
  await notify()
  assert.equal(await app.evaluate(() => globalThis.attentionCalls.length), 0)
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
  await toggle.focus(); await toggle.press('Space')
  await expect(toggle).toBeChecked()
  await notify()
  assert.equal(await app.evaluate(() => globalThis.attentionCalls.length), 0, 'focused window must stay quiet')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await notify()
  assert.equal(await app.evaluate(() => globalThis.attentionCalls.length), 1, 'background decision plays once')
  await win.evaluate(() => window.nomiDesktop.settings.attentionSound.stop())
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
  await section.getByRole('button', { name: '试听', exact: true }).click()
  await expect(section.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: '试听', exact: true })).toBeVisible({ timeout: 4000 })
  const file = path.join(repoRoot, 'scripts/attention-cue/candidates/a.wav')
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
  await section.getByRole('button', { name: '换一个…', exact: true }).click()
  await expect(section.getByText(/a.wav/)).toBeVisible({ timeout: 15000 })
  await section.getByRole('button', { name: '试听', exact: true }).click()
  const customProof = await proveProbe(section.getByText(/a.wav/), '导入后卡片显示自定义文件')
  const calls = await app.evaluate(() => globalThis.attentionCalls)
  assert.ok(calls.at(-1).args[0].endsWith('/sounds/attention.wav'))
  await section.getByRole('button', { name: '停止', exact: true }).click()
  const invalid = path.join(settingsDir, 'broken.wav')
  fs.writeFileSync(invalid, 'not audio')
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, invalid)
  await section.getByRole('button', { name: '换一个…', exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('有效音频文件')
  const errorProof = await proveProbe(section.getByRole('alert'), '损坏音频显示错误')
  await expect(section.getByText(/a.wav/)).toBeVisible()
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  await section.getByRole('button', { name: '换一个…', exact: true }).click()
  await expectAbsent(section.getByRole('alert'), { provenBy: errorProof, message: '取消选择后清除旧错误' })
  await expect(section.getByText(/a.wav/)).toBeVisible()
  await win.locator('[data-settings-close]').click()
  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  await expect(section.getByText(/a.wav/)).toBeVisible()
  await section.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expectAbsent(section.getByText(/a.wav/), { provenBy: customProof, message: '恢复默认后移除自定义文件名' })
  assert.equal((await win.evaluate(() => window.nomiDesktop.settings.attentionSound.get())).custom, null)
  console.log('PASS: real settings, focus/off call counts, preview auto-stop, native file import, reopen persistence, restore default; no actual audio')
} finally { await app.close() }
