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

test('vertical spine closes the visible settings dialog before opening Agent menus', () => {
  const runner = fs.readFileSync(new URL('./agent-vertical-spine-m0-m5.red.e2e.mjs', import.meta.url), 'utf8')
  expect(runner).toMatch(/closeSettingsOverlayThroughVisibleUi/)
  expect(runner).toMatch(/dialog\.locator\('\[data-settings-close\]'\)/)
  expect(runner).toMatch(/overlay\.waitFor\(\{ state: 'hidden'/)
  const closeCall = runner.indexOf('await closeSettingsOverlayThroughVisibleUi(win)')
  const agentSelection = runner.indexOf("currentStep = 'M3.select-skill-and-model'")
  expect(closeCall).toBeGreaterThan(-1)
  expect(closeCall).toBeLessThan(agentSelection)
  expect(runner).not.toMatch(/keyboard\.press\('Escape'\)/)
})

test('vertical spine waits for each natural Agent turn terminal before sending the next turn', () => {
  const runner = fs.readFileSync(new URL('./agent-vertical-spine-m0-m5.red.e2e.mjs', import.meta.url), 'utf8')
  expect(runner).toMatch(/waitForAgentTurnTerminal\(panel, turn\.user\)/)
  // v4 没有 per-item 的 turn id：回合终点由 composer 的运行态判定，终态写在助手文本 / 错误条上。
  expect(runner).toMatch(/const TURN_RUNNING = `\$\{COMPOSER\}\[data-mode="running"\]`/)
  expect(runner).toMatch(/TURN_RUNNING\)\.waitFor\(\{ state: 'hidden'/)
  expect(runner).toMatch(/block === 'errorbar' \? 'failed' : await terminal\.getAttribute\('data-status'\)/)
  expect(runner).toMatch(/waitForAgentTurnSettled\(panel\)/)
  const terminalWait = runner.indexOf('waitForAgentTurnTerminalOrPendingProposal(panel, turn.user)')
  expect(runner).toMatch(/terminalStatus !== 'complete'.*throw new Error/)
  const nextTurnEvidence = runner.indexOf('steps.push({ id: `M3.${turn.turn}.natural-user-turn`')
  expect(terminalWait).toBeGreaterThan(-1)
  expect(nextTurnEvidence).toBeGreaterThan(terminalWait)
  // 旧面板的 per-item 挂点一个都不许留下——留着就是一条只报「元素找不到」的死选择器。
  expect(runner).not.toMatch(/data-agent-item-kind=/)
  expect(runner).not.toMatch(/data-agent-turn-id=/)
})

test('vertical spine handles R2 proposal pending by visibly denying before the R3 change of mind', () => {
  const runner = fs.readFileSync(new URL('./agent-vertical-spine-m0-m5.red.e2e.mjs', import.meta.url), 'utf8')
  expect(runner).toMatch(/waitForAgentTurnTerminalOrPendingProposal\(panel, turn\.user\)/)
  // v4：待决就是介入槽本身在不在（槽只在有 pending 时渲染），没有第二个 approval-state 属性。
  expect(runner).toMatch(/const pending = panel\.locator\(APPROVAL_CARD\)/)
  expect(runner).toMatch(/denyPendingProposalForRevision\(panel\)/)
  expect(runner).toMatch(/turn\.turn !== 'R2'/)
  expect(runner).toMatch(/M3\.R2\.pending-proposal-denied/)
  // 拒绝必须走完两下：先「不要」摊开原因，再「确认不要」才真的回给宿主。
  expect(runner).toMatch(/INTERVENTION_REJECT/)
  expect(runner).toMatch(/INTERVENTION_CONFIRM_REJECT/)
  expect(runner).toMatch(/turn\.turn === 'R2' && terminalStatus === 'interrupted'/)
  expect(runner).not.toMatch(/if \(turn\.turn !== 'R2'\)[\s\S]{0,240}resolveTool\([^\n]+true/)
})

test('vertical spine captures only redacted Agent failure diagnostics', () => {
  const runner = fs.readFileSync(new URL('./agent-vertical-spine-m0-m5.red.e2e.mjs', import.meta.url), 'utf8')
  expect(runner).toMatch(/agentFailureEvidence\(win\)/)
  // v4 的失败是一条错误条（人话原因 + 一个动作）；旧的 error-code / message-category 属性已随旧面板删除，
  // 所以证据里剩下的每一段用户可见文本都必须先过脱敏。
  expect(runner).toMatch(/panel\.locator\(ERROR_BAR\)/)
  expect(runner).toMatch(/reason: redactDiagnosticText\(await failure\.innerText\(\)/)
  expect(runner).toMatch(/const lastUserText = redactDiagnosticText\(/)
  expect(runner).toMatch(/api\[_ -\]\?key\|token\|secret\|authorization\|bearer/)
  expect(runner).not.toMatch(/agentFailure[\s\S]{0,220}item\.message/)
})

test('vertical spine reopens the persisted project through the visible library after cold restart', () => {
  const runner = fs.readFileSync(new URL('./agent-vertical-spine-m0-m5.red.e2e.mjs', import.meta.url), 'utf8')
  expect(runner).toMatch(/reopenProjectThroughVisibleLibrary\(win, projectId, initial\.name, projectDir, changed\.revision\)/)
  expect(runner).toMatch(/readback\.revision < changed\.revision/)
  expect(runner).toMatch(/\.nomi-library-page/)
  expect(runner).toMatch(/data-project-card=\"true\"/)
  expect(runner).toMatch(/继续创作\|Continue creating/)
  expect(runner).toMatch(/projectId=\$\{encodeURIComponent\(id\)\}/)
  expect(runner).toMatch(/getByRole\('button', \{ name: '创作', exact: true \}\)/)
  expect(runner).toMatch(/locator\('\[data-storyboard-card\]'\)/)
  expect(runner).toMatch(/\.workbench-shell__workspace:not\(\[hidden\]\)/)
  expect(runner).toMatch(/data-workspace-mode.*creation/)
  expect(runner).toMatch(/storyboardCards\.first\(\)\.waitFor\(\{ state: 'visible'/)
  expect(runner).toMatch(/getByRole\('button', \{ name: \/打开分镜\|再次编辑\|Open storyboard\|Edit again\/i \}\)/)
  expect(runner).toMatch(/openButton\.isVisible\(\)/)
  expect(runner).not.toMatch(/const openStoryboard = win\.getByRole\('button'/)
  expect(runner).toMatch(/searchParams\.get\('step'\) === 'storyboard'/)
  expect(runner).toMatch(/data-storyboard-editor=\"true\"/)
  expect(runner).toMatch(/data-storyboard-row=\"2\"/)
  expect(runner).toMatch(/reopened\.revision/)
  expect(runner).toMatch(/waitForAgentTurnTerminal\(restartedPanel, resumeTurn\.user\)/)
  expect(runner).not.toMatch(/const restartedPanel = win\.locator\(AGENT_PANEL\)\.first\(\)\n    await restartedPanel\.waitFor/)
})

test('the resident shell keeps the surface identity anchors every walkthrough scopes by', () => {
  // 空态那两个挂点（data-agent-empty-state / -cta）随 v4 接线删了：v4 的空面板就是一条空对话流 +
  // composer，没有第九个「空状态」积木。这里改钉**外壳身份**——它是所有走查作用域的根据，
  // 丢一个就会让整批走查报「面板没渲染」而实际是选择器过期。
  const source = fs.readFileSync(new URL('../../src/workbench/ai/ProjectAgentResidentShell.tsx', import.meta.url), 'utf8')
  for (const anchor of [
    'data-agent-resident="true"',
    'data-agent-panel="true"',
    'data-agent-surface={surface}',
    'data-agent-collapsed="true"',
    'data-agent-approval-mode={actions.permission}',
    'data-agent-thread-menu="true"',
    'data-agent-error="true"',
  ]) {
    expect(source, `resident shell 必须继续发出 ${anchor}`).toContain(anchor)
  }
})

test('every panel selector lives in the shared support module, not hand-copied into walks', async () => {
  const support = await import('./agent-runtime-walk-support.mjs')
  expect(support.APPROVAL_CARD).toBe('[data-v4-block="intervention"]')
  expect(support.COMPOSER_INPUT).toBe('[data-v4-control="input"]')
  expect(support.COMPOSER_SEND).toBe('[data-v4-control="send"]')
  expect(support.INTERVENTION_CONFIRM).toBe('[data-v4-control="confirm"]')
  expect(support.INTERVENTION_REJECT).toBe('[data-v4-control="reject"]')
  expect(support.INTERVENTION_CONFIRM_REJECT).toBe('[data-v4-control="confirm-reject"]')
  expect(support.COMPOSER_STOP).toContain('[data-mode="running"]')
  expect(typeof support.waitForV4TurnIdle).toBe('function')
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
