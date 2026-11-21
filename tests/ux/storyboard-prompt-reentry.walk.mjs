#!/usr/bin/env node
// 真实用户任务：离开再回来，编辑器里还是这份字——分镜提示词框、创作文稿、画布文字节点三处。
//
// 夹具：tests/fixtures/old-user-data 里 v0.24.1 那份真实旧版项目（分镜两镜，提示词「Old shot 1 / Old shot 2」；
// 一篇空文稿「Old bookshop script」；画布空）。旧项目里已落盘的字打开后照样显示。
//
// 分镜（storyboard）：
//   ① 打开 → 进分镜：第 1、2 镜框里是落盘的字；
//   ② 去生成画布 → 回创作（分镜槽被 React <Activity> 藏起再放出，编辑器实例重建）：字还在，且每一镜是自己的字；
//   ③ 回项目库 → 再开项目 → 进分镜：字还在；
//   ④ 项目文件逐字节不变（出生填入既不进撤销历史、也不回写）；
//   ⑤ 敲一个字 → 切走再回来：框里是刚敲的字，另一镜没被串；
//   ⑥ 反例（量具不是永远绿）：敲一个字，项目文件就该变。
// 分镜空框（storyboard-empty）：#1573 用户那次的样子——这一镜打开时提示词是空的（框里是占位字），敲一句，
//   ⑦ 去生成画布再回创作：框里是这句、不是占位字，另一镜没被串，落盘里也有这句。同一份旧项目，只把第 2 镜提示词清空。
// 创作文稿（creation）：在文稿里敲一句 → 去生成画布再回创作 → 回项目库再开：字在，落盘的项目文件里也有这句。
// 画布文字节点（canvas-text）：画布上加一个文字节点、敲一句 → 去创作再回画布 → 回项目库再开：字在，落盘里也有。
//
// 用法：pnpm run build && node tests/ux/storyboard-prompt-reentry.walk.mjs [--locale en] [--leg storyboard|storyboard-empty|creation|canvas-text]… [--out <截图目录>]
// 不给 --leg 四条都跑；--out 给了就在每条「回来以后」那一步存截图。隔离资料、关网，一笔都不花。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { addCanvasNode, leaveProjectIfOpen, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE = path.join(repoRoot, 'tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project')
const PLACEHOLDER = '__OLD_USER_ROOT__'
const NETWORK_GUARD = path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')
const SAVE_SETTLE_MS = 3000
const BOX = (index) => `[data-storyboard-row="${index}"] [data-prompt-box="true"] [contenteditable="true"]`
const DOC_EDITOR = '[data-creation-editor="true"] .ProseMirror'
const TEXT_NODE_EDITOR = '.generation-canvas-v2-node[data-kind="text"] .ProseMirror'

const argValues = (flag) => process.argv.flatMap((arg, index) => (arg === flag ? [process.argv[index + 1]] : []))
const locale = argValues('--locale')[0] === 'en' ? 'en' : 'zh-CN'
const LEGS = ['storyboard', 'storyboard-empty', 'creation', 'canvas-text']
const legs = argValues('--leg').length > 0 ? argValues('--leg') : LEGS
for (const leg of legs) if (!LEGS.includes(leg)) throw new Error(`未知 --leg「${leg}」，可选：${LEGS.join(' / ')}`)
const outDir = argValues('--out')[0] ? path.resolve(argValues('--out')[0]) : null
if (outDir) fs.mkdirSync(outDir, { recursive: true })
const TYPED = locale === 'en'
  ? { doc: 'Walk draft line stays after leaving', node: 'Canvas note stays after leaving', shot: 'Rainy corner, she turns back' }
  : { doc: '走查文稿：离开再回来字在', node: '画布便签：离开再回来字在', shot: '雨夜街口，她回头' }

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
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    mainRequire: [NETWORK_GUARD],
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_DISABLE_AUTO_UPDATE: '1' },
    args: ['--no-proxy-server'],
  })
}

async function shot(win, name) {
  if (!outDir) return
  const file = path.join(outDir, `${name}-${locale}.png`)
  await win.screenshot({ path: file })
  console.log(`  截图 ${file}`)
}

const openCard = (win, machine) => clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: machine.projectName }).first(), `打开项目卡「${machine.projectName}」`)
const backToLibrary = (win) => leaveProjectIfOpen(win, uiText(locale, 'appShell.topbar.backToLibrary'))

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

/** 落盘的项目文件里有没有这句（文稿正文、画布节点正文都在 project.json 的 payload 里）。 */
function expectSaved(machine, text, where) {
  if (!fs.readFileSync(machine.projectFile, 'utf8').includes(text)) throw new Error(`${where}：落盘的项目文件里没有「${text}」`)
  console.log(`✓ ${where}：落盘的项目文件里有「${text}」`)
}

