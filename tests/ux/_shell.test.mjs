// 外壳定位出口 `ensureAgentPanelOpen` 的真浏览器合同（2026-10-28，短片走查冷重启后 15 秒红的类根因）。
//
// 毛病的形状：外壳挂常驻面板有个过程（冷启动、切工作区、重开项目之后都有），老写法一次性采样 `isVisible()`，采在面板挂上之前，
// 就把「还没挂」当成「是小球」，去等一颗永远不会出现的小球——而面板其实已经按落盘的形态好好地展开着。这是**时序**问题，
// 假 locator 复现不了；所以这里用真 Chromium 的一张空白页，按需让面板晚一会儿才挂上 / 只放一颗小球，跑的就是走查里那段真代码。
// 守的是共用出口，不是某一份走查：几十份走查经它展开面板（`expandResidentPanel` / `openCanvas` 再经它回到这里）。
//
// 页面里的面板 / 小球只带外壳发的身份属性（`_shell.mjs` 的 AGENT_PANEL / AGENT_BALL），不依赖任何产品组件。
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { ensureAgentPanelOpen } from './_shell.mjs'

const PANEL = '<div data-agent-resident="true" data-agent-panel="true" style="width:300px;height:200px">panel</div>'
const BALL = '<button data-agent-ball="idle" style="width:44px;height:44px">ball</button>'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 120_000)
afterAll(async () => { await browser?.close() })

/** 一张只有 #host 的空白页；script 里能用 host / PANEL / BALL / window.clicks（点小球的次数）。 */
async function shellPage(script) {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><body><div id="host"></div><script>
    const PANEL = ${JSON.stringify(PANEL)}, BALL = ${JSON.stringify(BALL)}
    const host = document.getElementById('host')
    window.clicks = 0
    // 点小球 = 外壳把面板展开（小球让位）
    const showBall = () => { host.innerHTML = BALL; host.firstChild.addEventListener('click', () => { window.clicks++; host.innerHTML = PANEL }) }
    ${script}
  </script></body>`)
  return page
}

describe('ensureAgentPanelOpen：先等「面板或小球」其中一个出现，再判是哪一个', () => {
  test('面板晚一会儿才挂上、从头到尾没有小球 → 不点任何东西就返回（老写法在这里干等一颗不会出现的小球，15 秒后红）', async () => {
    const page = await shellPage('setTimeout(() => { host.innerHTML = PANEL }, 400)')
    try {
      await ensureAgentPanelOpen(page, '面板晚挂')
      await expect(page.locator('[data-agent-panel]').isVisible()).resolves.toBe(true)
    } finally { await page.close() }
  }, 60_000)

  test('面板一开始就在 → 什么也不点（页面上没有小球，点就会抛）', async () => {
    const page = await shellPage('host.innerHTML = PANEL')
    try {
      await ensureAgentPanelOpen(page, '面板已在')
      expect(await page.evaluate(() => window.clicks)).toBe(0)
    } finally { await page.close() }
  }, 60_000)

  test('只有小球 → 点它一次，面板展开', async () => {
    const page = await shellPage('showBall()')
    try {
      await ensureAgentPanelOpen(page, '小球着')
      expect(await page.evaluate(() => window.clicks)).toBe(1)
      await expect(page.locator('[data-agent-panel]').isVisible()).resolves.toBe(true)
    } finally { await page.close() }
  }, 60_000)

  test('小球晚一会儿才出现 → 等到它再点一次（晚到的小球没有被这次改动弄丢）', async () => {
    const page = await shellPage('setTimeout(showBall, 400)')
    try {
      await ensureAgentPanelOpen(page, '小球晚到')
      expect(await page.evaluate(() => window.clicks)).toBe(1)
    } finally { await page.close() }
  }, 60_000)

  test('面板和小球都不出现 → 照样红，而且信息说的是「都没出现」', async () => {
    const page = await shellPage('')
    try {
      await expect(ensureAgentPanelOpen(page, '都没有', { timeout: 1500 })).rejects.toThrow(/面板和小球都没出现/)
    } finally { await page.close() }
  }, 60_000)
})
