// 文本任务迁 pi-ai 单次调用的整机走查**步骤本体**（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★9 第 2、3 条）。
// 两份脚本共用这一份步骤：
//   · text-tasks-pi-ai.rehearsal.walk.mjs：零额度、不出网，本机夹具里一个「先想 35 秒再回话」的思考型模型；
//   · text-tasks-pi-ai-real.paid.mjs：协调带 key 跑一次真模型（key 只从环境变量读）。
// 五个入口：文本节点扩写（#1 流式，#1264 写作区改写的同一扇门）、文本节点改写选区（#2 同一扇流式门，完成后一次性替换选区）、
// 提示词翻译（#4）、提示词优化（#3）、视频拆解读图（#6）。每次调用打印一行摘要：入口、协议、首个可见反馈耗时、结果、错误类别。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { collapseAgentPanel } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'

export const MARK = Object.freeze({ expand: 'S_EXPAND', rewrite: 'S_REWRITE', translate: 'S_TRANSLATE', optimize: 'S_OPTIMIZE' })
const COMPOSER = '.generation-canvas-v2-node__composer'
const PROMPT_EDITOR = `${COMPOSER} .generation-canvas-v2-node__prompt-input`
const SPEND_DIALOG = '[data-spend-confirm-dialog]'

/** 一行摘要（PR 正文与协调读的就是这一行）。 */
function summary(report, row) {
  report.calls ??= []
  report.calls.push(row)
  console.log(`[text-task] 入口=${row.entry} · 协议=${row.protocol} · 首个可见反馈=${row.firstFeedbackMs ?? '—'}ms · 结果=${row.result} · 错误类别=${row.errorKind ?? '—'}`)
}

/** 计时：从点下去到 `visible()` 第一次为真（首个可见反馈），再到 `done()` 为真（结果落地）。不私设墙钟：用站点预算。 */
async function timed(visible, done, { operations }) {
  const started = Date.now()
  let firstFeedbackMs = null
  await expect.poll(async () => {
    if (firstFeedbackMs === null && await visible()) firstFeedbackMs = Date.now() - started
    return done()
  }, { timeout: stationTimeout({ operations }), intervals: [100] }).toBe(true)
  return { firstFeedbackMs: firstFeedbackMs ?? Date.now() - started, totalMs: Date.now() - started }
}

export async function addTextNode(win, body) {
  await addCanvasNodeFromRail(win, 'text')
  const id = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.at(-1).id)
  const editor = win.locator(`[data-node-id="${id}"] .ProseMirror`).first()
  await clickOrFail(editor, '点进文本节点正文')
  await editor.fill(body)
  await clickOrFail(win.locator(`[data-node-id="${id}"] header[aria-label="拖动文本节点"], [data-node-id="${id}"] header[aria-label="Drag text node"]`).first(), '选中文本节点')
  return { id, editor }
}

/**
 * 跑五个入口。`expect*` 给了就逐字核结果（演练：夹具回的那句）；不给就只核「有结果、不是错误」（真模型）。
 * `operations`：真模型 / 思考 35 秒的预算档（站点预算，见 _station-budget.mjs）。
 */
