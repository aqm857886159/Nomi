#!/usr/bin/env node
// C77: prompt -> real SDK/tools -> failed save -> retry -> persisted plan. Only HTTP is loopback.
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, expectAbsent, proveProbe, clickOrFail } from './_assert.mjs'
import { installFeelObserver } from './_feel-observer.mjs'
import { FIXTURE_IMAGE_HANDLE, FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import { CREATION_PANEL, DOCUMENT, PROCESS, THINKING_LINE, chooseAssistantModel, createRuntimeWalk,
  hasToolResult, openProcess, recorded, sendCreation, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'

process.env.NOMI_WALK_OUT ||= makeTempDir('nomi-thinking-rows-shots-')
process.env.EVIDENCE_DIR ||= process.env.NOMI_WALK_OUT
const walk = await createRuntimeWalk('thinking-rows')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.keyboard.press('Escape')
  await win.locator(DOCUMENT).fill('清晨，她推开咖啡馆的门。红杯落在白桌上。')
  const calls = [
    { type: 'tool', name: 'read_script', args: {} },
    { type: 'tool', name: 'draft_shots', args: { shots: [] } },
    { type: 'tool', name: 'draft_shots', args: { shots: [{ title: '咖啡馆', prompt: '清晨咖啡馆，红杯落在白桌上', taskKind: 'text_to_image', model: FIXTURE_IMAGE_HANDLE }] } },
    { type: 'tool', name: 'read_script', args: {} },
  ]
  const reasoning = ['先读取文稿。', '把文稿拆成分镜并保存。', '保存失败，补齐镜头后重试。', '保存完成，再核对原文。', '核对完成，可以交付。']
  calls.forEach((call, i) => walk.fixture.expectText({ label: `C77 step ${i}`,
    match: body => i === 0 ? !hasToolResult(body, 'c77-0') : hasToolResult(body, `c77-${i - 1}`) && !hasToolResult(body, `c77-${i}`),
    reply: { id: `c77-${i}`, ...call, reasoning: reasoning[i] },
  }))
  const held = walk.fixture.expectText({ label: 'C77 final thinking', match: body => hasToolResult(body, 'c77-3'),
    reply: { type: 'hold', reasoning: reasoning[4] } })
  await sendCreation(win, '读文稿，保存分镜；如果保存失败就修正后重试，最后核对原文。')
  // draft_shots 保存本地草稿，真实工具结果在没有额外确认的情况下返回。
  await recorded(held.received, 'four real tool results')
  const panel = win.locator(CREATION_PANEL)
  const process = panel.locator(PROCESS)
  await expect(process).toHaveCount(1)
  await openProcess(process)
  const liveProcessProof = await proveProbe(process.locator(':scope > summary'), '运行中的过程摘要可见')
  await expectAbsent(process.locator(THINKING_LINE), {
    provenBy: liveProcessProof, message: '运行中只用过程摘要提示思考，不铺开推理明细',
  })
  await walk.snap('running-light')
  held.release({ type: 'text', text: '分镜已保存，已核对原文。' })
  await expect(panel).toContainText('分镜已保存，已核对原文。')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.getByText('分镜已保存，已核对原文。', { exact: true }) })
  await openProcess(process, '展开完成过程')
  await expect(process.locator(':scope > summary')).toContainText('用了 4 个工具 · 1 次重试')
  const observer = installFeelObserver(win, { name: 'thinking-rows', outputDir: walk.outputDir })
  const light = await walk.snap('settled-light')
  const feel = await observer.checkpoint('settled-light', light)
  await clickOrFail(win.getByRole('button', { name: '设置', exact: true }), '打开设置')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '通用设置')
  await clickOrFail(win.getByRole('button', { name: /切换.*深色|切换.*暗色/ }), '切换暗色')
  await clickOrFail(win.locator('[data-settings-close]'), '关闭设置')
  await walk.snap('settled-dark')
  const count = await process.locator(THINKING_LINE).count()
  const messages = readLaneTranscripts(projectRoot).flatMap(laneMessages)
  const results = messages.filter(message => message.role === 'toolResult' && /^c77-/.test(message.toolCallId))
  walk.report.c77 = { liveThinking: 0, settledThinking: count, toolResults: results.map(r => ({ id: r.toolCallId, isError: r.isError })), repeatedRows: feel.findings.filter(f => f.rule === 'repeated-rows') }
  expect(results).toHaveLength(4)
  expect(results.find(r => r.toolCallId === 'c77-1')?.isError).toBe(true)
  expect(results.find(r => r.toolCallId === 'c77-2')?.isError).toBe(false)
  expect(count, 'one disclosure for all thinking').toBe(1)
  expect(await process.locator('[data-process-folded] > [data-v4-block]').evaluateAll(rows => rows.map(row => row.getAttribute('data-v4-block')))).toEqual(['thinking', 'tool', 'tool-group', 'tool'])
  expect(walk.report.c77.repeatedRows).toEqual([])
  await clickOrFail(process.locator(`${THINKING_LINE} summary`), '查看合并思考正文')
  for (const text of reasoning) await expect(process.locator('[data-v4-thinking-body]')).toContainText(text)
  await clickOrFail(process.getByRole('button', { name: '展开', exact: true }), '展开完整过程')
  await walk.snap('thinking-expanded-dark')
} catch (error) { failure = error }
await walk.finish(failure)
