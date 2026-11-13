#!/usr/bin/env node
// 真实用户任务（打开不写，用户 2026-11-13 拍板「跟机器走」）：
//
// 创作者的项目文件夹放在网盘里、或和别人来回传。只是打开看一眼、什么都没点就关掉——项目文件一个字节都不许变，
// 不然网盘开始同步、对方那边冒出冲突副本。Nomi 栏开着还是收着记在这台机器上，不写进项目。
// 复盘：docs/engineering/direction-checks/2026-11-13-open-writes-project.md（修前 84 次「打开 → 不点 → 关」78 次项目文件变了）。
//
// 夹具：tests/fixtures/old-user-data 里 v0.24.1 那份真实完整的旧版项目（payload 齐全，含 editingPanelLayout）。
//   ① 零点击：4 页（创作 / 分镜 / 生成 / 预览）× 本机偏好 2 种（全新、全是小球）× 1440 宽，打开 → 去那一页 → 关，
//      断言 .nomi/project.json 逐字节不变；
//   ② 打开后在预览页点一次收起（变小球）再关 → project.json 仍不变；同一台机器（同一份资料目录）重开项目，预览页 Nomi 还是小球；
//   ③ 反例（量具不是永远绿）：打开后在创作页敲一个字 → project.json 变了。
// 夹具二：v0.20.0 那一代没有身份字段的老项目（tests/fixtures/old-user-data/projects/v0.20.0-library 的别处文件夹项目）。
//   ④ 第一次打开 → 不点 → 关：只被补写一次身份（immutableProjectUuid、projectGeneration 两个字段，别的不动）；
//      同一台机器第二次打开：项目卡不报「另一台电脑有新版本」、照常打开，关后项目文件逐字节不变；
//   ⑤ 真冲突反例：第一次打开关掉后，手工改项目文件（模拟另一台电脑改过）再开 → 项目卡照报「另一台电脑有新版本」。
// 隔离资料、关网，一笔都不花。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { AGENT_BALL, AGENT_PANEL, collapseAgentPanel, switchWorkspace } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE = path.join(repoRoot, 'tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project')
const LEGACY_FIXTURE = path.join(repoRoot, 'tests/fixtures/old-user-data/projects/v0.20.0-library/home/Elsewhere/External Project')
const PLACEHOLDER = '__OLD_USER_ROOT__'
const NETWORK_GUARD = path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')
const VIEWPORT = { width: 1440, height: 900 }
const PAGES = ['creation', 'storyboard', 'generation', 'preview']
const SURFACES = ['creation', 'storyboard', 'generation', 'preview']
const MACHINES = {
  fresh: null,
  allBall: { bySurface: Object.fromEntries(SURFACES.map((surface) => [surface, { form: 'ball', float: null, ball: null }])) },
}
/** 自动保存有去抖；等过它再关，才量得到「本来会写的那一笔」。 */
const SAVE_SETTLE_MS = 3000
const EDITOR_TEXT = '.workbench-editor .tiptap[contenteditable="true"]'

