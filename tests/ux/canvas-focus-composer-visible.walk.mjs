#!/usr/bin/env node
// 对焦节点后，生成框的 ↑ 必须在可见区里、点得到（2026-10-22）。
//
// 现场：「出成片」回画布 / 侧栏定位，对焦只看节点本身，会把画布放大到 200% 以上并居中节点；
// 节点下方的生成框和 ↑ 掉出视口，或被浮动 Agent 窗、缩放条盖住，用户还得自己平移画布才点得到生成。
// 本走查走真实对焦入口（FOCUS_GENERATION_NODE_EVENT 的监听器，和 9 处调用方派的是同一个事件），
// 在 1280×933 窗口、Agent 面板「停靠」与「浮窗」两种形态下各对焦一次，断言：
//   · 对焦后缩放 ≤ 100%；
//   · ↑（生成钮）中心点在画布舞台内；
//   · elementFromPoint(↑ 中心) 就是 ↑ 自己（没有被浮动 Agent 窗 / 缩放条 / 时间轴盖住）；
//   · 定位闪光（D2 中性高亮，V-d2-pointer 建议 H 补严）：外壳出现 data-external-highlight="flash"；**等过渡走完**再读 computed box-shadow，
//     必须是 1.5px 深色细线 + 9px 淡光晕两层、哪一层都不含强调色；页面里的 MutationObserver 量「亮起 → 清掉」约 1.4 秒（不是只等到 4 秒内）。
// 零额度：只点对焦，不点生成；真 Electron、窗口在屏外、隔离 profile。
// Run: pnpm run build && node tests/ux/canvas-focus-composer-visible.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, ACCEPTANCE_VIEWPORT, repoRoot } from './_launchApp.mjs'
import { waitForCanvasViewportSettled, findCanvasBlankPoint } from './_canvasHit.mjs'
import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import { addCanvasNode, canvasZoomPercent, canvasZoomStep, ensureAgentPanelOpen, newProjectEntry, setAppLanguage, AGENT_PANEL } from './_shell.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-focus-composer-visible')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const SUBMIT = 'button[aria-label="生成素材"],button[aria-label="重新生成"],button[aria-label="Generate asset"],button[aria-label="Regenerate"],button[data-composer-connect="true"]'
const STAGE = '.generation-canvas-v2__stage'

const { app, win } = await launchNomiApp({
  name: 'canvas-focus-composer-visible',
  viewportSize: ACCEPTANCE_VIEWPORT,
  args: ['--no-proxy-server'],
  settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})

