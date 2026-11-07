// 「Agent 附图交给没声明读图能力的自配模型」整条旅程的步骤本体，唯一一份（PR #1346 的真实核对）。
// 真付费走查（agent-image-input-real.paid.mjs）与零花费演练（agent-image-input-real.rehearsal.walk.mjs）都只调它：
// 差别只在大脑（真付费是 APIMart 上真实的 GPT-5 mini，演练是夹具里按请求体里的像素作答的那个）和「发出去的请求体」从哪读。
//
// 流程（真 Electron、真 IPC、真 Agent lane、真接入页）：
//   接入（凭据由 openPaidWalk 管）→ 开项目 → 开画布 → 在**接入页**给 APIMart 手填一个模型 id（自配、没声明读图能力 = 「不知道」那一档，
//   用产品自己的判据 modelImageInputSupport 当场核对，不是「不知道」就停，不换档硬跑）→ 在 Agent 面板选它 → 权限档钉在「请求批准」→
//   两轮，每轮新对话：点「+」附一张图 → 发那一句 → 等落地（任何要人点头的卡都不替用户答，按停止）→ 从盘上的 lane 转录读这一轮 → 判分。
//     第 1 轮「看得见」：附一张现生成、带随机暗号的图，问「图里写的暗号是什么？只回暗号」，回答里有暗号 = 像素到了模型手里。
//     第 2 轮「真尺寸」：附登记真素材 image-4k-png（4K 视频抽一帧），问「用一句话说这张图里有什么」，没走错误面、有非空回答 = 没被拒、没被截断。
// 只花这一个文本模型的 token：不授权任何生成模型（openPaidWalk 已把别的生成模型一律停用），权限档「请求批准」下任何写操作都先摆卡，走查不点。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { require as tsxRequire } from 'tsx/cjs/api'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from './_assert.mjs'
import { envKeyOf } from './_paidEnvKey.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { closeSettings, openModelSettings } from './_shell.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_ADD_FILE, COMPOSER_CHIP, COMPOSER_INPUT, COMPOSER_PERMISSION, COMPOSER_SEND, COMPOSER_STOP,
  EMPTY_STATE, ERROR_BAR, USER_BUBBLE, chooseAssistantModel, composerText, newConversation, openCanvas, permissionTier,
} from './agent-runtime-walk-support.mjs'
import {
  MODEL_ID, ROUNDS, VENDOR_KEY,
  errorSurfaceOf, gaugeProblems, makeCodeWord, readCodeWordFromPng, readRoundTranscript, renderCodeWordPng, roundSettled,
  readPngHeader, scoreRealSize, scoreSawCodeWord, summarizeRounds, writeEvidenceFile,
} from './_agentImageInputScore.mjs'

/** 一轮的安全上限（不是完成条件：完成看转录里最后一条助手消息落地 + composer 退出运行态）。 */
const ROUND_TIMEOUT_MS = stationTimeout({ turns: 3 })
const TERMINAL_STAGES = new Set(['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale'])

/** 产品自己的读图三态判据（走查当场核对手填的那一行落在哪一档，不另抄一份规则）。 */
function loadImageInputJudge() {
  return tsxRequire('../../electron/ai/agentUserContent.ts', import.meta.url).modelImageInputSupport
}

// ── 备料（要在 openPaidWalk 之前做：缺素材 / 缺 ffmpeg 就在拷任何凭据之前红）─────────────────

/**
 * 备两张图：① 每次现生成、带随机暗号的点阵图；② 登记真素材 image-4k-png（取法同 agent-askback-real-model.walk.mjs：
 * 从 video-4k-hevc-10bit 的第 5 秒抽一帧，PNG 无损）。缺 NOMI_REAL_MEDIA_DIR / 缺素材直接红，不退回合成图。
 */
