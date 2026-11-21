// scripts/goal-red-on-base.mjs 的归类判据。失败信息样本取自 2026-11-21 在真实旧提交上的回放输出
// （重发一处定、批准一处判、分镜回访三个 PR 的第一轮），不是手编的形状。
import { describe, expect, it } from 'vitest'

import { classifyFailure, fileVerdict, isTestSide, parseArgs, readVitestReport, topFrameFile } from './goal-red-on-base.mjs'

const ROOT = '/tmp/nomi-goal-red-p1-AbCdEf'

describe('一条失败归哪一类', () => {
  it('断言失败、查不到元素、jest-dom 的 expect 都算断言红', () => {
    expect(classifyFailure("AssertionError: expected 'send' to be 'ask'\n    at /x/a.test.ts:3:1")).toBe('assertion')
    expect(classifyFailure('TestingLibraryElementError: Unable to find role="button"')).toBe('assertion')
    expect(classifyFailure('Error: expect(element).toBeDisabled()\n\nReceived element is not disabled')).toBe('assertion')
    expect(classifyFailure('AssertionError [ERR_ASSERTION]: 1 !== 2')).toBe('assertion')
  })

  it('测试自己调了修前不存在的符号：加载红（第一帧在测试一侧）', () => {
    const message = `TypeError: (0 , __vite_ssr_import_5__.readApprovalDecision) is not a function\n    at ${ROOT}/electron/capabilityCore/approvalOneHomeOwner.test.ts:41:20\n    at file:///repo/node_modules/vitest/dist/runner.js:1:1`
    expect(topFrameFile(message)).toBe(`${ROOT}/electron/capabilityCore/approvalOneHomeOwner.test.ts`)
    expect(classifyFailure(message, ROOT)).toBe('load')
    expect(classifyFailure('TypeError: decide is not a function', ROOT)).toBe('load')
  })

  it('找不到模块：加载红', () => {
    expect(classifyFailure("Error: Cannot find module './useEditorRebuildSync' imported from /x/y.test.ts")).toBe('load')
    expect(classifyFailure('Error: Failed to resolve import "./newOwner" from "src/a.test.ts". Does the file exist?')).toBe('load')
  })

  it('同样是 TypeError，但抛在修前的生产代码里：崩溃红，不是加载红', () => {
    const message = `TypeError: Cannot read properties of undefined (reading 'jobs')\n    at pickCurrentJob (${ROOT}/electron/shared/productionShotJobs.ts:88:14)\n    at ${ROOT}/electron/shared/productionShotJobs.test.ts:12:5`
    expect(classifyFailure(message, ROOT)).toBe('crash')
    expect(classifyFailure('Error: Test timed out in 5000ms.', ROOT)).toBe('crash')
  })
})

describe('一份文件的结论', () => {
  const tests = (...kinds) => kinds.map((kind) => ({ kind }))

  it('有断言红、没有加载红：合格；修前本来就绿的用例不影响', () => {
    expect(fileVerdict({ tests: tests('assertion', 'assertion', 'green', 'green') })).toMatchObject({ ok: true, reason: '' })
  })

  it('混进一条加载红：不合格，哪怕别的用例是断言红', () => {
    const verdict = fileVerdict({ tests: tests('assertion', 'load', 'green') })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/1 条是加载红/)
  })

  it('修前全绿：不合格', () => {
    expect(fileVerdict({ tests: tests('green', 'green') })).toMatchObject({ ok: false, reason: expect.stringMatching(/证明不了/) })
  })

  it('整份加载不起来：不合格', () => {
    expect(fileVerdict({ tests: [], suiteError: "Cannot find module './x'" })).toMatchObject({ ok: false, reason: expect.stringMatching(/加载不起来/) })
  })

  it('只有崩溃红：合格，但提示补断言', () => {
    expect(fileVerdict({ tests: tests('crash', 'green') })).toMatchObject({ ok: true, reason: expect.stringMatching(/补一条对结果的断言/) })
  })
})

describe('哪些文件取分支版本', () => {
  it('测试、夹具、测试支撑算测试一侧；生产文件不算', () => {
    for (const file of ['src/a/b.test.ts', 'electron/x.test.tsx', 'scripts/y.node-test.mjs', 'tests/ux/walk.mjs', 'electron/testSupport/fake.ts', 'tests/fixtures/old-user-data/p/manifest.json']) expect(isTestSide(file), file).toBe(true)
    for (const file of ['src/a/b.ts', 'electron/latestRelease.ts', 'scripts/goal-red-on-base.mjs', 'package.json']) expect(isTestSide(file), file).toBe(false)
  })
})

describe('读 vitest 报告', () => {
  it('路径换成仓库相对；没收集到用例的失败文件记成整份错误', () => {
    const suites = readVitestReport({
      testResults: [
        { name: `${ROOT}/src/a.test.ts`, status: 'failed', assertionResults: [
          { fullName: '甲', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] },
          { fullName: '乙', status: 'passed', failureMessages: [] },
        ] },
        { name: `${ROOT}/src/b.test.ts`, status: 'failed', message: "Cannot find module './b'", assertionResults: [] },
      ],
    }, ROOT)
    expect(suites[0]).toMatchObject({ file: 'src/a.test.ts', suiteError: '' })
    expect(suites[0].tests.map((entry) => entry.kind)).toEqual(['assertion', 'green'])
    expect(suites[1]).toMatchObject({ file: 'src/b.test.ts', suiteError: "Cannot find module './b'" })
  })
})

describe('命令行', () => {
  it('-- 后面全是文件；--changed 和 --report-only 是开关；超时默认十分钟、可调', () => {
    expect(parseArgs(['--base', 'abc', '--report-only', '--', 'a.test.ts', 'b.test.ts'])).toMatchObject({ base: 'abc', head: 'HEAD', reportOnly: true, changed: false, files: ['a.test.ts', 'b.test.ts'] })
    expect(parseArgs(['--changed', '--head', 'def'])).toMatchObject({ changed: true, head: 'def', files: [] })
    expect(parseArgs(['--timeout-ms', '20000', '--', 'a.test.ts']).timeoutMs).toBe(20000)
    expect(parseArgs(['--', 'a.test.ts']).timeoutMs).toBe(600000)
  })
})
