// catalog-media-rest-real.paid.mjs 的样本表与「带参考」那几条的界面步骤。
// 单独成文件：付费脚本一 import 就读计划文件、开窗口，零花费测试（_catalogMediaRestSamples.test.mjs）读不到它的表。
//
// 样本 = 每家一条「公开价最低的当前基础档」，按型号的**默认参数**生成（预计价写在每条旁边，按 APIMart 公开价算，
// 实际花费看花钱确认框）。带 modeId / references 的样本是 2026-11-07「按官方文档对齐」那批要真跑确认的三处：
//   · Gemini Omni 1.2 Flash Ext 首尾帧（以前 Ext 没有首尾帧）；
//   · Vidu Q4 参考生只放 1 张图（官方要 image_with_roles + role reference_image，不带角色会被当成图生）；
//   · Grok Imagine Image 2.0 官方通道不带 X-APIMart-Response-Version 头，按 data[0].task_id 取任务号。
// buildMarkers：被验修复会原样进产物的 ASCII 字面量（档案 sources 里的官方原话），产物里没有 = 跑在修复之前的构建上，openPaidWalk 拒跑。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectHidden, expectVisible } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { UI_LOCALES, uiText } from './full-walk/invariants.mjs'

export const MEDIA_REST_SAMPLES = Object.freeze({
  // 图片
  'gpt-image-2.6-flare': { kind: 'image' },
  'gemini-3.1-flash-lite-image-ext': { kind: 'image' },
  'flux-3-image-klein': { kind: 'image' },
  // 1K · medium，预计 $0.048 / 张。验：不带响应版本头、按 data[0].task_id 取任务号（若真跑被拒，再走「带头 + 执行器认 202」并补方向检查）。
  'grok-imagine-image-2.0': { kind: 'image', buildMarkers: ['Do not add this header while continuing'] },
  'hy-image-v3.5-preview': { kind: 'image' },
  'muse-image-ext': { kind: 'image' },
  'wan2.7-image': { kind: 'image' },
  // 2026-11-12 档案对文档第一批新增：默认参数下的最低清晰度（1K），只登记，付费验证由协调会话合并前各跑一次。
  'seedream-5-5': { kind: 'image' },
  // 视频
  'pixverse-v6': { kind: 'video' },
  'pixverse-v6-max': { kind: 'video' },
  'viduq3-turbo': { kind: 'video' },
  'kling-v4': { kind: 'video' },
  // 可灵 4.0 Flash：文生 · 只有 720p · 默认 5 秒（文档时长 3–20，走查按默认参数）。
  'kling-v4-flash': { kind: 'video' },
  // MiniMax H3-Max（APIMart）：文生 · 默认参数下最低清晰度与最短时长。
  'MiniMax-H3-Max': { kind: 'video' },
  'grok-imagine-video-1.5': { kind: 'video' },
  'veo3.1-fast-official': { kind: 'video' },
  'muse-video-ext': { kind: 'video' },
  'wan3.0-video-prime': { kind: 'video' },
  'flux-3-video': { kind: 'video' },
  'gemini-omni-1.2-flash': { kind: 'video' },
  // 首尾帧 · 16:9 · 720p · 10 秒，预计 $0.024 × 10 = $0.24。验：首帧、尾帧各落在 first_frame_image / last_frame_image。
  'gemini-omni-1.2-flash-ext': {
    kind: 'video', modeId: 'firstlast', modeLabelKey: 'generationCommon.composerB3.modeFirstLast',
    references: [{ slot: 'first_frame', file: 'first.png' }, { slot: 'last_frame', file: 'last.png' }],
    buildMarkers: ['(Scenario 3'],
  },
  // 参考生 · 1 张图 · 16:9 · 720p · 5 秒，预计 $0.0912 × 5 ≈ $0.46。验：1 张也按参考（role reference_image），不被当成图生。
  // referencesFirst：这个型号没有文生，生成框按节点当前方式列型号（没放参考 = 文生），不先放参考，型号菜单里就没有它。
  // 真人也是这么走的：先「+」放图，再挑型号、切方式。样本测试按目录核：没有文字那条 mapping 的型号必须写它。
  'viduq4-preview': {
    kind: 'video', modeId: 'ref', modeLabelKey: 'generationCommon.composerB3.modeReference', referencesFirst: true,
    references: [{ slot: 'image_ref', file: 'ref.png' }],
    buildMarkers: ['counts are added together'],
  },
})

