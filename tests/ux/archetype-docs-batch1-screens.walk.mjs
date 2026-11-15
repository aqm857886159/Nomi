#!/usr/bin/env node
// 档案对文档第一批（2026-11-12）的免费真窗口走查：五个模型 × 中英两轨，截「模型菜单」「底栏方式菜单」和「每种方式的参数面板」。
//   node tests/ux/archetype-docs-batch1-screens.walk.mjs
// 零花费：隔离资料 + 夹具凭据（createRuntimeWalk 的 apimart 夹具档），APIMart 地址被重定向到本机夹具，不出网、不读真实 Key、不点生成。
// 不改任何界面代码，只读界面：参数面板里写了什么、有没有被挤出框，按真实 DOM 量，交给报告对着能力表逐行勾。
// 环境变量：NOMI_SHOTS_OUT 截图落地目录（绝对路径；不给就落仓库里被忽略的 .tmp/walk-archetype-docs-batch1/）；NOMI_SHOTS_ONLY 只跑某个型号（逗号分隔，调试用）；
// NOMI_SHOTS_LOCALES 只跑某轨（zh-CN / en，逗号分隔）。
//
// 方式按输入现算（2026-11-12 起方式住在底栏方式格，放不下当前输入的方式置灰），所以按真人的顺序摆几种输入，每种输入下把方式格里
// 亮着的方式逐个点一遍、开参数面板截：没放东西 → 放一张图 → 再放一张图；视频模型另开一个节点只放一段源视频（编辑 / 续写）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectHidden, expectVisible, screenshotSettled } from './_assert.mjs'
import { closeModeMenu, modeName, openModeMenu, pickModeByName, readModeCell } from './_modeMenu.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { createRelayProject, prepareRelayVideo } from './_relayVideoWalk.mjs'
import { backToLibrary, setAppLanguage } from './_shell.mjs'
import { writeSampleReferenceFiles } from './_catalogMediaRestSamples.mjs'
import { createRuntimeWalk, readProject } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'

const PICKER = '[data-testid="asset-picker"]'
// 没给 NOMI_SHOTS_OUT 时落到仓库里被忽略的 .tmp/ 草稿区：这条在夜跑清单里，夜跑不设这个变量，以前一启动就红（2026-11-14 清红走查）。
const OUT = process.env.NOMI_SHOTS_OUT || fileURLToPath(new URL('../../.tmp/walk-archetype-docs-batch1/', import.meta.url))
if (!path.isAbsolute(OUT)) throw new Error('NOMI_SHOTS_OUT 必须是绝对路径（截图落地目录）')
fs.mkdirSync(OUT, { recursive: true })

/** 要找的模型名放进环境变量里就能被「改成不存在的」打红（自验用）。 */
const MODELS = [
  { file: 'seedance-2.5', kind: 'video', vendorKey: 'apimart', modelKey: process.env.NOMI_SHOTS_FAKE_MODEL ?? 'doubao-seedance-2.5' },
  { file: 'kling-4.0-flash', kind: 'video', vendorKey: 'apimart', modelKey: 'kling-v4-flash', enLabel: 'Kling 4.0 Flash' },
  { file: 'minimax-h3-max', kind: 'video', vendorKey: 'apimart', modelKey: 'MiniMax-H3-Max' },
  { file: 'seedream-5.5', kind: 'image', vendorKey: 'apimart', modelKey: 'seedream-5-5' },
  { file: 'seedream-5.0-pro', kind: 'image', vendorKey: 'apimart', modelKey: 'doubao-seedream-5-0-pro' },
]
const IMAGE_STATES = ['无参考', '1张图', '2张图']
/**
 * 方式菜单的行 → 档案方式号（截图文件名用）：菜单按档案方式的顺序列全部方式（放不下当前输入的置灰），所以按行号认；
 * 归进四类的行再按词典名对一遍（顺序变了当场红）。存下来的方式号只是偏好（还有存盘节流），不能拿来认「这次按哪种方式」。
 */
