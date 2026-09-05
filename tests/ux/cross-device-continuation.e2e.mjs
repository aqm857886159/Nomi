// 跨设备继续编辑真实旅程：两个隔离 profile 共享同一份项目镜像。
// 运行：pnpm run build && node tests/ux/cross-device-continuation.e2e.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(os.tmpdir(), 'nomi-cross-device-e2e-'))
const shared = path.join(root, 'shared')
const machineA = path.join(root, 'machine-a')
const machineB = path.join(root, 'machine-b')
const evidence = path.resolve('outputs/cross-device-continuation')
const screenshot = (name) => path.join(evidence, name)
mkdirSync(path.join(shared, 'Film One', '.nomi'), { recursive: true })
mkdirSync(path.join(shared, 'Film One', 'assets', 'imported'), { recursive: true })
mkdirSync(evidence, { recursive: true })
writeFileSync(path.join(shared, 'Film One', 'assets', 'imported', 'hero.png'), 'synthetic-image', 'utf8')
writeFileSync(path.join(shared, 'Film One', '.nomi', 'project.json'), JSON.stringify({
  id: 'cross-device-project', name: 'Film One', version: 2, createdAt: 100, updatedAt: 200, savedAt: 200, revision: 1,
  payload: { generationCanvas: { nodes: [{ id: 'hero', type: 'image', result: { type: 'image', url: 'nomi-local://asset/cross-device-project/assets/imported/hero.png' } }] } },
}, null, 2))
cpSync(shared, machineA, { recursive: true })
cpSync(shared, machineB, { recursive: true })

