// 跨设备继续编辑真实旅程：两个隔离 profile 共享同一份项目镜像。
// 运行：pnpm run build && node tests/ux/cross-device-continuation.e2e.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(os.tmpdir(), 'nomi-cross-device-e2e-'))
const shared = path.join(root, 'shared')
const machineA = path.join(root, 'machine-a')
const machineB = path.join(root, 'machine-b')
const evidence = path.resolve('outputs/cross-device-continuation')
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
const b = await launchNomiApp({ name: 'cross-device-b', userDataDir: path.join(root, 'b-user'), settingsDir: path.join(root, 'b-settings'), projectsDir: machineB })
try {
  await a.win.getByText('Film One', { exact: true }).first().waitFor({ timeout: 10000 })
  await b.win.getByText('Film One', { exact: true }).first().waitFor({ timeout: 10000 })
  assert(await a.win.getByText('可在另一台电脑继续', { exact: true }).count() > 0, '机器 A 显示项目可跨设备继续')
  assert(await b.win.getByText('可在另一台电脑继续', { exact: true }).count() > 0, '机器 B 显示项目可跨设备继续')

  await a.win.getByRole('button', { name: '设置', exact: true }).click()
  assert(await a.win.getByText('文件与保存', { exact: true }).count() > 0, '设置打开文件与保存页')
  assert(await a.win.locator('[data-settings-project-sync]').count() === 1, '文件与保存页显示跨设备目录状态')
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
  await b.win.screenshot({ path: path.join(evidence, 'machine-b-project-open.png'), fullPage: true })
  console.log(`\nCROSS-DEVICE PASS: ${passed} assertions`)
} catch (err) {
  console.error('\nCROSS-DEVICE FAIL:', err.message)
  process.exitCode = 1
} finally {
  await Promise.all([a.close(), b.close()])
  if (process.exitCode === 1) process.exit(1)
}
