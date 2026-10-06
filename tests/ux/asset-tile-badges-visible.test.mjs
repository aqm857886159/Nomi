// 参考缩略图（AssetTile）的序号角标和 × 必须**整枚**看得见：包围盒完全落在最近的裁剪祖先里，
// 同一格里的序号和 × 不互相压，中心点点得到自己。
//
// 2026-10-06：角标原来挂在格外 5px，而格子自己 `overflow-hidden`，所以序号被切掉左半、× 被切掉上沿
// （分镜参考条 36 / 28 小格最显眼，画布 56 格同样被切）。清单遍历这个组件的两处生产宿主：
//   · 画布节点参考区：真 NodeParameterControls → AssetReference（fixtures/asset-tile-badges-harness）；
//   · 分镜行内参考条：设计实验室 storyboard-reuse 屏的真镜头行（横 / 竖 / 3:4 / 1:1 / 混排 × 宽 / 窄、三种状态）。
// 零额度：纯本地渲染，不碰任何生成 API。
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const STRIP_STATES = [
  'sbl-01-film-16x9-wide', 'sbl-02-film-16x9-narrow',
  'sbp-01-film-9x16-wide', 'sbp-02-film-9x16-narrow',
  'sbp-03-film-3x4-wide', 'sbp-04-film-3x4-narrow',
  'sbl-05-film-1x1-wide', 'sbl-06-film-1x1-narrow',
  'sbl-07-mixed-wide', 'sbl-08-mixed-narrow',
  'sbl-11-row-states',
]

let server
let browser
let origin
beforeAll(async () => {
  server = await createServer({ root: repoRoot, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
}, 120000)
afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 在页面里量：每枚角标 / × 对它最近的裁剪祖先（overflow 不是 visible 或有 clip-path）的内框。 */
function measureCorners() {
  const clipBoxOf = (element) => {
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.overflowX === 'visible' && style.overflowY === 'visible' && style.clipPath === 'none') continue
      const rect = ancestor.getBoundingClientRect()
      return {
        left: rect.left + parseFloat(style.borderLeftWidth), top: rect.top + parseFloat(style.borderTopWidth),
        right: rect.right - parseFloat(style.borderRightWidth), bottom: rect.bottom - parseFloat(style.borderBottomWidth),
      }
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }
  return [...document.querySelectorAll('[data-asset-tile]')].flatMap((tile) => {
    const badge = tile.querySelector('[data-asset-tile-badge]')
    const remove = tile.querySelector('[data-asset-tile-remove]')
    return [badge, remove].filter(Boolean).map((element) => {
      const rect = element.getBoundingClientRect()
      const clip = clipBoxOf(element)
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      const other = element === badge ? remove : badge
      const otherRect = other?.getBoundingClientRect()
      return {
        what: element === badge ? `badge ${badge.getAttribute('data-asset-tile-badge')}` : 'remove',
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        clip,
        inside: rect.left >= clip.left - 0.5 && rect.top >= clip.top - 0.5 && rect.right <= clip.right + 0.5 && rect.bottom <= clip.bottom + 0.5,
        hit: Boolean(hit && element.contains(hit)),
        overlapsSibling: Boolean(otherRect && rect.left < otherRect.right && otherRect.left < rect.right && rect.top < otherRect.bottom && otherRect.top < rect.bottom),
      }
    })
  })
}

function expectCornersVisible(corners, where) {
  for (const corner of corners) {
    expect(corner.inside, `${where}: ${corner.what} 被裁剪祖先切掉（${JSON.stringify(corner.rect)} 不在 ${JSON.stringify(corner.clip)} 里）`).toBe(true)
    expect(corner.hit, `${where}: ${corner.what} 的中心点不到它自己`).toBe(true)
    expect(corner.overlapsSibling, `${where}: ${corner.what} 和同一格里的另一枚压在一起`).toBe(false)
  }
}

test('画布节点参考区：三张编号参考的序号和 × 都整枚可见', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } })
  try {
    await page.goto(`${origin}/tests/ux/fixtures/asset-tile-badges-harness.html`, { timeout: 90000 })
    await page.locator('[data-asset-tile-badge="3"]').waitFor({ timeout: 60000 })
    const corners = await page.evaluate(measureCorners)
    expect(corners.filter((corner) => corner.what.startsWith('badge'))).toHaveLength(3)
    expect(corners.filter((corner) => corner.what === 'remove')).toHaveLength(3)
    expectCornersVisible(corners, 'canvas')
  } finally { await page.close() }
}, 180000)

test('分镜行内参考条：各画幅、宽窄两档的序号和 × 都整枚可见', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  try {
    for (const state of STRIP_STATES) {
      await page.goto(`${origin}/design-lab.html?screen=storyboard-reuse&frame=1&state=${state}`, { timeout: 90000 })
      await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: 60000 })
      const corners = await page.evaluate(measureCorners)
      expect(corners.length, `${state}: 应该量到参考缩略图`).toBeGreaterThan(0)
      expectCornersVisible(corners, state)
    }
  } finally { await page.close() }
}, 600000)
