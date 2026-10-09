#!/usr/bin/env node
// 文本节点「跟随 Agent 的模型」真实走查（屏外真 Electron、隔离资料、零额度）。
//
// 装两个文本模型，Agent 面板选**第二个**（不是清单第一个），在文本节点上点「扩写」：
//   · 扩写能完成（正文变长、底部不再「正在写」）；
//   · 发出的请求用的就是面板选的第二个（夹具收到的 model 是 B，不是清单第一个 A）。
// 旧行为：「跟随」另取清单里第一个可用模型，面板说 B、实际用 A。
// 文本模型 = loopback 夹具；没有任何付费供应商调用。
// Run: pnpm run build && node tests/ux/text-node-follow-agent-model.walk.mjs
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_TEXT_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, chooseAssistantModel, createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

const SECOND_KEY = 'agent-runtime-text-b'
const SECOND_LABEL = 'Fixture 文本 B'
const BODY = '一只猫。窗外下雨。'
const EXPANDED = '一只橘色的猫安静地蜷坐在老式木窗台上，窗外细雨斜落，柔和的冷灰色自然光，浅景深，胶片质感。'

const walk = await createRuntimeWalk('text-node-follow-agent-model')
// 夹具目录里原本只有一个文本模型：同一家再加一个（排在后面），清单第一个仍是原来的 A。
const catalogFile = path.join(walk.settingsDir, 'model-catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const first = catalog.models.find((model) => model.vendorKey === FIXTURE_VENDOR && model.modelKey === FIXTURE_TEXT_MODEL)
catalog.models.push({ ...first, modelKey: SECOND_KEY, labelZh: SECOND_LABEL })
fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)

let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, SECOND_LABEL, CANVAS_PANEL)
  await win.keyboard.press('Escape')

  const expandRequest = walk.fixture.expectText({
    label: 'expand follows the Agent-chosen model',
    match: (body) => flattenRequestText(body).includes('扩写成一条'),
    reply: { type: 'text', text: EXPANDED },
  })
  const rail = win.locator('.generation-canvas-v2-toolbar').first()
  await clickOrFail(rail.locator('button[aria-label="添加文字节点"]'), '左缘「添加文字节点」')
  const id = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.at(-1).id)
  const editor = win.locator(`[data-node-id="${id}"] .ProseMirror`).first()
  await clickOrFail(editor, '点进文本节点正文')
  await editor.fill(BODY)
  await clickOrFail(win.locator(`[data-node-id="${id}"] header[aria-label="拖动文本节点"]`).first(), '选中文本节点')
  await clickOrFail(win.locator('[data-text-process-box] [data-preset="expand"]'), '点「扩写」')
  const running = win.locator(`[data-node-id="${id}"] [data-text-node-footer="running"]`)
  // 探针先证明测得到：运行中的「正在写」确实出现过，后面的「不在了」才有意义。
  const runningProof = await proveProbe(running, '进入运行：底部「正在写」')

  await recorded(expandRequest.received, 'expand request reached the text model')
  await expect.poll(async () => (await editor.innerText()).trim(), { timeout: stationTimeout({ operations: 3 }), message: '扩写完成：正文变成扩写后的版本' }).toBe(EXPANDED)
  await expectAbsent(running, { provenBy: runningProof, message: '扩写完成后退出运行' }, stationTimeout({ operations: 1 }))
  const models = walk.fixture.requests.map((request) => request.body?.model)
  expect(models, '请求用的是面板选的第二个模型，不是清单第一个').toEqual([SECOND_KEY])
  await walk.snap('expanded-on-second-model')
  console.log(`\ntext-node-follow-agent-model 走查通过：扩写请求的模型 = ${models.join(',')}`)
} catch (error) {
  failure = error
  console.error('text-node-follow-agent-model 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  if (failure) process.exit(1)
}
