#!/usr/bin/env node
// R16 真实用户任务走查：**「群里有人发我一个技能，我要在 Nomi 里用上它」** 的完整闭环。
//
// 与既有 `skill-import-formats.walk.mjs` 的分工：那条只验「文件落不落得了盘」。
// 这条验的是用户真正在乎的那件事——**导进来之后用得上吗**。两者的差别不是学术的：
// 2026-09-07 真机探针实拍到这一幕（`docs/lessons` 未收，见本 PR 正文）：
//   左边技能库里刚导进来的卡片好好地立着，右边 Agent 的 `/` 技能菜单里**一个字都没有它**。
// 五门全绿、单测全绿、旧走查全绿——因为没有任何一条走查跨过「面板」与「Agent」这条缝。
//
// 三种真实输入（都是用户手上真会有的形状）：
//   ① hermes / workbuddy 风格 zip：外面套一层文件夹 + `references/` 附件 + 一个二进制。
//   ② pi / bigpowers 生态的**技能文件夹**（`audit-code/SKILL.md`）——系统文件对话框根本选不中，
//      今天用户只能自己先压成 zip。松手拖进来是它唯一顺手的路。
//   ③ 只有 `skill.json` 的旧包（我们自己 v1 的形状）：必须**报得出人话 + 说得出下一步**，
//      不能只甩一句「没找到 SKILL.md」。
//
// 零额度：文本模型走 `agent-runtime-fixture` 的 loopback，不打任何真供应商。
//
// ② 的边界说清楚（别自证）：Playwright / Electron 都**无法**发起一次真正的操作系统文件夹拖拽。
// 这里合成的是 `drop` 事件与 FileSystemEntry 树，File 本体是真的。也就是说：
// 从 DOM 事件往下的每一层（收件 → 解析 → IPC → 主进程校验 → 落盘 → 面板 → Agent 菜单 → 模型请求）
// 都是真的跑了一遍，唯独「操作系统把文件夹递给渲染进程」这一跳是合成的。目录遍历本身的语义
// 由 `src/workbench/skillLibrary/skillDropIntake.test.ts` 单测覆盖。
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { clickOrFail, expect, proveProbe, screenshotSettled } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE, CANVAS_PANEL, COMPOSER_CHIP, COMPOSER_SKILL, SKILL_POPOVER,
  chooseAssistantModel, createRuntimeWalk, openCanvas, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

/** 每个技能正文里埋一句只属于它的话：断言「模型真的收到了这份方法论」时不会认错人。 */
const ZIP_MARK = 'WALKMARKZIP：先定调子再定镜头。'
const FOLDER_MARK = 'WALKMARKFOLDER：先按 churn 排序再逐个走查。'
const REPLY = 'WALK_SKILL_LOADED：我按这份方法论来。'

const zipSkill = ['---', 'name: walk-hermes-zip', 'description: 走查·hermes 风格 zip', '---', '', ZIP_MARK].join('\n')
const folderSkill = ['---', 'name: walk-pi-folder', 'description: 走查·pi 生态技能文件夹', '---', '', FOLDER_MARK].join('\n')

const walk = await createRuntimeWalk('skill-import-real-use')
const shotDir = process.env.NOMI_WALK_SHOT_DIR || walk.report.outputDir
fs.mkdirSync(shotDir, { recursive: true })
const dropDir = path.join(walk.report.tempRoot, 'drop')
fs.mkdirSync(dropDir, { recursive: true })

// ① 群里转发来的 zip：GitHub / hermes 导出的形状就是外面套一层同名文件夹。
const zipPath = path.join(dropDir, 'walk-hermes-zip.zip')
fs.writeFileSync(zipPath, Buffer.from(zipSync({
  'walk-hermes-zip-main/SKILL.md': strToU8(zipSkill),
  'walk-hermes-zip-main/references/shots.md': strToU8('镜头清单正文'),
  'walk-hermes-zip-main/logo.png': strToU8('pretend-binary'),
})))

// ③ 旧 v1 包：只有 skill.json，没有正文。
const legacyZipPath = path.join(dropDir, 'walk-legacy-manifest.zip')
fs.writeFileSync(legacyZipPath, Buffer.from(zipSync({
  'walk-legacy/skill.json': strToU8(JSON.stringify({ name: 'walk-legacy', description: '旧格式：只有清单' })),
})))

