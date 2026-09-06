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
const verifyCanvasEvidence = new AsyncFunction('readProject', 'win', 'projectId', 'readNativeContexts', 'projectRoot', 'snapshotMessages', 'expect',
  uiTry.tryBlock.statements.slice(evidenceStart, evidenceEnd).map((statement) => statement.getText(tree)).join('\n'))

function canvasEvidence(overrides = {}) {
  const landed = {
    nodes: [{ id: 'source', title: 'NOMILIVESOURCE', kind: 'image' }, { id: 'target', title: 'NOMILIVETARGET', kind: 'image' }],
    edges: [{ source: 'source', target: 'target', mode: overrides.mode ?? 'reference' }],
  }
  const result = { role: 'toolResult', toolName: 'create_canvas_nodes', toolCallId: 'create-1', isError: false,
    details: { ok: true }, content: [{ type: 'text', text: JSON.stringify({ createdNodeIds: ['source', 'target'] }) }], ...overrides.result }
  const messages = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'create_canvas_nodes', id: 'create-1' }] }, result]
  return verifyCanvasEvidence(async () => ({ payload: { generationCanvas: landed } }), {}, 'project', () => [{ snapshot: true }], '/synthetic', () => messages, expect)
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
  expect(source).toContain('创建两个图片节点并连接参考，只建节点，不生成')
  expect(source).toContain('await openCanvas(win)')
  // v4 接线（2026-09-06）：待批准的操作落在**介入槽**里，一次一个，
  // 批准钮是 `INTERVENTION_CONFIRM`——旧面板那个「全部确认」的挂点
  // （`data-plan-confirm-all`）随旧组件整件删除。这条断言守的是
  // 「付费冒烟真的按下了批准」，锚点跟着契约走，不跟着已经不存在的 class 走。
  expect(source).toContain('INTERVENTION_CONFIRM')
  expect(source).toContain('run_generation_batch')
  expect(source).toContain('nodes: 2, edges: 1')
  expect(source).toContain('data-proposal-undo-all')
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

test.each([
  { isError: true },
  { toolCallId: 'another-call' },
  { content: [{ type: 'text', text: JSON.stringify({ createdNodeIds: ['unrelated-node'] }) }] },
])('the real acceptance assertions reject unsuccessful or unrelated native evidence: %j', async (result) => {
  await expect(canvasEvidence({ result })).rejects.toThrow()
})