export async function runTextTaskEntries(win, { report, snap, protocol = 'openai-compatible', operations = 12, expected = {}, english = false }) {
  const label = (zh, en) => (english ? en : zh)

  // ── #1 文本节点「扩写」（流式：nomi:tasks:text:stream）──────────────────────────────────────────
  {
    const { id, editor } = await addTextNode(win, `${MARK.expand} 一只猫。窗外下雨。`)
    const before = (await editor.innerText()).trim()
    await clickOrFail(win.locator('[data-text-process-box] [data-preset="expand"]'), label('点「扩写」', 'Click Expand'))
    const running = win.locator(`[data-node-id="${id}"] [data-text-node-footer="running"]`)
    // 探针先证明测得到：运行中的「正在写」确实出现过，后面的「不在了」才有意义。
    const runningProof = await proveProbe(running, '#1 进入运行：底部「正在写」')
    await snap(`${english ? 'en' : 'zh'}-01-expand-running`)
    const timing = await timed(
      async () => ((await editor.innerText()).trim() !== before),
      async () => ((await editor.innerText()).trim() !== before),
      { operations },
    )
    await expectAbsent(running, { provenBy: runningProof, message: '#1 扩写完成后退出运行' }, stationTimeout({ operations: 2 }))
    const text = (await editor.innerText()).trim()
    if (expected.expand) expect(text, '#1 扩写结果').toBe(expected.expand)
    else expect(text.length, '#1 扩写有结果').toBeGreaterThan(before.length)
    await snap(`${english ? 'en' : 'zh'}-02-expand-done`)
    summary(report, { entry: '#1 文本节点扩写（流式）', protocol, ...timing, result: 'ok', errorKind: null })
  }

  // ── #2 文本节点「改写」选区（文本流式门，增量不往画布写，完成后一次性替换选区）────────────────────────
  // 2026-10-21 之前改写走一次性 nomi:tasks:run，撞上令牌付费闸、每次 SpendNotAuthorizedError（本演练发现，协调定 A：
  // 对齐 paidNodeLedger「文本不进 Run、不要授权」）。现在不该再出现任何付费确认框——出现即回归，当场红。
  {
    const { id, editor } = await addTextNode(win, `${MARK.rewrite} 她把纸条展开了，慢慢地，像是害怕它会碎掉一样小心翼翼。`)
    await clickOrFail(editor, '点进正文')
    await win.keyboard.press('ControlOrMeta+A')
    await expect.poll(() => win.evaluate((nodeId) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta?.textGenSelection ?? '', id),
      { message: '选区已记进节点' }).toContain(MARK.rewrite)
    await clickOrFail(win.locator(`${COMPOSER} [data-text-composer="mode-menu"]:visible`).last(), label('「续写 / 改写」菜单', 'Revise menu'))
    await clickOrFail(win.getByRole('menuitemradio', { name: english ? 'Revise' : '改写', exact: true }).first(), label('选「改写」', 'Choose Revise'))
    const instruction = win.locator(`${COMPOSER} [data-text-composer="instruction"]:visible`).last()
    await instruction.fill(label('缩短这句话', 'Make it shorter'))
    const before = (await editor.innerText()).trim()
    // 发送：在「要怎么改」框里按 Ctrl+Enter（与点 ↑ 同一个 runInstruction）。
    await instruction.press('Control+Enter')
    await snap(`${english ? 'en' : 'zh'}-03-rewrite-running`)
    const dialog = win.locator(SPEND_DIALOG)
    const timing = await timed(
      async () => (await editor.innerText()).trim() !== before,
      async () => {
        if (await dialog.count()) throw new Error('#2 改写弹了付费确认框：文本不该要授权（paidNodeLedger）')
        // 节点落了错误就别干等：把错误原话带出来。
        const failed = await win.evaluate((nodeId) => {
          const node = window.__nomiCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
          return node?.status === 'error' ? String(node?.error ?? node?.meta?.lastError ?? JSON.stringify(node?.runs?.[0] ?? {})).slice(0, 600) : ''
        }, id)
        if (failed) throw new Error(`#2 改写落了错误：${failed}`)
        return (await editor.innerText()).trim() !== before
      },
      { operations },
    )
    const text = (await editor.innerText()).trim()
    if (expected.rewrite) expect(text, '#2 改写把选区换成了结果').toBe(expected.rewrite)
    await snap(`${english ? 'en' : 'zh'}-04-rewrite-done`)
    summary(report, { entry: '#2 文本节点改写选区（流式门，一次性替换）', protocol, ...timing, result: 'ok', errorKind: null })
  }

  // ── #4 提示词翻译、#3 提示词优化（流式，图片节点的提示词框）────────────────────────────────────
  {
    // 前两步的文本节点清掉（真人操作：点空白画布 → 全选 → 删除），新图片节点落在画布中间，提示词底栏不被画布底部工具条盖住。
    await win.locator('.react-flow__pane').first().click({ position: { x: 40, y: 40 } })
    await win.keyboard.press('ControlOrMeta+A')
    await win.keyboard.press('Delete')
    await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length), { message: '画布清空' }).toBe(0)
    // 右下角的 Agent 面板盖在图片节点提示词底栏的右半边上（翻译钮在它底下，点击被面板拦下）：像真人一样先把它收成小球。
    await collapseAgentPanel(win, label('收起 Agent 面板', 'Collapse the Agent panel'))
    await addCanvasNodeFromRail(win, 'image')
    const prompt = win.locator(PROMPT_EDITOR).first()
    await clickOrFail(prompt, '图片节点提示词框')
    await win.keyboard.type(`${MARK.translate} 雨后水洼里漂着一只红色纸船`, { delay: 20 })
    const before = (await prompt.innerText()).trim()
    await clickOrFail(win.locator(`${COMPOSER} [data-prompt-tool="translate"]`).first(), label('翻译钮', 'Translate button'))
    const timing = await timed(
      async () => ((await prompt.innerText()).trim() !== before),
      async () => ((await prompt.innerText()).trim() !== before),
      { operations },
    )
    const text = (await prompt.innerText()).trim()
    if (expected.translate) expect(text, '#4 翻译结果替换进提示词').toBe(expected.translate)
    await snap(`${english ? 'en' : 'zh'}-05-translate-done`)
    summary(report, { entry: '#4 提示词翻译（流式）', protocol, ...timing, result: 'ok', errorKind: null })

    await clickOrFail(win.locator(`${COMPOSER} [data-prompt-tool="optimize"]`).first(), label('优化钮', 'Optimize button'))
    await win.getByRole('textbox', { name: english ? /idea/i : /想法/ }).first().fill(`${MARK.optimize} ${label('更有雨后的氛围', 'more after-rain mood')}`)
    const runOptimize = win.getByRole('button', { name: english ? /^Optimize Prompt$/i : /^优化提示$/ }).first()
    await clickOrFail(runOptimize, label('「优化提示词」', 'Optimize prompt'))
    const apply = win.getByRole('button', { name: english ? /^Apply/i : /^应用/ }).first()
    const optimizeTiming = await timed(async () => (await apply.count()) > 0, async () => (await apply.count()) > 0, { operations })
    await snap(`${english ? 'en' : 'zh'}-06-optimize-result`)
    await clickOrFail(apply, label('「应用」', 'Apply'))
    if (expected.optimize) await expect.poll(async () => (await prompt.innerText()).trim(), { message: '#3 优化结果应用进提示词' }).toBe(expected.optimize)
    summary(report, { entry: '#3 提示词优化（流式）', protocol, ...optimizeTiming, result: 'ok', errorKind: null })
  }
}