let passed = 0
const assert = (condition, label) => {
  if (!condition) throw new Error(`CROSS-DEVICE FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const a = await launchNomiApp({ name: 'cross-device-a', userDataDir: path.join(root, 'a-user'), settingsDir: path.join(root, 'a-settings'), projectsDir: machineA })
let b = await launchNomiApp({ name: 'cross-device-b', userDataDir: path.join(root, 'b-user'), settingsDir: path.join(root, 'b-settings'), projectsDir: machineB })
try {
  await a.win.getByText('Film One', { exact: true }).first().waitFor({ timeout: 10000 })
  await b.win.getByText('Film One', { exact: true }).first().waitFor({ timeout: 10000 })
  assert(await a.win.getByText('可在另一台电脑继续', { exact: true }).count() > 0, '机器 A 显示项目可跨设备继续')
  assert(await b.win.getByText('可在另一台电脑继续', { exact: true }).count() > 0, '机器 B 显示项目可跨设备继续')

  await a.win.getByRole('button', { name: '设置', exact: true }).click()
  assert(await a.win.getByText('文件与保存', { exact: true }).count() > 0, '设置打开文件与保存页')
  assert(await a.win.locator('[data-settings-project-sync]').count() === 1, '文件与保存页显示跨设备目录状态')
  const syncSection = a.win.locator('[data-settings-project-sync]')
  const stepsToggle = syncSection.locator('button[aria-controls="settings-project-sync-steps"]')
  await stepsToggle.click()
  assert(await stepsToggle.getAttribute('aria-expanded') === 'true', '展开三步说明并反映展开状态')
  const steps = a.win.locator('#settings-project-sync-steps')
  assert(await steps.locator('li').count() === 3, '展开态只显示三步说明')
  const stepsText = await steps.innerText()
  assert(['微力同步', '坚果云', '把上面的文件夹添加进去。', '等待同步完成'].every((text) => stepsText.includes(text)), '三步说明包含同步工具、添加目录和完成条件')
  assert(await steps.locator('a[href="https://www.verysync.com/"]').count() === 1, '三步说明提供微力同步官方入口')
  assert(await steps.locator('a[href="https://www.jianguoyun.com/s/downloads"]').count() === 1, '三步说明提供坚果云官方入口')
  await a.win.screenshot({ path: screenshot('settings-sync-steps-expanded.png'), fullPage: true })

  const checkFolder = syncSection.getByRole('button', { name: '检查文件夹', exact: true })
  await checkFolder.click()
  const checkFeedback = syncSection.locator('[data-project-location-check-feedback]')
  await checkFeedback.getByText('文件夹可用。', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert(await checkFeedback.getAttribute('data-feedback-tone') === 'success', '检查可用空目录后显示成功反馈')
  await a.win.screenshot({ path: screenshot('settings-folder-check-success.png'), fullPage: true })

  // 受控文件系统 fixture：把当前目录根替换成普通文件，真实 IPC 会返回 not-directory。
  // 这不是把错误注入 renderer，而是让 Electron 检查真实看到的磁盘状态。
  rmSync(machineA, { recursive: true, force: true })
  writeFileSync(machineA, 'not-a-folder', 'utf8')
  await checkFolder.click()
  await checkFeedback.getByText('选择的位置不是文件夹，原设置没有改变。', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  assert(await checkFeedback.getAttribute('data-feedback-tone') === 'error', '检查不可用目录后显示失败反馈')
  await a.win.screenshot({ path: screenshot('settings-folder-check-failure.png'), fullPage: true })
  await a.win.locator('[data-settings-close]').click()

  const changedManifest = JSON.parse(readFileSync(path.join(machineB, 'Film One', '.nomi', 'project.json'), 'utf8'))
  changedManifest.revision = 2
  changedManifest.updatedAt = 300
  changedManifest.payload = { generationCanvas: { nodes: [{ id: 'hero', type: 'image', result: { type: 'image', url: 'nomi-local://asset/cross-device-project/assets/imported/hero.png' } }] }, title: 'updated on machine B' }
  writeFileSync(path.join(machineB, 'Film One', '.nomi', 'project.json'), JSON.stringify(changedManifest, null, 2))
  await b.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await b.win.getByText('另一台电脑有新版本', { exact: true }).waitFor({ timeout: 10000 })
  assert(await b.win.getByText('另一台电脑有新版本', { exact: true }).count() > 0, '检测到另一台电脑的新版本')
  await b.win.getByRole('button', { name: '另一台电脑有新版本', exact: true }).click()
  assert(await b.win.getByRole('dialog', { name: '发现另一台电脑的项目更新', exact: true }).count() === 1, '点击状态打开就近提示')
  await b.win.getByRole('button', { name: '重新检查', exact: true }).click()
  await b.win.getByText('可在另一台电脑继续', { exact: true }).waitFor({ timeout: 10000 })
  assert(await b.win.getByText('可在另一台电脑继续', { exact: true }).count() > 0, '重新检查后恢复可继续状态')

  await b.win.getByText('Film One', { exact: true }).first().click()
  await b.win.waitForTimeout(1200)
  console.log(`  URL after open: ${b.win.url()}`)
  assert(await b.win.getByRole('button', { name: '创作', exact: false }).first().isVisible(), '机器 B 已进入工作台')
  assert(await b.win.getByRole('button', { name: '预览', exact: false }).first().isVisible(), '机器 B 工作台预览入口可见')
  await b.win.screenshot({ path: screenshot('machine-b-project-open.png'), fullPage: true })

  // 真实进程级冷启动：关闭 Electron，再用同一 userData/settings/projects profile 启动。
  await b.close()
  b = await launchNomiApp({
    name: 'cross-device-b-restart',
    userDataDir: path.join(root, 'b-user'),
    settingsDir: path.join(root, 'b-settings'),
    projectsDir: machineB,
  })
  await b.win.getByText('Film One', { exact: true }).first().waitFor({ timeout: 10000 })
  assert(await b.win.getByText('Film One', { exact: true }).count() > 0, '冷启动后恢复同一项目记录')
  await b.win.getByText('Film One', { exact: true }).first().click()
  await b.win.waitForTimeout(1200)
  assert(await b.win.getByRole('button', { name: '创作', exact: false }).first().isVisible(), '冷启动后可重新进入工作台')
  assert(JSON.parse(readFileSync(path.join(machineB, 'Film One', '.nomi', 'project.json'), 'utf8')).payload.title === 'updated on machine B', '冷启动后磁盘状态仍保留机器 B 的编辑')
  await b.win.screenshot({ path: screenshot('machine-b-project-after-restart.png'), fullPage: true })
  console.log(`\nCROSS-DEVICE PASS: ${passed} assertions`)
} catch (err) {
  console.error('\nCROSS-DEVICE FAIL:', err.message)
  process.exitCode = 1
} finally {
  await Promise.all([a.close(), b.close()])
  rmSync(root, { recursive: true, force: true })
  if (process.exitCode === 1) process.exit(1)
}
