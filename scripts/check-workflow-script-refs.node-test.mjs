import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertScanCoverage,
  extractScriptRefs,
  findFloatingRunners,
  findMissingRefs,
  findUnexercisedRunners,
  listWorkflowFiles,
  main,
  WORKFLOW_DIR,
  workflowTriggers,
} from './check-workflow-script-refs.mjs'

function withRepo(run) {
  const root = makeTempDir('workflow-refs-gate-')
  try {
    fs.mkdirSync(path.join(root, WORKFLOW_DIR), { recursive: true })
    return run(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const writeWorkflow = (root, name, body) => fs.writeFileSync(path.join(root, WORKFLOW_DIR, name), body)
const writePackage = (root, scripts) =>
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts }, null, 2))

test('抽取认得出各种 pnpm run 写法，且不误认路径调用', () => {
  const refs = extractScriptRefs(
    [
      '        run: pnpm run gates',
      '          xvfb-run -a pnpm run test:mcp-journey',
      '        run: pnpm -s run lint:ci',
      '        run: pnpm --silent run check:tokens',
      '          node scripts/check-e2e-launch.mjs',
    ].join('\n'),
  )
  assert.deepEqual(
    refs.map((ref) => ref.script),
    ['gates', 'test:mcp-journey', 'lint:ci', 'check:tokens'],
    '四种写法都要认出来；直接 node 路径调用不属这道门',
  )
  assert.deepEqual(
    refs.map((ref) => ref.line),
    [1, 2, 3, 4],
    '行号要对得上——报告里没有准确行号，人还得自己去 workflow 里翻',
  )
})

test('缺失的 script 被逐处点名（带文件与行号）', () => {
  withRepo((root) => {
    writePackage(root, { gates: 'node gates.mjs', 'test:mcp-journey': 'node journey.mjs' })
    writeWorkflow(root, 'rc.yml', ['jobs:', '  run: pnpm run gates', '  run: pnpm run test:mcp'].join('\n'))
    const missing = findMissingRefs(listWorkflowFiles(root), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts, { root })
    assert.equal(missing.length, 1)
    assert.equal(missing[0].script, 'test:mcp')
    assert.equal(missing[0].line, 3)
    assert.match(missing[0].file, /rc\.yml$/)
  })
})

test('只读 .yml/.yaml，其它文件不误扫', () => {
  withRepo((root) => {
    writeWorkflow(root, 'a.yml', 'run: pnpm run gates')
    writeWorkflow(root, 'b.yaml', 'run: pnpm run gates')
    writeWorkflow(root, 'README.md', 'run: pnpm run 不存在的脚本')
    assert.deepEqual(
      listWorkflowFiles(root).map((file) => path.basename(file)),
      ['a.yml', 'b.yaml'],
    )
  })
})

test('扫到 0 份 workflow 或 0 处引用时 fail-closed，而不是报绿', () => {
  assert.throws(() => assertScanCoverage(0, 0), /一份 workflow 都没读到/)
  assert.throws(() => assertScanCoverage(3, 0), /一处 `pnpm run` 都没解析出来/)
  assert.doesNotThrow(() => assertScanCoverage(3, 1))
})

test('端到端：悬空引用回 1、清理后回 0（这道门真会红）', () => {
  withRepo((root) => {
    writePackage(root, { gates: 'node gates.mjs', 'test:mcp-journey': 'node journey.mjs' })
    writeWorkflow(root, 'desktop-rc.yml', ['jobs:', '  gates:', '    run: pnpm run gates', '  mcp:', '    run: pnpm run test:mcp'].join('\n'))
    const red = []
    assert.equal(main({ root, log: (line) => red.push(line) }), 1, '悬空引用必须报红')
    assert.match(red.join('\n'), /test:mcp/)

    writeWorkflow(root, 'desktop-rc.yml', ['jobs:', '  gates:', '    run: pnpm run gates', '  mcp:', '    run: pnpm run test:mcp-journey'].join('\n'))
    const green = []
    assert.equal(main({ root, log: (line) => green.push(line) }), 0, '改成后继 lane 后必须回绿')
    assert.match(green.join('\n'), /全部解析得到/)
  })
})

test('会漂的 -latest 机器标签逐处点名；写死版本、注释里提到、gh 的 --latest 参数都不算', () => {
  withRepo((root) => {
    writeWorkflow(root, 'ci.yml', [
      'jobs:',
      '  unit:',
      '    runs-on: ubuntu-latest',
      '  mac:',
      '    runs-on: macos-latest-xlarge',
      '  win:',
      '    runs-on: windows-2025',
      '  pinned:',
      '    runs-on: ubuntu-24.04  # 不用 ubuntu-latest：会漂',
      '  matrix:',
      '    strategy: { matrix: { os: [macos-26, windows-latest] } }',
      '  release:',
      '    run: gh release edit v1 --latest',
    ].join('\n'))
    const floating = findFloatingRunners(listWorkflowFiles(root), { root })
    assert.deepEqual(floating.map((item) => `${item.line} ${item.label}`), ['3 ubuntu-latest', '5 macos-latest-xlarge', '11 windows-latest'])
  })
})

