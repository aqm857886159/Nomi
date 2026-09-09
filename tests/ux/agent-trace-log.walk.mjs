#!/usr/bin/env node
// Three user turns through the real Electron / pi lane with a loopback model.
import fs from 'node:fs'
import path from 'node:path'
import { expect, clickOrFail } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CREATION_PANEL, HISTORY_BUTTON, DOCUMENT, chooseAssistantModel, createRuntimeWalk,
  hasToolResult, recorded, sendCreation, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'
import { readLaneTranscripts } from './agent-lane-observer.mjs'

const walk = await createRuntimeWalk('trace-log')
let failure
try {
  const { win, app } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await win.locator(DOCUMENT).fill('雨停了，小猫从门口探出头。')
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  for (let turn = 1; turn <= 3; turn += 1) {
    const prompt = `TRACE_ROUND_${turn}：读一下故事，再用一句话总结。`
    const id = `trace-read-${turn}`
    const called = walk.fixture.expectText({ label: `turn ${turn} reads the real document`,
      match: body => flattenRequestText(body).includes(prompt) && !hasToolResult(body, id),
      reply: { type: 'tool', id, name: 'read_full_text', args: {} } })
    const done = walk.fixture.expectText({ label: `turn ${turn} receives its tool result`,
      match: body => hasToolResult(body, id), reply: { type: 'text', text: `第 ${turn} 回合：雨后，小猫出门。` } })
    await sendCreation(win, prompt)
    await recorded(called.received, `turn ${turn} tool request`)
    await recorded(done.received, `turn ${turn} response`)
    await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
      settledBy: win.locator(CREATION_PANEL).getByText(`第 ${turn} 回合：雨后，小猫出门。`, { exact: true }) })
  }
  const native = readLaneTranscripts(projectRoot)
  expect(native).toHaveLength(1)
  const traceDirectory = path.join(path.dirname(native[0].path), `${native[0].sessionId}.trace`)
  const rows = () => fs.readFileSync(path.join(traceDirectory, 'trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  await expect.poll(() => rows().filter(row => row.status === 'completed').length).toBe(3)
  for (const [index, row] of rows().entries()) {
    expect(row.schemaVersion).toBe(1)
    expect(row.sessionId).toBe(native[0].sessionId)
    expect(row.turnId).toBeTruthy()
    expect(row.timestamp).toBeGreaterThan(0)
    expect(row.prompt).toContain(`TRACE_ROUND_${index + 1}`)
    expect(row.models.length).toBeGreaterThan(0)
    expect(Object.keys(row.tokens)).toEqual(['input', 'cacheRead', 'cacheWrite', 'output'])
    expect(row).toHaveProperty('estimatedCostUsd')
    expect(row.durationMs).toBeGreaterThanOrEqual(0)
    expect(row.tools).toHaveLength(1)
    expect(row.tools[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(row.tools[0].failed).toBe(false)
    expect(row.tools[0].resultSummary).toContain('小猫')
    expect(row.approvals.length).toBeGreaterThan(0)
    expect(row.errors).toEqual([])
  }
  // The real shell is called; only record the argument while retaining actual Finder behavior.
  await app.evaluate(({ shell }) => {
    const original = shell.openPath.bind(shell)
    globalThis.traceOpenedPaths = []
    shell.openPath = async directory => { globalThis.traceOpenedPaths.push(directory); return original(directory) }
  })
  await clickOrFail(win.locator(`${CREATION_PANEL} ${HISTORY_BUTTON}`), '会话菜单')
  await walk.snap('session-menu-after')
  await clickOrFail(win.locator('[data-agent-trace-open="session"]'), '查看轨迹')
  await expect.poll(() => app.evaluate(() => globalThis.traceOpenedPaths)).toEqual([traceDirectory])
  await clickOrFail(win.getByRole('button', { name: '设置', exact: true }), '设置')
  const dialog = win.getByRole('dialog')
  await clickOrFail(dialog.locator('aside button').filter({ hasText: '通用' }), '通用设置')
  await walk.snap('settings-after')
  await clickOrFail(win.locator('[data-agent-trace-open="project"]'), '日志打开目录')
  await expect.poll(() => app.evaluate(() => globalThis.traceOpenedPaths)).toEqual([traceDirectory, path.join(projectRoot, '.nomi', 'agent-sessions')])
  expect(fs.readFileSync(path.join(projectRoot, '.nomi', 'agent-sessions', 'index.md'), 'utf8')).toContain('3 turns')
  for (const name of ['trace.md', 'trace.jsonl']) fs.copyFileSync(path.join(traceDirectory, name), path.join(walk.outputDir, name))
  fs.copyFileSync(native[0].path, path.join(walk.outputDir, 'native-session.jsonl'))
  Object.assign(walk.report, { traceRows: rows().length, toolWriteRate: '3/3', turnSuccessRate: '3/3',
    openedDirectories: await app.evaluate(() => globalThis.traceOpenedPaths) })
} catch (error) { failure = error } finally { await walk.finish(failure) }