// 登记了、本脚本跑不了的样本：不走画布，走 Run 路（MCP / ProductionRun 的引擎 B）。脚本待写，归 A4h 线；
// 在那之前 Run 路的角色翻译只有类测试（electron/parity/combineRolesParity.test.ts）+ 抓包，没真跑。
export const MEDIA_REST_PENDING_SAMPLES = Object.freeze({
  'wan2.7#run-path-role-reference': {
    modelKey: 'wan2.7', modeId: 'ref', route: 'Run 路（MCP / ProductionRun）', params: '720P · 2 秒', expectedUsd: 0.13,
    status: '脚本待写，归 A4h 线',
  },
})

/**
 * 计划里的型号 → 样本；不在表里或只登记未写脚本的，花钱之前就抛。
 */
export function mediaRestSampleFor(modelKey) {
  const pending = MEDIA_REST_PENDING_SAMPLES[modelKey]
  if (pending) throw new Error(`样本 ${modelKey}（${pending.route}）只登记、没有脚本：${pending.status}`)
  const sample = MEDIA_REST_SAMPLES[modelKey]
  if (!sample) throw new Error(`型号 ${modelKey} 不在付费抽检样本表里（只测每家最便宜的当前基础档，一次一条）`)
  return sample
}

/** Return field and role evidence only; uploaded URLs do not belong in the receipt. */
export function viduSampleWireReceipt(entries) {
  const creates = entries.filter(entry => entry.kind === 'allowed-request' && entry.method === 'POST'
    && new URL(entry.url).pathname === '/v1/videos/generations')
  if (creates.length !== 1 || creates[0].body?.truncated) throw new Error('Vidu 样本需要一条完整的视频提交记录')
  const body = JSON.parse(creates[0].body?.text ?? 'null')
  if (body?.model !== 'viduq4-preview' || !Array.isArray(body.image_with_roles) || body.image_with_roles.length !== 1
    || body.image_with_roles[0]?.role !== 'reference_image' || !body.image_with_roles[0]?.url
    || Object.hasOwn(body, 'image_urls') || Object.hasOwn(body, 'first_frame_image')) {
    throw new Error('Vidu 单图参考必须只出现一次，使用 reference_image 角色，不能出现扁平或首帧键')
  }
  return { creates: creates.length, fields: Object.keys(body).sort(), roles: body.image_with_roles.map(item => item.role) }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const composerOf = (win, nodeId) => win.locator(`[data-node-id="${nodeId}"] .generation-canvas-v2-node__composer`).first()
const PICKER = '[data-testid="asset-picker"]'

/** 生成方式分段里那一档的可见名字（中英两轨都认）。 */
export function sampleModeRadioName(sample) {
  return new RegExp(`^\\s*(?:${UI_LOCALES.map((locale) => escapeRegExp(uiText(locale, sample.modeLabelKey))).join('|')})\\s*$`)
}

/**
 * 经参数面板顶部「生成方式」切到样本那一档（真人会点的那个控件）；点不到就抛（点生成之前，一分钱没花）。
 * 落盘的节点 meta.archetype.modeId 变成样本那一档才算切到。
 */
export async function chooseSampleMode({ win, prepared, sample, capture }) {
  if (!sample.modeId) return
  const { projectId, nodeId } = prepared
  const modeId = async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.id === nodeId)?.meta?.archetype?.modeId ?? null
  const composer = composerOf(win, nodeId)
  const panel = win.locator('[data-agent-parameter-panel]').first()
  await clickOrFail(composer.locator('[data-parameter-summary]').first(), '生成框的参数摘要（打开参数面板）')
  await expectVisible(panel, '参数面板')
  await clickOrFail(panel.locator('[data-agent-generation-mode]').getByRole('radio', { name: sampleModeRadioName(sample) }), `参数面板顶部「生成方式」里的 ${sample.modeId}`)
  await expect.poll(modeId, { message: `点了生成方式之后节点换成 ${sample.modeId}`, timeout: stationTimeout({ operations: 1 }) }).toBe(sample.modeId)
  await capture('mode-panel')
  if (await panel.isVisible().catch(() => false)) await win.keyboard.press('Escape')
  await expectHidden(panel, '参数面板收起（它盖在生成框上，先收起再放参考）', stationTimeout({ operations: 1 }))
}

