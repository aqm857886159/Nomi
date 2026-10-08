import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R16 真实任务走查：Finder 复制图片 → 素材库 Cmd/Ctrl+V → 无损落盘。
// 走查使用 Electron 原生 clipboard 写入 file-url，再走用户实际键盘粘贴路径，
// 不直接调用 assets.copyFiles，避免只测 IPC 而漏掉面板事件、刷新和用户反馈。
import { launchNomiApp } from './_launchApp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const base = makeTempDir('nomi-asset-native-import-')
const userDataDir = path.join(base, 'user-data')
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
const projectId = 'walk-native-import-0001'
const projectRoot = path.join(projectsDir, `native-import-${projectId}`)
const sourcePath = path.join(base, 'Finder 复制的原图.png')
const dropSourcePath = path.join(base, '拖入的原图.png')
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.writeFileSync(sourcePath, png)
fs.writeFileSync(dropSourcePath, png)
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId,
  name: '原生素材导入验收',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument: null,
  timeline: null,
  generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(file, JSON.stringify(project, null, 2))
}

const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const importedFiles = () => {
  const root = path.join(projectRoot, 'assets', 'imported')
  if (!fs.existsSync(root)) return []
  const result = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) result.push(full)
    }
  }
  visit(root)
  return result
}

let app
try {
  ;({ app } = await launchNomiApp({
    name: 'asset-library-native-import',
    userDataDir,
    settingsDir,
    projectsDir,
    env: { NOMI_E2E_SMOKE: '1' },
  }))
  const win = await app.firstWindow()
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(900)

  const projectCard = win.getByText('原生素材导入验收', { exact: false }).first()
  await projectCard.waitFor({ timeout: 8000 })
  await projectCard.click()
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  const libraryButton = win.getByRole('button', { name: '素材库', exact: true }).first()
  const assetSection = win.locator('section[aria-label="素材库"]')
  const nextStep = await Promise.any([
    continueButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'continue'),
    assetSection.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'library'),
  ])
  if (nextStep === 'continue') {
    await continueButton.click()
    const postContinue = await Promise.any([
      assetSection.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'library'),
      libraryButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'button'),
    ])
    if (postContinue === 'button' && !(await assetSection.isVisible())) await libraryButton.click()
  } else if (!(await assetSection.isVisible())) {
    await libraryButton.waitFor({ state: 'visible', timeout: 8000 })
    await libraryButton.click()
  }
  const panel = win.locator('section[aria-label="素材库"] > div').first()
  await panel.waitFor({ state: 'visible', timeout: 8000 })
  const initialFiles = importedFiles()
  const existingFile = initialFiles.find(Boolean)
  if (existingFile) throw new Error(`走查前项目已有导入图片：${initialFiles.join(', ')}`)

  // 模拟 Finder 复制文件：主进程写入 native file-url，渲染层仍通过 clipboard IPC 读取。
  await app.evaluate(({ clipboard }, fileUrl) => {
    clipboard.clear()
    clipboard.writeText(fileUrl)
  }, pathToFileURL(sourcePath).href)
  await panel.focus()
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
  await win.waitForTimeout(400)
  // 无桌面剪贴板后端时 Playwright 只产生 keydown；补发同一个 DOM paste 事件，
  // 仍然走面板真实 onPaste → clipboard IPC → copyFiles 链路。
  if (importedFiles().length === 0) {
    await win.evaluate(() => document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true })))
  }

  const deadline = Date.now() + 8000
  let created = []
  while (Date.now() < deadline) {
    created = importedFiles()
    if (created.length === 1 && (await win.locator('section[aria-label="素材库"] img[alt="Finder 复制的原图.png"]').count()) > 0) break
    await win.waitForTimeout(200)
  }
  if (created.length !== 1) throw new Error(`粘贴后未落盘单张图片，发现 ${created.length} 张`)
  const targetPath = created[0]
  await win.locator('section[aria-label="素材库"] img[alt="Finder 复制的原图.png"]').waitFor({ state: 'visible', timeout: 8000 })
  const sourceHash = sha256(sourcePath)
  const targetHash = sha256(targetPath)
  if (sourceHash !== targetHash) throw new Error(`无损校验失败：source=${sourceHash} target=${targetHash}`)
  if (!fs.existsSync(sourcePath)) throw new Error('源文件被移动或删除')

  // 模拟 Finder/桌面文件拖入：File.path 是 Electron webUtils 失败时的兼容回落。
  await win.evaluate(({ fileName, filePath }) => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: 'image/png' })
    Object.defineProperty(file, 'path', { value: filePath })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    const panelRoot = document.querySelector('section[aria-label="素材库"] > div[tabindex="0"]')
    panelRoot?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, { fileName: path.basename(dropSourcePath), filePath: dropSourcePath })
  const dropDeadline = Date.now() + 8000
  let dropped = []
  while (Date.now() < dropDeadline) {
    dropped = importedFiles()
    if (dropped.length === 2 && (await win.locator('section[aria-label="素材库"] img[alt="拖入的原图.png"]').count()) > 0) break
    await win.waitForTimeout(200)
  }
  if (dropped.length !== 2) throw new Error(`拖入后未落盘第二张图片，发现 ${dropped.length} 张`)
  const droppedPath = dropped.find((filePath) => path.basename(filePath) === '拖入的原图.png')
  if (!droppedPath) throw new Error('拖入后的文件名未落盘')
  const droppedHash = sha256(droppedPath)
  if (droppedHash !== sha256(dropSourcePath)) throw new Error(`拖入无损校验失败：source=${sha256(dropSourcePath)} target=${droppedHash}`)
  console.log(`NATIVE IMPORT PASS: paste + drop, sha256=${targetHash}/${droppedHash}`)
} finally {
  if (app) {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => {})
  }
}
