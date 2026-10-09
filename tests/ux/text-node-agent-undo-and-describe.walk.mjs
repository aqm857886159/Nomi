#!/usr/bin/env node
// 文本节点真实走查（屏外真 Electron、隔离资料、零额度）——两件事：
//
//   ① Agent 写正文之后，点回执上的「撤销」：编辑器里显示的正文要真的回到写之前的样子
//      （不是只有 store 回去、要按编辑器自己的 Ctrl+Z 才恢复）。
//   ② 「看图写描述」：用本地图片夹具导入一张图、连一条 图 → 文本 的边，真点按钮能发起、能停止；
//      没连图时点它，要有看得见的提示（不是点了没反应）。
//
// 文本模型 = loopback 夹具（agent-runtime-fixture.mjs）；没有任何付费供应商调用。
// Run: pnpm run build && node tests/ux/text-node-agent-undo-and-describe.walk.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, proveProbe } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, TOOL_RECEIPT, chooseAssistantModel, createRuntimeWalk, expandResidentPanel, hasToolResult, openCanvas, readProject, recorded,
  sendCanvas, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const IMAGE = path.join(here, 'fixtures', 'test-upload.png')

const MANUAL = '人工正文'
const AGENT_TEXT = 'Agent 写入后的正文'
const WRITE_CALL = 'text-node-write-1'
const NODE = '.generation-canvas-v2-node[data-kind="text"]'