async function storyboardLeg() {
  const machine = prepare('reentry')
  const before = sha(machine.projectFile)
  const { app, win } = await launch(machine)
  await openCard(win, machine)
  await enterStoryboard(win, machine)
  await expectBoxes(win, machine, '分镜①打开后进分镜')

  await switchWorkspace(win, 'generation', '去生成画布')
  await enterStoryboard(win, machine)
  await shot(win, 'storyboard-after-return')
  await expectBoxes(win, machine, '分镜②生成画布 → 回创作再进分镜')

  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
  if (sha(machine.projectFile) !== before) throw new Error('分镜④项目文件变了：只是看了一眼、没敲字，不许写')
  console.log('✓ 分镜④项目文件逐字节不变')

  const library = prepare('library')
  const third = await launch(library)
  await openCard(third.win, library)
  await enterStoryboard(third.win, library)
  await backToLibrary(third.win)
  await openCard(third.win, library)
  await enterStoryboard(third.win, library)
  await expectBoxes(third.win, library, '分镜③回项目库 → 再开项目 → 进分镜')
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
  await expect(second.win.locator(BOX(1)).first(), '分镜⑤敲过字 → 切走再回来：框里是刚敲的字').toHaveText(edited)
  await expect(second.win.locator(BOX(2)).first(), '分镜⑤另一镜没被串').toHaveText(typed.prompts[1])
  console.log(`✓ 分镜⑤敲过字 → 切走再回来：镜1=「${edited}」 镜2=「${typed.prompts[1]}」`)
  await second.win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(second.app)
  if (sha(typed.projectFile) === beforeTyped) throw new Error('分镜⑥反例失败：敲了字项目文件却没变，量具不灵')
  console.log('✓ 分镜⑥反例：敲一个字，项目文件变了')
}

async function storyboardEmptyLeg() {
  const machine = prepare('empty')
  for (const file of [machine.projectFile, path.join(path.dirname(machine.projectFile), 'project.backup.json')]) {
    const project = JSON.parse(fs.readFileSync(file, 'utf8'))
    Object.values(project.payload.storyboardDesignsByDocumentId).flat()[0].plan.shots[1].prompt = ''
    fs.writeFileSync(file, JSON.stringify(project, null, 2))
  }
  const { app, win } = await launch(machine)
  await openCard(win, machine)
  await enterStoryboard(win, machine)
  const box = (index) => win.locator(BOX(index)).first()
  await expect(box(2), '第 2 镜打开时框是空的（占位字）').toHaveText('')
  await clickOrFail(box(2), '点进第 2 镜提示词框')
  await win.keyboard.type(TYPED.shot)
  await expect(box(2), '敲完框里是这句').toHaveText(TYPED.shot)

  await switchWorkspace(win, 'generation', '去生成画布')
  await enterStoryboard(win, machine)
  await shot(win, 'storyboard-empty-after-return')
  await expect(box(2), '分镜⑦空框敲字 → 切走再回来：框里是这句，不是占位字').toHaveText(TYPED.shot)
  await expect(box(1), '分镜⑦另一镜没被串').toHaveText(machine.prompts[0])
  console.log(`✓ 分镜⑦空框敲字 → 切走再回来：镜1=「${machine.prompts[0]}」 镜2=「${TYPED.shot}」`)
  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
  expectSaved(machine, TYPED.shot, '分镜⑦')
}

async function creationLeg() {
  const machine = prepare('creation')
  const { app, win } = await launch(machine)
  await openCard(win, machine)
  await switchWorkspace(win, 'creation', '去创作页')
  const editor = () => win.locator(DOC_EDITOR).first()
  await clickOrFail(editor(), '点进文稿正文')
  await win.keyboard.type(TYPED.doc)
  await expect(editor(), '敲完文稿里是这句').toContainText(TYPED.doc)

  await switchWorkspace(win, 'generation', '去生成画布')
  await switchWorkspace(win, 'creation', '回创作页')
  await shot(win, 'creation-after-return')
  await expect(editor(), '文稿①去生成画布再回创作：字在').toContainText(TYPED.doc)
  console.log(`✓ 文稿①去生成画布再回创作：「${TYPED.doc}」在`)

  await win.waitForTimeout(SAVE_SETTLE_MS)
  await backToLibrary(win)
  await openCard(win, machine)
  await switchWorkspace(win, 'creation', '再开项目后去创作页')
  await expect(editor(), '文稿②回项目库再开：字在').toContainText(TYPED.doc)
  console.log(`✓ 文稿②回项目库再开：「${TYPED.doc}」在`)
  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
  expectSaved(machine, TYPED.doc, '文稿③')
}

async function canvasTextLeg() {
  const machine = prepare('canvas-text')
  const { app, win } = await launch(machine)
  await openCard(win, machine)
  await switchWorkspace(win, 'generation', '去生成画布')
  await addCanvasNode(win, 'text')
  const editor = () => win.locator(TEXT_NODE_EDITOR).first()
  await clickOrFail(editor(), '点进文字节点正文')
  await win.keyboard.type(TYPED.node)
  const blank = await findCanvasBlankPoint(win)
  await win.mouse.click(blank.x, blank.y)
  await expect(editor(), '敲完节点里是这句').toContainText(TYPED.node)

  await switchWorkspace(win, 'creation', '去创作页')
  await switchWorkspace(win, 'generation', '回生成画布')
  await shot(win, 'canvas-text-after-return')
  await expect(editor(), '文字节点①去创作再回画布：字在').toContainText(TYPED.node)
  console.log(`✓ 文字节点①去创作再回画布：「${TYPED.node}」在`)

  await win.waitForTimeout(SAVE_SETTLE_MS)
  await backToLibrary(win)
  await openCard(win, machine)
  await switchWorkspace(win, 'generation', '再开项目后去生成画布')
  await expect(editor(), '文字节点②回项目库再开：字在').toContainText(TYPED.node)
  console.log(`✓ 文字节点②回项目库再开：「${TYPED.node}」在`)
  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
  expectSaved(machine, TYPED.node, '文字节点③')
}

const RUN = { storyboard: storyboardLeg, 'storyboard-empty': storyboardEmptyLeg, creation: creationLeg, 'canvas-text': canvasTextLeg }

try {
  console.log(`走查语言 ${locale}；跑 ${legs.join(' / ')}`)
  for (const leg of legs) {
    console.log(`── ${leg}`)
    await RUN[leg]()
  }
} finally {
  cleanupTestTemp(root)
}