export function prepareImages({ codeWord = makeCodeWord() } = {}) {
  const dir = makeTempDir('agent-image-input-')
  const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
  const spec = assets.get('image-4k-png').spec
  const realFile = path.join(dir, 'reference-4k.png')
  execFileSync(ffmpeg.path, ['-v', 'error', '-y', '-ss', '00:00:05', '-i', assets.get('video-4k-hevc-10bit').file, '-frames:v', '1', realFile], { stdio: 'pipe' })
  const realBytes = fs.statSync(realFile).size
  if (realBytes < spec.minBytes) throw new Error(`抽出来的参考帧只有 ${realBytes} 字节，登记表 image-4k-png 要求 ≥${spec.minBytes}`)
  // 登记表的取法不指定位深：ffmpeg 从 10 位 HEVC 抽帧默认出 16 位 PNG（rgb48），所以这一帧比同尺寸的 8 位图大一倍。如实记下，不改取法。
  const fd = fs.openSync(realFile, 'r')
  const head = Buffer.alloc(33)
  try { fs.readSync(fd, head, 0, 33, 0) } finally { fs.closeSync(fd) }
  const header = readPngHeader(head)
  if (header.width !== spec.width || header.height !== spec.height) throw new Error(`抽出来的参考帧是 ${header.width}×${header.height}，登记表 image-4k-png 要求 ${spec.width}×${spec.height}`)
  // Agent 附件上限是产品自己声明的（mediaImportPolicy 的 agent-composer 面）：超了附不上，这一轮量不了——一分钱不花就停。
  const cap = tsxRequire('../../electron/shared/contracts/mediaImportPolicy.ts', import.meta.url).MEDIA_IMPORT_SURFACES['agent-composer'].hardCapBytes
  if (cap !== null && realBytes > cap) throw new Error(`抽出来的参考帧 ${realBytes} 字节，超过 Agent 附件上限 ${cap} 字节：附不上，第 2 轮量不了（一分钱没花）`)
  const drawn = renderCodeWordPng(codeWord.text)
  // 量具自检：暗号图读回来就是这个暗号。读不回来，第 1 轮答不出来也不是模型的错——一分钱不花就停。
  if (readCodeWordFromPng(drawn.png) !== codeWord.text) throw new Error(`暗号图自检失败：画的是 ${codeWord.text}，读回来不是`)
  const codeFile = path.join(dir, 'nomi-code.png')
  fs.writeFileSync(codeFile, drawn.png)
  return {
    dir, codeWord,
    code: { file: codeFile, bytes: drawn.png.length, width: drawn.width, height: drawn.height },
    real: { file: realFile, bytes: realBytes, width: header.width, height: header.height, bitDepth: header.bitDepth, colorType: header.colorType, attachCapBytes: cap, source: 'video-4k-hevc-10bit 第 5 秒抽一帧 → image-4k-png（登记表）' },
  }
}

// ── 接入页：给 APIMart 手填一个模型 id ─────────────────────────────────────────────

/**
 * 走可见的接入页，像创作者一样：设置 → 模型 → 点 APIMart 那一行 → 「添加其他」→ 手填框敲 id 回车 → 「自检 1 个」→
 * 等自检跑完 → 等目录里这一行可用。自检是免费的（拉一次模型清单 + 看说明卡形状），不发生成请求。
 * 返回目录里这一行的事实（供证据与「不知道」档核对）。
 */