// 第三项 'vendorTerm'＝跟随现状（2026-11-14 清红走查）：这一行和编辑 / 续写按形状同归「全能参考」类、撞名，菜单退回档案真名，
// 英文走 modelDisplayText（「Omni reference」）而不是统一叫法字典（「Reference」）——MiniMax H3-Max 不撞名，英文仍是「Reference」。
// 同一个方式英文两种叫法是产品待收成一个家的事；收好后去掉第三项、按词典名再对一次。
const MODE_ORDER = {
  'seedance-2.5': [['t2v', 'text'], ['first', 'image'], ['firstlast', 'firstLast'], ['omni', 'reference', 'vendorTerm'], ['edit'], ['extend']],
  'kling-4.0-flash': [['t2v', 'text'], ['i2v', 'image'], ['ref', 'reference', 'vendorTerm'], ['edit'], ['extend']],
  'minimax-h3-max': [['t2v', 'text'], ['i2v'], ['ref', 'reference']],
}
const { enModelDisplayText } = tsxRequire('../../src/i18n/locales/modelDisplayText.ts', import.meta.url)
const shownName = (lang, kind, source) => (source === 'vendorTerm' && lang === 'en' ? enModelDisplayText[modeName('zh', kind)] : modeName(lang, kind))
const modeIdOfRow = (file, rows, index, lang) => {
  const order = MODE_ORDER[file]
  if (!order || rows.length !== order.length) throw new Error(`${file}：方式菜单 ${rows.length} 行，档案登记 ${order?.length ?? 0} 种方式：${JSON.stringify(rows.map((row) => row.name))}`)
  const [modeId, kind, source] = order[index]
  if (kind && rows[index].name !== shownName(lang, kind, source)) throw new Error(`${file}：方式菜单第 ${index + 1} 行是「${rows[index].name}」，按顺序应是四类里的 ${kind}（${shownName(lang, kind, source)}）`)
  return modeId
}
const only = (process.env.NOMI_SHOTS_ONLY ?? '').split(',').filter(Boolean)
const LOCALES = (process.env.NOMI_SHOTS_LOCALES ?? 'zh-CN,en').split(',').filter(Boolean)
const LOCALE_TAG = { 'zh-CN': 'zh', en: 'en' }

const walk = await createRuntimeWalk('archetype-docs-batch1-screens', { generationProvider: 'apimart', seedApimartKey: true })
const facts = []
let failure
let win

/** 合成源视频（ffmpeg testsrc，5 秒，没有任何真实素材）。 */
function writeSourceVideo(directory) {
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, 'source.mp4')
  if (!fs.existsSync(target)) execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1280x720:r=24:d=5', '-pix_fmt', 'yuv420p', '-y', target], { stdio: 'pipe' })
  return target
}

/** 经生成框「+」→ 选择器 → 上传一个文件，等生成框里的小图 +1。 */
async function uploadFile(composer, file, what) {
  const tiles = composer.locator('[data-asset-tile]')
  const before = await tiles.count()
  const rowAdd = composer.locator('[data-reference-add-entry]').first()
  const add = (await rowAdd.count()) ? rowAdd : composer.locator('[data-asset-add-tile]').first()
  await clickOrFail(add, `生成框的「+」（放 ${what}）`)
  const picker = win.locator(PICKER).first()
  await expectVisible(picker, `「+」打开选择器（放 ${what}）`)
  await picker.locator('input[type="file"]').setInputFiles(file)
  await expect.poll(() => tiles.count(), { message: `上传 ${what} 后生成框里的小图 +1`, timeout: stationTimeout({ operations: 2 }) }).toBe(before + 1)
  if (await picker.isVisible().catch(() => false)) await win.keyboard.press('Escape')
  await expectHidden(picker, '选择器收起', stationTimeout({ operations: 1 }))
}