const userSkillsRoot = path.join(walk.report.tempRoot, 'settings', 'skills')
const skillDirs = () => (fs.existsSync(userSkillsRoot)
  ? fs.readdirSync(userSkillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : [])

/** 合成一次「把文件夹拖进技能库面板」。文件夹树是假的，File 与其后的每一层都是真的。 */
async function dropFolder(win, { folderName, files }) {
  await win.evaluate(({ folderName, files, selector }) => {
    const makeFile = (name, text) => ({
      name, isFile: true, isDirectory: false,
      file: (ok) => ok(new File([text], name, { type: 'text/markdown' })),
    })
    const makeDir = (name, children) => ({
      name, isFile: false, isDirectory: true,
      createReader: () => {
        let done = false
        return { readEntries: (ok) => { ok(done ? [] : children); done = true } }
      },
    })
    const children = Object.entries(files).map(([name, text]) => makeFile(name, text))
    const root = makeDir(folderName, children)
    const dataTransfer = {
      types: ['Files'],
      files: [],
      items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => root }],
    }
    const target = document.querySelector(selector)
    if (!target) throw new Error(`没有找到技能库的松手区（${selector}）——多半是这块面板没渲染`)
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      target.dispatchEvent(event)
    }
  }, { folderName, files, selector: '[data-skill-drop-zone]' })
}

/** 轮询等技能目录出现（R18：走查不写私有墙钟 waitFor，等的是盘上的真实结果）。 */
async function waitForSkillDir(win, dirName, label) {
  const deadline = Date.now() + 15_000
  for (;;) {
    // 等的是 **SKILL.md 落到位**，不是目录出现：`mkdirSync` 一跑目录就存在了，
    // 此时读包里的文件会 ENOENT——只等目录名会时不时红成一次假故障。
    if (skillDirs().includes(dirName) && fs.existsSync(path.join(userSkillsRoot, dirName, 'SKILL.md'))) return
    if (Date.now() > deadline) {
      throw new Error(`${label}：等满 15s，${userSkillsRoot} 里没出现 ${dirName}（现有：${skillDirs().join(', ') || '空'}）`)
    }
    await win.waitForTimeout(200)
  }
}

/**
 * 证据截图必须等画面安定。第一版用裸 `win.screenshot()`，拍到的失败回执正卡在 140ms 的
 * 滑入动画里、右半截还在屏幕外——那张图看着像「toast 被裁了」的 bug，其实是快门太快
 * （同族坑见 docs/lessons/walkthrough-computed-color-asserts.md）。
 */
