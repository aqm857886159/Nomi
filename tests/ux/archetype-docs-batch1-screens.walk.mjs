#!/usr/bin/env node
// 档案对文档第一批（2026-11-12）的免费真窗口走查：五个模型 × 中英两轨，截「模型菜单」和「每种方式的参数面板」。
//   node tests/ux/archetype-docs-batch1-screens.walk.mjs
// 零花费：隔离资料 + 夹具凭据（createRuntimeWalk 的 apimart 夹具档），APIMart 地址被重定向到本机夹具，不出网、不读真实 Key、不点生成。
// 不改任何界面代码，只读界面：参数面板里写了什么、有没有被挤出框，按真实 DOM 量，交给报告对着能力表逐行勾。
// 环境变量：NOMI_SHOTS_OUT 截图落地目录（必填，仓库外临时目录）；NOMI_SHOTS_ONLY 只跑某个型号（逗号分隔，调试用）；
// NOMI_SHOTS_LOCALES 只跑某轨（zh-CN / en，逗号分隔）。
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expect, expectHidden, expectVisible, screenshotSettled } from './_assert.mjs'
import { createRelayProject, prepareRelayVideo } from './_relayVideoWalk.mjs'
import { backToLibrary, setAppLanguage } from './_shell.mjs'
import { uploadSampleReferences, writeSampleReferenceFiles } from './_catalogMediaRestSamples.mjs'
import { createRuntimeWalk, readProject } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'

const OUT = process.env.NOMI_SHOTS_OUT
if (!OUT || !path.isAbsolute(OUT)) throw new Error('NOMI_SHOTS_OUT 必须是绝对路径（截图落地目录）')
fs.mkdirSync(OUT, { recursive: true })

/** 要找的模型名放进环境变量里就能被「改成不存在的」打红（自验用）。 */
const MODELS = [
  { file: 'seedance-2.5', kind: 'video', vendorKey: 'apimart', modelKey: process.env.NOMI_SHOTS_FAKE_MODEL ?? 'doubao-seedance-2.5' },
  { file: 'kling-4.0-flash', kind: 'video', vendorKey: 'apimart', modelKey: 'kling-v4-flash', enLabel: 'Kling 4.0 Flash' },
  { file: 'minimax-h3-max', kind: 'video', vendorKey: 'apimart', modelKey: 'MiniMax-H3-Max' },
  { file: 'seedream-5.5', kind: 'image', vendorKey: 'apimart', modelKey: 'seedream-5-5' },
  { file: 'seedream-5.0-pro', kind: 'image', vendorKey: 'apimart', modelKey: 'doubao-seedream-5-0-pro' },
]
// 参数面板「生成方式」分段的顺序 → 方式编号（文件名用；中英两轨顺序相同，数量对不上就当场报错）。
const MODE_IDS = {
  'seedance-2.5': ['omni', 'edit', 'extend', 'first', 'firstlast'],
  'kling-4.0-flash': ['ref', 'edit', 'i2v', 'extend'],
  'minimax-h3-max': ['ref', 'i2v'],
  'seedream-5.5': [],
  'seedream-5.0-pro': [],
}
const WITH_REFERENCE = { 'seedance-2.5': 0, 'kling-4.0-flash': 0, 'minimax-h3-max': 0 }
const only = (process.env.NOMI_SHOTS_ONLY ?? '').split(',').filter(Boolean)
const LOCALES = (process.env.NOMI_SHOTS_LOCALES ?? 'zh-CN,en').split(',').filter(Boolean)
const LOCALE_TAG = { 'zh-CN': 'zh', en: 'en' }

