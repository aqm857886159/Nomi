// 验证 ①③④（人眼判断，规则 13）：图片节点默认模型 + 视频/图片 composer 提示词高度 + 生成钮是否被裁。
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots')
fs.mkdirSync(shotsDir, { recursive: true })

const { app, win } = await launchNomiApp({ name: 'verify-composer-fixes' })

// composer 内：生成钮中心是否落在卡片可视范围内（不被 overflow 裁掉）+ 提示词框高度
async function inspectComposer() {
  return win.locator('.generation-canvas-v2-node__composer-card').last().evaluate((card) => {
    const cardRect = card.getBoundingClientRect()
    const btn = card.querySelector('button[aria-label="生成素材"], button[aria-label="重新生成"]')
    const editor = card.querySelector('.ProseMirror') || card.querySelector('[contenteditable]')
    const b = btn?.getBoundingClientRect()
    return {
      cardWidth: Math.round(cardRect.width),
      promptHeight: editor ? Math.round(editor.getBoundingClientRect().height) : null,
      buttonInsideCard: b ? (b.right <= cardRect.right + 1 && b.left >= cardRect.left - 1 && b.bottom <= cardRect.bottom + 1) : null,
      buttonRightGap: b ? Math.round(cardRect.right - b.right) : null,
    }
  })
}

try {
  await win.locator('[role="button"]', { hasText: '示例：30 秒产品介绍' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: false }).first().click().catch(() => {})
  await win.waitForTimeout(1200)
  // 重置到 100% 缩放，截图清晰 + 几何判断不被 scale 干扰
  await win.getByRole('button', { name: '重置视图', exact: false }).first().click().catch(() => {})
  await win.waitForTimeout(400)

  // 图片节点
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1400)
  const imgSelected = await win.locator('.generation-canvas-v2-node__composer select[aria-label="模型"]').last().evaluate((el) => el.value)
  const img = await inspectComposer()
  await win.locator('.generation-canvas-v2-node__composer').last().screenshot({ path: path.join(shotsDir, 'verify-image-composer.png') })

  // 视频节点
  await addCanvasNodeFromRail(win, 'video')
  await win.waitForTimeout(1400)
  const vSel = win.locator('.generation-canvas-v2-node__composer select[aria-label="模型"]').last()
  await vSel.waitFor({ state: 'visible', timeout: 8000 })
  await win.waitForTimeout(800)
  const vid = await inspectComposer()
  await win.locator('.generation-canvas-v2-node__composer').last().screenshot({ path: path.join(shotsDir, 'verify-video-composer.png') })

  console.log(JSON.stringify({ imageDefaultModel: imgSelected, imageComposer: img, videoComposer: vid }, null, 2))
} catch (error) {
  console.error(`VERIFY ERROR: ${error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
