// R16 真实任务闭环：自定义提示词到底有没有真的作用到模型上（2026-08-18）。
//
// 前面那份 prompt-picker.walk.mjs 只证明了「选得到」。这份要证明「选了有用」——
// 走真模型、花真额度，把同一句话在「通用」和自定义提示词下各跑一次做**对照**。
// 没有对照组的话，模型碰巧写得像口播稿，也会被当成「提示词生效了」（假绿）。
//
// 凭据：从用户真实 userData 复制 model-catalog.json 到隔离目录 —— 用真 key，
// 但绝不往用户正式配置里写我的测试提示词。
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectCount, scopedText, screenshotSettled } from './_assert.mjs'
import {
  COMPOSER_INPUT, COMPOSER_SEND, COMPOSER_SKILL, CREATION_PANEL, SKILL_POPOVER, SKILL_SEARCH,
  V4_FLOW, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-r16-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/custom-prompt-realtask')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const REAL_CATALOG = path.join(os.homedir(), 'Library/Application Support/Nomi/model-catalog.json')
if (!fs.existsSync(REAL_CATALOG)) {
  console.error(`拿不到真实模型目录：${REAL_CATALOG}\n没有真凭据就跑不了真任务——这条不能用假绿糊过去。`)
  process.exit(1)
}
fs.copyFileSync(REAL_CATALOG, path.join(settingsDir, 'model-catalog.json'))

const projDir = path.join(projectsDir, 'r16-0001')
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const project = {
  id: 'r16-0001', name: '自定义提示词真实任务', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: {
      version: 1, title: '真实任务', updatedAt: 1,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '产品：一款给通勤族的保温杯，316 不锈钢，12 小时保温，杯盖一键弹开单手可开。' }] }] },
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
for (const t of [path.join(projDir, 'project.json'), path.join(projDir, '.nomi', 'project.json')]) {
  fs.writeFileSync(t, JSON.stringify(project, null, 2))
}

// 这段提示词刻意写得**可核对**：三个结构要求 + 一条禁令。判定不靠感觉，靠这四条对着数。
const CUSTOM_PROMPT = [
  '本轮任务：写口播带货脚本。严格按下面的结构，不要写成产品说明或文案分析。',
  '1. 前三秒必须是一个钩子问句，直接戳中用户的困扰。',
  '2. 中段必须描述一个具体的通勤场景（有时间、地点、动作），不要泛泛而谈。',
  '3. 结尾必须给一个促单理由。',
  '全程用第二人称「你」跟观众说话。',
  '禁止使用「首先」「其次」「然后」「总之」这类书面连接词。',
].join('\n')

const ASK = '给这个保温杯写一段口播'

const { app, win } = await launchNomiApp({ name: 'r16-custom-prompt', tempRoot, settingsDir, projectsDir, settleMs: 1500 })

const findings = []
const record = (name, ok, detail) => {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}
const snap = async (n) => { await screenshotSettled(win, { path: path.join(shotsDir, `${n}.png`) }) }
async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

// 2026-09-06 拍板③：提示词库并进 composer 的 `/` 命令菜单（Skill 钮），
// 现役已没有独立的「提示词选择器 chip」——选中与否由 Skill 钮的 aria-pressed 说了算。
const skillButton = () => win.locator(`${CREATION_PANEL} ${COMPOSER_SKILL}`)
const composer = () => win.locator(`${CREATION_PANEL} ${COMPOSER_INPUT}`).first()

/**
 * 发一句话并等模型把话说完。
 *
 * 完成信号走共享的 waitForV4TurnIdle（composer 进入运行态→退出，由 turn 控制器驱动），
 * **不能**用「气泡文本不再变」——首跑就栽在这：pending 态气泡的文本恒为作者名「Nomi」，
 * 所谓「连续几次不变」在模型还没吐第一个字时就满足了，于是拿着 4 个字的作者名当产出去做判定，
 * 四条断言全红，看起来像功能坏了，其实是等待写错了。判定源只此一处，全仓复用。
 */
// Host cutover retired the creation-AI panel; the transcript now lives in the ResidentShell dock
// (resident by default since 2026-09-05). 2026-09-06 起它是 v4 的对话流 [data-v4-flow]，
// 每条是一个 [data-v4-block] 积木。
const messages = () => win.locator(`${CREATION_PANEL} ${V4_FLOW}`)

async function ask(text, tag) {
  await composer().fill(text)
  await win.waitForTimeout(300)
  // v4 的发送钮空态是真 disabled，填完再点；Enter 与它走同一条 canSend 判据。
  await win.locator(`${CREATION_PANEL} ${COMPOSER_SEND}`).click()
  await win.waitForTimeout(300)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL })
  await win.waitForTimeout(800)
  await snap(tag)
  // 只读最后一条助手气泡这一个容器，不读整页（整页会把我 seed 的文稿/用户消息一起算进「产出」）。
  const last = messages().locator('[data-v4-block="assistant"]').last()
  return (await scopedText(last)).trim()
}