const walk = await createRuntimeWalk('archetype-docs-batch1-screens', { generationProvider: 'apimart', seedApimartKey: true })
const facts = []
let failure
let win
try {
  ;({ win } = await walk.start({ first: true }))
  for (const locale of LOCALES) {
    await setAppLanguage(win, locale)
    for (const spec of MODELS.filter((item) => !only.length || only.includes(item.file))) {
      const tag = `${spec.file}`
      if (win.url().includes('projectId')) await backToLibrary(win)
      const shot = async (name) => {
        const file = path.join(OUT, `${name}.png`)
        await screenshotSettled(win, { path: file })
        return path.basename(file)
      }
      const menuName = `${spec.file}-模型菜单-${LOCALE_TAG[locale]}`
      let menuShot
      const prepared = await prepareRelayVideo({
        win, newProject: () => createRelayProject(walk, win), kind: spec.kind,
        model: { vendorKey: spec.vendorKey, modelKey: spec.modelKey }, extraOptionNames: spec.enLabel ? [spec.enLabel] : [],
        capture: async (step) => {
          if (step === 'model-menu') menuShot = await shot(menuName)
        },
      })
      const { nodeId, projectId } = prepared
      const nodeModeId = async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.id === nodeId)?.meta?.archetype?.modeId ?? null
      const composer = win.locator(`[data-node-id="${nodeId}"] .generation-canvas-v2-node__composer`).first()
      const panel = win.locator('[data-agent-parameter-panel]').first()
      await clickOrFail(composer.locator('[data-parameter-summary]').first(), `${tag}：生成框的参数摘要（打开参数面板）`)
      await expectVisible(panel, `${tag}：参数面板`)
      const radios = panel.locator('[data-agent-generation-mode]').getByRole('radio')
      const labels = (await radios.allInnerTexts()).map((text) => text.trim())
      expect(labels.length, `${tag}：「生成方式」分段项数`).toBe(MODE_IDS[spec.file].length)
      const record = { model: spec.modelKey, locale, menuShot, modes: [] }
      facts.push(record)
      // 第 0 轮 = 打开面板时节点的当前方式（文生 / 文生图）；之后每个分段项点一次，等节点真的换到新方式再截。
      for (let index = -1; index < labels.length; index += 1) {
        if (index >= 0) {
          await clickOrFail(radios.nth(index), `${tag}：参数面板「生成方式」第 ${index + 1} 项「${labels[index]}」`)
          await expect(radios.nth(index), `${tag}：点完「${labels[index]}」分段按下`).toHaveAttribute('aria-checked', 'true')
          await win.waitForTimeout(400)
        }
        await expectVisible(panel, `${tag}：切方式后参数面板还在`)
        const modeId = index < 0 ? (spec.kind === 'image' ? 't2i' : 't2v') : MODE_IDS[spec.file][index]
        // 面板内容、尺寸与溢出：直接量真实 DOM。
        const measure = await panel.evaluate((root) => {
          const box = root.getBoundingClientRect()
          const scrollers = [root, ...root.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
          const outside = [...root.querySelectorAll('button, [role="radio"], [role="combobox"], input, [role="switch"], [role="checkbox"]')]
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1) })
            .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30))
          const viewport = { width: innerWidth, height: innerHeight }
          return {
            box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, viewport,
            clippedByViewport: box.bottom > viewport.height + 1 || box.right > viewport.width + 1 || box.top < -1,
            scrollers: scrollers.map((el) => ({ tag: el.tagName, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })),
            outside,
            text: root.innerText,
          }
        })
        const base = `${spec.file}-${modeId}-${LOCALE_TAG[locale]}-面板`
        const first = await shot(base)
        let second = null
        if (measure.scrollers.length) {
          await panel.evaluate((root) => {
            for (const el of [root, ...root.querySelectorAll('*')]) {
              if (el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight
            }
          })
          second = await shot(`${base}-2`)
        }
        fs.writeFileSync(path.join(OUT, `${base}.txt`), measure.text)
        record.modes.push({ modeId, label: index >= 0 ? labels[index] : null, shots: [first, second].filter(Boolean), box: measure.box, viewport: measure.viewport, clippedByViewport: measure.clippedByViewport, scrollers: measure.scrollers, outside: measure.outside })
      }
      // 「全能参考」这类参考数全是可选（下限 0）的方式：没放参考时面板读到的可能还是文生那一套，所以放一张参考图再截一次（真人就是这么走的）。
      const refIndex = (WITH_REFERENCE[spec.file] ?? -1)
      if (refIndex >= 0) {
        await clickOrFail(radios.nth(refIndex), `${tag}：切到「${labels[refIndex]}」再放参考`)
        await expect(radios.nth(refIndex)).toHaveAttribute('aria-checked', 'true')
        await win.keyboard.press('Escape')
        await expectHidden(panel, `${tag}：放参考前先收起面板`, stationTimeout({ operations: 1 }))
        const sample = { references: [{ slot: 'image_ref', file: 'ref.png' }] }
        await uploadSampleReferences({ win, prepared, sample, files: writeSampleReferenceFiles(sample, path.join(walk.outputDir, 'references')) })
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `${tag}：放了参考图后再开参数面板`)
        await expectVisible(panel, `${tag}：有参考的参数面板`)
        const base = `${spec.file}-${MODE_IDS[spec.file][refIndex]}-${LOCALE_TAG[locale]}-面板-有参考图`
        const shots = [await shot(base)]
        const text = await panel.innerText()
        const scrolled = await panel.evaluate((root) => {
          let moved = false
          for (const el of [root, ...root.querySelectorAll('*')]) {
            if (el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) { el.scrollTop = el.scrollHeight; moved = true }
          }
          return moved
        })
        if (scrolled) shots.push(await shot(`${base}-2`))
        fs.writeFileSync(path.join(OUT, `${base}.txt`), text)
        record.modes.push({ modeId: `${MODE_IDS[spec.file][refIndex]}+ref`, label: labels[refIndex], shots, scrollers: scrolled ? ['scrolled'] : [], outside: [], clippedByViewport: false })
      }
      if (await panel.isVisible().catch(() => false)) await win.keyboard.press('Escape')
      await expectHidden(panel, `${tag}：参数面板收起`, stationTimeout({ operations: 1 }))
      if (spec.kind === 'image') {
        // 图片模型没有「生成方式」分段：像真人那样经生成框「+」放一张图，节点换成改图，再开面板截。
        const sample = { references: [{ slot: 'image_ref', file: 'ref.png' }] }
        const files = writeSampleReferenceFiles(sample, path.join(walk.outputDir, 'references'))
        await uploadSampleReferences({ win, prepared, sample, files })
        await expect.poll(nodeModeId, { message: `${tag}：放了图之后节点换成改图`, timeout: stationTimeout({ operations: 2 }) }).toBe('edit')
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `${tag}：改图后再开参数面板`)
        await expectVisible(panel, `${tag}：改图参数面板`)
        const text = await panel.innerText()
        const base = `${spec.file}-edit-${LOCALE_TAG[locale]}-面板`
        const shots = [await shot(base)]
        const scrolled = await panel.evaluate((root) => {
          let moved = false
          for (const el of [root, ...root.querySelectorAll('*')]) {
            if (el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) { el.scrollTop = el.scrollHeight; moved = true }
          }
          return moved
        })
        if (scrolled) shots.push(await shot(`${base}-2`))
        fs.writeFileSync(path.join(OUT, `${base}.txt`), text)
        record.modes.push({ modeId: 'edit', label: null, shots, scrollers: scrolled ? ['scrolled'] : [], outside: [], clippedByViewport: false })
        if (await panel.isVisible().catch(() => false)) await win.keyboard.press('Escape')
        await expectHidden(panel, `${tag}：改图面板收起`, stationTimeout({ operations: 1 }))
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
