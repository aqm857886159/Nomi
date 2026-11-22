#!/usr/bin/env node
// 剧本 PB03 · 「我在 Agent 面板里把图片默认设成了 Nano Banana 2，再让 Agent 画图」
//
// 已知问题（0.22.1）：设置里的「图片默认 / 视频默认」模型，Agent 不管，这项设置形同虚设。
// 真实创作者会做的事：打开 Agent 面板的模型弹层，把「图片默认」换成自己喜欢的那个，然后说「帮我画一张」。
//
// 大脑怎么选模型（照一个守规矩的真模型）：宿主要是告诉了它「用户的图片默认是 X」，它就用 X；没告诉，它按自己的偏好点名
// （这里是 GPT Image 2）。变体 omit-candidate：大脑不点名模型、让宿主补——对照宿主自己会不会按默认补。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { flattenRequestText, FIXTURE_APIMART_VENDOR } from '../../agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_MODEL, INTERVENTION_CONFIRM, MODEL_POPOVER, expandResidentPanel, sendCanvas,
} from '../../agent-runtime-walk-support.mjs'
import { operationIdOf, scriptTurn } from '../brain.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const DEFAULT_MODEL = { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' }
const LLM_PREFERENCE = 'gpt-image-2'

const pb = await startPlaybook({
  id: 'pb03-default-models',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: () => ({ nodes: [], groups: [], edges: [] }),
})
const { smoke, fixture, monitor } = pb
const EN = pb.locale === 'en'
const omitCandidate = pb.variant === 'omit-candidate'
const win = () => smoke.win
const card = () => win().locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
const imageDefaultRow = () => win().locator(`${CANVAS_PANEL} ${MODEL_POPOVER} [data-v4-model-row="${EN ? 'Image default' : '图片默认'}"]`)

/** 守规矩的真模型：宿主在请求里说了「用户的图片默认是 X」就用 X，否则按自己的偏好点名。 */
function pickImageModel(body) {
  const text = flattenRequestText(body)
  const toldDefault = /(图片默认|默认(的)?(图片)?模型|default image model|image default)/i.test(text) && text.includes(DEFAULT_MODEL.modelKey)
  return toldDefault ? DEFAULT_MODEL.modelKey : LLM_PREFERENCE
}

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('展开 Agent 面板', () => expandResidentPanel(win()), { surfaces: ['agentPanel', 'rightPanel'] })

  await monitor.step('在模型弹层里把「图片默认」设成 Nano Banana 2', async () => {
    await clickOrFail(win().locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`), 'Agent 模型选择器')
    await expect(win().locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`)).toBeVisible()
    await clickOrFail(imageDefaultRow().locator('button').first(), '「图片默认」那一行的下拉')
    const option = win().locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
      .filter({ hasText: new RegExp(`^${DEFAULT_MODEL.label}(\\s|$|·)`) }).first()
    await clickOrFail(option, `下拉里的「${DEFAULT_MODEL.label}」`)
    await expect(imageDefaultRow(), '弹层那一行现在写着 Nano Banana 2').toContainText(DEFAULT_MODEL.label)
    monitor.recordDeclaredDefault({ kind: 'image', ...DEFAULT_MODEL, where: EN ? 'Agent panel · Image default ' : 'Agent 面板「图片默认」' })
    await monitor.screenshot('declared-image-default')
    await win().keyboard.press('Escape')
  }, { surfaces: [] })

  const prompt = EN ? 'A red paper boat floating in a puddle after rain' : '雨后水洼里漂着一只红色纸船'
  const turn = scriptTurn(fixture, {
    label: 'pb03-draft',
    marker: 'PB03',
    steps: [
      { name: 'draft_shots', args: ({ body }) => ({ shots: [omitCandidate
        ? { prompt, taskKind: 'text_to_image', parameters: { aspect_ratio: '1:1' } }
        : { prompt, taskKind: 'text_to_image', model: `${pickImageModel(body)}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '1:1' } }] }) },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      { text: EN ? 'Started.' : '开始生成了。' },
    ],
  })
  await monitor.step('用户：帮我画一张图', () => sendCanvas(win(), EN ? 'PB03: draw me a red paper boat in a puddle.' : 'PB03：帮我画一张雨后水洼里的红色纸船。'), { surfaces: [] })
  await monitor.step('等 Agent 起草、摆出付费卡', async () => {
    await expect(card(), 'Agent 起草完要摆一张付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  }, { user: false, surfaces: [] })
  await monitor.step('在付费卡上确认', async () => {
    await monitor.consentSpendCard(card(), { label: '单镜卡' })
    await clickOrFail(card().locator(INTERVENTION_CONFIRM), '付费卡主按钮', { noWaitAfter: true })
  })
  await monitor.step('等出图、等这一轮说完', async () => {
    await expect.poll(() => fixture.images.length, { message: '供应商收到这一镜', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
    await turn.done
  }, { user: false, surfaces: [] })
  await monitor.settle('收尾')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb03 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
