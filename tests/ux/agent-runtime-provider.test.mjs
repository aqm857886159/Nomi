// Tests the walk's real setup/finally, substituting only its UI task body.
// Synthetic files only: no app, provider, user settings or credentials are accessed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { finalizeRuntimeWalk, stopRuntimeApp } from './agent-runtime-walk-support.mjs'

const source = fs.readFileSync(new URL('./agent-runtime-provider.walk.mjs', import.meta.url), 'utf8').replace(/^#![^\n]*\n/, '')
const tree = ts.createSourceFile('provider.walk.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const uiTry = tree.statements.find(ts.isTryStatement)
if (!uiTry?.finallyBlock) throw new Error('The live walk must have an owned cleanup boundary')
const launchIndex = uiTry.tryBlock.statements.findIndex((statement) => ts.isExpressionStatement(statement)
  && ts.isBinaryExpression(statement.expression) && statement.expression.left.getText(tree) === 'launched')
if (launchIndex < 0) throw new Error('The live walk must have an explicit app launch boundary')
const testTree = ts.factory.updateSourceFile(tree, tree.statements.filter((statement) => !ts.isImportDeclaration(statement)).map((statement) => {
  if (statement !== uiTry) return statement
  return ts.factory.updateTryStatement(statement,
    ts.factory.createBlock([...uiTry.tryBlock.statements.slice(0, launchIndex), ts.factory.createExpressionStatement(ts.factory.createAwaitExpression(
      ts.factory.createCallExpression(ts.factory.createIdentifier('runUiTask'), undefined, []),
    ))]), statement.catchClause, statement.finallyBlock)
}))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const execute = new AsyncFunction('fs', 'os', 'path', 'createHash', 'repoRoot', 'process',
  'finalizeRuntimeWalk', 'stopRuntimeApp', 'runUiTask', 'expect', ts.createPrinter().printFile(testTree))
const variableIndex = (name) => uiTry.tryBlock.statements.findIndex((statement) => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some((declaration) => declaration.name.getText(tree) === name))
const evidenceStart = variableIndex('landed')
const evidenceEnd = variableIndex('receipt')
if (evidenceStart < 0 || evidenceEnd <= evidenceStart) throw new Error('The live walk must validate persisted canvas and native tool evidence')
const verifyCanvasEvidence = new AsyncFunction('readProject', 'win', 'projectId', 'readLaneTranscripts', 'projectRoot', 'laneMessages', 'expect',
  uiTry.tryBlock.statements.slice(evidenceStart, evidenceEnd).map((statement) => statement.getText(tree)).join('\n'))

// 这份合成转录照 v2 真正走得通的那条路编：`make_artifact` 一次一件（`create_canvas_nodes`，
// 只造一个 `agent-artifact` 节点）＋ `arrange_canvas` 连一条参考线（`connect_canvas_edges`）。
// 形状逐项对着生产代码：`verbs/verbSemanticInput.ts`（动词 → 语义输入）与 `canvasWrite.ts` 的结果 schema。
// 旧版这里编的是「一次调用建两个 image 节点」——那是本分支关掉的那扇门，今天在真机上是 `wrong_verb`。
function canvasEvidence(overrides = {}) {
  const landed = {
    nodes: [{ id: 'source', title: 'NOMILIVESOURCE', kind: overrides.kind ?? 'agent-artifact' },
      { id: 'target', title: 'NOMILIVETARGET', kind: overrides.kind ?? 'agent-artifact' }],
    edges: [{ id: 'edge-1', source: 'source', target: 'target', mode: overrides.mode ?? 'reference' }],
  }
  const artifact = (id, title, nodeId) => [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'make_artifact', id, arguments: { fileType: 'text', title, content: 'x' } }] },
    { role: 'toolResult', toolName: 'make_artifact', toolCallId: id, isError: false,
      details: { applied: true, operation: 'create_canvas_nodes', affectedNodeIds: [nodeId] },
      content: [{ type: 'text', text: 'Applied create_canvas_nodes.' }] },
  ]
  const link = { role: 'toolResult', toolName: 'arrange_canvas', toolCallId: 'link-1', isError: false,
    details: { applied: true, operation: 'connect_canvas_edges', affectedNodeIds: [], affectedEdgeIds: ['edge-1'], connectedCount: 1 },
    content: [{ type: 'text', text: 'Applied connect_canvas_edges.' }], ...overrides.link }
  const messages = [
    ...artifact('create-1', 'NOMILIVESOURCE', 'source'),
    ...artifact('create-2', 'NOMILIVETARGET', 'target'),
    { role: 'assistant', content: [{ type: 'toolCall', name: overrides.linkVerb ?? 'arrange_canvas', id: 'link-1',
      arguments: { links: [{ fromId: 'source', toId: 'target', role: 'reference' }] } }] },
    link,
  ]
  return verifyCanvasEvidence(async () => ({ payload: { generationCanvas: landed } }), {}, 'project', () => [{}], '/synthetic', () => messages, expect)
}

