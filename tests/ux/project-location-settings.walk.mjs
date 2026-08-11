// 新项目默认位置真机旅程：设置页可见 → 新项目落到自定义根 → 恢复默认不搬旧项目。
// 目录选择器本身由主进程单测覆盖；本旅程预写同一设置文件，避免自动化操纵系统原生对话框。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-07-project-location')
fs.mkdirSync(outDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-project-location-walk-'))
const settingsRoot = path.join(tempRoot, 'settings')
const customProjectsRoot = path.join(tempRoot, 'projects-on-another-drive')
const defaultDocumentsRoot = path.join(tempRoot, 'documents')
fs.mkdirSync(settingsRoot, { recursive: true })
fs.mkdirSync(defaultDocumentsRoot, { recursive: true })
fs.writeFileSync(
  path.join(settingsRoot, 'project-location.json'),
  `${JSON.stringify({ projectsRoot: customProjectsRoot }, null, 2)}\n`,
  'utf8',
)

const { app, win: _win } = await launchNomiApp({
  name: 'project-location-settings',
  userDataDir: settingsRoot,
  settingsDir: settingsRoot,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
await app.evaluate(({ app }, documentsRoot) => app.setPath('documents', documentsRoot), defaultDocumentsRoot)

let win = _win
const currentWindow = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live[live.length - 1] || win
  return win
}
const dialog = () => currentWindow().locator('[role="dialog"][aria-modal="true"]').first()
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
}
const findProjectManifests = (root) => {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, '.nomi', 'project.json'))
    .filter((file) => fs.existsSync(file))
}

try {
  await currentWindow().waitForLoadState('domcontentloaded')
  await currentWindow().waitForTimeout(1800)
  await currentWindow().evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await currentWindow().reload()
  await currentWindow().waitForLoadState('domcontentloaded')
  await currentWindow().waitForTimeout(1600)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await currentWindow().keyboard.press('Escape').catch(() => {})
    await currentWindow().waitForTimeout(150)
  }

  await currentWindow().locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click({ timeout: 8000 })
  await dialog().waitFor({ state: 'visible', timeout: 8000 })
  const section = dialog().locator('[data-settings-project-location]')
  await section.waitFor({ state: 'visible', timeout: 5000 })

  const pathText = (await section.locator('[data-project-location-path]').textContent())?.trim() || ''
  check('设置页显示当前自定义目录', pathText === customProjectsRoot, pathText)
  check('占位标签已经删除', !(await dialog().innerText()).includes('稍后支持'))
  check('三个目录动作可见', await section.getByRole('button').count() === 3, `${await section.getByRole('button').count()} 个按钮`)
  await dialog().screenshot({ path: path.join(outDir, '01-project-location-light.png') })

  await currentWindow().evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
  await currentWindow().waitForTimeout(300)
  await dialog().screenshot({ path: path.join(outDir, '02-project-location-dark.png') })
  await currentWindow().evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'light'))

  await dialog().locator('button[aria-label*="关闭"], button[aria-label*="Close"]').click()
  await currentWindow().evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await currentWindow().reload()
  await currentWindow().waitForLoadState('domcontentloaded')
  await currentWindow().waitForTimeout(1200)
  await currentWindow().locator('button[aria-label*="Settings"]').first().click({ timeout: 8000 })
  await dialog().waitFor({ state: 'visible', timeout: 8000 })
  const englishSectionText = await dialog().locator('[data-settings-project-location]').innerText()
  check(
    '英文设置文案完整',
    ['Default location for new projects', 'Change', 'Open folder', 'Restore default'].every((text) => englishSectionText.includes(text)),
    englishSectionText,
  )
  await dialog().locator('button[aria-label*="Close"]').click()
  await currentWindow().getByRole('button', { name: /新建空白项目|New blank project/ }).first().click({ timeout: 8000 })
  await currentWindow().waitForTimeout(1800)

  const manifests = findProjectManifests(customProjectsRoot)
  check('新项目落到自定义目录', manifests.length === 1, JSON.stringify(manifests))
  const customProject = JSON.parse(fs.readFileSync(manifests[0], 'utf8'))

  await currentWindow().locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click({ timeout: 8000 })
  await dialog().waitFor({ state: 'visible', timeout: 8000 })
  await dialog().locator('[data-settings-project-location]').getByRole('button', { name: /恢复默认|Restore default/ }).click()
  await currentWindow().waitForTimeout(300)
  check('恢复默认后自定义项目仍在原位', manifests.every((file) => fs.existsSync(file)))
  check(
    '恢复默认动作仅在自定义状态出现',
    await dialog().getByRole('button', { name: /恢复默认|Restore default/ }).count() === 0,
  )

  await dialog().locator('button[aria-label*="关闭"], button[aria-label*="Close"]').click()
  await currentWindow().getByText(/项目库|Projects/, { exact: true }).first().click({ timeout: 8000 })
  await currentWindow().waitForTimeout(1200)
  const oldCard = currentWindow().locator('[data-project-card="true"]', { hasText: customProject.name }).first()
  await oldCard.waitFor({ state: 'visible', timeout: 8000 })
  await oldCard.click({ position: { x: 20, y: 20 } })
  await currentWindow().waitForTimeout(1200)
  check('恢复默认后旧项目仍能从项目库重新打开', currentWindow().url().includes(customProject.id), currentWindow().url())

  await currentWindow().getByText(/项目库|Projects/, { exact: true }).first().click({ timeout: 8000 })
  await currentWindow().getByRole('button', { name: /新建空白项目|New blank project/ }).first().click({ timeout: 8000 })
  await currentWindow().waitForTimeout(1800)
  const defaultProjectsRoot = path.join(defaultDocumentsRoot, 'Nomi Projects')
  const defaultManifests = findProjectManifests(defaultProjectsRoot)
  check('恢复默认后新项目落到 Documents 默认目录', defaultManifests.length === 1, JSON.stringify(defaultManifests))
  check('恢复默认和新建均未搬动旧项目', manifests.every((file) => fs.existsSync(file)))

  console.log(`\n截图目录：${outDir}`)
} catch (error) {
  console.error('项目位置走查失败:', error)
  await currentWindow().screenshot({ path: path.join(outDir, '99-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
