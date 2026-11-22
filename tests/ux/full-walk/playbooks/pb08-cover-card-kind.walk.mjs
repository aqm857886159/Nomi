#!/usr/bin/env node
// 剧本 PB08 · 「让 Agent 做一个封面（3:4）」——付费卡上说的是图还是视频，只有一个答案
//
// 已知问题（2026-09-30，用户实见）：用户说「做一个封面，3:4」。Agent 在画布上建的是「镜头 · 视频」节点、
// 节点上写「排队中 · 第 1/1」；付费卡标题「生成这 1 段视频？」，卡里却是文生图 / 改图、一个图片模型、3:4 的图片尺寸；
// 卡上的模型和参数改不了；点「仍要生成」弹出「这一步没成，Nomi 没有开始生成」。
//
// 这条剧本走两个回合（同一个 Agent 大脑、同一个图片模型，唯一的差别是提示词里有没有「镜头」这类字）：
//   A 对照：「一张书籍封面，青绿色海面上一只白鹭，3:4 竖版」——不带 taskKind（Agent 常常不写）。
//   B 复现：「电影镜头感的书籍封面……」——同样不带 taskKind，提示词里有「镜头」。
// 每回合都在用户点头之前读下：卡标题、卡指着的节点（种类、模型、上面写的字）；再点主按钮，看供应商收到什么。
// D2 起（2026-10-24）卡上没有可改的东西：模型和参数在节点上改，卡读节点、按「生成」就是照节点此刻的样子交给画布。
//
// 零花费：供应商是本机回环夹具。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from '../../agent-runtime-fixture.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM, expandResidentPanel, sendCanvas } from '../../agent-runtime-walk-support.mjs'
import { operationIdOf, scriptTurn } from '../brain.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const pb = await startPlaybook({
  id: 'pb08-cover-card-kind',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: () => ({ nodes: [], groups: [], edges: [] }),
})
const { smoke, fixture, monitor } = pb
const win = () => smoke.win
const card = () => win().locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
const nodes = async () => (await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []

const CASES = [
  { id: 'A', marker: 'PB08A', ask: '做一个封面，3:4', prompt: '一张书籍封面，青绿色海面上一只白鹭，3:4 竖版' },
  { id: 'B', marker: 'PB08B', ask: '做一个电影感的封面，3:4', prompt: '电影镜头感的书籍封面，青绿色海面上一只白鹭，3:4 竖版' },
]

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('展开 Agent 面板', () => expandResidentPanel(win()), { surfaces: ['agentPanel', 'rightPanel'] })

  for (const one of CASES) {
    const turn = scriptTurn(fixture, {
      label: `pb08-${one.id}`,
      marker: one.marker,
      steps: [
        // 不带 taskKind：Agent 只点名了图片模型和 3:4，「这是图还是视频」留给宿主去推。
        { name: 'draft_shots', args: { shots: [{ title: '封面', prompt: one.prompt, model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '3:4' } }] } },
        { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
        { text: '好的，开始生成。' },
      ],
    })
    await monitor.step(`${one.id} · 用户：${one.ask}`, () => sendCanvas(win(), `${one.marker}：${one.ask}`), { surfaces: [] })
    await monitor.step(`${one.id} · 等 Agent 起草、摆出付费卡`, async () => {
      await expect(card(), 'Agent 起草完要摆一张付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
      await win().waitForTimeout(1500)
    }, { user: false, surfaces: [] })
    await monitor.screenshot(`${one.id}-card-before-confirm`)

    await monitor.step(`${one.id} · 读卡和它指着的节点`, async () => {
      const facts = await card().evaluate((element) => ({
        title: String(element.querySelector('[data-v4-block="slot-title"]')?.textContent ?? '').trim(),
        text: String(element.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
        controls: [...element.querySelectorAll('button, select, input, [role="combobox"], [role="button"]')].map((control) => ({
          tag: control.tagName.toLowerCase(), label: String(control.getAttribute('aria-label') ?? control.textContent ?? '').trim().slice(0, 40),
          disabled: control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true',
        })),
      }))
      const placeholder = (await nodes()).at(-1) ?? null
      monitor.note({ kind: `case-${one.id}-card`, facts, canvasNode: placeholder ? { id: placeholder.id, kind: placeholder.kind, title: placeholder.title, model: placeholder.meta?.modelKey ?? null, status: placeholder.status } : null })
    }, { user: false, surfaces: [] })

    await monitor.step(`${one.id} · 在付费卡上点「生成」`, async () => {
      await monitor.consentSpendCard(card(), { label: `${one.id} 卡的主按钮` })
      await monitor.screenshot(`${one.id}-card-consent`)
      await clickOrFail(card().locator(INTERVENTION_CONFIRM), '付费卡主按钮', { noWaitAfter: true })
    })
    await monitor.step(`${one.id} · 看点完之后发生了什么（供应商收到没有 / 有没有提示）`, async () => {
      const before = fixture.images.length + (fixture.videos?.length ?? 0)
      await expect.poll(() => fixture.images.length + (fixture.videos?.length ?? 0), { timeout: stationTimeout() }).toBeGreaterThan(before).catch(() => undefined)
      await win().waitForTimeout(1500)
      const toasts = await win().evaluate(() => [...document.querySelectorAll('.mantine-Notification-root, [role="status"], [role="alert"]')].map((el) => String(el.innerText ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))
      monitor.note({ kind: `case-${one.id}-after-confirm`, toasts, images: fixture.images.length, videos: fixture.videos?.length ?? 0 })
      await monitor.screenshot(`${one.id}-after-confirm`)
    }, { user: false, surfaces: ['*'] })
    await turn.done.catch(() => undefined)
    // 卡没走完就清掉：用户按 × 收回这一次出价，下一个回合从干净的状态起。
    if (await card().count()) await clickOrFail(card().locator('[data-v4-control="dismiss"], [data-v4-control="close"]').first(), '付费卡 ×').catch(() => undefined)
  }

  await monitor.settle('两个回合都走完')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb08 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
void DEFAULT_TIMEOUT_MS
