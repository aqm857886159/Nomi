import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as support from './agent-runtime-walk-support.mjs'

const folders = []
let previousExitCode
let previousArgv

beforeEach(() => {
  previousExitCode = process.exitCode
  previousArgv = process.argv
  process.argv = ['node', 'walk']
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = previousExitCode
  process.argv = previousArgv
  vi.restoreAllMocks()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

function report() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-walk-report-test-'))
  folders.push(outputDir)
  return { outputDir, name: 'cleanup-contract' }
}

function finalizer() {
  expect(typeof support.finalizeRuntimeWalk, 'Walk cleanup failures must be recorded as failed evidence').toBe('function')
  return support.finalizeRuntimeWalk
}

function closer() {
  expect(typeof support.stopRuntimeApp, 'The owned Electron process must terminate, even when close rejects').toBe('function')
  return support.stopRuntimeApp
}

describe('walk evidence finalization', () => {
  test('a real unexpected local request after the body checkpoint still makes final evidence fail', async () => {
    const walk = await support.createRuntimeWalk('cleanup-contract')
    folders.push(walk.report.tempRoot, walk.outputDir)
    walk.fixture.assertClean()
    const unexpected = await fetch(`${walk.fixture.baseURL}/unexpected-after-checkpoint`)
    expect(unexpected.status).toBe(400)
    await walk.finish()
    expect(walk.report.result).toBe('failed')
    expect(walk.report.error).toBeTruthy()
    expect(process.exitCode).toBe(1)
  })
  test('records a failed close, still closes the fixture and writes a failed report', async () => {
    const value = report()
    const order = []
    await finalizer()(value, {
      cleanup: [() => { order.push('app'); throw new Error('close failed') }, () => { order.push('fixture') }],
      collect: () => ({ textRequests: 2 }),
    })
    expect(order).toEqual(['app', 'fixture'])
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(fs.readFileSync(path.join(value.outputDir, 'report.json'), 'utf8')))
      .toMatchObject({ result: 'failed', error: expect.stringContaining('close failed'), textRequests: 2 })
  })

  test('keeps the original failure and every later cleanup failure', async () => {
    const value = report()
    await finalizer()(value, {
      error: new Error('approval failed'),
      cleanup: [async () => { throw new Error('close failed') }, () => { throw new Error('credential cleanup failed') }],
    })
    expect(value.result).toBe('failed')
    for (const message of ['approval failed', 'close failed', 'credential cleanup failed']) expect(value.error).toContain(message)
    expect(process.exitCode).toBe(1)
  })

  test('collects evidence only after cleanup and does not mark an evidence read failure as passed', async () => {
    const order = []
    const value = report()
    await finalizer()(value, {
      cleanup: [() => { order.push('cleanup') }],
      collect: () => { order.push('collect'); throw new Error('cannot read source') },
    })
    expect(order).toEqual(['cleanup', 'collect'])
    expect(value).toMatchObject({ result: 'failed', error: expect.stringContaining('cannot read source') })
  })

  test('writes a passed report only after successful cleanup and evidence collection', async () => {
    const value = report()
    await finalizer()(value, { cleanup: [async () => {}], collect: () => ({ temporaryCredentialRemoved: true }) })
    expect(value).toMatchObject({ result: 'passed', temporaryCredentialRemoved: true })
    expect(value.error).toBeUndefined()
    expect(process.exitCode).toBeUndefined()
  })
})

test.each(['agent-runtime-walk-support.mjs', 'agent-runtime-provider.walk.mjs'])('%s pins the actual built renderer, not inherited development servers', (file) => {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let env
  const fileChecks = []
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'launchNomiApp') {
      const options = node.arguments[0]
      const property = options.properties.find((item) => item.name?.getText(source) === 'env')
      env = Object.fromEntries(property.initializer.properties.map((item) => [item.name.getText(source), item.initializer.text]))
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'win.url().startsWith') {
      let parent = node.parent
      let conditional = false
      while (parent && !ts.isFunctionLike(parent)) {
        conditional ||= ts.isIfStatement(parent)
        parent = parent.parent
      }
      fileChecks.push({ prefix: node.arguments[0].text, conditional })
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  expect(env).toMatchObject({ NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '' })
  expect(fileChecks).toEqual([{ prefix: 'file:', conditional: false }])
})

function ownedApp(close) {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
  child.kill = vi.fn((signal) => {
    child.signalCode = signal
    queueMicrotask(() => child.emit('exit', null, signal))
    return true
  })
  return { child, app: { process: () => child, close: () => close(child) } }
}

describe('owned Electron teardown', () => {
  test('a normal exit does not kill the process', async () => {
    const { app, child } = ownedApp(async (process) => { process.exitCode = 0 })
    await closer()(app)
    expect(child.kill).not.toHaveBeenCalled()
  })

  test('a failed close terminates only its owned child but still rejects the original failure', async () => {
    const failure = new Error('Electron close rejected')
    const { app, child } = ownedApp(async () => { throw failure })
    await expect(closer()(app)).rejects.toBe(failure)
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(child.listenerCount('exit')).toBe(0)
  })

  test('a resolved close without process exit is not cold-restoration evidence', async () => {
    const { app, child } = ownedApp(async () => {})
    await expect(closer()(app)).rejects.toThrow('terminated process')
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
  })

  test('a failed owned-process termination preserves both failures and their cause chain', async () => {
    const failure = new Error('Electron close rejected')
    const { app, child } = ownedApp(async () => { throw failure })
    child.kill.mockReturnValue(false)
    const rejected = await closer()(app).catch((error) => error)
    expect(rejected).toBeInstanceOf(AggregateError)
    expect(rejected.errors[0]).toBe(failure)
    expect(rejected.errors[1].message).toBe('Could not terminate the owned Electron process')
    expect(rejected.errors[1].cause).toBe(failure)
    expect(rejected.cause).toBe(rejected.errors[1])
  })
})

describe('persisted Agent workbench document readback', () => {
  test('selects the active document from the current multi-document schema', () => {
    const active = { id: 'doc-active', title: 'active' }
    expect(support.readPersistedWorkbenchDocument({
      payload: {
        workbenchDocuments: [{ id: 'doc-other', title: 'other' }, active],
        activeDocumentId: active.id,
      },
    })).toEqual({ schema: 'multi', document: active })
  })

  test('keeps legacy single-document reads explicitly classified for compatibility', () => {
    const legacy = { id: 'legacy-doc', title: 'legacy' }
    expect(support.readPersistedWorkbenchDocument({ payload: { workbenchDocument: legacy } })).toEqual({
      schema: 'legacy',
      document: legacy,
    })
  })

  test('fails closed when no supported persisted document schema is present', () => {
    expect(support.readPersistedWorkbenchDocument({ payload: {} })).toEqual({ schema: 'missing', document: null })
  })

  test('does not silently promote legacy readback into current-writer evidence', () => {
    expect(() => support.requireCurrentPersistedWorkbenchDocument({ payload: { workbenchDocument: { id: 'legacy' } } }))
      .toThrow(/legacy workbenchDocument/)
  })
})
