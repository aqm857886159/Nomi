// 外壳定位出口 `ensureAgentPanelOpen` 的真浏览器合同（2026-10-28，短片走查冷重启后 15 秒红的类根因）。
//
// 毛病的形状：外壳挂常驻面板有个过程（冷启动、切工作区、重开项目之后都有），老写法一次性采样 `isVisible()`，采在面板挂上之前，
// 就把「还没挂」当成「收着」，去点一颗不该点的钮——而面板其实已经按落盘的形态好好地展开着。这是**时序**问题，
// 假 locator 复现不了；所以这里用真 Chromium 的一张空白页，按需让面板晚一会儿才挂上 / 只放一颗收着的顶栏入口，跑的就是走查里那段真代码。
// 守的是共用出口，不是某一份走查：几十份走查经它展开面板（`expandResidentPanel` / `openCanvas` 再经它回到这里）。
//
// 页面里的面板 / 入口只带外壳发的身份属性（`_shell.mjs` 的 AGENT_PANEL / NOMI_ENTRY_COLLAPSED），不依赖任何产品组件。
// 入口一直在顶栏：面板开着时它按下（aria-pressed=true），所以「面板晚挂」那一格里入口从头到尾按着，不该被点。
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { ensureAgentPanelOpen } from './_shell.mjs'

const PANEL = '<div data-agent-resident="true" data-agent-panel="true" style="width:300px;height:200px">panel</div>'
const ENTRY_PRESSED = '<header data-shell-topbar><button data-shell-nomi-entry aria-pressed="true" style="width:28px;height:28px">Nomi</button></header>'
const BALL = '<header data-shell-topbar><button data-shell-nomi-entry aria-pressed="false" style="width:28px;height:28px">Nomi</button></header>'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 120_000)
afterAll(async () => { await browser?.close() })

/** 一张只有 #host 的空白页；script 里能用 host / PANEL / BALL（收着的入口）/ ENTRY_PRESSED / window.clicks（点入口的次数）。 */
async function shellPage(script) {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><body><div id="host"></div><script>
    const PANEL = ${JSON.stringify(PANEL)}, BALL = ${JSON.stringify(BALL)}, ENTRY_PRESSED = ${JSON.stringify(ENTRY_PRESSED)}
    const host = document.getElementById('host')
    window.clicks = 0
    // 点收着的入口 = 外壳把面板展开（入口变成按下）
    const showBall = () => { host.innerHTML = BALL; host.querySelector('button').addEventListener('click', () => { window.clicks++; host.innerHTML = ENTRY_PRESSED + PANEL }) }
    ${script}
  </script></body>`)
  return page
}

describe('ensureAgentPanelOpen：先等「面板或收着的入口」其中一个出现，再判是哪一个', () => {
  test('面板晚一会儿才挂上、入口从头到尾按着 → 不点任何东西就返回（老写法在这里干等一颗不会出现的小球，15 秒后红）', async () => {
    const page = await shellPage('host.innerHTML = ENTRY_PRESSED; setTimeout(() => { host.innerHTML = ENTRY_PRESSED + PANEL }, 400)')
    try {
      await ensureAgentPanelOpen(page, '面板晚挂')
      await expect(page.locator('[data-agent-panel]').isVisible()).resolves.toBe(true)
    } finally { await page.close() }
  }, 60_000)

  test('面板一开始就在 → 什么也不点（入口按着，点就会抛）', async () => {
    const page = await shellPage('host.innerHTML = ENTRY_PRESSED + PANEL')
    try {
      await ensureAgentPanelOpen(page, '面板已在')
      expect(await page.evaluate(() => window.clicks)).toBe(0)
    } finally { await page.close() }
  }, 60_000)

  test('只有收着的入口 → 点它一次，面板展开', async () => {
    const page = await shellPage('showBall()')
    try {
      await ensureAgentPanelOpen(page, '收着')
      expect(await page.evaluate(() => window.clicks)).toBe(1)
      await expect(page.locator('[data-agent-panel]').isVisible()).resolves.toBe(true)
    } finally { await page.close() }
  }, 60_000)

  test('收着的入口晚一会儿才出现 → 等到它再点一次（晚到的入口没有被这次改动弄丢）', async () => {
    const page = await shellPage('setTimeout(showBall, 400)')
    try {
      await ensureAgentPanelOpen(page, '入口晚到')
      expect(await page.evaluate(() => window.clicks)).toBe(1)
    } finally { await page.close() }
  }, 60_000)

  test('面板和收着的入口都不出现 → 照样红，而且信息说的是「都没出现」', async () => {
    const page = await shellPage('')
    try {
      await expect(ensureAgentPanelOpen(page, '都没有', { timeout: 1500 })).rejects.toThrow(/面板和收着的顶栏 Nomi 入口都没出现/)
    } finally { await page.close() }
  }, 60_000)
})
