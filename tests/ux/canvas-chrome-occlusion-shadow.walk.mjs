#!/usr/bin/env node
// 生成框压住底部外框控件时，控件盒子外的投影圈也必须让位。
// 真 Electron、隔离 profile。只移动节点和截图。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, ACCEPTANCE_VIEWPORT } from './_launchApp.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { addCanvasNode, canvasAddBar, newProjectEntry } from './_shell.mjs'
import { expect, waitForVisualQuiescence } from './_assert.mjs'

const evidenceDir = makeTempDir('nomi-chrome-occlusion-evidence-')
process.env.EVIDENCE_DIR = evidenceDir

const variants = [
  { id: 'zh-light', locale: 'zh-CN', scheme: 'light', description: '中文亮色：加节点条投影圈与生成框底色对照' },
  { id: 'zh-dark', locale: 'zh-CN', scheme: 'dark', description: '中文暗色：加节点条投影圈与生成框底色对照' },
  { id: 'en-light', locale: 'en', scheme: 'light', description: '英文亮色：加节点条投影圈与生成框底色对照' },
  { id: 'en-dark', locale: 'en', scheme: 'dark', description: '英文暗色：加节点条投影圈与生成框底色对照' },
]

function measureBrightness(imagePath, regions) {
  const script = String.raw`
from PIL import Image
import json, sys
im = Image.open(sys.argv[1]).convert('RGB')
out = {}
for name, box in json.loads(sys.argv[2]).items():
    if isinstance(box, dict):
        box = [box['left'], box['top'], box['right'], box['bottom']]
    left, top, right, bottom = [int(round(v)) for v in box]
    if right <= left or bottom <= top:
        raise SystemExit(f'invalid region {name}: {box}')
    pixels = list(im.crop((left, top, right, bottom)).getdata())
    if not pixels:
        raise SystemExit(f'empty region {name}: {box}')
    out[name] = sum(sum(pixel) / 3 for pixel in pixels) / len(pixels)
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python3', ['-c', script, imagePath, JSON.stringify(regions)], { encoding: 'utf8' }))
}

function meanDelta(a, b) {
  return Math.abs(a - b)
}

for (const variant of variants) {
  const shotPath = path.join(evidenceDir, `${variant.id}.png`)
  const { app, win } = await launchNomiApp({
    name: `canvas-chrome-occlusion-shadow-${variant.id}`,
    viewportSize: ACCEPTANCE_VIEWPORT,
    args: ['--no-proxy-server'],
    settleMs: 0,
    initialLocalStorage: {
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      'nomi:locale:v1': variant.locale,
      'nomi-color-scheme': variant.scheme,
    },
  })
  try {
    await newProjectEntry(win).click()
    await win.getByRole('button', { name: variant.locale === 'en' ? 'Generate' : '生成', exact: true }).click()
    await addCanvasNode(win, 'image')
    const node = win.locator('.react-flow__node[data-id]').first()
    await expect(node, `${variant.id}：节点没有出现`).toBeVisible()
    const nodeId = await node.getAttribute('data-id')
    if (!nodeId) throw new Error(`${variant.id}：节点没有 data-id`)

    const nodeSelector = `.react-flow__node[data-id="${nodeId}"]`
    const toolbar = canvasAddBar(win)
    const composer = node.locator('.generation-canvas-v2-node__composer')
    const prompt = composer.locator('[data-node-composer-prompt]')
    await expect(prompt).toBeVisible()
    await waitForVisualQuiescence(win)
    const handle = await findNodeHitPoint(win, { nodeSelector })
    const dockBefore = await toolbar.boundingBox()
    const promptBefore = await prompt.boundingBox()
    if (!handle || !dockBefore || !promptBefore) throw new Error(`${variant.id}：量不到节点抓点、加节点条或提示词区`)
    await win.screenshot({ path: path.join(evidenceDir, `before-${variant.id}.png`) })

    // 把提示词空白区移到加节点条下沿的投影带上，位移由两个真实盒子决定。
    const shadowSampleCenter = dockBefore.y + dockBefore.height + 7.5
    const dragY = Math.round(shadowSampleCenter - (promptBefore.y + promptBefore.height * 0.55))
    await win.mouse.move(handle.x, handle.y)
    await win.mouse.down()
    await win.mouse.move(handle.x, handle.y + dragY, { steps: 10 })
    await win.mouse.up()
    await waitForVisualQuiescence(win)
    await expect.poll(() => toolbar.evaluate((element) => getComputedStyle(element).clipPath)).toMatch(/^path\(/)

    const dock = await toolbar.boundingBox()
    const card = await composer.boundingBox()
    const field = await prompt.boundingBox()
    if (!dock || !card || !field) throw new Error(`${variant.id}：量不到拖动后的生成框、提示词区或加节点条`)
    const top = dock.y + dock.height + 3
    const bottom = dock.y + dock.height + 12
    const geometry = {
      toolbar: dock,
      composer: card,
      prompt: field,
      ring: { left: dock.x + 20, right: dock.x + dock.width - 20, top, bottom },
      // 同一高度取提示词背景，横向离开节点条的 24px 投影外扩区。
      reference: { left: dock.x + dock.width + 28, right: dock.x + dock.width + 60, top, bottom },
    }
    for (const sample of [geometry.ring, geometry.reference]) {
      for (const area of [card, field]) {
        if (sample.right <= sample.left || sample.left < area.x || sample.right > area.x + area.width ||
            sample.top < area.y || sample.bottom > area.y + area.height) {
          throw new Error(`${variant.id}：投影圈或参考取样区不在生成框的提示词区内：${JSON.stringify(geometry)}`)
        }
      }
    }

    await win.screenshot({ path: shotPath })
    const brightness = measureBrightness(shotPath, { ring: geometry.ring, reference: geometry.reference })
    const delta = meanDelta(brightness.ring, brightness.reference)
    console.log('OCCLUSION_PIXEL', JSON.stringify({ variant: variant.id, geometry, brightness, delta }))
    await expect(delta, `${variant.id}：生成框内的投影圈亮度应与生成框底色一致`).toBeLessThan(4)
    fs.writeFileSync(path.join(evidenceDir, `${variant.id}.json`), `${JSON.stringify({ variant, description: variant.description, geometry, brightness, delta, screenshot: shotPath }, null, 2)}\n`)
  } finally {
    await app.close().catch(() => {})
  }
}

const evidenceLines = [
  '- `before-*.png`：拖动节点前的取景。',
  ...variants.map((variant) => `- ${'`'}${variant.id}.png${'`'}：${variant.description}。投影圈取样区与生成框内参考区的平均亮度差记录在同名 ${'`'}${variant.id}.json${'`'}。`),
]
fs.writeFileSync(path.join(evidenceDir, 'README.md'), `# 2026-10-24 chrome occlusion shadow\n\n${evidenceLines.join('\n')}\n`)
console.log(`canvas-chrome-occlusion-shadow: ${variants.length}/${variants.length} passed · ${evidenceDir}`)
