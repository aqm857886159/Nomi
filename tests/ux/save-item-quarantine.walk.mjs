import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 设计卡 D-main-thread-unblock · 保存不丢作品：真 Electron 走查（隔离资料，不碰用户真实资料，不花钱）。
// 旧数据场景：盘上一份项目里有一份好分镜、一份坏分镜（时长存成了 null）。
//   修前：整份项目读不出来（normalizeRecord 整份拒收），点开项目卡就是「打不开」。
//   修后：项目照常打开，好分镜照常可编辑；坏分镜被隔离，原样留在 .nomi/quarantine/；创作者接着改（新建一份分镜）
//        能存下，盘上的好分镜和新分镜都在。
// 走查只量用户看得见的事实 + 盘上的事实；截图中 / 英各一张，进 EVIDENCE_DIR。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from '@playwright/test'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { stationTimeout } from './_station-budget.mjs'

const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const tempRoot = makeTempDir('nomi-save-quarantine-')
const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
const outputDir = process.env.NOMI_SAVE_QUARANTINE_EVIDENCE_DIR || path.join(tempRoot, 'evidence')
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
const projectId = 'save-quarantine', projectRoot = path.join(projectsDir, projectId)
const NAME = 'Save quarantine acceptance'
const document = { id: 'document-a', version: 1, title: 'document-a', updatedAt: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep original' }] }] } }
const design = (id, title, durationSec) => ({
  id, documentId: document.id, title, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1,
  plan: { title, anchors: [], shots: [{ index: 1, durationSec, anchorIds: [], prompt: `prompt of ${title}` }, { index: 2, durationSec: 4, anchorIds: [], prompt: 'second' }] },
})
createWorkspaceProject({ rootPath: projectRoot, record: { id: projectId, name: NAME, payload: {
  workbenchDocuments: [document], activeDocumentId: document.id, timeline: null,
  storyboardDesignsByDocumentId: { [document.id]: [design('good-design', 'Good design', 3), design('bad-design', 'Bad design', null)] },
  generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
} } }, { settingsRoot: settingsDir, defaultProjectsRoot: projectsDir })

const disk = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json'), 'utf8')).payload
const savedDesigns = () => Object.values(disk().storyboardDesignsByDocumentId ?? {}).flat()
const quarantineDir = path.join(projectRoot, '.nomi', 'quarantine')
const options = { name: 'save-quarantine', tempRoot, settingsDir, projectsDir, userDataDir: path.join(tempRoot, 'user-data'),
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' } }
const report = { status: 'running', boundary: 'built Electron, isolated profile, no network, no paid calls', tempRoot, checks: [], screenshots: [] }
let gui, win
const editor = () => win.locator('[data-storyboard-editor="true"]:visible')
async function start(locale) {
  gui = await launchNomiApp({ ...options, initialLocalStorage: { ...options.initialLocalStorage, 'nomi:locale:v1': locale } }); win = gui.win
  win.setDefaultTimeout(stationTimeout({ operations: 1 }))
  await win.locator('[data-project-card]', { hasText: NAME }).click()
  await win.getByRole('button', { name: /^(创作|Create)$/ }).click()
  const expand = win.locator('[data-shell-rail-item="docs"][aria-pressed="false"]')
  if (await expand.isVisible()) await expand.click()
}
async function screenshot(name) { const file = path.join(outputDir, `${name}.png`); await win.screenshot({ path: file }); report.screenshots.push(file) }
try {
  await start('zh-CN')
  // 1) 项目照常打开，好分镜可编辑
  await openStoryboardEditor(win, 'good-design')
  await expect(editor().locator('header input')).toHaveValue('Good design')
  report.checks.push({ fact: 'project with one unsavable design opens; the good design opens in the original editor' })
  await screenshot('zh-opened-with-bad-item')
  // 2) 接着改：改好分镜的名字，存得下；盘上好分镜（新名字）还在、坏的没写进 project.json
  await editor().locator('header input').fill('Good design edited')
  await expect.poll(() => savedDesigns().find(item => item.id === 'good-design')?.plan?.title, { message: 'an edit must be saved even though one old item was unsavable' }).toBe('Good design edited')
  const ids = savedDesigns().map(item => item.id)
  assert.ok(!ids.includes('bad-design'), 'the unsavable design is not written into project.json')
  report.checks.push({ fact: 'a following edit saved on disk; the unsavable design is not in project.json', ids })
  // 3) 坏的那份原样留在隔离区
  await expect.poll(() => fs.existsSync(quarantineDir) && fs.readdirSync(quarantineDir).length).toBeGreaterThanOrEqual(1)
  const kept = fs.readdirSync(quarantineDir).map(name => JSON.parse(fs.readFileSync(path.join(quarantineDir, name), 'utf8')))
  assert.ok(kept.some(item => item.raw?.id === 'bad-design' && item.raw?.title === 'Bad design'), 'the raw item is kept verbatim in .nomi/quarantine')
  report.checks.push({ fact: 'raw bad item kept verbatim in .nomi/quarantine', files: fs.readdirSync(quarantineDir).length })
  await screenshot('zh-after-following-edit')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await gui.app.close(); gui = null
  // 4) 英文再开一遍
  await start('en')
  await openStoryboardEditor(win, 'good-design')
  await expect(editor().locator('header input')).toHaveValue('Good design edited')
  await screenshot('en-reopened')
  await gui.app.close(); gui = null
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error?.stack || error)
  if (win) await screenshot('failure').catch(() => {})
  throw error
} finally {
  if (gui) await gui.app.close().catch(() => {})
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
void repoRoot
