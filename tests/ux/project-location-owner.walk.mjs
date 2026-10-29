// 「项目在哪」收敛单第一刀真机走查（docs/plan/2026-10-29-project-location-owner.md ★9）。
// 用法（先 pnpm build）：NOMI_WALK_LANG=zh|en node tests/ux/project-location-owner.walk.mjs
//
// 走的是用户报的那几件事，全部经真界面：
//   1. 建项目：「打开已有文件夹」把一个带图的项目文件夹加进库（外部盘），再「新建项目」建一个落在默认位置里的；
//   2. 在访达里给两个项目文件夹改名，同一次运行里刷新项目库：两张卡都还在，写「找不到这个文件夹」，悬停说下一步；
//   3. 关掉再开：外部那张还在库里、还写「找不到」，没被删；默认位置里那张由启动对账按新路径接回；
//   4. 「打开已有文件夹」选改名后的目录：接上原项目（同一个 id），画布上的图片照常加载；
//   5. 打开一份还在的项目文件夹的副本：被拒，说原文件夹在哪，两个文件夹都不写；
//   6. 「打开已有文件夹」选进 Nomi 自己的应用数据目录：被拒，文案说清是哪类目录；
//   7. 设置把新项目默认位置改到应用数据目录：被拒，原设置不变；
//   8. 老用户（0.24.0 已经把默认位置设在应用目录里）点新建项目：被拒，指向「设置 → 文件与保存」，什么都不建。
//
// 隔离：资料、设置、项目库、「外部盘」都在仓库 .tmp/ 下——不放系统临时目录，因为系统临时目录本身就是 Nomi 拒绝放项目的地方；
// 「文稿」也指进 .tmp（第 7 步要去掉环境变量托管的默认位置，不能让默认位置落到真实的 ~/Documents）。原生选文件夹对话框一次性替身。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { backToLibrary, canvasFitView, closeSettings, newProjectEntry, openSettings, switchWorkspace } from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { seedFinishedJourneyProject } from './fixtures/journey-project-fixture.mjs'

const repoRoot = process.cwd()
const locale = process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'
const tag = locale === 'en' ? 'en' : 'zh'
const walkRoot = path.join(repoRoot, '.tmp', `nomi-project-location-owner-${tag}`)
const userDataDir = path.join(walkRoot, 'user-data')
const settingsDir = path.join(walkRoot, 'settings')
const projectsDir = path.join(walkRoot, 'projects')
const documentsDir = path.join(walkRoot, 'documents')
const diskDir = path.join(walkRoot, 'disk')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/project-location-owner', tag)
fs.rmSync(walkRoot, { recursive: true, force: true })
fs.rmSync(shotsDir, { recursive: true, force: true })
for (const dir of [userDataDir, settingsDir, projectsDir, documentsDir, diskDir, shotsDir]) fs.mkdirSync(dir, { recursive: true })

const external = seedFinishedJourneyProject({
  projectsDir: path.join(diskDir, tag === 'en' ? 'My Works' : '作品 二〇二六'),
  projectId: `location-walk-${tag}`,
  projectName: tag === 'en' ? 'Location walk: robot short' : '走查：小机器人短片',
})
const shotIds = JSON.parse(fs.readFileSync(path.join(external.projectRoot, '.nomi', 'project.json'), 'utf8')).payload.generationCanvas.nodes.map((node) => node.id)
const renamedExternal = `${external.projectRoot}-${tag === 'en' ? 'renamed' : '改名'}`
const copyOfExternal = path.join(diskDir, tag === 'en' ? 'Backup' : '备份', `${path.basename(external.projectRoot)}-${tag === 'en' ? 'copy' : '副本'}`)
const missingLabel = uiText(locale, 'library.folderUnavailable')
const missingHint = uiText(locale, 'library.folderMissingHint')
const appDataPlace = uiText(locale, 'studio.appOwnedPlaceAppData')
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const initialLocalStorage = {
  'nomi:locale:v1': locale,
  'nomi-color-scheme': 'light',
  'nomi:splash:v1': 'seen',
  'nomi:journey-tour:v1': 'seen',
  'nomi:canvas-gesture-hint:v1': 'seen',
  __nomiE2E: '1',
}