test('端到端：有 -latest 机器标签回 1，写死版本后回 0', () => {
  withRepo((root) => {
    writePackage(root, { gates: 'node gates.mjs' })
    writeWorkflow(root, 'quality-gate.yml', ['on: [push]', 'jobs:', '  unit:', '    runs-on: ubuntu-latest', '    steps:', '      - run: pnpm run gates'].join('\n'))
    const red = []
    assert.equal(main({ root, log: (line) => red.push(line) }), 1, '会漂的标签必须报红')
    assert.match(red.join('\n'), /quality-gate\.yml:4 {2}ubuntu-latest/)

    writeWorkflow(root, 'quality-gate.yml', ['on: [push]', 'jobs:', '  unit:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: pnpm run gates'].join('\n'))
    const green = []
    assert.equal(main({ root, log: (line) => green.push(line) }), 0, '写死版本后必须回绿')
  })
})

test('三种 on: 写法都认得出触发方式', () => {
  assert.deepEqual(workflowTriggers('on: push\njobs: {}'), ['push'])
  assert.deepEqual(workflowTriggers('on: [push, workflow_dispatch]\njobs: {}'), ['push', 'workflow_dispatch'])
  assert.deepEqual(workflowTriggers('on:\n  schedule:\n    - cron: "0 3 * * *"\n  workflow_dispatch:\njobs: {}'), ['schedule', 'workflow_dispatch'])
  assert.deepEqual(workflowTriggers('jobs: {}'), [])
})

test('只在发版 / 手动 / 打标签 PR 才跑的 workflow，用了日常没人用的机器就逐处点名', () => {
  withRepo((root) => {
    writeWorkflow(root, 'quality-gate.yml', ['on:', '  pull_request:', '  push:', '    branches: [main]', 'jobs:', '  unit:', '    runs-on: ubuntu-24.04', '  mac:', '    runs-on: macos-26'].join('\n'))
    writeWorkflow(root, 'nightly.yml', ['on:', '  schedule:', '    - cron: "0 3 * * *"', 'jobs:', '  win:', "    runs-on: 'windows-2025'"].join('\n'))
    writeWorkflow(root, 'desktop-rc.yml', [
      'on:',
      '  workflow_dispatch:',
      'jobs:',
      '  validate:',
      '    runs-on: ubuntu-24.04',
      '  macos:',
      '    runs-on: macos-14',
      '  windows:',
      '    runs-on: windows-2025  # 日常夜跑在用',
      '  matrix:',
      '    runs-on: ${{ matrix.os }}',
    ].join('\n'))
    writeWorkflow(root, 'desktop-preview.yml', ['on:', '  pull_request:', 'jobs:', '  mac-preview:', '    runs-on: macos-15'].join('\n'))
    const unexercised = findUnexercisedRunners(listWorkflowFiles(root), { root })
    assert.deepEqual(
      unexercised.map((item) => `${item.file}:${item.line} ${item.label}`),
      [`${WORKFLOW_DIR}/desktop-preview.yml:5 macos-15`, `${WORKFLOW_DIR}/desktop-rc.yml:7 macos-14`],
    )
  })
})

test('端到端：发版 workflow 用了日常没人用的 macos-14 回 1，换成每个 PR 都在用的机器后回 0', () => {
  withRepo((root) => {
    writePackage(root, { gates: 'node gates.mjs' })
    writeWorkflow(root, 'quality-gate.yml', ['on: [push, pull_request]', 'jobs:', '  mac:', '    runs-on: macos-26', '    steps:', '      - run: pnpm run gates'].join('\n'))
    writeWorkflow(root, 'desktop-rc.yml', ['on:', '  workflow_dispatch:', 'jobs:', '  macos:', '    runs-on: macos-14', '    steps:', '      - run: pnpm run gates'].join('\n'))
    const red = []
    assert.equal(main({ root, log: (line) => red.push(line) }), 1, '日常没人用的机器必须报红')
    assert.match(red.join('\n'), /desktop-rc\.yml:5 {2}macos-14/)

    writeWorkflow(root, 'desktop-rc.yml', ['on:', '  workflow_dispatch:', 'jobs:', '  macos:', '    runs-on: macos-26', '    steps:', '      - run: pnpm run gates'].join('\n'))
    const green = []
    assert.equal(main({ root, log: (line) => green.push(line) }), 0, '换成日常在用的机器后必须回绿')
  })
})
