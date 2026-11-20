#!/usr/bin/env node
// 真实用户任务：分镜页给一镜写了提示词，切去生成画布再回创作、或回项目库再进分镜——框里还是这一镜落盘的那份字。
//
// 夹具：tests/fixtures/old-user-data 里 v0.24.1 那份真实旧版项目（分镜两镜，提示词「Old shot 1 / Old shot 2」）；
// 旧项目里已落盘的提示词打开后照样显示。
//   ① 打开 → 进分镜：第 1、2 镜框里是落盘的字；
//   ② 去生成画布 → 回创作（创作区被 React <Activity> 藏起再放出，编辑器实例重建）：字还在，且每一镜是自己的字；
//   ③ 回项目库 → 再开项目 → 进分镜：字还在；
//   ④ 项目文件逐字节不变（灌入既不进撤销历史、也不回写）。
//   ⑤ 反例（量具不是永远绿）：敲一个字，项目文件就该变。
// 隔离资料、关网，一笔都不花。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect } from './_assert.mjs'
import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { leaveProjectIfOpen, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE = path.join(repoRoot, 'tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project')
const PLACEHOLDER = '__OLD_USER_ROOT__'
const NETWORK_GUARD = path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')
const SAVE_SETTLE_MS = 3000
const BOX = (index) => `[data-storyboard-row="${index}"] [data-prompt-box="true"] [contenteditable="true"]`

const root = makeTempDir('storyboard-prompt-reentry-')
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function prepare(id) {
  const base = path.join(root, id)
  const settingsDir = path.join(base, 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  const projectRoot = JSON.parse(fs.readFileSync(path.join(FIXTURE, '.nomi', 'project.json'), 'utf8')).lastKnownRootPath.replace(PLACEHOLDER, base)
  fs.cpSync(FIXTURE, projectRoot, { recursive: true })
  for (const file of fs.readdirSync(path.join(projectRoot, '.nomi'))) {
    const target = path.join(projectRoot, '.nomi', file)
    if (file.endsWith('.json')) fs.writeFileSync(target, fs.readFileSync(target, 'utf8').split(PLACEHOLDER).join(base))
  }
  const projectFile = path.join(projectRoot, '.nomi', 'project.json')
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  fs.writeFileSync(path.join(settingsDir, 'recent-workspaces.json'), JSON.stringify([{ id: project.id, name: project.name, rootPath: projectRoot, lastOpenedAt: 1793527268200, missing: false, source: 'folder' }], null, 2))
  const design = Object.values(project.payload.storyboardDesignsByDocumentId).flat()[0]
  return { base, settingsDir, projectFile, projectName: project.name, storyboardTitle: design.title, prompts: design.plan.shots.map((shot) => shot.prompt) }
}

async function launch(machine) {
  return launchNomiApp({
    name: 'storyboard-prompt-reentry',
    tempRoot: machine.base,
    userDataDir: path.join(machine.base, 'user-data'),
    settingsDir: machine.settingsDir,
    projectsDir: path.join(machine.base, 'projects'),
    viewportSize: { width: 1440, height: 900 },
    settleMs: 0,
    initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    mainRequire: [NETWORK_GUARD],
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_DISABLE_AUTO_UPDATE: '1' },
    args: ['--no-proxy-server'],
  })
}

const openCard = (win, machine) => clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: machine.projectName }).first(), `打开项目卡「${machine.projectName}」`)

async function enterStoryboard(win, machine) {
  await switchWorkspace(win, 'creation', '去创作页（分镜从这里进）')
  await clickOrFail(win.locator('[data-creation-document-switcher]').first(), '点文稿名 ▾')
  await clickOrFail(win.getByRole('menuitem', { name: machine.storyboardTitle }).first(), `点分镜方案「${machine.storyboardTitle}」`)
  await expect(win.locator('[data-workspace-mode="storyboard"]').first(), '进了分镜页').toBeVisible()
}

async function expectBoxes(win, machine, where) {
  for (const [offset, prompt] of machine.prompts.entries()) {
    await expect(win.locator(BOX(offset + 1)).first(), `${where}：第 ${offset + 1} 镜提示词框里是落盘的「${prompt}」`).toHaveText(prompt)
  }
  console.log(`✓ ${where}：${machine.prompts.map((prompt, offset) => `镜${offset + 1}=「${prompt}」`).join(' ')}`)
}

try {
  const machine = prepare('reentry')
  const before = sha(machine.projectFile)
  const { app, win } = await launch(machine)
  await openCard(win, machine)
  await enterStoryboard(win, machine)
  await expectBoxes(win, machine, '①打开后进分镜')

  await switchWorkspace(win, 'generation', '去生成画布')
  await enterStoryboard(win, machine)
  await expectBoxes(win, machine, '②生成画布 → 回创作再进分镜')

  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
  if (sha(machine.projectFile) !== before) throw new Error('④项目文件变了：只是看了一眼、没敲字，不许写')
  console.log('✓ ④项目文件逐字节不变')

  const library = prepare('library')
  const third = await launch(library)
  await openCard(third.win, library)
  await enterStoryboard(third.win, library)
  await leaveProjectIfOpen(third.win, uiText('zh-CN', 'appShell.topbar.backToLibrary'))
  await openCard(third.win, library)
  await enterStoryboard(third.win, library)
  await expectBoxes(third.win, library, '③回项目库 → 再开项目 → 进分镜')

  await closeNomiApp(third.app)

  const typed = prepare('typed')
  const beforeTyped = sha(typed.projectFile)
  const second = await launch(typed)
  await openCard(second.win, typed)
  await enterStoryboard(second.win, typed)
  await clickOrFail(second.win.locator(BOX(1)).first(), '点进第 1 镜提示词框')
  await second.win.keyboard.press('End')
  await second.win.keyboard.type('X')
  const edited = `${typed.prompts[0]}X`
  await expect(second.win.locator(BOX(1)).first(), '敲完框里是新字').toHaveText(edited)
  // 敲过字之后切走再回来：编辑器实例重建，框里必须是刚敲的这份，不是创建那一刻冻住的旧内容。
  await switchWorkspace(second.win, 'generation', '去生成画布')
  await enterStoryboard(second.win, typed)
  await expect(second.win.locator(BOX(1)).first(), '⑤敲过字 → 切走再回来：框里是刚敲的字').toHaveText(edited)
  await expect(second.win.locator(BOX(2)).first(), '⑤另一镜没被串').toHaveText(typed.prompts[1])
  console.log(`✓ ⑤敲过字 → 切走再回来：镜1=「${edited}」 镜2=「${typed.prompts[1]}」`)
  await second.win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(second.app)
  if (sha(typed.projectFile) === beforeTyped) throw new Error('⑥反例失败：敲了字项目文件却没变，量具不灵')
  console.log('✓ ⑥反例：敲一个字，项目文件变了')
} finally {
  cleanupTestTemp(root)
}