async function shot(win, name) {
  const file = path.join(shotDir, `${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`SHOT: ${file}`)
  return file
}

let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)

  // ── 用户第一步：找到技能住在哪 ─────────────────────────────────────────────
  await clickOrFail(win.getByRole('button', { name: '技能库', exact: true }).first(), '侧栏「技能库」')
  const panel = win.locator('[data-skill-drop-zone]')
  await expect(panel, '技能库面板没渲染').toBeVisible()
  // 空态必须说得出「别人发来的技能怎么进来」——只指「用 AI 新建」等于把手上已有文件的用户晾着。
  await expect(
    panel.getByText('拖进这块面板', { exact: false }).first(),
    '技能库空态没有告诉用户「别人发来的技能怎么导进来」',
  ).toBeVisible()
  await shot(win, '01-skill-panel-entry')

  expect(skillDirs(), '走查开始时用户技能目录应为空').toEqual([])

  // ── ① hermes 风格 zip：走用户真实路径（点导入 → 选文件） ─────────────────────
  // input 必须钉在**技能库面板内部**。这一屏上还有画布工具栏和 composer 各自的
  // `input[type="file"]`，全页 `.first()` 是个竞态选择器：谁先挂载就选谁
  // （既有 skill-import-formats 走查正栽在这上面，本 PR 一并修）。
  const fileInput = panel.locator('input[type="file"]').first()
  await fileInput.waitFor({ state: 'attached' })
  await fileInput.setInputFiles(zipPath)
  await waitForSkillDir(win, 'walk-hermes-zip', 'hermes 风格 zip 导入')
  const refFile = path.join(userSkillsRoot, 'walk-hermes-zip', 'references', 'shots.md')
  expect(fs.existsSync(refFile), 'zip 里的 references/ 附件没落盘（子目录被削平了）').toBe(true)
  expect(fs.existsSync(path.join(userSkillsRoot, 'walk-hermes-zip', 'logo.png')), '二进制不该进知识层包').toBe(false)
  await expect(panel.getByText('走查·hermes 风格 zip', { exact: false }).first()).toBeVisible()

  // ── ② pi 生态的技能文件夹：松手就进来 ───────────────────────────────────────
  await dropFolder(win, { folderName: 'audit-code', files: { 'SKILL.md': folderSkill, 'references/notes.md': '附件正文' } })
  await waitForSkillDir(win, 'walk-pi-folder', '技能文件夹拖入')
  await expect(
    panel.getByText('走查·pi 生态技能文件夹', { exact: false }).first(),
    '文件夹导进来了但面板里看不见',
  ).toBeVisible()
  await shot(win, '02-two-skills-imported')

  // ── ③ 只有 skill.json 的旧包：报得出人话，也说得出下一步 ─────────────────────
  // 先等前两条成功回执散掉。toast 容器 `limit={2}`（NomiAppProviders.tsx），前面挤着两条时
  // 第三条只会排队——真实用户是一次导一个，这里不制造一个不真实的拥挤现场。
  const toasts = win.locator('.mantine-Notification-root')
  await expect(toasts).toHaveCount(0, { timeout: 15_000 })
  await fileInput.setInputFiles(legacyZipPath)
  // 断言必须钉在**这条失败回执**上：早先写成全页 getByText('SKILL.md') 时它命中的是空态
  // 里那句导入提示——一条恒真的假绿（docs/lessons/dead-selector-lies-both-ways.md）。
  await expect(
    toasts.getByText('技能的正文就住在 SKILL.md 里', { exact: false }).first(),
    '旧 skill.json 包导入失败时，用户没有看到一条说得出下一步的失败回执',
  ).toBeVisible()
  expect(skillDirs(), '没有正文的包不该落盘').toEqual(['walk-hermes-zip', 'walk-pi-folder'])
  await shot(win, '03-legacy-manifest-rejected')

  // ── 用户第二步：在 Agent 里用上它（这一段就是那条缝） ────────────────────────
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SKILL}`), 'Agent composer 的「技能」钮')
  const popover = win.locator(`${CANVAS_PANEL} ${SKILL_POPOVER}`)
  await expect(popover).toBeVisible()
  // 阳性对照：菜单里本来就该有内置技能，证明这一屏确实是活的技能菜单而不是一个空壳。
  await proveProbe(
    popover.locator('[data-v4-command^="skill:"]'),
    '技能菜单里连内置技能都没有——这一屏不是活的，下面的断言不作数',
  )
  await expect(
    popover.getByText('走查·hermes 风格 zip', { exact: false }).first(),
    '刚导进来的技能没有出现在 Agent 的技能菜单里：用户导进来了却用不上（只能靠重启 App 撞见）',
  ).toBeVisible()
  await expect(
    popover.getByText('走查·pi 生态技能文件夹', { exact: false }).first(),
    '拖进来的技能文件夹没有出现在 Agent 的技能菜单里',
  ).toBeVisible()
  await shot(win, '04-agent-skill-menu')

  await clickOrFail(popover.getByText('走查·hermes 风格 zip', { exact: false }).first(), 'Agent 菜单里刚导入的技能')
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER_CHIP}`), '选中技能后 composer 上没有出现技能 chip').toBeVisible()
  await shot(win, '05-skill-chip-attached')

  // ── 用户第三步：发一条，看这份方法论是不是真的进了模型 ──────────────────────
  const turn = walk.fixture.expectText({
    label: '带着刚导入的技能发出的一轮',
    match: (body) => flattenRequestText(body).includes(ZIP_MARK),
    reply: { type: 'text', text: REPLY },
  })
  await sendCanvas(win, '按这份技能给我一句开场。')
  const wire = await recorded(turn.received, '带技能的模型请求')
  expect(
    flattenRequestText(wire.body).includes(ZIP_MARK),
    '模型请求里没有刚导入的 SKILL.md 正文——chip 画上了，方法论没送到',
  ).toBe(true)
  // 只装了一个技能，另一个的正文不该被一起灌进去（技能互斥：装两套说法会互相打架）。
  // 这条直接验**同一份报文**——同一次请求里既证到了 ZIP_MARK 在、又证 FOLDER_MARK 不在，
  // 现场是同一个、可证伪的，不是在一个本来就不可能出现它的地方断言「没看到」。
  expect(
    flattenRequestText(wire.body).includes(FOLDER_MARK),
    '同一次请求里混进了没装上的那个技能的正文（技能应当互斥）',
  ).toBe(false)
  await expect(win.locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`)).toContainText(REPLY)
  await shot(win, '06-agent-answered-with-skill')

  console.log(`SKILL IMPORT REAL USE PASS: ${skillDirs().join(', ')}`)
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}
