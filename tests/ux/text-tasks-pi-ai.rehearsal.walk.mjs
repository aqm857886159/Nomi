#!/usr/bin/env node
// 文本任务迁 pi-ai 单次调用的 Electron 整机演练：**零额度、不出网**（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★9 第 2 条）。
// 真 Electron、真 IPC、真文本任务执行器、真 pi-ai；只有「远端模型」是本机夹具。
//
// 夹具里的模型是**思考型**：#1 扩写与 #2 改写都先想 35 秒（每 5 秒一段 reasoning_content）再给正文。35 秒 > 旧 ai@4 栈的
// 30 秒首字闸——迁移前这两步在 30 秒处红「首字 30s 未响应」（2026-10-21 写作区改写的真机症状），迁移后必须过。
// #1 扩写走流式门（nomi:tasks:text:stream，#1264 写作区改写走的同一扇门）；#2 改写走一次性门。
// 中文一轮全跑（含两条 35 秒），英文一轮短思考跑一遍出英文截图。拆解在中文轮跑一次（需要 ffmpeg 造两镜小视频）。
//
// Run: pnpm run build && node tests/ux/text-tasks-pi-ai.rehearsal.walk.mjs
// 截图：tests/ux 走查目录（walk.snap），并拷进 docs/evidence/2026-10-21-text-tasks-pi-ai/walk/。
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, chooseAssistantModel, createRuntimeWalk, openCanvas } from './agent-runtime-walk-support.mjs'
import { MARK, makeTwoShotVideo, runDeconstruct, runTextTaskEntries } from './_textTasksSteps.mjs'
import { openCanvasAnyLocale, switchAppLocale } from './_permissionTiersPaidSteps.mjs'

const THINK_FRAMES = 7
const THINK_INTERVAL_MS = 5_000
const EXPANDED = `${MARK.expand} 一只橘色的猫安静地蜷在老木窗台上，窗外细雨斜落。`
const REWRITTEN = '她小心展开纸条，怕它碎掉。'
const TRANSLATED = `${MARK.translate} A red paper boat floating in a puddle after the rain`
const OPTIMIZED = `${MARK.translate} 雨后的水洼映着灰蓝天光，一只红色纸船轻轻漂浮，水面细小涟漪。`
const SHOT_JSON = JSON.stringify({ shotSize: '全景', mood: '平静', visual: '纯色画面', onScreenText: '', imagePrompt: 'solid color frame', motionPrompt: 'static shot' })

const walk = await createRuntimeWalk('text-tasks-pi-ai-rehearsal')
const evidenceDir = path.resolve('docs/evidence/2026-10-21-text-tasks-pi-ai/walk')
const report = walk.report
let failure
try {
  // 调试单个入口用：NOMI_TEXT_WALK_ONLY=deconstruct 只跑中文轮的拆解（证据以全量那次为准）。
  const only = process.env.NOMI_TEXT_WALK_ONLY ?? ''
  for (const english of only ? [false] : [false, true]) {
    // 中文轮：#1 #2 先想 35 秒；英文轮只为出英文截图，短思考（1 段 reasoning）。
    const think = english ? { thinkFrames: 1, intervalMs: 200 } : { thinkFrames: THINK_FRAMES, intervalMs: THINK_INTERVAL_MS }
    const respond = (key, match, text, thinking = think) => walk.fixture.respond({
      label: `${english ? 'en' : 'zh'}-${key}`, match: (body) => match(flattenRequestText(body)),
      reply: { type: 'think-then-text', text, ...thinking },
    })
    respond('expand', (text) => text.includes(MARK.expand) && !text.includes('请改写'), EXPANDED)
    respond('rewrite', (text) => text.includes(MARK.rewrite), REWRITTEN)
    respond('translate', (text) => text.includes(MARK.translate) && !text.includes(MARK.optimize), TRANSLATED, { thinkFrames: 1, intervalMs: 200 })
    respond('optimize', (text) => text.includes(MARK.optimize), OPTIMIZED, { thinkFrames: 1, intervalMs: 200 })
    respond('deconstruct', (text) => text.includes('shotSize'), SHOT_JSON, { thinkFrames: 1, intervalMs: 200 })

    const { win } = await walk.start({ first: !english })
    await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
    await walk.newProject()
    // 英文轮：项目开好之后经设置页切语言（真人路径；newProject 的就绪判据认的是中文编辑区）。
    if (english) await switchAppLocale(win, 'en')
    if (english) await openCanvasAnyLocale(win)
    else await openCanvas(win)
    await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
    await win.keyboard.press('Escape')
    if (!only) await runTextTaskEntries(win, {
      report, snap: (name) => walk.snap(name), english, operations: 12,
      expected: { expand: EXPANDED, rewrite: REWRITTEN, translate: TRANSLATED, optimize: OPTIMIZED },
    })
    if (!english) await runDeconstruct(win, { report, video: makeTwoShotVideo(makeTempDir('text-tasks-video-')) })
    await walk.stopApp()
  }
  // 35 秒那两步（中文轮）确实想了 35 秒以上：迁移前它们在 30 秒处被掐。
  const zhSlow = report.calls.filter((row) => (row.entry.startsWith('#1') || row.entry.startsWith('#2')) && row.result === 'ok').slice(0, 2)
  if (!only) expect(zhSlow.length, '至少 #1 扩写（流式）在中文轮完成').toBeGreaterThan(0)
  for (const row of zhSlow) expect(row.totalMs, `${row.entry} 真的等过了 30 秒首字闸`).toBeGreaterThan(30_000)
  console.log('\ntext-tasks-pi-ai 演练通过')
} catch (error) {
  failure = error
  console.error('text-tasks-pi-ai 演练失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  try {
    fs.mkdirSync(evidenceDir, { recursive: true })
    for (const shot of report.screenshots ?? []) {
      const file = typeof shot === 'string' ? shot : shot?.path
      if (file && fs.existsSync(file)) fs.copyFileSync(file, path.join(evidenceDir, path.basename(file)))
    }
    fs.writeFileSync(path.join(evidenceDir, 'calls.json'), `${JSON.stringify(report.calls ?? [], null, 2)}\n`)
  } catch (copyError) {
    console.error('证据拷贝失败：', copyError instanceof Error ? copyError.message : String(copyError))
  }
  if (failure) process.exit(1)
}