const root = makeTempDir('open-writes-nothing-')
const started = Date.now()
const results = []

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** 一台「机器」= 一份资料目录（本机形态偏好住在它的 localStorage 里）+ 一份项目副本。 */
function prepareMachine(id, fixture = FIXTURE) {
  const base = path.join(root, id)
  const settingsDir = path.join(base, 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  // 夹具里的绝对路径落盘时换成了占位符；放回到这台「机器」上，项目记着的位置就是它真实所在的位置（和老用户一样）。
  const fixtureText = fs.readFileSync(path.join(fixture, '.nomi', 'project.json'), 'utf8')
  const projectRoot = JSON.parse(fixtureText).lastKnownRootPath.replace(PLACEHOLDER, base)
  fs.cpSync(fixture, projectRoot, { recursive: true })
  const projectFile = path.join(projectRoot, '.nomi', 'project.json')
  for (const file of fs.readdirSync(path.join(projectRoot, '.nomi'))) {
    const target = path.join(projectRoot, '.nomi', file)
    if (file.endsWith('.json')) fs.writeFileSync(target, fs.readFileSync(target, 'utf8').split(PLACEHOLDER).join(base))
  }
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  fs.writeFileSync(path.join(settingsDir, 'recent-workspaces.json'), JSON.stringify([{ id: project.id, name: project.name, rootPath: projectRoot, lastOpenedAt: 1793527268200, missing: false, source: 'folder' }], null, 2))
  const storyboardTitle = Object.values(project.payload?.storyboardDesignsByDocumentId ?? {}).flat()[0]?.title
  if (fixture === FIXTURE && !storyboardTitle) throw new Error('夹具里没有分镜方案，分镜页那格走不了')
  return { base, settingsDir, projectFile, projectName: project.name, storyboardTitle }
}

/** 项目库卡片上的同步状态（`data-sync-status`，查完才出现）：ready / external-change / missing-assets / corrupt-manifest。 */
async function cardSyncStatus(win, machine) {
  const badge = win.locator('[data-project-card="true"]').filter({ hasText: machine.projectName }).first().locator('[data-sync-status]').first()
  await expect(badge, `项目卡「${machine.projectName}」查完同步状态`).toBeVisible()
  return badge.getAttribute('data-sync-status')
}

async function launchMachine(machine, { seed }) {
  const localStorage = {
    'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
    ...(seed ? { 'nomi:shell-agent-form:v1': JSON.stringify({ state: seed, version: 1 }) } : {}),
  }
  const { app, win } = await launchNomiApp({
    name: 'open-writes-nothing',
    tempRoot: machine.base,
    userDataDir: path.join(machine.base, 'user-data'),
    settingsDir: machine.settingsDir,
    projectsDir: path.join(machine.base, 'projects'),
    viewportSize: VIEWPORT,
    settleMs: 0,
    initialLocalStorage: localStorage,
    mainRequire: [NETWORK_GUARD],
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_DISABLE_AUTO_UPDATE: '1' },
    args: ['--no-proxy-server'],
  })
  return { app, win }
}

async function openProject(machine, { seed }) {
  const { app, win } = await launchMachine(machine, { seed })
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: machine.projectName }).first(), `打开项目卡「${machine.projectName}」`)
  return { app, win }
}

async function close(app, win) {
  await win.waitForTimeout(SAVE_SETTLE_MS)
  await closeNomiApp(app)
}

/** 分镜不是顶栏分段：从创作页工具条的文稿名 ▾ 里点那份分镜方案进去（和创作者的路一样）。 */
async function goToPage(win, page, machine) {
  if (page !== 'storyboard') {
    await switchWorkspace(win, page, `去「${page}」页`)
    return
  }
  await switchWorkspace(win, 'creation', '去创作页（分镜从这里进）')
  await clickOrFail(win.locator('[data-creation-document-switcher]').first(), '点文稿名 ▾')
  await clickOrFail(win.getByRole('menuitem', { name: machine.storyboardTitle }).first(), `点分镜方案「${machine.storyboardTitle}」`)
  await expect(win.locator('[data-workspace-mode="storyboard"]').first(), '进了分镜页').toBeVisible()
}

function record(name, before, after, expectChanged) {
  const changed = before !== after
  const ok = changed === expectChanged
  results.push({ name, ok, changed })
  console.log(`${ok ? '✓' : '✗'} ${name}：project.json ${changed ? '变了' : '逐字节不变'}${ok ? '' : `（期望${expectChanged ? '变' : '不变'}）`}`)
}