async function addHandTypedModel(win, { vendorKey, modelId, snap }) {
  const L = (key) => uiText('zh-CN', key)
  await openModelSettings(win, { label: '接入：打开模型设置' })
  await clickOrFail(win.locator(`[data-model-home-connection="${vendorKey}"]`).first(), `模型设置首页上 ${vendorKey} 的连接行`)
  const connection = win.locator(`[data-model-settings-page="connection"][data-model-settings-vendor="${vendorKey}"]`).first()
  await expect(connection, `点连接行后进到 ${vendorKey} 的连接页`).toBeVisible()
  await clickOrFail(connection.getByRole('button', { name: L('onboardingProviders.workspace.addOtherModels'), exact: true }), '连接页上的「添加其他」')
  const addPage = win.locator('[data-model-settings-page="add"]').first()
  await expect(addPage, '进到添加模型页').toBeVisible()
  const manual = addPage.getByPlaceholder(L('onboardingProviders.modelControls.manualPlaceholder'), { exact: true })
  await expect(manual, '手填框可用（不先拉清单也能手填）').toBeEnabled()
  await manual.fill(modelId)
  await manual.press('Enter')
  const confirm = addPage.getByRole('button', { name: uiTextWith('zh-CN', 'onboardingProviders.modelControls.addModels', { count: 1 }), exact: true })
  await expect(confirm, `手填 ${modelId} 后「自检 1 个」亮起（它被自动勾上了）`).toBeEnabled({ timeout: stationTimeout({ operations: 2 }) })
  await snap('model-hand-typed')
  await clickOrFail(confirm, '「自检 1 个」')
  // 自检页是界面上的准信号（看得见就留一张图），但它可能在本机夹具秒回时一闪而过——运行本身按「选中的模型里有它」从主进程的运行清单里找，不依赖页还在不在。
  const verification = win.locator('[data-model-settings-page="verification"]').first()
  if (await verification.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true, () => false)) await snap('model-self-check-running')
  const findRun = () => win.evaluate(async (modelKey) => {
    const listed = await window.nomiDesktop?.onboarding?.certificationList?.({ limit: 10 })
    const found = (listed?.runs ?? []).find((candidate) => candidate.selectedModelKeys?.includes(modelKey))
    return found ? { id: found.id, stage: found.stage, error: found.error ?? null } : null
  }, modelId)
  await expect.poll(async () => (await findRun())?.stage ?? 'pending', { message: '接入自检跑到终态', timeout: stationTimeout({ operations: 8 }), intervals: [1_000] }).toMatch(new RegExp(`^(?:${[...TERMINAL_STAGES].join('|')})$`))
  const run = await findRun()
  if (run?.stage !== 'completed') throw new Error(`接入自检没走完（一分钱没花）：${run?.stage ?? 'unknown'}${run?.error ? `：${String(run.error).slice(0, 300)}` : ''}`)
  const readRow = () => win.evaluate(async ({ vendorKey: vendor, modelKey }) => {
    const row = ((await window.nomiDesktop?.modelCatalog?.listModels?.({})) || []).find((candidate) => candidate.vendorKey === vendor && candidate.modelKey === modelKey)
    return row ? { vendorKey: row.vendorKey, modelKey: row.modelKey, kind: row.kind, enabled: row.enabled, published: row.published, usable: row.availability?.usable === true, meta: row.meta ?? null } : null
  }, { vendorKey, modelKey: modelId })
  // 晋升是异步的：自检跑完之后，这一行才被启用并发布；等它真的是启用、已发布（没被撤下）、可用的文本模型，Agent 的模型下拉里才点得到。
  await expect.poll(async () => { const row = await readRow(); return Boolean(row?.enabled && row.published !== false && row.usable && row.kind === 'text') }, { message: `${modelId} 在目录里是启用、可用的文本模型`, timeout: stationTimeout({ operations: 4 }), intervals: [500] }).toBe(true)
  const row = await readRow()
  await snap('model-self-check-done')
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed')))
  await closeSettings(win, '接入：关设置')
  return {
    facts: { vendorKey: row.vendorKey, modelKey: row.modelKey, kind: row.kind, enabled: row.enabled, published: row.published ?? null, usable: row.usable, metaKeys: Object.keys(row.meta ?? {}).sort(), declaredImageInput: row.meta?.supportsImageInput ?? null, selfCheck: { stage: run.stage } },
    meta: row.meta,
  }
}

// ── 一轮 ───────────────────────────────────────────────────────────────────────

const assetPngs = (projectRoot) => {
  const dir = path.join(projectRoot, 'assets')
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).map(String).filter((name) => /\.png$/i.test(name)).map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size }))
    : []
}