let root
let sourceFile
let originalExitCode
const originalWrite = fs.writeFileSync.bind(fs)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-provider-cleanup-test-'))
  sourceFile = path.join(root, 'source', 'model-catalog.json')
  fs.mkdirSync(path.dirname(sourceFile))
  originalWrite(sourceFile, JSON.stringify({
    version: 9,
    vendors: [{ key: 'apimart', baseUrlHint: 'https://api.apimart.ai', providerKind: 'openai-compatible' }],
    models: [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-pro' }],
    apiKeysByVendor: { apimart: { apiKey: 'SYNTHETIC_OS_ENCRYPTED_VALUE', enc: 'safeStorage' } },
  }))
  originalExitCode = process.exitCode
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

async function run(runUiTask = async () => {}) {
  const isolatedProcess = { argv: ['node', 'walk', '--packaged', '/synthetic/Nomi.app/Contents/MacOS/Nomi'],
    env: { NOMI_AGENT_LIVE: '1', NOMI_LIVE_SETTINGS: path.dirname(sourceFile) } }
  await execute(fs, { ...os, tmpdir: () => root }, path, createHash, root, isolatedProcess,
    finalizeRuntimeWalk, stopRuntimeApp, runUiTask, expect)
  const output = fs.readdirSync(path.join(root, '.tmp'))
  expect(output).toHaveLength(1)
  return JSON.parse(fs.readFileSync(path.join(root, '.tmp', output[0], 'report.json'), 'utf8'))
}

test('a partial temporary credential write still enters cleanup and records failure', async () => {
  let partialFile
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
    originalWrite(file, ...args)
    if (path.basename(String(file)) === 'model-catalog.json' && String(file) !== sourceFile) {
      partialFile = String(file)
      throw new Error('synthetic ENOSPC after partial write')
    }
  })
  const result = await run()
  expect(partialFile).toBeTruthy()
  expect(fs.existsSync(partialFile)).toBe(false)
  expect(result).toMatchObject({ result: 'failed', temporaryCredentialRemoved: true, error: expect.stringContaining('synthetic ENOSPC') })
})

test('changed source evidence cannot produce a passed report', async () => {
  const result = await run(async () => { originalWrite(sourceFile, '{}') })
  expect(result.result).toBe('failed')
  expect(result.error).toContain('source catalog changed')
  expect(process.exitCode).toBe(1)
})

test('unchanged source and removed temporary credential permit a passed cleanup report', async () => {
  const result = await run()
  expect(result).toMatchObject({ result: 'passed', sourceUnchanged: true, temporaryCredentialRemoved: true })
  expect(process.exitCode).toBeUndefined()
})

test('the paid smoke also exercises the reported canvas task without approving media generation', () => {
  expect(source).toContain('在画布上放一张手写的纯文本卡片')
  expect(source).toContain('把 NOMILIVESOURCE 当参考连到 NOMILIVETARGET')
  expect(source).toContain('await openCanvas(win)')
  // v4 接线（2026-09-06）：待批准的操作落在**介入槽**里，一次一个，
  // 批准钮是 `INTERVENTION_CONFIRM`——旧面板那个「全部确认」的挂点
  // （`data-plan-confirm-all`）随旧组件整件删除。这条断言守的是
  // 「付费冒烟真的按下了批准」，锚点跟着契约走，不跟着已经不存在的 class 走。
  expect(source).toContain('INTERVENTION_CONFIRM')
  expect(source).toContain('No media generation or unrelated tool may be requested')
  expect(source).toContain('nodes: 2, edges: 1')
  // 付费那条路不在白名单里：真模型碰 `draft_shots` / `generate` 这一幕就红。
  expect(source).toContain("const allowedTools = ['read_script', 'write_script', 'look_at_canvas', 'make_artifact', 'arrange_canvas']")
  expect(source).toContain("receipt.getByRole('button', { name: '撤销', exact: true })")
  expect(source).toContain("proveProbe(approval, 'The real model must propose an actual append for human approval', 120_000)")
  expect(source).toContain('expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 120_000 })')
  expect(source).toContain("expect(win.locator(CREATION_PANEL)).toContainText('NOMI_PI_LIVE_OK', { timeout: 120_000 })")
  expect(source).toContain('expect(plan).toBeVisible({ timeout: 120_000 })')
})

test('the real acceptance assertions accept a reference edge and matching successful native result', async () => {
  await expect(canvasEvidence()).resolves.toBeUndefined()
})

test('the real acceptance assertions reject a different edge mode', async () => {
  await expect(canvasEvidence({ mode: 'first_frame' })).rejects.toThrow()
})

test('the real acceptance assertions reject a generating node kind', async () => {
  // 画布写动词造不出生成类节点（v2 的那扇门）。真机上出现 image 节点 = 走的不是这一幕这条路。
  await expect(canvasEvidence({ kind: 'image' })).rejects.toThrow()
})

test('the real acceptance assertions reject a paid verb standing in for the link', async () => {
  await expect(canvasEvidence({ linkVerb: 'draft_shots' })).rejects.toThrow()
})

test.each([
  { isError: true },
  { toolCallId: 'another-call' },
  { details: { applied: true, operation: 'connect_canvas_edges', affectedNodeIds: [], affectedEdgeIds: ['edge-1'], connectedCount: 0 } },
  { details: { applied: true, operation: 'connect_canvas_edges', affectedNodeIds: [], affectedEdgeIds: [], connectedCount: 1 } },
  { details: { applied: false, operation: 'connect_canvas_edges', affectedNodeIds: [], affectedEdgeIds: ['edge-1'], connectedCount: 1 } },
  { details: { applied: true, operation: 'set_node_prompt', affectedNodeIds: [], affectedEdgeIds: ['edge-1'], connectedCount: 1 } },
])('the real acceptance assertions reject unsuccessful or unrelated native evidence: %j', async (link) => {
  await expect(canvasEvidence({ link })).rejects.toThrow()
})
