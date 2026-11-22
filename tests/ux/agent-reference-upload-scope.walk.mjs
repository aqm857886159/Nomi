#!/usr/bin/env node
// 真 App 走查：Agent 参考图上传被扣住时，用户改这一镜，放行后确认必须拒绝且卡上给出下一步。
// 上传端点是 loopback，但请求走生产的 multipart localization；响应由走查显式 release，不用固定延迟。
import path from 'node:path'

import { clickOrFail, expect, proveProbe } from './_assert.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, INTERVENTION_CONFIRM,
  openCanvas, readProject, recorded, sendCanvas, createRuntimeWalk,
} from './agent-runtime-walk-support.mjs'
import { openRailDrawer, openSettings } from './_shell.mjs'
import { repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const ASK_ZH = '用这张参考图生成一张海边纸船的图。'
const ASK_EN = 'Use the selected reference image to make a paper boat by the sea.'
const PLAN_ZH = 'refscope-zh-plan'
const PLAN_EN = 'refscope-en-plan'
const GENERATE_ZH = `${PLAN_ZH}-generate`
const GENERATE_EN = `${PLAN_EN}-generate`

const walk = await createRuntimeWalk('agent-reference-upload-scope', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure

async function importReference(win, projectId) {
  await openRailDrawer(win, 'assets', '打开素材库')
  const input = win.locator('section[aria-label="素材库"] input[type="file"]').first()
  await input.setInputFiles(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'))
  await expect.poll(async () => (await win.evaluate(async (id) => (await window.nomiDesktop.assets.list({ projectId: id, limit: 100 })).items, projectId)).length,
    { message: '参考图要先真实落进隔离项目素材库' }).toBeGreaterThan(0)
  const asset = await win.evaluate(async (id) => {
    const page = await window.nomiDesktop.assets.list({ projectId: id, limit: 100 })
    return page.items.find((item) => item.data?.contentType === 'image/png') ?? page.items[0]
  }, projectId)
  if (!asset?.id || !asset.data?.contentHash) throw new Error(`素材库没有可引用身份：${JSON.stringify(asset)}`)
  const close = win.locator('section[aria-label="素材库"] button[aria-label*="关闭"]').first()
  if (await close.count()) await close.click().catch(() => {})
  return { assetId: asset.id, contentHash: asset.data.contentHash, version: 1, kind: 'image', role: 'reference' }
}

async function runRefusedLeg({ win, projectId, reference, locale, planId, generateId, ask, screenshotName }) {
  const fixture = walk.fixture
  fixture.holdReferenceUploads(true)
  let operationId
  const planner = fixture.expectText({
    label: `${locale} Agent 带参考图起草`,
    match: (body) => (body.messages ?? []).some((message) => message.role === 'user' && JSON.stringify(message.content).includes(ask)),
    reply: { type: 'tool', id: planId, name: 'draft_shots', args: {
    shots: [{ prompt: '海边纸船，柔和晨光', taskKind: 'text_to_image', model: 'gpt-image-2@apimart', references: [reference.assetId] }],
    } },
  })
  const draftResult = fixture.expectText({
    label: `${locale} 起草结果带回 operationId`,
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === planId)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return Boolean(operationId)
    },
    reply: { type: 'hold' },
  })
  const turnDone = fixture.expectText({
    label: `${locale} generate 等用户处理确认卡`,
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && (message.tool_call_id === generateId || /generation_not_started|approval_stale|generation_reference_scope_changed/.test(String(message.content)))),
    reply: { type: 'text', text: locale === 'zh' ? '这张参考图的确认需要你处理。' : 'Please review the reference scope before confirming.' },
  })
  await sendCanvas(win, ask)
  await recorded(planner.received, `${locale} planner request`)
  await recorded(draftResult.received, `${locale} draft result`)
  draftResult.release({ type: 'tool', id: generateId, name: 'generate', args: { operationId } })

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { message: `${locale} 草稿先落画布` }).toBeGreaterThan(0)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProbe = await proveProbe(card, `${locale} 参考图付费卡出现`)
  await expect(card.locator(INTERVENTION_CONFIRM)).toBeVisible()
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), `${locale} 点「生成这张」`, { noWaitAfter: true })
  await expect.poll(() => fixture.uploads.length, { message: `${locale} 真实 multipart 上传已到达并被夹具扣住` }).toBeGreaterThan(0)

  // 上传窗口里改这一镜的提示词，是真用户在卡上改候选的动作。
  const prompt = card.locator('[contenteditable="true"]').first()
  await expect(prompt, `${locale} 卡上提示词仍可编辑`).toBeVisible()
  await prompt.click()
  await win.keyboard.press('End')
  await win.keyboard.type(locale === 'zh' ? ' 用户改了这一镜' : ' user changed this shot')
  await win.keyboard.press('Tab')
  await walk.fixture.holdReferenceUploads(false)
  await expect(card, `${locale} 拒绝后卡仍留在介入槽`).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await walk.snap(screenshotName)
  await card.locator('[data-v4-control="slot-dismiss"]').click()
  await recorded(turnDone.received, `${locale} generate refusal result`)
  await cardProbe // keep the positive probe in the evidence chain
}

try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  const reference = await importReference(win, projectId)
  await runRefusedLeg({ win, projectId, reference, locale: 'zh', planId: PLAN_ZH, generateId: GENERATE_ZH, ask: ASK_ZH, screenshotName: 'reference-upload-scope-refused-zh' })

  // 关闭这一次出价后切换语言，再用同一真实素材跑一遍，留下英文拒绝截图。
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await card.locator('[data-v4-control="slot-dismiss"]').click().catch(() => {})
  const settings = await openSettings(win, { tab: 'general', label: '设置入口' })
  await clickOrFail(settings.locator('[data-settings-locale="en"]'), '切换 English')
  await clickOrFail(settings.locator('[data-settings-close]'), '关闭设置')
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}`)).toBeVisible()
  await runRefusedLeg({ win, projectId, reference, locale: 'en', planId: PLAN_EN, generateId: GENERATE_EN, ask: ASK_EN, screenshotName: 'reference-upload-scope-refused-en' })
  const uploadUrls = new Set(walk.fixture.uploads.map((record) => record.uploadUrl).filter(Boolean))
  for (const image of walk.fixture.images) {
    expect(uploadUrls.has(image.resultUrl), '成片结果地址不能复用参考上传地址').toBe(false)
  }
  walk.report.verified = ['app-agent-real-multipart-upload-held-by-release', 'user-shot-edit-during-upload-refused', 'zh-visible-refusal-screenshot', 'en-visible-refusal-screenshot']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.fixture.holdReferenceUploads(false)
  await walk.finish(failure)
}