/** 点「+」→ 选文件 → 等输入框里挂上这张图的签 → 等图落进项目素材（找不到不判红：签是界面上的准信号，落盘只是多一道保险）。 */
async function attachImage(win, projectRoot, image) {
  const before = new Set(assetPngs(projectRoot).map((entry) => entry.name))
  const chooser = win.waitForEvent('filechooser', { timeout: stationTimeout() })
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_ADD_FILE}`), '输入框的「+」')
  await (await chooser).setFiles(image.file)
  const chips = win.locator(`${CANVAS_PANEL} ${COMPOSER} ${COMPOSER_CHIP}`)
  await expect(chips.first(), '输入框里挂上了这张图的签').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  await expect(chips, '只挂了这一张').toHaveCount(1)
  const findLanded = () => assetPngs(projectRoot).find((entry) => !before.has(entry.name) && entry.bytes >= image.bytes * 0.5) ?? null
  const arrived = await expect.poll(() => findLanded() !== null, { message: '图落进了项目素材', timeout: stationTimeout({ operations: 4 }), intervals: [500] }).toBe(true).then(() => true, () => false)
  // 传好的图在输入框里会变成一枚行内引用（[data-asset-mention]，产品的设计：上传 / 粘贴 / 拖入的媒体都成同一种原子）。等它出现再往后敲字，
  // 不然它可能插进句子中间。
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT} [data-asset-mention]`), '附上的图在输入框里成了一枚行内引用').toHaveCount(1, { timeout: stationTimeout({ operations: 4 }) })
  return { sourceBytes: image.bytes, landedBytes: arrived ? findLanded().bytes : null }
}

/**
 * 像用户那样把话敲在那枚引用后面，再发出去，并证明面板真的收下了它（输入框清空，或这一轮已经在跑）。
 * 不用 fill：它会把输入框整个替掉，那枚行内引用被删，产品就按「删了引用 = 不要这张图」把附件撤掉——图根本不会跟着话发出去
 * （2026-10-28 演练第一遍就是这么量到的：话到了、附件声明 0 个）。
 */
async function sendAccepted(win, text) {
  const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  const send = win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`)
  await expect(input).toBeVisible()
  await input.focus()
  await win.keyboard.press('End')
  await win.keyboard.type(text)
  await expect.poll(() => composerText(input), { message: '这句话敲进了输入框', timeout: DEFAULT_TIMEOUT_MS }).toContain(text)
  await expect(input.locator('[data-asset-mention]'), '敲完话，那枚行内引用还在（图没被撤掉）').toHaveCount(1)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expect(send, '发送钮亮起（附件已挂好）').toBeEnabled({ timeout: stationTimeout({ operations: 8 }) })
    await clickOrFail(send, '发送这一轮的话')
    const accepted = await expect.poll(async () => (await running.count()) > 0 || (await composerText(input).catch(() => '')).trim() === '',
      { timeout: DEFAULT_TIMEOUT_MS }).toBe(true).then(() => true, () => false)
    if (accepted) return attempt
  }
  throw new Error('composer 连点 3 次发送都没收下这句话')
}

async function stopTurn(win) {
  const stop = win.locator(`${CANVAS_PANEL} ${COMPOSER_STOP}`)
  if (await stop.count()) await stop.first().click().catch(() => {})
}

/**
 * 等这一轮落地：转录里最后一条助手消息不再停在工具调用上，且 composer 退出运行态。
 * 冒出任何介入卡（批准 / 反问 / 付费）都不替用户答——按停止结束这一轮，如实记下卡的种类；面板出了错误带就记下原文。
 */
async function settleRound({ win, roundSessions, timeout = ROUND_TIMEOUT_MS, pollMs = 500 }) {
  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}`)
  const errorBar = win.locator(`${CANVAS_PANEL} ${ERROR_BAR}`)
  const facts = { interventions: [], stoppedByWalk: false, errorBar: null, timedOut: false }
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await card.count()) {
      const kind = (await card.first().getAttribute('data-kind').catch(() => null)) ?? 'unknown'
      if (!facts.interventions.includes(kind)) facts.interventions.push(kind)
      if (!facts.stoppedByWalk) { await stopTurn(win); facts.stoppedByWalk = true }
    }
    const isRunning = (await running.count()) > 0
    if (!isRunning && roundSettled(roundSessions())) return facts
    // 走查按了停止：composer 退出运行态、卡也收了，这一轮到此为止（转录可能停在工具调用上——那就是没有最终回答）。
    if (facts.stoppedByWalk && !isRunning && !(await card.count())) return facts
    if (!isRunning && Date.now() - started > 8_000 && (await errorBar.count())) {
      facts.errorBar = (await errorBar.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      return facts
    }
    await win.waitForTimeout(pollMs)
  }
  facts.timedOut = true
  await stopTurn(win)
  return facts
}

