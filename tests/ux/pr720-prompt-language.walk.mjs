/**
 * R13/R16 走查 · PR #720 反馈 #1「提示词出英文」逐条复验（真实文本模型，不生成图/视频）。
 *
 * 被验的修法（docs/plan/2026-09-10-ux-feedback-triage.md §6.3 / 本轮执行记录 B1）：
 *   electron/harness/context/agentContext.ts buildLanguageRule 双语分支各加了一条
 *   「送进生成模型的提示词一律简体中文，与回复语言无关」，canvasSystemPrompt 同步。
 *   所以判据不是「助手说中文」，而是**两种界面语言下写出来的生成提示词都必须是中文**——
 *   英文界面那一遍才是真正的鉴别态（修之前那里整段英文）。
 *
 * 为什么两次界面语言各起一次 App：locale 判据在主进程（getDesktopLocale），系统提示词由
 * lane 宿主合成。会话中途在设置里切语言，本轮实测**不会**让当前这条 lane 换语言（第一版
 * 脚本就是这么栽的：英文界面下助手仍整段中文，看着像修坏了，其实根本没走到英文分支）。
 * 所以英文那一遍从冷启动就带着 en 进去，被测的确实是 buildLanguageRule 的英文分支。
 *
 * 真人动作：新建空白项目 → 进「生成」→ 在模型下拉里挑一个真实文本模型 → 打字发问 → 读回复。
 * 花费：只烧文本模型 token（两轮），不碰图/视频生成。
 *
 * 用法：node tests/ux/pr720-prompt-language.walk.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, clickOrFail } from './_assert.mjs'
import {
  CANVAS_PANEL, ASSISTANT_MESSAGE, COMPOSER, COMPOSER_INPUT, COMPOSER_SEND, COMPOSER_MODEL,
  MODEL_POPOVER, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const shots = path.join(repoRoot, 'tests/ux/shots/pr720-walkthrough')
fs.mkdirSync(shots, { recursive: true })

/** 界面语言的持久化键（真相源 src/i18n/index.ts LOCALE_STORAGE_KEY）。 */
const LOCALE_STORAGE_KEY = 'nomi:locale:v1'
/** 走查用的真实文本模型：真实 catalog 里已启用的那家中转的 deepseek（便宜档）。 */
const TEXT_MODEL = process.env.PR720_TEXT_MODEL || 'DeepSeek V3.2'