try {
  ;({ win } = await walk.start({ first: true }))
  const refDir = path.join(walk.outputDir, 'references')
  const refFiles = writeSampleReferenceFiles({ references: [{ slot: 'image_ref', file: 'ref-a.png' }, { slot: 'image_ref', file: 'ref-b.png' }] }, refDir)
  const sourceVideo = writeSourceVideo(refDir)
  for (const locale of LOCALES) {
    await setAppLanguage(win, locale)
    const lang = LOCALE_TAG[locale]
    const imageEditHint = uiText(locale, 'assetLibrary.refRow.imageEdit')
    for (const spec of MODELS.filter((item) => !only.length || only.includes(item.file))) {
      const tag = `${spec.file}`
      const shot = async (name) => {
        const file = path.join(OUT, `${name}.png`)
        await screenshotSettled(win, { path: file })
        return path.basename(file)
      }
      const record = { model: spec.modelKey, locale, menuShot: null, modeMenus: [], modes: [] }
      facts.push(record)
      const shotModes = new Set()
      const prepare = async (withMenuShot) => {
        if (win.url().includes('projectId')) await backToLibrary(win)
        const prepared = await prepareRelayVideo({
          win, newProject: () => createRelayProject(walk, win), kind: spec.kind,
          model: { vendorKey: spec.vendorKey, modelKey: spec.modelKey }, extraOptionNames: spec.enLabel ? [spec.enLabel] : [],
          capture: async (step) => { if (step === 'model-menu' && withMenuShot) record.menuShot = await shot(`${spec.file}-模型菜单-${lang}`) },
        })
        const composer = win.locator(`[data-node-id="${prepared.nodeId}"] .generation-canvas-v2-node__composer`).first()
        const nodeModeId = async () => ((await readProject(win, prepared.projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.id === prepared.nodeId)?.meta?.archetype?.modeId ?? null
        return { composer, nodeModeId }
      }
      const panel = win.locator('[data-agent-parameter-panel]').first()
      /** 开参数面板，量真实 DOM、截图（要滚的再截一张滚到底的），记下摘要、方式格与面板文字，收起。同一方式只截一次，之后只记摘要。 */
      const shootPanel = async ({ composer, nodeModeId }, state, pickedName, pickedModeId) => {
        const cell = await readModeCell(composer, lang)
        // 图片节点没有方式格，按参考行认：写着「按图改」就是改图，否则文生图（节点存的方式号只是偏好，新节点可能还没写）。
        const imageModeId = async () => ((await composer.innerText()).includes(imageEditHint) ? 'edit' : 't2i')
        const modeId = spec.kind === 'image' ? await imageModeId() : (pickedModeId ?? (await nodeModeId()) ?? 't2v')
        const summary = ((await composer.locator('[data-parameter-summary]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
        if (shotModes.has(modeId)) { record.modes.push({ modeId, state, pickedName, cell, summary, repeat: true }); return }
        shotModes.add(modeId)
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `${tag}：生成框的参数摘要（打开参数面板，${modeId}）`)
        await expectVisible(panel, `${tag}：参数面板（${modeId}）`)
        const measure = await panel.evaluate((root) => {
          const box = root.getBoundingClientRect()
          const scrollers = [root, ...root.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
          const outside = [...root.querySelectorAll('button, [role="radio"], [role="combobox"], input, [role="switch"], [role="checkbox"]')]
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1) })
            .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30))
          const truncated = [...root.querySelectorAll('*')]
            .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
            .map((el) => (el.textContent || '').trim().slice(0, 40))
          const viewport = { width: innerWidth, height: innerHeight }
          return {
            box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, viewport,
            clippedByViewport: box.bottom > viewport.height + 1 || box.right > viewport.width + 1 || box.top < -1,
            scrollers: scrollers.map((el) => ({ tag: el.tagName, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })),
            outside, truncated, text: root.innerText,
          }
        })
        const base = `${spec.file}-${modeId}-${lang}-面板`
        const shots = [await shot(base)]
        if (measure.scrollers.length) {
          await panel.evaluate((root) => {
            for (const el of [root, ...root.querySelectorAll('*')]) {
              if (el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight
            }
          })
          shots.push(await shot(`${base}-2`))
        }
        fs.writeFileSync(path.join(OUT, `${base}.txt`), `摘要：${summary}\n方式格：${cell ?? '（无）'}\n输入：${state}\n---\n${measure.text}`)
        record.modes.push({ modeId, state, pickedName, cell, summary, shots, box: measure.box, viewport: measure.viewport, clippedByViewport: measure.clippedByViewport, scrollers: measure.scrollers, outside: measure.outside, truncated: measure.truncated })
        await win.keyboard.press('Escape')
        await expectHidden(panel, `${tag}：参数面板收起（${modeId}）`, stationTimeout({ operations: 1 }))
      }
      /** 这一种输入下：方式格里亮着的方式逐个点、逐个截；没有方式格（图片节点 / 只有一种方式）就截当前的。 */
      const visitModes = async (ctx, state) => {
        if (spec.kind === 'image' || (await readModeCell(ctx.composer, lang)) === null) { await shootPanel(ctx, state, null); return }
        const rows = await openModeMenu(win, ctx.composer, lang)
        const menuShot = await shot(`${spec.file}-方式菜单-${state}-${lang}`)
        await closeModeMenu(win)
        record.modeMenus.push({ state, menuShot, rows })
        for (const [index, row] of rows.entries()) {
          const modeId = modeIdOfRow(spec.file, rows, index, lang)
          if (row.disabled) continue
          await pickModeByName(win, ctx.composer, lang, row.name)
          await expect.poll(() => readModeCell(ctx.composer, lang), { message: `${tag}：方式格换成「${row.name}」`, timeout: stationTimeout({ operations: 1 }) }).toBe(row.name)
          await shootPanel(ctx, state, row.name, modeId)
        }
      }
      const ctx = await prepare(true)
      for (const [index, state] of IMAGE_STATES.entries()) {
        if (index > 0) await uploadFile(ctx.composer, refFiles[index === 1 ? 'ref-a.png' : 'ref-b.png'], `参考图 ${index}`)
        if (spec.kind === 'image' && index > 0) await expect.poll(() => ctx.composer.innerText(), { message: `${tag}：放了图之后参考行写「${imageEditHint}」`, timeout: stationTimeout({ operations: 2 }) }).toContain(imageEditHint)
        await visitModes(ctx, state)
      }
      if (spec.kind === 'video') {
        const videoCtx = await prepare(false)
        await uploadFile(videoCtx.composer, sourceVideo, '源视频')
        await visitModes(videoCtx, '1段视频')
      }
    }
  }
  walk.report.facts = facts
  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
  fs.writeFileSync(path.join(OUT, 'facts.partial.json'), JSON.stringify(facts, null, 2))
  if (win) await walk.snap('blocked').catch(() => {})
} finally {
  await walk.finish(failure)
}
