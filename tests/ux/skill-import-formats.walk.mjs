// R16 真实任务走查：用户手上是「一个 SKILL.md」或「一个 zip 包」，把它导进 Nomi 技能库。
//
// 缘起（2026-08-27 用户群反馈）：「正常用 hermes 或 workbuddy 都是导入一个 zip 包就行，包里有
// skill.md 就行了 / 现在都导入技能都必须是 json 格式」。根因是我们只认自己导出的 `.nomiskill.json`
// 信封，且路径校验禁一切子目录 —— 生态里的技能（文件夹 + SKILL.md + references/）一个都进不来。
//
// 这条走查刻意走**用户真实路径**（点侧栏 → 点导入 → 选文件 → 看 toast → 文件落盘），
// 不直接调 importSkillPackageToUserDir —— 只测 IPC 会漏掉解析器、accept 过滤、i18n 文案和刷新。
//
// 2026-09-03 更新（根因合同 2026-09-03-skill-ipc-missing-handlers）：此走查现在也覆盖
// nomi:skill:import handler 注册修复——三个 write handler 此前从 registerSkillIpc 消失，
// 导致选文件后静默失败。走查经过 IPC 层完整路径，handler 缺失立刻使 toast 不出现/报错。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { zipSync, strToU8 } from 'fflate'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-skill-import-'))
const userDataDir = path.join(base, 'user-data')
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
const dropDir = path.join(base, 'drop')
fs.mkdirSync(dropDir, { recursive: true })

// 技能库挂在项目侧栏里——项目库页没有它（探针实测），所以先种一个项目再进去。
const projectId = 'walk-skill-import-0001'
const projectRoot = path.join(projectsDir, `skill-import-${projectId}`)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId,
  name: '技能导入走查',
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

// 用户技能落在 <settingsRoot>/skills（electron/runtimePaths.ts getUserSkillsRoot）
const userSkillsRoot = path.join(settingsDir, 'skills')

const bareMd = path.join(dropDir, '随便起的文件名.md')
fs.writeFileSync(
  bareMd,
  ['---', 'name: walk-bare-md', 'description: 走查用·裸 SKILL.md', '---', '', '# 裸文件导入', '正文。'].join('\n'),
)

const zipPath = path.join(dropDir, 'walk-zipped.zip')
fs.writeFileSync(
  zipPath,
  Buffer.from(
    zipSync({
      // 刻意多包一层文件夹：GitHub 下载的 zip 就是这个形状，剥不掉前缀就会找不到 SKILL.md
      'walk-zipped-main/SKILL.md': strToU8(
        ['---', 'name: walk-zipped', 'description: 走查用·zip 包', '---', '', '# zip 导入'].join('\n'),
      ),
      'walk-zipped-main/references/shots.md': strToU8('镜头清单正文'),
      'walk-zipped-main/logo.png': strToU8('pretend-binary'),
    }),
  ),
)

const skillDirs = () =>
  fs.existsSync(userSkillsRoot)
    ? fs.readdirSync(userSkillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : []

/** 轮询等技能目录出现（走查禁私有墙钟 waitFor —— R18；这里用面板可见性 + 目录存在双条件）。 */
async function waitForSkillDir(win, dirName, label) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (skillDirs().includes(dirName)) return
    await win.waitForTimeout(200)
  }
  throw new Error(`${label}：等了 10s，${userSkillsRoot} 里没出现 ${dirName}（现有：${skillDirs().join(', ') || '空'}）`)
}

let app
try {
  ;({ app } = await launchNomiApp({
    name: 'skill-import-formats',
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

  const before = skillDirs()
  if (before.length) throw new Error(`走查前用户技能目录已非空：${before.join(', ')}`)

  // 进项目（技能库在项目侧栏里，项目库页没有）
  const projectCard = win.getByText('技能导入走查', { exact: false }).first()
  await projectCard.waitFor({ timeout: 10000 })
  await projectCard.click()
  await win.waitForTimeout(1200)
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click()
    await win.waitForTimeout(1200)
  }

  // 打开技能库（侧栏 rail 按钮 aria-label = 技能库）
  await clickOrFail(win.getByRole('button', { name: '技能库', exact: true }).first(), '侧栏「技能库」')

  // 隐藏的 file input 就是导入入口（用户点「导入文件」触发它）
  const fileInput = win.locator('input[type="file"]').first()
  await fileInput.waitFor({ state: 'attached', timeout: 8000 })

  // accept 必须真的放开了，否则用户在系统对话框里根本选不到 .md / .zip —— 这正是用户遇到的那一幕
  const accept = await fileInput.getAttribute('accept')
  for (const ext of ['.md', '.zip']) {
    if (!String(accept || '').includes(ext)) {
      throw new Error(`导入 accept 未放开 ${ext}（实际：${accept}）—— 用户在文件对话框里会选不到`)
    }
  }

  // ① 裸 SKILL.md：一个文件就该能建一个技能
  await fileInput.setInputFiles(bareMd)
  await waitForSkillDir(win, 'walk-bare-md', '裸 SKILL.md 导入')
  const bareBody = fs.readFileSync(path.join(userSkillsRoot, 'walk-bare-md', 'SKILL.md'), 'utf8')
  if (!bareBody.includes('裸文件导入')) throw new Error('裸 SKILL.md 落盘了但正文不对')

  // ② zip：剥掉外层文件夹 + 保住 references/ 子目录 + 跳过二进制
  await fileInput.setInputFiles(zipPath)
  await waitForSkillDir(win, 'walk-zipped', 'zip 导入')
  const zipDir = path.join(userSkillsRoot, 'walk-zipped')
  const refPath = path.join(zipDir, 'references', 'shots.md')
  if (!fs.existsSync(refPath)) throw new Error('zip 里的 references/ 子目录没落盘（子目录被削平了）')
  if (fs.readFileSync(refPath, 'utf8') !== '镜头清单正文') throw new Error('references/shots.md 内容不对')
  if (fs.existsSync(path.join(zipDir, 'logo.png'))) throw new Error('二进制不该进知识层包')
  if (fs.existsSync(path.join(zipDir, 'walk-zipped-main'))) throw new Error('外层文件夹前缀没剥掉')

  // ③ 技能真的出现在面板里（落盘 ≠ 用户看得见），且**描述取自标准 frontmatter**。
  // 这两条是本轮走查抓出真 bug 的那条：此前 skillIpc 只读 skill.json 的 description，
  // 没有 manifest 的技能一律显示「暂无说明」——导入成功却像张废卡。
  // 断言用作用域 locator 而不是全页 innerText：后者会把 toast 文案也算进去，等于自证。
  await expectVisible(
    win.getByText('走查用·zip 包', { exact: false }).first(),
    'zip 技能卡片没显示 frontmatter 的 description（多半又退回只读 skill.json 了）',
  )
  await expectVisible(
    win.getByText('走查用·裸 SKILL.md', { exact: false }).first(),
    '裸 md 技能卡片没显示 frontmatter 的 description',
  )

  // 眼见链（P3/R13）：断言全绿 ≠ 界面对。产一张真截图给人眼判断卡片长什么样、说明有没有被截断。
  const shotDir = process.env.NOMI_WALK_SHOT_DIR || base
  fs.mkdirSync(shotDir, { recursive: true })
  const shot = path.join(shotDir, 'skill-import-panel.png')
  await win.screenshot({ path: shot })
  console.log(`SHOT: ${shot}`)

  console.log(`SKILL IMPORT PASS: bare .md + zip(with references/) → ${skillDirs().join(', ')}`)
} finally {
  if (app) {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => {})
  }
}