const results = []
const transcripts = {}
function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const cjkCount = (text) => (String(text).match(/[一-鿿]/g) || []).length
/** 最长的「连续英文单词」串长度——用来判「整句英文」，单个 token（模型名、4K、16:9）不算。 */
function longestEnglishRun(text) {
  let best = 0
  let run = 0
  for (const token of String(text).split(/[^A-Za-z'’-]+/)) {
    if (token && /^[A-Za-z][A-Za-z'’-]*$/.test(token) && token.length > 1) { run += 1; best = Math.max(best, run) }
    else run = 0
  }
  return best
}
/** 报红时要能看见「到底哪一串是英文」——只有一个数字没法人眼判。 */
function longestEnglishSpan(text) {
  let best = ''
  for (const chunk of String(text).split(/[^A-Za-z'’ -]+/)) {
    const words = chunk.trim().split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w) && w.length > 1)
    if (words.length > best.split(/\s+/).filter(Boolean).length) best = words.join(' ')
  }
  return best
}

/**
 * 起一次 App，用指定界面语言问一次「给我一条生成提示词」，返回助手写出来的全文。
 * locale 在首帧之前写进 localStorage，i18n 初始化时同步给主进程。
 */
async function askForPrompt({ locale, question, shotName }) {
  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-pr720-lang-${locale}-`))
  const iso = prepareIsolation(isoDir, { requireCatalog: true })
  const { app, win } = await launchNomiApp({
    name: `pr720-prompt-language-${locale}`,
    userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir,
    projectsDir: iso.projectsDir, capabilityDir: iso.capabilityDir,
    args: ['--disable-gpu'], settleMs: 0,
  })
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1680, 1050); w.center() } }).catch(() => {})
    await win.waitForLoadState('domcontentloaded')
    await win.evaluate(([key, value]) => {
      localStorage.setItem('nomi-color-scheme', 'light')
      localStorage.setItem(key, value)
      for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    }, [LOCALE_STORAGE_KEY, locale])
    await win.reload(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500)

    const uiLocale = await win.evaluate(() => document.documentElement.lang || '')
    const english = locale === 'en'

    await win.getByText(english ? /New (blank|empty) project/i : '新建空白项目', { exact: false }).first().click({ timeout: 15000 })
    await win.waitForTimeout(2500)
    await win.getByRole('button', { name: english ? 'Generate' : '生成', exact: true }).first().click({ timeout: 8000 })
    await win.waitForTimeout(2000)
    await win.locator(`${CANVAS_PANEL} ${COMPOSER}`).first().waitFor({ state: 'visible', timeout: 15000 })

    // 真人动作：在「对话」那一行的下拉里挑模型（弹层每类一行，行尾一个 NomiSelect）。
    await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`), '模型选择器')
    const popover = win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`)
    await popover.waitFor({ state: 'visible', timeout: 8000 })
    const chatTrigger = popover.locator('[data-v4-model-row]').first().locator('button').first()
    await chatTrigger.click({ timeout: 8000 })
    await win.waitForTimeout(900)
    // 作用域按 aria-controls 限死：页面上另有图片/视频两个下拉，不限死会选错行。
    const listboxId = await chatTrigger.getAttribute('aria-controls')
    if (!listboxId) throw new Error('「对话」模型下拉没有 aria-controls，无法定位选项列表')
    await win.locator(`#${listboxId} [role="option"]`)
      .filter({ hasText: new RegExp(TEXT_MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
      .click({ timeout: 8000 })
    await win.waitForTimeout(900)
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(600)
    const chosen = (await win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`).innerText().catch(() => '')).trim()

    const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
    await input.click()
    await input.fill(question)
    await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), '发送')
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, startTimeout: 30_000, doneTimeout: 240_000 })
    await win.waitForTimeout(1500)

    const blocks = win.locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`)
    const n = await blocks.count()
    const texts = []
    for (let i = 0; i < n; i += 1) texts.push((await blocks.nth(i).innerText().catch(() => '')).trim())
    await screenshotSettled(win.locator(CANVAS_PANEL).first(), { path: path.join(shots, shotName) })
    return { reply: texts.join('\n'), chosen, uiLocale }
  } finally {
    await app.close().catch(() => {})
  }
}

try {
  // 中文界面：提示词必须中文、无整句英文
  const zh = await askForPrompt({
    locale: 'zh-CN',
    question: '给「深夜街边牛肉面摊」这个镜头写一条画面生成提示词，直接把提示词本身写出来。',
    shotName: '01a-prompt-zh-ui.png',
  })
  transcripts.zh = zh
  console.log(`  · 中文界面：模型=${zh.chosen} html.lang=${zh.uiLocale}`)
  record('#1a', '中文界面：助手写出的生成提示词是中文、无整句英文',
    cjkCount(zh.reply) >= 20 && longestEnglishRun(zh.reply) < 6,
    `中文字数=${cjkCount(zh.reply)} 最长连续英文词串=${longestEnglishRun(zh.reply)}`
    + `${longestEnglishRun(zh.reply) >= 6 ? `（「${longestEnglishSpan(zh.reply).slice(0, 90)}」）` : ''}`)

  // English 界面（冷启动即英文）：回复英文，但提示词仍是中文
  const en = await askForPrompt({
    locale: 'en',
    question: 'Write me one image generation prompt for a late-night beef noodle street stall shot. Give me the prompt itself.',
    shotName: '01c-prompt-en-ui.png',
  })
  transcripts.en = en
  console.log(`  · 英文界面：模型=${en.chosen} html.lang=${en.uiLocale}`)
  record('#1b', 'English 界面：回复用英文，但生成提示词仍是中文',
    longestEnglishRun(en.reply) >= 5 && cjkCount(en.reply) >= 20,
    `html.lang=${en.uiLocale} 最长连续英文词串=${longestEnglishRun(en.reply)} 中文字数=${cjkCount(en.reply)}`)

  fs.writeFileSync(path.join(shots, 'prompt-language-results.json'), JSON.stringify({ results, transcripts }, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? `✖ ${failed.length}/${results.length} 条红` : `✅ ${results.length} 条全绿`}；全文见 prompt-language-results.json`)
  process.exitCode = failed.length ? 1 : 0
} catch (err) {
  console.log(`\n✖ 走查中断：${err?.stack || err?.message || err}`)
  fs.writeFileSync(path.join(shots, 'prompt-language-results.json'), JSON.stringify({ results, transcripts }, null, 2))
  process.exitCode = 1
}