try {
  // ① 零点击
  for (const [machineKey, seed] of Object.entries(MACHINES)) {
    for (const page of PAGES) {
      const machine = prepareMachine(`${machineKey}-${page}`)
      const before = sha(machine.projectFile)
      const { app, win } = await openProject(machine, { seed })
      await goToPage(win, page, machine)
      await close(app, win)
      record(`零点击 · 本机偏好=${machineKey} · ${page}`, before, sha(machine.projectFile), false)
    }
  }

  // ② 点一次收起再关；同一台机器重开，Nomi 还是收起的
  {
    const machine = prepareMachine('collapse-reopen')
    const before = sha(machine.projectFile)
    let { app, win } = await openProject(machine, { seed: null })
    await switchWorkspace(win, 'preview', '去预览页')
    const panelProbe = await proveProbe(win.locator(AGENT_PANEL), '预览页 Nomi 默认停靠展开（同一个探针重开后用来证「没展开」）')
    await collapseAgentPanel(win, '点「小球」收起 Nomi')
    await close(app, win)
    record('点一次收起再关', before, sha(machine.projectFile), false)
    ;({ app, win } = await openProject(machine, { seed: null }))
    await switchWorkspace(win, 'preview', '重开后去预览页')
    await expect(win.locator(AGENT_BALL).first(), '同一台机器重开：预览页 Nomi 还是小球').toBeVisible()
    await expectAbsent(win.locator(AGENT_PANEL), { provenBy: panelProbe, message: '同一台机器重开：预览页 Nomi 没有展开' })
    results.push({ name: '重开后还记得收起', ok: true })
    console.log('✓ 同一台机器重开项目：预览页 Nomi 还是小球')
    await close(app, win)
    record('重开再关', before, sha(machine.projectFile), false)
  }

  // ③ 反例：真的敲了字，项目文件就该变
  {
    const machine = prepareMachine('typed')
    const before = sha(machine.projectFile)
    const { app, win } = await openProject(machine, { seed: null })
    await switchWorkspace(win, 'creation', '去创作页')
    await clickOrFail(win.locator(EDITOR_TEXT).first(), '点进正文')
    await win.keyboard.type('一')
    await expect(win.locator(EDITOR_TEXT).first(), '正文里有刚敲的字').toContainText('一')
    await close(app, win)
    record('反例：敲一个字', before, sha(machine.projectFile), true)
  }

  // ④ 没有身份字段的老项目：第一次打开只补写身份；第二次打开不冒假冲突、不再写
  {
    const machine = prepareMachine('legacy-twice', LEGACY_FIXTURE)
    const original = JSON.parse(fs.readFileSync(machine.projectFile, 'utf8'))
    let { app, win } = await openProject(machine, { seed: null })
    await switchWorkspace(win, 'preview', '老项目第一次打开去预览页')
    await close(app, win)
    const first = JSON.parse(fs.readFileSync(machine.projectFile, 'utf8'))
    const changedKeys = [...new Set([...Object.keys(original), ...Object.keys(first)])].filter((key) => JSON.stringify(original[key]) !== JSON.stringify(first[key])).sort()
    const onlyIdentity = changedKeys.join(',') === 'immutableProjectUuid,projectGeneration'
    results.push({ name: '老项目第一次打开只补身份', ok: onlyIdentity })
    console.log(`${onlyIdentity ? '✓' : '✗'} 老项目第一次打开：改了的字段 = ${changedKeys.join('、') || '（无）'}（期望只有 immutableProjectUuid、projectGeneration）`)
    const before = sha(machine.projectFile)
    ;({ app, win } = await launchMachine(machine, { seed: null }))
    const status = await cardSyncStatus(win, machine)
    const noConflict = status !== 'external-change'
    results.push({ name: '老项目第二次打开不报冲突', ok: noConflict })
    console.log(`${noConflict ? '✓' : '✗'} 老项目第二次打开：项目卡同步状态 ${status}（期望不是 external-change）`)
    await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: machine.projectName }).first(), '第二次打开老项目')
    await switchWorkspace(win, 'preview', '老项目第二次打开去预览页')
    await close(app, win)
    record('老项目第二次打开再关', before, sha(machine.projectFile), false)

    // ⑤ 真冲突反例：别处改过项目文件，项目卡照报
    const edited = JSON.parse(fs.readFileSync(machine.projectFile, 'utf8'))
    fs.writeFileSync(machine.projectFile, `${JSON.stringify({ ...edited, name: `${edited.name}` , updatedAt: (edited.updatedAt ?? 0) + 1 }, null, 2)}\n`)
    ;({ app, win } = await launchMachine(machine, { seed: null }))
    const conflict = await cardSyncStatus(win, machine)
    const reported = conflict === 'external-change'
    results.push({ name: '反例：真冲突照报', ok: reported })
    console.log(`${reported ? '✓' : '✗'} 反例：别处改过项目文件 → 项目卡同步状态 ${conflict}（期望 external-change）`)
    await closeNomiApp(app)
  }
} finally {
  const seconds = Math.round((Date.now() - started) / 1000)
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过 · 用时 ${seconds} 秒`)
  cleanupTestTemp(root)
  if (failed.length > 0 || results.length !== PAGES.length * Object.keys(MACHINES).length + 8) process.exitCode = 1
}