/** 一轮：新对话 → 附图 → 发话 → 等落地 → 读这一轮新出现的转录 → 判分。量具自己出的错记在 harnessError，不算模型的。 */
async function runRound({ win, projectRoot, round, index, image, codeWord, wireProbe, snap }) {
  const record = { index, id: round.id, name: round.name, ask: round.ask, startedAt: new Date().toISOString(), harnessError: null, shots: [] }
  const startedAt = Date.now()
  const before = new Set(readLaneTranscripts(projectRoot).map((session) => session.path))
  const roundSessions = () => readLaneTranscripts(projectRoot).filter((session) => !before.has(session.path))
  try {
    await newConversation(win, CANVAS_PANEL)
    await expect(win.locator(`${CANVAS_PANEL} ${EMPTY_STATE}`), '新对话的空态').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await noShare.isVisible().catch(() => false)) await noShare.click()
    record.attached = await attachImage(win, projectRoot, image)
    record.shots.push(await snap(`${round.id}-attached`))
    record.sendAttempts = await sendAccepted(win, round.ask)
    const bubble = win.locator(`${CANVAS_PANEL} ${USER_BUBBLE}`).last()
    await expect(bubble, '发出后那条用户消息在对话里').toContainText(round.ask, { timeout: DEFAULT_TIMEOUT_MS })
    await expect(bubble.locator('[data-storyboard-mention-chip]'), '发出后那条用户消息里带着这张图的行内引用（「图片1」）').toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS })
    record.shots.push(await snap(`${round.id}-sent`))
    record.settle = await settleRound({ win, roundSessions })
    const answered = await snap(`${round.id}-answered`).catch(() => null)
    if (answered) record.shots.push(answered)
  } catch (error) {
    record.harnessError = String(error?.message ?? error).split('\n')[0].slice(0, 300)
  }
  record.ms = Date.now() - startedAt
  const sessions = roundSessions()
  const transcript = readRoundTranscript(sessions)
  record.sessions = sessions.length
  record.models = transcript.models
  record.attachmentClaims = transcript.users.reduce((sum, user) => sum + user.attachmentClaims, 0)
  record.finalAnswer = transcript.finalAnswer.slice(0, 400)
  record.stopReason = transcript.stopReason
  record.errorMessage = transcript.errorMessage
  record.toolCalls = transcript.toolCalls
  record.usage = transcript.usage
  record.errorSurface = errorSurfaceOf({ errorBar: record.settle?.errorBar ?? null, stopReason: transcript.stopReason, errorMessage: transcript.errorMessage })
  record.score = round.id === 'sees-code'
    ? scoreSawCodeWord({ answer: transcript.finalAnswer, codeWord })
    : scoreRealSize({ answer: transcript.finalAnswer, errorSurface: record.errorSurface })
  if (round.id === 'sees-code' && record.errorSurface) record.score = { ...record.score, errorSurface: record.errorSurface }
  record.wire = await wireProbe?.(round, record) ?? null
  return record
}

// ── 整条旅程 ───────────────────────────────────────────────────────────────────