const walk = await createRuntimeWalk('text-node-undo-describe')
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const project = await walk.newProject()
  const { projectId } = project
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await openCanvas(win)
  await win.reload(); await win.waitForLoadState('domcontentloaded')
  await openCanvas(win)
  await expandResidentPanel(win)

  const rail = win.locator('.generation-canvas-v2-toolbar').first()
  const nodeIds = () => win.evaluate(() => (window.__nomiCanvasStore?.getState().nodes || []).map((node) => node.id))
  const editorOf = (id) => win.locator(`[data-node-id="${id}"] .ProseMirror`).first()

  // ── 一 · Agent 写正文 → 点回执「撤销」（两种起手：打完字还在编辑器里 / 点开空白处失焦）────────────
  async function agentWriteThenUndo({ tag, keepFocus, selectAll = false, fill = false }) {
    const before = new Set(await nodeIds())
    await clickOrFail(rail.locator('button[aria-label="添加文字节点"]'), '左缘「添加文字节点」')
    await expect.poll(async () => (await nodeIds()).filter((id) => !before.has(id)).length).toBe(1)
    const id = (await nodeIds()).find((candidate) => !before.has(candidate))
    await expect.poll(() => win.locator(`[data-node-id="${id}"]`).count()).toBe(1)
    await clickOrFail(editorOf(id), '点进文本节点正文')
    if (fill) await editorOf(id).fill(MANUAL)
    else await win.keyboard.type(MANUAL)
    if (selectAll) await win.keyboard.press('Control+A')
    if (!keepFocus) {
      const blank = await findCanvasBlankPoint(win)
      await win.mouse.click(blank.x, blank.y)
    }
    await expect.poll(async () => (await editorOf(id).innerText()).trim()).toBe(MANUAL)
    const call = `text-node-write-${tag}`
    const trigger = `S_TEXT_WRITE_${tag}`
    const writeRequest = walk.fixture.expectText({
      label: `agent writes the text node body (${tag})`,
      match: (body) => flattenRequestText(body).includes(trigger) && !hasToolResult(body, call),
      reply: { type: 'tool', id: call, name: 'write_node_text', args: { nodeId: id, text: AGENT_TEXT } },
    })
    const writeFollowup = walk.fixture.expectText({
      label: `lane returns the write receipt (${tag})`,
      match: (body) => hasToolResult(body, call),
      reply: { type: 'text', text: `${trigger}_DONE：正文已改。` },
    })
    await sendCanvas(win, `${trigger}：把文本节点 ${id} 的正文改成「${AGENT_TEXT}」。`)
    await recorded(writeRequest.received, 'write request')
    await recorded(writeFollowup.received, 'write receipt')
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: win.locator(CANVAS_PANEL).getByText(`${trigger}_DONE`, { exact: false }) })
    await expect.poll(async () => (await editorOf(id).innerText()).trim(), { message: '编辑器里显示的是 Agent 写的正文' }).toBe(AGENT_TEXT)
    await walk.snap(`01-agent-wrote-${tag}`)
    // 收据收在「用了 N 个工具」这一折里，用户要先点开才看得见那行与它的「撤销」。
    const folds = win.locator(CANVAS_PANEL).getByText(/用了 [0-9]+ 个工具/)
    await clickOrFail(folds.last(), '展开「用了 N 个工具」')
    const receipt = win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last()
    await proveProbe(receipt, 'Agent 写正文之后面板上有一行收据')
    const undoButton = receipt.getByRole('button', { name: '撤销', exact: true })
    await proveProbe(undoButton, '收据上的「撤销」钮可见')
    await clickOrFail(undoButton, '点回执上的「撤销」')
    await expect.poll(async () => (await editorOf(id).innerText()).trim(), { message: `[${tag}] 点撤销后编辑器里显示的正文回到写之前（不靠 Ctrl+Z）` }).toBe(MANUAL)
    await expect.poll(async () => {
      const node = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((candidate) => candidate.id === id)
      const json = JSON.stringify(node?.contentJson ?? null)
      return json.includes(MANUAL) && !json.includes(AGENT_TEXT)
    }, { message: `[${tag}] 盘上那份也回去了` }).toBe(true)
    await walk.snap(`02-undone-${tag}`)
    return id
  }
  await agentWriteThenUndo({ tag: 'FILLED', keepFocus: false, fill: true })
  await agentWriteThenUndo({ tag: 'SELECTED', keepFocus: true, selectAll: true })
  await agentWriteThenUndo({ tag: 'FOCUSED', keepFocus: true })
  const textId = await agentWriteThenUndo({ tag: 'BLURRED', keepFocus: false })

  // ── 二 · 看图写描述：没连图 → 有提示；连了图 → 能发起、能停止 ───────────────────────────
  await clickOrFail(win.locator(`[data-node-id="${textId}"] header[aria-label="拖动文本节点"]`).first(), '选中文本节点')
  const composer = win.locator('[data-text-process-box]')
  await expectVisible(composer, '选中文本节点后出现加工框')
  const describe = composer.locator('[data-preset="describe"]')
  // 没连图：按钮不可点 + 说明原因（和生成钮缺参考时同一种做法），不是点了没反应。
  await expect(describe, '没连图时「看图写描述」不可点').toBeDisabled()
  await expect(describe, '不可点的原因写在按钮上').toHaveAttribute('title', /图片/)
  await walk.snap('03-describe-without-image')
  await expect(win.locator(`[data-node-id="${textId}"] [data-text-node-footer="running"]`), '没连图不会进入运行').toHaveCount(0)

  // 本地图片夹具 → 「导入文件」→ 画布上多一个带图的节点。
  const before = new Set(await nodeIds())
  const chooser = win.waitForEvent('filechooser', { timeout: stationTimeout({ operations: 1 }) })
  await clickOrFail(win.getByRole('button', { name: '导入文件' }).first(), '左缘「导入文件」')
  await (await chooser).setFiles([IMAGE])
  await expect.poll(async () => (await nodeIds()).filter((id) => !before.has(id)).length, { timeout: stationTimeout({ operations: 2 }) }).toBe(1)
  const imageId = (await nodeIds()).find((id) => !before.has(id))
  await expect.poll(() => win.evaluate((id) => Boolean(window.__nomiCanvasStore.getState().nodes.find((n) => n.id === id)?.result?.url), imageId), { timeout: stationTimeout({ operations: 2 }) }).toBe(true)
  // 连一条 图 → 文本 的边（真 store 动作，与拖线 / 点选连线同一条 connectNodes）。
  const edgeOk = await win.evaluate(([from, to]) => {
    window.__nomiCanvasStore.getState().connectNodes(from, to)
    return window.__nomiCanvasStore.getState().edges.some((edge) => edge.source === from && edge.target === to)
  }, [imageId, textId])
  expect(edgeOk, '图 → 文本 的边连上了（能力表收图）').toBe(true)

  const describeRequest = walk.fixture.expectText({
    label: 'describe-image text stream (held)',
    match: (body) => flattenRequestText(body).includes('请看附带的图片'),
    reply: { type: 'hold', text: 'S_DESCRIBE_PARTIAL：一张图' },
  })
  await clickOrFail(win.locator(`[data-node-id="${textId}"] header[aria-label="拖动文本节点"]`).first(), '重新选中文本节点')
  await clickOrFail(win.locator('[data-text-process-box] [data-preset="describe"]'), '连了图后点「看图写描述」')
  await recorded(describeRequest.received, 'describe request reached the text model')
  const footer = win.locator(`[data-node-id="${textId}"] [data-text-node-footer="running"]`)
  await expectVisible(footer, '进入运行：底部「正在写 · 停止」')
  await walk.snap('04-describe-running')
  await clickOrFail(footer.getByRole('button', { name: '停止' }), '点「停止」')
  await expect(footer, '停止后退出运行').toHaveCount(0, { timeout: stationTimeout({ operations: 1 }) })
  await walk.snap('05-describe-stopped')
  expect(walk.fixture.images, '全程没有图片生成请求').toHaveLength(0)
  console.log(`\ntext-node-undo-describe 走查通过（project=${projectId}）`)
} catch (error) {
  failure = error
  console.error('text-node-undo-describe 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  if (failure) process.exit(1)
}
