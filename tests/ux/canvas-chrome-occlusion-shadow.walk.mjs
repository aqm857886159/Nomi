#!/usr/bin/env node
// 生成框压住底部外框控件时，控件盒子外的投影圈也必须让位。
// 真 Electron、隔离 profile、；只移动节点和截图，不点生成。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, ACCEPTANCE_VIEWPORT, repoRoot } from './_launchApp.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { addCanvasNode, canvasAddBar, newProjectEntry } from './_shell.mjs'
import { expect } from './_assert.mjs'

const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-10-24-chrome-occlusion-shadow')
fs.rmSync(evidenceDir, { recursive: true, force: true })
fs.mkdirSync(evidenceDir, { recursive: true })

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

    // 真实拖动：把节点向下挪 30px，让生成框压住底部加节点条。
    const nodeSelector = `.react-flow__node[data-id="${nodeId}"]`
    const handle = await findNodeHitPoint(win, { nodeSelector })
    const before = await win.locator(nodeSelector).boundingBox()
    if (!handle || !before) throw new Error(`${variant.id}：找不到可抓的节点表面`)
    await win.mouse.move(handle.x, handle.y)
    await win.mouse.down()
    await win.mouse.move(handle.x, handle.y + 30, { steps: 10 })
    await win.mouse.up()
    await win.waitForTimeout(800)

    const toolbar = await canvasAddBar(win).boundingBox()
    const composer = await win.locator('.generation-canvas-v2-node__composer').first().boundingBox()
    const geometry = toolbar && composer ? (() => {
      const left = Math.max(toolbar.x + 20, composer.x + 20)
      const right = Math.min(toolbar.x + toolbar.width - 20, composer.x + composer.width - 20)
      // 取 dock 盒子下方、仍在扩展 24px 外框内的投影带；这里正是旧实现留下的变暗影子。
      const ringTop = toolbar.y + toolbar.height + 3
      const ringBottom = toolbar.y + toolbar.height + 12
      const referenceTop = toolbar.y - 34
      const referenceBottom = toolbar.y - 25
      return {
        toolbar: { left: toolbar.x, top: toolbar.y, right: toolbar.x + toolbar.width, bottom: toolbar.y + toolbar.height },
        composer: { left: composer.x, top: composer.y, right: composer.x + composer.width, bottom: composer.y + composer.height },
        ring: { left, top: ringTop, right, bottom: ringBottom },
        reference: { left, top: referenceTop, right, bottom: referenceBottom },
      }
    })() : null
    if (!geometry) throw new Error(`${variant.id}：量不到生成框或加节点条`)
    if (geometry.ring.right <= geometry.ring.left || geometry.ring.bottom <= geometry.ring.top) throw new Error(`${variant.id}：投影圈取样区为空：${JSON.stringify(geometry)}`)
    if (geometry.composer.top > geometry.ring.top || geometry.composer.bottom < geometry.ring.bottom) throw new Error(`${variant.id}：投影圈取样区不在生成框内：${JSON.stringify(geometry)}`)

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
  '- `before-zh-light.png`：临时还原盒子求交旧实现、同样拖动场景下的修前对照，能看到生成框底部外侧残留的空白投影框。',
  ...variants.map((variant) => `- ${'`'}${variant.id}.png${'`'}：${variant.description}。投影圈取样区与生成框内参考区的平均亮度差记录在同名 ${'`'}${variant.id}.json${'`'}。`),
]
fs.writeFileSync(path.join(evidenceDir, 'README.md'), `# 2026-10-24 chrome occlusion shadow\n\n${evidenceLines.join('\n')}\n`)
console.log('canvas-chrome-occlusion-shadow: OK')