/**
 * 整条旅程。`journey` 由调用方传入并就地填写：中途出错时调用方手里仍有已跑完的那几轮（证据照写）。
 * @param {object} journey
 * @param {{ walk: any, paid: any, images: ReturnType<typeof prepareImages>, wireProbe?: (round: any, record: any) => any,
 *   modelId?: string, vendorKey?: string }} options
 */
export async function runImageInputJourney(journey, { walk, paid, images, wireProbe, modelId = MODEL_ID, vendorKey = VENDOR_KEY }) {
  journey.rounds ??= []
  journey.hard ??= []
  journey.shots ??= []
  const check = (id, ok, detail) => { journey.hard.push({ id, ok, detail }); return ok }
  const snap = async (label) => { const name = path.basename(await walk.snap(label)); journey.shots.push(name); return name }
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  const { facts, meta } = await addHandTypedModel(win, { vendorKey, modelId, snap })
  // 手填的这一行必须落在「不知道」档（不在内置种子里、手填也没有读图声明）。不是就停：不换成别的档硬跑，一个 token 都还没花。
  const tier = loadImageInputJudge()({ vendorKey: facts.vendorKey, modelKey: facts.modelKey, meta })
  journey.model = { ...facts, imageInputTier: tier }
  if (!check('tier-unknown', tier === 'unknown', `modelImageInputSupport(${vendorKey}/${modelId}) = ${tier}`)) {
    throw new Error(`手填的 ${vendorKey}/${modelId} 判成了「${tier}」而不是「不知道」——这条走查要验的是「不知道」那一档，停下（一个 token 没花）`)
  }
  await chooseAssistantModel(win, modelId, CANVAS_PANEL)
  const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await noShare.isVisible().catch(() => false)) await noShare.click()
  // 第一句话之前先把权限档钉在「请求批准」：这一档下任何写操作都先摆卡，走查看到卡只按停止、从不点头。
  const panel = win.locator(CANVAS_PANEL)
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), '权限档选择器')
  await clickOrFail(panel.locator(permissionTier('request')), '权限档选回「请求批准」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'request')
  for (const [index, round] of ROUNDS.entries()) {
    const image = round.id === 'sees-code' ? images.code : images.real
    const record = await runRound({ win, projectRoot, round, index: index + 1, image, codeWord: images.codeWord, wireProbe, snap })
    journey.rounds.push(record)
    const detail = record.id === 'sees-code'
      ? `暗号 ${record.score.saw ? '认出来了' : '没认出来'}（完整回暗号=${record.score.fullCodeEchoed}）`
      : `${record.score.ok ? '有回答' : `不 ok：${record.score.why}`}${record.score.deniesImage ? '，但回答像是没收到图' : ''}`
    console.log(`[image-input] 第 ${index + 1} 轮「${round.name}」${Math.round(record.ms / 1000)}s：${detail} · 请求体=${record.wire?.verdict ?? '-'}${record.harnessError ? ` · 量具错=${record.harnessError}` : ''}`)
  }
  journey.numbers = summarizeRounds(journey.rounds)
  journey.gaugeProblems = gaugeProblems(journey.rounds, { expectedModelKey: modelId })
  for (const record of journey.rounds) {
    // 请求体读到了「图被丢」的确凿证据（那句注，或完整请求体里没有图片部件）才算硬红；读不到（unknown）由模型的回答兜底。
    if (record.wire && record.wire.verdict !== 'unknown') check(`${record.id}:wire`, record.wire.verdict === 'image-in-request', record.wire.why ?? record.wire.verdict)
  }
  return journey
}

// ── 证据 ───────────────────────────────────────────────────────────────────────

/** 证据摘要写进仓库（docs/evidence/2026-10-27-vision-capability-declared/<paid|rehearsal>/report.json）。落盘前最后一道：不许有 key / 图片数据。 */
export function writeImageInputEvidence(relativeFile, report, { secrets = [] } = {}) {
  return writeEvidenceFile(relativeFile, report, { secrets: [envKeyOf(process.env), ...secrets] })
}