const failures = []
const shots = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const registry = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(settingsDir, 'recent-workspaces.json'), 'utf8'))
  } catch {
    return []
  }
}
const entryOf = (id) => registry().find((entry) => entry.id === id)
const treeHash = (root) => {
  const hash = crypto.createHash('sha256')
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      hash.update(path.relative(root, full))
      if (entry.isDirectory()) visit(full)
      else hash.update(fs.readFileSync(full))
    }
  }
  visit(root)
  return hash.digest('hex')
}
const card = (win, id) => win.locator(`[data-project-card][data-project-id="${id}"]`)
// 空库时是动作卡「打开已有文件夹」，库里有项目时是顶上的「选文件夹」胶囊（data-library-open-folder）。
const openFolderButton = (win) => win.locator('[data-library-open-folder]')
  .or(win.getByRole('button', { name: new RegExp(`^${escapeRegExp(uiText(locale, 'library.openFolder'))}`) }))
const projectIdInUrl = (win) => win.evaluate(() => decodeURIComponent((location.href.match(/[?&]projectId=([^&#]+)/) || [])[1] || ''))

async function launch(round) {
  const launched = await launchNomiApp({
    name: `project-location-owner-${round}-${tag}`,
    userDataDir, settingsDir, projectsDir, settleMs: 0, initialLocalStorage,
  })
  await launched.app.evaluate(({ app }, documents) => app.setPath('documents', documents), documentsDir)
  launched.win.setDefaultTimeout(stationTimeout())
  await newProjectEntry(launched.win).waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  return launched
}

/** 下一次原生「选文件夹」对话框直接答 folder（只答一次，答完换回原来的）。 */
async function answerNextFolderPicker(app, folder) {
  await app.evaluate(({ dialog }, selected) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = async (...args) => {
      dialog.showOpenDialog = original
      const options = args.at(-1) || {}
      if (!options.properties?.includes('openDirectory')) throw new Error('expected the folder picker')
      return { canceled: false, filePaths: [selected] }
    }
  }, folder)
}

async function waitForProject(win, id, label) {
  await win.waitForFunction((projectId) => location.href.includes(`projectId=${encodeURIComponent(projectId)}`), id, { timeout: stationTimeout({ operations: 2 }) })
  check(label, (await projectIdInUrl(win)) === id, id)
}

async function snap(win, name) {
  const file = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(win, { path: file })
  shots.push(file)
  console.log(`  · shot ${file}`)
}

async function expectMissingCard(win, id, label) {
  const target = card(win, id)
  await expectVisible(target, `${label}：卡片还在项目库里`)
  await expect(target, `${label}：悬停提示说下一步`).toHaveAttribute('title', missingHint)
  await expectVisible(target.getByText(missingLabel, { exact: true }), `${label}：卡片写「${missingLabel}」`)
}

async function expectLibraryAlert(win, text, label) {
  const alert = win.getByRole('alert').filter({ hasText: text })
  await expectVisible(alert, label)
  await expect(alert, label).toHaveText(text)
  return alert
}

/** 窗口内容区改成 size（Electron 是真窗口：先改原生窗口，再对齐 Chromium 视口，同 _launchApp 的做法）。 */
async function resizeContent(app, win, size) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window, next) => window.setContentSize(next.width, next.height), size)
  await win.setViewportSize(size)
  return win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
}

let app
try {
  // ── 第一次运行：建项目 ─────────────────────────────────────────────
  let session = await launch(1)
  app = session.app
  let win = session.win

  await answerNextFolderPicker(app, external.projectRoot)
  await clickOrFail(openFolderButton(win), '项目库：打开已有文件夹（外部盘上带图的项目）')
  await waitForProject(win, external.projectId, '外部项目打开，进的是它自己的 id')
  check('登记 = 选的那个文件夹', entryOf(external.projectId)?.rootPath === external.projectRoot, entryOf(external.projectId)?.rootPath)
  await backToLibrary(win, { label: '外部项目打开后，从顶栏项目菜单回到项目库' })

  await clickOrFail(newProjectEntry(win), '项目库：新建项目（落在默认位置）')
  await win.waitForFunction(() => /[?&]projectId=/.test(location.href), undefined, { timeout: stationTimeout({ operations: 2 }) })
  const nativeId = await projectIdInUrl(win)
  const nativeRoot = entryOf(nativeId)?.rootPath
  check('新建项目落在默认位置里', Boolean(nativeRoot) && path.dirname(nativeRoot) === projectsDir, nativeRoot)
  await backToLibrary(win, { label: '新建项目后，从顶栏项目菜单回到项目库' })
  await expectVisible(card(win, external.projectId), '外部项目的卡片在库里')
  await expectVisible(card(win, nativeId), '新建项目的卡片在库里')
  await snap(win, '01-library-two-projects')

  // ── 在访达里改名，同一次运行里刷新项目库 ─────────────────────────────
  await win.waitForTimeout(1000) // 让回项目库时的保存落完，再动文件夹
  const renamedNative = `${nativeRoot}-${tag === 'en' ? 'renamed' : '改名'}`
  fs.renameSync(external.projectRoot, renamedExternal)
  fs.renameSync(nativeRoot, renamedNative)
  await win.reload({ waitUntil: 'domcontentloaded' })
  await newProjectEntry(win).waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await expectMissingCard(win, external.projectId, '改名后同一次运行：外部项目')
  await expectMissingCard(win, nativeId, '改名后同一次运行：默认位置里的项目')
  check('列表没摘登记（外部）', entryOf(external.projectId)?.rootPath === external.projectRoot, entryOf(external.projectId)?.rootPath)
  check('列表没摘登记（默认位置）', entryOf(nativeId)?.rootPath === nativeRoot, entryOf(nativeId)?.rootPath)
  check('读列表没把原文件夹建回来（外部）', !fs.existsSync(external.projectRoot))
  check('读列表没把原文件夹建回来（默认位置）', !fs.existsSync(nativeRoot))
  await card(win, external.projectId).hover()
  await snap(win, '02-renamed-same-session-not-found')

  // ── 关掉再开 ─────────────────────────────────────────────────────
  await app.close()
  app = undefined
  session = await launch(2)
  app = session.app
  win = session.win
  await expectMissingCard(win, external.projectId, '重启后：外部项目')
  check('重启后外部项目的登记还在、仍指原文件夹', entryOf(external.projectId)?.rootPath === external.projectRoot, entryOf(external.projectId)?.rootPath)
  check('重启后原文件夹没被建回来', !fs.existsSync(external.projectRoot))
  await expectVisible(card(win, nativeId), '重启后：默认位置里改名的项目被启动对账接回')
  await expect(card(win, nativeId), '默认位置里那张卡不再是「找不到」').not.toHaveAttribute('title', missingHint)
  check('默认位置里那张接到新路径', entryOf(nativeId)?.rootPath === renamedNative, entryOf(nativeId)?.rootPath)
  await card(win, external.projectId).hover()
  await snap(win, '03-after-restart-still-in-library')

  // ── 「打开已有文件夹」选改名后的目录 ─────────────────────────────────
  await answerNextFolderPicker(app, renamedExternal)
  await clickOrFail(openFolderButton(win), '项目库：打开已有文件夹（改名后的外部项目）')
  await waitForProject(win, external.projectId, '接上的是原来那个项目（同一个 id）')
  check('登记换成改名后的目录', entryOf(external.projectId)?.rootPath === renamedExternal, entryOf(external.projectId)?.rootPath)
  check('登记里这个 id 只有一条', registry().filter((entry) => entry.id === external.projectId).length === 1)
  await switchWorkspace(win, 'generation', '进生成工作区（画布）')
  await canvasFitView(win, '画布：适应视图，六张图都在眼前')
  for (const id of shotIds) {
    const image = win.locator(`[data-node-id="${id}"] img[src*="assets/generated"]`).first()
    await expectVisible(image, `画布：${id} 的图片在`)
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0), {
      message: `画布：${id} 的图片加载出来了（不是裂图）`,
      timeout: stationTimeout({ operations: 2 }),
    }).toBe(true)
  }
  check('画布上的图片节点都加载出来了', true, `${shotIds.length} 张`)
  await snap(win, '04-reopened-renamed-folder-canvas')
  await backToLibrary(win, { label: '接上改名后的项目后，从顶栏项目菜单回到项目库' })
  await expectVisible(card(win, external.projectId), '接上之后卡片在库里')
  await expect(card(win, external.projectId), '接上之后不再是「找不到」').not.toHaveAttribute('title', missingHint)
  check('接上之后原文件夹没被建回来', !fs.existsSync(external.projectRoot))

  // ── 打开一份还在的项目文件夹的副本 ───────────────────────────────────
  await win.waitForTimeout(1000) // 让回项目库时的保存落完，再复制
  fs.mkdirSync(path.dirname(copyOfExternal), { recursive: true })
  fs.cpSync(renamedExternal, copyOfExternal, { recursive: true })
  const copyHash = treeHash(copyOfExternal)
  const originalHash = treeHash(renamedExternal)
  const registryBeforeCopy = JSON.stringify(registry())
  await answerNextFolderPicker(app, copyOfExternal)
  await clickOrFail(openFolderButton(win), '项目库：打开已有文件夹（副本）')
  const copyAlert = await expectLibraryAlert(win, uiTextWith(locale, 'studio.workspaceFolderIsCopy', { name: external.projectName, path: renamedExternal }), '副本被拒，说原文件夹在哪')
  check('副本被拒：登记一个字节都没变', JSON.stringify(registry()) === registryBeforeCopy)
  check('副本被拒：副本文件夹没被写', treeHash(copyOfExternal) === copyHash)
  check('副本被拒：原文件夹没被写', treeHash(renamedExternal) === originalHash)
  await snap(win, '05-copy-rejected')
  // 窄窗（应用最小宽度）：最长的一句（带完整原路径）照样折行读完，不横向溢出
  const fullSize = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const narrow = await resizeContent(app, win, { width: 1100, height: 760 })
  await expectVisible(copyAlert, '窄窗：副本被拒的提示还在')
  check('窄窗：提示折行读完，不横向溢出', await copyAlert.evaluate((element) => element.scrollWidth <= element.clientWidth), JSON.stringify(narrow))
  await snap(win, '05b-copy-rejected-narrow')
  await resizeContent(app, win, fullSize)

  // ── 「打开已有文件夹」选进 Nomi 自己的应用数据目录 ─────────────────────
  const insideUserData = path.join(userDataDir, tag === 'en' ? 'some project' : '某个项目')
  await answerNextFolderPicker(app, insideUserData)
  await clickOrFail(openFolderButton(win), '项目库：打开已有文件夹（应用数据目录里）')
  await expectLibraryAlert(win, uiTextWith(locale, 'studio.workspaceFolderInsideApp', { place: appDataPlace }), '应用数据目录里的文件夹被拒，说清是哪类目录')
  check('被拒：应用数据目录里什么都没建', !fs.existsSync(insideUserData))
  await snap(win, '06-open-folder-inside-app-rejected')

  // ── 设置：新项目默认位置改到应用数据目录 ──────────────────────────────
  // 走查的项目库由环境变量托管（设置页只读）；去掉它，设置页才回到用户能改的默认位置（文稿已经指进 .tmp）。
  await app.evaluate(() => {
    delete process.env.NOMI_PROJECTS_DIR
  })
  const settings = await openSettings(win, { tab: 'file', label: '打开设置 → 文件与保存' })
  const section = settings.locator('[data-settings-project-location]')
  const shownPath = section.locator('[data-project-location-path]')
  await expectVisible(section, '设置里有「新项目默认位置」')
  await expect(shownPath, '默认位置是（隔离的）文稿里的项目文件夹').toHaveText(new RegExp(`^${escapeRegExp(documentsDir + path.sep)}`))
  const defaultLocation = await shownPath.textContent()
  const pickInsideApp = path.join(userDataDir, 'projects')
  await answerNextFolderPicker(app, pickInsideApp)
  await clickOrFail(section.getByRole('button', { name: uiText(locale, 'settings.file.projectLocationChange') }), '设置：更改新项目默认位置（应用数据目录里）')
  await expect(section.locator('[data-project-location-check-feedback]'), '设置：被拒，文案说清为什么').toHaveText(uiText(locale, 'settings.file.projectLocationErrorInsideApp'))
  await expect(shownPath, '设置：原位置不变').toHaveText(defaultLocation)
  check('设置：没写设置文件', !fs.existsSync(path.join(settingsDir, 'project-location.json')))
  check('设置：没在应用数据目录里建文件夹', !fs.existsSync(pickInsideApp))
  await snap(win, '07-settings-pick-inside-app-rejected')
  await closeSettings(win, '关设置')

  // ── 老用户：0.24.0 已经把默认位置设在应用数据目录里，点新建项目 ─────────
  const oldUserRoot = path.join(userDataDir, 'xiangmu')
  fs.writeFileSync(path.join(settingsDir, 'project-location.json'), `${JSON.stringify({ projectsRoot: oldUserRoot }, null, 2)}\n`)
  const entriesBeforeCreate = registry().length
  await clickOrFail(newProjectEntry(win), '项目库：新建项目（默认位置在应用数据目录里）')
  await expectLibraryAlert(win, uiTextWith(locale, 'studio.newProjectLocationInsideApp', { place: appDataPlace }), '新建被拒，指向设置换位置')
  check('新建被拒：应用数据目录里什么都没建', !fs.existsSync(oldUserRoot))
  check('新建被拒：没有多出登记', registry().length === entriesBeforeCreate, `${entriesBeforeCreate} → ${registry().length}`)
  check('新建被拒：设置没被静默改掉', JSON.parse(fs.readFileSync(path.join(settingsDir, 'project-location.json'), 'utf8')).projectsRoot === oldUserRoot)
  await snap(win, '08-new-project-inside-app-rejected')
} catch (error) {
  failures.push(String(error?.stack || error))
  console.error(error)
} finally {
  await app?.close().catch(() => {})
}

console.log(`\n截图（${shots.length} 张）：${shotsDir}`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} 条没过：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('✓ 全部通过')