/** 合成参考图（ffmpeg testsrc + 不同色相，1280×720 同比例，没有任何真实素材），返回 文件名 → 绝对路径。 */
export function writeSampleReferenceFiles(sample, directory) {
  if (!sample.references?.length) return {}
  fs.mkdirSync(directory, { recursive: true })
  return Object.fromEntries((sample.references ?? []).map(({ file }, index) => {
    const target = path.join(directory, file)
    execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=1280x720:r=1,hue=h=${index * 120}`, '-frames:v', '1', '-y', target], { stdio: 'pipe' })
    return [file, target]
  }))
}

/**
 * 经生成框「+」→ 选择器 → 上传，一张一张真放进去（首尾帧：「+」落到第一个空格，先首帧后尾帧；参考：进参考数组；
 * 文生方式下：接成画布输入，节点换成图生）。每放一张，生成框里的小图 +1 才放下一张。`referencesFirst` 的样本在挑型号之前调它（prepareRelayVideo 的 beforeModelPick）。
 */
export async function uploadSampleReferences({ win, prepared, sample, files }) {
  const references = sample.references ?? []
  if (!references.length) return
  const composer = composerOf(win, prepared.nodeId)
  const tiles = composer.locator('[data-asset-tile]')
  for (const reference of references) {
    const before = await tiles.count()
    // 有参考行时「+」是参考行那一个；文生方式下没有参考行，「+」是生成框的输入入口（放进来的图接成画布输入，节点随之换成图生）。
    const rowAdd = composer.locator('[data-reference-add-entry]').first()
    const add = (await rowAdd.count()) ? rowAdd : composer.locator('[data-asset-add-tile]').first()
    await clickOrFail(add, `生成框的「+」（放 ${reference.slot}）`)
    const picker = win.locator(PICKER).first()
    await expectVisible(picker, `「+」打开选择器（放 ${reference.slot}）`)
    await picker.locator('input[type="file"]').setInputFiles(files[reference.file])
    await expect.poll(() => tiles.count(), { message: `上传 ${reference.file} 后生成框里的小图 +1`, timeout: stationTimeout({ operations: 2 }) }).toBe(before + 1)
    if (await win.locator(PICKER).first().isVisible().catch(() => false)) await win.keyboard.press('Escape')
    await expectHidden(win.locator(PICKER).first(), '选择器收起', stationTimeout({ operations: 1 }))
  }
}

/**
 * 点生成之前：参考都还在、落在样本那一档的位置上（先放参考再切方式的样本，切完图不能丢）。不成立就抛，一分钱没花。
 */
export async function assertSampleReferencesInPlace({ win, prepared, sample, capture }) {
  const references = sample.references ?? []
  if (!references.length) return
  const composer = composerOf(win, prepared.nodeId)
  await expect.poll(() => composer.locator('[data-asset-tile]').count(), {
    message: `点生成之前生成框里正好 ${references.length} 张参考（${sample.modeId ?? '默认方式'}）`, timeout: stationTimeout({ operations: 1 }),
  }).toBe(references.length)
  if (sample.modeId === 'firstlast') {
    const filled = await composer.locator('[data-asset-slot] [data-asset-tile]').count()
    expect(filled, '首帧、尾帧两格都放上了图').toBe(2)
  }
  await capture('references-before-generate')
}