try {
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1600)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const s = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await s.isVisible().catch(() => false)) await s.click({ timeout: 1000 }).catch(() => {})
  }
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${project.name}」`)
  await card.hover()
  const cont = card.getByText('继续创作', { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click(); else await card.dblclick()
  // 「项目开好了」的真信号 = 顶部「创作」导航出现，不是等够 2 秒。
  const creation = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creation, '打开项目后没等到顶部「创作」导航')
  await creation.click()
  await expectVisible(win.getByLabel('创作区', { exact: true }), '点了「创作」但创作区没出现')
  // 输入框挂好了才发得出第一句话——等它本身，别拿 sleep 赌（赌短了 fill 打空，整轮白跑真额度）。
  await expectVisible(composer(), 'composer 输入框没挂出来')

  // ── 对照组：默认「通用」提示词下问同一句 ──
  console.log('\n【对照组】通用提示词下跑一次…')
  const baseline = await ask(ASK, '01-baseline-general')
  console.log(`  产出 ${baseline.length} 字`)
  record('对照组拿到真实产出', baseline.length > 40, `通用模式下模型回了 ${baseline.length} 字（真模型、真额度）`)

  // ── 新建自定义提示词 ──
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } })))
  const heading = win.getByText('系统提示词', { exact: true }).first()
  // 设置面板异步挂载：等标题出现，别拿 sleep 赌（赌短了后面 click「新建」直接抛，整轮真额度白花）。
  await expectVisible(heading, '设置 → AI 里找不到「系统提示词」区')
  await heading.scrollIntoViewIfNeeded().catch(() => {})
  // Scope the action to the settings prompt section. A generic "新建" query
  // can resolve to the always-mounted creation toolbar behind the modal and
  // make Playwright report a false interaction failure.
  const newChip = win.locator('[data-settings-prompt-create]').first()
  await expectVisible(newChip, '设置页里找不到「新建」自定义提示词的入口')
  await newChip.click()
  const nameInput = win.locator('[data-settings-field="system-prompt-name"]').first()
  // 名字输入框出现 = 真的进了「新建一条」的状态，可以往里填了。
  await expectVisible(nameInput, '点了「新建」但名字输入框没出现')
  await nameInput.fill('口播带货体')
  await win.locator('[data-settings-field="system-prompt"]').first().fill(CUSTOM_PROMPT)
  await win.waitForTimeout(1600)
  await snap('02-custom-created')
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(1000)

  // ── 选中它（走 `/` 命令菜单的「提示词」段）──
  await skillButton().click()
  const skillMenu = win.locator(`${CREATION_PANEL} ${SKILL_POPOVER}`)
  await expectVisible(skillMenu, '点了 Skill 钮但 `/` 命令弹层没出现')
  await skillMenu.locator(SKILL_SEARCH).fill('口播带货体')
  const customOption = skillMenu.locator('[data-v4-command^="prompt:"]').filter({ hasText: '口播带货体' })
  await expectCount(customOption, 1, '刚建的「口播带货体」应当出现在 `/` 命令菜单的提示词段里')
  await customOption.first().click()
  // 选中了 = Skill 钮进入按下态。这一步必须硬等：没选中就跑实验组，等于拿通用档的产出去验自定义提示词。
  const picked = await skillButton().getAttribute('aria-pressed').then((value) => value === 'true').catch(() => false)
  record('自定义提示词已选中', picked, `Skill 钮 aria-pressed=${picked}`)

  // ── 实验组：同一句话再跑一次 ──
  console.log('\n【实验组】自定义提示词下跑同一句…')
  const treated = await ask(ASK, '03-custom-output')
  console.log(`  产出 ${treated.length} 字`)

  console.log('\n──────── 两次产出全文 ────────')
  console.log('\n【通用】\n' + baseline)
  console.log('\n【口播带货体】\n' + treated)

  // ── 对着提示词里那四条硬要求逐条数 ──
  const hasHook = /[？?]/.test(treated.slice(0, 60))
  const secondPerson = (treated.match(/你/g) || []).length >= 3
  const noBookish = !/首先|其次|然后|总之/.test(treated)
  const differs = treated.trim() !== baseline.trim()

  record('① 开头是钩子问句', hasHook, hasHook ? '前 60 字内出现问句' : '开头没有问句')
  record('② 全程第二人称', secondPerson, `出现「你」${(treated.match(/你/g) || []).length} 次（要求 ≥3）`)
  record('③ 没用被禁的书面连接词', noBookish, noBookish ? '未出现 首先/其次/然后/总之' : '出现了被禁的连接词')
  record('④ 与对照组产出不同', differs, differs ? '两次产出不一样 —— 提示词确实改变了行为' : '两次一模一样，提示词没起作用')

  console.log('\n──────── 小结 ────────')
  const failed = findings.filter((f) => !f.ok)
  await closeApp()
  if (failed.length > 0) {
    console.error(`${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`)
    process.exit(1)
  }
  console.log(`全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  await closeApp()
  process.exit(1)
}