/** 一段 4 秒、两镜（红 → 蓝，硬切）的无声小视频：拆解要能切出至少两镜。 */
export function makeTwoShotVideo(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'two-shots.mp4')
  execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', file], { stdio: 'pipe' })
  return file
}

/**
 * #6 视频拆解读图（一次性）：导入素材 → 拆解 → 等结构表。
 * 2026-10-18 用户拍板「短片不弹，长片才弹」：一共不超过 DECONSTRUCT_ASK_ABOVE_CALLS（30）次调用时，点「拆解」那一下就是确认，不弹报价卡。
 * 这条两镜小视频只有 2 次读图，所以**不会**有确认框；框要是弹了，主进程会停在付费闸上等人点，没人点它，调用就永远等不到结果——
 * 所以下面一边等结果一边盯着框，框一出现这一步就按「回归」判红，不替它点确认（那是把回归点成通过）。
 */
export async function runDeconstruct(win, { report, protocol = 'openai-compatible', video }) {
  const bytes = fs.readFileSync(video).toString('base64')
  const projectId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  const asset = await win.evaluate(async ({ b64, projectId: id }) => {
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const saved = await window.nomiDesktop.assets.importFile({ projectId: id, bytes: binary.buffer, contentType: 'video/mp4', fileName: 'two-shots.mp4', kind: 'upload' })
    return saved.ok ? { url: saved.asset.data?.url ?? '' } : { url: '', reason: String(saved.failure?.reason ?? 'unknown') }
  }, { b64: bytes, projectId })
  if (!asset.url) {
    summary(report, { entry: '#6 视频拆解读图（一次性）', protocol, firstFeedbackMs: null, totalMs: null, result: `blocked：素材导入失败（${asset.reason}）`, errorKind: 'local' })
    // 本机磁盘不够（素材导入的余量闸）是环境问题，不是被测的文本栈：记 unverified，不顶替成通过，也不让整场演练红。
    if (asset.reason === 'no-disk-space') { report.unverified = [...(report.unverified ?? []), '#6 拆解：本机磁盘余量不足，素材导入被拒（no-disk-space）'] ; return }
    throw new Error(`#6 拆解素材导入失败：${asset.reason}`)
  }
  // 照生产（factBridge.deconstructToShotTable）：主进程入口要 requestId（取消口寻址）和 projectBinding（这次拆解归哪个项目会话），
  // 缺了直接拒。binding = 当前打开项目的三维身份，取自项目记录（与渲染层 coordinator 签发的是同一份）。
  const projectBinding = await win.evaluate(async (id) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    return { projectId: id, immutableProjectUuid: record?.immutableProjectUuid, projectGeneration: record?.projectGeneration }
  }, projectId)
  if (!projectBinding.immutableProjectUuid || !Number.isSafeInteger(projectBinding.projectGeneration)) {
    throw new Error(`#6 拆解：读不到当前项目的绑定（projectBinding）：${JSON.stringify(projectBinding)}`)
  }
  const started = Date.now()
  // 调用的结果放进页面里的一个槽，走查边等边看确认框（直接 await 这次 evaluate 的话，框弹出来时走查就卡死在里面）。
  await win.evaluate(({ url, id, binding }) => {
    window.__textTaskDeconstruct = { done: false }
    window.nomiDesktop.video.deconstruct({ videoUrl: url, projectId: id, requestId: crypto.randomUUID(), projectBinding: binding }).then(
      (data) => { window.__textTaskDeconstruct = { done: true, ok: true, data } },
      (error) => { window.__textTaskDeconstruct = { done: true, ok: false, error: String(error?.message ?? error) } },
    )
  }, { url: asset.url, id: projectId, binding: projectBinding })
  let state = 'running'
  await expect.poll(async () => {
    state = (await win.locator(SPEND_DIALOG).count()) ? 'dialog' : (await win.evaluate(() => window.__textTaskDeconstruct.done)) ? 'done' : 'running'
    return state
  }, { message: '#6 拆解走完或弹出了确认框', timeout: stationTimeout({ turns: 1 }), intervals: [200] }).toMatch(/^(done|dialog)$/)
  expect(state, '#6 拆解一次性走完，不弹报价卡（2 次读图 ≤ 30 次调用）').toBe('done')
  const out = await win.evaluate(() => window.__textTaskDeconstruct)
  const totalMs = Date.now() - started
  if (!out.ok) {
    summary(report, { entry: '#6 视频拆解读图（一次性）', protocol, firstFeedbackMs: null, totalMs, result: `error: ${out.error.slice(0, 120)}`, errorKind: 'unknown' })
    throw new Error(`#6 拆解失败：${out.error}`)
  }
  // 主进程回 null = 这次拆解被停下了（取消 / 项目会话对不上 / 窗口没了）：这条演练没人点取消，所以出现就是绑定没被接受。
  if (!out.data) {
    summary(report, { entry: '#6 视频拆解读图（一次性）', protocol, firstFeedbackMs: null, totalMs, result: 'stopped（主进程回 null）', errorKind: 'unknown' })
    throw new Error('#6 拆解被主进程判成「已停」（回 null）：projectBinding 与窗口的项目会话对不上，或有人撤了它')
  }
  const failed = out.data.failedShotIndexes ?? []
  const shots = out.data.shots ?? []
  expect(shots.length, '#6 拆出至少两镜').toBeGreaterThanOrEqual(2)
  expect(failed, '#6 每一镜都读出了画面（没有失败镜）').toEqual([])
  report.deconstruct = shots.map((shot) => ({ index: shot.index, shotSize: shot.shotSize, visual: shot.visual }))
  summary(report, { entry: '#6 视频拆解读图（一次性）', protocol, firstFeedbackMs: totalMs, totalMs, result: `ok（${shots.length} 镜）`, errorKind: null })
}
