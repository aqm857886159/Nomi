import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertScanCoverage,
  extractScriptRefs,
  findMissingRefs,
  listWorkflowFiles,
  main,
  WORKFLOW_DIR,
} from './check-workflow-script-refs.mjs'

function withRepo(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-refs-gate-'))
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
    writeWorkflow(root, 'desktop-rc.yml', ['jobs:', '  run: pnpm run gates', '  run: pnpm run test:mcp'].join('\n'))
    const red = []
    assert.equal(main({ root, log: (line) => red.push(line) }), 1, '悬空引用必须报红')
    assert.match(red.join('\n'), /test:mcp/)

    writeWorkflow(root, 'desktop-rc.yml', ['jobs:', '  run: pnpm run gates', '  run: pnpm run test:mcp-journey'].join('\n'))
    const green = []
    assert.equal(main({ root, log: (line) => green.push(line) }), 0, '改成后继 lane 后必须回绿')
    assert.match(green.join('\n'), /全部解析得到/)
  })
})