win.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)))
win.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)) })
let failure
try {
  await newProjectEntry(win).click()
  await win.getByRole('button', { name: '生成', exact: true }).click()
  await addCanvasNode(win, 'video')
  const card = win.locator('.generation-canvas-v2-node[data-node-id]').first()
  await card.waitFor()
  const nodeId = await card.getAttribute('data-node-id')
  if (!nodeId) throw new Error('新建的视频节点没有 data-node-id')

  async function focusAndMeasure(label, shotName) {
    // 先点空白取消选择、把画布放大到 200% 以上（事故现场就是对焦前用户处在放大的视图里）。
    const blank = await findCanvasBlankPoint(win)
    if (blank) await win.mouse.click(blank.x, blank.y)
    for (let i = 0; i < 12 && (await canvasZoomPercent(win)) < 220; i += 1) await canvasZoomStep(win, 'in', `${label}：放大到 200% 以上`)
    await waitForCanvasViewportSettled(win)
    const before = await canvasZoomPercent(win)
    // 页面里先挂一个观察者，记下这张卡外壳 data-external-highlight 的每一次变化；时间戳用页面自己的 performance.now()，
    // 不含 Playwright 往返的延迟（独立验收 V-d2-pointer 建议 H：要断言「约 1.4 秒清掉」，不能只等到 4 秒内）。
    await win.evaluate((id) => {
      window.__flashLog = []
      window.__flashObserver?.disconnect()
      window.__flashObserver = new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target
          if (target instanceof Element && target.closest(`.react-flow__node[data-id="${id}"]`)) window.__flashLog.push({ at: performance.now(), value: target.getAttribute('data-external-highlight') })
        }
      })
      window.__flashObserver.observe(document.body, { attributes: true, attributeFilter: ['data-external-highlight'], subtree: true })
    }, nodeId)
    // 真实入口：与侧栏定位 / 出成片后定位 / 副本角标等 9 处调用方派的是同一个事件，由画布监听器接手。
    await win.evaluate((id) => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), nodeId)
    // board:NodePointer/canvas.node.highlight —— 定位闪光改中性（2026-10-23 D2）：对焦那条路给节点外壳一档 flash，
    // 样子是深色细线 + ink 淡光晕，不用强调色；1.4 秒后由同一条路清掉。列表 / 通知 / 侧栏等 9 处入口派的都是这个事件。
    const shell = win.locator(`.react-flow__node[data-id="${nodeId}"] .generation-canvas-react-flow__node-shell`)
    await expect(shell, `${label}：对焦后外壳没有闪一下`).toHaveAttribute('data-external-highlight', 'flash', { timeout: 1500 })
    // 外壳靠 transition-shadow duration-300 淡入：等过渡走完再读 computed 值——否则读到的是 0.02px 的起步值，
    // 证明不了「1.5px 细线 + 9px 光晕」两层（独立验收实测：三次里两次读到起步值）。
    const flash = await shell.evaluate(async (el) => {
      await Promise.allSettled(el.getAnimations().map((animation) => animation.finished))
      const probe = document.createElement('div')
      probe.style.color = 'var(--nomi-accent)'
      document.body.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const shadow = getComputedStyle(el).boxShadow
      // computed box-shadow 是「颜色 x y blur spread」几层用顶层逗号隔开；颜色函数里的逗号（oklab(… / …)）不算。
      const layers = []
      let depth = 0
      let start = 0
      for (let index = 0; index <= shadow.length; index += 1) {
        const char = shadow[index]
        if (char === '(') depth += 1
        else if (char === ')') depth -= 1
        else if ((char === ',' && depth === 0) || index === shadow.length) {
          const raw = shadow.slice(start, index).trim()
          const [x, y, blur, spread] = [...raw.matchAll(/(-?\d*\.?\d+)px/g)].map((match) => Number(match[1]))
          if (raw) layers.push({ raw, x, y, blur, spread })
          start = index + 1
        }
      }
      return { shadow, accent, layers }
    })
    console.log('FOCUS_FLASH', JSON.stringify({ label, ...flash }))
    expect(flash.shadow !== 'none' && !flash.shadow.includes(flash.accent), `${label}：闪一下必须是中性光晕、不许强调色（${flash.shadow}）`).toBe(true)
    const hairline = flash.layers.find((layer) => layer.x === 0 && layer.y === 0 && layer.blur === 0 && layer.spread === 1.5)
    const halo = flash.layers.find((layer) => layer.x === 0 && layer.y === 0 && layer.blur === 0 && layer.spread === 9)
    expect(Boolean(hairline), `${label}：闪的时候少了 1.5px 深色细线那一层（${flash.shadow}）`).toBe(true)
    expect(Boolean(halo), `${label}：闪的时候少了 9px 淡光晕那一层（${flash.shadow}）`).toBe(true)
    expect(flash.layers.some((layer) => layer.raw.includes(flash.accent)), `${label}：闪的任何一层都不许含强调色`).toBe(false)
    await expect(shell, `${label}：闪完没有清掉`).not.toHaveAttribute('data-external-highlight', /.+/, { timeout: 4000 })
    // 约 1.4 秒清掉（对焦那条路的 setTimeout(1400)）：量页面里观察到的「亮起 → 清掉」。定时器不会早到（下限只留亮起那一帧的提交延迟），
    // 晚到的余量留给慢机器；仍远紧于原来「4 秒内清掉就行」，改成 0.6 秒或 3 秒都会红。
    const lit = await win.evaluate(() => {
      const log = window.__flashLog
      window.__flashObserver.disconnect()
      const on = log.find((entry) => entry.value === 'flash')
      const off = on ? log.find((entry) => entry.at > on.at && entry.value === null) : undefined
      return { litMs: on && off ? Math.round(off.at - on.at) : null, steps: log.length }
    })
    console.log('FOCUS_FLASH_DURATION', JSON.stringify({ label, ...lit }))
    expect(lit.litMs !== null && lit.litMs >= 1250 && lit.litMs <= 1900, `${label}：闪光应亮约 1.4 秒后清掉（1.25–1.9 秒），实际 ${lit.litMs}ms`).toBe(true)
    await expect.poll(() => canvasZoomPercent(win), { message: `${label}：对焦事件派出后画布没有任何移动` }).not.toBe(before)
    await waitForCanvasViewportSettled(win)
    const submit = win.locator(`.generation-canvas-v2-node[data-node-id="${nodeId}"] ${SUBMIT}, ${SUBMIT}`).first()
    await expect(submit, `${label}：对焦后 ↑ 没出现`).toBeVisible()
    await waitForCanvasViewportSettled(win)
    const after = await canvasZoomPercent(win)
    const probe = await submit.evaluate((button, stageSelector) => {
      const rect = button.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const stage = document.querySelector(stageSelector)?.getBoundingClientRect()
      const hit = document.elementFromPoint(x, y)
      return {
        x, y,
        inStage: Boolean(stage && x >= stage.left && x <= stage.right && y >= stage.top && y <= stage.bottom),
        hitIsButton: Boolean(hit && button.contains(hit)),
        hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : null,
      }
    }, STAGE)
    console.log('FOCUS_COMPOSER', JSON.stringify({ label, zoomBefore: before, zoomAfter: after, ...probe }))
    await screenshotSettled(win, { path: path.join(shotsDir, `${shotName}.png`) })
    expect(after, `${label}：对焦后缩放不许超过 100%（对焦前 ${before}%）`).toBeLessThanOrEqual(100.5)
    expect(probe.inStage, `${label}：↑ 中心 (${probe.x}, ${probe.y}) 在舞台外`).toBe(true)
    expect(probe.hitIsButton, `${label}：↑ 被别的元素盖住：${probe.hit}`).toBe(true)
  }

  await focusAndMeasure('Agent 停靠 / 中文', 'zh-dock')

  await ensureAgentPanelOpen(win, '展开 Agent')
  const toFloat = win.locator(`${AGENT_PANEL} [data-agent-form-to="float"]`).first()
  await clickOrFail(toFloat, 'Agent 切成浮窗')
  await expect(win.locator('[data-agent-float]').first(), 'Agent 浮窗没出现').toBeVisible()
  await focusAndMeasure('Agent 浮窗 / 中文', 'zh-float')

  await setAppLanguage(win, 'en')
  await focusAndMeasure('Agent 浮窗 / 英文', 'en-float')
} catch (error) {
  failure = error
} finally {
  await app.close().catch(() => {})
}
if (failure) {
  console.error(failure)
  process.exit(1)
}
console.log('canvas-focus-composer-visible: OK')
